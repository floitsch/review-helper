// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

import type { Chip, DiffSet, DraftComment, HighlightedFile, ReviewState, ServerMessage } from '../../shared/types.ts';
import { app, toast } from './store.svelte.ts';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${method} ${path}: ${res.status}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  diff: (from: string, to: string) => request<DiffSet>('GET', `/api/diff?from=${from}&to=${to}`),
  file: (path: string, rev: string) => request<HighlightedFile>('GET', `/api/file?path=${encodeURIComponent(path)}&rev=${rev}`),
  files: () => request<string[]>('GET', '/api/files'),
  chat: (text: string, chips: Chip[]) => request('POST', '/api/chat', { text, chips }),
  clearChat: () => request('POST', '/api/chat/clear', {}),
  state: (patch: Partial<ReviewState>) => request<ReviewState>('POST', '/api/state', patch),
  markReviewed: () => request<ReviewState>('POST', '/api/mark-reviewed', {}),
  addDraft: (d: Omit<DraftComment, 'id' | 'ts'>) => request<DraftComment>('POST', '/api/drafts', d),
  updateDraft: (d: Partial<DraftComment> & { id: string }) => request('PUT', '/api/drafts', d),
  deleteDraft: (id: string) => request('DELETE', `/api/drafts?id=${id}`),
  submitReview: (event: string, body: string) => request<{ url: string }>('POST', '/api/review/submit', { event, body }),
  refresh: () => request('POST', '/api/refresh', {}),
  refreshPr: () => request('POST', '/api/pr/refresh', {}),
};

let ws: WebSocket | null = null;

export function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    app.connected = true;
  };
  ws.onclose = () => {
    app.connected = false;
    setTimeout(connect, 1500);
  };
  ws.onerror = () => ws?.close();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data) as ServerMessage;
    handle(msg).catch((e) => toast(String(e), 'error'));
  };
}

let lastHead: string | null = null;

async function handle(msg: ServerMessage) {
  switch (msg.type) {
    case 'session': {
      app.session = msg.session;
      const headChanged = lastHead !== null && lastHead !== msg.session.headSha;
      lastHead = msg.session.headSha;
      if (!app.range || headChanged || app.range.to !== msg.session.headSha) {
        await setRange({ from: msg.session.baseSha, to: msg.session.headSha, label: 'All changes' });
      }
      if (headChanged) toast('New commits on the branch. Diff reloaded.');
      break;
    }
    case 'doc':
      app.doc = msg.doc;
      await loadStaleDiff();
      break;
    case 'state':
      app.state = msg.state;
      app.chat = msg.state.chat;
      break;
    case 'chat':
      app.chat.push(msg.message);
      app.state.chat = app.chat;
      break;
    case 'agent':
      app.agent = msg.status;
      break;
    case 'pr':
      app.pr = msg.conversation;
      break;
    case 'toast':
      toast(msg.text, msg.level);
      break;
  }
}

export async function setRange(range: { from: string; to: string; label: string }) {
  const s = app.session;
  if (!s) return;
  const full = range.from === s.baseSha && range.to === s.headSha;
  if (!app.fullDiff || app.fullDiff.from !== s.baseSha || app.fullDiff.to !== s.headSha) {
    app.fullDiff = await api.diff(s.baseSha, s.headSha);
  }
  app.rangeDiff = full ? app.fullDiff : await api.diff(range.from, range.to);
  app.range = range;
}

async function loadStaleDiff() {
  const s = app.session;
  const d = app.doc;
  if (!s || !d?.head || d.head === s.headSha || !/^[0-9a-f]{7,40}$/.test(d.head)) {
    app.staleDiff = null;
    return;
  }
  try {
    app.staleDiff = await api.diff(d.head, s.headSha);
  } catch {
    app.staleDiff = null;
  }
}

export async function ensureFiles(): Promise<Set<string>> {
  if (!app.files) {
    try {
      app.files = new Set(await api.files());
    } catch {
      app.files = new Set();
    }
  }
  return app.files;
}
