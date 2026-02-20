# CLAUDE.md — georgehyde.dev

Project context for Claude Code. Read this before making any changes.

## Critical Warning

**`npm run deploy` pushes directly to production.** Never run it without:
1. Explicit user confirmation
2. Local visual verification via `npm run preview`

## Commands

```bash
npm run dev       # Dev server at localhost:4321 (hot reload)
npm run build     # Static build to dist/
npm run preview   # Preview production build locally — verify here before deploy
npm run deploy    # ⚠️  PRODUCTION DEPLOY — requires explicit user approval
```

## Architecture

**Astro (static output) + Cloudflare Workers**

- Pages are `.astro` files in `src/pages/` — compiled to static HTML
- Workers handle dynamic routing (KV, R2, auth) via `wrangler.toml`
- Hosted on Cloudflare; custom domain routing configured in `wrangler.toml`

**Cloudflare resources (wrangler.toml):**
- KV namespace: `BLOG_POSTS` — ready for blog post storage
- R2 bucket: `georgehyde-dev-blog-images` — ready for image uploads

## Key Files

| File | Purpose |
|------|---------|
| `src/pages/index.astro` | Homepage (~957 lines, inline styles + vanilla JS) |
| `src/pages/progress.astro` | Interactive roadmap (~846 lines) |
| `src/lib/github.ts` | GitHub API fetching |
| `src/lib/kv-store.ts` | Cloudflare KV CRUD helpers (ready, not yet wired to pages) |
| `src/middleware.ts` | Astro middleware (exists but empty) |
| `wrangler.toml` | Cloudflare Workers config, KV/R2 bindings, routing |

## In-Progress Features

- **Blog** — KV store scaffolded (`kv-store.ts`), no pages yet. Planned: browser-based editing interface.
- **Auth** — `@clerk/astro` installed but not integrated. Middleware is the intended integration point.
- **Image uploads** — R2 bucket configured, no upload flow yet.

## Code Philosophy

**Security and simplicity over everything.**

- **Less code is better.** Fewer lines = fewer bugs, easier audits, easier maintenance. If a feature can be removed or deferred, it should be.
- **Minimize dependencies.** Every new package is an attack surface and a maintenance burden. Reach for the platform (Web APIs, Cloudflare primitives) before npm. When a dependency is necessary, prefer well-audited, minimal ones.
- **Build simple, secure systems.** Prefer boring, obvious solutions over clever ones. Validate and sanitize all user input. Never trust client-supplied data on the server side.
- **Inline styles and vanilla JS** — no CSS frameworks, no client-side JS frameworks. Pages are static HTML with minimal scripting.
- No test suite configured — verify changes visually with `npm run preview`
- Astro components in `src/pages/` are the source of truth; avoid duplicating logic into separate files unless reuse is clear and justified
