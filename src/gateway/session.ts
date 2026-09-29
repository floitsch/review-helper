// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import type {
  AgentStatus,
  ChatMessage,
  Chip,
  DiffSet,
  DraftComment,
  HighlightedFile,
  PrConversation,
  ReviewDoc,
  ReviewState,
  ServerMessage,
  SessionInfo,
} from '../shared/types.ts';
import * as git from './git.ts';
import { findHunk, hunkToText, parseDiff } from './diff.ts';
import { highlightBlob, langForPath, splitLines } from './highlight.ts';
import { findBlock, markdownToBlocks, parseReviewDoc } from './doc.ts';
import * as github from './github.ts';
import { WorktreeSnapshots } from './worktree.ts';

export interface SessionOptions {
  repo: string;
  base?: string;
  head?: string;
  pr?: number;
  worktree?: boolean;
  port: number;
}

const EMPTY_STATE: ReviewState = { reviewedChanges: {}, reviewedHunks: {}, drafts: [], chat: [] };

export class Session {
  info!: SessionInfo;
  state: ReviewState = structuredClone(EMPTY_STATE);
  doc: ReviewDoc = { blocks: [], warnings: [], uncovered: [], mtime: 0, exists: false };
  conversation: PrConversation | null = null;
  fullDiff!: DiffSet;

  private diffCache = new Map<string, Promise<DiffSet>>();
  private pending: ChatMessage[] = [];
  private waiters: ((msgs: ChatMessage[]) => void)[] = [];
  private agentSessions = new Set<string>();
  private listeners = new Set<(msg: ServerMessage) => void>();
  private saveTimer: NodeJS.Timeout | null = null;
  private docReloadTimer: NodeJS.Timeout | null = null;
  private baseRef: string;
  private headRef: string;
  private snapshots?: WorktreeSnapshots;
  private refreshing?: Promise<void>;

  get contentRepo(): string {
    return this.snapshots?.directory ?? this.repo;
  }

  readonly reviewDir: string;
  readonly docPath: string;
  readonly statePath: string;

  private constructor(
    readonly opts: SessionOptions,
    readonly repo: string,
  ) {
    this.reviewDir = path.join(repo, '.review');
    this.docPath = path.join(this.reviewDir, 'doc.md');
    this.statePath = path.join(this.reviewDir, 'state.json');
    this.baseRef = opts.base ?? 'main';
    this.headRef = opts.head ?? 'HEAD';
  }

  static async create(opts: SessionOptions): Promise<Session> {
    const repo = await git.toplevel(opts.repo);
    const s = new Session(opts, repo);
    await s.init();
    return s;
  }

  private async init() {
    if (this.opts.worktree && (this.opts.pr !== undefined || this.opts.head !== undefined)) {
      throw new Error('--worktree cannot be combined with --pr or --head');
    }
    mkdirSync(this.reviewDir, { recursive: true });
    const gitignore = path.join(this.reviewDir, '.gitignore');
    if (!existsSync(gitignore)) writeFileSync(gitignore, '*\n');

    let pr: SessionInfo['pr'];
    let repoName = path.basename(this.repo);
    if (this.opts.pr !== undefined) {
      pr = await github.prInfo(this.repo, this.opts.pr);
      repoName = pr.repo;
      if (!this.opts.base) this.baseRef = await this.resolveRemoteRef(pr.baseRefName);
      if (!this.opts.head) this.headRef = await this.resolveHeadRef(pr.headRefName);
    } else if (this.opts.worktree) {
      this.baseRef = this.opts.base ?? 'HEAD';
      this.headRef = 'working tree';
      this.snapshots = await WorktreeSnapshots.create(this.repo, this.reviewDir);
    } else {
      try {
        repoName = await github.repoNameWithOwner(this.repo);
      } catch {
        // Not a GitHub repo, or gh not configured. Fine.
      }
      if (!this.opts.base) this.baseRef = await this.detectDefaultBranch();
    }
    this.loadState();
    await this.computeRefs(pr, repoName);
    await this.reloadDoc();
    this.watchDoc();
    setInterval(() => this.pollHead().catch((e) => console.error(e)), 5000).unref();
    if (pr) this.loadConversation().catch((e) => console.error(`Could not load PR conversation: ${e}`));
  }

  private async resolveRemoteRef(branch: string): Promise<string> {
    for (const cand of [`origin/${branch}`, branch]) {
      try {
        await git.revParse(this.repo, cand);
        return cand;
      } catch {
        // try next
      }
    }
    return branch;
  }

