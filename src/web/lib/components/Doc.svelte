<!-- Copyright (C) 2026 Toit contributors.
     Use of this source code is governed by an MIT-style license that can be
     found in the LICENSE file. -->
<script lang="ts">
  import type { Block, DiffBlock, Hunk } from '../../../shared/types.ts';
  import { hunksForRange } from '../../../shared/diffutil.ts';
  import { app, isFullRange } from '../store.svelte.ts';
  import { linkify } from '../linkify.ts';
  import BlockView from './BlockView.svelte';
  import DiffView from './DiffView.svelte';

  let showPrBody = $state(false);

  function diffBlocks(blocks: Block[]): DiffBlock[] {
    const out: DiffBlock[] = [];
    const walk = (b: Block) => {
      if (b.type === 'diff') out.push(b);
      if ('blocks' in b) b.blocks.forEach(walk);
    };
    blocks.forEach(walk);
    return out;
  }

  /** Hunks of the selected range that no block of the document shows. */
  const leftover = $derived.by((): { file: string; hunkIds: string[] }[] => {
    const doc = app.doc;
    const set = app.rangeDiff;
    if (!doc || !set) return [];
    if (isFullRange()) return doc.uncovered;
    const shown = new Set<string>();
    for (const b of diffBlocks(doc.blocks)) {
      for (const h of hunksForRange(set, b.file, b.lines, !!b.old)) shown.add(h.id);
    }
    const out: { file: string; hunkIds: string[] }[] = [];
    for (const f of set.files) {
      const ids = f.hunks.filter((h: Hunk) => !shown.has(h.id)).map((h: Hunk) => h.id);
      if (ids.length > 0) out.push({ file: f.path, hunkIds: ids });
    }
    return out;
  });

  const docStale = $derived.by(() => {
    const d = app.doc;
    const s = app.session;
    if (!d?.head || !s) return null;
    if (s.headSha.startsWith(d.head) || d.head.startsWith(s.headSha)) return null;
    const idx = s.commits.findIndex((c) => c.sha.startsWith(d.head!));
    const newer = idx >= 0 ? s.commits.length - idx - 1 : null;
    return { head: d.head, newer };
  });

  const uncoveredCount = $derived(leftover.reduce((a, u) => a + u.hunkIds.length, 0));
</script>

