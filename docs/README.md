# docs

The Rewall documentation site, served at docs.rewall.me. It is a Next.js app that uses Nextra to turn
Markdown files into pages, styled to match the dashboard.

## Writing a page

Pages are Markdown files in `content/`. The file name is the URL, so `content/sdk.mdx` is `/sdk`.
`content/_meta.ts` sets the order of the sidebar and the title each page shows there. A folder
inside `content/` becomes a section.

A fenced code block with the language `mermaid` renders as a diagram. Code blocks use the same
colors as the code sample on the landing page, and every block has a copy button.

## Running it

```bash
pnpm install
pnpm run dev            # http://localhost:3001
pnpm run build          # also writes the search index into public/_pagefind
pnpm run start
pnpm run check          # against a running server, asserts the theme carries no stock branding
```

Search only works on a built site, because the index is made from the built pages.

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
