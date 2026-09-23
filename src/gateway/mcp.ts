// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

// MCP server that agents connect to (streamable HTTP at /mcp).

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Session } from './session.ts';
import type { ChatMessage, Hunk } from '../shared/types.ts';

const transports = new Map<string, StreamableHTTPServerTransport>();

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] };
}

function hunkSummary(h: Hunk): string {
  const adds = h.lines.filter((l) => l.kind === 'add').length;
  const dels = h.lines.filter((l) => l.kind === 'del').length;
  const first = h.lines.find((l) => l.kind !== 'ctx');
  const flags = [h.wsOnly ? 'whitespace-only' : '', h.movedOnly ? 'moved-only' : ''].filter(Boolean).join(', ');
  const newRange = h.newLines === 0 ? `(deleted at ${h.newStart})` : `new ${h.newStart}-${h.newStart + h.newLines - 1}`;
  const oldRange = h.oldLines === 0 ? '' : ` old ${h.oldStart}-${h.oldStart + h.oldLines - 1}`;
  return `  - ${newRange}${oldRange}  +${adds}/-${dels}${flags ? ` [${flags}]` : ''}${h.header ? `  ${h.header}` : ''}\n      first change: ${first ? (first.kind === 'add' ? '+' : '-') + first.text.trim().slice(0, 80) : ''}`;
}