  private async resolveHeadRef(branch: string): Promise<string> {
    // Prefer the local checkout if it is the PR branch, so that the reviewer sees what is on disk.
    try {
      const cur = (await git.gitText(this.repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
      if (cur === branch) return 'HEAD';
    } catch {
      // ignore
    }
    return this.resolveRemoteRef(branch);
  }

  private async detectDefaultBranch(): Promise<string> {
    for (const cand of ['origin/main', 'origin/master', 'main', 'master']) {
      try {
        await git.revParse(this.repo, cand);
        return cand;
      } catch {
        // try next
      }
    }
    throw new Error('Could not detect the base branch, pass --base');
  }

  private async computeRefs(pr: SessionInfo['pr'], repoName: string) {
    const refs = this.snapshots ? await this.snapshots.capture(this.baseRef) : undefined;
    const headSha = refs?.headSha ?? await git.revParse(this.repo, this.headRef);
    const baseSha = refs?.baseSha ?? await git.mergeBase(this.repo, this.baseRef, headSha);
    if (refs && this.info?.baseSha === baseSha && this.info?.headSha === headSha) return;
    const commits = this.snapshots ? [] : await git.commitsBetween(this.repo, baseSha, headSha);
    this.info = {
      repo: this.repo,
      repoName,
      base: this.baseRef,
      baseSha,
      head: this.headRef,
      headSha,
      commits,
      pr,
      docPath: this.docPath,
      port: this.opts.port,
      worktree: this.opts.worktree,
      contentRepo: this.contentRepo,
    };
    this.diffCache.clear();
    this.fullDiff = await this.getDiff(baseSha, headSha);
  }

  private async pollHead() {
    if (this.snapshots) {
      await this.refresh();
      return;
    }
    const sha = await git.revParse(this.repo, this.headRef);
    if (sha !== this.info.headSha) await this.refresh();
  }

  refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const previous = this.info;
        await this.computeRefs(previous.pr, previous.repoName);
        if (this.info.baseSha !== previous.baseSha || this.info.headSha !== previous.headSha) {
          this.broadcast({ type: 'session', session: this.info });
        }
        await this.reloadDoc();
        if (this.info.pr) this.loadConversation().catch((e) => console.error(e));
      })().finally(() => { this.refreshing = undefined; });
    }
    return this.refreshing;
  }

  // ---- diffs & files ----

  getDiff(from: string, to: string): Promise<DiffSet> {
    const key = `${from}..${to}`;
    let p = this.diffCache.get(key);
    if (!p) {
      p = (async () => {
        const raw = await git.rawDiff(this.contentRepo, from, to);
        const set = parseDiff(raw, from, to);
        await this.decorateDiff(set);
        return set;
      })();
      this.diffCache.set(key, p);
      p.catch(() => this.diffCache.delete(key));
    }
    return p;
  }

  /** Adds syntax tokens to every diff line by highlighting the full old and new files. */
  private async decorateDiff(set: DiffSet) {
    await Promise.all(
      set.files.map(async (f) => {
        if (f.binary || f.hunks.length === 0) return;
        f.lang = langForPath(f.path);
        const [oldFile, newFile] = await Promise.all([
          f.status === 'added' ? null : this.getFile(f.oldPath ?? f.path, set.from, false),
          f.status === 'deleted' ? null : this.getFile(f.path, set.to, false),
        ]);
        for (const h of f.hunks) {
          for (const l of h.lines) {
            const src = l.kind === 'del' ? oldFile : newFile;
            const no = l.kind === 'del' ? l.oldNo : l.newNo;
            const toks = src && no !== undefined ? src.lines[no - 1] : undefined;
            if (toks) l.tokens = toks;
          }
        }
      }),
    );
  }

  private fileCache = new Map<string, Promise<HighlightedFile | null>>();

  async getFile(p: string, rev: string, withChanged = true): Promise<HighlightedFile | null> {
    const key = `${rev}:${p}`;
    let promise = this.fileCache.get(key);
    if (!promise) {
      promise = (async () => {
        const buf = await git.showFile(this.contentRepo, rev, p);
        if (buf === null) return null;
        const lang = langForPath(p);
        if (git.isBinary(buf)) return { path: p, rev, lang, lines: [], binary: true };
        const code = buf.toString('utf8');
        const sha = (await git.blobSha(this.contentRepo, rev, p)) ?? `${rev}:${p}`;
        const lines = await highlightBlob(sha, code, lang);
        return { path: p, rev, lang, lines };
      })();
      if (this.fileCache.size > 500) this.fileCache.clear();
      this.fileCache.set(key, promise);
      promise.catch(() => this.fileCache.delete(key));
    }
    const file = await promise;
    if (!file || !withChanged) return file;
    const changed = this.changedLines(p, rev);
    return { ...file, changed };
  }

  private changedLines(p: string, rev: string): number[] | undefined {
    const diff = this.fullDiff;
    if (!diff) return undefined;
    const isHead = rev === this.info.headSha || rev === 'HEAD' || rev === this.info.head;
    const isBase = rev === this.info.baseSha || rev === this.info.base;
    if (!isHead && !isBase) return undefined;
    const f = diff.files.find((x) => (isHead ? x.path === p : (x.oldPath ?? x.path) === p));
    if (!f) return [];
    const out: number[] = [];
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (isHead && l.kind === 'add') out.push(l.newNo!);
        if (isBase && l.kind === 'del') out.push(l.oldNo!);
      }
    }
    return out;
  }

  async rawFileText(p: string, rev: string): Promise<string | null> {
    const buf = await git.showFile(this.contentRepo, rev, p);
    if (buf === null || git.isBinary(buf)) return null;
    return buf.toString('utf8');
  }

  // ---- document ----

  private watchDoc() {
    const watcher = chokidar.watch(this.docPath, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 150 } });
    const trigger = () => {
      if (this.docReloadTimer) clearTimeout(this.docReloadTimer);
      this.docReloadTimer = setTimeout(() => this.reloadDoc().catch((e) => console.error(e)), 100);
    };
    watcher.on('add', trigger).on('change', trigger).on('unlink', trigger);
  }

  async reloadDoc() {
    if (!existsSync(this.docPath)) {
      this.doc = { blocks: [], warnings: [], uncovered: [], mtime: 0, exists: false };
    } else {
      const src = readFileSync(this.docPath, 'utf8');
      const mtime = statSync(this.docPath).mtimeMs;
      try {
        this.doc = await parseReviewDoc(src, this.fullDiff, mtime);
      } catch (e) {
        this.doc = { blocks: [], warnings: [`Failed to parse ${this.docPath}: ${e}`], uncovered: [], mtime, exists: true };
      }
    }
    this.broadcast({ type: 'doc', doc: this.doc });
  }

  // ---- state ----

  private loadState() {
    try {
      if (existsSync(this.statePath)) {
        const j = JSON.parse(readFileSync(this.statePath, 'utf8'));
        this.state = { ...structuredClone(EMPTY_STATE), ...j };
      }
    } catch (e) {
      console.error(`Could not read ${this.statePath}: ${e}`);
    }
  }

  private saveState() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
      } catch (e) {
        console.error(`Could not write ${this.statePath}: ${e}`);
      }
    }, 200);
  }

  updateState(patch: Partial<ReviewState>) {
    if (patch.reviewedChanges) this.state.reviewedChanges = patch.reviewedChanges;
    if (patch.reviewedHunks) this.state.reviewedHunks = patch.reviewedHunks;
    if ('lastReviewedSha' in patch) this.state.lastReviewedSha = patch.lastReviewedSha;
    if (patch.drafts) this.state.drafts = patch.drafts;
    this.saveState();
    this.broadcast({ type: 'state', state: this.state });
  }

  markReviewed() {
    this.updateState({ lastReviewedSha: this.info.headSha });
  }

  addDraft(d: Omit<DraftComment, 'id' | 'ts'>): DraftComment {
    const draft: DraftComment = { ...d, id: randomUUID(), ts: Date.now() };
    this.state.drafts.push(draft);
    this.updateState({ drafts: this.state.drafts });
    return draft;
  }

  updateDraft(id: string, patch: Partial<DraftComment>) {
    const d = this.state.drafts.find((x) => x.id === id);
    if (!d) throw new Error(`No draft ${id}`);
    Object.assign(d, patch, { id });
    this.updateState({ drafts: this.state.drafts });
  }

  deleteDraft(id: string) {
    this.state.drafts = this.state.drafts.filter((x) => x.id !== id);
    this.updateState({ drafts: this.state.drafts });
  }

  clearChat() {
    this.state.chat = [];
    this.saveState();
  }

  // ---- PR ----

  async loadConversation() {
    if (!this.info.pr) return;
    this.conversation = await github.prConversation(this.repo, this.info.pr.repo, this.info.pr.number);
    this.broadcast({ type: 'pr', conversation: this.conversation });
  }

  async submitReview(event: github.ReviewEvent, body: string): Promise<string> {
    if (!this.info.pr) throw new Error('No pull request associated with this session');
    const url = await github.submitReview(this.repo, this.info.pr.repo, this.info.pr.number, this.info.headSha, event, body, this.state.drafts);
    this.state.drafts = [];
    this.updateState({ drafts: [], lastReviewedSha: this.info.headSha });
    this.loadConversation().catch((e) => console.error(e));
    return url;
  }

  // ---- chat ----

  async userMessage(text: string, chips: Chip[]): Promise<ChatMessage> {
    const msg: ChatMessage = { id: randomUUID(), role: 'user', text, chips, ts: Date.now() };
    msg.blocks = await markdownToBlocks(text, null);
    this.state.chat.push(msg);
    this.saveState();
    this.broadcast({ type: 'chat', message: msg });
    this.pending.push(msg);
    this.flushPending();
    return msg;
  }

  async agentMessage(text: string): Promise<ChatMessage> {
    const msg: ChatMessage = { id: randomUUID(), role: 'agent', text, ts: Date.now() };
    msg.blocks = await markdownToBlocks(text, this.fullDiff);
    this.state.chat.push(msg);
    this.saveState();
    this.broadcast({ type: 'chat', message: msg });
    return msg;
  }

  systemMessage(text: string) {
    const msg: ChatMessage = { id: randomUUID(), role: 'system', text, ts: Date.now() };
    this.state.chat.push(msg);
    this.saveState();
    this.broadcast({ type: 'chat', message: msg });
  }

  private flushPending() {
    if (this.pending.length === 0 || this.waiters.length === 0) return;
    const w = this.waiters.shift()!;
    const msgs = this.pending;
    this.pending = [];
    w(msgs);
    this.broadcastAgent();
  }

  waitForMessages(timeoutMs: number): Promise<ChatMessage[]> {
    return new Promise((resolve) => {
      let done = false;
      const waiter = (msgs: ChatMessage[]) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(msgs);
      };
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        this.waiters = this.waiters.filter((w) => w !== waiter);
        this.broadcastAgent();
        resolve([]);
      }, timeoutMs);
      this.waiters.push(waiter);
      this.broadcastAgent();
      this.flushPending();
    });
  }

  agentConnected(id: string) {
    this.agentSessions.add(id);
    this.broadcastAgent();
  }

  agentDisconnected(id: string) {
    this.agentSessions.delete(id);
    this.broadcastAgent();
  }

  agentStatus(): AgentStatus {
    return { connected: this.agentSessions.size, listening: this.waiters.length > 0 };
  }

  private broadcastAgent() {
    this.broadcast({ type: 'agent', status: this.agentStatus() });
  }

  /** Renders the chips of a message as text for the agent. */
  async resolveChips(chips: Chip[] | undefined): Promise<string> {
    if (!chips || chips.length === 0) return '';
    const parts: string[] = [];
    for (const c of chips) {
      switch (c.kind) {
        case 'block': {
          const b = findBlock(this.doc.blocks, c.blockId);
          if (!b) {
            parts.push(`### Review-doc block ${c.blockId}\n(no longer present in the document)`);
            break;
          }
          parts.push(`### Review-doc block "${c.label}" (id: ${b.id}, type: ${b.type})\n\`\`\`markdown\n${b.src}\n\`\`\``);
          break;
        }
        case 'hunk': {
          let h = findHunk(this.fullDiff, c.hunkId);
          if (!h) {
            for (const p of this.diffCache.values()) {
              h = findHunk(await p, c.hunkId);
              if (h) break;
            }
          }
          parts.push(h ? `### Diff hunk in ${h.file}\n\`\`\`\n${hunkToText(h)}\n\`\`\`` : `### Diff hunk ${c.hunkId} in ${c.file}\n(not found)`);
          break;
        }
        case 'lines': {
          const text = await this.rawFileText(c.file, c.rev);
          if (text === null) {
            parts.push(`### ${c.file} lines ${c.from}-${c.to} at ${c.rev}\n(file not found)`);
            break;
          }
          const lines = splitLines(text)
            .slice(c.from - 1, c.to)
            .map((l, i) => `${String(c.from + i).padStart(5)} ${l}`);
          parts.push(`### ${c.file} lines ${c.from}-${c.to} (revision ${this.describeRev(c.rev)})\n\`\`\`\n${lines.join('\n')}\n\`\`\``);
          break;
        }
        case 'file':
          parts.push(`### File ${c.file} (revision ${this.describeRev(c.rev)})\nRead it from the repository at ${this.contentRepo}: \`git show ${c.rev}:${c.file}\``);
          break;
        case 'comment':
          parts.push(`### Comment${c.file ? ` on ${c.file}${c.line ? `:${c.line}` : ''}` : ''}\n${c.text}`);
          break;
      }
    }
    return parts.join('\n\n');
  }

  describeRev(rev: string): string {
    if (rev === this.info.headSha) return `${rev.slice(0, 10)} = ${this.info.head}`;
    if (rev === this.info.baseSha) return `${rev.slice(0, 10)} = ${this.info.base}`;
    return rev;
  }

  // ---- broadcast ----

  subscribe(fn: (msg: ServerMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  broadcast(msg: ServerMessage) {
    for (const l of this.listeners) {
      try {
        l(msg);
      } catch (e) {
        console.error(e);
      }
    }
  }
}
