---
name: review-doc
description: Write a review document for a pull request or branch and serve as the chat agent of the Review Helper viewer. Use when asked to prepare a PR for review, to write a review doc, or to connect to review-helper.
---

# Review document writer and chat agent

You prepare a change for a human reviewer. Two jobs:

1. Write `.review/doc.md` in the repository. The Review Helper viewer renders it, interleaved with the actual diffs.
2. Stay connected and answer the reviewer's chat questions until you are told to stop.

The reviewer already knows the codebase roughly. They do not know this change. Your document must let them understand every hunk without scrolling around in the sources.

## Setup

1. The reviewer starts the gateway themselves: `review-helper --pr <N>` (or `--base <ref>`) inside the repository. It listens on `http://localhost:7777` and serves an MCP endpoint at `http://localhost:7777/mcp`.
2. Connect to that MCP server. With Claude Code, the reviewer runs once:
   ```
   claude mcp add --transport http review-helper http://localhost:7777/mcp
   ```
   Other agents: add a streamable-HTTP MCP server with that URL. If the tools `get_session`, `list_hunks`, `check_doc`, `wait_for_message`, `reply` and `get_review_state` are not available, ask the reviewer to connect you and stop.
3. Call `get_session`. It tells you the repository, base and head revisions, the commits, the pull request (with its description) and the path of the document to write.

## Workflow

1. `get_session`, then read the PR description and the commit messages.
2. `list_hunks`: every hunk with its line ranges in the new file. Those ranges are what you reference in the document.
3. Read the code. For every hunk look at the whole function/class it lives in (`git show <head>:<path>`), and at callers if the purpose is not obvious. You have the checkout on disk; use it.
4. Write `.review/doc.md` (format below). The viewer reloads it live, so write it in one go but feel free to fix it afterwards.
5. `check_doc`. Fix every warning (diff blocks that match no hunk, stray `:::`) and cover every uncovered hunk. Repeat until it reports no warnings and no uncovered hunks.
6. Tell the reviewer in one line that the document is ready, then enter the chat loop:
   - call `wait_for_message` (it returns after up to 55 s; if it returns no message, call it again immediately, forever)
   - answer with `reply`
   - never stop looping unless the reviewer tells you to, or you are asked to do something else.

If the reviewer pushes new commits later (you will notice through `get_session` or because they tell you), update the document: set `head:` in the front matter to the new head, add a short section at the top "Changes since <old head>" describing what changed in the revision, and fix any line ranges that moved. Then `check_doc` again.

## Document format

Markdown with a few directives. Only the constructs below are recognized; anything else is plain Markdown.

```markdown
---
head: <full sha of the head you wrote this for>
---
# <Title: one line saying what the PR does>

<Two to five sentences: what the change achieves and why. Mention anything the reviewer should keep in mind (risk, compatibility, follow-ups).>

:::context
<Where are we? Which subsystem, why does it exist, how does data flow through it. The reviewer can attach this to the chat.>
:::

## <Group of related changes>

::::change{#short-id title="What this change does"}
<Purpose of this logical change: what are we doing and why. One paragraph.>

:::diff{file="src/foo.toit" lines="120-140"}
<Optional prose about this particular hunk.>
- L123: `buffer_` is the receive buffer allocated in the constructor (see `src/foo.toit:40`); `size` counts bytes, not characters.
- L130-132: the early return keeps the connection open, matching `handle_` above.
:::

:::diff{file="src/bar.toit"}
:::

:::concern
<Something that looks wrong or questionable. The reviewer can turn it into a review comment with one click.>
:::
::::
```

### Directives

