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
 *
 * @decision DEC-BE-004
 * @title Dual response presentation through the canonical update route
 * @status accepted
 * @rationale Autosave opts into JSON only with both its form marker and Accept
 *   header, while the route slug and stored record remain the identity,
 *   creation-time, and publication authorities. Ordinary updates and deletes
 *   retain their existing 303 presentation.
 */

import type { APIContext } from "astro";
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
    | { ok: true; post: { slug: string; published: boolean } }
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
  let method = (formData?.get("_method") as string | null)?.toLowerCase();
  const isAutosave =
    method !== "delete" &&
    acceptsJson &&
    formData?.get("_autosave") === "1";

  const routeSlug = validateRouteSlug(context.params.slug);

  if (!routeSlug.ok) {
    if (isAutosave) {
      return autosaveJson({
        ok: false,
        error: { code: "invalid_request", message: routeSlug.error },
      }, 400);
    }
    return new Response(routeSlug.error, { status: 400 });
  }

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

  const existing = await getBlogPost(env, routeSlug.value);
  if (existing === null) {
    if (isAutosave) {
      return autosaveJson({
        ok: false,
        error: { code: "not_found", message: "Post not found" },
      }, 404);
    }
    return new Response("Post not found", { status: 404 });
  }

  if (!formData) {
    try {
      formData = await context.request.formData();
      method = (formData.get("_method") as string | null)?.toLowerCase();
    } catch {
      return new Response("Invalid form data", { status: 400 });
    }
  }

  if (method === "delete") {
    await deleteBlogPost(env, routeSlug.value);
    return context.redirect("/admin/posts", 303);
  }

  if (isAutosave) {
    formData.delete("published");
  }
  const input = validateUpdatePostForm(formData);
  if (!input.ok) {
    if (isAutosave) {
      return autosaveJson({
        ok: false,
        error: { code: "invalid_request", message: input.error },
      }, 400);
    }
    return new Response(input.error, { status: 400 });
  }

  await putBlogPost(env, {
    ...existing,
    title: input.value.title,
    body: input.value.body,
    published: isAutosave ? existing.published : input.value.published,
    updatedAt: new Date().toISOString(),
  });

  if (isAutosave) {
    return autosaveJson({
      ok: true,
      post: { slug: routeSlug.value, published: existing.published },
    }, 200);
  }
  return context.redirect("/admin/posts", 303);
}

export function ALL(): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
