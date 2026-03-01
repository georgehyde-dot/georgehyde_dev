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
**Status:** active
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
- DEC-EDITOR-003: Plain HTML textarea, zero deps — single author can write HTML directly — Addresses: REQ-P0-106, REQ-P0-107
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
- DEC-EDITOR-003: Plain HTML textarea editor with live preview, zero dependencies. Body stored as raw HTML string. Vanilla JS for slug auto-generation and innerHTML preview. Addresses REQ-P0-106, REQ-P0-107, REQ-P1-101, REQ-P1-102.
- DEC-URL-002: Admin routes at /admin/posts/*, API routes at /admin/api/posts/*. Auto-protected by existing Clerk middleware `/admin(.*)` pattern. Addresses REQ-P0-105, REQ-P0-109.
- Implementation note: HTML forms cannot send PUT/DELETE, so update/delete API uses POST with `_method=delete` hidden field (method-override pattern). All P1 nice-to-haves delivered (live preview, slug auto-gen, delete confirmation dialog).

#### Phase 3: Deployment Verification
**Status:** planned
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
<!-- Guardian appends here after phase completion -->

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

---

## Completed Initiatives

| Initiative | Period | Phases | Key Decisions | Archived |
|-----------|--------|--------|---------------|----------|

---

## Parked Issues

Issues not belonging to any active initiative. Tracked for future consideration.

| Issue | Description | Reason Parked |
|-------|-------------|---------------|
