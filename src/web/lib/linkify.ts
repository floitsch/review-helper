// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

// Svelte action: turns `path/to/file.ext:123` in rendered HTML into links that
// open the file viewer.

import { ensureFiles } from './api.ts';
import { app, openFile } from './store.svelte.ts';

const FILE_RE = /(?<![\w/.-])((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z]{1,8})(?::(\d+))?(?![\w/])/g;

function knownFile(files: Set<string>, p: string): boolean {
  if (files.has(p)) return true;
  // Allow a path relative to the repo without leading directories only when unambiguous.
  return false;
}

function changedFiles(): Set<string> {
  const s = new Set<string>();
  for (const f of app.fullDiff?.files ?? []) {
    s.add(f.path);
    if (f.oldPath) s.add(f.oldPath);
  }
  return s;
}

function processTextNode(node: Text, files: Set<string>) {
  const text = node.data;
  FILE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let last = 0;
  const frag = document.createDocumentFragment();
  let any = false;
  while ((m = FILE_RE.exec(text))) {
    const path = m[1];
    if (!knownFile(files, path)) continue;
    any = true;
    frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    const a = document.createElement('a');
    a.className = 'file-link';
    a.href = '#';
    a.textContent = m[0];
    const line = m[2] ? +m[2] : undefined;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openFile(path, line);
    });
    frag.appendChild(a);
    last = m.index + m[0].length;
  }
  if (!any) return;
  frag.appendChild(document.createTextNode(text.slice(last)));
  node.replaceWith(frag);
}

function walk(root: Node, files: Set<string>) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || p.closest('a, pre, .no-linkify')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) nodes.push(n as Text);
  for (const t of nodes) processTextNode(t, files);
}

export function linkify(node: HTMLElement, _param?: unknown) {
  let cancelled = false;
  const run = async () => {
    const files = new Set(changedFiles());
    for (const f of await ensureFiles()) files.add(f);
    if (cancelled) return;
    walk(node, files);
  };
  run();
  return {
    update() {
      run();
    },
    destroy() {
      cancelled = true;
    },
  };
}
