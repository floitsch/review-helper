<!-- Copyright (C) 2026 Toit contributors.
     Use of this source code is governed by an MIT-style license that can be
     found in the LICENSE file. -->
<script lang="ts">
  import type { PrThread } from '../../../shared/types.ts';
  import { addChip } from '../store.svelte.ts';

  let { thread }: { thread: PrThread } = $props();
  // svelte-ignore state_referenced_locally
  let open = $state(!thread.resolved);

  function attach() {
    const text = thread.comments.map((c) => `${c.author}: ${c.body}`).join('\n\n');
    addChip({ kind: 'comment', label: `thread ${thread.path}:${thread.line ?? ''}`, text, file: thread.path, line: thread.line ?? undefined });
  }

  function when(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="thread" class:resolved={thread.resolved}>
  <div class="head">
    <button class="ghost small" onclick={() => (open = !open)}>{open ? '▾' : '▸'}</button>
    <span class="tiny muted">
      {thread.comments.length} comment{thread.comments.length === 1 ? '' : 's'}
      {#if thread.resolved}<span class="badge ok">resolved</span>{/if}
      {#if thread.outdated}<span class="badge warn">outdated</span>{/if}
      {#if !open}· {thread.comments[0]?.author}: {thread.comments[0]?.body.slice(0, 80)}{/if}
    </span>
    <span class="actions">
      <button class="icon-btn" title="Add thread to chat context" onclick={attach}>＋chat</button>
      {#if thread.comments[0]}<a class="icon-btn" href={thread.comments[0].url} target="_blank" rel="noreferrer" title="Open on GitHub">↗</a>{/if}
    </span>
  </div>
  {#if open}
    {#each thread.comments as c}
      <div class="comment">
        <div class="tiny"><b>{c.author}</b> <span class="muted">{when(c.createdAt)}</span></div>
        <div class="body">{c.body}</div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .thread {
    border-left: 3px solid var(--warn);
    padding: 4px 10px;
    background: var(--bg);
  }
  .thread.resolved {
    border-left-color: var(--border);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .head .actions {
    margin-left: auto;
  }
  .comment {
    padding: 4px 0 4px 22px;
  }
  .body {
    white-space: pre-wrap;
    font-size: 13px;
  }
</style>
