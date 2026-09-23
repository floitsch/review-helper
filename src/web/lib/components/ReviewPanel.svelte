<!-- Copyright (C) 2026 Toit contributors.
     Use of this source code is governed by an MIT-style license that can be
     found in the LICENSE file. -->
<script lang="ts">
  import { api } from '../api.ts';
  import { app, openFile, toast } from '../store.svelte.ts';

  let event = $state<'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'>('COMMENT');
  let body = $state('');
  let submitting = $state(false);

  const drafts = $derived(app.state.drafts);
  const hasPr = $derived(!!app.session?.pr);

  function close() {
    app.showReview = false;
  }

  async function submit() {
    if (!hasPr) return;
    const n = drafts.length;
    const what = event === 'APPROVE' ? 'approve' : event === 'REQUEST_CHANGES' ? 'request changes' : 'comment';
    if (!confirm(`Submit review (${what}) with ${n} comment${n === 1 ? '' : 's'} to GitHub?`)) return;
    submitting = true;
    try {
      const r = await api.submitReview(event, body);
      toast(`Review submitted${r.url ? `: ${r.url}` : ''}`);
      body = '';
      close();
    } catch (e) {
      toast(String(e), 'error');
    } finally {
      submitting = false;
    }
  }

  async function markReviewed() {
    try {
      await api.markReviewed();
      toast('Marked current head as reviewed');
    } catch (e) {
      toast(String(e), 'error');
    }
  }

  function asMarkdown(): string {
    const parts = drafts.map((d) => `**${d.path}:${d.startLine ? `${d.startLine}-` : ''}${d.line}**${d.side === 'LEFT' ? ' (old)' : ''}\n${d.body}`);
    return (body ? body + '\n\n' : '') + parts.join('\n\n');
  }

  function copy() {
    navigator.clipboard.writeText(asMarkdown()).then(() => toast('Copied review as Markdown'));
  }

  async function remove(id: string) {
    try {
      await api.deleteDraft(id);
    } catch (e) {
      toast(String(e), 'error');
    }
  }

  function jump(d: (typeof drafts)[number]) {
    openFile(d.path, d.line, d.side === 'LEFT' ? app.session?.baseSha : app.session?.headSha);
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
    e.stopPropagation();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="backdrop" onclick={close} onkeydown={keydown}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="panel" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
    <div class="head">
      <b>Review</b>
      {#if app.session?.pr}<span class="muted">#{app.session.pr.number} {app.session.pr.title}</span>{/if}
      <button class="ghost small close" onclick={close}>✕</button>
    </div>

    <div class="section">
      <div class="label">Draft comments ({drafts.length})</div>
      {#if drafts.length === 0}
        <p class="muted tiny">No drafts. Select lines in a diff or the file viewer and press <kbd>c</kbd> or use “Comment”.</p>
      {/if}
      {#each drafts as d (d.id)}
        <div class="draft hoverable">
          <button class="linkish mono" onclick={() => jump(d)}>{d.path}:{d.startLine ? `${d.startLine}-` : ''}{d.line}{d.side === 'LEFT' ? ' (old)' : ''}</button>
          <div class="body">{d.body}</div>
          <span class="actions"><button class="icon-btn" onclick={() => remove(d.id)}>delete</button></span>
        </div>
      {/each}
    </div>

    <div class="section">
      <div class="label">Summary</div>
      <textarea bind:value={body} rows="4" placeholder="Review summary (Markdown, optional)"></textarea>
    </div>

    {#if hasPr}
      <div class="section row">
        <label><input type="radio" bind:group={event} value="COMMENT" /> Comment</label>
        <label><input type="radio" bind:group={event} value="APPROVE" /> Approve</label>
        <label><input type="radio" bind:group={event} value="REQUEST_CHANGES" /> Request changes</label>
        <span class="spacer"></span>
        <button class="primary" onclick={submit} disabled={submitting || (drafts.length === 0 && !body.trim() && event === 'COMMENT')}>
          {submitting ? 'Submitting…' : 'Submit to GitHub'}
        </button>
      </div>
    {:else}
      <div class="section row">
        <span class="muted tiny">No pull request in this session, so the review cannot be submitted. Copy it instead.</span>
        <span class="spacer"></span>
        <button onclick={copy}>Copy as Markdown</button>
      </div>
    {/if}

    <div class="section row foot">
      <span class="tiny muted">
        Last reviewed head: {app.state.lastReviewedSha ? app.state.lastReviewedSha.slice(0, 10) : 'never'}
        {#if app.state.lastReviewedSha && app.session && app.state.lastReviewedSha === app.session.headSha}(current){/if}
      </span>
      <span class="spacer"></span>
      <button class="small" onclick={markReviewed} title="Remember the current head so that later you can view only the changes since">Mark head as reviewed</button>
      {#if hasPr}<button class="small" onclick={copy}>Copy as Markdown</button>{/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 50;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 8vh;
  }
  .panel {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow);
    width: min(720px, 94vw);
    max-height: 84vh;
    overflow: auto;
    display: flex;
    flex-direction: column;
  }
  .head {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }
  .close {
    margin-left: auto;
  }
  .section {
    padding: 8px 14px;
    border-bottom: 1px solid var(--border-2);
  }
  .label {
    font-size: 12px;
    color: var(--fg-2);
    margin-bottom: 4px;
  }
  .draft {
    border-left: 3px solid var(--accent);
    padding: 4px 8px;
    margin: 4px 0;
    background: var(--bg-2);
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 8px;
  }
  .draft .body {
    grid-column: 1 / -1;
    white-space: pre-wrap;
    font-size: 13px;
  }
  .linkish {
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    text-align: left;
  }
  textarea {
    width: 100%;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .row label {
    cursor: pointer;
  }
  .spacer {
    flex: 1;
  }
  .foot {
    border-bottom: none;
  }
</style>