<div class="doc">
  {#if app.session?.pr}
    {@const pr = app.session.pr}
    <div class="pr-card">
      <div class="pr-title">
        <a href={pr.url} target="_blank" rel="noreferrer">#{pr.number}</a>
        <b>{pr.title}</b>
        <span class="muted tiny">by {pr.author} · {pr.headRefName} → {pr.baseRefName} · {pr.state.toLowerCase()}</span>
        {#if pr.body}<button class="ghost small" onclick={() => (showPrBody = !showPrBody)}>{showPrBody ? 'hide' : 'show'} description</button>{/if}
      </div>
      {#if showPrBody}<pre class="pr-body">{pr.body}</pre>{/if}
      {#if app.pr && (app.pr.reviews.length > 0 || app.pr.comments.length > 0)}
        <details class="conversation">
          <summary class="tiny muted">Conversation: {app.pr.reviews.length} review{app.pr.reviews.length === 1 ? '' : 's'}, {app.pr.comments.length} comment{app.pr.comments.length === 1 ? '' : 's'}, {app.pr.threads.filter((t) => !t.resolved).length} open thread{app.pr.threads.filter((t) => !t.resolved).length === 1 ? '' : 's'}</summary>
          {#each app.pr.reviews as r}
            <div class="conv-item"><b>{r.author}</b> <span class="badge">{r.state.toLowerCase().replace('_', ' ')}</span> <a class="tiny" href={r.url} target="_blank" rel="noreferrer">↗</a><div class="conv-body">{r.body}</div></div>
          {/each}
          {#each app.pr.comments as c}
            <div class="conv-item"><b>{c.author}</b> <a class="tiny" href={c.url} target="_blank" rel="noreferrer">↗</a><div class="conv-body">{c.body}</div></div>
          {/each}
        </details>
      {/if}
    </div>
  {/if}

  {#if !app.doc?.exists}
    <div class="banner info">
      <b>No review document yet.</b> Start an agent in the repository and let it write
      <span class="mono">{app.session?.docPath ?? '.review/doc.md'}</span> using the <span class="mono">review-doc</span> skill.
      The page updates as soon as the file appears. Meanwhile all changes are listed below.
    </div>
  {/if}

  {#if docStale}
    <div class="banner warn">
      The document was written for <span class="mono">{docStale.head.slice(0, 10)}</span>, but the branch moved on
      {#if docStale.newer !== null}({docStale.newer} newer commit{docStale.newer === 1 ? '' : 's'}){/if}.
      Sections whose code changed since are marked <span class="badge warn">changed since doc</span>.
    </div>
  {/if}

  {#if app.doc && app.doc.warnings.length > 0}
    <div class="banner warn">
      <b>Document warnings</b>
      <ul>{#each app.doc.warnings as w}<li>{w}</li>{/each}</ul>
    </div>
  {/if}

  {#if app.range && !isFullRange()}
    <div class="banner info">Showing only <b>{app.range.label}</b>. Diff blocks show the hunks of that range that touch the same lines; everything else in the range is listed at the bottom.</div>
  {/if}

  {#if app.doc}
    <BlockView blocks={app.doc.blocks} />
  {/if}

  {#if leftover.length > 0}
    <div class="uncovered" data-block="uncovered">
      <h2>
        {#if app.doc?.exists && isFullRange()}Changes not covered by the document{:else if isFullRange()}All changes{:else}Other changes in {app.range?.label}{/if}
        <span class="badge warn">{uncoveredCount} hunk{uncoveredCount === 1 ? '' : 's'}</span>
      </h2>
      {#if app.doc?.exists && isFullRange()}
        <p class="muted tiny">Every hunk of the pull request should be referenced by a <span class="mono">:::diff</span> block. These are not. Ask the agent to cover them, or review them here.</p>
      {/if}
      {#each leftover as u (u.file)}
        <DiffView hunkIds={u.hunkIds} />
      {/each}
    </div>
  {:else if app.doc?.exists && isFullRange()}
    <p class="muted tiny coverage-ok">✓ Every hunk of the diff is referenced by the document.</p>
  {/if}
  <div class="bottom-space"></div>
</div>

<style>
  .doc {
    padding: 8px 20px 40px;
    max-width: 1400px;
  }
  .pr-card {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 12px;
    margin-bottom: 8px;
    background: var(--bg-2);
  }
  .pr-title {
    display: flex;
    gap: 8px;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .pr-body {
    white-space: pre-wrap;
    font-family: var(--font);
    font-size: 13px;
    margin: 6px 0 0;
  }
  .conversation {
    margin-top: 6px;
  }
  .conv-item {
    padding: 4px 0 4px 12px;
    border-left: 2px solid var(--border);
    margin: 4px 0;
    font-size: 13px;
  }
  .conv-body {
    white-space: pre-wrap;
  }
  .banner {
    border-radius: 6px;
    padding: 8px 12px;
    margin: 8px 0;
    font-size: 13px;
  }
  .banner.info {
    background: var(--note-bg);
    border-left: 4px solid var(--note);
  }
  .banner.warn {
    background: var(--warn-bg);
    border-left: 4px solid var(--warn);
  }
  .banner ul {
    margin: 4px 0 0;
    padding-left: 20px;
  }
  .uncovered {
    margin-top: 24px;
    border-top: 2px dashed var(--border);
    padding-top: 8px;
  }
  .uncovered h2 {
    font-size: 1.2em;
  }
  .coverage-ok {
    margin-top: 24px;
  }
  .bottom-space {
    height: 40vh;
  }
</style>
