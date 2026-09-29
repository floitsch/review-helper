# Review Helper

A local web page for reviewing a pull request with an AI agent at your side.

- An agent writes a **review document** (`.review/doc.md`) that explains why the change matters, how the relevant behavior works, and what changes. The page keeps the real diffs available as evidence.
- A **file viewer** shows the full file at head or base, with changed lines marked.
- A **chat** talks to an agent (Claude Code, Codex, anything that speaks MCP) connected to the local gateway. Every section, diff, line range and file can be attached as context.
- Draft **review comments** on lines and submit them to GitHub as one review.
- Diffs have syntax highlighting (Toit included via the TextMate grammar from `ide-tools`), word-level diffs, hidden whitespace-only and moved code, split/unified views, and a commit-range selector ("since last review", per commit).

## Install

```
npm install
npm run build          # builds the web app into dist/web
npm link               # optional: makes `review-helper` available on PATH
```

Requires Node 22+, git, and the [`gh`](https://cli.github.com/) CLI (logged in) for pull requests.

## Run

Inside the repository to review:

```
review-helper --pr 123            # GitHub PR: metadata, threads, submitting reviews
review-helper --base origin/main  # or: a local branch against a base
review-helper --worktree          # uncommitted changes, including new files and submodules
review-helper --pr 123 --port 8000
```

Then open http://localhost:7777/. Branch and PR mode show `merge-base(base, head)..head`.
Head defaults to the checkout's latest commit (`HEAD`); uncommitted edits are not included.
New commits are picked up automatically.

`--worktree` compares `HEAD` directly with the current working tree, including staged,
unstaged, and non-ignored untracked files. Use `--worktree --base <ref>` to compare
with another revision. Initialized submodules are expanded into their individual files.
It cannot be combined with `--pr` or `--head`, and needs no GitHub login or PR.
Changes are picked up automatically every five seconds (or with the refresh button).

Working-tree reviews store immutable Git trees in `.review/snapshots.git`, using a
private index. They do not create commits or change the source repository's index,
refs, or object store. Diffs, file views and “since last review” use these snapshots.
The snapshots borrow unchanged objects from the source repositories, so keep the
checkouts available for the lifetime of the review. The session's `contentRepo` (also
reported by `get_session`) is where agents run `git show <snapshot>:<path>`.

Session state (reviewed marks, draft comments, chat history) lives in `.review/state.json` in the repository. The directory is git-ignored by a `.gitignore` the tool writes.

## Agents

Start Claude Code (or another agent) in the repository and connect it to the gateway once:

```
claude mcp add --transport http review-helper http://localhost:7777/mcp
```

Install the skill so the agent knows how to write the document and run the chat loop:

```
ln -s "$(pwd)/skill/review-doc" ~/.claude/skills/review-doc
```

Then ask the agent: "Prepare PR 123 for review with the review-doc skill". It writes `.review/doc.md` (the page updates live), checks coverage with the `check_doc` tool, and can answer questions in the viewer's chat.

MCP tools: `get_session`, `list_hunks`, `check_doc`, `wait_for_message`, `reply`, `get_review_state`.

## The review document

Markdown with directives; see [`skill/review-doc/SKILL.md`](skill/review-doc/SKILL.md) for the full reference. In short:

A useful document reads as an explanation on its own. It begins with the normal behavior and the problem that motivates the change, then follows the decisions needed to reach the new behavior. The main prose gives enough context that a reviewer need not infer purpose from class names or chase callers. Code locations and line notes support the explanation; `:::explain` can keep those details collapsed. For a simple change, keep the document simple too.

If the reviewed files are themselves patches, show the resulting source change when it can be reconstructed. Keep the patch-to-patch diff available as proof, so the reviewer can read the effective code instead of interpreting two layers of patch syntax.

```markdown
---
head: <sha>
---
# Reject oversized requests before dispatch

The server accepts a request only while it is small enough for the downstream
handler to process. The new check rejects an oversized body at the boundary,
before it can consume more memory in that handler.

:::::change{#validate title="Validate requests"}
Explain how the request reaches this boundary and what the rejection changes
for the caller.

::::explain[Code context and evidence]
`RequestHandler` receives the body and decides whether to dispatch it. The
configured limit is stored in `max-size_`.
:::diff{file="src/server.toit" lines="24-30"}
The check happens before dispatch; inspect these lines to verify the order.
:::
::::

:::::
```

Outer containers use more colons than inner ones. Every hunk of the PR should be referenced by a `:::diff` block; the page lists the ones that are not. The prose should still make sense before a reader expands any diff.

## Keyboard

`j`/`k` hunks, `n`/`p` changes, `x` hunk reviewed, `r` change reviewed, `a` attach to chat, `c` comment on selection, `f` open in file viewer, `/` chat, `s` split, `w` whitespace, `m` moved, `?` help. Click a line number to select, shift-click to extend. In the chat, Enter sends, Ctrl+J or Shift+Enter inserts a newline.

## Development

```
npm run dev:gateway     # gateway on :7777 with reload (run inside a repo, or pass --repo)
npm run dev:web         # Vite dev server on :5173, proxies /api, /ws, /mcp to :7777
npm run check           # type checks for gateway and web app
npm test                # working-tree snapshot regression tests
```

Layout: `src/gateway` (Node: git, diff parsing, Shiki highlighting, Markdown parsing, MCP server, GitHub via `gh`), `src/web` (Svelte 5), `src/shared` (types and diff helpers used by both), `grammars/` (Toit TextMate grammar), `skill/` (the agent skill).
