<!-- Copyright (C) 2026 Toit contributors.
     Use of this source code is governed by an MIT-style license that can be
     found in the LICENSE file. -->
<script lang="ts">
  import type { HighlightedFile } from '../../../shared/types.ts';
  import { api } from '../api.ts';
  import { addChip, app, revLabel, toast } from '../store.svelte.ts';
  import { clearSelection, commentOnSelection, selectLine, selectionChip } from '../actions.ts';
  import CodeLine from './CodeLine.svelte';
  import CommentEditor from './CommentEditor.svelte';
  import DraftView from './DraftView.svelte';
  import ThreadView from './ThreadView.svelte';

  let file = $state<HighlightedFile | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let container = $state<HTMLDivElement | undefined>();
  let onlyChanged = $state(false);

  const view = $derived(app.fileView);
  const changedSet = $derived(new Set(file?.changed ?? []));
  const side = $derived(view && app.session && view.rev === app.session.baseSha ? 'old' : 'new');
  const commentSide = $derived(side === 'new' ? 'RIGHT' : 'LEFT');
  const canComment = $derived(!!view && !!app.session && (view.rev === app.session.headSha || view.rev === app.session.baseSha));

  $effect(() => {
    const v = view;
    if (!v) {
      file = null;
      return;
    }
    if (file && file.path === v.path && file.rev === v.rev) {
      scrollTo(v.line, v.nonce);
      return;
    }
    loading = true;
    error = null;
    api
      .file(v.path, v.rev)
      .then((f) => {
        file = f;
        loading = false;
        requestAnimationFrame(() => scrollTo(v.line, v.nonce));
      })
      .catch((e) => {
        loading = false;
        file = null;
        error = String(e);
      });
  });

  function scrollTo(line: number | undefined, _nonce: number) {
    if (!line || !container) return;
    const row = container.querySelector(`tr[data-line="${line}"]`);
    if (row) {
      row.scrollIntoView({ block: 'center' });
      row.classList.add('target');
      setTimeout(() => row.classList.remove('target'), 1600);
    }
  }

  function switchRev(rev: string) {
    if (!view) return;
    app.fileView = { ...view, rev, nonce: view.nonce + 1 };
  }

  function attachFile() {
    if (!view) return;
    addChip({ kind: 'file', label: `${view.path} (${revLabel(view.rev)})`, file: view.path, rev: view.rev });
  }

  function click(e: MouseEvent, line: number) {
    if (!view) return;
    selectLine(e, { file: view.path, rev: view.rev, side, from: line, origin: 'file' });
  }

  function isSelected(line: number): boolean {
    const s = app.selection;
    return !!s && !!view && s.origin === 'file' && s.file === view.path && s.rev === view.rev && line >= s.from && line <= s.to;
  }
  function selectionEnd(line: number): boolean {
    const s = app.selection;
    return !!s && !!view && s.origin === 'file' && s.file === view.path && s.rev === view.rev && s.to === line;
  }

  function draftsAt(line: number) {
    if (!canComment || !view) return [];
    return app.state.drafts.filter((d) => d.path === view.path && d.side === commentSide && d.line === line);
  }
  function threadsAt(line: number) {
    if (!canComment || !view || !app.pr) return [];
    return app.pr.threads.filter((t) => t.path === view.path && t.side === commentSide && t.line === line && (app.prefs.showResolved || !t.resolved));
  }
  function editorAt(line: number) {
    const t = app.commentTarget;
    if (!t || t.draftId || !view || !canComment) return null;
    return t.path === view.path && t.side === commentSide && t.line === line ? t : null;
  }

  /** Lines to render when "only changed" is on: changed lines plus 3 lines of context. */
  const visible = $derived.by((): Set<number> | null => {
    if (!file || !onlyChanged || changedSet.size === 0) return null;
    const keep = new Set<number>();
    for (const n of changedSet) for (let i = n - 3; i <= n + 3; i++) keep.add(i);
    return keep;
  });

  function copyPath() {
    if (!view) return;
    navigator.clipboard.writeText(view.path).then(() => toast('Path copied'));
  }
