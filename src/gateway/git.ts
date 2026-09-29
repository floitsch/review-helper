// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

import { execFile } from 'node:child_process';
import type { CommitInfo } from '../shared/types.ts';

const MAX_BUFFER = 256 * 1024 * 1024;

export function git(cwd: string, args: string[], opts: { binary?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env: { ...process.env, ...opts.env }, maxBuffer: MAX_BUFFER, encoding: opts.binary ? 'buffer' : 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`git ${args.join(' ')} failed: ${String(stderr).trim() || err.message}`));
      } else {
        resolve(stdout as string | Buffer);
      }
    });
  });
}

export async function gitText(cwd: string, args: string[], opts: { env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  return (await git(cwd, args, opts)) as string;
}

export async function revParse(cwd: string, rev: string): Promise<string> {
  return (await gitText(cwd, ['rev-parse', '--verify', `${rev}^{commit}`])).trim();
}

export async function mergeBase(cwd: string, a: string, b: string): Promise<string> {
  return (await gitText(cwd, ['merge-base', a, b])).trim();
}

export async function toplevel(cwd: string): Promise<string> {
  return (await gitText(cwd, ['rev-parse', '--show-toplevel'])).trim();
}

export async function commitsBetween(cwd: string, from: string, to: string): Promise<CommitInfo[]> {
  const out = await gitText(cwd, ['log', '--reverse', '--format=%H%x00%h%x00%s%x00%an%x00%aI', `${from}..${to}`]);
  return out
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => {
      const [sha, shortSha, subject, author, date] = l.split('\0');
      return { sha, shortSha, subject, author, date };
    });
}

/** Returns null when the file does not exist at that revision. */
export async function showFile(cwd: string, rev: string, path: string): Promise<Buffer | null> {
  try {
    return (await git(cwd, ['show', `${rev}:${path}`], { binary: true })) as Buffer;
  } catch (e) {
    const msg = String(e);
    if (/does not exist|exists on disk, but not in|bad object|Path .* does not exist/i.test(msg)) return null;
    throw e;
  }
}

export async function blobSha(cwd: string, rev: string, path: string): Promise<string | null> {
  try {
    return (await gitText(cwd, ['rev-parse', '--verify', '-q', `${rev}:${path}`])).trim() || null;
  } catch {
    return null;
  }
}

export async function rawDiff(cwd: string, from: string, to: string): Promise<string> {
  return gitText(cwd, ['diff', '--no-color', '--no-ext-diff', '-U3', '--find-renames', '--no-prefix', from, to]);
}

export async function listFiles(cwd: string, rev: string): Promise<string[]> {
  const out = await gitText(cwd, ['ls-tree', '-r', '--name-only', rev]);
  return out.split('\n').filter((l) => l.length > 0);
}

export function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export async function remoteUrl(cwd: string): Promise<string | null> {
  try {
    return (await gitText(cwd, ['remote', 'get-url', 'origin'])).trim();
  } catch {
    return null;
  }
}
