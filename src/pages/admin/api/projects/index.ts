/**
 * Project creation handler.
 *
 * @decision DEC-SCV2-005
 * @title Secure Project mutations before bootstrap and use PRG
 * @status accepted
 * @rationale Origin and owner authorization run before any state access. The
 *   canonical content helper owns validation/conflicts and successful POSTs
 *   redirect with 303 to avoid repeated browser submissions.
 */
import type { APIContext } from "astro";
import { SiteContentError, bootstrapSiteContent, createProject } from "../../../../lib/site-content.ts";
import { validateProjectInput } from "../../../../lib/site-validation.ts";
import type { Env } from "../../../../lib/kv-store.ts";
import { adminAuthorizationResponse, authorizeAdminOwner } from "../../../../lib/admin-auth.ts";
import { authorizeMutationOrigin } from "../../../../lib/request-security.ts";
export const prerender = false;
type AdminLocals = { runtime?: { env: Env }; auth?: () => { userId?: string | null } };
async function resolveEnv(locals: AdminLocals): Promise<Env> {
  const injected = locals.runtime ? Object.getOwnPropertyDescriptor(locals.runtime, "env")?.value as Env | undefined : undefined;
  return injected ?? (await import("cloudflare:workers")).env as Env;
}
export async function POST(context: APIContext): Promise<Response> {
  const locals = context.locals as AdminLocals; const env = await resolveEnv(locals);
  const originFailure = authorizeMutationOrigin(context.request, env); if (originFailure) return originFailure;
  const owner = authorizeAdminOwner(locals.auth?.().userId, env); if (!owner.ok) return adminAuthorizationResponse(owner);
  let form: FormData; try { form = await context.request.formData(); } catch { return new Response("Invalid form data", { status: 400 }); }
  const input = validateProjectInput({ id: form.get("id"), title: form.get("title"), description: form.get("description"), url: form.get("url") });
  if (!input.ok) return new Response(input.error, { status: 400 });
  try { await bootstrapSiteContent(env); await createProject(env, input.value); } catch (error) { return contentError(error); }
  return context.redirect("/admin/projects", 303);
}
export function ALL(): Response { return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } }); }
function contentError(error: unknown): Response {
  if (!(error instanceof SiteContentError)) throw error;
  return new Response(error.message, { status: error.code === "validation" ? 400 : error.code === "not_found" ? 404 : 409 });
}
