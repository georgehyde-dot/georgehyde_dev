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
 *   route-specific authorization logic.
 */

import { clerkMiddleware, createRouteMatcher } from '@clerk/astro/server';
import type { Runtime } from "@astrojs/cloudflare";
import {
  adminAuthorizationResponse,
  authorizeAdminOwner,
} from "./lib/admin-auth.ts";
import type { Env } from "./lib/kv-store.ts";

const isProtectedRoute = createRouteMatcher(['/admin(.*)']);

export const onRequest = clerkMiddleware((auth, context, next) => {
  if (!isProtectedRoute(context.request)) {
    return next();
  }

  const authObject = auth();

  if (!authObject.userId) {
    return authObject.redirectToSignIn();
  }

  const runtime = (context.locals as Runtime<Env>).runtime;
  const owner = authorizeAdminOwner(authObject.userId, runtime?.env);
  if (!owner.ok) {
    return adminAuthorizationResponse(owner);
  }

  return next();
});
