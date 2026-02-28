# MASTER_PLAN: georgehyde.dev

## Identity

**Type:** web-app (personal site)
**Languages:** Astro/TypeScript (95%), CSS (5%)
**Root:** /Users/georgehyde/Documents/Projects/personal_site/georgehyde_dev
**Created:** 2026-02-20
**Last updated:** 2026-02-20

Personal website for George Hyde, built with Astro and deployed on Cloudflare Workers. Features a landing page with GitHub activity, an interactive development progress tracker, and blog infrastructure (KV store for posts, R2 bucket for images). Currently fully static with no admin UI or authentication.

## Architecture

    src/pages/          — Astro pages (index.astro, progress.astro). Public-facing routes.
    src/lib/            — Shared utilities. github.ts (GitHub API client), kv-store.ts (blog CRUD via KV).
    src/middleware.ts   — Astro middleware entry point. Currently empty.
    public/             — Static assets (favicon, images).
    dist/               — Build output, deployed to Cloudflare Workers.
    wrangler.toml       — Cloudflare Workers config. KV namespace (BLOG_POSTS), R2 bucket (blog images).

## Original Intent

> Wire up Clerk auth to protect a future blog admin page only. Public pages stay static. Site owner is the only user who will ever log in. Free tier only. Minimize dependencies. Security and simplicity -- boring, obvious solutions preferred.

## Principles

These are the project's enduring design principles. They do not change between initiatives.

1. **Static by default** — Pages are prerendered unless they have a specific reason to be server-rendered. Performance for visitors comes first.
2. **Reach for the platform** — Use Cloudflare Workers primitives (KV, R2, secrets) before adding third-party services or abstractions. Less code, fewer packages.
3. **Boring security** — Choose the obvious, well-documented approach over the clever one. Server-side auth over client-side. Secrets never in git.
4. **Single-owner simplicity** — This is a personal site with one admin user. Do not over-engineer for multi-tenant, team, or organizational features.
5. **Incremental progress** — Ship working increments. The progress tracker on the site itself reflects this philosophy.

---

## Decision Log

Append-only record of significant decisions across all initiatives. Each entry references
the initiative and decision ID. This log persists across initiative boundaries — it is the
project's institutional memory.

