/** Security checks shared by authenticated admin mutation routes. */

import type { AdminOwnerEnv } from "./admin-auth.ts";
import { resolveAdminAuthMode } from "./admin-auth.ts";

const PRODUCTION_ORIGIN = "https://georgehyde.dev";

export function authorizeMutationOrigin(
  request: Request,
  env: AdminOwnerEnv | null | undefined
): Response | null {
  if (resolveAdminAuthMode(env) === "local") {
    return null;
  }

  if (request.headers.get("Origin") !== PRODUCTION_ORIGIN) {
    return new Response("Forbidden", { status: 403 });
  }

  return null;
}
