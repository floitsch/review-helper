<!-- Copyright (C) 2026 Toit contributors.
     Use of this source code is governed by an MIT-style license that can be
     found in the LICENSE file. -->
<script lang="ts">
  import { tick } from 'svelte';
  import { api } from '../api.ts';
  import { app, toast } from '../store.svelte.ts';
  import { sendChat } from '../actions.ts';
  import BlockView from './BlockView.svelte';

  let text = $state('');
  let textarea: HTMLTextAreaElement | undefined = $state();
  let list: HTMLDivElement | undefined = $state();
  let sending = $state(false);

  $effect(() => {
    // Scroll to the bottom whenever a message arrives.
    app.chat.length;
    tick().then(() => {
      if (list) list.scrollTop = list.scrollHeight;
    });
  });

  export function focusInput() {
    textarea?.focus();
  }

  async function send() {
    const t = text.trim();
    if (!t && app.chips.length === 0) return;
    sending = true;
    text = '';
    await sendChat(t || '(see attached context)');
    sending = false;
    textarea?.focus();
  }

  function insertNewline() {
    if (!textarea) return;
    const s = textarea.selectionStart;
    const e = textarea.selectionEnd;
    text = text.slice(0, s) + '\n' + text.slice(e);
    tick().then(() => {
      if (textarea) textarea.selectionStart = textarea.selectionEnd = s + 1;
    });
  }

  function keydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      send();
    } else if ((e.key === 'j' && e.ctrlKey) || (e.key === 'Enter' && e.shiftKey)) {
      e.preventDefault();
      insertNewline();
    } else if (e.key === 'Escape') {
      textarea?.blur();
    }
  }

  function removeChip(id: string) {
    app.chips = app.chips.filter((c) => c.id !== id);
  }

  async function clear() {
    if (!confirm('Clear the chat history?')) return;
    try {
      await api.clearChat();
      app.chat = [];
    } catch (e) {
      toast(String(e), 'error');
    }
  }

  function when(ts: number): string {
    return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  const status = $derived(
    app.agent.connected === 0 ? { text: 'no agent connected', cls: 'off' } : app.agent.listening ? { text: 'agent listening', cls: 'on' } : { text: 'agent busy', cls: 'busy' },
  );
</script>

<div class="chat">
  <div class="head">
    <b>Chat</b>
    <span class="status {status.cls}" title="Agents connect through the MCP endpoint of the gateway">● {status.text}</span>
    <span class="spacer"></span>
    <button class="icon-btn" title="Clear chat" onclick={clear}>clear</button>
  </div>
  <div class="messages" bind:this={list}>
    {#if app.chat.length === 0}
      <div class="muted tiny hint">
        <p>Ask the agent about the change. Attach context with the <b>＋chat</b> buttons on sections, diffs and lines, or by selecting lines.</p>
        <p>Agents connect with: <span class="mono">claude mcp add --transport http review-helper http://localhost:{app.session?.port ?? 7777}/mcp</span></p>
      </div>
    {/if}
    {#each app.chat as m (m.id)}
      <div class="msg {m.role}">
        <div class="meta tiny muted">{m.role === 'user' ? 'you' : m.role} · {when(m.ts)}</div>
        {#if m.chips && m.chips.length > 0}
          <div class="chips small-chips">{#each m.chips as c}<span class="chip">{c.label}</span>{/each}</div>
        {/if}
        {#if m.blocks && m.blocks.length > 0}
          <BlockView blocks={m.blocks} inChat={true} />
        {:else}
          <div class="plain">{m.text}</div>
        {/if}
      </div>
    {/each}
  </div>
  <div class="input">
    {#if app.chips.length > 0}
      <div class="chips">
        {#each app.chips as c (c.id)}
          <span class="chip" title={c.kind}>{c.label} <button class="x" onclick={() => removeChip(c.id)}>✕</button></span>
        {/each}
      </div>
    {/if}
    <textarea
      bind:this={textarea}
      bind:value={text}
      rows="3"
      placeholder="Ask about the change… (Enter sends, Ctrl+J or Shift+Enter for a new line)"
      onkeydown={keydown}
    ></textarea>
    <div class="row">
      <span class="tiny muted">{app.chips.length} context item{app.chips.length === 1 ? '' : 's'}</span>
      <span class="spacer"></span>
      <button class="primary small" onclick={send} disabled={sending || (!text.trim() && app.chips.length === 0)}>Send</button>
    </div>
  </div>
</div>

<style>
  .chat {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
    flex-shrink: 0;
  }
  .spacer {
    flex: 1;
  }
  .status {
    font-size: 12px;
  }
  .status.on {
    color: var(--tip);
  }
  .status.busy {
    color: var(--warn);
  }
  .status.off {
    color: var(--fg-3);
  }
  .messages {
    flex: 1;
    overflow: auto;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
  }
  .hint p {
    margin: 4px 0;
  }
  .msg {
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 13px;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .msg.user {
    background: var(--accent-bg);
    align-self: flex-end;
    max-width: 90%;
  }
  .msg.agent {
    background: var(--bg-2);
    border: 1px solid var(--border-2);
  }
  .msg.system {
    color: var(--fg-2);
    font-style: italic;
  }
  .plain {
    white-space: pre-wrap;
  }
  .input {
    border-top: 1px solid var(--border);
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex-shrink: 0;
  }
  textarea {
    width: 100%;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 0 8px;
    font-size: 12px;
    line-height: 1.7;
  }
  .small-chips .chip {
    font-size: 11px;
    line-height: 1.5;
  }
  .chip .x {
    background: none;
    border: none;
    padding: 0;
    color: var(--fg-2);
    cursor: pointer;
    font-size: 11px;
  }
  .chip .x:hover {
    color: var(--concern);
  }
</style>
