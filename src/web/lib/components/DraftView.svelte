<!-- Copyright (C) 2026 Toit contributors.
     Use of this source code is governed by an MIT-style license that can be
     found in the LICENSE file. -->
<script lang="ts">
  import type { DraftComment } from '../../../shared/types.ts';
  import { api } from '../api.ts';
  import { addChip, app, toast } from '../store.svelte.ts';
  import CommentEditor from './CommentEditor.svelte';

  let { draft }: { draft: DraftComment } = $props();

  const editing = $derived(app.commentTarget?.draftId === draft.id);

  function edit() {
    app.commentTarget = { path: draft.path, side: draft.side, line: draft.line, startLine: draft.startLine, draftId: draft.id };
  }
  async function remove() {
    try {
      await api.deleteDraft(draft.id);
    } catch (e) {
      toast(String(e), 'error');
    }
  }
  function attach() {
    addChip({ kind: 'comment', label: `draft ${draft.path}:${draft.line}`, text: draft.body, file: draft.path, line: draft.line });
  }
</script>

{#if editing && app.commentTarget}
  <CommentEditor target={app.commentTarget} {draft} />
{:else}
  <div class="draft hoverable">
    <div class="head tiny">
      <span class="badge accent">draft</span>
      <span class="muted">review comment, not submitted yet</span>
      <span class="actions">
        <button class="icon-btn" onclick={edit}>edit</button>
        <button class="icon-btn" onclick={attach} title="Add to chat context">＋chat</button>
        <button class="icon-btn" onclick={remove}>delete</button>
      </span>
    </div>
    <div class="body">{draft.body}</div>
  </div>
{/if}

<style>
  .draft {
    border-left: 3px solid var(--accent);
    padding: 4px 10px;
    background: var(--bg);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .head .actions {
    margin-left: auto;
  }
  .body {
    white-space: pre-wrap;
    font-size: 13px;
  }
</style>
