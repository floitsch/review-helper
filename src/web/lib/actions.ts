// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

// User actions shared by several components.

import type { ChangeBlock, Hunk } from '../../shared/types.ts';
import { api } from './api.ts';
import { addChip, app, hunkById, toast, type LineSelection } from './store.svelte.ts';

export function changeReviewedState(b: ChangeBlock): 'yes' | 'no' | 'stale' {
  const v = app.state.reviewedChanges[b.id];
  if (v === undefined) return 'no';
  return v === b.hunkIds.join(',') ? 'yes' : 'stale';
}

export async function toggleChangeReviewed(b: ChangeBlock) {
  const map = { ...app.state.reviewedChanges };
  const hunks = { ...app.state.reviewedHunks };
  if (changeReviewedState(b) === 'yes') {
    delete map[b.id];
    for (const id of b.hunkIds) delete hunks[id];
  } else {
    map[b.id] = b.hunkIds.join(',');
    for (const id of b.hunkIds) hunks[id] = true;
  }
  app.state.reviewedChanges = map;
  app.state.reviewedHunks = hunks;
  await api.state({ reviewedChanges: map, reviewedHunks: hunks });
}

export async function toggleHunkReviewed(id: string) {
  const hunks = { ...app.state.reviewedHunks };
  if (hunks[id]) delete hunks[id];
  else hunks[id] = true;
  app.state.reviewedHunks = hunks;
  await api.state({ reviewedHunks: hunks });
}

export function hunkChip(h: Hunk) {
  addChip({ kind: 'hunk', label: `${shortPath(h.file)} @${h.newStart}`, hunkId: h.id, file: h.file });
}

export function shortPath(p: string): string {
  const parts = p.split('/');
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p;
}

export function selectionChip(sel: LineSelection) {
  const label = `${shortPath(sel.file)}:${sel.from === sel.to ? sel.from : `${sel.from}-${sel.to}`}${sel.side === 'old' ? ' (old)' : ''}`;
  addChip({ kind: 'lines', label, file: sel.file, rev: sel.rev, from: sel.from, to: sel.to });
}

/** Click on a line number: start or extend a selection. */
export function selectLine(e: MouseEvent, sel: Omit<LineSelection, 'to'> & { to?: number }) {
  const cur = app.selection;
  const line = sel.from;
  if (e.shiftKey && cur && cur.file === sel.file && cur.side === sel.side && cur.rev === sel.rev) {
    app.selection = { ...cur, from: Math.min(cur.from, line), to: Math.max(cur.to, line) };
    return;
  }
  if (cur && cur.file === sel.file && cur.side === sel.side && cur.from === line && cur.to === line && cur.rev === sel.rev) {
    app.selection = null;
    return;
  }
  app.selection = { ...sel, to: sel.to ?? line };
}

export function clearSelection() {
  app.selection = null;
}

export function commentOnSelection() {
  const sel = app.selection;
  if (!sel) return;
  const s = app.session;
  if (!s) return;
  if (sel.rev !== s.headSha && sel.rev !== s.baseSha) {
    toast('Comments can only be attached to the head or base revision', 'error');
    return;
  }
  app.commentTarget = {
    path: sel.file,
    side: sel.side === 'new' ? 'RIGHT' : 'LEFT',
    line: sel.to,
    startLine: sel.from !== sel.to ? sel.from : undefined,
  };
  app.selection = null;
}

export function focusHunk(id: string, scroll = true) {
  app.focusedHunk = id;
  if (scroll) {
    const el = document.querySelector(`[data-hunk="${id}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

export function scrollToBlock(id: string) {
  const el = document.querySelector(`[data-block="${id}"]`);
  el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  el?.classList.add('flash');
  setTimeout(() => el?.classList.remove('flash'), 1500);
}

export function scrollToLine(hunkId: string, side: 'new' | 'old', line: number) {
  const el = document.querySelector(`[data-hunk="${hunkId}"] tr[data-${side}="${line}"]`);
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('target');
    setTimeout(() => el.classList.remove('target'), 1600);
    return true;
  }
  return false;
}

export function hunkLabel(id: string): string {
  const h = hunkById(id);
  return h ? `${shortPath(h.file)} @${h.newStart}` : id;
}

export async function sendChat(text: string) {
  const chips = app.chips;
  app.chips = [];
  try {
    await api.chat(text, chips);
    if (!app.agent.listening && app.agent.connected === 0) toast('No agent is connected; the message is queued.', 'error');
  } catch (e) {
    toast(String(e), 'error');
  }
}