</script>

<div class="viewer">
  {#if !view}
    <div class="empty muted">
      <p><b>File viewer</b></p>
      <p>Click a file name in a diff, a <span class="mono">path:line</span> reference, or press <kbd>f</kbd> on a hunk to open the full file here.</p>
    </div>
  {:else}
    <div class="head">
      <button class="path mono" title="Copy path" onclick={copyPath}>{view.path}</button>
      <select value={view.rev} onchange={(e) => switchRev((e.target as HTMLSelectElement).value)} title="Revision">
        {#if app.session}
          <option value={app.session.headSha}>head</option>
          <option value={app.session.baseSha}>base</option>
          {#if view.rev !== app.session.headSha && view.rev !== app.session.baseSha}<option value={view.rev}>{view.rev.slice(0, 8)}</option>{/if}
        {/if}
      </select>
      <label class="tiny" title="Show only changed lines with some context"><input type="checkbox" bind:checked={onlyChanged} /> changed only</label>
      <button class="icon-btn" title="Add whole file to chat context" onclick={attachFile}>＋chat</button>
      <button class="icon-btn" title="Close" onclick={() => (app.fileView = null)}>✕</button>
    </div>
    <div class="body" bind:this={container}>
      {#if loading}
        <div class="muted pad">Loading…</div>
      {:else if error}
        <div class="pad error">{error}</div>
      {:else if file?.binary}
        <div class="muted pad">Binary file.</div>
      {:else if file}
        <table class="code-table">
          <colgroup><col style="width: 4.2em" /><col /></colgroup>
          <tbody>
            {#each file.lines as tokens, i}
              {@const n = i + 1}
              {#if !visible || visible.has(n)}
                {#if visible && n > 1 && !visible.has(n - 1)}
                  <tr class="collapsed"><td colspan="2">…</td></tr>
                {/if}
                <tr data-line={n} class:changed-mark={changedSet.has(n)} class:selected={isSelected(n)}>
                  <td class="num" onclick={(e) => click(e, n)}>{n}</td>
                  <td class="text"><CodeLine {tokens} /></td>
                </tr>
                {#each threadsAt(n) as t (t.id)}<tr class="comment-row"><td colspan="2"><ThreadView thread={t} /></td></tr>{/each}
                {#each draftsAt(n) as d (d.id)}<tr class="comment-row"><td colspan="2"><DraftView draft={d} /></td></tr>{/each}
                {@const target = editorAt(n)}
                {#if target}<tr class="comment-row"><td colspan="2"><CommentEditor {target} /></td></tr>{/if}
                {#if selectionEnd(n)}
                  <tr class="comment-row">
                    <td colspan="2">
                      <div class="sel-bar">
                        <span class="tiny muted">{app.selection!.from === app.selection!.to ? `line ${app.selection!.from}` : `lines ${app.selection!.from}-${app.selection!.to}`}</span>
                        <button class="small" onclick={() => selectionChip(app.selection!)}>＋ chat</button>
                        {#if canComment}<button class="small" onclick={commentOnSelection}>Comment</button>{/if}
                        <button class="ghost small" onclick={clearSelection}>✕</button>
                      </div>
                    </td>
                  </tr>
                {/if}
              {/if}
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}
</div>

<style>
  .viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
    flex-shrink: 0;
  }
  .path {
    background: none;
    border: none;
    padding: 0;
    font-weight: 600;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    text-align: left;
    min-width: 0;
  }
  .body {
    flex: 1;
    overflow: auto;
    min-height: 0;
  }
  .empty {
    padding: 16px;
    font-size: 13px;
  }
  .pad {
    padding: 12px;
  }
  .error {
    color: var(--concern);
  }
  .sel-bar {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 4px 10px;
    background: var(--sel-bg);
  }
  .viewer :global(.code-table td.num) {
    width: 4.2em;
  }
</style>
