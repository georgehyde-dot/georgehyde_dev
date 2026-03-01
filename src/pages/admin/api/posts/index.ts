/**
 * src/pages/admin/api/posts/index.ts — API route: create a new blog post.
 *
 * Accepts POST only. Parses form data, validates slug format, checks for
 * duplicate slugs, writes the new post to KV, then redirects (PRG pattern).
 *
 * All /admin/* routes are protected by Clerk middleware (src/middleware.ts),
 * so no additional auth check is needed here.
 *
 * @decision DEC-ADMIN-001
 * @title PRG pattern (303 redirect) for all admin form mutations
 * @status accepted
 * @rationale POST → Redirect → GET prevents double-submission on back/refresh.
 *   303 See Other is the correct status: browser converts the follow-up to GET
 *   and the history entry lands on the list page, not the form action URL.
 *   HTML forms cannot use fetch, so PRG is the only safe option here.
 *
 * @decision DEC-ADMIN-002
 * @title Server-side slug validation with /^[a-z0-9-]+$/ allowlist
 * @status accepted
 * @rationale The slug becomes both a KV key suffix (post:{slug}) and a URL
 *   path segment. Rejecting anything outside lowercase alphanumerics and
 *   hyphens prevents path traversal, malformed KV keys, and URL-encoding
 *   surprises. Client-side auto-generation is UX convenience only — not
 *   trusted server-side.
 */

import type { APIContext } from "astro";
import type { Runtime } from "@astrojs/cloudflare";
import type { Env } from "../../../../lib/kv-store";
import { getBlogPost, putBlogPost } from "../../../../lib/kv-store";

const SLUG_RE = /^[a-z0-9-]+$/;

export const prerender = false;

export async function POST(context: APIContext): Promise<Response> {
  const runtime = (context.locals as Runtime<Env>).runtime;
  const env = runtime.env;

  let formData: FormData;
  try {
    formData = await context.request.formData();
  } catch {
    return new Response("Invalid form data", { status: 400 });
  }

  const title = (formData.get("title") as string | null)?.trim() ?? "";
  const slug = (formData.get("slug") as string | null)?.trim() ?? "";
  const body = (formData.get("body") as string | null) ?? "";
  const published = formData.get("published") === "on";

  if (!title) {
    return new Response("Title is required", { status: 400 });
  }
  if (!slug) {
    return new Response("Slug is required", { status: 400 });
  }
  if (!SLUG_RE.test(slug)) {
    return new Response(
      "Slug must contain only lowercase letters, digits, and hyphens",
      { status: 400 }
    );
  }

  const existing = await getBlogPost(env, slug);
  if (existing !== null) {
    return new Response(`A post with slug "${slug}" already exists`, {
      status: 409,
    });
  }

  const now = new Date().toISOString();
  await putBlogPost(env, {
    slug,
    title,
    body,
    author: "George Hyde",
    createdAt: now,
    updatedAt: now,
    published,
  });

  return context.redirect("/admin/posts", 303);
}

export function ALL(): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
