// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Session } from './session.ts';
import { handleMcp } from './mcp.ts';
import type { Chip, ServerMessage } from '../shared/types.ts';
import { listFiles } from './git.ts';

interface Args {
  repo: string;
  base?: string;
  head?: string;
  pr?: number;
  port: number;
}

function usage(): never {
  console.log(`Usage: review-helper [options]

Options:
  --repo <path>   Repository to review (default: current directory)
  --pr <number>   GitHub pull request number (uses gh for metadata and comments)
  --base <ref>    Base revision (default: the PR base, or origin/main)
  --head <ref>    Head revision (default: the PR branch if checked out, or HEAD)
  --port <port>   Port to listen on (default: 7777)
`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { repo: process.cwd(), port: 7777 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) usage();
      return argv[++i];
    };
    if (a === '--repo') args.repo = path.resolve(next());
    else if (a === '--pr') args.pr = Number(next());
    else if (a === '--base') args.base = next();
    else if (a === '--head') args.head = next();
    else if (a === '--port') args.port = Number(next());
    else if (a === '-h' || a === '--help') usage();
    else if (/^\d+$/.test(a)) args.pr = Number(a);
    else usage();
  }
  return args;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const session = await Session.create({ repo: args.repo, base: args.base, head: args.head, pr: args.pr, port: args.port });
  const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'web');

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/mcp') {
        await handleMcp(session, req, res);
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        await handleApi(session, url, req, res);
        return;
      }
      serveStatic(webDir, url.pathname, res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: String(e instanceof Error ? e.message : e) });
      else res.end();
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws: WebSocket) => {
    const send = (msg: ServerMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };
    send({ type: 'session', session: session.info });
    send({ type: 'doc', doc: session.doc });
    send({ type: 'state', state: session.state });
    send({ type: 'agent', status: session.agentStatus() });
    if (session.conversation) send({ type: 'pr', conversation: session.conversation });
    const unsubscribe = session.subscribe(send);
    ws.on('close', unsubscribe);
    ws.on('error', unsubscribe);
  });

  server.listen(args.port, '127.0.0.1', () => {
    const i = session.info;
    console.log(`review-helper: http://localhost:${args.port}/`);
    console.log(`  repo:  ${i.repo}`);
    console.log(`  range: ${i.base} (${i.baseSha.slice(0, 10)}) .. ${i.head} (${i.headSha.slice(0, 10)}), ${i.commits.length} commit(s)`);
    if (i.pr) console.log(`  PR:    #${i.pr.number} ${i.pr.title}`);
    console.log(`  doc:   ${i.docPath}`);
    console.log(`  MCP:   http://localhost:${args.port}/mcp`);
    if (!existsSync(webDir)) console.log('  (web app not built; run `npm run build` or use `npm run dev:web`)');
  });
}

function serveStatic(webDir: string, pathname: string, res: http.ServerResponse) {
  let p = path.normalize(path.join(webDir, pathname));
  if (!p.startsWith(webDir)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(p) || statSync(p).isDirectory()) p = path.join(webDir, 'index.html');
  if (!existsSync(p)) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('web app not built: run `npm run build`');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(readFileSync(p));
}

async function handleApi(session: Session, url: URL, req: http.IncomingMessage, res: http.ServerResponse) {
  const route = `${req.method} ${url.pathname}`;
  const q = url.searchParams;
  switch (route) {
    case 'GET /api/session':
      return json(res, 200, session.info);
    case 'GET /api/doc':
      return json(res, 200, session.doc);
    case 'GET /api/state':
      return json(res, 200, session.state);
    case 'GET /api/chat':
      return json(res, 200, session.state.chat);
    case 'GET /api/agent':
      return json(res, 200, session.agentStatus());
    case 'GET /api/diff': {
      const from = q.get('from') ?? session.info.baseSha;
      const to = q.get('to') ?? session.info.headSha;
      return json(res, 200, await session.getDiff(from, to));
    }
    case 'GET /api/file': {
      const p = q.get('path');
      if (!p) return json(res, 400, { error: 'path required' });
      const rev = q.get('rev') ?? session.info.headSha;
      const f = await session.getFile(p, rev);
      if (!f) return json(res, 404, { error: `${p} not found at ${rev}` });
      return json(res, 200, f);
    }
    case 'GET /api/files':
      return json(res, 200, await listFiles(session.repo, session.info.headSha));
    case 'GET /api/pr':
      return json(res, 200, session.conversation);
    case 'POST /api/pr/refresh':
      await session.loadConversation();
      return json(res, 200, session.conversation);
    case 'POST /api/refresh':
      await session.refresh();
      return json(res, 200, session.info);
    case 'POST /api/state': {
      const body = await readJson(req);
      session.updateState(body);
      return json(res, 200, session.state);
    }
    case 'POST /api/mark-reviewed':
      session.markReviewed();
      return json(res, 200, session.state);
    case 'POST /api/chat': {
      const body = await readJson(req);
      const chips: Chip[] = Array.isArray(body.chips) ? body.chips : [];
      const msg = await session.userMessage(String(body.text ?? ''), chips);
      return json(res, 200, msg);
    }
    case 'POST /api/chat/clear':
      session.clearChat();
      return json(res, 200, {});
    case 'POST /api/drafts': {
      const body = await readJson(req);
      return json(res, 200, session.addDraft(body));
    }
    case 'PUT /api/drafts': {
      const body = await readJson(req);
      session.updateDraft(body.id, body);
      return json(res, 200, {});
    }
    case 'DELETE /api/drafts': {
      const id = q.get('id');
      if (!id) return json(res, 400, { error: 'id required' });
      session.deleteDraft(id);
      return json(res, 200, {});
    }
    case 'POST /api/review/submit': {
      const body = await readJson(req);
      const url = await session.submitReview(body.event, String(body.body ?? ''));
      return json(res, 200, { url });
    }
    default:
      return json(res, 404, { error: `unknown route ${route}` });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
