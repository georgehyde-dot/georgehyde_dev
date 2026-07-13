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
 * Middleware protects /admin/*, and this handler repeats the same centralized
 * owner authorization for direct route-handler execution in tests.
 *
 * @decision DEC-ADMIN-001
 * @title PRG pattern (303 redirect) for all admin form mutations
 * @status accepted
 * @rationale See src/pages/admin/api/posts/index.ts for full rationale.
 *
 * @decision DEC-SH-002
 * @title Shared validation and stored HTML policy for admin writes
 * @status accepted
 * @rationale See src/pages/admin/api/posts/index.ts for full rationale.
 */

import type { APIContext } from "astro";
import type { Runtime } from "@astrojs/cloudflare";
import type { Env } from "../../../../lib/kv-store.ts";
import { getBlogPost, putBlogPost, deleteBlogPost } from "../../../../lib/kv-store.ts";
import {
  adminAuthorizationResponse,
  authorizeAdminOwner,
} from "../../../../lib/admin-auth.ts";
import {
  validateRouteSlug,
  validateUpdatePostForm,
} from "../../../../lib/blog-validation.ts";

export const prerender = false;

type AdminLocals = Runtime<Env> & {
  auth?: () => { userId?: string | null };
};

export async function POST(context: APIContext): Promise<Response> {
  const routeSlug = validateRouteSlug(context.params.slug);

  if (!routeSlug.ok) {
    return new Response(routeSlug.error, { status: 400 });
  }

  const locals = context.locals as AdminLocals;
  const runtime = locals.runtime;
  const env = runtime.env;
  const owner = authorizeAdminOwner(locals.auth?.().userId, env);
  if (!owner.ok) {
    return adminAuthorizationResponse(owner);
  }

  const existing = await getBlogPost(env, routeSlug.value);
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
    await deleteBlogPost(env, routeSlug.value);
    return context.redirect("/admin/posts", 303);
  }

  const input = validateUpdatePostForm(formData);
  if (!input.ok) {
    return new Response(input.error, { status: 400 });
  }

  await putBlogPost(env, {
    ...existing,
    title: input.value.title,
    body: input.value.body,
    published: input.value.published,
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
