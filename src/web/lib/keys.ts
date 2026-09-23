// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

// Global keyboard shortcuts.

import type { Block, ChangeBlock } from '../../shared/types.ts';
import { app, hunkById, openFile, toast } from './store.svelte.ts';
import {
  clearSelection,
  commentOnSelection,
  focusHunk,
  hunkChip,
  selectionChip,
  toggleChangeReviewed,
  toggleHunkReviewed,
  scrollToBlock,
} from './actions.ts';

function hunkElements(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.doc [data-hunk]')];
}

/** The hunk closest to the top third of the viewport. */
function nearestHunkIndex(els: HTMLElement[]): number {
  const target = window.innerHeight / 3;
  let best = -1;
  let bestDist = Infinity;
  els.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const dist = r.top <= target && r.bottom >= target ? 0 : Math.min(Math.abs(r.top - target), Math.abs(r.bottom - target));
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  return best;
}

function moveHunk(delta: number) {
  const els = hunkElements();
  if (els.length === 0) return;
  let idx = app.focusedHunk ? els.findIndex((e) => e.dataset.hunk === app.focusedHunk) : -1;
  if (idx < 0) {
    idx = nearestHunkIndex(els);
    // If nothing was focused, focus the nearest one first without moving.
    if (idx >= 0 && app.focusedHunk === null) {
      focusHunk(els[idx].dataset.hunk!);
      return;
    }
  }
  const next = Math.max(0, Math.min(els.length - 1, idx + delta));
  focusHunk(els[next].dataset.hunk!);
}

function changeBlocks(): ChangeBlock[] {
  const out: ChangeBlock[] = [];
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if (b.type === 'change') out.push(b);
      if ('blocks' in b) walk(b.blocks);
    }
  };
  walk(app.doc?.blocks ?? []);
  return out;
}

function moveChange(delta: number) {
  const els = [...document.querySelectorAll<HTMLElement>('.doc [data-block-type="change"]')];
  if (els.length === 0) return;
  const target = window.innerHeight / 3;
  let idx = -1;
  els.forEach((el, i) => {
    if (el.getBoundingClientRect().top <= target + 1) idx = i;
  });
  const next = Math.max(0, Math.min(els.length - 1, idx + delta));
  const el = els[next];
  el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const firstHunk = el.querySelector<HTMLElement>('[data-hunk]');
  if (firstHunk) app.focusedHunk = firstHunk.dataset.hunk!;
}

function enclosingChange(hunkId: string): ChangeBlock | undefined {
  return changeBlocks().find((c) => c.hunkIds.includes(hunkId));
}

export function installKeys(focusChat: () => void) {
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (e.key === 'Escape') {
      if (app.showHelp) app.showHelp = false;
      else if (app.showReview) app.showReview = false;
      else if (app.commentTarget) app.commentTarget = null;
      else if (app.selection) clearSelection();
      else if (typing) t?.blur();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const focused = app.focusedHunk ? hunkById(app.focusedHunk) : undefined;
    switch (e.key) {
      case 'j':
        moveHunk(1);
        break;
      case 'k':
        moveHunk(-1);
        break;
      case 'n':
        moveChange(1);
        break;
      case 'p':
        moveChange(-1);
        break;
      case 'x':
        if (focused) toggleHunkReviewed(focused.id);
        break;
      case 'r': {
        if (!focused) break;
        const c = enclosingChange(focused.id);
        if (c) toggleChangeReviewed(c);
        else toast('The focused hunk is not part of a change block');
        break;
      }
      case 'a':
        if (app.selection) selectionChip(app.selection);
        else if (focused) hunkChip(focused);
        break;
      case 'c':
        if (app.selection) commentOnSelection();
        else toast('Select lines first (click a line number)');
        break;
      case 'f':
        if (focused) openFile(focused.file, focused.newStart || 1);
        break;
      case '/':
        e.preventDefault();
        app.prefs.sideTab = 'chat';
        setTimeout(focusChat, 0);
        break;
      case 's':
        app.prefs.view = app.prefs.view === 'split' ? 'unified' : 'split';
        break;
      case 'w':
        app.prefs.hideWs = !app.prefs.hideWs;
        break;
      case 'm':
        app.prefs.hideMoved = !app.prefs.hideMoved;
        break;
      case 't':
        app.prefs.sideTab = app.prefs.sideTab === 'chat' ? 'file' : 'chat';
        break;
      case 'u':
        scrollToBlock('uncovered');
        break;
      case '?':
        app.showHelp = !app.showHelp;
        break;
      default:
        return;
    }
    e.preventDefault();
  });
}
