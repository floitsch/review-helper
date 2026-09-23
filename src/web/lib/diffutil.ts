// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

import { diffWordsWithSpace } from 'diff';
import type { DiffLine, Hunk, Token } from '../../shared/types.ts';
import { changeRuns } from '../../shared/diffutil.ts';

/** A token with an extra flag for intra-line changes. */
export interface RenderToken extends Token {
  chg?: boolean;
}

/** Character ranges [start, end) of `text` that differ from the paired line. */
function changedRanges(a: string, b: string, side: 'old' | 'new'): [number, number][] {
  const parts = diffWordsWithSpace(a, b);
  const out: [number, number][] = [];
  let pos = 0;
  for (const p of parts) {
    const mine = side === 'old' ? !p.added : !p.removed;
    if (!mine) continue;
    const len = p.value.length;
    if (side === 'old' ? p.removed : p.added) out.push([pos, pos + len]);
    pos += len;
  }
  return out;
}

function applyRanges(tokens: Token[], ranges: [number, number][]): RenderToken[] {
  if (ranges.length === 0) return tokens;
  const out: RenderToken[] = [];
  let pos = 0;
  let ri = 0;
  for (const t of tokens) {
    let start = pos;
    const end = pos + t.t.length;
    while (start < end) {
      while (ri < ranges.length && ranges[ri][1] <= start) ri++;
      if (ri >= ranges.length || ranges[ri][0] >= end) {
        out.push({ ...t, t: t.t.slice(start - pos, end - pos) });
        start = end;
        break;
      }
      const [rs, re] = ranges[ri];
      if (rs > start) {
        out.push({ ...t, t: t.t.slice(start - pos, rs - pos) });
        start = rs;
      }
      const stop = Math.min(re, end);
      out.push({ ...t, t: t.t.slice(start - pos, stop - pos), chg: true });
      start = stop;
    }
    pos = end;
  }
  return out;
}

export function tokensOf(line: DiffLine): Token[] {
  return line.tokens && line.tokens.length > 0 ? line.tokens : [{ t: line.text }];
}

/** A row of the rendered diff. In unified mode exactly one of old/new is set (or both for context). */
export interface Row {
  key: string;
  old?: DiffLine;
  new?: DiffLine;
  oldTokens?: RenderToken[];
  newTokens?: RenderToken[];
  /** Number of hidden rows this placeholder stands for. */
  collapsed?: number;
  collapsedKind?: 'ws' | 'moved' | 'focus';
}

export interface RowOptions {
  split: boolean;
  wordDiff: boolean;
  hideWs: boolean;
  hideMoved: boolean;
}

/** Computes the rows for a hunk, pairing deleted/added lines for word diffs and split view. */
export function hunkRows(h: Hunk, o: RowOptions): Row[] {
  const rows: Row[] = [];
  const lines = h.lines;
  const runs = changeRuns(lines);
  let runIdx = 0;
  let i = 0;
  const key = (l: DiffLine) => `${l.kind}${l.oldNo ?? ''}:${l.newNo ?? ''}`;
  const hidden = (l: DiffLine) => (o.hideWs && l.ws) || (o.hideMoved && !!l.moved);

  const pushHidden = (ls: DiffLine[]) => {
    const kind: 'ws' | 'moved' = ls.every((l) => l.ws) ? 'ws' : 'moved';
    const last = rows[rows.length - 1];
    if (last && last.collapsed !== undefined && last.collapsedKind === kind) last.collapsed += ls.length;
    else rows.push({ key: `hid-${key(ls[0])}`, collapsed: ls.length, collapsedKind: kind });
  };

  while (i < lines.length) {
    const l = lines[i];
    if (l.kind === 'ctx') {
      rows.push({ key: key(l), old: l, new: l, oldTokens: tokensOf(l), newTokens: tokensOf(l) });
      i++;
      continue;
    }
    const r = runs[runIdx++];
    const dels = lines.slice(r.delStart, r.delEnd);
    const adds = lines.slice(r.addStart, r.addEnd);
    i = r.addEnd;
    const n = Math.max(dels.length, adds.length);
    // Pair by index for word diff when both sides exist.
    const pairs: { d?: DiffLine; a?: DiffLine }[] = [];
    if (o.split) {
      for (let k = 0; k < n; k++) pairs.push({ d: dels[k], a: adds[k] });
    } else {
      for (const d of dels) pairs.push({ d });
      for (const a of adds) pairs.push({ a });
    }
    const wordPairs = dels.length === adds.length || (dels.length > 0 && adds.length > 0);
    const rangesFor = (d: DiffLine, a: DiffLine, side: 'old' | 'new') =>
      o.wordDiff && !d.ws && !a.ws ? changedRanges(d.text, a.text, side) : [];

    const hiddenBuf: DiffLine[] = [];
    const flushHidden = () => {
      if (hiddenBuf.length > 0) pushHidden(hiddenBuf.splice(0));
    };

    for (const p of pairs) {
      const dl = p.d;
      const al = p.a;
      const dHidden = dl ? hidden(dl) : true;
      const aHidden = al ? hidden(al) : true;
      if (dHidden && aHidden) {
        if (dl) hiddenBuf.push(dl);
        if (al) hiddenBuf.push(al);
        continue;
      }
      flushHidden();
      const row: Row = { key: key(dl ?? al!) };
      if (dl && !dHidden) {
        row.old = dl;
        const pair = o.split ? al : adds[dels.indexOf(dl)];
        row.oldTokens = wordPairs && pair ? applyRanges(tokensOf(dl), rangesFor(dl, pair, 'old')) : tokensOf(dl);
      }
      if (al && !aHidden) {
        row.new = al;
        const pair = o.split ? dl : dels[adds.indexOf(al)];
        row.newTokens = wordPairs && pair ? applyRanges(tokensOf(al), rangesFor(pair, al, 'new')) : tokensOf(al);
      }
      rows.push(row);
    }
    flushHidden();
  }
  return rows;
}

export function hunkStats(h: Hunk): { adds: number; dels: number } {
  let adds = 0;
  let dels = 0;
  for (const l of h.lines) {
    if (l.kind === 'add') adds++;
    else if (l.kind === 'del') dels++;
  }
  return { adds, dels };
}

export function hunkRangeLabel(h: Hunk): string {
  if (h.newLines === 0) return `deleted old ${h.oldStart}-${h.oldStart + h.oldLines - 1}`;
  return `${h.newStart}-${h.newStart + h.newLines - 1}`;
}
