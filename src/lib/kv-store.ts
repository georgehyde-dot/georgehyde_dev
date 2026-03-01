/**
 * kv-store.ts — Cloudflare KV data access layer for blog posts.
 *
 * Provides typed read/write operations against the BLOG_POSTS KV namespace.
 * All functions accept the Cloudflare env object so callers control the
 * binding reference — no module-level state.
 *
 * @decision DEC-KV-001
 * @title KV metadata used for O(1)-key blog post listing
 * @status accepted
 * @rationale Cloudflare KV's list() API returns per-key metadata in the same
 *   response with no extra per-key fetch cost. By storing PostMetadata (title,
 *   slug, createdAt, published) as KV metadata alongside the full BlogPost
 *   JSON value, the listPublishedPosts and listAllPosts functions need exactly
 *   ONE KV API call to produce the full index page data set — regardless of
 *   how many posts exist. The alternative (N+1 pattern: list keys then fetch
 *   each value) would cost O(N) KV reads on every page load, with latency
 *   proportional to post count. The trade-off is that metadata fields are
 *   duplicated in both the value and the metadata object; this is acceptable
 *   because metadata is small (<= 1 KB total across all fields) and the
 *   index fields rarely change independently of a full post update.
 */

import type { KVNamespace } from "@cloudflare/workers-types";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

/** Subset of the Cloudflare Worker env used by this module. */
export interface Env {
  BLOG_POSTS: KVNamespace;
}

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------

/**
 * Full blog post stored as the KV value.
 * Retrieved when rendering the post detail page.
 */
export interface BlogPost {
  /** URL-safe slug, used as the KV key suffix and the route parameter. */
  slug: string;
  title: string;
  /** Raw HTML — rendered with Astro's set:html directive. */
  body: string;
  author: string;
  /** ISO 8601 timestamp set on first creation. */
  createdAt: string;
  /** ISO 8601 timestamp updated on every write. */
  updatedAt: string;
  /**
   * When false the post is stored but not surfaced on the public listing or
   * the public detail route. Phase 2 admin UI will manage this flag.
   */
  published: boolean;
}

/**
 * Lightweight projection stored as KV metadata.
 * Returned by list() for free — no per-key value fetch required.
 * Only the fields needed to render the index page are included.
 */
export interface PostMetadata {
  title: string;
  slug: string;
  createdAt: string;
  published: boolean;
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

/** Derives the KV key from a slug. */
function postKey(slug: string): string {
  return `post:${slug}`;
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Fetches a single blog post by slug.
 * Returns null when the key does not exist.
 */
export async function getBlogPost(
  env: Env,
  slug: string
): Promise<BlogPost | null> {
  const value = await env.BLOG_POSTS.get(postKey(slug), { type: "json" });
  if (value === null) return null;
  return value as BlogPost;
}

/**
 * Lists published posts sorted by createdAt descending (newest first).
 * Uses a single KV list() call — metadata carries all index fields.
 */
export async function listPublishedPosts(env: Env): Promise<PostMetadata[]> {
  return _listPosts(env, /* publishedOnly */ true);
}

/**
 * Lists all posts (published and drafts) sorted by createdAt descending.
 * Intended for the Phase 2 admin UI — not exposed on public routes.
 */
export async function listAllPosts(env: Env): Promise<PostMetadata[]> {
  return _listPosts(env, /* publishedOnly */ false);
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Creates or updates a blog post.
 * The full BlogPost JSON is stored as the KV value; PostMetadata is stored
 * as KV metadata so list() callers pay zero extra fetch cost.
 */
export async function putBlogPost(env: Env, post: BlogPost): Promise<void> {
  const metadata: PostMetadata = {
    title: post.title,
    slug: post.slug,
    createdAt: post.createdAt,
    published: post.published,
  };
  await env.BLOG_POSTS.put(postKey(post.slug), JSON.stringify(post), {
    metadata,
  });
}

/**
 * Permanently removes a post. No-op if the key does not exist.
 */
export async function deleteBlogPost(env: Env, slug: string): Promise<void> {
  await env.BLOG_POSTS.delete(postKey(slug));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Shared implementation for listing posts with optional published filter.
 * Paginates through all KV keys under the "post:" prefix and sorts the
 * accumulated results in memory (KV list order is lexicographic by key).
 */
async function _listPosts(
  env: Env,
  publishedOnly: boolean
): Promise<PostMetadata[]> {
  const results: PostMetadata[] = [];
  let cursor: string | undefined;

  do {
    const page = await env.BLOG_POSTS.list<PostMetadata>({
      prefix: "post:",
      cursor,
    });

    for (const key of page.keys) {
      const meta = key.metadata;
      if (!meta) continue;
      if (publishedOnly && !meta.published) continue;
      results.push(meta);
    }

    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor !== undefined);

  // Sort newest first by ISO 8601 createdAt (lexicographic sort is correct
  // for ISO dates of equal length).
  results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return results;
}
