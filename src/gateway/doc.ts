// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

// Parses the review document (Markdown with directives) into a block tree.

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { toString as mdToString } from 'mdast-util-to-string';
import type { Root, RootContent, Heading, Code, ListItem, Paragraph, Text } from 'mdast';
import type { Annotation, Block, CalloutKind, ChangeBlock, DiffBlock, DiffSet, ReviewDoc, SectionBlock } from '../shared/types.ts';
import { highlight, normalizeLang } from './highlight.ts';
import { hunksForRange } from './diff.ts';

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkDirective);
const renderer = unified().use(remarkRehype, { allowDangerousHtml: true }).use(rehypeStringify, { allowDangerousHtml: true });

interface Directive {
  type: 'containerDirective' | 'leafDirective' | 'textDirective';
  name: string;
  attributes?: Record<string, string | null | undefined> | null;
  children: RootContent[];
  position?: Root['position'];
}

const CALLOUTS: CalloutKind[] = ['note', 'warning', 'concern', 'context', 'tip'];

function renderHtml(nodes: RootContent[]): string {
  const root: Root = { type: 'root', children: nodes };
  const hast = renderer.runSync(root);
  return String(renderer.stringify(hast as any));
}

function renderInline(nodes: RootContent[]): string {
  // Renders paragraph content without the wrapping <p>.
  const html = renderHtml(nodes);
  return html.replace(/^<p>/, '').replace(/<\/p>\s*$/, '');
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'x'
  );
}

interface FrontMatter {
  body: string;
  offset: number;
  values: Record<string, string>;
}

