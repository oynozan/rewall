# docs

The Rewall documentation site, served at docs.rewall.me. It is a Next.js app that uses Nextra to turn
Markdown files into pages, styled to match the dashboard.

## What is in it

| Page or folder     | What it covers                                                              |
| ------------------ | --------------------------------------------------------------------------- |
| `index.mdx`        | What Rewall is, the problem, who it is for, what runs where.                |
| `get-started.mdx`  | The dashboard at rewall.me from the first click, and the developer path.    |
| `how-it-works.mdx` | Name, seal, share, open, then the key, the records, rotation and recovery.  |
| `ensv2.mdx`        | What ENS and ENSv2 are and exactly how Rewall uses them, with addresses.    |
| `built-with.mdx`   | ENS, Chainlink and Ledger, what each gives Rewall, what is real today.      |
| `examples/`        | One page per program in `examples/`, plus an overview with setup and cast.  |
| `components/`      | One page per folder in the repo, plus an overview of how they fit together. |
| `faq.mdx`          | The questions people ask first.                                             |

## Writing a page

Pages are Markdown files in `content/`. The file name is the URL, so `content/sdk.mdx` is `/sdk`.
A `_meta.ts` beside the pages sets the order of the sidebar and the title each page shows there. A
folder is a section, and its `index.mdx` with `asIndexPage: true` is the folder's own page.

A fenced code block with the language `mermaid` renders as a diagram. Code blocks use the same
colors as the code sample on the landing page, and every block has a copy button.

Style rules the check enforces: no em dashes or en dashes, no buzzwords, no sentence over forty
words. Anything with `<` or `{` in prose must sit in backticks, or the page fails to build.

## Running it

```bash
pnpm install
pnpm run dev            # http://localhost:3001, open it as localhost, not 127.0.0.1
pnpm run build          # also writes the search index into public/_pagefind
pnpm run start
pnpm run check          # against a running server
```

Search only works on a built site, because the index is made from the built pages. The dev server
refuses to load its own chunks for a page opened as `127.0.0.1`, so diagrams stay blank there.

`pnpm run check` fetches every page and fails on a trace of the stock theme, a missing asset, a link
to a page or heading that does not exist, a Mermaid block that did not become a diagram, or a style
slip.

## How the look is applied

`app/globals.css` holds everything. The theme keeps its own rules inside CSS cascade layers, so a
plain rule in that file wins without any tricks. Most of the work is done by giving the theme's
grey tokens the dashboard's values from `web/src/app/globals.css`. The fonts are the same three the
dashboard loads. The site is dark only.

## Two pins to know about

- `zod` is held at 4.3.6 by a pnpm override. Nextra 4.6.1 fails to render any page with zod 4.4 or
  later, see shuding/nextra#5008. Remove the override once Nextra ships a fix.
- `next.config.ts` replaces one Turbopack alias. Nextra writes it with a Windows path separator,
  which Turbopack cannot follow on Windows. The replacement points at the same file.
