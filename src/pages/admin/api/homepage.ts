/**
 * Independent ordered Word and Project selection mutations.
 *
 * @decision DEC-SR-005A
 * @title Route each homepage action to its independent write helper
 * @status accepted
 * @rationale Selection and project forms share security and PRG presentation,
 *   but each action calls only its owning helper and cannot replace sibling state.
 */

import type { APIContext } from "astro";
import {
  SiteContentError,
  bootstrapSiteContent,
  updateHomepageProjectSelection,
  updateHomepageSelection,
} from "../../../lib/site-content.ts";
import {
  validateHomepageProjectSelectionSlots,
  validateHomepageSelectionSlots,
} from "../../../lib/site-validation.ts";
import type { Env } from "../../../lib/kv-store.ts";
import {
  adminAuthorizationResponse,
  authorizeAdminOwner,
} from "../../../lib/admin-auth.ts";
import { authorizeMutationOrigin } from "../../../lib/request-security.ts";

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

  const action = formData.get("_action");
  if (action === "word-selection") {
    const selectedWordIds = validateHomepageSelectionSlots(
      formData.getAll("selectedWordIds")
    );
    if (!selectedWordIds.ok) {
      return new Response(selectedWordIds.error, { status: 400 });
    }
    try {
      await bootstrapSiteContent(env);
      await updateHomepageSelection(env, selectedWordIds.value);
    } catch (error) {
      return siteContentErrorResponse(error);
    }
    return context.redirect("/admin/homepage#words-selection", 303);
  }

  if (action === "project-selection") {
    const selectedProjectIds = validateHomepageProjectSelectionSlots(
      formData.getAll("selectedProjectIds")
    );
    if (!selectedProjectIds.ok) return new Response(selectedProjectIds.error, { status: 400 });
    try {
      await bootstrapSiteContent(env);
      await updateHomepageProjectSelection(env, selectedProjectIds.value);
    } catch (error) {
      return siteContentErrorResponse(error);
    }
    return context.redirect("/admin/homepage#projects-selection", 303);
  }

  return new Response("Invalid homepage action", { status: 400 });
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