function splitFrontMatter(src: string): FrontMatter {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { body: src, offset: 0, values: {} };
  const values: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([\w-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) values[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { body: src.slice(m[0].length), offset: m[0].length, values };
}

/** Parses `120-140`, `120..140`, `120` into an inclusive range. */
function parseRange(s: string | null | undefined): [number, number] | undefined {
  if (!s) return undefined;
  const m = /^\s*L?(\d+)\s*(?:(?:-|\.\.|–)\s*L?(\d+))?\s*$/.exec(s);
  if (!m) return undefined;
  const a = +m[1];
  const b = m[2] ? +m[2] : a;
  return [Math.min(a, b), Math.max(a, b)];
}

const ANNOTATION_RE = /^\s*(?:(L|D)(\d+)(?:\s*[-–]\s*[LD]?(\d+))?|(\d+)(?:\s*[-–]\s*(\d+))?:)\s*[:.)]?\s*/;

class DocBuilder {
  warnings: string[] = [];
  usedIds = new Set<string>();
  referenced = new Set<string>();
  counter = 0;
  pending: Promise<void>[] = [];

  constructor(
    private src: string,
    private diff: DiffSet | null,
  ) {}

  srcOf(node: { position?: Root['position'] }): string {
    const p = node.position;
    if (!p || p.start.offset === undefined || p.end.offset === undefined) return '';
    return this.src.slice(p.start.offset, p.end.offset);
  }

  uniqueId(base: string): string {
    let id = base;
    let n = 2;
    while (this.usedIds.has(id)) id = `${base}-${n++}`;
    this.usedIds.add(id);
    return id;
  }

  nextId(prefix: string): string {
    return this.uniqueId(`${prefix}-${++this.counter}`);
  }

  /** Converts a list of sibling nodes into blocks, nesting headings into sections. */
  buildBlocks(nodes: RootContent[]): Block[] {
    const result: Block[] = [];
    // Stack of open sections; headings of a lower-or-equal level close them.
    const stack: SectionBlock[] = [];
    const push = (b: Block) => {
      if (stack.length > 0) stack[stack.length - 1].blocks.push(b);
      else result.push(b);
    };
    for (const node of nodes) {
      if (node.type === 'heading') {
        const h = node as Heading;
        while (stack.length > 0 && stack[stack.length - 1].level >= h.depth) stack.pop();
        const title = mdToString(h);
        const sec: SectionBlock = {
          type: 'section',
          id: this.uniqueId(slug(title)),
          src: this.srcOf(h),
          level: h.depth,
          title,
          titleHtml: renderInline(h.children as RootContent[]),
          blocks: [],
        };
        push(sec);
        stack.push(sec);
        continue;
      }
      const b = this.buildBlock(node);
      if (b) push(b);
    }
    return result;
  }

  buildBlock(node: RootContent): Block | null {
    const t = node.type as string;
    if (t === 'containerDirective' || t === 'leafDirective') {
      return this.buildDirective(node as unknown as Directive);
    }
    if (t === 'code') {
      return this.buildCode(node as Code);
    }
    if (t === 'thematicBreak' || t === 'yaml') return null;
    const html = renderHtml([node]);
    if (!html.trim()) return null;
    const plain = mdToString(node).trim();
    if (/^:{3,}\s*$/.test(plain)) {
      this.warnings.push(
        'Stray ":::" found. Nested containers must use more colons on the outer container (e.g. "::::change" around ":::diff").',
      );
      return null;
    }
    return { type: 'html', id: this.nextId('p'), src: this.srcOf(node), html, text: mdToString(node) };
  }

  buildCode(node: Code): Block {
    const meta = parseMeta(node.meta ?? '');
    const lang = normalizeLang(node.lang ?? undefined) ?? (node.lang ?? undefined);
    const block: Block = {
      type: 'code',
      id: this.nextId('code'),
      src: this.srcOf(node),
      lang,
      code: node.value,
      file: meta.file,
      startLine: meta.start ? +meta.start : meta.line ? +meta.line : undefined,
    };
    this.pending.push(
      highlight(node.value, lang).then((tokens) => {
        block.tokens = tokens;
      }),
    );
    return block;
  }

  /** Splits off the directive label (`:::name[label]`) from the body. */
  splitLabel(d: Directive): { label: string | undefined; labelHtml: string | undefined; body: RootContent[] } {
    const first = d.children[0] as (Paragraph & { data?: { directiveLabel?: boolean } }) | undefined;
    if (first && first.type === 'paragraph' && first.data?.directiveLabel) {
      return { label: mdToString(first), labelHtml: renderInline(first.children as RootContent[]), body: d.children.slice(1) };
    }
    return { label: undefined, labelHtml: undefined, body: d.children };
  }

  buildDirective(d: Directive): Block | null {
    const attrs = d.attributes ?? {};
    const src = this.srcOf(d);
    const name = d.name.toLowerCase();

    if (name === 'change') {
      const { label, labelHtml, body } = this.splitLabel(d);
      const title = (attrs.title as string) || label || 'Change';
      const id = this.uniqueId(attrs.id ? slug(attrs.id) : slug(title));
      const block: ChangeBlock = {
        type: 'change',
        id,
        src,
        title,
        titleHtml: attrs.title ? escapeHtml(attrs.title) : (labelHtml ?? escapeHtml(title)),
        blocks: [],
        hunkIds: [],
      };
      block.blocks = this.buildBlocks(body);
      block.hunkIds = collectHunkIds(block.blocks);
      return block;
    }

    if (CALLOUTS.includes(name as CalloutKind)) {
      const { label, body } = this.splitLabel(d);
      return {
        type: 'callout',
        id: attrs.id ? this.uniqueId(slug(attrs.id)) : this.nextId(name),
        src,
        kind: name as CalloutKind,
        title: (attrs.title as string) || label,
        blocks: this.buildBlocks(body),
      };
    }

    if (name === 'explain' || name === 'details' || name === 'collapse') {
      const { label, body } = this.splitLabel(d);
      return {
        type: 'explain',
        id: attrs.id ? this.uniqueId(slug(attrs.id)) : this.nextId('explain'),
        src,
        title: (attrs.title as string) || label,
        blocks: this.buildBlocks(body),
      };
    }

    if (name === 'diff' || name === 'patch') {
      return this.buildDiff(d, attrs, src);
    }

    this.warnings.push(`Unknown directive ":::${d.name}" – rendered as a note.`);
    const { label, body } = this.splitLabel(d);
    return {
      type: 'callout',
      id: this.nextId(name),
      src,
      kind: 'note',
      title: (attrs.title as string) || label || d.name,
      blocks: this.buildBlocks(body),
    };
  }

  buildDiff(d: Directive, attrs: Record<string, string | null | undefined>, src: string): Block {
    const { label, body } = this.splitLabel(d);
    const file = (attrs.file || attrs.path || label || '').trim();
    const old = attrs.old !== undefined && attrs.old !== null && attrs.old !== 'false';
    const lines = parseRange(attrs.lines ?? attrs.line ?? attrs.range);
    const id = attrs.id ? this.uniqueId(slug(attrs.id)) : this.nextId('diff');
    const block: DiffBlock = {
      type: 'diff',
      id,
      src,
      file,
      lines,
      old: old || undefined,
      view: attrs.view === 'split' || attrs.view === 'side-by-side' ? 'split' : attrs.view === 'unified' ? 'unified' : undefined,
      ws: attrs.ws === 'ignore' || attrs.ws === 'hide' ? 'ignore' : attrs.ws === 'show' ? 'show' : undefined,
      open: attrs.open !== undefined && attrs.open !== null && attrs.open !== 'false' ? true : undefined,
      title: (attrs.title as string) || undefined,
      hunkIds: [],
      annotations: [],
      blocks: [],
    };
    if (!file) {
      block.error = 'diff directive without a file';
      this.warnings.push(`${block.id}: diff directive without a file attribute.`);
    } else if (this.diff) {
      const hunks = hunksForRange(this.diff, file, lines, old);
      if (hunks.length === 0) {
        const known = this.diff.files.some((f) => f.path === file || f.oldPath === file);
        block.error = known
          ? `No hunks of ${file} touch lines ${lines ? lines.join('-') : '(all)'}`
          : `${file} is not part of the diff`;
        this.warnings.push(`${block.id}: ${block.error}.`);
      }
      block.hunkIds = hunks.map((h) => h.id);
      for (const h of hunks) this.referenced.add(h.id);
    }
    // Body: annotations (list items starting with a line number) and other explanation.
    const rest: RootContent[] = [];
    for (const node of body) {
      if (node.type === 'list') {
        const remaining: ListItem[] = [];
        for (const item of node.children) {
          const ann = this.annotationOf(item);
          if (ann) block.annotations.push(ann);
          else remaining.push(item);
        }
        if (remaining.length > 0) rest.push({ ...node, children: remaining });
      } else {
        rest.push(node);
      }
    }
    block.blocks = this.buildBlocks(rest);
    return block;
  }

  annotationOf(item: ListItem): Annotation | null {
    const first = item.children[0];
    if (!first || first.type !== 'paragraph') return null;
    const textNode = first.children[0];
    if (!textNode || textNode.type !== 'text') return null;
    const m = ANNOTATION_RE.exec(textNode.value);
    if (!m) return null;
    const side = m[1] === 'D' ? 'old' : 'new';
    const line = +(m[2] ?? m[4]);
    const end = m[3] ?? m[5];
    const stripped: Text = { ...textNode, value: textNode.value.slice(m[0].length) };
    const para: Paragraph = { ...first, children: [stripped, ...first.children.slice(1)] };
    const nodes: RootContent[] = [para, ...item.children.slice(1)];
    const html = (nodes.length === 1 ? renderInline(para.children as RootContent[]) : renderHtml(nodes)).trim();
    return { side, line, endLine: end ? +end : undefined, html, text: mdToString({ type: 'root', children: nodes } as Root) };
  }
}

function parseMeta(meta: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of meta.matchAll(/(\w+)=("[^"]*"|'[^']*'|\S+)/g)) {
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function collectHunkIds(blocks: Block[]): string[] {
  const out: string[] = [];
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if (b.type === 'diff') out.push(...b.hunkIds);
      if ('blocks' in b) walk(b.blocks);
    }
  };
  walk(blocks);
  return out;
}

export function* walkBlocks(blocks: Block[]): Generator<Block> {
  for (const b of blocks) {
    yield b;
    if ('blocks' in b) yield* walkBlocks(b.blocks);
  }
}

export function findBlock(blocks: Block[], id: string): Block | undefined {
  for (const b of walkBlocks(blocks)) if (b.id === id) return b;
  return undefined;
}

export async function parseReviewDoc(src: string, diff: DiffSet | null, mtime: number): Promise<ReviewDoc> {
  const fm = splitFrontMatter(src);
  const builder = new DocBuilder(fm.body, diff);
  const tree = parser.parse(fm.body) as Root;
  const blocks = builder.buildBlocks(tree.children);
  await Promise.all(builder.pending);
  const uncovered: ReviewDoc['uncovered'] = [];
  if (diff) {
    for (const f of diff.files) {
      const ids = f.hunks.filter((h) => !builder.referenced.has(h.id)).map((h) => h.id);
      if (ids.length > 0) uncovered.push({ file: f.path, hunkIds: ids });
    }
  }
  return { blocks, warnings: builder.warnings, uncovered, mtime, exists: true, head: fm.values.head };
}

/** Renders markdown (e.g. a chat message) to blocks, without diff resolution. */
export async function markdownToBlocks(src: string, diff: DiffSet | null): Promise<Block[]> {
  const builder = new DocBuilder(src, diff);
  const tree = parser.parse(src) as Root;
  const blocks = builder.buildBlocks(tree.children);
  await Promise.all(builder.pending);
  return blocks;
}