| Date | DEC-ID | Initiative | Decision | Rationale |
|------|--------|-----------|----------|-----------|
| 2026-02-20 | DEC-ASTRO-001 | clerk-auth | Use Astro hybrid output mode | Preserves static performance for public pages while enabling server-side auth for admin. Full SSR would add unnecessary overhead; client-side-only auth cannot protect server routes. |
| 2026-02-20 | DEC-CLERK-002 | clerk-auth | Use createRouteMatcher to protect /admin/* routes only | Only admin section needs protection. Explicit protected-route list is simpler and safer than protect-all-then-allowlist for a small site. |
| 2026-02-20 | DEC-ENV-003 | clerk-auth | Store CLERK_SECRET_KEY via wrangler secret; publishable key in wrangler.toml vars | Standard Cloudflare Workers practice. Secret key stays out of version control. Publishable key is safe to expose. |

---

## Active Initiatives

### Initiative: Clerk Auth Integration
**Status:** active
**Started:** 2026-02-20
**Goal:** Add Clerk authentication to protect a blog admin page, while keeping all public pages static.

> The site has blog infrastructure (KV store, R2 bucket, CRUD functions in kv-store.ts) but no admin UI or auth. Without authentication, building the admin page would expose write access to anyone. Clerk provides a managed auth service that works with Astro's middleware pattern and Cloudflare Workers, and its free tier (10,000 MAU) is more than sufficient for a single-user personal site.

**Dominant Constraint:** simplicity

#### Goals
- REQ-GOAL-001: Public pages (index, progress) remain statically prerendered with zero auth overhead
- REQ-GOAL-002: Admin routes are server-side protected -- unauthenticated requests redirect to Clerk sign-in
- REQ-GOAL-003: Blog admin page exists as a stub, ready for future CRUD UI development

#### Non-Goals
- REQ-NOGO-001: Multi-user support — only site owner logs in. No user management UI, roles, or org features.
- REQ-NOGO-002: Blog CRUD UI — this initiative wires auth only. The admin page is a stub. Blog editor is a separate initiative.
- REQ-NOGO-003: Custom sign-in page — use Clerk's hosted/component sign-in. No custom UI for auth flows.
- REQ-NOGO-004: Testing infrastructure — no test suite exists and adding one is out of scope for this initiative. Verification is manual.

#### Requirements

**Must-Have (P0)**

- REQ-P0-001: Switch Astro output to hybrid mode with @astrojs/cloudflare adapter
  Acceptance: Given `astro.config.mjs` has `output: "hybrid"` and cloudflare adapter, When `npm run build` executes, Then build succeeds and produces `dist/_worker.js/`

- REQ-P0-002: Existing public pages (index.astro, progress.astro) remain prerendered
  Acceptance: Given hybrid mode is enabled, When public pages are loaded, Then they are served as static HTML with no server-side processing per request

- REQ-P0-003: Clerk middleware protects /admin/* routes server-side
  Acceptance: Given an unauthenticated request to /admin/*, When the middleware runs, Then the request is redirected to Clerk sign-in. Given an authenticated request to /admin/*, When the middleware runs, Then the request proceeds to the page.

- REQ-P0-004: Environment variables configured correctly for Cloudflare Workers
  Acceptance: Given CLERK_SECRET_KEY is set via `wrangler secret put` and PUBLIC_CLERK_PUBLISHABLE_KEY is in wrangler.toml vars, When the Worker runs, Then Clerk middleware can authenticate requests.

- REQ-P0-005: wrangler.toml updated with nodejs_compat flag and recent compatibility_date
  Acceptance: Given wrangler.toml has `compatibility_flags = ["nodejs_compat"]` and `compatibility_date >= "2024-09-23"`, When deployed, Then @clerk/astro's node:async_hooks dependency resolves correctly.

**Nice-to-Have (P1)**

- REQ-P1-001: Admin stub page shows authenticated user info (name/email from Clerk)
- REQ-P1-002: Sign-out button on admin page

**Future Consideration (P2)**

- REQ-P2-001: Blog post CRUD UI on admin page — design admin route structure to support /admin/posts, /admin/posts/new, /admin/posts/[id]/edit
- REQ-P2-002: API routes for blog CRUD (POST/PUT/DELETE) protected by Clerk auth — middleware pattern already covers /admin/*

#### Definition of Done

All P0 requirements satisfied. `npm run build` succeeds. Public pages serve as static HTML. Navigating to /admin/* without auth redirects to Clerk sign-in. Navigating to /admin/* with auth shows the admin stub page. Deployed to Cloudflare Workers without errors.

#### Architectural Decisions

- DEC-ASTRO-001: Use Astro hybrid output mode
  Addresses: REQ-GOAL-001, REQ-P0-001, REQ-P0-002.
  Rationale: Hybrid mode (`output: "hybrid"`) keeps public pages prerendered by default while allowing admin pages to opt into SSR with `export const prerender = false`. Full SSR would add unnecessary server overhead for static content. Client-side-only auth cannot protect server routes or API endpoints. Research confirmed @astrojs/cloudflare adapter supports hybrid mode.

- DEC-CLERK-002: Use createRouteMatcher to protect /admin/* routes only
  Addresses: REQ-P0-003.
  Rationale: Clerk's `createRouteMatcher(['/admin(.*)'])` pattern explicitly marks protected routes. For a site with one protected section, this is simpler and more readable than protecting everything and allowlisting public routes. New public pages are safe by default.

- DEC-ENV-003: Store CLERK_SECRET_KEY via wrangler secret; publishable key in wrangler.toml vars
  Addresses: REQ-P0-004.
  Rationale: `CLERK_SECRET_KEY` is sensitive and must never appear in version control. `wrangler secret put` stores it encrypted in Cloudflare's infrastructure. `PUBLIC_CLERK_PUBLISHABLE_KEY` is safe to expose (it's in client-side JS anyway) and benefits from being visible in config for clarity.

#### Phase 1: Infrastructure — Astro Hybrid Mode + Cloudflare Adapter
**Status:** completed (2026-02-28)
**Decision IDs:** DEC-ASTRO-001, DEC-ENV-003
**Requirements:** REQ-P0-001, REQ-P0-002, REQ-P0-005
**Issues:** #1
**Definition of Done:**
- REQ-P0-001 satisfied: `astro.config.mjs` uses hybrid mode with cloudflare adapter, `npm run build` succeeds
- REQ-P0-002 satisfied: index.astro and progress.astro have `export const prerender = true` and serve as static HTML
- REQ-P0-005 satisfied: wrangler.toml has nodejs_compat flag and compatibility_date >= 2024-09-23

##### Planned Decisions
- DEC-ASTRO-001: Use Astro hybrid output mode — preserves static performance while enabling SSR for admin — Addresses: REQ-P0-001, REQ-P0-002

##### Work Items

**W1-1: Install @astrojs/cloudflare adapter**
- `npm install @astrojs/cloudflare`
- This is the only new dependency for this phase

**W1-2: Update astro.config.mjs**
- Import `cloudflare` from `@astrojs/cloudflare`
- Import `clerk` from `@clerk/astro`
- Set `output: "hybrid"`
- Set `adapter: cloudflare()`
- Add `clerk()` to `integrations` array

**W1-3: Add prerender exports to existing pages**
- `src/pages/index.astro`: add `export const prerender = true` in frontmatter
- `src/pages/progress.astro`: add `export const prerender = true` in frontmatter
- These are technically redundant in hybrid mode (static is default) but make intent explicit

**W1-4: Update wrangler.toml**
- Change `compatibility_date` from `"2023-12-01"` to `"2025-03-25"` (or latest stable)
- Add `compatibility_flags = ["nodejs_compat"]`
- Update `[assets]` section: change `directory = "./dist"` to new adapter format if needed
- Add `main = "dist/_worker.js/index.js"` (required by @astrojs/cloudflare adapter)

**W1-5: Create .assetsignore in public/**
- Add `_worker.js` and `_routes.json` to prevent them being treated as static assets

**W1-6: Verify build**
- Run `npm run build` and confirm it produces `dist/_worker.js/`
- Run `npx wrangler dev` and confirm public pages serve correctly

##### Critical Files
- `astro.config.mjs` — Central config change: output mode, adapter, integrations
- `wrangler.toml` — Cloudflare Workers config: compatibility flags, asset binding
- `src/pages/index.astro` — Must remain static after migration
- `src/pages/progress.astro` — Must remain static after migration
- `package.json` — New dependency: @astrojs/cloudflare

##### Decision Log
- DEC-ASTRO-001 (DEC-INFRA-001 in code): Astro v5 removed "hybrid" output mode. Equivalent achieved with `output: "server"` + `export const prerender = true` on static pages. Addresses REQ-P0-001, REQ-P0-002.
- DEC-ENV-003 (partial): wrangler.toml updated with `compatibility_date = "2025-03-25"`, `nodejs_compat` flag, and `main = "dist/_worker.js/index.js"`. Addresses REQ-P0-005.

#### Phase 2: Auth Layer — Clerk Middleware + Admin Stub
**Status:** planned
**Decision IDs:** DEC-CLERK-002, DEC-ENV-003
**Requirements:** REQ-P0-003, REQ-P0-004, REQ-P1-001, REQ-P1-002
**Issues:** #2
**Definition of Done:**
- REQ-P0-003 satisfied: unauthenticated /admin/* requests redirect to Clerk sign-in; authenticated requests proceed
- REQ-P0-004 satisfied: env vars configured, Clerk middleware authenticates successfully
- REQ-P1-001 satisfied (nice-to-have): admin stub shows user info
- REQ-P1-002 satisfied (nice-to-have): sign-out button works

##### Planned Decisions
- DEC-CLERK-002: Use createRouteMatcher to protect /admin/* routes only — explicit is better than implicit for one protected section — Addresses: REQ-P0-003
- DEC-ENV-003: Store CLERK_SECRET_KEY via wrangler secret — standard CF Workers practice — Addresses: REQ-P0-004

##### Work Items

**W2-1: Configure environment variables**
- Create `.env` file (must be gitignored) with:
  ```
  PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
  CLERK_SECRET_KEY=sk_test_...
  ```
- Add `PUBLIC_CLERK_PUBLISHABLE_KEY` to `wrangler.toml` `[vars]` section
- Run `wrangler secret put CLERK_SECRET_KEY` for production
- Verify `.gitignore` includes `.env`

**W2-2: Implement Clerk middleware (src/middleware.ts)**
- Replace empty file with:
  ```ts
  import { clerkMiddleware, createRouteMatcher } from '@clerk/astro/server'

  const isProtectedRoute = createRouteMatcher(['/admin(.*)'])

  export const onRequest = clerkMiddleware((auth, context) => {
    const { isAuthenticated, redirectToSignIn } = auth()
    if (!isAuthenticated && isProtectedRoute(context.request)) {
      return redirectToSignIn()
    }
  })
  ```

**W2-3: Create admin stub page (src/pages/admin/index.astro)**
- `export const prerender = false` (opts into SSR)
- Show authenticated user info (name, email) from `Astro.locals.auth()`
- Include sign-out button using Clerk's `<SignOutButton>` component or redirect
- Minimal styling consistent with existing dark theme
- Link back to home page

**W2-4: Verify auth flow end-to-end**
- `npx wrangler dev` (or `npm run dev`)
- Confirm public pages load without auth prompts
- Navigate to /admin/ — should redirect to Clerk sign-in
- Sign in with Clerk — should return to /admin/ showing user info
- Sign out — should redirect away from /admin/

##### Critical Files
- `src/middleware.ts` — Auth gate: all requests pass through here
- `src/pages/admin/index.astro` — New SSR page, first protected route
- `.env` — Local dev secrets (gitignored)
- `wrangler.toml` — Publishable key in vars section

##### Decision Log
<!-- Guardian appends here after phase completion -->

#### Clerk Auth Integration Worktree Strategy

Main is sacred. Each phase works in its own worktree:
- **Phase 1:** `{project_root}/.worktrees/clerk-infra` on branch `clerk-infra`
- **Phase 2:** `{project_root}/.worktrees/clerk-auth` on branch `clerk-auth`

#### Clerk Auth Integration References

- [Clerk Astro Quickstart](https://clerk.com/docs/astro/getting-started/quickstart)
- [clerkMiddleware() Reference](https://clerk.com/docs/reference/astro/clerk-middleware)
- [Clerk Astro Deployment Guide](https://clerk.com/docs/guides/development/deployment/astro)
- [@astrojs/cloudflare Adapter Docs](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- [Clerk Pricing](https://clerk.com/pricing) — Free tier: 10,000 MAU, all features included

#### Clerk Free Tier Notes

- **10,000 MAU free** on all plans (including free). For a single-user personal site, this is effectively unlimited.
- **50,000 monthly retained users** before upgrade required (irrelevant for personal use).
- **First Day Free**: new user activity not counted for 24 hours after signup.
- **All features included**: pre-built components, custom domain, middleware auth.
- **Watch for**: If you add public sign-in for blog comments later, MAU counts would increase. At 10k MAU free, this is unlikely to matter for a personal blog.
- **No features gated on free tier** that affect this use case.

---

## Completed Initiatives

| Initiative | Period | Phases | Key Decisions | Archived |
|-----------|--------|--------|---------------|----------|

---

## Parked Issues

Issues not belonging to any active initiative. Tracked for future consideration.

| Issue | Description | Reason Parked |
|-------|-------------|---------------|
