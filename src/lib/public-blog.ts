/**
 * Public blog read policy.
 *
 * This helper keeps the public detail route's "renderable post" decision in
 * one place: valid slug, post exists, post is published, and stored HTML passes
 * the shared policy before set:html receives it.
 *
 * @decision DEC-SH-002
 * @title Public rendering uses shared validation and stored-HTML policy
 * @status accepted
 * @rationale The public route should not render raw KV content merely because
 *   a key exists. Pulling the renderability check into a helper makes tests
 *   exercise the same sequence the page uses while preserving the existing 404
 *   behavior for missing and unpublished posts.
 */

import { validateRouteSlug } from "./blog-validation.ts";
import { validateStoredHtml } from "./html-policy.ts";
import { getBlogPost, type BlogPost, type Env } from "./kv-store.ts";

export type PublicBlogPostResult =
  | { status: 200; post: BlogPost; safeBody: string }
  | { status: 404; post: null; safeBody: null }
  | { status: 500; post: BlogPost; safeBody: null; error: string };

export async function getPublishedBlogPost(
  env: Env,
  slug: unknown
): Promise<PublicBlogPostResult> {
  const routeSlug = validateRouteSlug(slug);
  if (!routeSlug.ok) {
    return { status: 404, post: null, safeBody: null };
  }

  const post = await getBlogPost(env, routeSlug.value);
  if (post === null || !post.published) {
    return { status: 404, post: null, safeBody: null };
  }

  const html = validateStoredHtml(post.body);
  if (!html.ok) {
    return {
      status: 500,
      post,
      safeBody: null,
      error: html.error,
    };
  }

  return { status: 200, post, safeBody: html.value };
}
