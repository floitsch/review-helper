<!-- Copyright (C) 2026 Toit contributors.
     Use of this source code is governed by an MIT-style license that can be
     found in the LICENSE file. -->
<script lang="ts">
  import type { Block, ChangeBlock, DiffBlock } from '../../../shared/types.ts';
  import { hunksForRange } from '../../../shared/diffutil.ts';
  import { addChip, app, openFile } from '../store.svelte.ts';
  import { changeReviewedState, scrollToLine, toggleChangeReviewed } from '../actions.ts';
  import { linkify } from '../linkify.ts';
  import BlockView from './BlockView.svelte';
  import CodeLine from './CodeLine.svelte';
  import DiffView from './DiffView.svelte';

  let { blocks, inChat = false }: { blocks: Block[]; inChat?: boolean } = $props();

  function label(b: Block): string {
    switch (b.type) {
      case 'section':
        return b.title;
      case 'change':
        return b.title;
      case 'callout':
        return b.title ?? b.kind;
      case 'explain':
        return b.title ?? 'details';
      case 'diff':
        return `${b.file}${b.lines ? `:${b.lines[0]}-${b.lines[1]}` : ''}`;
      case 'code':
        return b.file ?? 'code';
      case 'html':
        return b.text.slice(0, 40);
    }
  }

  function attach(b: Block) {
    addChip({ kind: 'block', label: label(b), blockId: b.id });
  }

  function isStale(b: Block): boolean {
    if (!app.staleDiff) return false;
    if (b.type === 'diff') return hunksForRange(app.staleDiff, b.file, b.lines, false).length > 0;
    if ('blocks' in b) return b.blocks.some(isStale);
    return false;
  }

  function diffsIn(b: Block): DiffBlock[] {
    const out: DiffBlock[] = [];
    const walk = (x: Block) => {
      if (x.type === 'diff') out.push(x);
      if ('blocks' in x) x.blocks.forEach(walk);
    };
    walk(b);
    return out;
  }

  function jumpToAnnotation(b: DiffBlock, side: 'new' | 'old', line: number) {
    for (const id of b.hunkIds) if (scrollToLine(id, side, line)) return;
  }

  const calloutIcon: Record<string, string> = { note: 'ℹ', warning: '⚠', concern: '❗', context: '📍', tip: '💡' };

  let collapsedChanges = $state(new Set<string>());
  function toggleCollapse(id: string) {
    const s = new Set(collapsedChanges);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    collapsedChanges = s;
  }
  function reviewedLabel(b: ChangeBlock): string {
    const st = changeReviewedState(b);
    return st === 'yes' ? 'reviewed' : st === 'stale' ? 'changed since reviewed' : 'mark reviewed';
  }
</script>

