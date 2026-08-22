# MASTER_PLAN: georgehyde.dev

## Identity

**Type:** web-app (personal site)
**Languages:** Astro/TypeScript (95%), CSS (5%)
**Root:** /Users/georgehyde/Documents/Projects/personal_site/georgehyde_dev
**Created:** 2026-02-20
**Last updated:** 2026-03-01

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
| 2026-02-28 | DEC-CLERK-003 | clerk-auth | Admin stub uses server-side auth() for session display | No client-side Clerk components needed. Server-side auth() is already populated by middleware. Keeps admin page dependency-free. |
| 2026-02-28 | DEC-KV-001 | blog-system | Use KV metadata for post listings, slug-prefixed keys | Eliminates N+1 reads on list pages. KV metadata (up to 1KB) returned free by list(). Personal blog will never hit metadata limit. |
| 2026-02-28 | DEC-URL-002 | blog-system | Standard blog URL structure: /blog, /blog/[slug], /admin/posts/* | Conventional, predictable URLs. Admin routes under /admin/* are auto-protected by existing Clerk middleware. |
| 2026-02-28 | DEC-EDITOR-003 | blog-system | Plain HTML textarea editor, zero dependencies | Minimizes dependencies per project principles. Single author can write HTML directly. Upgrade path to markdown trivial — body field is just a string. |
| 2026-02-28 | DEC-RENDER-004 | blog-system | SSR for all blog pages (KV requires runtime access) | Cloudflare KV only accessible server-side at request time. No build-time KV access for prerendering. All blog pages use prerender=false. |
| 2026-02-28 | DEC-BLOG-001 | blog-system | SSR blog list page with Cloudflare runtime env access | prerender=false forces Worker invocation per request, giving KV binding access via Astro.locals.runtime.env. No client-side JS needed — plain server-rendered HTML. |
| 2026-02-28 | DEC-BLOG-002 | blog-system | 404 response for missing or unpublished posts | Redirect would leak slug existence (timing attack). 404 is correct HTTP semantics and prevents slug enumeration. Unpublished posts treated same as missing. |
| 2026-03-01 | DEC-ADMIN-001 | blog-system | PRG pattern (303) for all admin form mutations | POST → Redirect → GET prevents double-submission on back/refresh. Standard web hygiene for HTML forms without fetch. All create/update/delete redirect to /admin/posts with 303. |
| 2026-03-01 | DEC-ADMIN-002 | blog-system | Server-side slug validation with /^[a-z0-9-]+$/ regex | Slug is used as KV key suffix and URL path segment. Strict allowlist prevents path traversal and malformed KV keys. Client-side auto-generation is UX only — not trusted server-side. |
| 2026-07-13 | DEC-SH-001 | site-hardening | Preserve commit 8012af5 as the rich-editor and LinkedIn-removal baseline | The deployed baseline is review input, not disposable work. Hardening must build on it, not roll it back or reintroduce removed LinkedIn UI. |
| 2026-07-13 | DEC-SH-002 | site-hardening | Centralize blog validation and stored-HTML policy in shared helpers | Slug, title, body, publish-state, and HTML safety checks currently risk drifting across API routes and render paths. One helper authority keeps admin writes and public rendering aligned. |
| 2026-07-13 | DEC-SH-003 | site-hardening | Enforce single-owner admin authorization on top of Clerk auth | Clerk remains the authentication provider, but admin mutation authority belongs to one configured owner user. This closes the gap where any authenticated Clerk user could reach admin write surfaces. |
| 2026-07-13 | DEC-SH-004 | site-hardening | Use Node built-in test runner for focused security and configuration tests | Local Node v24.8.0 is sufficient for dependency-free tests. This adds automated coverage without introducing a new testing framework dependency. |
| 2026-07-13 | DEC-SH-005 | site-hardening | Route build, validation, preview, deploy, and provider operations through Concrete | `.concrete/` is initialized and guard-enforced. Concrete is the operational authority; direct npm build/test/deploy or Wrangler deploy paths must not bypass it. |

---

## Active Initiatives

### Initiative: Clerk Auth Integration
**Status:** completed
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
**Status:** completed (2026-02-28)
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
- DEC-CLERK-002: Implemented createRouteMatcher with `/admin(.*)` pattern. Middleware uses `auth()` callable returning `{userId}` — checks `!userId` rather than `!isAuthenticated`. Addresses REQ-P0-003.
- DEC-CLERK-003: Admin stub uses server-side `Astro.locals.auth()` for userId/sessionId display. No client-side Clerk components — sign-out uses hosted URL. Addresses REQ-P1-001, REQ-P1-002.
- DEC-ENV-003: CLERK_SECRET_KEY set via `wrangler secret put`. PUBLIC_CLERK_PUBLISHABLE_KEY in wrangler.toml `[vars]`. Addresses REQ-P0-004.

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

### Initiative: Blog System
**Status:** completed
**Started:** 2026-02-28
**Goal:** Build a complete blog with public reading pages and an auth-protected admin editor, using existing KV infrastructure.

> The site has blog infrastructure (KV store with CRUD helpers, R2 bucket, Clerk auth protecting /admin/*) but no blog UI. Readers cannot browse posts. The site owner cannot create or manage content without direct KV API calls. This initiative builds the public blog pages and admin editor to make the blog functional end-to-end. Zero new npm dependencies.

**Dominant Constraint:** simplicity

#### Goals
- REQ-GOAL-101: Readers can browse published blog posts at /blog and read individual posts at /blog/[slug]
- REQ-GOAL-102: Site owner can create, edit, publish/unpublish, and delete blog posts from /admin/posts
- REQ-GOAL-103: All write operations are server-side auth-protected with zero client-side auth dependencies
- REQ-GOAL-104: Zero new npm dependencies added to the project

#### Non-Goals
- REQ-NOGO-101: Image upload UI — R2 bucket exists but upload adds significant complexity. Posts reference external image URLs in HTML body. Future initiative.
- REQ-NOGO-102: Comments system — out of scope. Personal blog, no reader interaction needed yet.
- REQ-NOGO-103: RSS feed — easy add-on but not v1. Does not require data model changes.
- REQ-NOGO-104: Search functionality — post volume too low to justify. KV list() is sufficient.
- REQ-NOGO-105: Post categories or tags — unnecessary complexity for a personal blog at this stage.

#### Requirements

**Must-Have (P0)**

- REQ-P0-101: Enhanced BlogPost data model with slug, timestamps, and published flag
  Acceptance: Given the updated BlogPost interface, When a post is created, Then it stores slug, title, body, author, createdAt, updatedAt, and published fields in KV with listing metadata.

- REQ-P0-102: KV storage uses slug-prefixed keys with metadata for efficient listing
  Acceptance: Given posts stored with key `post:{slug}` and metadata `{title, slug, createdAt, published}`, When `list({prefix: "post:"})` is called, Then all post summaries are returned in a single KV call without fetching individual values.

- REQ-P0-103: Public blog list page at /blog showing published posts
  Acceptance: Given published posts exist in KV, When a reader navigates to /blog, Then they see a list of published posts (title, date) sorted by creation date descending. Draft posts are not shown.

- REQ-P0-104: Public blog detail page at /blog/[slug] showing a single post
  Acceptance: Given a published post with slug "my-post" exists, When a reader navigates to /blog/my-post, Then they see the full post (title, date, author, body rendered as HTML). Given the post is unpublished, When navigated to, Then a 404 is returned.

- REQ-P0-105: Admin post list page at /admin/posts showing all posts (drafts and published)
  Acceptance: Given the site owner is authenticated, When they navigate to /admin/posts, Then they see all posts with title, status (draft/published), date, and edit/delete actions.

- REQ-P0-106: Admin create post form at /admin/posts/new
  Acceptance: Given the site owner is authenticated, When they fill in title, slug, body (HTML textarea), published toggle and submit, Then a new post is created in KV and they are redirected to /admin/posts.

- REQ-P0-107: Admin edit post form at /admin/posts/[slug]/edit
  Acceptance: Given the site owner is authenticated and a post exists, When they navigate to /admin/posts/{slug}/edit, Then the form is pre-filled. When they submit changes, Then the post is updated in KV with a new updatedAt timestamp.

- REQ-P0-108: Admin delete post capability
  Acceptance: Given the site owner is authenticated, When they delete a post from /admin/posts, Then the post is removed from KV and the list refreshes.

- REQ-P0-109: API routes for create/update/delete under /admin/api/posts
  Acceptance: Given API routes at /admin/api/posts (POST) and /admin/api/posts/[slug] (PUT, DELETE), When forms submit to these endpoints, Then CRUD operations execute and redirect appropriately. All routes are auth-protected by existing middleware.

**Nice-to-Have (P1)**

- REQ-P1-101: Live HTML preview panel in the editor
- REQ-P1-102: Auto-generate slug from title (with manual override)
- REQ-P1-103: Confirmation dialog before delete

**Future Consideration (P2)**

- REQ-P2-101: Image upload to R2 with drag-and-drop — design body field to support embedded image URLs
- REQ-P2-102: Markdown editor option — body field is a string, format-agnostic by design
- REQ-P2-103: RSS feed generation from published posts

#### Definition of Done

All P0 requirements satisfied. Site owner can create, edit, delete, and publish/unpublish blog posts from /admin/posts. Public readers can browse published posts at /blog and read individual posts at /blog/[slug]. All write operations are auth-protected. Zero new npm dependencies. Builds and runs on `wrangler dev` without errors.

#### Architectural Decisions

- DEC-KV-001: Use KV metadata for post listings, slug-prefixed keys
  Addresses: REQ-P0-101, REQ-P0-102, REQ-P0-103.
  Rationale: KV `list()` returns key metadata (up to 1KB per key) for free. Storing `{title, slug, createdAt, published}` as metadata eliminates the N+1 fetch pattern in the current `listBlogPosts()`. Posts keyed as `post:{slug}` allow future key namespacing. A personal blog will never hit the 1KB metadata limit.

- DEC-URL-002: Standard blog URL structure with /blog and /admin/posts
  Addresses: REQ-P0-103, REQ-P0-104, REQ-P0-105, REQ-P0-106, REQ-P0-107.
  Rationale: Conventional, predictable URLs. Public pages at `/blog` and `/blog/[slug]`. Admin pages at `/admin/posts`, `/admin/posts/new`, `/admin/posts/[slug]/edit`. Admin routes are auto-protected by existing Clerk middleware (`/admin(.*)`). API routes at `/admin/api/posts` follow the same pattern.

- DEC-EDITOR-003: Plain HTML textarea editor, zero dependencies
  Addresses: REQ-P0-106, REQ-P0-107, REQ-GOAL-104.
  Rationale: Minimizes dependencies per project principle #2 (reach for the platform). Single author can write HTML directly. The `body` field stores raw HTML as a string — format-agnostic by design. Upgrade path to markdown requires only adding a parser on the render side; no data model or editor changes needed.

- DEC-EDITOR-004: Platform rich-text editor, zero dependencies
  Addresses: REQ-P0-106, REQ-P0-107, REQ-GOAL-104.
  Rationale: Supersedes DEC-EDITOR-003 for the authoring UI while preserving the same storage/API contract. The browser contenteditable surface and formatting toolbar produce HTML in the existing `body` field, avoiding an editor dependency and removing the need to hand-write HTML for routine posts.

- DEC-RENDER-004: SSR for all blog pages (KV requires runtime access)
  Addresses: REQ-P0-103, REQ-P0-104.
  Rationale: Cloudflare KV is only accessible server-side at request time via the Workers runtime. There is no build-time KV access for Astro prerendering. All blog pages (`/blog`, `/blog/[slug]`) and admin pages use `export const prerender = false`.

#### Phase 1: Data Model + Public Blog (Read-Only)
**Status:** completed (2026-02-28)
**Decision IDs:** DEC-KV-001, DEC-RENDER-004, DEC-BLOG-001, DEC-BLOG-002
**Requirements:** REQ-P0-101, REQ-P0-102, REQ-P0-103, REQ-P0-104
**Issues:** #3
**Definition of Done:**
- REQ-P0-101 satisfied: BlogPost interface has slug, title, body, author, createdAt, updatedAt, published
- REQ-P0-102 satisfied: KV functions use `post:{slug}` keys with metadata; list returns summaries in one call
- REQ-P0-103 satisfied: /blog shows published posts sorted by date descending; drafts hidden
- REQ-P0-104 satisfied: /blog/[slug] renders full post HTML; unpublished posts return 404

##### Planned Decisions
- DEC-KV-001: Use KV metadata for listings, slug-prefixed keys — eliminates N+1 reads — Addresses: REQ-P0-101, REQ-P0-102
- DEC-RENDER-004: SSR for blog pages — KV only accessible at request time — Addresses: REQ-P0-103, REQ-P0-104

##### Work Items

**W1-1: Enhance BlogPost interface and KV functions (src/lib/kv-store.ts)**
- Update `BlogPost` interface: add `slug`, `createdAt`, `updatedAt`, `published` fields; remove `id` (replaced by `slug`)
- Update `Env` interface: keep `BLOG_POSTS: KVNamespace`
- Add `PostMetadata` interface: `{title: string, slug: string, createdAt: string, published: boolean}`
- Rewrite `putBlogPost()`: store with key `post:{slug}`, value is full JSON, metadata is `PostMetadata`
- Rewrite `getBlogPost()`: fetch by `post:{slug}` key
- Rewrite `deleteBlogPost()`: delete by `post:{slug}` key
- Rewrite `listBlogPosts()`: use `list({prefix: "post:"})`, return metadata array (no N+1)
- Add `listPublishedPosts()`: filter metadata where `published === true`, sort by `createdAt` descending

**W1-2: Add KV namespace binding to wrangler.toml**
- Add `[[kv_namespaces]]` section with `binding = "BLOG_POSTS"` and the namespace ID
- The namespace ID must come from `wrangler kv:namespace list` or the Cloudflare dashboard
- Note: this may already be configured via dashboard; verify before adding

**W1-3: Create public blog list page (src/pages/blog/index.astro)**
- `export const prerender = false`
- Call `listPublishedPosts()` to get metadata for published posts
- Render list of post titles linking to `/blog/{slug}`, with formatted dates
- Dark theme consistent with existing pages (bg #0a0a0a, text #e5e5e5, Inter font)
- Empty state: "No posts yet" message
- Link back to home page

**W1-4: Create public blog detail page (src/pages/blog/[slug].astro)**
- `export const prerender = false`
- Dynamic route: slug from `Astro.params.slug`
- Call `getBlogPost()` with slug
- If post is null or `published === false`, return 404
- Render post: title as h1, date and author below, body as raw HTML (`set:html`)
- Link back to /blog
- Dark theme matching list page

**W1-5: Seed a test post and verify**
- Use `wrangler kv:key put --namespace-id=<id>` to seed a test post
- Or create a seed script that uses the KV functions directly
- Verify /blog shows the post, /blog/{slug} renders it

##### Critical Files
- `src/lib/kv-store.ts` — Data model and KV access layer (complete rewrite of functions)
- `src/pages/blog/index.astro` — New SSR page: public blog list
- `src/pages/blog/[slug].astro` — New SSR page: public blog detail
- `wrangler.toml` — KV namespace binding (may need adding)

##### Decision Log
<!-- Guardian appends here after phase completion -->

#### Phase 2: Admin Blog Editor (CRUD)
**Status:** completed (2026-03-01)
**Decision IDs:** DEC-EDITOR-003, DEC-URL-002, DEC-ADMIN-001, DEC-ADMIN-002
**Requirements:** REQ-P0-105, REQ-P0-106, REQ-P0-107, REQ-P0-108, REQ-P0-109
**Issues:** #4
**Definition of Done:**
- REQ-P0-105 satisfied: /admin/posts shows all posts (drafts + published) with edit/delete actions
- REQ-P0-106 satisfied: /admin/posts/new creates a new post and redirects to /admin/posts
- REQ-P0-107 satisfied: /admin/posts/[slug]/edit pre-fills form, updates post with new updatedAt
- REQ-P0-108 satisfied: delete removes post from KV
- REQ-P0-109 satisfied: API routes handle POST, PUT, DELETE under /admin/api/posts

##### Planned Decisions
- DEC-EDITOR-004: Platform rich-text editor, zero deps — author can format posts without hand-writing HTML — Addresses: REQ-P0-106, REQ-P0-107
- DEC-URL-002: /admin/posts/*, /admin/api/posts/* — auto-protected by Clerk middleware — Addresses: REQ-P0-105, REQ-P0-109

##### Work Items

**W2-1: Create admin post list page (src/pages/admin/posts/index.astro)**
- `export const prerender = false`
- Call `listBlogPosts()` (all posts, not just published)
- Table/list with columns: title, status (Draft/Published badge), created date
- Each row: "Edit" link to /admin/posts/{slug}/edit, "Delete" button (form POST to API)
- "New Post" button linking to /admin/posts/new
- Link back to /admin/

**W2-2: Create admin post form component**
- Shared form layout used by both new and edit pages
- Fields: title (text input), slug (text input), body (textarea, full-width, tall), published (checkbox toggle)
- Auto-generate slug from title via JS (slugify: lowercase, replace spaces with hyphens, strip non-alphanumeric) — manual override allowed (REQ-P1-102)
- Form submits to appropriate API endpoint (POST for new, PUT for edit)

**W2-3: Create admin new post page (src/pages/admin/posts/new.astro)**
- `export const prerender = false`
- Render empty form component
- Form action: POST to /admin/api/posts

**W2-4: Create admin edit post page (src/pages/admin/posts/[slug]/edit.astro)**
- `export const prerender = false`
- Fetch existing post by slug, pre-fill form
- If post not found, return 404
- Form action: PUT to /admin/api/posts/{slug}

**W2-5: Create API route for post creation (src/pages/admin/api/posts/index.ts)**
- `export const prerender = false`
- Handle POST: parse form data, create BlogPost, call putBlogPost(), redirect to /admin/posts
- Validate required fields (title, slug, body)
- Set createdAt and updatedAt to now, author to authenticated userId

**W2-6: Create API route for post update/delete (src/pages/admin/api/posts/[slug].ts)**
- `export const prerender = false`
- Handle PUT: parse form data, fetch existing post, merge changes, update updatedAt, call putBlogPost(), redirect to /admin/posts
- Handle DELETE: call deleteBlogPost(), redirect to /admin/posts

**W2-7: Update admin index page (src/pages/admin/index.astro)**
- Add "Manage Posts" link to /admin/posts
- Keep existing userId/sessionId display

##### Critical Files
- `src/pages/admin/posts/index.astro` — Admin post management list
- `src/pages/admin/posts/new.astro` — Create post form
- `src/pages/admin/posts/[slug]/edit.astro` — Edit post form
- `src/pages/admin/api/posts/index.ts` — API: create post
- `src/pages/admin/api/posts/[slug].ts` — API: update/delete post
- `src/pages/admin/index.astro` — Updated with link to post management

##### Decision Log
- DEC-ADMIN-001: PRG pattern (303 redirect) for all admin form mutations. POST to API route, redirect 303 to /admin/posts. Prevents double-submission on back/refresh. Applied to create, update, and delete flows. Addresses REQ-P0-106, REQ-P0-107, REQ-P0-108.
- DEC-ADMIN-002: Server-side slug validation with `/^[a-z0-9-]+$/` regex on all API routes. Slug is KV key suffix and URL path segment — strict allowlist prevents path traversal and malformed keys. Addresses REQ-P0-109.
- DEC-EDITOR-004: Platform rich-text editor with live preview, zero dependencies. Body is still stored as a raw HTML string, but `src/components/PostEditor.astro` gives the admin create/edit pages a contenteditable formatting toolbar and synchronizes the generated HTML into the existing form field. Addresses REQ-P0-106, REQ-P0-107, REQ-P1-101, REQ-P1-102.
- DEC-URL-002: Admin routes at /admin/posts/*, API routes at /admin/api/posts/*. Auto-protected by existing Clerk middleware `/admin(.*)` pattern. Addresses REQ-P0-105, REQ-P0-109.
- Implementation note: HTML forms cannot send PUT/DELETE, so update/delete API uses POST with `_method=delete` hidden field (method-override pattern). All P1 nice-to-haves delivered (live preview, slug auto-gen, delete confirmation dialog).

#### Phase 3: Deployment Verification
**Status:** completed (2026-03-01)
**Decision IDs:** none (operational phase)
**Requirements:** all P0 requirements (end-to-end verification)
**Issues:** #5
**Definition of Done:**
- Full CRUD flow works on `wrangler dev`: create, edit, publish, unpublish, delete
- Public /blog and /blog/[slug] render correctly with published posts
- Unpublished posts return 404 on public routes
- Auth gate works: unauthenticated /admin/* redirects to Clerk sign-in
- Build succeeds (`npm run build`) with zero errors

##### Planned Decisions
- No new architecture decisions. Operational verification only.

##### Work Items

**W3-1: Verify KV namespace binding**
- Confirm `wrangler kv:namespace list` shows BLOG_POSTS namespace
- Confirm `wrangler.toml` has the binding (or it's configured via dashboard)

**W3-2: End-to-end manual test on wrangler dev**
- Start `npx wrangler dev`
- Navigate to /blog — should show empty state or seeded posts
- Navigate to /admin/posts — should redirect to Clerk sign-in
- Sign in — should show post management
- Create a post — verify it appears in /admin/posts and /blog
- Edit the post — verify changes reflect
- Unpublish the post — verify it disappears from /blog but stays in /admin/posts
- Delete the post — verify it's gone from both
- Navigate to /blog/nonexistent — should 404

**W3-3: Build verification**
- `npm run build` — must succeed with zero errors
- Check `dist/_worker.js/` output for expected routes

##### Critical Files
- `wrangler.toml` — KV binding verification
- `dist/_worker.js/` — Build output verification

##### Decision Log
- No new architectural decisions. Operational fixes applied: SESSION KV namespace binding for Clerk session storage, .assetsignore to exclude build artifacts from static asset uploads. Full CRUD verified end-to-end on wrangler dev. Build succeeds.

#### Blog System Worktree Strategy

Main is sacred. Each phase works in its own worktree:
- **Phase 1:** `/Users/georgehyde/Documents/Projects/personal_site/georgehyde_dev/.worktrees/blog-data-model` on branch `blog-data-model`
- **Phase 2:** `/Users/georgehyde/Documents/Projects/personal_site/georgehyde_dev/.worktrees/blog-admin-editor` on branch `blog-admin-editor`
- **Phase 3:** `/Users/georgehyde/Documents/Projects/personal_site/georgehyde_dev/.worktrees/blog-deploy-verify` on branch `blog-deploy-verify`

#### Blog System References

- [Cloudflare KV API](https://developers.cloudflare.com/kv/api/) — get, put, delete, list with metadata
- [Astro Dynamic Routes](https://docs.astro.build/en/guides/routing/#dynamic-routes) — [slug].astro pattern
- [Astro Server Endpoints](https://docs.astro.build/en/guides/endpoints/#server-endpoints-api-routes) — API routes for form handling
- [KV Metadata](https://developers.cloudflare.com/kv/api/write-key-value-pairs/#metadata) — up to 1KB per key, returned by list()

### Initiative: Homepage and Progress UI Updates
**Status:** completed
**Started:** 2026-03-01
**Completed:** 2026-03-01
**Goal:** Add blog navigation to the homepage and update the progress tracker with completed Clerk auth and blog system milestones.

> The blog system is live but invisible from the homepage -- there is no link to /blog anywhere on index.astro. Meanwhile, the progress tracker still reflects only the original three milestones (Initial Setup, Landing Page, Progress Tracker) and does not show the Clerk auth or blog work that was completed. These two small UI changes make the site reflect its current state.

**Dominant Constraint:** simplicity

#### Goals
- REQ-GOAL-201: Homepage links to /blog so readers can discover blog content
- REQ-GOAL-202: Progress tracker reflects all completed work including Clerk auth and blog system

#### Non-Goals
- REQ-NOGO-201: Redesigning the progress tracker layout — content update only
- REQ-NOGO-202: Adding new planned milestones beyond what already exists — only adding completed work
- REQ-NOGO-203: Changing the blog pages themselves — this is homepage/progress UI only

#### Requirements

**Must-Have (P0)**

- REQ-P0-201: Blog link on homepage in the links section alongside GitHub and Email
  Acceptance: Given the homepage loads, When a reader sees the links section, Then a "Blog" link is visible that navigates to /blog

- REQ-P0-202: Clerk Auth milestone added to progress tracker as completed
  Acceptance: Given the progress page loads, When a reader views the milestones, Then "Clerk Auth Integration" appears as completed with date 2026-02-28

- REQ-P0-203: Blog System milestone added to progress tracker as completed
  Acceptance: Given the progress page loads, When a reader views the milestones, Then "Blog System" appears as completed with date 2026-03-01

- REQ-P0-204: Existing milestone IDs and positions adjusted for new entries
  Acceptance: Given new milestones are inserted, When the progress page renders, Then all milestone dots are evenly spaced and the progress bar reflects updated completion (5/9)

#### Definition of Done

Homepage shows a Blog link alongside GitHub and Email that navigates to /blog. Progress page shows 5 completed milestones (was 3) including Clerk Auth and Blog System entries. Progress bar reflects the updated completion percentage. Both pages still prerender. `npm run build` succeeds.

#### Architectural Decisions

No new architectural decisions. These are content updates to existing pages using established patterns.

#### Phase 1: Blog Link + Progress Entries
**Status:** completed (2026-03-01)
**Decision IDs:** none
**Requirements:** REQ-P0-201, REQ-P0-202, REQ-P0-203, REQ-P0-204
**Issues:** #6
**Definition of Done:**
- REQ-P0-201 satisfied: Blog link visible in homepage links section, navigates to /blog
- REQ-P0-202 satisfied: Clerk Auth milestone shown as completed on progress page
- REQ-P0-203 satisfied: Blog System milestone shown as completed on progress page
- REQ-P0-204 satisfied: All milestones evenly spaced, progress bar correct

##### Planned Decisions
- No new architecture decisions. Content updates only.

##### Work Items

**W1-1: Add blog link to homepage links section (src/pages/index.astro)**
- Insert a fourth link in the `.links` div, after the Email link
- Use the same pattern as existing links: `<a href="/blog" class="link">` with an SVG icon and "Blog" text
- Use a document/article SVG icon (no external dependency needed)
- No `target="_blank"` since this is an internal link

**W1-2: Add Clerk Auth milestone to progress tracker (src/pages/progress.astro)**
- Insert new milestone object after Progress Tracker entry (id 3), shift existing ids 4-7 to 5-8
- id: 4, title: "Clerk Auth Integration", status: "completed", completedDate: "2026-02-28"
- position: { x: 52, y: 70 }
- extended_description covers middleware, createRouteMatcher, free tier

**W1-3: Add Blog System milestone to progress tracker (src/pages/progress.astro)**
- Insert after Clerk Auth entry
- id: 5, title: "Blog System", status: "completed", completedDate: "2026-03-01"
- position: { x: 61, y: 70 }
- extended_description covers KV storage, public pages, admin editor, zero deps

**W1-4: Renumber and reposition remaining milestones (src/pages/progress.astro)**
- Email subscription: id 6, x: 70
- Pathfinding Visualizer: id 7, x: 79
- Photo Gallery: id 8, x: 88
- User accounts: id 9, x: 95
- Verify progress bar calculation handles new positions correctly

##### Critical Files
- `src/pages/index.astro` — Add blog link to the links section
- `src/pages/progress.astro` — Add two milestones, renumber IDs, shift positions

##### Decision Log
- No new architectural decisions. Content-only changes: blog link added to homepage links section, two completed milestones added to progress tracker, existing milestones renumbered.

#### Homepage and Progress UI Updates Worktree Strategy

Main is sacred. Single phase works in its own worktree:
- **Phase 1:** `{project_root}/.worktrees/homepage-progress-ui` on branch `homepage-progress-ui`

#### Homepage and Progress UI Updates References

- No external references needed. Changes use existing patterns in index.astro and progress.astro.

---

### Initiative: Site Hardening and Blog Editor Audit
**Status:** active
**Started:** 2026-07-13
**Workflow:** codex-site-hardening
**Runtime work item:** wi-initial-planning maps to W-SH-1
**Baseline:** `8012af528320bddb322db3b582a62a697c27e756` (`feat: improve blog editor and remove LinkedIn`)
**Goal:** Audit the Astro/Cloudflare site, preserve the deployed rich-editor baseline, remove confirmed dead or duplicated code, improve the admin blog editor, add focused automated tests, and harden public rendering, owner-only admin authorization, input validation, stored HTML handling, and configuration correctness without changing retained Clerk auth behavior or deploying production.

> The site now has real write surfaces: admin forms write HTML into Cloudflare KV and public pages render that stored HTML. The current baseline is useful but lightly tested. The root problem is not merely editor polish; it is that security-sensitive rules are spread across routes and mostly unproved by automated checks. Hardening should make the intended single-owner, raw-HTML blog model explicit and testable while keeping the codebase small.

**Complexity Tier:** Tier 3 (Full) — cross-cutting auth, rendering, validation, tests, config, and Concrete authority.

**Challenge / Simpler Path:** A full redesign of the blog editor or data model would add risk without solving the immediate problem. The simpler high-value path is to keep the existing HTML body storage contract, preserve the rich editor, centralize the rules that protect it, remove duplication only where it reduces drift, and prove those rules with focused tests plus Concrete validation.

**Dominant Constraints:** security and simplicity; no production deploy; no dependency growth unless a future planner decision explicitly approves it.

#### Research Gate

Local research was sufficient for this planning slice:
- `MASTER_PLAN.md`, project `AGENTS.md`, Concrete skill instructions, `concrete status`, `cc-policy stage-packet`, current source files, and commit `8012af5` were inspected.
- Local Node is v24.8.0, so the built-in `node --test` runner is viable for dependency-free focused tests.
- No external research is needed because this plan does not choose a new hosted service or third-party library. If implementation changes Clerk or Cloudflare semantics beyond the existing integration pattern, the implementer must verify against official installed behavior or official docs before coding that change.

#### Goals

- REQ-SH-GOAL-001: Preserve commit `8012af5` behavior as the baseline while reviewing and hardening it.
- REQ-SH-GOAL-002: Only the configured site owner can perform admin write operations.
- REQ-SH-GOAL-003: Public blog rendering remains SSR via KV and never exposes drafts.
- REQ-SH-GOAL-004: Blog input validation and stored-HTML policy are centralized and covered by automated tests.
- REQ-SH-GOAL-005: Admin authoring becomes materially more ergonomic without adding a client framework or editor dependency.
- REQ-SH-GOAL-006: Confirmed dead or duplicated code is removed, not left beside replacement mechanisms.
- REQ-SH-GOAL-007: Concrete remains the authority for validation and deploy-adjacent operations.

#### Non-Goals

- REQ-SH-NOGO-001: Production deployment. `npm run deploy`, direct `wrangler deploy`, and `concrete deploy --environment prod` are out of scope without separate user authorization.
- REQ-SH-NOGO-002: Replacing Clerk, changing the retained local Clerk auth behavior, or building a custom auth system.
- REQ-SH-NOGO-003: Multi-author roles, team authorization, comments, RSS, image uploads, or a CMS migration.
- REQ-SH-NOGO-004: Adding a heavy editor, CSS framework, client framework, or broad sanitizer dependency in this slice.
- REQ-SH-NOGO-005: Removing candidate code on intuition. Dead-code removal requires local proof from references, tests, and build behavior.

#### Requirements

**Must-Have (P0)**

- REQ-SH-P0-001: Baseline preservation
  Acceptance: Given current HEAD is `8012af5`, When hardening lands, Then the rich editor remains present, the Blog homepage link remains present, LinkedIn UI is not reintroduced, and public static pages still declare `prerender = true`.

- REQ-SH-P0-002: Single-owner admin authorization
  Acceptance: Given Clerk middleware authenticates a request, When the Clerk `userId` does not match the configured owner authority, Then `/admin/*` write and management surfaces deny access. Given the owner user matches, Then existing admin workflows continue.

- REQ-SH-P0-003: Centralized input validation
  Acceptance: Given create and update API routes receive form data, When title, slug, body, publish state, and route slug are validated, Then both routes call the same validation authority instead of duplicating regexes or ad hoc parsing.

- REQ-SH-P0-004: Stored HTML handling policy
  Acceptance: Given stored post body HTML is rendered with `set:html`, When admin writes occur, Then the body passes one documented HTML policy authority first. The policy must explicitly cover script tags, event-handler attributes, unsafe URL schemes, empty bodies, and maximum body size.

- REQ-SH-P0-005: Editor ergonomics
  Acceptance: Given the owner writes or edits a post, When using the editor, Then formatting, link entry, paste/preview synchronization, save behavior, and mobile layout are at least as capable as the `8012af5` editor and no longer require hand-writing common HTML.

- REQ-SH-P0-006: Duplicate/dead code cleanup
  Acceptance: Given duplication is confirmed in admin form layout/styles, slug validation, HTML policy, or debug-only progress scripts, When replacement helpers/components land, Then superseded copies are removed in the same change.

- REQ-SH-P0-007: Focused automated tests
  Acceptance: Given no test suite exists today, When this slice lands, Then a dependency-free package test script exercises validation, owner authorization, KV listing/sorting/filtering, stored-HTML policy, and config invariants.

- REQ-SH-P0-008: Concrete validation
  Acceptance: Given `.concrete/` is initialized with guard enforcement, When validation/build/preview/deploy-adjacent checks are needed, Then agents use Concrete commands or exact Concrete-authorized commands only, and `concrete validate` passes before Guardian landing.

- REQ-SH-P0-009: Configuration correctness
  Acceptance: Given Wrangler and Astro config are loaded, When tests inspect config, Then `BLOG_POSTS`, `SESSION`, Cloudflare adapter settings, node compatibility, and admin owner configuration behavior are validated without exposing secrets or deploying.

**Nice-to-Have (P1)**

- REQ-SH-P1-001: Shared admin post form component replaces duplicated new/edit form shells if it reduces code and preserves route clarity.
- REQ-SH-P1-002: Editor toolbar affordances become accessible enough for keyboard and screen-reader operation without importing an icon library.
- REQ-SH-P1-003: Progress page debug logs are removed if confirmed as development-only noise.

#### Unknowns and Ambiguities

- The real Clerk owner user ID is not present in this plan. Implementation should support a configured owner ID and test with fixtures; production deployment remains blocked until the real value and deployment approval are provided.
- Concrete may or may not include the new focused test script in `concrete validate` automatically. If not, implementer/reviewer may run only the repo-local test command that Concrete policy permits; otherwise they must report the Concrete blocker instead of bypassing it.
- "Dead code" is intentionally narrow: only remove code proven unused or superseded by the new authority in this slice.

#### Architectural Decisions

- DEC-SH-001: Preserve commit `8012af5` as the hardening baseline.
  Addresses: REQ-SH-P0-001.

- DEC-SH-002: Centralize validation and stored-HTML policy.
  Addresses: REQ-SH-P0-003, REQ-SH-P0-004, REQ-SH-P0-006.

- DEC-SH-003: Enforce single-owner admin authorization on top of Clerk.
  Addresses: REQ-SH-P0-002.

- DEC-SH-004: Use Node built-in test runner for focused coverage.
  Addresses: REQ-SH-P0-007.

- DEC-SH-005: Use Concrete as operational authority.
  Addresses: REQ-SH-P0-008, REQ-SH-P0-009.

#### Alternatives Considered

- **Stored HTML option A: Trust raw owner HTML only.** Lowest code, but leaves no mechanical guard against accidental unsafe markup or future non-owner write paths.
- **Stored HTML option B: Add a sanitizer dependency.** Stronger parsing story, but conflicts with the minimal-dependency constraint and requires network/dependency approval.
- **Recommended for W-SH-1: Central HTML policy without new dependency.** Keep HTML as the data contract, enforce owner-only writes, and add a shared policy that rejects clearly executable or unsafe constructs before storage. If future requirements demand arbitrary user-generated HTML, create a new planner decision for an audited sanitizer dependency instead of hand-expanding this helper into a general sanitizer.

- **Test option A: Add Vitest/Playwright.** Better browser ergonomics, higher dependency and setup cost.
- **Recommended for W-SH-1: Node built-in tests plus Concrete validation.** This is enough for the security/config invariants in this slice. Browser automation can be a later initiative if visual regressions become frequent.

#### State Authority Map

| State Domain | Canonical Authority | Adjacent Readers/Writers | Notes |
|--------------|---------------------|--------------------------|-------|
| Blog post persistence | `src/lib/kv-store.ts`, Cloudflare KV binding `BLOG_POSTS`, keys `post:{slug}` | Public blog pages, admin list, admin API routes | Keep metadata listing as the KV authority; do not add a parallel index. |
| Blog input validation | New shared helper under `src/lib/` | `src/pages/admin/api/posts/index.ts`, `src/pages/admin/api/posts/[slug].ts`, tests | Replaces duplicated `SLUG_RE` and route-local parsing rules. |
| Stored HTML policy | New shared helper under `src/lib/` | Admin API routes, `PostEditor.astro`, `src/pages/blog/[slug].astro`, tests | Public rendering may use `set:html` only for body content that passed this policy. |
| Admin authorization | Clerk middleware plus new owner authorization helper/config | `src/middleware.ts`, admin pages, admin API routes, Wrangler vars | Clerk stays as auth provider; owner ID controls admin authority. |
| Public rendering | `src/pages/blog/index.astro`, `src/pages/blog/[slug].astro` | KV store and stored-HTML policy | Drafts and missing posts remain indistinguishable 404s. |
| Editor DOM state | `src/components/PostEditor.astro` and optional shared form component | Admin create/edit pages | Hidden `body` field remains the form submission contract. |
| Operational validation | Concrete CLI and `cc-policy` test/evaluation state | Implementer, reviewer, guardian | No direct deploy/build/provider commands outside Concrete authorization. |

#### Removal Targets

- Duplicated slug regex and form parsing in both admin API routes.
- Duplicated admin new/edit form shell and styles when a shared component reduces code without hiding route-specific behavior.
- Unchecked stored-HTML assumptions around `set:html`, preview `innerHTML`, and link creation.
- Debug-only `console.log` statements on `src/pages/progress.astro` if verified nonfunctional.
- Any reintroduced LinkedIn UI or old textarea-only editor path is forbidden.

#### Wave Decomposition

**Dependency Graph:** W-SH-1 has no source-work deps. Guardian provision must run before implementation; reviewer must approve before Guardian landing.

**Critical Path:** planner scope/evaluation -> guardian provision -> implementer W-SH-1 -> reviewer -> guardian land.

**Max Width:** 1. This slice intentionally avoids parallel implementation because the same admin/blog files carry validation, editor, and rendering authority.

##### W-SH-1: Whole-Site Hardening, Editor Ergonomics, and Tests

- **Runtime ID:** `wi-initial-planning`
- **Weight:** XL
- **Gate:** review
- **Deps:** none
- **Integration:** `src/lib/kv-store.ts`, new `src/lib/` validation/HTML/auth helpers, `src/middleware.ts`, admin API routes, admin create/edit pages, `src/components/PostEditor.astro`, public blog routes, `package.json`, `wrangler.toml`, tests, Concrete validation state.

###### Evaluation Contract

**Required tests**
- Add and pass a dependency-free package test script using Node v24 built-in `node --test`.
- Tests must cover slug/title/body validation, unsafe stored-HTML policy cases, owner authorization allow/deny behavior, KV metadata listing pagination/filter/sort behavior, and config invariants for Astro/Wrangler/Cloudflare bindings.
- `concrete validate` must pass after implementation. If Concrete does not run the focused test script, run the repo-local test command only when Concrete policy allows declared repo tools and record that evidence.

**Required real-path checks**
- Confirm current hardening head descends from `8012af5` and does not revert `src/components/PostEditor.astro` or restore LinkedIn UI.
- Confirm `src/pages/index.astro` and `src/pages/progress.astro` remain `prerender = true`; blog and admin routes remain SSR where KV/auth require it.
- Confirm create, update, delete, public list, public detail, draft 404, missing 404, and unauthorized admin scenarios are exercised through route handlers, Concrete preview, or equivalent Concrete-authorized local checks.
- Confirm no production deployment command was run.

**Required authority invariants**
- Exactly one slug validation authority.
- Exactly one stored-HTML policy authority.
- Exactly one owner authorization authority layered on Clerk.
- KV remains the only blog post persistence authority; no file-backed, in-memory, or alternate index store.
- Hidden `body` form field remains the admin editor submission contract.

**Required integration points**
- `src/middleware.ts` and admin route behavior still use Clerk.
- Admin API routes continue PRG redirects with 303 on successful mutations.
- Public blog detail still returns 404 for missing and unpublished posts.
- `wrangler.toml` keeps `BLOG_POSTS`, `SESSION`, `nodejs_compat`, and non-secret public Clerk config intact.
- Existing homepage Blog link and progress milestones remain visible.

**Forbidden shortcuts**
- Do not run `npm run deploy`, direct `wrangler deploy`, or `concrete deploy --environment prod`.
- Do not bypass Concrete for build, deploy, provider, dependency, or infrastructure operations.
- Do not add npm dependencies or modify `package-lock.json` without a new planner decision.
- Do not replace Clerk, disable middleware, or create a parallel auth system.
- Do not leave duplicated validation regexes or HTML policy checks in route files after adding shared helpers.
- Do not implement a broad hand-rolled sanitizer that claims to safely accept arbitrary user-generated HTML.
- Do not silently allow all admin users in production when owner configuration is absent or mismatched.
- Do not restore LinkedIn UI or remove the rich editor baseline.

**Ready-for-guardian definition**
- Reviewer has `REVIEW_VERDICT=ready_for_guardian` for the final head.
- Required tests and Concrete validation pass on that same head.
- Scope check shows no forbidden touch points.
- Evaluation evidence explicitly names the head SHA, test commands, Concrete result, and any retained non-goals.

###### Scope Manifest

**Allowed files/directories**
- `package.json`
- `astro.config.mjs`
- `wrangler.toml`
- `tsconfig.json`
- `src/components/**`
- `src/lib/**`
- `src/middleware.ts`
- `src/pages/admin/**`
- `src/pages/blog/**`
- `src/pages/index.astro`
- `src/pages/progress.astro`
- `tests/**`
- `tmp/**`

**Required files/directories**
- `package.json`
- `wrangler.toml`
- `src/middleware.ts`
- `src/components/PostEditor.astro`
- `src/lib/**`
- `src/pages/admin/api/posts/index.ts`
- `src/pages/admin/api/posts/[slug].ts`
- `src/pages/admin/posts/new.astro`
- `src/pages/admin/posts/[slug]/edit.astro`
- `src/pages/blog/[slug].astro`
- `tests/**`

**Forbidden touch points**
- `.concrete/**`
- `.claude/**`
- `.codex/**`
- `.git/**`
- `dist/**`
- `node_modules/**`
- `public/**`
- `package-lock.json`
- Cloudflare production deployment state
- Any file outside the repository root

**Expected state authorities touched**
- Blog KV contract (`BLOG_POSTS`, `src/lib/kv-store.ts`)
- Blog validation authority (new `src/lib/` helper)
- Stored HTML policy authority (new `src/lib/` helper)
- Clerk owner authorization authority (`src/middleware.ts` plus helper/config)
- Admin editor DOM/form authority (`src/components/PostEditor.astro`)
- Concrete validation/test state

#### Site Hardening Worktree Strategy

Use the bound workflow/worktree from `cc-policy`:
- **Workflow:** `codex-site-hardening`
- **Branch:** `codex/rich-post-editor`
- **Base:** `master`
- **Worktree:** `/Users/georgehyde/Documents/Concrete/test_repo/georgehyde_dev`

Guardian provision owns any lease/bootstrap transition before source implementation. Implementer must stay inside W-SH-1 scope.

#### Site Hardening References

- Local source audit performed on 2026-07-13.
- Concrete status: initialized, guard enforced, last validation passed before this planning amendment.
- No web research required for this plan; use official Clerk/Cloudflare/Astro docs only if implementation changes their integration semantics.

---

### Initiative: Rich Blog Editor and Draft Autosave
**Status:** approved; W-BE-1A and W-BE-1B complete; W-BE-1B passed direct `npm test` (16/16) and `npm run build`; W-BE-1C is in progress
**Started:** 2026-07-19
**Workflow:** `blog-editor-experience`
**Goal:** `g-blog-editor-experience`
**Planning work item:** `wi-blog-editor-planning`
**Implementation baseline:** exact local `master` commit `80ce7dee8d79d9b151fa5a1c669239e0484336d7` (`Add fail-closed local auth bypass`), not root HEAD and not `origin/master`
**Goal:** Make single-owner blog authoring feel like a dependable document editor: common formatting is available without hand-written HTML, drafts save safely to the existing canonical KV record, save state is visible, and preview/public output faithfully reflects the accepted stored HTML.

> The owner currently has a useful zero-dependency rich-text surface, but persistence still behaves like a final form submission. That creates avoidable loss risk during longer writing sessions and leaves formatting, toolbar state, and rendered-output fidelity only partially specified. The root problem is not a need for a CMS or a second draft system; it is that the existing editor and canonical blog mutation path need a durable draft lifecycle.

**Complexity Tier:** Tier 3 (Full) — editor DOM state, autosave concurrency, canonical post identity, authenticated API response behavior, stored-HTML policy, KV persistence, public rendering, accessibility, and real-browser evidence intersect.

**Challenge / Simpler Path:** A packaged editor or separate draft service could provide more features, but would add dependency and state authority. The bounded path delivers the requested value by extending the existing `PostEditor`, forms, shared validators/policy, and create/update handlers. The first valid new-post snapshot creates one unpublished `post:{slug}` KV record; every later save updates that record.

**Dominant Constraints:** preserve one KV authority; preserve shared auth and security policy; zero new dependencies; no production deploy; preserve unrelated root changes and the live `.worktrees/feature-W-SH-2` worktree/preview.

#### Research Gate

Local research is sufficient for this initiative. The exact local `master` baseline, existing `PostEditor.astro`, new/edit forms, create/update handlers, `blog-validation.ts`, `html-policy.ts`, `kv-store.ts`, public renderer, focused tests, current `MASTER_PLAN.md`, and Concrete status were inspected. The user has already fixed the platform and product choices, so no external technology selection remains. If implementation encounters browser-command or Astro response behavior that differs from installed behavior, it must verify that behavior locally and may consult only the relevant official documentation; it must not use that uncertainty to introduce a dependency.

#### Goals

- REQ-BE-GOAL-001: Common blog formatting is available through an accessible, dependency-free editor toolbar and keyboard-compatible editing surface.
- REQ-BE-GOAL-002: Valid drafts survive navigation or interruption through debounced server autosave to the canonical `BLOG_POSTS` KV record.
- REQ-BE-GOAL-003: The author always sees an accurate `Saving`, `Saved`, or actionable `Error` state and can explicitly save a draft.
- REQ-BE-GOAL-004: New posts acquire one canonical identity on the first valid title/slug/body snapshot; the slug is immutable after creation.
- REQ-BE-GOAL-005: Publishing remains explicit, drafts remain publicly indistinguishable from missing posts, and normal final form operations retain 303 PRG.
- REQ-BE-GOAL-006: Editor preview and public rendering faithfully display every HTML element accepted from the supported toolbar and safe-paste path.

#### Non-Goals

- REQ-BE-NOGO-001: Images, R2 upload, media management, embeds, captions, or image paste/upload.
- REQ-BE-NOGO-002: A localStorage, IndexedDB, file-backed, alternate-KV-key, or other parallel draft store.
- REQ-BE-NOGO-003: Auth-mode, Clerk, owner-policy, middleware, or local-bypass changes.
- REQ-BE-NOGO-004: Wrangler, deploy, provider, environment, dependency, package-lock, or production changes.
- REQ-BE-NOGO-005: Collaborative editing, revision history, scheduled publishing, slug rename/migration, or arbitrary user-generated HTML.
- REQ-BE-NOGO-006: Replacing normal create/update final submissions with client-only navigation; 303 PRG remains the normal final-operation contract.

#### Requirements

**Must-Have (P0)**

- REQ-BE-P0-001: Supported formatting set
  Acceptance: In both new and edit forms, the editor provides paragraphs, H2, H3, bold, italic, inline code, fenced/display code blocks, blockquotes, ordered lists, unordered lists, links, undo, and redo. Each operation updates the hidden canonical `body` field and survives save/reload.

- REQ-BE-P0-002: Accessible toolbar state
  Acceptance: Toolbar controls have accessible names and keyboard focus; toggle controls expose pressed/active state that updates as selection/caret moves; heading/block selectors expose the current block state; disabled/unavailable undo and redo state is communicated; no state is conveyed by color alone.

- REQ-BE-P0-003: Safe paste
  Acceptance: Pasting plain text produces escaped paragraphs/line breaks without executable markup. Pasting rich or hostile content cannot bypass `html-policy.ts`; unsupported or unsafe markup is stripped to safe text at the editor boundary or rejected by the canonical server policy with a visible save error and no KV mutation.

- REQ-BE-P0-004: Canonical new-post creation
  Acceptance: Before title, slug, and body are valid, autosave performs no write and explains why saving is pending. The first valid autosave or explicit Save draft invokes the existing create authority, writes exactly one `post:{slug}` record with `published=false`, returns canonical slug/identity, and converts the form to update mode without navigation. Duplicate slug returns a visible conflict and creates no alternate key.

- REQ-BE-P0-005: Immutable identity
  Acceptance: After canonical creation, slug editing is disabled/read-only, every autosave and explicit draft save targets `/admin/api/posts/{canonicalSlug}`, and no update path can create, rename, copy, or orphan a second post key.

- REQ-BE-P0-006: Debounced server autosave
  Acceptance: Valid title/body/editor changes schedule one debounced authenticated save; only the newest queued snapshot may become the displayed `Saved` state. In-flight edits schedule a later save. Failed requests preserve dirty state and expose retry; they do not report `Saved` or silently discard edits.

- REQ-BE-P0-007: Explicit save and publish separation
  Acceptance: `Save draft` immediately persists the latest snapshot with `published=false`. Autosave never changes an unpublished record to published or a published record to unpublished merely because the publish checkbox/control was not part of its snapshot. Publishing/unpublishing requires an explicit final operation and retains server validation plus 303 PRG.

- REQ-BE-P0-008: Response-mode compatibility
  Acceptance: Existing create/update API modules remain the sole mutation routes. Authenticated autosave may request a machine-readable response from those handlers, while ordinary valid form submissions continue returning 303 and existing error status semantics remain stable. Unsupported methods remain 405.

- REQ-BE-P0-009: Faithful preview/public rendering
  Acceptance: Preview and `/blog/{slug}` render supported paragraph, H2/H3, emphasis, inline code, code block, blockquote, ordered/unordered list, and safe link markup with readable matching styles. Public detail still obtains a validated body and returns 404 for missing or `published=false` records.

- REQ-BE-P0-010: Automated and real-path proof
  Acceptance: Focused tests cover validation, HTML policy, canonical create/update identity, draft/publish separation, response modes, stale/in-flight autosave behavior at the extracted testable boundary, public draft 404, and source/config invariants. `concrete validate` and a Concrete local preview/browser walkthrough pass without production deployment.

#### Exact Autosave API Contract (no implementer design discretion)

- Autosave requests use the existing form fields plus `_autosave=1` and `Accept: application/json`; both signals are required. Any request missing either signal follows the existing ordinary form path.
- Create autosave: `POST /admin/api/posts` with `title`, `slug`, `body`, `_autosave=1`; the handler ignores/overrides any client `published` value and persists `published=false`. Success is `201 application/json` with `{"ok":true,"post":{"slug":"<canonical-slug>","published":false}}`.
- Update autosave: `POST /admin/api/posts/{canonicalSlug}` with `title`, `body`, `_autosave=1`; the route slug is the identity authority, client slug data is ignored, `createdAt` and `slug` remain unchanged, and the existing record's `published` value is preserved. Success is `200 application/json` with `{"ok":true,"post":{"slug":"<canonical-slug>","published":<preserved-boolean>}}`.
- Autosave failures are `application/json` with `{"ok":false,"error":{"code":"<stable-code>","message":"<actionable-message>"}}`. Status/code mapping: malformed form or validation `400/invalid_request`; unauthorized `401/unauthorized` (or the existing centralized authorization status, including configuration failure, without changing auth); missing update target `404/not_found`; duplicate create slug `409/slug_conflict`; unsupported method remains `405` with `Allow: POST` and existing non-autosave presentation.
- Ordinary valid create, update, delete, publish, and unpublish submissions retain `303` PRG to `/admin/posts`; their existing validation/error semantics remain unchanged. `_method=delete` is never an autosave operation.
- First valid create response supplies canonical identity. From then on the client targets only `/admin/api/posts/{canonicalSlug}` and locks slug editing. No alternate endpoint, key, or client persistence is permitted.
- Browser-native editing commands remain behind the one `PostEditor` adapter. The debounce is one `PostEditor` constant in the 500–1500 ms range and tests use a deterministic boundary, not wall-clock delay.

#### Architectural Decisions

- **DEC-BE-001 — Extend the zero-dependency editor.** Keep `PostEditor.astro`, contenteditable/vanilla JS, and the hidden `body` submission contract. A packaged editor is disproportionate and forbidden by the approved dependency boundary. Addresses REQ-BE-P0-001 through REQ-BE-P0-003.
- **DEC-BE-002 — KV record is the only draft authority.** Drafts are normal `BlogPost` records with `published=false` under the existing `post:{slug}` key. No temporary draft key or client persistence may coexist. Addresses REQ-BE-P0-004 through REQ-BE-P0-007.
- **DEC-BE-003 — First valid snapshot claims immutable identity.** The create handler owns duplicate detection and canonical creation; its autosave response returns the slug, after which all writes use the update handler and slug UI locks. Addresses REQ-BE-P0-004 and REQ-BE-P0-005.
- **DEC-BE-004 — Dual response presentation, single mutation authority.** Existing API handlers may return an authenticated machine-readable autosave response while preserving 303 PRG for ordinary final forms. No `/drafts` endpoint is added. Addresses REQ-BE-P0-007 and REQ-BE-P0-008.
- **DEC-BE-005 — Latest snapshot controls UI truth.** The editor owns dirty/saving/saved/error presentation and sequences requests so an older response cannot mark newer content saved. KV remains last-write persistence authority; the client does not become a second record authority. Addresses REQ-BE-P0-006.
- **DEC-BE-006 — Shared accepted-HTML vocabulary.** Toolbar output, paste normalization, `html-policy.ts`, preview, and public styles must agree on the supported element/attribute set. Addresses REQ-BE-P0-001, REQ-BE-P0-003, and REQ-BE-P0-009.

#### State Authority Map

| State domain | Canonical authority | Readers/writers and integration surfaces | Invariant |
|--------------|---------------------|------------------------------------------|-----------|
| Post persistence and identity | `BLOG_POSTS` via `src/lib/kv-store.ts`, key `post:{slug}` | Create/update APIs, admin edit loader, public helpers/pages | One record per immutable slug; drafts are `published=false`, not separate objects. |
| Input validation | `src/lib/blog-validation.ts` | Both API handlers, tests, autosave error presentation | Create/update/autosave do not duplicate validation rules. |
| Accepted stored HTML | `src/lib/html-policy.ts` | `PostEditor.astro`, create/update APIs, edit loader, public renderer, tests | Unsafe markup never reaches KV; supported editor output is accepted consistently. |
| Authentication/authorization | Existing Clerk middleware and `src/lib/admin-auth.ts` | Admin pages and both API handlers | Unchanged; autosave receives exactly the same owner enforcement. |
| Editor document and save state | One `PostEditor.astro` instance plus its containing form | Hidden `body`, title/slug fields, save controls, preview | DOM/hidden body synchronize before every snapshot; latest dirty snapshot controls status. |
| Publish intent | Explicit form action handled by existing create/update APIs | Publish control, API validation, KV `published`, public reader | Autosave/Save draft cannot implicitly publish; public readers filter drafts. |
| Public body presentation | Validated body in `src/pages/blog/[slug].astro` and its scoped styles | `public-blog.ts`, HTML policy, browser preview | Accepted elements are readable; missing/draft remains 404. |
| Operational evidence | Concrete validation/preview plus `cc-policy` evaluation state | Implementer, Reviewer, Guardian | No direct production deploy; evidence is tied to reviewed HEAD. |

#### Removal Targets

- Supersede submit-only persistence behavior in new/edit forms with one shared save-state/autosave controller; do not leave separate create/edit autosave implementations.
- Remove any duplicate editor formatting/paste/status logic introduced outside `PostEditor.astro` or its single extracted helper.
- Remove editable-slug behavior immediately after first canonical creation; do not retain a hidden rename path.
- Remove any temporary draft-key, localStorage, file, or second endpoint experiment before review.
- Replace preview/public style gaps for the supported HTML vocabulary in the same change; do not document rendering fidelity without implementing it.

#### Alternatives Gate

- **Packaged rich editor:** mature command/state model, but adds dependency, bundle, migration, and policy complexity. Rejected for this bounded single-author feature.
- **Separate `/drafts` API or browser storage:** simpler optimistic creation UX, but creates identity and recovery conflicts with KV. Rejected because it establishes a second authority.
- **Recommended and approved:** one enhanced `PostEditor`, one autosave controller, existing create/update handlers with negotiated response presentation, and canonical unpublished KV records.

#### Wave Decomposition

**Dependency graph:** W-BE-1A -> W-BE-1B -> W-BE-1C -> W-BE-1D -> W-BE-1E -> W-BE-1F -> cumulative Reviewer -> Guardian land. All slices run serially on the same existing worktree; no reprovisioning or new branch/worktree.

**Waves 1–6:** W-BE-1A create API; 1B update API; 1C editor/state machine; 1D new form; 1E edit form; 1F public rendering. **Wave 7:** cumulative Reviewer then Guardian land.

**Critical path:** sync 1A -> 1A -> sync 1B -> 1B -> 1C -> 1D -> 1E -> 1F -> cumulative sync -> Reviewer -> Guardian land.

**Max width:** 1.

##### W-BE-1 Cumulative Final Contract: Rich Editor, Canonical Draft Autosave, and Rendering Fidelity

This XL contract is retained only as cumulative final Reviewer/Guardian authority. Its broad manifest is never implementer scope; only the bounded slices below may be synchronized for implementation.

- **Runtime ID:** `wi-blog-editor-planning` (the approved bounded implementation contract carried forward from planning)
- **Weight:** XL
- **Gate:** review
- **Deps:** Guardian operational initialization/reconciliation in the existing worktree at exact local master `80ce7dee8d79d9b151fa5a1c669239e0484336d7`
- **Integration:** `PostEditor`, new/edit form shells, create/update APIs, shared validation and HTML policy, KV helper only if the existing helper lacks an atomic required operation, public renderer/styles, focused tests, Concrete validation and preview.

###### Evaluation Contract

**Required tests**
- Extend `tests/blog-hardening.test.mjs` (or add focused dependency-free files under `tests/**`) and pass the existing declared Node test command.
- Test every supported editor HTML shape against the shared HTML policy: paragraph, H2/H3, strong/bold, emphasis/italic, inline code, pre/code block, blockquote, ordered/unordered list/list item, and safe relative/http(s)/mailto link.
- Test create autosave success returns canonical identity and stores one unpublished record; invalid/duplicate create creates no record or alternate key.
- Test update autosave preserves immutable slug/created time and cannot implicitly toggle publish state; explicit Save draft stores `published=false`; explicit final publish/unpublish preserves 303 PRG.
- Test machine-readable and ordinary form response modes, auth denial/no-mutation, invalid HTML/no-mutation, missing route, and unsupported method behavior.
- Test the autosave state machine/controller deterministically: debounce coalescing, edit-during-flight follow-up, stale response suppression, visible error, dirty-state retention, and retry-to-saved transition.
- Preserve and pass existing auth, KV listing, public draft 404, HTML safety, config, and source-invariant tests.

**Required real-path checks**
- Guardian proves the implementation worktree base is exact local commit `80ce7dee8d79d9b151fa5a1c669239e0484336d7`; it is neither the dirty root HEAD nor `origin/master`.
- Through Concrete preview in that isolated worktree, open new post, enter valid title/body, observe debounced creation, verify slug locks and Saved state, reload the edit URL, edit and observe autosave, force/recover from a validation or network failure, explicitly Save draft, and explicitly publish.
- In a real browser, exercise every toolbar control, keyboard focus, active/pressed state, safe plain-text paste, undo/redo, preview fidelity, responsive layout, and reload persistence.
- Verify the created draft returns public 404 and does not appear in the public list; after explicit publish, verify public detail renders every supported element readably and safe links work.
- Run the declared focused tests and `concrete validate` on the final implementation HEAD. No production deploy command may run.

**Required authority invariants**
- `BLOG_POSTS` and `post:{slug}` remain the only post/draft persistence and identity authority.
- `blog-validation.ts`, `html-policy.ts`, existing admin auth, and `kv-store.ts` remain their respective single authorities; route or editor checks may adapt errors but may not fork policy.
- First valid create yields one unpublished canonical record; slug is immutable thereafter.
- Latest dirty snapshot, not request completion order, controls save-state truth.
- Autosave never changes publish state accidentally; public readers never return drafts.

**Required integration points**
- `src/components/PostEditor.astro`; both admin post forms; both existing admin post API modules.
- Shared blog validation and HTML policy; `kv-store.ts` only when required to preserve one-write semantics.
- Public detail renderer and styles; `public-blog.ts` only if tests demonstrate a necessary integration adjustment.
- Existing Clerk/owner middleware behavior, admin list/edit navigation, hidden `body` form contract, focused tests, and Concrete validation/preview.

**Forbidden shortcuts**
- No auth-mode, middleware, owner-policy, local-bypass, Wrangler, deploy, provider, environment, dependency, package-lock, R2, or image-upload changes.
- No localStorage, IndexedDB, file store, temporary KV draft prefix/key, duplicate canonical record, `/drafts` endpoint, or parallel create/update logic.
- No autosave that silently publishes, overwrites a newer dirty snapshot’s status, drops edits after failure, or treats an HTTP error as Saved.
- No client-only validation as authority, unsafe `innerHTML` paste insertion, bypass of `html-policy.ts`, or public draft exposure.
- No direct `npm` build/deploy, Wrangler deploy, or production operation; use Concrete authority.
- Do not touch the dirty root’s unrelated changes or `.worktrees/feature-W-SH-2` and its live preview.

**Rollback boundary**
- The whole W-BE-1 commit is the rollback unit. Do not migrate KV schema or rewrite existing keys, so rollback restores the prior editor/API behavior without data conversion. Draft records created during local preview must remain confined to local preview state.

**Acceptance notes**
- Browser-native command APIs are acceptable only behind the single editor adapter and only when real-browser active-state behavior passes.
- Machine-readable autosave responses may be JSON, but normal final form success must remain 303 PRG.

**Ready-for-guardian definition**
- Reviewer records `REVIEW_VERDICT=ready_for_guardian` for the exact final HEAD after confirming every required test, real-path check, authority invariant, integration point, forbidden shortcut, and scope boundary.
- `cc-policy` scope check is clean; focused tests and `concrete validate` pass on that same HEAD; browser evidence identifies routes/scenarios and final preview provenance.
- No production deploy occurred, no forbidden file changed, no draft was publicly exposed, and no ambiguity remains about base SHA or evaluated SHA.

###### Scope Manifest

**Allowed files/directories**
- `MASTER_PLAN.md` (planner-owned W-BE-1 initiative projection only)
- `src/components/PostEditor.astro`
- `src/pages/admin/posts/new.astro`
- `src/pages/admin/posts/[slug]/edit.astro`
- `src/pages/admin/api/posts/index.ts`
- `src/pages/admin/api/posts/[slug].ts`
- `src/lib/blog-validation.ts`
- `src/lib/html-policy.ts`
- `src/lib/kv-store.ts`
- `src/lib/public-blog.ts`
- `src/pages/blog/[slug].astro`
- `tests/**`
- `tmp/**`

**Required files/directories**
- `MASTER_PLAN.md` (exact W-BE-1 initiative projection; no permanent-section changes)
- `src/components/PostEditor.astro`
- `src/pages/admin/posts/new.astro`
- `src/pages/admin/posts/[slug]/edit.astro`
- `src/pages/admin/api/posts/index.ts`
- `src/pages/admin/api/posts/[slug].ts`
- `src/pages/blog/[slug].astro`
- `tests/**`

**Forbidden touch points**
- `src/middleware.ts`
- `src/lib/admin-auth.ts`
- `wrangler.toml`
- `astro.config.mjs`
- `package.json`
- `package-lock.json`
- `.concrete/**`
- `.claude/**`
- `.codex/**`
- `.git/**`
- `.gitignore`
- `.dev.vars*`
- `.env*`
- `public/**`
- `dist/**`
- `node_modules/**`
- `.worktrees/feature-W-SH-2/**`
- Cloudflare production state, R2/image-upload surfaces, and every file outside the provisioned implementation worktree

**Expected state authorities touched**
- Editor DOM/hidden-body/save-state authority (`PostEditor.astro`)
- Canonical create/update API response presentation
- Blog validation and accepted-HTML authorities only if supported vocabulary requires alignment
- Canonical `BLOG_POSTS` persistence helper only if needed for one-record semantics
- Public validated-body presentation/styles
- Focused test and Concrete evaluation state

#### Bounded Sequential Implementation Slices

Each slice is Gate `review`, max width 1, allows planner-owned `MASTER_PLAN.md`, one source file, `tests/blog-hardening.test.mjs`, and `tmp/**`; required implementation paths are only the named source and test file. Every unlisted path is forbidden.

##### W-BE-1A: Create Autosave JSON Response
- **Runtime ID:** `wi-blog-editor-1a-create-response`; **Weight:** S; **Deps:** none; **Integration:** create route with unchanged shared validation/auth/KV.
- **Evaluation Contract:** Tests and real-path checks prove dual-signal negotiation, 201 schema, forced `published=false`, canonical slug, 400 invalid/no mutation, 409 duplicate/no mutation, ordinary 303, centralized auth behavior, and 405. Authorities remain the create route, BLOG_POSTS key, shared validation/auth/KV. No new endpoint, helper authority, auth/KV/config/dependency/deploy edit. Ready means focused tests and exact scope pass; continue to 1B, never Guardian directly.
- **Scope Manifest:** Allowed: `MASTER_PLAN.md`, `src/pages/admin/api/posts/index.ts`, `tests/blog-hardening.test.mjs`, `tmp/**`. Required: route and test file. Every other source/test/config/dependency/worktree path is forbidden. Authorities touched: create response presentation and test evidence.

##### W-BE-1B: Update Autosave JSON Response
- **Runtime ID:** `wi-blog-editor-1b-update-response`; **Weight:** S; **Deps:** 1A; **Integration:** update route with unchanged record/auth/validation/KV authorities.
- **Evaluation Contract:** Tests and real path prove dual-signal 200 schema, route-slug identity, unchanged slug/createdAt, preserved existing publish bit, 400/404 JSON no-mutation, delete exclusion, ordinary 303, auth, and 405. No migration, alternate record, implicit publish, helper/config/deploy edit. Ready means tests/scope pass; continue to 1C.
- **Scope Manifest:** Allowed: plan, `src/pages/admin/api/posts/[slug].ts`, focused test, tmp. Required: route and test. Every other path forbidden. Authorities touched: update response/preservation semantics and evidence.

##### W-BE-1C: Editor and Save-State Controller
- **Runtime ID:** `wi-blog-editor-1c-editor-state`; **Weight:** M; **Deps:** 1B; **Integration:** hidden body, containing form, fixed API contract.
- **Gate:** review.
- **Evaluation Contract:**
  - **Required tests:** Extend `tests/blog-hardening.test.mjs` with deterministic source/controller behavior checks for the complete toolbar vocabulary: paragraph, H2, H3, bold, italic, inline code, code block, blockquote, ordered list, unordered list, link, undo, redo, and clear formatting. Prove every command synchronizes the editor DOM to the hidden canonical `body` field. Prove toggle controls expose accurate accessible names and `aria-pressed`, undo/redo expose accurate disabled state, and block-format state follows caret/selection without color-only signaling. Prove paste always inserts escaped plain text with preserved paragraph/line-break intent and never inserts pasted HTML. Prove the sole debounce constant is exactly 750 ms; rapid edits coalesce to the latest snapshot; at most one request is in flight; edits during flight retain only one latest-snapshot follow-up; an older response cannot clear newer dirty state or replace newer status; failures retain dirty state and expose retry; retry persists the latest snapshot. Prove the first successful create response switches subsequent requests to the canonical update URL, locks the canonical slug, and ignores stale or conflicting identity responses. Prove explicit `Save draft` dispatch immediately bypasses debounce and uses the same queue/controller rather than a second save path.
  - **Required real-path checks:** Exercise `PostEditor.astro` in an isolated containing form with title, slug, hidden body, action, status, retry, and Save draft controls plus a stubbed fetch sequence. Verify keyboard focus and every toolbar control; plain-text paste; 750 ms coalescing; edit during a delayed request followed by exactly one latest-snapshot request; stale success after a newer edit; failure then retry; first create success followed by slug lock and canonical update targeting; and explicit Save draft without navigation. Run direct `npm test` and `npm run build`.
  - **Required authority invariants:** One controller in `PostEditor.astro` owns editor DOM, hidden `body`, dirty/saving/saved/error state, debounce timer, request sequencing, retry snapshot, canonical slug, and save target. The existing create/update APIs remain the only persistence and identity authorities. The first accepted create response may establish canonical slug once; thereafter route slug is immutable. No browser persistence or alternate draft state exists.
  - **Required integration points:** The containing form supplies standard `title`, `slug`, `body`, and `action` values. `PostEditor` synchronizes standard input/form behavior and documents one `post-editor:save-draft` DOM event: the explicit Save draft control dispatches this bubbling event on the containing form, and the single editor controller snapshots the current fields and queues an immediate draft save. Autosave requests retain the established `_autosave=1` plus `Accept: application/json` contract; create success consumes `{ok:true,post:{slug,published}}` and switches to `/admin/api/posts/{canonicalSlug}`. W-BE-1A/1B source and test behavior must remain green.
  - **Forbidden shortcuts:** No dependency, framework, external editor, localStorage/IndexedDB/sessionStorage, new endpoint, route edit, auth/config/image/deploy change, pasted `text/html` insertion, parallel timer/request queue, second Save draft handler, overlapping requests, arbitrary multiple follow-up queue, optimistic slug authority, or clearing dirty/error state from a stale response. Do not recreate Concrete.
  - **Rollback boundary:** Only `src/components/PostEditor.astro` and the W-BE-1C assertions in `tests/blog-hardening.test.mjs`; preserve cumulative W-BE-1A/1B edits.
  - **Ready-for-guardian definition:** This intermediate slice is ready to continue to W-BE-1D, not independently Guardian-ready, only when direct `npm test` and `npm run build` pass, the isolated real-path sequence passes, changed paths comply exactly with this manifest, all required formatting/accessibility/paste/concurrency/error/identity/event checks are evidenced, and cumulative W-BE-1A/1B remains green.
- **Scope Manifest:**
  - **Allowed files/directories:** `MASTER_PLAN.md` (planner-owned projection only), `src/components/PostEditor.astro`, `tests/blog-hardening.test.mjs`, and `tmp/**`.
  - **Required files/directories:** `src/components/PostEditor.astro` and `tests/blog-hardening.test.mjs`.
  - **Forbidden touch points:** Every other path, including both admin API routes, new/edit pages, validation/HTML/KV/auth/public/config/package files, `.concrete/**`, generated output, other worktrees, git history, and production state.
  - **Expected state authorities touched:** Editor DOM and hidden-body synchronization; transient dirty/saving/saved/error and retry state; 750 ms debounce and single-flight/latest-follow-up sequencing; canonical client-side slug/save-target projection after create response; explicit Save draft event integration; focused evidence. Persistence, validation, HTML policy, auth, and API identity authorities are read-only.

##### W-BE-1D: New Form Wiring
- **Runtime ID:** `wi-blog-editor-1d-new-form`; **Weight:** S; **Deps:** 1C; **Integration:** PostEditor and create API contracts.
- **Evaluation Contract:** Tests/real path prove pending-before-valid, first draft create, Saved/locked slug/canonical update action, visible duplicate/invalid no-mutation, Save draft, and ordinary explicit publish 303. Create route owns identity and no second controller/storage/endpoint is allowed. Ready continues to 1E.
- **Scope Manifest:** Allowed: plan, `src/pages/admin/posts/new.astro`, focused test, tmp. Required: form and test. Every other path forbidden. Authority touched: new-form wiring/presentation.

##### W-BE-1E: Edit Form Wiring
- **Runtime ID:** `wi-blog-editor-1e-edit-form`; **Weight:** S; **Deps:** 1D; **Integration:** PostEditor, update API, validated loader.
- **Evaluation Contract:** Tests/real path prove immutable canonical action, update-mode autosave/Save draft, dirty failure/retry, and ordinary explicit publish/unpublish 303. Route/KV identity remains canonical; no duplicate controller or loader/auth/public/config edit. Ready continues to 1F.
- **Scope Manifest:** Allowed: plan, `src/pages/admin/posts/[slug]/edit.astro`, focused test, tmp. Required: form and test. Every other path forbidden. Authority touched: edit-form wiring/presentation.

##### W-BE-1F: Public Rendering Fidelity
- **Runtime ID:** `wi-blog-editor-1f-public-rendering`; **Weight:** S; **Deps:** 1E; **Integration:** validated body and existing publication filter.
- **Evaluation Contract:** Tests/browser proof cover readable styles for every accepted element, draft/missing 404, listing exclusion, explicit-publish fidelity, focused suite, and cumulative Concrete validation. HTML policy/public helper remain authorities; helper edits require a separate proven slice. Ready triggers cumulative Reviewer scope.
- **Scope Manifest:** Allowed: plan, `src/pages/blog/[slug].astro`, focused test, tmp. Required: page and test. Every other path forbidden. Authority touched: public validated-body presentation/styles.

For every slice, required authority invariants are the State Authority Map; required integration is the named source plus already-landed predecessors; forbidden shortcuts are the cumulative contract plus every out-of-scope path; rollback is the named source/test delta; ready requires executable focused tests and clean exact scope. Helper authority files may be activated only after a failing check proves necessity, as a new serial item with one helper source plus the same test file and a planner-synchronized contract.

#### Cumulative Continuation and Provisioning

Use the existing worktree and active implementer lease. Do not reprovision, branch, rebase, reset, touch unrelated root changes, or touch W-SH-2. W-BE-1A is current; Planner syncs each successor before work. Intermediate slices are cumulative, not independently landable. After 1F/helper completion, sync the cumulative final contract and exact changed-file manifest for Reviewer, then Guardian. The missing `~/.codex/runtime/cli.py` marker warning is external only; do not edit `~/.codex`. No production deploy.

#### Direct Tooling Supersession (2026-07-23)

The user removed Concrete from this project because its generated authority,
network-dependent validation, and role gates were obstructing routine editor
development. This supersedes DEC-SH-005, REQ-SH-GOAL-007, REQ-SH-P0-008, and
every Concrete-only validation or preview requirement.

- Validation uses `npm test` and `npm run build`.
- Local verification uses `npm run dev` or `npm run preview`.
- Project `.concrete` state, hooks, documentation, and the `concrete-agent`
  skill are removed and must not be recreated.
- Production deployment still requires explicit user approval.

#### W-BE-1B Activation Projection (2026-07-23)

This activation supersedes the earlier continuation paragraph and every
Concrete-only executable check in W-BE-1B through W-BE-1F, conditional helper
slices, and cumulative review.

- W-BE-1A is complete with cumulative evidence: direct `npm test` passed all
  13 tests and direct `npm run build` passed.
- W-BE-1B (`wi-blog-editor-1b-update-response`) is the sole in-progress slice.
- W-BE-1B retains its existing Evaluation Contract, authority invariants,
  integration points, forbidden shortcuts, rollback boundary, and
  ready-for-guardian definition except that executable evidence is now direct
  `npm test`, direct `npm run build`, and local update-then-publish/unpublish
  verification through `npm run dev`.
- W-BE-1C through W-BE-1F, any conditional helper slice, and cumulative review
  use direct `npm test`, `npm run build`, and affected-route verification
  through `npm run dev`. `.concrete/**` must not be recreated.
- Runtime implementation scope is exactly `MASTER_PLAN.md`,
  `src/pages/admin/api/posts/[slug].ts`,
  `tests/blog-hardening.test.mjs`, and `tmp/**`. The route and focused test are
  required implementation files; every other path is forbidden.
- The existing `feature/W-BE-1` worktree remains authoritative. Do not
  reprovision, branch, rebase, reset, touch unrelated root changes, or touch
  `.worktrees/feature-W-SH-2`. Production deployment remains forbidden.

#### W-BE-1C Activation Projection (2026-07-23)

This activation supersedes W-BE-1B's in-progress status and its runtime scope.

- W-BE-1B (`wi-blog-editor-1b-update-response`) is complete based on direct
  `npm test` passing 16/16 tests and successful direct `npm run build`.
- W-BE-1C (`wi-blog-editor-1c-editor-state`) is the sole in-progress slice.
- Its executable Evaluation Contract and Scope Manifest are the expanded
  W-BE-1C records above; they preserve cumulative W-BE-1A/1B and fix the
  editor/controller integration contract without granting form-page edits.
- Runtime implementation scope is exactly `MASTER_PLAN.md`,
  `src/components/PostEditor.astro`, `tests/blog-hardening.test.mjs`, and
  `tmp/**`; the component and focused test are required.
- Direct `npm test`, `npm run build`, and the isolated component real-path
  exercise are the evidence authorities. No dependency, local storage,
  Concrete, image, auth/config, commit, push, or deploy operation is allowed.

---
## Completed Initiatives

| Initiative | Period | Phases | Key Decisions | Archived |
|-----------|--------|--------|---------------|----------|
| Clerk Auth Integration | 2026-02-20 to 2026-02-28 | 2 (Infrastructure, Auth Layer) | DEC-ASTRO-001, DEC-CLERK-002, DEC-CLERK-003, DEC-ENV-003 | No |
| Blog System | 2026-02-28 to 2026-03-01 | 3 (Data Model, Admin Editor, Deploy Verify) | DEC-KV-001, DEC-URL-002, DEC-EDITOR-003, DEC-RENDER-004, DEC-ADMIN-001, DEC-ADMIN-002, DEC-BLOG-001, DEC-BLOG-002 | No |
| Homepage and Progress UI Updates | 2026-03-01 | 1 (Blog Link + Progress Entries) | None (content only) | No |

---

## Parked Issues

Issues not belonging to any active initiative. Tracked for future consideration.

| Issue | Description | Reason Parked |
|-------|-------------|---------------|
