/**
 * @decision DEC-CLERK-002
 * @title Route-matcher pattern for /admin/* protection
 * @status accepted
 * @rationale createRouteMatcher with a glob pattern ('/admin(.*)') is the
 *   canonical Clerk pattern for protecting route subtrees. The regex-style
 *   suffix '(.*)' matches /admin, /admin/, /admin/posts, etc. — covering the
 *   full admin namespace without enumerating individual routes. This keeps
 *   auth logic centralised in middleware rather than scattered per-page.
 *   All other routes pass through to next() without auth overhead.
 *   The middleware handler receives (auth, context, next) where auth is a
 *   callable that returns the session auth object synchronously.
 *
 * @decision DEC-SH-003
 * @title Owner authorization is layered after Clerk authentication
 * @status accepted
 * @rationale Clerk proves the request is authenticated; src/lib/admin-auth.ts
 *   proves the authenticated user is the configured site owner. Keeping both
 *   checks here makes every /admin/* page owner-gated without scattering
 *   route-specific authorization logic. The shared environment resolver runs
 *   before Clerk so exact local mode can support credential-free workflows;
 *   every other environment retains the production Clerk and owner sequence.
 */

import {
  clerkMiddleware,
  type AuthFn,
} from '@clerk/astro/server';
import type { APIContext } from "astro";
import {
  adminAuthorizationResponse,
  authorizeAdminOwner,
  resolveAdminAuthMode,
} from "./lib/admin-auth.ts";
import type { Env } from "./lib/kv-store.ts";

const isProtectedRoute = (request: Request): boolean => {
  const pathname = new URL(request.url).pathname;
  return pathname === "/admin" || pathname.startsWith("/admin/");
};

const SECURITY_HEADERS = {
  "Content-Security-Policy": "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

type MiddlewareNext = () => Promise<Response>;
type MiddlewareHandler = (
  context: APIContext,
  next: MiddlewareNext
) => Response | Promise<Response> | void | Promise<void>;
type ClerkHandler = (
  auth: AuthFn,
  context: APIContext,
  next: MiddlewareNext
) => Response | Promise<Response> | undefined;
type ClerkMiddlewareFactory = (handler: ClerkHandler) => MiddlewareHandler;

async function resolveEnv(context: APIContext): Promise<Env> {
  const runtime = (context.locals as { runtime?: object }).runtime;
  const injected = runtime
    ? Object.getOwnPropertyDescriptor(runtime, "env")?.value as Env | undefined
    : undefined;
  if (injected) return injected;
  return (await import("cloudflare:workers")).env as Env;
}

async function withSecurityHeaders(
  result: ReturnType<MiddlewareHandler>
): Promise<Response | void> {
  const response = await result;
  if (!(response instanceof Response)) {
    return response;
  }

  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createAdminMiddleware(
  wrapWithClerk: ClerkMiddlewareFactory = clerkMiddleware
): MiddlewareHandler {
  const productionMiddleware = wrapWithClerk(async (auth, context, next) => {
    if (!isProtectedRoute(context.request)) {
      return next();
    }

    const authObject = auth();

    if (!authObject.userId) {
      return authObject.redirectToSignIn();
    }

    const env = await resolveEnv(context);
    const owner = authorizeAdminOwner(authObject.userId, env);
    if (!owner.ok) {
      return adminAuthorizationResponse(owner);
    }

    return next();
  });

  return async (context, next) => {
    const env = await resolveEnv(context);
    if (resolveAdminAuthMode(env) === "local") {
      return withSecurityHeaders(next());
    }

    return withSecurityHeaders(productionMiddleware(context, next));
  };
}

export const onRequest = createAdminMiddleware();
