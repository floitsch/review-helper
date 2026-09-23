// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

// Diff helpers shared by the gateway and the web app.

import type { DiffLine, DiffSet, Hunk } from './types.ts';

/** Groups the consecutive del/add lines of a hunk: [delStart, delEnd), [addStart, addEnd). */
export function changeRuns(lines: DiffLine[]): { delStart: number; delEnd: number; addStart: number; addEnd: number }[] {
  const runs = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind === 'ctx') {
      i++;
      continue;
    }
    const delStart = i;
    while (i < lines.length && lines[i].kind === 'del') i++;
    const delEnd = i;
    const addStart = i;
    while (i < lines.length && lines[i].kind === 'add') i++;
    const addEnd = i;
    runs.push({ delStart, delEnd, addStart, addEnd });
  }
  return runs;
}

/** Hunks of `file` whose new-side (or old-side) range overlaps [from, to]. */
export function hunksForRange(set: DiffSet, file: string, range: [number, number] | undefined, old: boolean): Hunk[] {
  const f = set.files.find((x) => x.path === file || x.oldPath === file);
  if (!f) return [];
  if (!range) return f.hunks;
  const [from, to] = range;
  return f.hunks.filter((h) => {
    // Use the changed lines (not the context) for overlap, so that context lines
    // do not make a hunk match a neighboring range.
    const nos = h.lines
      .filter((l) => (old ? l.kind === 'del' : l.kind === 'add'))
      .map((l) => (old ? l.oldNo! : l.newNo!));
    if (nos.length === 0) {
      // Pure deletion referenced by new-side lines, or vice versa: fall back to the hunk range.
      const start = old ? h.oldStart : h.newStart;
      const len = old ? h.oldLines : h.newLines;
      return start <= to && start + Math.max(len, 1) - 1 >= from;
    }
    return nos.some((n) => n >= from && n <= to);
  });
}
