// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHighlighter, bundledLanguages, type Highlighter } from 'shiki';
import type { Token } from '../shared/types.ts';

const LIGHT = 'github-light';
const DARK = 'github-dark';
const MAX_HIGHLIGHT_BYTES = 2 * 1024 * 1024;

const grammarsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'grammars');

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    const toit = { ...JSON.parse(readFileSync(path.join(grammarsDir, 'toit.tmLanguage.json'), 'utf8')), name: 'toit' };
    highlighterPromise = createHighlighter({ themes: [LIGHT, DARK], langs: [toit] });
  }
  return highlighterPromise;
}

const EXT_LANG: Record<string, string> = {
  toit: 'toit',
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  py: 'python',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  html: 'html',
  css: 'css',
  svelte: 'svelte',
  vue: 'vue',
  xml: 'xml',
  sql: 'sql',
  rb: 'ruby',
  cmake: 'cmake',
  mk: 'makefile',
  proto: 'proto',
  dockerfile: 'docker',
  txt: '',
};

const FILENAME_LANG: Record<string, string> = {
  CMakeLists_txt: 'cmake',
  Makefile: 'makefile',
  Dockerfile: 'docker',
  'package.yaml': 'yaml',
  'package.lock.yaml': 'yaml',
};

export function langForPath(p: string): string | undefined {
  const base = path.basename(p);
  if (FILENAME_LANG[base]) return FILENAME_LANG[base];
  if (base === 'CMakeLists.txt') return 'cmake';
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : '';
  if (ext in EXT_LANG) return EXT_LANG[ext] || undefined;
  if (ext in bundledLanguages) return ext;
  return undefined;
}

export function normalizeLang(lang: string | undefined): string | undefined {
  if (!lang) return undefined;
  const l = lang.toLowerCase();
  if (l === 'toit') return 'toit';
  if (l in EXT_LANG) return EXT_LANG[l] || undefined;
  if (l in bundledLanguages) return l;
  return undefined;
}

function toTokens(line: { content: string; htmlStyle?: Record<string, string> | string; fontStyle?: number }[]): Token[] {
  return line.map((t) => {
    const tok: Token = { t: t.content };
    const style = t.htmlStyle;
    if (style && typeof style === 'object') {
      if (style.color) tok.l = style.color;
      if (style['--shiki-dark']) tok.d = style['--shiki-dark'];
    }
    if (t.fontStyle) tok.f = t.fontStyle;
    return tok;
  });
}

function plainTokens(code: string): Token[][] {
  return splitLines(code).map((l) => [{ t: l }]);
}

export function splitLines(code: string): string[] {
  const lines = code.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Highlights `code` and returns one token array per line. Never throws. */
export async function highlight(code: string, lang: string | undefined): Promise<Token[][]> {
  lang = normalizeLang(lang);
  if (!lang || code.length > MAX_HIGHLIGHT_BYTES) return plainTokens(code);
  try {
    const hl = await getHighlighter();
    if (!hl.getLoadedLanguages().includes(lang)) {
      if (!(lang in bundledLanguages)) return plainTokens(code);
      await hl.loadLanguage(lang as keyof typeof bundledLanguages);
    }
    const r = hl.codeToTokens(code, { lang: lang as any, themes: { light: LIGHT, dark: DARK } });
    const lines = r.tokens.map(toTokens);
    // Shiki returns an empty trailing line for a trailing newline; align with splitLines.
    const want = splitLines(code).length;
    while (lines.length > want) lines.pop();
    while (lines.length < want) lines.push([{ t: '' }]);
    return lines;
  } catch (e) {
    console.error(`highlight failed for ${lang}: ${e}`);
    return plainTokens(code);
  }
}

// Cache highlighted blobs by (blob sha, lang).
const blobCache = new Map<string, Token[][]>();
const BLOB_CACHE_MAX = 200;

export async function highlightBlob(key: string, code: string, lang: string | undefined): Promise<Token[][]> {
  const k = `${key}\0${lang ?? ''}`;
  const cached = blobCache.get(k);
  if (cached) return cached;
  const lines = await highlight(code, lang);
  if (blobCache.size >= BLOB_CACHE_MAX) {
    const first = blobCache.keys().next().value;
    if (first !== undefined) blobCache.delete(first);
  }
  blobCache.set(k, lines);
  return lines;
}