function createServer(session: Session): McpServer {
  const server = new McpServer({ name: 'review-helper', version: '0.1.0' });

  server.registerTool(
    'get_session',
    {
      title: 'Get review session',
      description:
        'Returns the repository, base/head revisions, commits and pull request of the review session, and the path of the review document (.review/doc.md) that the viewer renders.',
    },
    async () => {
      const i = session.info;
      const lines = [
        `repo: ${i.repo} (${i.repoName})`,
        `base: ${i.base} = ${i.baseSha}`,
        `head: ${i.head} = ${i.headSha}`,
        `review document: ${i.docPath}`,
        `last reviewed head: ${session.state.lastReviewedSha ?? '(never)'}`,
        i.pr ? `pull request: #${i.pr.number} "${i.pr.title}" by ${i.pr.author} (${i.pr.url})\n  ${i.pr.headRefName} -> ${i.pr.baseRefName}` : 'pull request: none (local branch review)',
        `commits (oldest first):`,
        ...i.commits.map((c) => `  ${c.shortSha} ${c.subject} (${c.author})`),
      ];
      if (i.pr?.body) lines.push('', 'PR description:', i.pr.body);
      return text(lines.join('\n'));
    },
  );

  server.registerTool(
    'list_hunks',
    {
      title: 'List diff hunks',
      description:
        'Lists every hunk of the base..head diff with its line ranges in the new (and old) file. Use these ranges in `:::diff{file=... lines=...}` blocks of the review document so that each hunk is referenced. Optionally filter by file.',
      inputSchema: { file: z.string().optional().describe('Only list hunks of this file') },
    },
    async ({ file }) => {
      const out: string[] = [];
      for (const f of session.fullDiff.files) {
        if (file && f.path !== file && f.oldPath !== file) continue;
        const status = f.status + (f.oldPath ? ` from ${f.oldPath}` : '');
        out.push(`${f.path} (${status}${f.binary ? ', binary' : ''})`);
        for (const h of f.hunks) out.push(hunkSummary(h));
      }
      if (out.length === 0) out.push(file ? `${file} is not part of the diff.` : 'The diff is empty.');
      return text(out.join('\n'));
    },
  );

  server.registerTool(
    'check_doc',
    {
      title: 'Check review document',
      description:
        'Re-parses the review document and reports parse warnings (e.g. diff blocks that match no hunk) and coverage: hunks that no diff block references. Call this after writing the document and fix what it reports.',
    },
    async () => {
      await session.reloadDoc();
      const d = session.doc;
      if (!d.exists) return text(`No review document at ${session.docPath}.`);
      const out: string[] = [];
      out.push(`Warnings: ${d.warnings.length === 0 ? 'none' : ''}`);
      for (const w of d.warnings) out.push(`  - ${w}`);
      const n = d.uncovered.reduce((a, u) => a + u.hunkIds.length, 0);
      out.push(`Uncovered hunks: ${n === 0 ? 'none, every hunk is referenced' : n}`);
      for (const u of d.uncovered) {
        const f = session.fullDiff.files.find((x) => x.path === u.file);
        out.push(`${u.file}`);
        for (const id of u.hunkIds) {
          const h = f?.hunks.find((x) => x.id === id);
          if (h) out.push(hunkSummary(h));
        }
      }
      return text(out.join('\n'));
    },
  );

  server.registerTool(
    'wait_for_message',
    {
      title: 'Wait for a chat message',
      description:
        'Blocks until the reviewer sends a chat message (or the timeout expires) and returns it together with the context the reviewer attached (document blocks, diff hunks, code lines). If it returns without a message, simply call it again. Answer with `reply`.',
      inputSchema: {
        timeout_seconds: z.number().min(1).max(600).optional().describe('How long to wait, default 55'),
      },
    },
    async ({ timeout_seconds }) => {
      const msgs = await session.waitForMessages((timeout_seconds ?? 55) * 1000);
      if (msgs.length === 0) return text('No message within the timeout. Call wait_for_message again to keep listening.');
      const parts: string[] = [];
      for (const m of msgs) parts.push(await formatMessage(session, m));
      return text(parts.join('\n\n---\n\n'));
    },
  );

  server.registerTool(
    'reply',
    {
      title: 'Reply in the chat',
      description:
        'Posts a message to the reviewer chat. Markdown is rendered; it supports the same directives as the review document (:::note, :::warning, :::diff{file=... lines=...}, fenced code). References like `path/to/file.toit:123` become links that open the file viewer.',
      inputSchema: { markdown: z.string().describe('The message, in Markdown') },
    },
    async ({ markdown }) => {
      await session.agentMessage(markdown);
      return text('Posted.');
    },
  );

  server.registerTool(
    'get_review_state',
    {
      title: 'Get reviewer state',
      description:
        'Returns what the reviewer has marked as reviewed, the draft review comments not yet submitted, and the recent chat history.',
    },
    async () => {
      const s = session.state;
      const out: string[] = [];
      out.push(`Reviewed changes: ${Object.keys(s.reviewedChanges).join(', ') || 'none'}`);
      out.push(`Reviewed hunks: ${Object.keys(s.reviewedHunks).length}`);
      out.push(`Draft comments (${s.drafts.length}):`);
      for (const d of s.drafts) out.push(`  - ${d.path}:${d.line} (${d.side})\n    ${d.body.replace(/\n/g, '\n    ')}`);
      out.push('Recent chat:');
      for (const m of s.chat.slice(-20)) out.push(`  [${m.role}] ${m.text.slice(0, 500).replace(/\n/g, '\n    ')}`);
      return text(out.join('\n'));
    },
  );

  return server;
}

async function formatMessage(session: Session, m: ChatMessage): Promise<string> {
  const ctx = await session.resolveChips(m.chips);
  return `## Message from the reviewer\n\n${m.text}${ctx ? `\n\n## Attached context\n\n${ctx}` : ''}`;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const s = Buffer.concat(chunks).toString('utf8');
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

export async function handleMcp(session: Session, req: IncomingMessage, res: ServerResponse) {
  const sid = req.headers['mcp-session-id'];
  const sessionId = Array.isArray(sid) ? sid[0] : sid;
  let transport = sessionId ? transports.get(sessionId) : undefined;
  const body = req.method === 'POST' ? await readBody(req) : undefined;

  if (!transport) {
    if (req.method === 'POST' && !sessionId && isInitializeRequest(body)) {
      const t = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, t);
          session.agentConnected(id);
        },
      });
      t.onclose = () => {
        if (t.sessionId) {
          transports.delete(t.sessionId);
          session.agentDisconnected(t.sessionId);
        }
      };
      const server = createServer(session);
      await server.connect(t);
      transport = t;
    } else {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad request: no valid MCP session' }, id: null }));
      return;
    }
  }
  await transport.handleRequest(req, res, body);
}