{#each blocks as b (b.id)}
  <div class="block block-{b.type}" data-block={b.id} data-block-type={b.type}>
    {#if b.type === 'section'}
      <div class="heading hoverable">
        <svelte:element this={`h${Math.min(b.level + (inChat ? 2 : 0), 6)}`}>{@html b.titleHtml}</svelte:element>
        <span class="actions"><button class="icon-btn" title="Add section to chat context" onclick={() => attach(b)}>＋chat</button></span>
      </div>
      <BlockView blocks={b.blocks} {inChat} />
    {:else if b.type === 'change'}
      {@const st = changeReviewedState(b)}
      {@const collapsed = collapsedChanges.has(b.id)}
      <div class="change" class:reviewed={st === 'yes'}>
        <div class="change-header hoverable">
          <button class="ghost small" onclick={() => toggleCollapse(b.id)} title="Collapse/expand">{collapsed ? '▸' : '▾'}</button>
          <label class="check" title={reviewedLabel(b)}>
            <input type="checkbox" checked={st === 'yes'} onchange={() => toggleChangeReviewed(b)} />
          </label>
          <span class="change-title">{@html b.titleHtml}</span>
          <span class="badge">{diffsIn(b).length} diff{diffsIn(b).length === 1 ? '' : 's'}</span>
          {#if st === 'stale'}<span class="badge warn">changed since reviewed</span>{/if}
          {#if isStale(b)}<span class="badge warn">changed since doc</span>{/if}
          <span class="actions"><button class="icon-btn" title="Add change to chat context" onclick={() => attach(b)}>＋chat</button></span>
        </div>
        {#if !collapsed}
          <div class="change-body">
            <BlockView blocks={b.blocks} {inChat} />
          </div>
        {/if}
      </div>
    {:else if b.type === 'callout'}
      <div class="callout callout-{b.kind} hoverable">
        <div class="callout-head">
          <span class="icon">{calloutIcon[b.kind]}</span>
          <span class="kind">{b.title ?? b.kind}</span>
          <span class="actions"><button class="icon-btn" title="Add to chat context" onclick={() => attach(b)}>＋chat</button></span>
        </div>
        <BlockView blocks={b.blocks} {inChat} />
      </div>
    {:else if b.type === 'explain'}
      <details class="explain hoverable">
        <summary>{b.title ?? 'Details'} <span class="actions"><button class="icon-btn" title="Add to chat context" onclick={(e) => { e.preventDefault(); attach(b); }}>＋chat</button></span></summary>
        <div class="explain-body"><BlockView blocks={b.blocks} {inChat} /></div>
      </details>
    {:else if b.type === 'diff'}
      <div class="diffblock hoverable">
        <DiffView block={b} />
        {#if b.annotations.length > 0 || b.blocks.length > 0}
          <details class="explain line-by-line" open={b.open}>
            <summary>
              Line by line{b.annotations.length > 0 ? ` (${b.annotations.length})` : ''}
              <span class="actions"><button class="icon-btn" title="Add explanation to chat context" onclick={(e) => { e.preventDefault(); attach(b); }}>＋chat</button></span>
            </summary>
            <div class="explain-body">
              {#if b.annotations.length > 0}
                <ul class="ann-list">
                  {#each b.annotations as a}
                    <li>
                      <button class="linkish mono" onclick={() => jumpToAnnotation(b, a.side, a.line)}>{a.side === 'old' ? 'old ' : ''}L{a.line}{a.endLine ? `-${a.endLine}` : ''}</button>
                      <span class="prose" use:linkify={a.html}>{@html a.html}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
              <BlockView blocks={b.blocks} {inChat} />
            </div>
          </details>
        {/if}
      </div>
    {:else if b.type === 'code'}
      <div class="codeblock hoverable">
        {#if b.file || b.lang}
          <div class="code-head tiny">
            {#if b.file}<button class="linkish mono" onclick={() => openFile(b.file!, b.startLine)}>{b.file}{b.startLine ? `:${b.startLine}` : ''}</button>{:else}<span class="muted">{b.lang}</span>{/if}
            <span class="actions"><button class="icon-btn" title="Add to chat context" onclick={() => attach(b)}>＋chat</button></span>
          </div>
        {/if}
        <table class="code-table">
          <tbody>
            {#each b.tokens ?? b.code.split('\n').map((l) => [{ t: l }]) as line, i}
              <tr>
                {#if b.startLine}<td class="num">{b.startLine + i}</td>{/if}
                <td class="text"><CodeLine tokens={line} /></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else if b.type === 'html'}
      <div class="html hoverable">
        <div class="prose" use:linkify={b.html}>{@html b.html}</div>
        <span class="actions side"><button class="icon-btn" title="Add paragraph to chat context" onclick={() => attach(b)}>＋chat</button></span>
      </div>
    {/if}
  </div>
{/each}

<style>
  .block {
    position: relative;
  }
  :global(.block.flash) {
    animation: flash 1.5s ease-out;
  }
  .heading {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .heading h1,
  .heading h2,
  .heading h3,
  .heading h4,
  .heading h5,
  .heading h6 {
    margin: 0.9em 0 0.3em;
    line-height: 1.25;
  }
  .heading h1 {
    font-size: 1.5em;
  }
  .heading h2 {
    font-size: 1.25em;
    border-bottom: 1px solid var(--border-2);
    padding-bottom: 2px;
  }
  .heading h3 {
    font-size: 1.1em;
  }
  .change {
    border: 1px solid var(--border);
    border-left: 4px solid var(--accent);
    border-radius: 6px;
    margin: 12px 0;
    background: var(--bg);
  }
  .change.reviewed {
    border-left-color: var(--tip);
    opacity: 0.85;
  }
  .change-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: var(--bg-2);
    border-radius: 6px 6px 0 0;
    position: sticky;
    top: 0;
    z-index: 3;
  }
  .change-title {
    font-weight: 600;
    font-size: 15px;
  }
  .check {
    display: inline-flex;
    cursor: pointer;
  }
  .change-body {
    padding: 4px 12px 8px;
  }
  .callout {
    border-left: 4px solid var(--note);
    background: var(--note-bg);
    border-radius: 6px;
    padding: 6px 12px;
    margin: 8px 0;
  }
  .callout-warning {
    border-left-color: var(--warn);
    background: var(--warn-bg);
  }
  .callout-concern {
    border-left-color: var(--concern);
    background: var(--concern-bg);
  }
  .callout-context {
    border-left-color: var(--context);
    background: var(--context-bg);
  }
  .callout-tip {
    border-left-color: var(--tip);
    background: var(--tip-bg);
  }
  .callout-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: 13px;
    text-transform: capitalize;
  }
  .explain {
    margin: 6px 0;
    border: 1px solid var(--border-2);
    border-radius: 6px;
    background: var(--bg-2);
  }
  .explain summary {
    cursor: pointer;
    padding: 4px 10px;
    font-size: 13px;
    color: var(--fg-2);
    user-select: none;
  }
  .explain-body {
    padding: 4px 12px 8px;
    background: var(--bg);
    border-radius: 0 0 6px 6px;
  }
  .ann-list {
    list-style: none;
    padding: 0;
    margin: 4px 0;
  }
  .ann-list li {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin: 2px 0;
  }
  .ann-list .prose :global(p) {
    margin: 0;
  }
  .linkish {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    font-size: 12px;
  }
  .linkish:hover {
    text-decoration: underline;
  }
  .codeblock {
    border: 1px solid var(--border-2);
    border-radius: 6px;
    margin: 8px 0;
    overflow: hidden;
    background: var(--bg-2);
  }
  .code-head {
    display: flex;
    gap: 8px;
    padding: 2px 10px;
    border-bottom: 1px solid var(--border-2);
  }
  .codeblock table {
    background: var(--bg);
  }
  .html {
    display: flex;
    gap: 6px;
  }
  .html .prose {
    flex: 1;
    min-width: 0;
  }
  .actions.side {
    align-self: flex-start;
    margin-top: 6px;
  }
  .diffblock {
    position: relative;
  }
</style>
