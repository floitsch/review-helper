---
name: review-doc
description: Write a prose-first review document for a pull request or branch, with code diffs as evidence, and answer questions in the Review Helper viewer when requested. Use when asked to prepare a PR for review, write a review doc, or connect to review-helper.
---

# Review document writer and chat agent

You prepare a change for a human reviewer. Two jobs:

1. Write `.review/doc.md` in the repository. The Review Helper viewer renders it, interleaved with the actual diffs.
2. Answer follow-up questions in the reviewer's chosen channel. If they use the viewer's chat, stay connected there until they ask you to stop.

The reviewer may know the codebase but does not know why this change exists. They should be able to understand and assess the change by reading the prose, opening code only to verify a claim or investigate a concern. Provide enough context that they do not have to hunt through callers or type definitions to follow the explanation.

## Reading experience

Lead with the behavior or problem that motivates the change. Establish what normally happens, why the existing behavior matters, what goes wrong in the relevant case, and why the proposed approach helps. Then explain the decisions and their consequences in a connected order. Follow the flow of a request, value, or failure when useful, but choose the order that best explains *why* each step exists; do not turn the document into a fictional story or a tour of files in diff order.

Write the main explanation in plain language. Introduce a technical term when the reader needs it, then use the term consistently. Name a class or function when its identity matters to a claim, rather than repeatedly translating code into prose. For each substantive code change, still identify the class or component, its purpose, and why the change belongs there. Put that detail beside its evidence or in an expandable `:::explain` box when it would interrupt the main explanation.

Treat diffs as evidence for the text. The reviewer should not need to read a patch to discover the motivation or infer the control flow. Use `:::diff` for every hunk, but keep lengthy line-by-line notes, code paths, and mechanical edits secondary to the explanation. Give more context when the reader would otherwise need to search for it; avoid exhaustive descriptions of obvious lines. Scale all of this down for a genuinely simple change.

When the change edits a patch file, explain the effect on the underlying source. If practical, apply the before and after patch series to the same upstream revision and show or link the resulting source change. A patch-to-a-patch diff remains useful as proof, but it should not be the only way to see what the code actually becomes. Verify that reconstruction before describing it as the effective source change; if it cannot be reconstructed, state the limit.

## Setup

1. Start the gateway inside the repository with `review-helper --pr <N>`, `--base <ref>`, or `--worktree` for uncommitted changes without a PR. It listens on `http://localhost:7777` and serves an MCP endpoint at `http://localhost:7777/mcp`.
2. Connect to that MCP server. With Claude Code, the reviewer runs once:
   ```
   claude mcp add --transport http review-helper http://localhost:7777/mcp
   ```
   Other agents: add a streamable-HTTP MCP server with that URL. If the tools `get_session`, `list_hunks`, `check_doc`, `wait_for_message`, `reply` and `get_review_state` are not available, ask the reviewer to connect you and stop.
3. Call `get_session`. It tells you the repository, base and head revisions, the content repository, the commits, the pull request (with its description) and the path of the document to write. In working-tree mode, base/head are immutable tree snapshots, not commits. Run `git show <head>:<path>` in the content repository to read the exact reviewed version, including files in initialized submodules. Use the snapshot head in the document front matter.

## Workflow

1. `get_session`, then read the PR description and the commit messages.
2. `list_hunks`: every hunk with its line ranges in the new file. Those ranges are what you reference in the document.
3. Read the code behind every hunk and enough surrounding behavior to explain its role. Trace the relevant callers and fallback or error paths, and compare the old and new behavior. Use `git show <head>:<path>` in the content repository to read the exact reviewed version.
4. Decide the reading order from the change's motivation and causal flow. Write `.review/doc.md` (format below). The viewer reloads it live, so write it in one go but feel free to fix it afterwards.
5. `check_doc`. Fix every warning (diff blocks that match no hunk, stray `:::`) and cover every uncovered hunk. Repeat until it reports no warnings and no uncovered hunks.
6. Tell the reviewer in one line that the document is ready. If they want to use the viewer's chat, enter the chat loop:
   - call `wait_for_message` (it returns after up to 55 s; if it returns no message, call it again immediately, forever)
   - answer with `reply`
   - stop listening when the reviewer asks to communicate elsewhere or you are asked to do something else; do not restart the loop without a new request.

If the reviewer pushes new commits later (you will notice through `get_session` or because they tell you), update the document: set `head:` in the front matter to the new head, add a short section at the top "Changes since <old head>" describing what changed in the revision, and fix any line ranges that moved. Then `check_doc` again.

## Document format

Markdown with a few directives. Only the constructs below are recognized; anything else is plain Markdown.

