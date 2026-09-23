<!-- Copyright (C) 2026 Toit contributors.
     Use of this source code is governed by an MIT-style license that can be
     found in the LICENSE file. -->
<script lang="ts">
  import type { DiffBlock, Hunk } from '../../../shared/types.ts';
  import { hunksForRange } from '../../../shared/diffutil.ts';
  import { app, hunkById, isFullRange, openFile } from '../store.svelte.ts';
  import { hunkChip, toggleHunkReviewed } from '../actions.ts';
  import { hunkStats } from '../diffutil.ts';
  import HunkView from './HunkView.svelte';

  let { block, hunkIds }: { block?: DiffBlock; hunkIds?: string[] } = $props();

  /** Hunks to show, honoring the selected commit range. */
  const hunks = $derived.by((): Hunk[] => {
    if (block && !isFullRange() && app.rangeDiff) {
      return hunksForRange(app.rangeDiff, block.file, block.lines, !!block.old);
    }
    const ids = block ? block.hunkIds : (hunkIds ?? []);
    const seen = new Set<string>();
    const out: Hunk[] = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const h = hunkById(id);
      if (h) out.push(h);
    }
    return out;
  });

  const from = $derived(app.rangeDiff?.from ?? app.session?.baseSha ?? '');
  const to = $derived(app.rangeDiff?.to ?? app.session?.headSha ?? '');

  const files = $derived.by(() => {
    const m = new Map<string, Hunk[]>();
    for (const h of hunks) m.set(h.file, [...(m.get(h.file) ?? []), h]);
    return [...m.entries()];
  });

  function fileStatus(path: string) {
    const f = (app.rangeDiff ?? app.fullDiff)?.files.find((x) => x.path === path);
    return f;
  }

  function stats(hs: Hunk[]) {
    let adds = 0;
    let dels = 0;
    for (const h of hs) {
      const s = hunkStats(h);
      adds += s.adds;
      dels += s.dels;
    }
    return { adds, dels };
  }

  /** Focus on the referenced line range when line numbers of the shown diff match the block. */
  const focus = $derived.by(() => {
    if (!block?.lines || !app.session || !app.rangeDiff) return undefined;
    const side = block.old ? 'old' : 'new';
    const matches = side === 'new' ? app.rangeDiff.to === app.session.headSha : app.rangeDiff.from === app.session.baseSha;
    if (!matches) return undefined;
    return { side: side as 'new' | 'old', from: block.lines[0], to: block.lines[1] };
  });

  const stale = $derived.by(() => {
    if (!block || !app.staleDiff) return false;
    return hunksForRange(app.staleDiff, block.file, block.lines, false).length > 0;
  });
</script>

<div class="diff">
  {#if block?.error}
    <div class="error">⚠ {block.error}</div>
  {:else if hunks.length === 0}
    <div class="empty muted">
      {#if block}
        No changes to <span class="mono">{block.file}{block.lines ? `:${block.lines[0]}-${block.lines[1]}` : ''}</span> in {app.range?.label ?? 'this range'}.
      {:else}
        No hunks.
      {/if}
    </div>
  {/if}
  {#each files as [path, hs] (path)}
    {@const f = fileStatus(path)}
    {@const st = stats(hs)}
    <div class="file">
      <div class="file-header hoverable">
        <button class="path mono" title="Open in file viewer" onclick={() => openFile(path, hs[0].newStart || 1)}>{path}</button>
        {#if f?.status === 'added'}<span class="badge ok">new file</span>{/if}
        {#if f?.status === 'deleted'}<span class="badge concern">deleted</span>{/if}
        {#if f?.status === 'renamed'}<span class="badge">renamed from {f.oldPath}</span>{/if}
        {#if block?.title}<span class="title">{block.title}</span>{/if}
        {#if stale}<span class="badge warn" title="This part of the file changed after the review document was written">changed since doc</span>{/if}
        <span class="stat tiny"><span class="adds">+{st.adds}</span> <span class="dels">−{st.dels}</span></span>
        <span class="actions">
          {#each hs as h}
            <label class="tiny reviewed" title="Mark hunk as reviewed">
              <input type="checkbox" checked={!!app.state.reviewedHunks[h.id]} onchange={() => toggleHunkReviewed(h.id)} />
              {hs.length > 1 ? `@${h.newStart}` : 'reviewed'}
            </label>
          {/each}
          {#each hs as h}
            <button class="icon-btn" title="Add hunk to chat context" onclick={() => hunkChip(h)}>＋chat{hs.length > 1 ? ` @${h.newStart}` : ''}</button>
          {/each}
        </span>
      </div>
      {#each hs as h (h.id)}
        <HunkView hunk={h} annotations={block?.annotations ?? []} view={block?.view} ws={block?.ws} {from} {to} {focus} />
      {/each}
    </div>
  {/each}
</div>

<style>
  .diff {
    margin: 8px 0;
  }
  .file {
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 8px;
    background: var(--bg);
  }
  .file-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    background: var(--bg-2);
    border-bottom: 1px solid var(--border-2);
    position: sticky;
    top: 0;
    z-index: 2;
  }
  .path {
    background: none;
    border: none;
    padding: 0;
    color: var(--fg);
    font-weight: 600;
    cursor: pointer;
  }
  .path:hover {
    color: var(--accent);
    text-decoration: underline;
  }
  .title {
    color: var(--fg-2);
    font-style: italic;
  }
  .stat {
    margin-left: auto;
  }
  .adds {
    color: var(--tip);
  }
  .dels {
    color: var(--concern);
  }
  .reviewed {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    cursor: pointer;
    color: var(--fg-2);
  }
  .error {
    padding: 6px 10px;
    background: var(--warn-bg);
    color: var(--warn);
    border-radius: 6px;
    font-size: 13px;
  }
  .empty {
    padding: 6px 10px;
    font-size: 13px;
    background: var(--bg-2);
    border-radius: 6px;
  }
</style>
