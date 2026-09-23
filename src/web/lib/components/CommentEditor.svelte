<!-- Copyright (C) 2026 Toit contributors.
     Use of this source code is governed by an MIT-style license that can be
     found in the LICENSE file. -->
<script lang="ts">
  import type { DraftComment } from '../../../shared/types.ts';
  import { api } from '../api.ts';
  import { app, toast, type CommentTarget } from '../store.svelte.ts';

  let { target, draft }: { target: CommentTarget; draft?: DraftComment } = $props();

  // svelte-ignore state_referenced_locally
  let body = $state(draft?.body ?? '');
  let textarea: HTMLTextAreaElement | undefined = $state();

  $effect(() => {
    textarea?.focus();
  });

  function close() {
    app.commentTarget = null;
  }

  async function save() {
    const text = body.trim();
    if (!text) return;
    try {
      if (draft) {
        await api.updateDraft({ id: draft.id, body: text });
      } else {
        await api.addDraft({ path: target.path, line: target.line, side: target.side, startLine: target.startLine, body: text });
      }
      close();
    } catch (e) {
      toast(String(e), 'error');
    }
  }

  async function remove() {
    if (!draft) return close();
    try {
      await api.deleteDraft(draft.id);
      close();
    } catch (e) {
      toast(String(e), 'error');
    }
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
    e.stopPropagation();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="editor" onkeydown={keydown} role="group">
  <div class="head tiny muted">
    {draft ? 'Edit draft comment' : 'New review comment'} on <span class="mono">{target.path}:{target.startLine ? `${target.startLine}-` : ''}{target.line}</span>
    {#if target.side === 'LEFT'}<span class="badge">old side</span>{/if}
  </div>
  <textarea bind:this={textarea} bind:value={body} rows="4" placeholder="Comment (Markdown). Ctrl+Enter saves, Esc cancels."></textarea>
  <div class="buttons">
    <button class="primary small" onclick={save} disabled={!body.trim()}>{draft ? 'Save' : 'Add draft'}</button>
    <button class="small" onclick={close}>Cancel</button>
    {#if draft}<button class="small danger" onclick={remove}>Delete</button>{/if}
    <span class="tiny muted">Drafts are submitted together with the review.</span>
  </div>
</div>

<style>
  .editor {
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    border-left: 3px solid var(--accent);
    background: var(--bg);
  }
  textarea {
    width: 100%;
    font-family: var(--font);
  }
  .buttons {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .danger {
    color: var(--concern);
  }
</style>
