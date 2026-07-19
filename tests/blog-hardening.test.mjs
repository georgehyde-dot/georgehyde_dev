/**
 * @decision DEC-SH-004
 * @title Dependency-free hardening integration coverage
 * @status accepted
 * @rationale Node's built-in runner exercises the real validation, auth, API,
 *   KV, middleware, and configuration sequence without another dependency.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  validateCreatePostForm,
  validateRouteSlug,
  validateUpdatePostForm,
} from "../src/lib/blog-validation.ts";
import {
  authorizeAdminOwner,
  resolveAdminAuthMode,
} from "../src/lib/admin-auth.ts";
import { validateStoredHtml } from "../src/lib/html-policy.ts";
import {
  deleteBlogPost,
  getBlogPost,
  listAllPosts,
  listPublishedPosts,
} from "../src/lib/kv-store.ts";
import { getPublishedBlogPost } from "../src/lib/public-blog.ts";
import { createAdminMiddleware } from "../src/middleware.ts";
import { POST as createPost } from "../src/pages/admin/api/posts/index.ts";
import { POST as mutatePost } from "../src/pages/admin/api/posts/[slug].ts";

const projectFile = (path) => new URL(`../${path}`, import.meta.url);

function formData(entries) {
  const form = new FormData();
  for (const [key, value] of entries) {
    form.set(key, value);
  }
  return form;
}

function formRequest(entries) {
  return new Request("https://georgehyde.dev/admin/api/posts", {
    method: "POST",
    body: formData(entries),
  });
}

function createMemoryKv(pageSize = 2) {
  const records = new Map();

  return {
    async get(key, options) {
      const record = records.get(key);
      if (!record) return null;
      return options?.type === "json" ? JSON.parse(record.value) : record.value;
    },
    async put(key, value, options = {}) {
      records.set(key, {
        value,
        metadata: options.metadata,
      });
    },
    async delete(key) {
      records.delete(key);
    },
    async list({ prefix = "", cursor } = {}) {
      const start = cursor ? Number(cursor) : 0;
      const keys = [...records.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, record]) => ({ name, metadata: record.metadata }));
      const pageKeys = keys.slice(start, start + pageSize);
      const next = start + pageSize;

      return {
        keys: pageKeys,
        list_complete: next >= keys.length,
        cursor: next >= keys.length ? undefined : String(next),
      };
    },
    dump() {
      return records;
    },
  };
}

function createEnv(overrides = {}) {
  return {
    BLOG_POSTS: createMemoryKv(),
    ENVIRONMENT: "production",
    ADMIN_OWNER_USER_ID: "user_owner",
    ...overrides,
  };
}

function apiContext({ env, userId = "user_owner", request, slug } = {}) {
  return {
    params: slug ? { slug } : {},
    request,
    locals: {
      runtime: { env },
      auth: () => ({ userId, sessionId: userId ? "sess_test" : null }),
    },
    redirect(location, status) {
      return new Response(null, {
        status,
        headers: { Location: location },
      });
    },
  };
}

function middlewareContext(env, path = "/admin/posts") {
  return {
    request: new Request(`https://georgehyde.dev${path}`),
    locals: { runtime: { env } },
  };
}

function assertRejectedStoredHtml(html, expectedError) {
  const result = validateStoredHtml(html);
  assert.equal(result.ok, false, `${html} should be rejected`);
  if (expectedError) {
    assert.equal(result.error, expectedError);
  }
}

test("blog validation centralizes slug, title, body, and publish-state parsing", () => {
  assert.equal(validateRouteSlug("hello-world-123").ok, true);
  assert.equal(validateRouteSlug("../bad").ok, false);
  assert.equal(validateRouteSlug("BadSlug").ok, false);

  const validCreate = validateCreatePostForm(
    formData([
      ["title", "  A title  "],
      ["slug", "a-title"],
      ["body", "<p>Hello</p>"],
      ["published", "on"],
    ])
  );
  assert.deepEqual(validCreate, {
    ok: true,
    value: {
      title: "A title",
      slug: "a-title",
      body: "<p>Hello</p>",
      published: true,
    },
  });

  assert.equal(
    validateCreatePostForm(
      formData([
        ["title", ""],
        ["slug", "a-title"],
        ["body", "<p>Hello</p>"],
      ])
    ).error,
    "Title is required"
  );

  assert.equal(
    validateUpdatePostForm(
      formData([
        ["title", "Updated"],
        ["body", "<script>alert(1)</script>"],
      ])
    ).error,
    "Body contains a script tag"
  );
});

test("stored HTML policy rejects executable markup and unsafe URLs", () => {
  assert.equal(validateStoredHtml("<p>Safe <a href=\"/blog\">link</a></p>").ok, true);
  assert.equal(validateStoredHtml("<p><strong>Bold</strong> <em>copy</em></p>").ok, true);
  assert.equal(validateStoredHtml("<p><a href=\"https://example.com\">web</a></p>").ok, true);
  assert.equal(validateStoredHtml("<p><a href=\"mailto:george@example.com\">mail</a></p>").ok, true);
  assert.equal(validateStoredHtml("").error, "Body is required");
  assert.equal(validateStoredHtml("x".repeat(100_001)).error, "Body is too large");
  assert.equal(validateStoredHtml("<script>alert(1)</script>").error, "Body contains a script tag");
  assert.equal(validateStoredHtml("<p onclick=\"x()\">Hi</p>").error, "Body contains an event-handler attribute");
  assert.equal(validateStoredHtml("<svg/onload=alert(1)>").error, "Body contains an event-handler attribute");
  assert.equal(validateStoredHtml("<a href=\"javascript:alert(1)\">x</a>").error, "Body contains an unsafe URL scheme");
  assert.equal(validateStoredHtml("<a href=java&#x73;cript:alert(1)>x</a>").error, "Body contains an unsafe URL scheme");
  assert.equal(validateStoredHtml("<img src='data:text/html;base64,abc'>").error, "Body contains an unsafe URL scheme");
  assert.equal(validateStoredHtml("<object data=javascript:alert(1)></object>").error, "Body contains an executable tag");
  assert.equal(validateStoredHtml("<iframe src=\"https://example.com\"></iframe>").error, "Body contains an executable tag");
  assert.equal(validateStoredHtml("<form action=\"/admin/api/posts\"></form>").error, "Body contains an executable tag");
  assert.equal(validateStoredHtml("<img src=javascript:alert(1)>").error, "Body contains an unsafe URL scheme");
  assertRejectedStoredHtml("<button formaction=javascript:alert(1)>Save</button>");
  assertRejectedStoredHtml("<iframe srcdoc='<script>alert(1)</script>'></iframe>");
  assert.equal(validateStoredHtml("<svg><a xlink:href=\"javascript:alert(1)\">x</a></svg>").error, "Body contains an executable tag");
});

test("stored HTML policy rejects parser-equivalent tag and attribute forms", () => {
  assertRejectedStoredHtml("<p/onpointerenter=alert(1)>Hi</p>", "Body contains an event-handler attribute");
  assertRejectedStoredHtml("<img src=javascript:alert(1)", "Body contains an unsafe URL scheme");
  assertRejectedStoredHtml("<object data=javascript:alert(1)", "Body contains an executable tag");
  assertRejectedStoredHtml("<a href=`javascript:alert(1)`>x</a>", "Body contains an unsafe URL scheme");
  assertRejectedStoredHtml("<img srcset=\"javascript:alert(1) 1x\">", "Body contains an unsafe URL scheme");
  assertRejectedStoredHtml("<p data=javascript:alert(1)>x</p>", "Body contains an unsafe URL scheme");
  assertRejectedStoredHtml("<p srcdoc='<p>x</p>'>x</p>", "Body contains an unsafe URL scheme");
  assertRejectedStoredHtml("<a href=\"java&Tab;script&colon;alert(1)\">x</a>", "Body contains an unsafe URL scheme");
  assertRejectedStoredHtml("<a xlink:href=javascript:alert(1)>x</a>", "Body contains an unsafe URL scheme");
});

test("admin auth mode accepts only exact LOCAL_AUTH_BYPASS true", () => {
  assert.equal(resolveAdminAuthMode({ LOCAL_AUTH_BYPASS: "true" }), "local");

  for (const selector of [undefined, "", " ", "false", "TRUE", "True", " true", "true ", 1, true]) {
    assert.equal(resolveAdminAuthMode({ LOCAL_AUTH_BYPASS: selector }), "production");
  }
  assert.equal(resolveAdminAuthMode({ ENVIRONMENT: "local" }), "production");
  assert.equal(resolveAdminAuthMode(undefined), "production");
});

test("owner authorization bypasses only local mode and fails closed otherwise", () => {
  assert.deepEqual(authorizeAdminOwner(null, createEnv({ LOCAL_AUTH_BYPASS: "true" })), {
    ok: true,
    reason: "local_bypass",
  });
  assert.deepEqual(authorizeAdminOwner(null, createEnv({ ENVIRONMENT: "local" })), {
    ok: false,
    status: 401,
    reason: "unauthenticated",
    message: "Unauthorized",
  });
  assert.deepEqual(authorizeAdminOwner("user_owner", createEnv()), {
    ok: true,
    reason: "owner",
  });
  assert.deepEqual(authorizeAdminOwner("user_other", createEnv()), {
    ok: false,
    status: 403,
    reason: "not_owner",
    message: "Forbidden",
  });
  assert.deepEqual(authorizeAdminOwner(null, createEnv()), {
    ok: false,
    status: 401,
    reason: "unauthenticated",
    message: "Unauthorized",
  });
  assert.deepEqual(authorizeAdminOwner("user_any", createEnv({ ADMIN_OWNER_USER_ID: "" })), {
    ok: false,
    status: 403,
    reason: "owner_not_configured",
    message: "Admin owner is not configured",
  });
  assert.deepEqual(
    authorizeAdminOwner("user_any", createEnv({ ADMIN_OWNER_USER_ID: "", ENVIRONMENT: "unknown" })),
    {
      ok: false,
      status: 403,
      reason: "owner_not_configured",
      message: "Admin owner is not configured",
    }
  );
});

test("middleware bypasses Clerk only locally and preserves production owner enforcement", async () => {
  let clerkCalls = 0;
  let authCalls = 0;
  let nextCalls = 0;
  let currentUserId = null;

  const middleware = createAdminMiddleware((handler) => async (context, next) => {
    clerkCalls += 1;
    return handler(
      () => {
        authCalls += 1;
        return {
          userId: currentUserId,
          redirectToSignIn: () => new Response(null, {
            status: 302,
            headers: { Location: "/sign-in" },
          }),
        };
      },
      context,
      next
    );
  });
  const next = async () => {
    nextCalls += 1;
    return new Response("next", { status: 200 });
  };

  const local = await middleware(middlewareContext(createEnv({ LOCAL_AUTH_BYPASS: "true" })), next);
  assert.equal(local.status, 200);
  assert.equal(clerkCalls, 0);
  assert.equal(authCalls, 0);

  const signedOut = await middleware(middlewareContext(createEnv()), next);
  assert.equal(signedOut.status, 302);
  assert.equal(signedOut.headers.get("Location"), "/sign-in");

  currentUserId = "user_other";
  const nonOwner = await middleware(middlewareContext(createEnv()), next);
  assert.equal(nonOwner.status, 403);

  currentUserId = "user_owner";
  const owner = await middleware(middlewareContext(createEnv()), next);
  assert.equal(owner.status, 200);

  const unknownEnvironment = await middleware(
    middlewareContext(createEnv({ ENVIRONMENT: "unknown", ADMIN_OWNER_USER_ID: "" })),
    next
  );
  assert.equal(unknownEnvironment.status, 403);
  assert.equal(clerkCalls, 4);
  assert.equal(authCalls, 4);
  assert.equal(nextCalls, 2);
});

test("local no-identity admin API sequence preserves validation, KV writes, PRG, and deletion", async () => {
  const env = createEnv({
    ENVIRONMENT: "local",
    LOCAL_AUTH_BYPASS: "true",
    ADMIN_OWNER_USER_ID: "",
  });

  const unsafe = await createPost(apiContext({
    env,
    userId: null,
    request: formRequest([
      ["title", "Unsafe"],
      ["slug", "unsafe"],
      ["body", "<script>alert(1)</script>"],
    ]),
  }));
  assert.equal(unsafe.status, 400);
  assert.equal(await getBlogPost(env, "unsafe"), null);

  const created = await createPost(apiContext({
    env,
    userId: null,
    request: formRequest([
      ["title", "Local post"],
      ["slug", "local-post"],
      ["body", "<p>Created locally</p>"],
      ["published", "on"],
    ]),
  }));
  assert.equal(created.status, 303);
  assert.equal(created.headers.get("Location"), "/admin/posts");
  assert.equal((await getBlogPost(env, "local-post")).body, "<p>Created locally</p>");

  const updated = await mutatePost(apiContext({
    env,
    userId: null,
    slug: "local-post",
    request: formRequest([
      ["title", "Updated locally"],
      ["body", "<p>Updated locally</p>"],
    ]),
  }));
  assert.equal(updated.status, 303);
  assert.equal((await getBlogPost(env, "local-post")).body, "<p>Updated locally</p>");

  const deleted = await mutatePost(apiContext({
    env,
    userId: null,
    slug: "local-post",
    request: formRequest([["_method", "delete"]]),
  }));
  assert.equal(deleted.status, 303);
  assert.equal(await getBlogPost(env, "local-post"), null);

  const productionEnv = createEnv();
  const denied = await createPost(apiContext({
    env: productionEnv,
    userId: null,
    request: formRequest([
      ["title", "Denied"],
      ["slug", "denied"],
      ["body", "<p>Denied</p>"],
    ]),
  }));
  assert.equal(denied.status, 401);
  assert.equal(await getBlogPost(productionEnv, "denied"), null);
});

test("KV listing paginates, filters drafts, and sorts newest first", async () => {
  const env = createEnv({ BLOG_POSTS: createMemoryKv(2) });

  await env.BLOG_POSTS.put("post:old", "{}", {
    metadata: {
      title: "Old",
      slug: "old",
      createdAt: "2026-01-01T00:00:00.000Z",
      published: true,
    },
  });
  await env.BLOG_POSTS.put("post:draft", "{}", {
    metadata: {
      title: "Draft",
      slug: "draft",
      createdAt: "2026-03-01T00:00:00.000Z",
      published: false,
    },
  });
  await env.BLOG_POSTS.put("post:new", "{}", {
    metadata: {
      title: "New",
      slug: "new",
      createdAt: "2026-02-01T00:00:00.000Z",
      published: true,
    },
  });

  assert.deepEqual(
    (await listPublishedPosts(env)).map((post) => post.slug),
    ["new", "old"]
  );
  assert.deepEqual(
    (await listAllPosts(env)).map((post) => post.slug),
    ["draft", "new", "old"]
  );
});

test("admin write handlers and public read helper exercise the production blog sequence", async () => {
  const env = createEnv();

  const unauthorized = await createPost(
    apiContext({
      env,
      userId: "user_other",
      request: formRequest([
        ["title", "Unauthorized"],
        ["slug", "unauthorized"],
        ["body", "<p>Nope</p>"],
      ]),
    })
  );
  assert.equal(unauthorized.status, 403);
  assert.equal(await getBlogPost(env, "unauthorized"), null);

  const created = await createPost(
    apiContext({
      env,
      request: formRequest([
        ["title", "Hello"],
        ["slug", "hello"],
        ["body", "<p>Hello <strong>world</strong></p>"],
        ["published", "on"],
      ]),
    })
  );
  assert.equal(created.status, 303);
  assert.equal(created.headers.get("Location"), "/admin/posts");
  assert.equal((await getPublishedBlogPost(env, "hello")).status, 200);

  const updatedToDraft = await mutatePost(
    apiContext({
      env,
      slug: "hello",
      request: formRequest([
        ["title", "Hello draft"],
        ["body", "<p>Draft now</p>"],
      ]),
    })
  );
  assert.equal(updatedToDraft.status, 303);
  assert.equal((await getPublishedBlogPost(env, "hello")).status, 404);

  const missing = await getPublishedBlogPost(env, "missing");
  assert.equal(missing.status, 404);

  const deleted = await mutatePost(
    apiContext({
      env,
      slug: "hello",
      request: formRequest([["_method", "delete"]]),
    })
  );
  assert.equal(deleted.status, 303);
  assert.equal(await getBlogPost(env, "hello"), null);

  await deleteBlogPost(env, "missing");
});

test("config and source invariants stay aligned with the hardening contract", async () => {
  const [packageJson, wrangler, astroConfig, home, progress, adminHome, detail, editor, newPost, createRoute, updateRoute] =
    await Promise.all([
      readFile(projectFile("package.json"), "utf8"),
      readFile(projectFile("wrangler.toml"), "utf8"),
      readFile(projectFile("astro.config.mjs"), "utf8"),
      readFile(projectFile("src/pages/index.astro"), "utf8"),
      readFile(projectFile("src/pages/progress.astro"), "utf8"),
      readFile(projectFile("src/pages/admin/index.astro"), "utf8"),
      readFile(projectFile("src/pages/blog/[slug].astro"), "utf8"),
      readFile(projectFile("src/components/PostEditor.astro"), "utf8"),
      readFile(projectFile("src/pages/admin/posts/new.astro"), "utf8"),
      readFile(projectFile("src/pages/admin/api/posts/index.ts"), "utf8"),
      readFile(projectFile("src/pages/admin/api/posts/[slug].ts"), "utf8"),
    ]);

  const parsedPackage = JSON.parse(packageJson);
  assert.match(parsedPackage.scripts.test, /^node --test /);
  assert.match(wrangler, /binding = "BLOG_POSTS"/);
  assert.match(wrangler, /binding = "SESSION"/);
  assert.match(wrangler, /compatibility_flags = \["nodejs_compat"\]/);
  assert.match(wrangler, /PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_/);
  assert.match(wrangler, /ADMIN_OWNER_USER_ID = /);

  const firstTableIndex = wrangler.search(/^\[/m);
  const routesIndex = wrangler.search(/^routes\s*=/m);
  const assetsStart = wrangler.search(/^\[assets\]\s*$/m);
  const nextTableOffset = wrangler.slice(assetsStart + 1).search(/^\[/m);
  const assetsEnd = nextTableOffset === -1 ? wrangler.length : assetsStart + 1 + nextTableOffset;
  const assetsSection = wrangler.slice(assetsStart, assetsEnd);

  assert.ok(routesIndex >= 0, "wrangler routes must be configured");
  assert.ok(routesIndex < firstTableIndex, "wrangler routes must be top-level before the first table");
  assert.doesNotMatch(assetsSection, /^routes\s*=/m);
  assert.match(astroConfig, /adapter: cloudflare\(\)/);

  assert.match(home, /export const prerender = true/);
  assert.match(home, /href="\/blog"/);
  assert.match(progress, /export const prerender = true/);
  assert.doesNotMatch(progress, /console\.log/);
  assert.doesNotMatch(home + progress, /LinkedIn/i);

  assert.doesNotMatch(detail, /set:html=\{post\.body\}/);
  assert.match(detail, /safeBody/);
  assert.match(editor, /type="hidden" id="body" name="body"/);
  assert.match(adminHome, /resolveAdminAuthMode/);
  assert.match(adminHome, /Local development mode/);
  assert.match(adminHome, /!isLocal.*href="\/sign-out"/s);
  assert.match(createRoute, /validateCreatePostForm/);
  assert.match(updateRoute, /validateUpdatePostForm/);
  assert.doesNotMatch(createRoute + updateRoute, /ENVIRONMENT|resolveAdminAuthMode|["']local["']/);
  assert.doesNotMatch(newPost + createRoute + updateRoute, /SLUG_RE|\/\^\[a-z0-9-|\[a-z0-9-\]\+/);
});
