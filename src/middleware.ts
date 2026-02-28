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
 */

import { clerkMiddleware, createRouteMatcher } from '@clerk/astro/server';

const isProtectedRoute = createRouteMatcher(['/admin(.*)']);

export const onRequest = clerkMiddleware((auth, context, next) => {
  const authObject = auth();

  if (!authObject.userId && isProtectedRoute(context.request)) {
    return authObject.redirectToSignIn();
  }

  return next();
});
