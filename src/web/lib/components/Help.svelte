<!-- Copyright (C) 2026 Toit contributors.
     Use of this source code is governed by an MIT-style license that can be
     found in the LICENSE file. -->
<script lang="ts">
  import { app } from '../store.svelte.ts';

  const keys: [string, string][] = [
    ['j / k', 'next / previous hunk'],
    ['n / p', 'next / previous change'],
    ['x', 'toggle “reviewed” on the focused hunk'],
    ['r', 'toggle “reviewed” on the change around the focused hunk'],
    ['a', 'add focused hunk (or selected lines) to the chat context'],
    ['c', 'comment on the selected lines'],
    ['f', 'open the focused hunk in the file viewer'],
    ['/', 'focus the chat input'],
    ['s', 'toggle split / unified diff'],
    ['w', 'toggle hiding whitespace-only changes'],
    ['m', 'toggle hiding moved code'],
    ['t', 'toggle side panel tab (file / chat) on narrow layouts'],
    ['Esc', 'clear selection, close dialogs'],
    ['?', 'this help'],
  ];
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div class="backdrop" onclick={() => (app.showHelp = false)}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="panel" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
    <div class="head"><b>Keyboard shortcuts</b><button class="ghost small close" onclick={() => (app.showHelp = false)}>✕</button></div>
    <table>
      <tbody>
        {#each keys as [k, d]}
          <tr><td><kbd>{k}</kbd></td><td>{d}</td></tr>
        {/each}
      </tbody>
    </table>
    <div class="tips tiny muted">
      <p>Click a line number to select a line, shift-click to extend. Selections can be attached to the chat or commented on.</p>
      <p>In the chat, <kbd>Enter</kbd> sends; <kbd>Ctrl+J</kbd> or <kbd>Shift+Enter</kbd> inserts a new line.</p>
      <p>Agents connect with <span class="mono">claude mcp add --transport http review-helper http://localhost:{app.session?.port ?? 7777}/mcp</span>.</p>
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
    align-items: center;
    justify-content: center;
  }
  .panel {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow);
    padding: 12px 18px;
    width: min(560px, 94vw);
  }
  .head {
    display: flex;
    align-items: center;
    margin-bottom: 8px;
  }
  .close {
    margin-left: auto;
  }
  td {
    padding: 2px 10px 2px 0;
    font-size: 13px;
  }
  .tips p {
    margin: 4px 0;
  }
</style>
