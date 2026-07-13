/**
 * Admin owner authorization layered on Clerk authentication.
 *
 * Clerk remains the authentication provider. This module is the single
 * authority for deciding whether an authenticated Clerk user is the site owner
 * who may reach admin management and write surfaces.
 *
 * @decision DEC-SH-003
 * @title Single-owner admin authorization on top of Clerk
 * @status accepted
 * @rationale The blog admin is a single-owner surface, not a generic
 *   authenticated-user area. Centralizing the owner check prevents individual
 *   pages or API routes from silently allowing every signed-in Clerk user.
 *   Production denies access when the owner ID is absent; local/non-production
 *   keeps the retained Clerk-only behavior for development.
 */

export interface AdminOwnerEnv {
  ADMIN_OWNER_USER_ID?: string;
  ENVIRONMENT?: string;
}

export type AdminAuthorizationResult =
  | { ok: true; reason: "owner" | "local_clerk_fallback" }
  | {
      ok: false;
      status: 401 | 403;
      reason: "unauthenticated" | "not_owner" | "owner_not_configured";
      message: string;
    };

export function authorizeAdminOwner(
  userId: string | null | undefined,
  env: AdminOwnerEnv | null | undefined
): AdminAuthorizationResult {
  if (!userId) {
    return {
      ok: false,
      status: 401,
      reason: "unauthenticated",
      message: "Unauthorized",
    };
  }

  const ownerId = env?.ADMIN_OWNER_USER_ID?.trim() ?? "";
  if (!ownerId) {
    if (isProduction(env)) {
      return {
        ok: false,
        status: 403,
        reason: "owner_not_configured",
        message: "Admin owner is not configured",
      };
    }

    return { ok: true, reason: "local_clerk_fallback" };
  }

  if (userId !== ownerId) {
    return {
      ok: false,
      status: 403,
      reason: "not_owner",
      message: "Forbidden",
    };
  }

  return { ok: true, reason: "owner" };
}

export function adminAuthorizationResponse(
  result: Exclude<AdminAuthorizationResult, { ok: true }>
): Response {
  return new Response(result.message, { status: result.status });
}

function isProduction(env: AdminOwnerEnv | null | undefined): boolean {
  return (env?.ENVIRONMENT ?? "production").toLowerCase() === "production";
}
