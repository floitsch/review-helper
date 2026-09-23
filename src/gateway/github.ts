// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

// Thin wrapper around the `gh` CLI. Auth is handled by gh itself.

import { execFile } from 'node:child_process';
import type { DraftComment, PrConversation, PrInfo, PrThread } from '../shared/types.ts';

function gh(cwd: string, args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('gh', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`gh ${args.slice(0, 3).join(' ')} failed: ${String(stderr).trim() || err.message}`));
      else resolve(String(stdout));
    });
    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    }
  });
}

export async function repoNameWithOwner(cwd: string): Promise<string> {
  const out = await gh(cwd, ['repo', 'view', '--json', 'nameWithOwner']);
  return JSON.parse(out).nameWithOwner;
}

export async function prInfo(cwd: string, number: number): Promise<PrInfo> {
  const out = await gh(cwd, [
    'pr',
    'view',
    String(number),
    '--json',
    'number,title,body,url,author,baseRefName,headRefName,headRefOid,state',
  ]);
  const j = JSON.parse(out);
  const repo = await repoNameWithOwner(cwd);
  return {
    number: j.number,
    title: j.title,
    body: j.body ?? '',
    url: j.url,
    author: j.author?.login ?? '',
    baseRefName: j.baseRefName,
    headRefName: j.headRefName,
    state: j.state,
    repo,
  };
}

const CONVERSATION_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id isResolved isOutdated path line startLine diffSide
          comments(first: 50) { nodes { id author { login } body createdAt url } }
        }
      }
      reviews(first: 100) { nodes { author { login } body state submittedAt url } }
      comments(first: 100) { nodes { id author { login } body createdAt url } }
    }
  }
}`;

export async function prConversation(cwd: string, repo: string, number: number): Promise<PrConversation> {
  const [owner, name] = repo.split('/');
  const out = await gh(cwd, [
    'api',
    'graphql',
    '-f',
    `query=${CONVERSATION_QUERY}`,
    '-F',
    `owner=${owner}`,
    '-F',
    `name=${name}`,
    '-F',
    `number=${number}`,
  ]);
  const pr = JSON.parse(out).data.repository.pullRequest;
  const threads: PrThread[] = pr.reviewThreads.nodes.map((t: any) => ({
    id: t.id,
    path: t.path,
    line: t.line,
    startLine: t.startLine,
    side: t.diffSide === 'LEFT' ? 'LEFT' : 'RIGHT',
    resolved: !!t.isResolved,
    outdated: !!t.isOutdated,
    comments: t.comments.nodes.map((c: any) => ({
      id: c.id,
      author: c.author?.login ?? '',
      body: c.body,
      createdAt: c.createdAt,
      url: c.url,
    })),
  }));
  return {
    threads,
    reviews: pr.reviews.nodes
      .filter((r: any) => r.body || r.state !== 'COMMENTED')
      .map((r: any) => ({
        author: r.author?.login ?? '',
        body: r.body ?? '',
        state: r.state,
        submittedAt: r.submittedAt,
        url: r.url,
      })),
    comments: pr.comments.nodes.map((c: any) => ({
      id: c.id,
      author: c.author?.login ?? '',
      body: c.body,
      createdAt: c.createdAt,
      url: c.url,
    })),
  };
}

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

export async function submitReview(
  cwd: string,
  repo: string,
  number: number,
  headSha: string,
  event: ReviewEvent,
  body: string,
  drafts: DraftComment[],
): Promise<string> {
  const comments = drafts.map((d) => {
    const c: Record<string, unknown> = { path: d.path, line: d.line, side: d.side, body: d.body };
    if (d.startLine !== undefined && d.startLine !== d.line) {
      c.start_line = d.startLine;
      c.start_side = d.side;
    }
    return c;
  });
  const payload = JSON.stringify({ commit_id: headSha, body, event, comments });
  const out = await gh(cwd, ['api', '-X', 'POST', `repos/${repo}/pulls/${number}/reviews`, '--input', '-'], payload);
  return JSON.parse(out).html_url ?? '';
}
