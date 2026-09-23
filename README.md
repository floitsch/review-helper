# Review Helper

A local web page for reviewing a pull request with an AI agent at your side.

- An agent writes a **review document** (`.review/doc.md`) that explains the change: logical changes, purpose, context, line-by-line notes, concerns. The page renders it with the real diffs interleaved.
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
review-helper --pr 123 --port 8000
```

Then open http://localhost:7777/. The diff is `merge-base(base, head)..head`. Head defaults to the checkout (`HEAD`), so what you see is what is on disk. New commits are picked up automatically.

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

Then ask the agent: "Prepare PR 123 for review with the review-doc skill". It writes `.review/doc.md` (the page updates live), checks coverage with the `check_doc` tool, and then waits for chat messages.

MCP tools: `get_session`, `list_hunks`, `check_doc`, `wait_for_message`, `reply`, `get_review_state`.

## The review document

Markdown with directives; see [`skill/review-doc/SKILL.md`](skill/review-doc/SKILL.md) for the full reference. In short:

```markdown
---
head: <sha>
---
# Title

::::change{#validate title="Validate requests"}
Why this change exists.

:::diff{file="src/server.toit" lines="24-30"}
- L25: `max-size_` is the request limit set in the constructor.
:::

:::concern
Should rejected requests be logged?
:::
::::
```

Outer containers use more colons than inner ones. Every hunk of the PR should be referenced by a `:::diff` block; the page lists the ones that are not.

## Keyboard

`j`/`k` hunks, `n`/`p` changes, `x` hunk reviewed, `r` change reviewed, `a` attach to chat, `c` comment on selection, `f` open in file viewer, `/` chat, `s` split, `w` whitespace, `m` moved, `?` help. Click a line number to select, shift-click to extend. In the chat, Enter sends, Ctrl+J or Shift+Enter inserts a newline.

## Development

```
npm run dev:gateway     # gateway on :7777 with reload (run inside a repo, or pass --repo)
npm run dev:web         # Vite dev server on :5173, proxies /api, /ws, /mcp to :7777
npm run check           # type checks for gateway and web app
```

Layout: `src/gateway` (Node: git, diff parsing, Shiki highlighting, Markdown parsing, MCP server, GitHub via `gh`), `src/web` (Svelte 5), `src/shared` (types and diff helpers used by both), `grammars/` (Toit TextMate grammar), `skill/` (the agent skill).
