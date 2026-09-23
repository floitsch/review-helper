<!-- Copyright (C) 2026 Toit contributors.
     Use of this source code is governed by an MIT-style license that can be
     found in the LICENSE file. -->
<script lang="ts">
  import type { Block, ChangeBlock } from '../../../shared/types.ts';
  import { api, setRange } from '../api.ts';
  import { app, toast } from '../store.svelte.ts';
  import { changeReviewedState } from '../actions.ts';

  const s = $derived(app.session);

  interface RangeOption {
    key: string;
    label: string;
    from: string;
    to: string;
  }

  const rangeOptions = $derived.by((): RangeOption[] => {
    if (!s) return [];
    const opts: RangeOption[] = [{ key: 'all', label: 'All changes', from: s.baseSha, to: s.headSha }];
    const last = app.state.lastReviewedSha;
    if (last && last !== s.headSha) {
      const idx = s.commits.findIndex((c) => c.sha === last);
      const n = idx >= 0 ? s.commits.length - idx - 1 : undefined;
      opts.push({ key: 'since-review', label: `Since last review${n !== undefined ? ` (${n} commit${n === 1 ? '' : 's'})` : ''}`, from: last, to: s.headSha });
    }
    for (let i = 0; i < s.commits.length; i++) {
      const c = s.commits[i];
      if (i < s.commits.length - 1) {
        opts.push({ key: `since-${c.sha}`, label: `Since ${c.shortSha} ${c.subject.slice(0, 40)}`, from: c.sha, to: s.headSha });
      }
    }
    for (const c of s.commits) {
      opts.push({ key: `only-${c.sha}`, label: `Only ${c.shortSha} ${c.subject.slice(0, 40)}`, from: `${c.sha}^`, to: c.sha });
    }
    return opts;
  });

  const currentKey = $derived(rangeOptions.find((o) => o.from === app.range?.from && o.to === app.range?.to)?.key ?? 'all');

  async function pickRange(e: Event) {
    const key = (e.target as HTMLSelectElement).value;
    const o = rangeOptions.find((x) => x.key === key);
    if (!o) return;
    try {
      await setRange({ from: o.from, to: o.to, label: o.label });
    } catch (err) {
      toast(String(err), 'error');
    }
  }

  const progress = $derived.by(() => {
    const changes: ChangeBlock[] = [];
    const walk = (bs: Block[]) => {
      for (const b of bs) {
        if (b.type === 'change') changes.push(b);
        if ('blocks' in b) walk(b.blocks);
      }
    };
    walk(app.doc?.blocks ?? []);
    const done = changes.filter((c) => changeReviewedState(c) === 'yes').length;
    let hunks = 0;
    let hunksDone = 0;
    for (const f of app.fullDiff?.files ?? []) {
      for (const h of f.hunks) {
        hunks++;
        if (app.state.reviewedHunks[h.id]) hunksDone++;
      }
    }
    return { changes: changes.length, done, hunks, hunksDone };
  });

  async function refresh() {
    try {
      await api.refresh();
      if (s?.pr) await api.refreshPr();
      toast('Refreshed');
    } catch (e) {
      toast(String(e), 'error');
    }
  }

  function cycleTheme() {
    const order = ['auto', 'light', 'dark'] as const;
    app.prefs.theme = order[(order.indexOf(app.prefs.theme) + 1) % order.length];
  }
</script>

<div class="toolbar">
  <div class="group title">
    <b>Review</b>
    {#if s}
      <span class="muted">{s.repoName}</span>
      {#if s.pr}<a href={s.pr.url} target="_blank" rel="noreferrer">#{s.pr.number}</a>{:else}<span class="mono tiny muted">{s.base}..{s.head}</span>{/if}
    {/if}
    {#if !app.connected}<span class="badge concern">disconnected</span>{/if}
  </div>

  <div class="group">
    <select value={currentKey} onchange={pickRange} title="Which commits to show">
      {#each rangeOptions as o (o.key)}<option value={o.key}>{o.label}</option>{/each}
    </select>
    <button class="ghost small" onclick={refresh} title="Re-read git and GitHub">↻</button>
  </div>

  <div class="group toggles">
    <button class="small" class:active={app.prefs.view === 'split'} onclick={() => (app.prefs.view = app.prefs.view === 'split' ? 'unified' : 'split')} title="Toggle side-by-side (s)">
      {app.prefs.view === 'split' ? 'split' : 'unified'}
    </button>
    <label title="Hide whitespace-only changes (w)"><input type="checkbox" bind:checked={app.prefs.hideWs} /> hide ws</label>
    <label title="Hide moved code (m)"><input type="checkbox" bind:checked={app.prefs.hideMoved} /> hide moved</label>
    <label title="Highlight changed words within a line"><input type="checkbox" bind:checked={app.prefs.wordDiff} /> word diff</label>
    <label title="Line-by-line explanations from the document">
      notes
      <select bind:value={app.prefs.annotations}>
        <option value="gutter">in gutter</option>
        <option value="inline">inline</option>
        <option value="off">off</option>
      </select>
    </label>
    {#if s?.pr}<label title="Show resolved review threads"><input type="checkbox" bind:checked={app.prefs.showResolved} /> resolved</label>{/if}
  </div>

  <div class="group right">
    <span class="progress tiny" title="Changes marked reviewed / hunks marked reviewed">
      {#if progress.changes > 0}<span class:done={progress.done === progress.changes}>{progress.done}/{progress.changes} changes</span> ·{/if}
      <span class:done={progress.hunksDone === progress.hunks}>{progress.hunksDone}/{progress.hunks} hunks</span>
    </span>
    <button class="small" onclick={() => (app.showReview = true)}>
      Review{#if app.state.drafts.length > 0} <span class="badge accent">{app.state.drafts.length}</span>{/if}
    </button>
    <button class="ghost small" onclick={cycleTheme} title="Theme: {app.prefs.theme}">{app.prefs.theme === 'dark' ? '☾' : app.prefs.theme === 'light' ? '☀' : '◐'}</button>
    <button class="ghost small" onclick={() => (app.showHelp = true)} title="Keyboard shortcuts (?)">?</button>
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 4px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
    flex-wrap: wrap;
    min-height: 36px;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .title {
    gap: 8px;
  }
  .right {
    margin-left: auto;
  }
  .toggles label {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 12px;
    color: var(--fg-2);
    cursor: pointer;
  }
  .toggles select {
    padding: 1px 4px;
    font-size: 12px;
  }
  button.active {
    background: var(--accent-bg);
    border-color: var(--accent);
    color: var(--accent);
  }
  .progress .done {
    color: var(--tip);
  }
  select {
    max-width: 320px;
  }
</style>
