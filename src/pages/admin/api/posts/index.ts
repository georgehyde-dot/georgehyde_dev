/**
 * src/pages/admin/api/posts/index.ts — API route: create a new blog post.
 *
 * Accepts POST only. Parses form data through the shared blog validation
 * authority, checks for duplicate slugs, writes the new post to KV, then
 * redirects (PRG pattern).
 *
 * Middleware protects /admin/*, and this handler repeats the same centralized
 * owner authorization for direct route-handler execution in tests.
 *
 * @decision DEC-ADMIN-001
 * @title PRG pattern (303 redirect) for all admin form mutations
 * @status accepted
 * @rationale POST → Redirect → GET prevents double-submission on back/refresh.
 *   303 See Other is the correct status: browser converts the follow-up to GET
 *   and the history entry lands on the list page, not the form action URL.
 *   HTML forms cannot use fetch, so PRG is the only safe option here.
 *
 * @decision DEC-SH-002
 * @title Shared validation and stored HTML policy for admin writes
 * @status accepted
 * @rationale Route-local regexes and body checks were removed in favor of
 *   src/lib/blog-validation.ts and src/lib/html-policy.ts, which are the
 *   single write-path authorities for form data and stored HTML safety.
 */

import type { APIContext } from "astro";
import type { Runtime } from "@astrojs/cloudflare";
import type { Env } from "../../../../lib/kv-store.ts";
import { getBlogPost, putBlogPost } from "../../../../lib/kv-store.ts";
import {
  adminAuthorizationResponse,
  authorizeAdminOwner,
} from "../../../../lib/admin-auth.ts";
import { validateCreatePostForm } from "../../../../lib/blog-validation.ts";

export const prerender = false;

type AdminLocals = Runtime<Env> & {
  auth?: () => { userId?: string | null };
};

export async function POST(context: APIContext): Promise<Response> {
  const locals = context.locals as AdminLocals;
  const runtime = locals.runtime;
  const env = runtime.env;
  const owner = authorizeAdminOwner(locals.auth?.().userId, env);
  if (!owner.ok) {
    return adminAuthorizationResponse(owner);
  }

  let formData: FormData;
  try {
    formData = await context.request.formData();
  } catch {
    return new Response("Invalid form data", { status: 400 });
  }

  const input = validateCreatePostForm(formData);
  if (!input.ok) {
    return new Response(input.error, { status: 400 });
  }

  const existing = await getBlogPost(env, input.value.slug);
  if (existing !== null) {
    return new Response(`A post with slug "${input.value.slug}" already exists`, {
      status: 409,
    });
  }

  const now = new Date().toISOString();
  await putBlogPost(env, {
    slug: input.value.slug,
    title: input.value.title,
    body: input.value.body,
    author: "George Hyde",
    createdAt: now,
    updatedAt: now,
    published: input.value.published,
  });

  return context.redirect("/admin/posts", 303);
}

export function ALL(): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