- `::::change{#id title="..."}` … `::::` wraps one logical change. Also `::::change[Title]`. Everything a reviewer needs for that change goes inside: purpose, diff blocks, concerns. It gets a "reviewed" checkbox.
- `:::diff{file="path" lines="A-B"}` … `:::` shows the hunks of `path` that touch new-file lines A to B (inclusive) and focuses on those lines. Omit `lines` for all hunks of the file. Use `old=true` with `lines` to address lines of the old file (deleted code). Optional attributes: `view="split"` or `"unified"` if one is clearly better for this hunk (e.g. split for a reformatted block), `ws="ignore"` to hide whitespace-only changes, `open=true` to show the line-by-line part expanded, `title="..."`.
  The body of a diff block is the line-by-line explanation. It is collapsed by default and also attached to the gutter of the diff. List items that start with `L<n>`, `L<a>-<b>` or `<n>:` are attached to that new-file line; `D<n>` attaches to a line of the old file. Anything else in the body is shown as prose under "Line by line".
- `:::note`, `:::warning`, `:::concern`, `:::context`, `:::tip` … `:::` are callout boxes. Optional title: `:::warning[Title]`.
- `:::explain[Title]` … `:::` is a collapsed box for optional detail.
- Headings (`#`, `##`, `###`) group changes and get "add to chat" handles. Use them for the grouping and ordering.
- Fenced code with `file=` and `start=` in the info string shows a snippet with line numbers and a link to the file: ```` ```toit file=src/foo.toit start=40 ````. Use it for code that is *not* part of the diff (a caller, a type definition) when the reviewer needs to see it.
- Any `path/to/file.ext:123` in prose becomes a link that opens the file viewer at that line. Use these generously instead of pasting code.

### Nesting rule

Containers nest only if the outer one uses more colons than the inner ones. `::::change` (four) around `:::diff` (three). A stray `:::` paragraph in the rendered document means the nesting is wrong; `check_doc` warns about it.

## What a good document contains

Skip anything that is obvious for the change at hand, but default to all of it:

1. **Split the patch into logical changes** if it is big enough. One `::::change` per logical change, not per file.
2. **Purpose for each change**: what are we doing, why, what would break without it.
3. **Group** related changes even when they are far apart in the files (a new field, its initialization, its use).
4. **Order** meaningfully: follow the data or the control flow. Where does the input enter, how is it validated, where is it stored, where is it consumed. Put groundwork (new helpers, renames) before the code that uses it, unless the use is what makes the helper understandable.
5. **Cover every hunk.** Every hunk of `list_hunks` must appear in some `:::diff` block. Mechanical changes (renames, moves, formatting) still get a block, just a short one: "All hunks in `src/x.toit` rename `foo` to `bar`, nothing else." Grouped, one block with no `lines` is fine. `check_doc` tells you what is missing.
6. **Context**: where are we (file, class, function), why does that code exist, what is its contract. Put it in `:::context` (at the top for the whole change, or inside a change for a specific spot). The viewer lets the reviewer attach it to the chat.
7. **Per-hunk description** consistent with the description of the change it belongs to.
8. **Line by line** inside the diff block body: explain every variable, constant, and callee that appears in the hunk but is defined elsewhere ("`timeout_` is the socket timeout in ms, set in the constructor from the `--timeout` flag"). Point to definitions with `path:line`. The reviewer should never have to scroll up in the file to understand a line.
9. **Concerns**: if something looks wrong, incomplete, untested, or inconsistent with the PR description, say so in a `:::concern` inside the relevant change. Be concrete. Do not pad with generic advice.
10. Note moved code explicitly ("moved unchanged from `a.toit:10-40`") so the reviewer can skip it. The viewer detects moves and dims them, but confirm that nothing changed in the move if that is the case.

Keep prose tight. The document is read next to the code, not instead of it.

## Chat

`wait_for_message` returns the reviewer's message plus the context they attached: document blocks (as Markdown source), diff hunks (as unified diff with line numbers), selected lines, files, or existing comments. Answer the question that was asked, using the code on disk when the attached context is not enough.

In replies you can use the same Markdown: `:::diff{file=... lines=...}` blocks show the real diff, fenced code shows snippets, `path:line` references become links. Keep replies short; the reviewer is reading code, not an essay. When you are unsure, say so and say what you checked.

If the reviewer asks you to change the document, edit `.review/doc.md`; the viewer reloads automatically. Then `check_doc`.