```markdown
---
head: <full sha of the head you wrote this for>
---
# <Title: one line saying what the PR does>

<A short explanation of the problem, normal behavior, and intended outcome. Mention material risks or limits.>

:::context
<The background the reader needs to understand why the change matters. The reviewer can attach this to chat.>
:::

## <A question or phase in the causal flow>

:::::change{#short-id title="What this change does"}
<Explain the decision and its effect in reader-facing terms. Include enough context to stand without the diff.>

::::explain[Code context and evidence]
<Name the class/component, its purpose, and why this change belongs here.>

:::diff{file="src/foo.toit" lines="120-140"}
<Optional details needed to verify this hunk, including references to relevant definitions.>
:::
::::

:::diff{file="src/bar.toit"}
<Additional evidence, if it reads better alongside the main text.>
:::

:::concern
<A specific concern, if one remains after checking the surrounding behavior.>
:::
:::::
```

### Directives

- `::::change{#id title="..."}` … `::::` wraps one logical change. Also `::::change[Title]`. Use five colons for `change` when it wraps a four-colon `explain`. Everything a reviewer needs for that change goes inside: purpose, diff blocks, concerns. It gets a "reviewed" checkbox.
- `:::diff{file="path" lines="A-B"}` … `:::` shows the hunks of `path` that touch new-file lines A to B (inclusive) and focuses on those lines. Omit `lines` for all hunks of the file. Use `old=true` with `lines` to address lines of the old file (deleted code). Optional attributes: `view="split"` or `"unified"` if one is clearly better for this hunk (e.g. split for a reformatted block), `ws="ignore"` to hide whitespace-only changes, `open=true` to show the line-by-line part expanded, `title="..."`.
  The body of a diff block is the line-by-line explanation. It is collapsed by default and also attached to the gutter of the diff. List items that start with `L<n>`, `L<a>-<b>` or `<n>:` are attached to that new-file line; `D<n>` attaches to a line of the old file. Anything else in the body is shown as prose under "Line by line".
- `:::note`, `:::warning`, `:::concern`, `:::context`, `:::tip` … `:::` are callout boxes. Optional title: `:::warning[Title]`.
- `:::explain[Title]` … `:::` is a collapsed box for optional detail. Use more colons when nesting it between a `change` and a `diff`, as in the example.
- Headings (`#`, `##`, `###`) group changes and get "add to chat" handles. Use them for the grouping and ordering.
- Fenced code with `file=` and `start=` in the info string shows a snippet with line numbers and a link to the file: ```` ```toit file=src/foo.toit start=40 ````. Use it for code that is *not* part of the diff (a caller, a type definition) when the reviewer needs to see it.
- Any `path/to/file.ext:123` in prose becomes a link that opens the file viewer at that line. Use these generously instead of pasting code.

### Nesting rule

Containers nest only if the outer one uses more colons than the inner ones. Use `::::change` around `:::diff`, or `:::::change` around `::::explain` around `:::diff`. A stray `:::` paragraph in the rendered document means the nesting is wrong; `check_doc` warns about it.

## What a good document contains

Adapt the depth to the change. For a substantial change:

1. **A reason to care before the implementation.** Explain the normal behavior, the trigger for this change, and the consequence of leaving it as it was. Show why the proposed behavior is possible and where its boundary lies.
2. **One connected reading flow.** Group related edits across files into logical changes. Put the core behavior and the decision that motivates it before incidental cleanup or patch bookkeeping, unless the groundwork is needed to understand that behavior. Use headings and prose to carry the explanation, not a file-by-file inventory.
3. **Context at the point of need.** Explain each affected component's job and why responsibility belongs there. Introduce names, variables, and callers only when they help establish a decision or verify it. Give file references or code details in `:::context`, `:::explain`, or `:::diff` so the reviewer can inspect them without searching.
4. **The actual effective change.** Compare old and new behavior. For edits to embedded patches, show the underlying source change when it can be reconstructed, and keep the patch-file diff as supporting evidence. Identify moved or mechanical changes so the reader can skip them confidently.
5. **Complete evidence and specific concerns.** Reference every hunk with `:::diff`; group purely mechanical hunks when useful. Use `:::concern` for a concrete risk, missing test, or unresolved mismatch after checking context. Describe what validation was done and what remains untested without implying that a passing ordinary test exercised a rare failure path.

For a simple change, a short explanation and the relevant diff blocks may be enough. Do not make the reviewer read a long template or repeated class introductions to understand a small edit.

## Chat

`wait_for_message` returns the reviewer's message plus the context they attached: document blocks (as Markdown source), diff hunks (as unified diff with line numbers), selected lines, files, or existing comments. Answer the question that was asked, using the code on disk when the attached context is not enough.

In replies you can use the same Markdown: `:::diff{file=... lines=...}` blocks show the real diff, fenced code shows snippets, `path:line` references become links. Keep replies short; the reviewer is reading code, not an essay. When you are unsure, say so and say what you checked.

If the reviewer asks you to change the document, edit `.review/doc.md`; the viewer reloads automatically. Then `check_doc`.
