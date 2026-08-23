/**
 * Update or delete a Word using its immutable route id.
 *
 * @decision DEC-SR-005
 * @title Enforce selected-Word integrity through canonical helpers
 * @status accepted
 * @rationale The API authorizes first, then delegates updates and guarded
 *   deletion to site-content so no route can bypass homepage references.
 */

import type { APIContext } from "astro";
import {
  SiteContentError,
  bootstrapSiteContent,
  deleteWord,
  updateWord,
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

  const method = formData.get("_method")?.toString().toLowerCase();
  if (method === "delete") {
    try {
      await bootstrapSiteContent(env);
      await deleteWord(env, context.params.id);
    } catch (error) {
      return siteContentErrorResponse(error);
    }
    return context.redirect("/admin/words", 303);
  }

  const input = validateWordInput({
    id: context.params.id,
    text: formData.get("text"),
    attribution: formData.get("attribution"),
    source: formData.get("source"),
  });
  if (!input.ok) return new Response(input.error, { status: 400 });

  try {
    await bootstrapSiteContent(env);
    await updateWord(env, input.value.id, {
      text: input.value.text,
      attribution: input.value.attribution,
      source: input.value.source,
    });
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
  const status = error.code === "not_found"
    ? 404
    : error.code === "validation"
      ? 400
      : 409;
  return new Response(error.message, { status });
}
