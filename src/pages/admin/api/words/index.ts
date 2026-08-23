/**
 * Create Words through the canonical site-content authority.
 *
 * @decision DEC-ADMIN-001
 * @title Use POST/Redirect/GET for Words mutations
 * @status accepted
 * @rationale Plain HTML forms stay dependency-free and a 303 prevents repeat
 *   submissions. Origin and owner checks precede parsing, bootstrap, and writes.
 */

import type { APIContext } from "astro";
import {
  SiteContentError,
  bootstrapSiteContent,
  createWord,
} from "../../../../lib/site-content.ts";
import { validateWordInput } from "../../../../lib/site-validation.ts";
import type { Env } from "../../../../lib/kv-store.ts";
import {
  adminAuthorizationResponse,
  authorizeAdminOwner,
} from "../../../../lib/admin-auth.ts";
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

export async function POST(context: APIContext): Promise<Response> {
  const locals = context.locals as AdminLocals;
  const env = await resolveEnv(locals);
  const originFailure = authorizeMutationOrigin(context.request, env);
  if (originFailure) return originFailure;

  const owner = authorizeAdminOwner(locals.auth?.().userId, env);
  if (!owner.ok) return adminAuthorizationResponse(owner);

  let formData: FormData;
  try {
    formData = await context.request.formData();
  } catch {
    return new Response("Invalid form data", { status: 400 });
  }

  const input = validateWordInput({
    id: formData.get("id"),
    title: formData.get("title"),
    text: formData.get("text"),
    attribution: formData.get("attribution"),
    source: formData.get("source"),
  });
  if (!input.ok) return new Response(input.error, { status: 400 });

  try {
    await bootstrapSiteContent(env);
    await createWord(env, input.value);
  } catch (error) {
    return siteContentErrorResponse(error);
  }
  return context.redirect("/admin/words", 303);
}

export function ALL(): Response {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

function siteContentErrorResponse(error: unknown): Response {
  if (!(error instanceof SiteContentError)) throw error;
  const status = error.code === "duplicate"
    ? 409
    : error.code === "not_found"
      ? 404
      : error.code === "validation"
        ? 400
        : 409;
  return new Response(error.message, { status });
}
