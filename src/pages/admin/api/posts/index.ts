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
 *
 * @decision DEC-BE-004
 * @title Dual response presentation through the canonical create route
 * @status accepted
 * @rationale Autosave opts into JSON only with both its form marker and Accept
 *   header. The same auth, validation, duplicate check, and KV write sequence
 *   remains authoritative while ordinary forms retain their 303 response.
 */

import type { APIContext } from "astro";
import type { Env } from "../../../../lib/kv-store.ts";
import { getBlogPost, putBlogPost } from "../../../../lib/kv-store.ts";
import {
  adminAuthorizationResponse,
  authorizeAdminOwner,
} from "../../../../lib/admin-auth.ts";
import { validateCreatePostForm } from "../../../../lib/blog-validation.ts";
import { authorizeMutationOrigin } from "../../../../lib/request-security.ts";

export const prerender = false;

type AdminLocals = {
  runtime?: { env: Env };
  auth?: () => { userId?: string | null };
};

async function resolveEnv(locals: AdminLocals): Promise<Env> {
  const injected = locals.runtime
    ? Object.getOwnPropertyDescriptor(locals.runtime, "env")?.value as Env | undefined
    : undefined;
  if (injected) return injected;
  return (await import("cloudflare:workers")).env as Env;
}

function autosaveJson(
  body:
    | { ok: true; post: { slug: string; published: false } }
    | { ok: false; error: { code: string; message: string } },
  status: number
): Response {
  return Response.json(body, { status });
}

export async function POST(context: APIContext): Promise<Response> {
  const locals = context.locals as AdminLocals;
  const env = await resolveEnv(locals);
  const originFailure = authorizeMutationOrigin(context.request, env);
  if (originFailure) {
    return originFailure;
  }
  const acceptsJson = context.request.headers
    .get("Accept")
    ?.split(",")
    .some((value) => value.trim().split(";", 1)[0] === "application/json") ?? false;

  let formData: FormData | undefined;
  if (acceptsJson) {
    try {
      formData = await context.request.formData();
    } catch {
      return new Response("Invalid form data", { status: 400 });
    }
  }
  const isAutosave = acceptsJson && formData?.get("_autosave") === "1";

  const owner = authorizeAdminOwner(locals.auth?.().userId, env);
  if (!owner.ok) {
    if (isAutosave) {
      return autosaveJson({
        ok: false,
        error: { code: "unauthorized", message: owner.message },
      }, owner.status);
    }
    return adminAuthorizationResponse(owner);
  }

  if (!formData) {
    try {
      formData = await context.request.formData();
    } catch {
      return new Response("Invalid form data", { status: 400 });
    }
  }

  const input = validateCreatePostForm(formData);
  if (!input.ok) {
    if (isAutosave) {
      return autosaveJson({
        ok: false,
        error: { code: "invalid_request", message: input.error },
      }, 400);
    }
    return new Response(input.error, { status: 400 });
  }

  const existing = await getBlogPost(env, input.value.slug);
  if (existing !== null) {
    const message = `A post with slug "${input.value.slug}" already exists`;
    if (isAutosave) {
      return autosaveJson({
        ok: false,
        error: { code: "slug_conflict", message },
      }, 409);
    }
    return new Response(message, {
      status: 409,
    });
  }

  const now = new Date().toISOString();
  const published = isAutosave ? false : input.value.published;
  await putBlogPost(env, {
    slug: input.value.slug,
    title: input.value.title,
    body: input.value.body,
    author: "George Hyde",
    createdAt: now,
    updatedAt: now,
    published,
  });

  if (isAutosave) {
    return autosaveJson({
      ok: true,
      post: { slug: input.value.slug, published: false },
    }, 201);
  }
  return context.redirect("/admin/posts", 303);
}

export function ALL(): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
