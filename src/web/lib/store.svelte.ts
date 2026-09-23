// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

import type {
  AgentStatus,
  ChatMessage,
  Chip,
  DistributiveOmit,
  DiffSet,
  Hunk,
  PrConversation,
  ReviewDoc,
  ReviewState,
  SessionInfo,
} from '../../shared/types.ts';

export interface Prefs {
  view: 'unified' | 'split';
  hideWs: boolean;
  hideMoved: boolean;
  wordDiff: boolean;
  annotations: 'gutter' | 'inline' | 'off';
  theme: 'auto' | 'light' | 'dark';
  fileWidth: number;
  chatWidth: number;
  sideTab: 'file' | 'chat';
  showResolved: boolean;
}

export interface Range {
  from: string;
  to: string;
  label: string;
}

export interface FileView {
  path: string;
  rev: string;
  line?: number;
  /** Bumped to force a re-scroll even if line is unchanged. */
  nonce: number;
}

export interface LineSelection {
  file: string;
  rev: string;
  side: 'new' | 'old';
  from: number;
  to: number;
  /** Where the selection lives, to position the action bar. */
  origin: 'diff' | 'file';
  hunkId?: string;
}

export interface CommentTarget {
  path: string;
  side: 'RIGHT' | 'LEFT';
  line: number;
  startLine?: number;
  draftId?: string;
}

export interface Toast {
  id: number;
  level: 'info' | 'error';
  text: string;
}

const PREFS_KEY = 'review-helper.prefs';

function loadPrefs(): Prefs {
  const defaults: Prefs = {
    view: 'unified',
    hideWs: true,
    hideMoved: true,
    wordDiff: true,
    annotations: 'gutter',
    theme: 'auto',
    fileWidth: 560,
    chatWidth: 420,
    sideTab: 'chat',
    showResolved: false,
  };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return defaults;
}

export const app = $state({
  connected: false,
  session: null as SessionInfo | null,
  doc: null as ReviewDoc | null,
  state: { reviewedChanges: {}, reviewedHunks: {}, drafts: [], chat: [] } as ReviewState,
  chat: [] as ChatMessage[],
  agent: { connected: 0, listening: false } as AgentStatus,
  pr: null as PrConversation | null,
  fullDiff: null as DiffSet | null,
  rangeDiff: null as DiffSet | null,
  /** Diff between the head the document was written for and the current head. */
  staleDiff: null as DiffSet | null,
  range: null as Range | null,
  prefs: loadPrefs(),
  chips: [] as Chip[],
  fileView: null as FileView | null,
  selection: null as LineSelection | null,
  commentTarget: null as CommentTarget | null,
  focusedHunk: null as string | null,
  toasts: [] as Toast[],
  showHelp: false,
  showReview: false,
  files: null as Set<string> | null,
});

$effect.root(() => {
  $effect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(app.prefs));
    } catch {
      // ignore
    }
    const t = app.prefs.theme;
    document.documentElement.dataset.theme = t === 'auto' ? '' : t;
  });
});

let toastId = 0;
export function toast(text: string, level: 'info' | 'error' = 'info') {
  const id = ++toastId;
  app.toasts.push({ id, level, text });
  setTimeout(() => {
    app.toasts = app.toasts.filter((t) => t.id !== id);
  }, level === 'error' ? 8000 : 3500);
}

/** All hunks known to the client, by id. */
export function hunkById(id: string): Hunk | undefined {
  for (const set of [app.rangeDiff, app.fullDiff]) {
    if (!set) continue;
    for (const f of set.files) for (const h of f.hunks) if (h.id === id) return h;
  }
  return undefined;
}

export function isFullRange(): boolean {
  return !!app.session && !!app.range && app.range.from === app.session.baseSha && app.range.to === app.session.headSha;
}

let chipId = 0;
export function addChip(chip: DistributiveOmit<Chip, 'id'>) {
  // Avoid duplicates.
  const key = JSON.stringify({ ...chip, label: undefined });
  if (app.chips.some((c) => JSON.stringify({ ...c, id: undefined, label: undefined }) === key)) {
    toast('Already attached');
    return;
  }
  app.chips.push({ ...chip, id: String(++chipId) } as Chip);
  toast(`Attached: ${chip.label}`);
}

export function openFile(path: string, line?: number, rev?: string) {
  const r = rev ?? app.session?.headSha ?? 'HEAD';
  app.fileView = { path, rev: r, line, nonce: (app.fileView?.nonce ?? 0) + 1 };
  app.prefs.sideTab = 'file';
}

export function revLabel(rev: string): string {
  const s = app.session;
  if (!s) return rev.slice(0, 8);
  if (rev === s.headSha) return 'head';
  if (rev === s.baseSha) return 'base';
  return rev.slice(0, 8);
}
