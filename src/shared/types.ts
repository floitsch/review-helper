// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

// Types shared between the gateway and the web app.

export interface CommitInfo {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
}

export interface PrInfo {
  number: number;
  title: string;
  body: string;
  url: string;
  author: string;
  baseRefName: string;
  headRefName: string;
  state: string;
  repo: string; // owner/name
}

export interface SessionInfo {
  repo: string;
  repoName: string;
  base: string;
  baseSha: string;
  head: string;
  headSha: string;
  commits: CommitInfo[]; // oldest first, base..head
  pr?: PrInfo;
  docPath: string;
  port: number;
  worktree?: boolean;
  contentRepo: string; // repository containing the immutable base/head objects
}

/** A highlighted token. `l`/`d` are the colors for the light/dark theme. */
export interface Token {
  t: string;
  l?: string;
  d?: string;
  /** font style bits: 1=italic 2=bold 4=underline */
  f?: number;
}

export interface DiffLine {
  kind: 'ctx' | 'add' | 'del';
  oldNo?: number;
  newNo?: number;
  text: string;
  tokens?: Token[];
  /** Whitespace-only change (the paired line differs only in whitespace). */
  ws?: boolean;
  /** This line was moved: 'to' = the deleted line reappears elsewhere, 'from' = the added line came from elsewhere. */
  moved?: 'to' | 'from';
  movedRef?: { file: string; line: number };
}

export interface Hunk {
  /** Stable id: hash of file path + changed content. */
  id: string;
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
  /** All changed lines are whitespace-only changes. */
  wsOnly: boolean;
  /** All changed lines are moves (or whitespace-only). */
  movedOnly: boolean;
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  binary?: boolean;
  lang?: string;
  hunks: Hunk[];
}

export interface DiffSet {
  from: string;
  to: string;
  files: FileDiff[];
}

export interface HighlightedFile {
  path: string;
  rev: string;
  lang?: string;
  lines: Token[][];
  /** Line numbers (1-based) that were added/changed in the base..head diff. */
  changed?: number[];
  binary?: boolean;
}

// ---- Review document ----

export type CalloutKind = 'note' | 'warning' | 'concern' | 'context' | 'tip';

export interface Annotation {
  side: 'new' | 'old';
  line: number;
  endLine?: number;
  html: string;
  text: string;
}

interface BlockBase {
  id: string;
  /** Markdown source of this block, used as chat context. */
  src: string;
}

export interface SectionBlock extends BlockBase {
  type: 'section';
  level: number;
  title: string;
  titleHtml: string;
  blocks: Block[];
}

export interface ChangeBlock extends BlockBase {
  type: 'change';
  title: string;
  titleHtml: string;
  blocks: Block[];
  /** Hunks referenced by diff blocks inside this change. */
  hunkIds: string[];
}

export interface CalloutBlock extends BlockBase {
  type: 'callout';
  kind: CalloutKind;
  title?: string;
  blocks: Block[];
}

export interface ExplainBlock extends BlockBase {
  type: 'explain';
  title?: string;
  blocks: Block[];
}

export interface DiffBlock extends BlockBase {
  type: 'diff';
  file: string;
  /** Line range (inclusive) in the new file, or in the old file when `old` is set. */
  lines?: [number, number];
  old?: boolean;
  view?: 'split' | 'unified';
  ws?: 'ignore' | 'show';
  /** Whether to show the explanation body expanded by default. */
  open?: boolean;
  title?: string;
  hunkIds: string[];
  annotations: Annotation[];
  /** Explanation body (line-by-line), shown collapsed. */
  blocks: Block[];
  error?: string;
}

export interface CodeBlock extends BlockBase {
  type: 'code';
  lang?: string;
  code: string;
  tokens?: Token[][];
  /** The file this snippet comes from, if given. */
  file?: string;
  startLine?: number;
}

export interface HtmlBlock extends BlockBase {
  type: 'html';
  html: string;
  text: string;
}

export type Block = SectionBlock | ChangeBlock | CalloutBlock | ExplainBlock | DiffBlock | CodeBlock | HtmlBlock;

export interface ReviewDoc {
  blocks: Block[];
  warnings: string[];
  /** Hunks of base..head not referenced by any diff block, grouped by file. */
  uncovered: { file: string; hunkIds: string[] }[];
  mtime: number;
  exists: boolean;
  /** Head sha the document was written for (from front matter `head:`), if any. */
  head?: string;
}

// ---- Chat ----

export type Chip =
  | { id: string; kind: 'block'; label: string; blockId: string }
  | { id: string; kind: 'hunk'; label: string; hunkId: string; file: string }
  | { id: string; kind: 'lines'; label: string; file: string; rev: string; from: number; to: number }
  | { id: string; kind: 'file'; label: string; file: string; rev: string }
  | { id: string; kind: 'comment'; label: string; text: string; file?: string; line?: number };

/** Distributive Omit that keeps union members apart. */
export type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  blocks?: Block[];
  chips?: Chip[];
  ts: number;
}

export interface AgentStatus {
  connected: number;
  listening: boolean;
}

// ---- Review comments ----

export interface DraftComment {
  id: string;
  path: string;
  line: number;
  side: 'RIGHT' | 'LEFT';
  startLine?: number;
  body: string;
  ts: number;
}

export interface PrThread {
  id: string;
  path: string;
  line: number | null;
  startLine?: number | null;
  side: 'RIGHT' | 'LEFT';
  resolved: boolean;
  outdated: boolean;
  comments: PrComment[];
}

export interface PrComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url: string;
}

export interface PrConversation {
  threads: PrThread[];
  reviews: { author: string; body: string; state: string; submittedAt: string; url: string }[];
  comments: PrComment[];
}

// ---- Persisted state ----

export interface ReviewState {
  /** change id -> joined hunk ids at the time it was marked reviewed. */
  reviewedChanges: Record<string, string>;
  reviewedHunks: Record<string, true>;
  lastReviewedSha?: string;
  drafts: DraftComment[];
  chat: ChatMessage[];
}

// ---- WebSocket protocol (server -> client) ----

export type ServerMessage =
  | { type: 'session'; session: SessionInfo }
  | { type: 'doc'; doc: ReviewDoc }
  | { type: 'state'; state: ReviewState }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'agent'; status: AgentStatus }
  | { type: 'pr'; conversation: PrConversation }
  | { type: 'toast'; level: 'info' | 'error'; text: string };
