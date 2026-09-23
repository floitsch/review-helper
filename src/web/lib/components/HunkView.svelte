<!-- Copyright (C) 2026 Toit contributors.
     Use of this source code is governed by an MIT-style license that can be
     found in the LICENSE file. -->
<script lang="ts">
  import type { Annotation, DiffLine, Hunk } from '../../../shared/types.ts';
  import { hunkRows, type Row } from '../diffutil.ts';
  import { addChip, app, openFile } from '../store.svelte.ts';
  import { commentOnSelection, selectLine, selectionChip, clearSelection } from '../actions.ts';
  import CodeLine from './CodeLine.svelte';
  import CommentEditor from './CommentEditor.svelte';
  import DraftView from './DraftView.svelte';
  import ThreadView from './ThreadView.svelte';

  let {
    hunk,
    annotations = [],
    view,
    ws,
    from,
    to,
    focus,
  }: {
    hunk: Hunk;
    annotations?: Annotation[];
    view?: 'split' | 'unified';
    ws?: 'ignore' | 'show';
    /** Revisions the diff was computed for. */
    from: string;
    to: string;
    /** Only show rows around this line range (plus context); the rest is collapsed. */
    focus?: { side: 'new' | 'old'; from: number; to: number };
  } = $props();

  let showHidden = $state(false);
  let showAll = $state(false);
  let openAnn = $state(new Set<string>());

  const split = $derived((view ?? app.prefs.view) === 'split');
  const hideWs = $derived(ws ? ws === 'ignore' : app.prefs.hideWs);
  const rows = $derived(
    hunkRows(hunk, { split, wordDiff: app.prefs.wordDiff, hideWs: hideWs && !showHidden, hideMoved: app.prefs.hideMoved && !showHidden }),
  );
  const cols = 4;
  const FOCUS_CONTEXT = 3;

  const displayRows = $derived.by((): Row[] => {
    const f = focus;
    if (!f || showAll) return rows;
    let lo = Infinity;
    let hi = -Infinity;
    rows.forEach((r, i) => {
      const n = f.side === 'new' ? r.new?.newNo : r.old?.oldNo;
      if (n !== undefined && n >= f.from && n <= f.to) {
        lo = Math.min(lo, i);
        hi = Math.max(hi, i);
      }
    });
    if (lo === Infinity) return rows;
    lo = Math.max(0, lo - FOCUS_CONTEXT);
    hi = Math.min(rows.length - 1, hi + FOCUS_CONTEXT);
    if (lo === 0 && hi === rows.length - 1) return rows;
    const out: Row[] = [];
    if (lo > 0) out.push({ key: 'focus-top', collapsed: lo, collapsedKind: 'focus' });
    out.push(...rows.slice(lo, hi + 1));
    if (hi < rows.length - 1) out.push({ key: 'focus-bottom', collapsed: rows.length - 1 - hi, collapsedKind: 'focus' });
    return out;
  });

  const annMap = $derived.by(() => {
    const m = new Map<string, Annotation[]>();
    for (const a of annotations) {
      const key = `${a.side}:${a.line}`;
      const list = m.get(key) ?? [];
      list.push(a);
      m.set(key, list);
    }
    return m;
  });

  const commentsOnNew = $derived(!!app.session && to === app.session.headSha);
  const commentsOnOld = $derived(!!app.session && from === app.session.baseSha);

  function draftsAt(side: 'new' | 'old', line: number | undefined) {
    if (line === undefined) return [];
    if (side === 'new' ? !commentsOnNew : !commentsOnOld) return [];
    const s = side === 'new' ? 'RIGHT' : 'LEFT';
    return app.state.drafts.filter((d) => d.path === hunk.file && d.side === s && d.line === line);
  }
  function threadsAt(side: 'new' | 'old', line: number | undefined) {
    if (line === undefined || !app.pr) return [];
    if (side === 'new' ? !commentsOnNew : !commentsOnOld) return [];
    const s = side === 'new' ? 'RIGHT' : 'LEFT';
    return app.pr.threads.filter((t) => t.path === hunk.file && t.side === s && t.line === line && (app.prefs.showResolved || !t.resolved));
  }
  function editorAt(side: 'new' | 'old', line: number | undefined) {
    const t = app.commentTarget;
    if (!t || t.draftId || line === undefined) return null;
    const s = side === 'new' ? 'RIGHT' : 'LEFT';
    return t.path === hunk.file && t.side === s && t.line === line ? t : null;
  }

  function annsFor(row: Row): { key: string; side: 'new' | 'old'; anns: Annotation[] }[] {
    const out = [];
    if (row.new?.newNo !== undefined) {
      const key = `new:${row.new.newNo}`;
      const a = annMap.get(key);
      if (a) out.push({ key, side: 'new' as const, anns: a });
    }
    if (row.old?.oldNo !== undefined && row.old !== row.new) {
      const key = `old:${row.old.oldNo}`;
      const a = annMap.get(key);
      if (a) out.push({ key, side: 'old' as const, anns: a });
    }
    return out;
  }

  function annVisible(key: string): boolean {
    const mode = app.prefs.annotations;
    if (mode === 'off') return false;
    if (mode === 'inline') return true;
    return openAnn.has(key);
  }
  function toggleAnn(key: string) {
    const s = new Set(openAnn);
    if (s.has(key)) s.delete(key);
    else s.add(key);
    openAnn = s;
  }

  function revFor(side: 'new' | 'old'): string {
    return side === 'new' ? to : from;
  }

  function click(e: MouseEvent, side: 'new' | 'old', line: number | undefined) {
    if (line === undefined) return;
    e.preventDefault();
    selectLine(e, { file: side === 'old' && hunk.file !== fileFor(side) ? fileFor(side) : hunk.file, rev: revFor(side), side, from: line, origin: 'diff', hunkId: hunk.id });
  }

  function fileFor(side: 'new' | 'old'): string {
    if (side === 'new') return hunk.file;
    const f = app.rangeDiff?.files.find((x) => x.path === hunk.file) ?? app.fullDiff?.files.find((x) => x.path === hunk.file);
    return f?.oldPath ?? hunk.file;
  }

  function isSelected(side: 'new' | 'old', line: number | undefined): boolean {
    const s = app.selection;
    if (!s || line === undefined) return false;
    return s.side === side && s.rev === revFor(side) && s.file === fileFor(side) && line >= s.from && line <= s.to;
  }
  function selectionEndsHere(row: Row): boolean {
    const s = app.selection;
    if (!s || s.hunkId !== hunk.id) return false;
    const l = s.side === 'new' ? row.new?.newNo : row.old?.oldNo;
    return l === s.to;
  }

  function rowClass(row: Row): string {
    const l = row.new ?? row.old;
    const c: string[] = [];
    if (!split && l) {
      c.push(l.kind);
      if (l.ws) c.push('ws');
      if (l.moved) c.push('moved');
    }
    if (isSelected('new', row.new?.newNo) || isSelected('old', row.old?.oldNo)) c.push('selected');
    return c.join(' ');
  }

  function cellClass(l: DiffLine | undefined): string {
    if (!l) return 'text split-empty';
    const c = ['text', `cell-${l.kind}`];
    if (l.ws) c.push('ws');
    if (l.moved) c.push('moved');
    return c.join(' ');
  }

  function movedTitle(l: DiffLine): string {
    if (!l.moved || !l.movedRef) return '';
    return `${l.moved === 'from' ? 'moved from' : 'moved to'} ${l.movedRef.file}:${l.movedRef.line}`;
  }

  function openMoved(l: DiffLine) {
    if (!l.movedRef) return;
    openFile(l.movedRef.file, l.movedRef.line, l.moved === 'from' ? from : to);
  }

  function attachAnnotation(a: Annotation) {
    addChip({ kind: 'comment', label: `note ${hunk.file}:${a.line}`, text: `Explanation for ${hunk.file} line ${a.line}${a.side === 'old' ? ' (old)' : ''}: ${a.text}`, file: hunk.file, line: a.line });
  }

  function focusThis() {
    app.focusedHunk = hunk.id;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<div class="hunk" class:focused={app.focusedHunk === hunk.id} data-hunk={hunk.id} onclick={focusThis}>
  <div class="hunk-header mono">
    <span class="muted">@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</span>
    <span class="ctx">{hunk.header}</span>
    {#if hunk.wsOnly}<span class="badge">whitespace only</span>{:else if hunk.movedOnly}<span class="badge">moved code</span>{/if}
  </div>
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <table class="code-table" class:split>
    {#if split}
      <colgroup><col class="c-num" /><col class="c-half" /><col class="c-num" /><col class="c-half" /></colgroup>
    {:else}
      <colgroup><col class="c-num" /><col class="c-num" /><col class="c-sign" /><col /></colgroup>
    {/if}
    <tbody>
      {#each displayRows as row (row.key)}
        {#if row.collapsed !== undefined}
          <tr class="collapsed" onclick={() => (row.collapsedKind === 'focus' ? (showAll = true) : (showHidden = true))}>
            <td colspan={cols}>
              {#if row.collapsedKind === 'focus'}
                ⋯ {row.collapsed} line{row.collapsed === 1 ? '' : 's'} of this hunk outside the referenced range – click to show the whole hunk
              {:else}
                {row.collapsed} {row.collapsedKind === 'ws' ? 'whitespace-only' : 'moved'} line{row.collapsed === 1 ? '' : 's'} hidden – click to show
              {/if}
            </td>
          </tr>
        {:else if split}
          <tr class={rowClass(row)} data-new={row.new?.newNo} data-old={row.old?.oldNo}>
            <td class="num" class:cell-del={row.old?.kind === 'del'} onclick={(e) => click(e, 'old', row.old?.oldNo)}>{row.old?.oldNo ?? ''}</td>
            <td class={cellClass(row.old)} class:selected={isSelected('old', row.old?.oldNo)}>
              {#if row.old}{#if row.old.moved}<span class="ann-mark moved-mark" title={movedTitle(row.old)} onclick={() => openMoved(row.old!)}>↷</span>{/if}<CodeLine tokens={row.oldTokens ?? []} />{/if}
            </td>
            <td class="num" class:cell-add={row.new?.kind === 'add'} onclick={(e) => click(e, 'new', row.new?.newNo)}>{row.new?.newNo ?? ''}</td>
            <td class={cellClass(row.new)} class:selected={isSelected('new', row.new?.newNo)}>
              {#if row.new}
                {#each annsFor(row).filter((x) => x.side === 'new') as a}<span class="ann-mark" title={a.anns.map((x) => x.text).join('\n')} onclick={() => toggleAnn(a.key)}>ⓘ</span>{/each}
                {#if row.new.moved}<span class="ann-mark moved-mark" title={movedTitle(row.new)} onclick={() => openMoved(row.new!)}>↷</span>{/if}<CodeLine tokens={row.newTokens ?? []} />
              {/if}
            </td>
          </tr>
        {:else}
          {@const l = row.new ?? row.old!}
          <tr class={rowClass(row)} data-new={row.new?.newNo} data-old={row.old?.oldNo}>
            <td class="num" onclick={(e) => click(e, 'old', row.old?.oldNo)}>{row.old?.oldNo ?? ''}</td>
            <td class="num" onclick={(e) => click(e, 'new', row.new?.newNo)}>{row.new?.newNo ?? ''}</td>
            <td class="sign">
              {#if l.moved}<span class="ann-mark moved-mark" title={movedTitle(l)} onclick={() => openMoved(l)}>↷</span>
              {:else if annsFor(row).length > 0 && app.prefs.annotations !== 'off'}
                {#each annsFor(row) as a}<span class="ann-mark" title={a.anns.map((x) => x.text).join('\n')} onclick={() => toggleAnn(a.key)}>ⓘ</span>{/each}
              {:else}{l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ''}{/if}
            </td>
            <td class="text"><CodeLine tokens={(row.new ? row.newTokens : row.oldTokens) ?? []} /></td>
          </tr>
        {/if}
        {#if row.collapsed === undefined}
          {#each annsFor(row) as a}
            {#if annVisible(a.key)}
              <tr class="annotation-row">
                <td colspan={cols}>
                  {#each a.anns as ann}
                    <div class="ann hoverable">
                      <span class="tiny muted mono">{a.side === 'old' ? 'old ' : ''}L{ann.line}{ann.endLine ? `-${ann.endLine}` : ''}</span>
                      <span class="prose ann-body">{@html ann.html}</span>
                      <span class="actions"><button class="icon-btn" title="Add to chat" onclick={() => attachAnnotation(ann)}>＋chat</button></span>
                    </div>
                  {/each}
                </td>
              </tr>
            {/if}
          {/each}
          {#each ['old', 'new'] as const as side}
            {@const line = side === 'new' ? row.new?.newNo : row.old?.oldNo}
            {#if !(side === 'old' && row.old === row.new)}
              {#each threadsAt(side, line) as t (t.id)}
                <tr class="comment-row"><td colspan={cols}><ThreadView thread={t} /></td></tr>
              {/each}
              {#each draftsAt(side, line) as d (d.id)}
                <tr class="comment-row"><td colspan={cols}><DraftView draft={d} /></td></tr>
              {/each}
              {@const target = editorAt(side, line)}
              {#if target}
                <tr class="comment-row"><td colspan={cols}><CommentEditor {target} /></td></tr>
              {/if}
            {/if}
          {/each}
          {#if selectionEndsHere(row)}
            <tr class="comment-row selection-actions">
              <td colspan={cols}>
                <div class="sel-bar">
                  <span class="tiny muted">{app.selection!.from === app.selection!.to ? `line ${app.selection!.from}` : `lines ${app.selection!.from}-${app.selection!.to}`}</span>
                  <button class="small" onclick={() => selectionChip(app.selection!)}>＋ chat</button>
                  <button class="small" onclick={commentOnSelection}>Comment</button>
                  <button class="small" onclick={() => openFile(app.selection!.file, app.selection!.from, app.selection!.rev)}>Open file</button>
                  <button class="ghost small" onclick={clearSelection}>✕</button>
                  <span class="tiny muted">shift-click a line number to extend</span>
                </div>
              </td>
            </tr>
          {/if}
        {/if}
      {/each}
    </tbody>
  </table>
</div>

<style>
  .hunk {
    border-top: 1px solid var(--border-2);
  }
  .hunk.focused {
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .hunk-header {
    padding: 2px 10px;
    background: var(--bg-2);
    color: var(--fg-2);
    font-size: 12px;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .hunk-header .ctx {
    color: var(--fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  col.c-num {
    width: 3.6em;
  }
  col.c-sign {
    width: 1.2em;
  }
  col.c-half {
    width: 50%;
  }
  .hunk :global(td.cell-add) {
    background: var(--add-bg);
  }
  .hunk :global(td.cell-del) {
    background: var(--del-bg);
  }
  .hunk :global(td.num.cell-add) {
    background: var(--add-num);
  }
  .hunk :global(td.num.cell-del) {
    background: var(--del-num);
  }
  .hunk :global(td.text.ws),
  .hunk :global(td.text.moved) {
    opacity: 0.55;
  }
  .hunk :global(td.text.selected) {
    background: var(--sel-bg) !important;
  }
  .moved-mark {
    color: var(--fg-3);
    cursor: pointer;
  }
  .ann {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .ann-body {
    flex: 1;
  }
  .ann-body :global(p) {
    margin: 0;
  }
  .sel-bar {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 4px 10px;
    background: var(--sel-bg);
  }
</style>
