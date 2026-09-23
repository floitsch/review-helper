// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

import { createHash } from 'node:crypto';
import type { DiffLine, DiffSet, FileDiff, Hunk } from '../shared/types.ts';
import { changeRuns } from '../shared/diffutil.ts';
export { changeRuns, hunksForRange } from '../shared/diffutil.ts';

/** Parses the output of `git diff --no-prefix`. */
export function parseDiff(raw: string, from: string, to: string): DiffSet {
  const files: FileDiff[] = [];
  const lines = raw.split('\n');
  let i = 0;
  let cur: FileDiff | null = null;
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  function finishHunk() {
    if (hunk && cur) cur.hunks.push(hunk);
    hunk = null;
  }

  while (i < lines.length) {
    const line = lines[i++];
    if (line.startsWith('diff --git ')) {
      finishHunk();
      cur = { path: '', status: 'modified', hunks: [] };
      files.push(cur);
      // "diff --git a b" without prefixes. Paths may contain spaces; we prefer the ---/+++ lines.
      const m = /^diff --git (.*) (.*)$/.exec(line);
      if (m) {
        cur.path = m[2];
        if (m[1] !== m[2]) cur.oldPath = m[1];
      }
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('new file mode')) {
      cur.status = 'added';
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      cur.status = 'deleted';
      continue;
    }
    if (line.startsWith('rename from ')) {
      cur.oldPath = line.slice('rename from '.length);
      cur.status = 'renamed';
      continue;
    }
    if (line.startsWith('rename to ')) {
      cur.path = line.slice('rename to '.length);
      continue;
    }
    if (line.startsWith('Binary files')) {
      cur.binary = true;
      continue;
    }
    if (line.startsWith('--- ')) {
      const p = line.slice(4);
      if (p !== '/dev/null' && cur.status !== 'renamed') cur.oldPath = p === cur.path ? undefined : p;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4);
      if (p !== '/dev/null') cur.path = p;
      continue;
    }
    if (line.startsWith('@@ ')) {
      finishHunk();
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);
      if (!m) continue;
      hunk = {
        id: '',
        file: cur.path,
        oldStart: +m[1],
        oldLines: m[2] === undefined ? 1 : +m[2],
        newStart: +m[3],
        newLines: m[4] === undefined ? 1 : +m[4],
        header: m[5] ?? '',
        lines: [],
        wsOnly: false,
        movedOnly: false,
      };
      oldNo = hunk.oldStart;
      newNo = hunk.newStart;
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    const c = line[0];
    const text = line.slice(1);
    if (c === '+') {
      hunk.lines.push({ kind: 'add', newNo: newNo++, text });
    } else if (c === '-') {
      hunk.lines.push({ kind: 'del', oldNo: oldNo++, text });
    } else if (c === ' ' || line === '') {
      hunk.lines.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text });
    }
  }
  finishHunk();

  for (const f of files) {
    for (const h of f.hunks) {
      h.file = f.path;
      h.id = hunkId(f.path, h);
    }
  }
  const set: DiffSet = { from, to, files };
  classifyWhitespace(set);
  detectMoves(set);
  for (const f of set.files) {
    for (const h of f.hunks) {
      const changed = h.lines.filter((l) => l.kind !== 'ctx');
      h.wsOnly = changed.length > 0 && changed.every((l) => l.ws);
      h.movedOnly = changed.length > 0 && changed.every((l) => l.ws || l.moved);
    }
  }
  return set;
}

function hunkId(path: string, h: Hunk): string {
  const hash = createHash('sha1');
  hash.update(path);
  hash.update('\0');
  for (const l of h.lines) {
    if (l.kind === 'ctx') continue;
    hash.update(l.kind === 'add' ? '+' : '-');
    hash.update(l.text);
    hash.update('\n');
  }
  return hash.digest('hex').slice(0, 12);
}

function stripWs(s: string): string {
  return s.replace(/\s+/g, '');
}

function classifyWhitespace(set: DiffSet) {
  for (const f of set.files) {
    for (const h of f.hunks) {
      for (const r of changeRuns(h.lines)) {
        // Pair each added line with the first unpaired deleted line of the run that
        // has the same non-whitespace content.
        const dels = [];
        for (let i = r.delStart; i < r.delEnd; i++) dels.push(h.lines[i]);
        for (let i = r.addStart; i < r.addEnd; i++) {
          const a = h.lines[i];
          const key = stripWs(a.text);
          if (key === '') continue;
          const idx = dels.findIndex((d) => stripWs(d.text) === key);
          if (idx < 0) continue;
          dels[idx].ws = true;
          a.ws = true;
          dels.splice(idx, 1);
        }
      }
    }
  }
}

interface Pos {
  file: string;
  hunk: Hunk;
  idx: number;
  norm: string;
}

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

