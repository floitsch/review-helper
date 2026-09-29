// Copyright (C) 2026 Toit contributors.
// Use of this source code is governed by an MIT-style license that can be
// found in the LICENSE file.

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { gitText } from './git.ts';

/** Immutable trees kept outside the source repository's index and object store. */
export class WorktreeSnapshots {
  private alternates = new Set<string>();

  private constructor(readonly repo: string, readonly directory: string) {}

  static async create(repo: string, reviewDir: string): Promise<WorktreeSnapshots> {
    const directory = path.join(reviewDir, 'snapshots.git');
    await mkdir(directory, { recursive: true });
    const format = (await gitText(repo, ['rev-parse', '--show-object-format'])).trim();
    await gitText(directory, ['init', '--bare', `--object-format=${format}`]);
    const snapshots = new WorktreeSnapshots(repo, directory);
    const alternatesFile = path.join(directory, 'objects/info/alternates');
    if (existsSync(alternatesFile)) {
      for (const line of (await readFile(alternatesFile, 'utf8')).split('\n').filter(Boolean)) {
        snapshots.alternates.add(line);
      }
    }
    return snapshots;
  }

  async capture(base: string): Promise<{ baseSha: string; headSha: string }> {
    const baseSha = await this.tree(this.repo, base, false);
    const headSha = await this.tree(this.repo, 'HEAD', true);
    return { baseSha, headSha };
  }

  private async tree(repo: string, ref: string, working: boolean): Promise<string> {
    const objects = (await gitText(repo, ['rev-parse', '--path-format=absolute', '--git-path', 'objects'])).trim();
    if (!this.alternates.has(objects)) {
      this.alternates.add(objects);
      await writeFile(path.join(this.directory, 'objects/info/alternates'), [...this.alternates].join('\n') + '\n');
    }
    const temporary = await mkdtemp(path.join(this.directory, 'index-'));
    const env = {
      GIT_INDEX_FILE: path.join(temporary, 'index'),
      GIT_OBJECT_DIRECTORY: path.join(this.directory, 'objects'),
    };
    const run = (args: string[]) => gitText(repo, args, { env });
    try {
      const sourceIndex = (await gitText(repo, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])).trim();
      if (working && existsSync(sourceIndex)) {
        await copyFile(sourceIndex, env.GIT_INDEX_FILE);
        await run(['update-index', '--no-split-index']);
      } else {
        await run(['read-tree', ref]);
      }
      if (working) await run(['add', '--all', '--', '.', ':(exclude).review']);
      const entries = (await run(['ls-files', '--stage', '-z'])).split('\0').filter(Boolean);
      for (const entry of entries) {
        const match = /^160000 ([0-9a-f]+) 0\t([\s\S]+)$/.exec(entry);
        if (!match) continue;
        const [, commit, name] = match;
        const submodule = path.join(repo, name);
        // Uninitialized submodules remain ordinary gitlinks.
        if (!existsSync(path.join(submodule, '.git'))) continue;
        const subtree = await this.tree(submodule, commit, working);
        await run(['update-index', '--force-remove', '--', name]);
        await run(['read-tree', `--prefix=${name}/`, subtree]);
      }
      return (await run(['write-tree'])).trim();
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
