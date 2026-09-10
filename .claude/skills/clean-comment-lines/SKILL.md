---
name: clean-comment-lines
description: Rules for when to write, keep, or delete code comments. Load this whenever you write or edit code in any language, and especially when fixing bugs, refactoring, or changing existing code, because that is when comments narrating the change get written. Also use when asked to clean up, trim, or review the comments in a file.
---

# Clean comment lines

A comment describes the code as it is now. It never describes what the code
used to be, what was tried, or what happened in this session. Git holds the
history; the diff and the commit message already explain the change.

**Hard rule: every comment is exactly one line.** The single exception is one
file header at the top of a long or complex file. Nowhere else in the file is
a multi-line comment allowed, no matter how good the why is. If the why does
not fit in one line, keep only the strongest clause and delete the rest. A
good why does not earn extra lines.

## Write a comment only for these

1. **A non-obvious why.** A line or block a competent reader would question:
   a workaround for a specific bug, a constraint not visible in the code, a
   deliberate deviation from the obvious approach. One line.
2. **Section dividers** in a long function or file. Short label, same format
   throughout the file.
3. **A file header** on a long script or class file: what it does, how the
   pieces fit together. This is the one place a long comment belongs. That's the 
   case if and only if the file is long enough OR complex enough that a competent 
   reader would have to read the whole file to understand it. Otherwise, the 
   file is too short for a header.

## Never write these

- Change narration: "Changed X to Y", "Fixed ...", "Previously ...",
  "This didn't work so ...", "Now handles ...", "Updated to ...",
  "Removed the old ...".
- References to the conversation: "as requested", "per the user".
- Restating the code: `// increment i` above `i++`.
- An explanation of the fix. If the fix needs explaining, put it in the
  reply to the user or the commit message, not in the source.
- Commented-out code.
- Multi-line or multi-sentence comments anywhere below the file header. No
  line is special enough to earn one. If a line needs a paragraph, fix the
  line or the naming instead.

## When editing existing code

- Keep an existing comment only if you would also write it fresh today under
  "Write a comment only for these". Accurate is not the test. A true comment
  that breaks a rule above, such as a multi-line header on a file too short
  for one, still gets trimmed to one line or deleted.
- If the code changed enough that a comment is now false, rewrite it as if
  writing it fresh, not as a diff of the old comment.
- Don't mark what you touched. The diff already shows it.
- Keep the file's existing comment style: `//` vs `#`, divider format,
  docstring convention. Don't introduce a new one.
- Wrap at the file's existing width, or 80 columns if there is no pattern.

## Other rules
- No em dashes, semicolons, or colons in comments. Do not use a period at the end of a single-line comment. Periods belong only in the file header.
- Do not use multiple hypens for sections. This is something you should avoid. E.g.:
```js
// --- 4. filtering ------------------------------------------------------------------
```
Instead, do this:
```js
/* Filtering */
```

## Before finishing

Reread every comment you added or changed. If it only makes sense to someone
who knows what the code looked like before this edit, delete it.

## Examples

Two before and after pairs live in `examples/`, one Auth.js config and one
Mongoose schema. When a comment is borderline, read the pair closest to the
file you are editing:

- [examples/auth/bad.md](examples/auth/bad.md) and [examples/auth/good.md](examples/auth/good.md)
- [examples/db-model/bad.md](examples/db-model/bad.md) and [examples/db-model/good.md](examples/db-model/good.md)

---

### Short examples for you

This is a bad comment, delete it:

```ts
// Switched from findIndex to a Map lookup because findIndex was O(n) and
// was causing the timeout in the batch job. Old approach didn't scale.
const idx = indexById.get(id);
```

---

This is a long comment and we do not want it:

```py
def _compile_queries(run_id: str, leaf_id: str, leaf: dict) -> list[dict]:
  """Flatten a leaf's per-platform queries into rows.

  The LLM writes each platform's queries itself, in that platform's voice. We do not
  cross-product one query set across platforms -- Reddit phrasing is not LinkedIn
  phrasing, and pasting one across all three is how a SERP budget disappears for
  nothing.
  """
  pass
```

You can convert it to:

```py
# Flatten a leaf's per-platform queries into rows
def _compile_queries(run_id: str, leaf_id: str, leaf: dict) -> list[dict]:
  pass
```

---

This why is real, but the comment is still wrong because it is multi-line:

```ts
// Three queues drained in strict priority order. Essential pages
// (privacy, terms, about, contact) come first because several engines
// score a hard 0 when they are missing, and they are always one footer
// hop away. Then crawled links. The sitemap is filler, a large one
// queued ahead of the homepage's links would starve the footer.
const essentialQueue: Item[] = [];
```

Compress it to the strongest clause and drop everything else:

```ts
// Essential pages first, several engines score 0 when they are missing
const essentialQueue: Item[] = [];
```

## Manual sweep

When invoked as `/clean-comment-lines <path>`, apply these rules to that file.
With no path, sweep the files changed in this session. Change nothing except
comments, and report each deletion in one line.

In a sweep, judge every existing comment as if you were writing it fresh.
"It was already there and it is still true" is not a reason to keep one.
