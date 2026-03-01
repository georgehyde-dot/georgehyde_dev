/**
 * src/pages/admin/api/posts/[slug].ts — API route: update or delete a blog post.
 *
 * Accepts POST only (HTML forms cannot send PUT/DELETE). Uses a hidden
 * _method field to distinguish update from delete — the method-override
 * pattern for HTML form compatibility.
 *
 * - _method === "delete": removes the post from KV, redirects to /admin/posts
 * - anything else (update): merges form data with existing post, preserves
 *   createdAt, sets updatedAt to now, redirects to /admin/posts
 *
 * Returns 404 if the post does not exist. Returns 405 for non-POST requests.
 *
 * All /admin/* routes are protected by Clerk middleware (src/middleware.ts).
 *
 * @decision DEC-ADMIN-001
 * @title PRG pattern (303 redirect) for all admin form mutations
 * @status accepted
 * @rationale See src/pages/admin/api/posts/index.ts for full rationale.
 *
 * @decision DEC-ADMIN-002
 * @title Server-side slug validation with /^[a-z0-9-]+$/ allowlist
 * @status accepted
 * @rationale See src/pages/admin/api/posts/index.ts for full rationale.
 *   Applied here to the route param slug before any KV operation.
 */

import type { APIContext } from "astro";
import type { Runtime } from "@astrojs/cloudflare";
import type { Env } from "../../../../lib/kv-store";
import { getBlogPost, putBlogPost, deleteBlogPost } from "../../../../lib/kv-store";

const SLUG_RE = /^[a-z0-9-]+$/;

export const prerender = false;

export async function POST(context: APIContext): Promise<Response> {
  const { slug } = context.params;

  if (!slug || !SLUG_RE.test(slug)) {
    return new Response("Invalid slug", { status: 400 });
  }

  const runtime = (context.locals as Runtime<Env>).runtime;
  const env = runtime.env;

  const existing = await getBlogPost(env, slug);
  if (existing === null) {
    return new Response("Post not found", { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await context.request.formData();
  } catch {
    return new Response("Invalid form data", { status: 400 });
  }

  const method = (formData.get("_method") as string | null)?.toLowerCase();

  if (method === "delete") {
    await deleteBlogPost(env, slug);
    return context.redirect("/admin/posts", 303);
  }

  // Update path: merge form fields over existing post.
  const title = (formData.get("title") as string | null)?.trim() ?? existing.title;
  const body = (formData.get("body") as string | null) ?? existing.body;
  const published = formData.get("published") === "on";

  if (!title) {
    return new Response("Title is required", { status: 400 });
  }

  await putBlogPost(env, {
    ...existing,
    title,
    body,
    published,
    updatedAt: new Date().toISOString(),
  });

  return context.redirect("/admin/posts", 303);
}

export function ALL(): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
