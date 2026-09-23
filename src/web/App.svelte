<!-- Copyright (C) 2026 Toit contributors.
     Use of this source code is governed by an MIT-style license that can be
     found in the LICENSE file. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './lib/store.svelte.ts';
  import { installKeys } from './lib/keys.ts';
  import Toolbar from './lib/components/Toolbar.svelte';
  import Doc from './lib/components/Doc.svelte';
  import FileViewer from './lib/components/FileViewer.svelte';
  import Chat from './lib/components/Chat.svelte';
  import ReviewPanel from './lib/components/ReviewPanel.svelte';
  import Help from './lib/components/Help.svelte';

  let chat: Chat | undefined = $state();
  let width = $state(window.innerWidth);
  const wide = $derived(width >= 1500);

  onMount(() => {
    installKeys(() => chat?.focusInput());
    const onResize = () => (width = window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  // Splitter dragging: adjusts a width preference while the mouse moves.
  function drag(e: MouseEvent, which: 'file' | 'chat') {
    e.preventDefault();
    const startX = e.clientX;
    const start = which === 'file' ? app.prefs.fileWidth : app.prefs.chatWidth;
    const move = (ev: MouseEvent) => {
      const w = Math.max(280, Math.min(window.innerWidth * 0.6, start + (startX - ev.clientX)));
      if (which === 'file') app.prefs.fileWidth = w;
      else app.prefs.chatWidth = w;
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  const sideWidth = $derived(wide ? app.prefs.fileWidth + app.prefs.chatWidth + 6 : Math.max(app.prefs.chatWidth, app.prefs.fileWidth));
</script>

<div class="app">
  <Toolbar />
  <div class="main" style="--side: {sideWidth}px; --file: {app.prefs.fileWidth}px; --chat: {app.prefs.chatWidth}px">
    <div class="doc-col">
      <Doc />
    </div>
    {#if wide}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="splitter" onmousedown={(e) => drag(e, 'file')}></div>
      <div class="file-col"><FileViewer /></div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="splitter" onmousedown={(e) => drag(e, 'chat')}></div>
      <div class="chat-col"><Chat bind:this={chat} /></div>
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="splitter" onmousedown={(e) => drag(e, app.prefs.sideTab)}></div>
      <div class="side-col">
        <div class="tabs">
          <button class:active={app.prefs.sideTab === 'file'} onclick={() => (app.prefs.sideTab = 'file')}>File{#if app.fileView} <span class="tiny muted mono">{app.fileView.path.split('/').pop()}</span>{/if}</button>
          <button class:active={app.prefs.sideTab === 'chat'} onclick={() => (app.prefs.sideTab = 'chat')}>Chat{#if app.chips.length > 0} <span class="badge accent">{app.chips.length}</span>{/if}</button>
        </div>
        <div class="tab-body" class:hidden={app.prefs.sideTab !== 'file'}><FileViewer /></div>
        <div class="tab-body" class:hidden={app.prefs.sideTab !== 'chat'}><Chat bind:this={chat} /></div>
      </div>
    {/if}
  </div>
  <div class="toasts">
    {#each app.toasts as t (t.id)}
      <div class="toast {t.level}">{t.text}</div>
    {/each}
  </div>
  {#if app.showReview}<ReviewPanel />{/if}
  {#if app.showHelp}<Help />{/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .main {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .doc-col {
    flex: 1;
    min-width: 0;
    overflow: auto;
  }
  .file-col {
    width: var(--file);
    flex-shrink: 0;
    min-height: 0;
    border-left: 1px solid var(--border);
  }
  .chat-col {
    width: var(--chat);
    flex-shrink: 0;
    min-height: 0;
    border-left: 1px solid var(--border);
  }
  .side-col {
    width: var(--side);
    flex-shrink: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--border);
  }
  .tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
  }
  .tabs button {
    flex: 1;
    border: none;
    border-radius: 0;
    background: transparent;
    padding: 5px;
  }
  .tabs button.active {
    background: var(--bg);
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  .tab-body {
    flex: 1;
    min-height: 0;
  }
  .tab-body.hidden {
    display: none;
  }
  .splitter {
    width: 5px;
    cursor: col-resize;
    background: transparent;
    flex-shrink: 0;
  }
  .splitter:hover {
    background: var(--accent);
    opacity: 0.4;
  }
  .toasts {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 6px;
    z-index: 100;
    pointer-events: none;
  }
  .toast {
    background: var(--fg);
    color: var(--bg);
    padding: 6px 14px;
    border-radius: 8px;
    font-size: 13px;
    box-shadow: var(--shadow);
  }
  .toast.error {
    background: var(--concern);
    color: #fff;
  }
</style>
