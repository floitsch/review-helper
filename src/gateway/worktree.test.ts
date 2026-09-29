// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gitText, rawDiff, showFile, listFiles } from './git.ts';
import { parseDiff } from './diff.ts';
import { WorktreeSnapshots } from './worktree.ts';

async function repository(directory: string) {
  await mkdir(directory, { recursive: true });
  await gitText(directory, ['init', '-b', 'main']);
  await gitText(directory, ['config', 'user.name', 'Snapshot test']);
  await gitText(directory, ['config', 'user.email', 'snapshot@example.invalid']);
  await writeFile(path.join(directory, 'tracked.txt'), 'original\n');
  await gitText(directory, ['add', '.']);
  await gitText(directory, ['commit', '-m', 'Initial']);
}

test('snapshot staged, unstaged, new and deleted files without changing the checkout', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'review-helper-test-'));
  try {
    await repository(root);
    await writeFile(path.join(root, 'tracked.txt'), 'staged\n');
    await gitText(root, ['add', 'tracked.txt']);
    await writeFile(path.join(root, 'tracked.txt'), 'unstaged\n');
    await writeFile(path.join(root, 'new file.txt'), 'new\n');
    await writeFile(path.join(root, 'binary'), Buffer.from([0, 1, 2]));
    await symlink('tracked.txt', path.join(root, 'link'));
    await writeFile(path.join(root, '.gitignore'), 'ignored\n');
    await writeFile(path.join(root, 'ignored'), 'not reviewed\n');
    const index = await readFile(path.join(root, '.git/index'));
    const head = await gitText(root, ['rev-parse', 'HEAD']);
    const snapshots = await WorktreeSnapshots.create(root, path.join(root, '.review'));
    const first = await snapshots.capture('HEAD');
    assert.equal(String(await showFile(snapshots.directory, first.baseSha, 'tracked.txt')), 'original\n');
    assert.equal(String(await showFile(snapshots.directory, first.headSha, 'tracked.txt')), 'unstaged\n');
    assert.equal(String(await showFile(snapshots.directory, first.headSha, 'link')), 'tracked.txt');
    const files = await listFiles(snapshots.directory, first.headSha);
    assert(files.includes('new file.txt'));
    assert(!files.includes('ignored'));
    assert(!files.some((f) => f.startsWith('.review/')));
    assert.deepEqual(await readFile(path.join(root, '.git/index')), index);
    assert.equal(await gitText(root, ['rev-parse', 'HEAD']), head);
    assert.deepEqual(await snapshots.capture('HEAD'), first);
    await rm(path.join(root, 'tracked.txt'));
    const second = await snapshots.capture('HEAD');
    assert.notEqual(second.headSha, first.headSha);
    const diff = parseDiff(await rawDiff(snapshots.directory, first.headSha, second.headSha), first.headSha, second.headSha);
    assert.equal(diff.files.find((f) => f.path === 'tracked.txt')?.status, 'deleted');
    assert.equal(String(await showFile(snapshots.directory, first.headSha, 'tracked.txt')), 'unstaged\n');
    assert.equal(await showFile(snapshots.directory, second.headSha, 'tracked.txt'), null);
    const reopened = await WorktreeSnapshots.create(root, path.join(root, '.review'));
    assert.equal(String(await showFile(reopened.directory, first.headSha, 'tracked.txt')), 'unstaged\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('expand dirty submodules against their recorded base commit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'review-helper-submodule-test-'));
  try {
    const repo = path.join(root, 'parent');
    const source = path.join(root, 'source');
    await repository(repo);
    await repository(source);
    await gitText(repo, ['-c', 'protocol.file.allow=always', 'submodule', 'add', source, 'deps/child']);
    await gitText(repo, ['commit', '-am', 'Add child']);
    const child = path.join(repo, 'deps/child');
    await writeFile(path.join(child, 'tracked.txt'), 'child edited\n');
    await writeFile(path.join(child, 'new.txt'), 'child new\n');
    const childIndexPath = (await gitText(child, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])).trim();
    const childIndex = await readFile(childIndexPath);
    const snapshots = await WorktreeSnapshots.create(repo, path.join(repo, '.review'));
    const result = await snapshots.capture('HEAD');
    const diff = parseDiff(await rawDiff(snapshots.directory, result.baseSha, result.headSha), result.baseSha, result.headSha);
    assert.deepEqual(diff.files.map((f) => f.path).sort(), ['deps/child/new.txt', 'deps/child/tracked.txt']);
    assert.equal(String(await showFile(snapshots.directory, result.baseSha, 'deps/child/tracked.txt')), 'original\n');
    assert.equal(String(await showFile(snapshots.directory, result.headSha, 'deps/child/tracked.txt')), 'child edited\n');
    assert.deepEqual(await readFile(childIndexPath), childIndex);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