function significant(norm: string): boolean {
  return norm.length >= 8 && !/^[\s{}()\[\];,]*$/.test(norm);
}

/**
 * Detects blocks of lines that were deleted in one place and added in another
 * (possibly in another file). Marks them so the viewer can de-emphasize them.
 */
function detectMoves(set: DiffSet) {
  const dels: Pos[] = [];
  const adds: Pos[] = [];
  for (const f of set.files) {
    for (const h of f.hunks) {
      h.lines.forEach((l, idx) => {
        if (l.kind === 'del') dels.push({ file: f.path, hunk: h, idx, norm: normalize(l.text) });
        else if (l.kind === 'add') adds.push({ file: f.path, hunk: h, idx, norm: normalize(l.text) });
      });
    }
  }
  if (dels.length === 0 || adds.length === 0) return;
  const byNorm = new Map<string, Pos[]>();
  for (const d of dels) {
    if (d.norm === '') continue;
    let list = byNorm.get(d.norm);
    if (!list) byNorm.set(d.norm, (list = []));
    list.push(d);
  }
  const usedDel = new Set<DiffLine>();
  const usedAdd = new Set<DiffLine>();

  // Consecutive added lines within the same hunk.
  function nextAdd(p: Pos): Pos | null {
    const l = p.hunk.lines[p.idx + 1];
    if (!l || l.kind !== 'add') return null;
    return { file: p.file, hunk: p.hunk, idx: p.idx + 1, norm: normalize(l.text) };
  }
  function nextDel(p: Pos): Pos | null {
    const l = p.hunk.lines[p.idx + 1];
    if (!l || l.kind !== 'del') return null;
    return { file: p.file, hunk: p.hunk, idx: p.idx + 1, norm: normalize(l.text) };
  }

  for (let ai = 0; ai < adds.length; ai++) {
    const a = adds[ai];
    const aLine = a.hunk.lines[a.idx];
    if (usedAdd.has(aLine) || a.norm === '') continue;
    const candidates = byNorm.get(a.norm);
    if (!candidates) continue;
    let best: { d: Pos; len: number; sig: number } | null = null;
    for (const d of candidates) {
      if (usedDel.has(d.hunk.lines[d.idx])) continue;
      // Do not treat a del/add pair inside the same hunk at the same spot as a move;
      // that is just an unchanged (or whitespace-changed) line.
      let len = 0;
      let sig = 0;
      let pa: Pos | null = a;
      let pd: Pos | null = d;
      while (pa && pd && pa.norm === pd.norm && !usedAdd.has(pa.hunk.lines[pa.idx]) && !usedDel.has(pd.hunk.lines[pd.idx])) {
        len++;
        if (significant(pa.norm)) sig++;
        pa = nextAdd(pa);
        pd = nextDel(pd);
      }
      if (!best || len > best.len) best = { d, len, sig };
    }
    if (!best) continue;
    const { d, len, sig } = best;
    const sameHunk = d.hunk === a.hunk;
    const unique = candidates.length === 1 && adds.filter((x) => x.norm === a.norm).length === 1;
    const ok = (len >= 3 && sig >= 2) || (len >= 2 && sig >= 2 && !sameHunk) || (!sameHunk && unique && a.norm.length >= 40);
    if (!ok) continue;
    if (sameHunk) {
      // Inside one hunk, only count it as a move if the lines are not the whitespace
      // pairs already classified.
      const anyWs = (() => {
        for (let k = 0; k < len; k++) if (a.hunk.lines[a.idx + k].ws || d.hunk.lines[d.idx + k].ws) return true;
        return false;
      })();
      if (anyWs) continue;
    }
    for (let k = 0; k < len; k++) {
      const al = a.hunk.lines[a.idx + k];
      const dl = d.hunk.lines[d.idx + k];
      al.moved = 'from';
      al.movedRef = { file: d.file, line: dl.oldNo! };
      dl.moved = 'to';
      dl.movedRef = { file: a.file, line: al.newNo! };
      usedAdd.add(al);
      usedDel.add(dl);
    }
  }
}

/** Renders a hunk as unified diff text with line numbers, for use as chat context. */
export function hunkToText(h: Hunk): string {
  const out: string[] = [];
  out.push(`${h.file} @@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@ ${h.header}`);
  for (const l of h.lines) {
    const o = l.oldNo === undefined ? '' : String(l.oldNo);
    const n = l.newNo === undefined ? '' : String(l.newNo);
    const c = l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' ';
    out.push(`${o.padStart(5)} ${n.padStart(5)} ${c}${l.text}`);
  }
  return out.join('\n');
}

export function findHunk(set: DiffSet, id: string): Hunk | undefined {
  for (const f of set.files) for (const h of f.hunks) if (h.id === id) return h;
  return undefined;
}
