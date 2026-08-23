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
import { authorizeMutationOrigin } from "../src/lib/request-security.ts";
import {
  deleteBlogPost,
  getBlogPost,
  listAllPosts,
  listPublishedPosts,
  putBlogPost,
} from "../src/lib/kv-store.ts";
import { getPublishedBlogPost } from "../src/lib/public-blog.ts";
import { createAdminMiddleware } from "../src/middleware.ts";
import {
  ALL as rejectCreatePostMethod,
  POST as createPost,
} from "../src/pages/admin/api/posts/index.ts";
import {
  ALL as rejectMutatePostMethod,
  POST as mutatePost,
} from "../src/pages/admin/api/posts/[slug].ts";

const projectFile = (path) => new URL(`../${path}`, import.meta.url);

function formData(entries) {
  const form = new FormData();
  for (const [key, value] of entries) {
    form.set(key, value);
  }
  return form;
}

function formRequest(entries, { accept } = {}) {
  return new Request("https://georgehyde.dev/admin/api/posts", {
    method: "POST",
    headers: {
      Origin: "https://georgehyde.dev",
      ...(accept ? { Accept: accept } : {}),
    },
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

function assertSanitizedStoredHtml(html) {
  const result = validateStoredHtml(html);
  if (result.ok) {
    assert.doesNotMatch(result.value, /\son[a-z0-9_-]*\s*=/i);
    assert.doesNotMatch(result.value, /(?:javascript|data|vbscript)\s*:/i);
    assert.doesNotMatch(result.value, /<(?:script|style|svg|iframe|object|form|img)\b/i);
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
    "Body is required"
  );
});

test("stored HTML policy sanitizes executable markup and unsafe URLs", () => {
  assert.equal(validateStoredHtml("<p>Safe <a href=\"/blog\">link</a></p>").ok, true);
  assert.equal(validateStoredHtml("<p><strong>Bold</strong> <em>copy</em></p>").ok, true);
  assert.equal(validateStoredHtml("<p><a href=\"https://example.com\">web</a></p>").ok, true);
  assert.equal(validateStoredHtml("<p><a href=\"mailto:george@example.com\">mail</a></p>").ok, true);
  assert.equal(validateStoredHtml("").error, "Body is required");
  assert.equal(validateStoredHtml("x".repeat(100_001)).error, "Body is too large");
  for (const unsafe of [
    "<script>alert(1)</script>",
    "<p onclick=\"x()\">Hi</p>",
    "<svg/onload=alert(1)>",
    "<a href=\"javascript:alert(1)\">x</a>",
    "<a href=java&#x73;cript:alert(1)>x</a>",
    "<img src='data:text/html;base64,abc'>",
    "<object data=javascript:alert(1)></object>",
    "<iframe src=\"https://example.com\"></iframe>",
    "<form action=\"/admin/api/posts\"></form>",
    "<button formaction=javascript:alert(1)>Save</button>",
    "<iframe srcdoc='<script>alert(1)</script>'></iframe>",
    "<svg><a xlink:href=\"javascript:alert(1)\">x</a></svg>",
  ]) assertSanitizedStoredHtml(unsafe);
});

test("stored HTML sanitizer handles parser-equivalent tag and attribute forms", () => {
  for (const unsafe of [
    "<p/onpointerenter=alert(1)>Hi</p>",
    "<img src=javascript:alert(1)",
    "<object data=javascript:alert(1)",
    "<a href=`javascript:alert(1)`>x</a>",
    "<img srcset=\"javascript:alert(1) 1x\">",
    "<p data=javascript:alert(1)>x</p>",
    "<p srcdoc='<p>x</p>'>x</p>",
    "<a href=\"java&Tab;script&colon;alert(1)\">x</a>",
    "<a xlink:href=javascript:alert(1)>x</a>",
  ]) assertSanitizedStoredHtml(unsafe);
});

test("admin auth mode accepts only exact LOCAL_AUTH_BYPASS true", () => {
  assert.equal(resolveAdminAuthMode({ ENVIRONMENT: "local", LOCAL_AUTH_BYPASS: "true" }), "local");
  assert.equal(resolveAdminAuthMode({ ENVIRONMENT: "production", LOCAL_AUTH_BYPASS: "true" }), "production");

  for (const selector of [undefined, "", " ", "false", "TRUE", "True", " true", "true ", 1, true]) {
    assert.equal(resolveAdminAuthMode({ LOCAL_AUTH_BYPASS: selector }), "production");
  }
  assert.equal(resolveAdminAuthMode({ ENVIRONMENT: "local" }), "production");
  assert.equal(resolveAdminAuthMode(undefined), "production");
});

test("owner authorization bypasses only local mode and fails closed otherwise", () => {
  assert.deepEqual(authorizeAdminOwner(null, createEnv({ ENVIRONMENT: "local", LOCAL_AUTH_BYPASS: "true" })), {
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

test("admin mutations require the canonical production origin", () => {
  const production = createEnv();
  const sameOrigin = new Request("https://georgehyde.dev/admin/api/posts", {
    method: "POST",
    headers: { Origin: "https://georgehyde.dev" },
  });
  assert.equal(authorizeMutationOrigin(sameOrigin, production), null);

  for (const origin of [undefined, "null", "https://evil.example", "https://www.georgehyde.dev"]) {
    const request = new Request("https://georgehyde.dev/admin/api/posts", {
      method: "POST",
      headers: origin ? { Origin: origin } : undefined,
    });
    assert.equal(authorizeMutationOrigin(request, production)?.status, 403);
  }

  const localRequest = new Request("http://127.0.0.1:4321/admin/api/posts", { method: "POST" });
  assert.equal(
    authorizeMutationOrigin(localRequest, { ENVIRONMENT: "local", LOCAL_AUTH_BYPASS: "true" }),
    null
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

  const local = await middleware(middlewareContext(createEnv({ ENVIRONMENT: "local", LOCAL_AUTH_BYPASS: "true" })), next);
  assert.equal(local.status, 200);
  assert.equal(local.headers.get("X-Frame-Options"), "DENY");
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

test("create autosave negotiates JSON with both signals and claims one unpublished canonical post", async () => {
  const env = createEnv();
  const response = await createPost(apiContext({
    env,
    request: formRequest([
      ["title", "Canonical draft"],
      ["slug", "canonical-draft"],
      ["body", "<p>Draft body</p>"],
      ["published", "on"],
      ["_autosave", "1"],
    ], { accept: "application/json" }),
  }));

  assert.equal(response.status, 201);
  assert.match(response.headers.get("content-type"), /^application\/json\b/);
  assert.deepEqual(await response.json(), {
    ok: true,
    post: { slug: "canonical-draft", published: false },
  });
  assert.equal(env.BLOG_POSTS.dump().size, 1);
  assert.equal(env.BLOG_POSTS.dump().has("post:canonical-draft"), true);
  assert.equal((await getBlogPost(env, "canonical-draft")).published, false);
});

test("create autosave JSON failures preserve status semantics and never mutate KV", async () => {
  const env = createEnv();
  const autosaveRequest = (entries) => formRequest(
    [...entries, ["_autosave", "1"]],
    { accept: "application/json" }
  );

  const invalid = await createPost(apiContext({
    env,
    request: autosaveRequest([
      ["title", ""],
      ["slug", "invalid"],
      ["body", "<p>Body</p>"],
    ]),
  }));
  assert.equal(invalid.status, 400);
  assert.match(invalid.headers.get("content-type"), /^application\/json\b/);
  assert.deepEqual(await invalid.json(), {
    ok: false,
    error: { code: "invalid_request", message: "Title is required" },
  });
  assert.equal(env.BLOG_POSTS.dump().size, 0);

  await env.BLOG_POSTS.put("post:taken", JSON.stringify({ slug: "taken" }));
  const duplicate = await createPost(apiContext({
    env,
    request: autosaveRequest([
      ["title", "Duplicate"],
      ["slug", "taken"],
      ["body", "<p>Body</p>"],
    ]),
  }));
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), {
    ok: false,
    error: {
      code: "slug_conflict",
      message: 'A post with slug "taken" already exists',
    },
  });
  assert.equal(env.BLOG_POSTS.dump().size, 1);

  const deniedEnv = createEnv();
  const denied = await createPost(apiContext({
    env: deniedEnv,
    userId: null,
    request: autosaveRequest([
      ["title", "Denied"],
      ["slug", "denied"],
      ["body", "<p>Body</p>"],
    ]),
  }));
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), {
    ok: false,
    error: { code: "unauthorized", message: "Unauthorized" },
  });
  assert.equal(deniedEnv.BLOG_POSTS.dump().size, 0);
});

test("create route keeps ordinary presentation unless both autosave signals are present", async () => {
  for (const [slug, entries, accept] of [
    ["form-signal-only", [["_autosave", "1"]], undefined],
    ["header-signal-only", [], "application/json"],
  ]) {
    const env = createEnv();
    const response = await createPost(apiContext({
      env,
      request: formRequest([
        ["title", "Ordinary create"],
        ["slug", slug],
        ["body", "<p>Body</p>"],
        ["published", "on"],
        ...entries,
      ], { accept }),
    }));

    assert.equal(response.status, 303);
    assert.equal(response.headers.get("Location"), "/admin/posts");
    assert.equal((await getBlogPost(env, slug)).published, true);
  }

  const methodNotAllowed = rejectCreatePostMethod();
  assert.equal(methodNotAllowed.status, 405);
  assert.equal(methodNotAllowed.headers.get("Allow"), "POST");
  assert.equal(await methodNotAllowed.text(), "Method Not Allowed");
});

test("update autosave uses route identity and preserves immutable and publication state", async () => {
  for (const published of [false, true]) {
    const env = createEnv();
    const createdAt = "2026-07-01T12:00:00.000Z";
    await putBlogPost(env, {
      slug: "canonical-post",
      title: "Before",
      body: "<p>Before</p>",
      author: "George Hyde",
      createdAt,
      updatedAt: createdAt,
      published,
    });

    const response = await mutatePost(apiContext({
      env,
      slug: "canonical-post",
      request: formRequest([
        ["title", "After"],
        ["slug", "client-supplied-rename"],
        ["body", "<p>After</p>"],
        ["published", published ? "" : "on"],
        ["_autosave", "1"],
      ], { accept: "application/json; charset=utf-8" }),
    }));

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^application\/json\b/);
    assert.deepEqual(await response.json(), {
      ok: true,
      post: { slug: "canonical-post", published },
    });

    const stored = await getBlogPost(env, "canonical-post");
    assert.equal(stored.slug, "canonical-post");
    assert.equal(stored.createdAt, createdAt);
    assert.equal(stored.title, "After");
    assert.equal(stored.body, "<p>After</p>");
    assert.equal(stored.published, published);
    assert.notEqual(stored.updatedAt, createdAt);
    assert.equal(await getBlogPost(env, "client-supplied-rename"), null);
    assert.equal(env.BLOG_POSTS.dump().size, 1);
  }
});

test("update autosave JSON failures retain stable schemas and do not mutate KV", async () => {
  const env = createEnv();
  const createdAt = "2026-07-01T12:00:00.000Z";
  const original = {
    slug: "existing",
    title: "Existing",
    body: "<p>Existing</p>",
    author: "George Hyde",
    createdAt,
    updatedAt: createdAt,
    published: true,
  };
  await putBlogPost(env, original);
  const autosaveRequest = (entries) => formRequest(
    [...entries, ["_autosave", "1"]],
    { accept: "application/json" }
  );

  const invalid = await mutatePost(apiContext({
    env,
    slug: "existing",
    request: autosaveRequest([
      ["title", ""],
      ["body", "<p>Changed</p>"],
    ]),
  }));
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), {
    ok: false,
    error: { code: "invalid_request", message: "Title is required" },
  });
  assert.deepEqual(await getBlogPost(env, "existing"), original);

  const missing = await mutatePost(apiContext({
    env,
    slug: "missing",
    request: autosaveRequest([
      ["title", "Missing"],
      ["body", "<p>Missing</p>"],
    ]),
  }));
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {
    ok: false,
    error: { code: "not_found", message: "Post not found" },
  });
  assert.equal(env.BLOG_POSTS.dump().size, 1);

  const denied = await mutatePost(apiContext({
    env,
    userId: null,
    slug: "existing",
    request: autosaveRequest([
      ["title", "Denied"],
      ["body", "<p>Denied</p>"],
    ]),
  }));
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), {
    ok: false,
    error: { code: "unauthorized", message: "Unauthorized" },
  });
  assert.deepEqual(await getBlogPost(env, "existing"), original);
});

test("update route requires both autosave signals and excludes delete from JSON mode", async () => {
  for (const [label, entries, accept] of [
    ["form-signal-only", [["_autosave", "1"]], undefined],
    ["header-signal-only", [], "application/json"],
  ]) {
    const env = createEnv();
    await putBlogPost(env, {
      slug: label,
      title: "Before",
      body: "<p>Before</p>",
      author: "George Hyde",
      createdAt: "2026-07-01T12:00:00.000Z",
      updatedAt: "2026-07-01T12:00:00.000Z",
      published: true,
    });
    const response = await mutatePost(apiContext({
      env,
      slug: label,
      request: formRequest([
        ["title", "Ordinary update"],
        ["body", "<p>Ordinary update</p>"],
        ...entries,
      ], { accept }),
    }));

    assert.equal(response.status, 303);
    assert.equal(response.headers.get("Location"), "/admin/posts");
    assert.equal((await getBlogPost(env, label)).published, false);
  }

  const deleteEnv = createEnv();
  await putBlogPost(deleteEnv, {
    slug: "delete-me",
    title: "Delete me",
    body: "<p>Delete me</p>",
    author: "George Hyde",
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    published: false,
  });
  const deleted = await mutatePost(apiContext({
    env: deleteEnv,
    slug: "delete-me",
    request: formRequest([
      ["_method", "delete"],
      ["_autosave", "1"],
    ], { accept: "application/json" }),
  }));
  assert.equal(deleted.status, 303);
  assert.equal(deleted.headers.get("Location"), "/admin/posts");
  assert.equal(await getBlogPost(deleteEnv, "delete-me"), null);

  const methodNotAllowed = rejectMutatePostMethod();
  assert.equal(methodNotAllowed.status, 405);
  assert.equal(methodNotAllowed.headers.get("Allow"), "POST");
  assert.equal(await methodNotAllowed.text(), "Method Not Allowed");
});

function extractEditorSaveController(source) {
  const match = source.match(
    /\/\* SAVE_CONTROLLER_START \*\/\s*([\s\S]*?)\s*\/\* SAVE_CONTROLLER_END \*\//
  );
  assert.ok(match, "PostEditor must expose its dependency-free save controller for deterministic tests");
  return Function(`"use strict"; ${match[1]}; return createSaveController;`)();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("PostEditor formatting, accessibility, paste, and form integration contract is complete", async () => {
  const editor = await readFile(projectFile("src/components/PostEditor.astro"), "utf8");

  for (const contract of [
    /data-block="p"[^>]*aria-label="Paragraph"/,
    /data-block="h2"[^>]*aria-label="Heading 2"/,
    /data-block="h3"[^>]*aria-label="Heading 3"/,
    /data-command="bold"[^>]*aria-label="Bold"[^>]*aria-pressed="false"/,
    /data-command="italic"[^>]*aria-label="Italic"[^>]*aria-pressed="false"/,
    /data-inline-code[^>]*aria-label="Inline code"[^>]*aria-pressed="false"/,
    /data-block="pre"[^>]*aria-label="Code block"/,
    /data-block="blockquote"[^>]*aria-label="Blockquote"/,
    /data-command="insertUnorderedList"[^>]*aria-label="Bulleted list"[^>]*aria-pressed="false"/,
    /data-command="insertOrderedList"[^>]*aria-label="Numbered list"[^>]*aria-pressed="false"/,
    /data-link[^>]*aria-label="Insert link"/,
    /data-command="undo"[^>]*aria-label="Undo"[^>]*disabled/,
    /data-command="redo"[^>]*aria-label="Redo"[^>]*disabled/,
    /data-command="removeFormat"[^>]*aria-label="Clear formatting"/,
  ]) {
    assert.match(editor, contract);
  }

  assert.match(editor, /const AUTOSAVE_DELAY_MS = 750;/);
  assert.equal((editor.match(/AUTOSAVE_DELAY_MS\s*=\s*750/g) ?? []).length, 1);
  assert.match(editor, /event\.clipboardData\?\.getData\('text\/plain'\)/);
  assert.doesNotMatch(editor, /getData\(['"]text\/html['"]\)/);
  assert.match(editor, /getData\('text\/plain'\)[\s\S]*?event\.preventDefault\(\);[\s\S]*?if \(!text\.trim\(\)\)/);
  assert.match(editor, /textToParagraphHtml/);
  assert.match(editor, /escapeHtml/);
  assert.match(editor, /normalizeLinkHref/);
  assert.match(editor, /range\.setStartAfter\(activeCode\)/);
  assert.match(editor, /activeCode\.replaceWith\(\.\.\.activeCode\.childNodes\)/);
  assert.match(editor, /contents\.querySelectorAll\('code'\)/);
  assert.match(editor, /const toggleStandaloneBlock = \(tagName\) =>/);
  assert.match(editor, /placeCaretAtStart\(paragraphAfter\(activeBlock\)\)/);
  assert.match(editor, /document\.execCommand\('formatBlock', false, tagName\)/);
  assert.match(editor, /paragraph\.append\(document\.createElement\('br'\)\)/);
  assert.match(
    editor,
    /if \(block === 'pre' \|\| block === 'blockquote'\) \{\s*toggleStandaloneBlock\(block\)/
  );
  assert.match(editor, /new CustomEvent\('post-editor:save-draft', \{ bubbles: true \}\)/);
  assert.match(editor, /form\?\.addEventListener\('post-editor:save-draft'/);
  assert.match(editor, /role="textbox"\s+aria-label="Post body"/);
  assert.match(
    editor,
    /form\?\.addEventListener\('submit',[\s\S]*window\.setTimeout\([\s\S]*button\.disabled = true/,
    "native form serialization must capture the clicked submitter before buttons are disabled"
  );
  assert.doesNotMatch(editor, /localStorage|sessionStorage|indexedDB/i);

  for (const selector of [
    "[data-post-save-status]",
    "[data-post-save-retry]",
    "[data-post-save-draft]",
    'input[name="title"]',
    'input[name="slug"]',
    'input[name="body"]',
  ]) {
    assert.ok(editor.includes(selector), `documented form contract must include ${selector}`);
  }

  assert.match(editor, /editor\.innerHTML\.trim\(\)/);
  assert.match(editor, /bodyInput\.value = html/);
  assert.match(editor, /preview\.innerHTML = html \|\| emptyPreview/);
  assert.match(editor, /button\.addEventListener\('mousedown', \(event\) => \{\s*event\.preventDefault\(\)/s);
  assert.match(editor, /selectionchange/);
  assert.match(editor, /queryCommandState/);
  assert.match(editor, /queryCommandEnabled/);
});

test("PostEditor save controller coalesces, serializes, rejects stale truth, retries, and locks identity", async () => {
  const source = await readFile(projectFile("src/components/PostEditor.astro"), "utf8");
  const createSaveController = extractEditorSaveController(source);
  const timers = [];
  const requests = [];
  const states = [];
  let snapshot = { title: "One", slug: "draft", body: "<p>One</p>" };
  const setTimer = (callback, delay) => {
    const timer = { callback, delay, cancelled: false };
    timers.push(timer);
    return timer;
  };
  const clearTimer = (timer) => {
    timer.cancelled = true;
  };
  const request = (payload) => {
    const pending = deferred();
    requests.push({ payload, pending });
    return pending.promise;
  };
  const controller = createSaveController({
    delay: 750,
    getSnapshot: () => ({ ...snapshot }),
    request,
    setTimer,
    clearTimer,
    onState: (state) => states.push({ ...state }),
    initialAction: "/admin/api/posts",
  });

  controller.changed();
  snapshot = { title: "Two", slug: "draft", body: "<p>Two</p>" };
  controller.changed();
  assert.equal(timers.at(-1).delay, 750);
  assert.equal(timers.filter((timer) => !timer.cancelled).length, 1);
  timers.at(-1).callback();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].payload.snapshot.body, "<p>Two</p>");
  assert.equal(requests[0].payload.action, "/admin/api/posts");

  snapshot = { title: "Three", slug: "draft", body: "<p>Three</p>" };
  controller.changed();
  snapshot = { title: "Four", slug: "draft", body: "<p>Four</p>" };
  controller.changed();
  timers.at(-1).callback();
  assert.equal(requests.length, 1, "only one request may be in flight");

  requests[0].pending.resolve({ ok: true, post: { slug: "canonical", published: false } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(requests.length, 2, "one latest-snapshot follow-up must run");
  assert.equal(requests[1].payload.snapshot.body, "<p>Four</p>");
  assert.equal(requests[1].payload.action, "/admin/api/posts/canonical");
  assert.equal(controller.getState().canonicalSlug, "canonical");
  assert.equal(controller.getState().dirty, true);
  assert.notEqual(controller.getState().status, "saved");

  requests[1].pending.resolve({ ok: true, post: { slug: "conflicting", published: false } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(controller.getState().canonicalSlug, "canonical");
  assert.equal(controller.getState().status, "saved");
  assert.equal(controller.getState().dirty, false);

  snapshot = { title: "Five", slug: "ignored", body: "<p>Five</p>" };
  controller.saveNow();
  assert.equal(requests.length, 3, "explicit save bypasses debounce");
  requests[2].pending.reject(new Error("offline"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(controller.getState().status, "error");
  assert.equal(controller.getState().dirty, true);

  controller.retry();
  assert.equal(requests.length, 4);
  assert.equal(requests[3].payload.snapshot.body, "<p>Five</p>");
  requests[3].pending.resolve({ ok: true, post: { slug: "canonical", published: false } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(controller.getState().status, "saved");
  assert.ok(states.some((state) => state.status === "saving"));
  assert.ok(states.some((state) => state.status === "error"));
});

test("new post form wires one editor controller through draft creation and explicit publish", async () => {
  const newPost = await readFile(projectFile("src/pages/admin/posts/new.astro"), "utf8");

  assert.match(newPost, /<form[^>]*method="POST"[^>]*action="\/admin\/api\/posts"[^>]*data-new-post-form/s);
  assert.match(newPost, /name="title"/);
  assert.match(newPost, /name="slug"/);
  assert.match(newPost, /<PostEditor\s*\/>/);
  assert.match(newPost, /data-post-save-status[^>]*aria-live="polite"/);
  assert.match(newPost, /data-post-save-retry[^>]*hidden/);
  assert.match(newPost, /data-post-save-draft[^>]*type="button"[^>]*>Save draft</);
  assert.match(newPost, /name="published"/);
  assert.match(newPost, /type="submit"[^>]*>Publish</);
  assert.match(newPost, /dataset\.draftAction[\s\S]*form\.action = canonicalAction/);
  assert.match(newPost, /MutationObserver/);
  assert.doesNotMatch(newPost, /fetch\(|localStorage|sessionStorage|indexedDB/i);

  const env = createEnv();
  const pendingInvalid = await createPost(apiContext({
    env,
    request: formRequest([
      ["title", "Pending"],
      ["slug", "pending"],
      ["body", ""],
    ], { accept: "application/json" }),
  }));
  assert.equal(pendingInvalid.status, 400);
  assert.equal(await getBlogPost(env, "pending"), null);

  const createdDraft = await createPost(apiContext({
    env,
    request: formRequest([
      ["title", "Canonical draft"],
      ["slug", "canonical-draft"],
      ["body", "<p>Draft body</p>"],
      ["_autosave", "1"],
    ], { accept: "application/json" }),
  }));
  assert.equal(createdDraft.status, 201);
  assert.deepEqual(await createdDraft.json(), {
    ok: true,
    post: { slug: "canonical-draft", published: false },
  });

  const duplicate = await createPost(apiContext({
    env,
    request: formRequest([
      ["title", "Duplicate"],
      ["slug", "canonical-draft"],
      ["body", "<p>Must not overwrite</p>"],
      ["_autosave", "1"],
    ], { accept: "application/json" }),
  }));
  assert.equal(duplicate.status, 409);
  assert.equal((await getBlogPost(env, "canonical-draft")).title, "Canonical draft");

  const published = await mutatePost(apiContext({
    env,
    slug: "canonical-draft",
    request: formRequest([
      ["title", "Canonical draft"],
      ["slug", "canonical-draft"],
      ["body", "<p>Draft body</p>"],
      ["published", "on"],
    ]),
  }));
  assert.equal(published.status, 303);
  assert.equal(published.headers.get("Location"), "/admin/posts");
  assert.equal((await getBlogPost(env, "canonical-draft")).published, true);
});

test("edit post form wires canonical update autosave, draft save, retry, and explicit publication", async () => {
  const editPost = await readFile(
    projectFile("src/pages/admin/posts/[slug]/edit.astro"),
    "utf8"
  );

  assert.match(editPost, /const actionUrl = `\/admin\/api\/posts\/\$\{slug\}`/);
  assert.match(editPost, /<form[^>]*method="POST"[^>]*action=\{actionUrl\}[^>]*data-edit-post-form/s);
  assert.match(editPost, /name="title"/);
  assert.match(editPost, /name="slug"[^>]*value=\{post\.slug\}[^>]*readonly/s);
  assert.match(editPost, /<PostEditor initialBody=\{storedBody\.value\}\s*\/>/);
  assert.match(editPost, /data-post-save-status[^>]*aria-live="polite"/);
  assert.match(editPost, /data-post-save-retry[^>]*hidden/);
  assert.match(editPost, /data-post-save-draft[^>]*type="button"[^>]*>Save draft</);
  assert.match(editPost, /type="submit"[\s\S]*?name=\{post\.published \? undefined : "published"\}[\s\S]*?value=\{post\.published \? undefined : "on"\}[\s\S]*?>\{post\.published \? "Unpublish" : "Publish"\}</);
  assert.doesNotMatch(editPost, /fetch\(|localStorage|sessionStorage|indexedDB|MutationObserver/i);
  assert.equal(
    (editPost.match(/post-editor:save-draft/g) ?? []).length,
    0,
    "the edit form must not add a second draft-save controller"
  );

  for (const published of [false, true]) {
    const env = createEnv();
    const slug = published ? "published-post" : "draft-post";
    await putBlogPost(env, {
      slug,
      title: "Before",
      body: "<p>Before</p>",
      author: "George Hyde",
      createdAt: "2026-07-01T12:00:00.000Z",
      updatedAt: "2026-07-01T12:00:00.000Z",
      published,
    });

    const autosaved = await mutatePost(apiContext({
      env,
      slug,
      request: formRequest([
        ["title", "Autosaved"],
        ["slug", "attempted-rename"],
        ["body", "<p>Autosaved body</p>"],
        ["_autosave", "1"],
      ], { accept: "application/json" }),
    }));
    assert.equal(autosaved.status, 200);
    assert.deepEqual(await autosaved.json(), {
      ok: true,
      post: { slug, published },
    });
    assert.equal((await getBlogPost(env, slug)).published, published);
    assert.equal(await getBlogPost(env, "attempted-rename"), null);

    const explicitlyToggled = await mutatePost(apiContext({
      env,
      slug,
      request: formRequest([
        ["title", "Explicit final save"],
        ["slug", slug],
        ["body", "<p>Explicit final body</p>"],
        ...(published ? [] : [["published", "on"]]),
      ]),
    }));
    assert.equal(explicitlyToggled.status, 303);
    assert.equal(explicitlyToggled.headers.get("Location"), "/admin/posts");
    assert.equal((await getBlogPost(env, slug)).published, !published);
  }
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
  const [packageJson, wrangler, staticHeaders, astroConfig, home, adminHome, blogList, detail, editor, newPost, createRoute, updateRoute] =
    await Promise.all([
      readFile(projectFile("package.json"), "utf8"),
      readFile(projectFile("wrangler.toml"), "utf8"),
      readFile(projectFile("public/_headers"), "utf8"),
      readFile(projectFile("astro.config.mjs"), "utf8"),
      readFile(projectFile("src/pages/index.astro"), "utf8"),
      readFile(projectFile("src/pages/admin/index.astro"), "utf8"),
      readFile(projectFile("src/pages/blog/index.astro"), "utf8"),
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
  assert.match(wrangler, /keep_vars = true/);
  assert.doesNotMatch(wrangler, /ADMIN_OWNER_USER_ID\s*=\s*""/);
  assert.match(staticHeaders, /Content-Security-Policy:.*frame-ancestors 'none'/);
  assert.match(staticHeaders, /X-Content-Type-Options: nosniff/);
  assert.match(staticHeaders, /X-Frame-Options: DENY/);

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

  assert.match(home, /export const prerender = false/);
  assert.match(home, /href="\/blog"/);
  assert.doesNotMatch(home, /LinkedIn/i);

  assert.doesNotMatch(detail, /set:html=\{post\.body\}/);
  assert.match(detail, /safeBody/);
  assert.match(blogList, /href="\/"[\s\S]*Home/);
  assert.match(detail, /href="\/" class="back-link">Home/);
  assert.match(editor, /type="hidden" id="body" name="body"/);
  assert.match(adminHome, /resolveAdminAuthMode/);
  assert.match(adminHome, /Local development mode/);
  assert.match(adminHome, /!isLocal.*href="\/sign-out"/s);
  assert.match(createRoute, /validateCreatePostForm/);
  assert.match(updateRoute, /validateUpdatePostForm/);
  assert.doesNotMatch(createRoute + updateRoute, /ENVIRONMENT|resolveAdminAuthMode|["']local["']/);
  assert.doesNotMatch(newPost + createRoute + updateRoute, /SLUG_RE|\/\^\[a-z0-9-|\[a-z0-9-\]\+/);
});

test("public detail styles every supported editor element without weakening safe rendering", async () => {
  const detail = await readFile(projectFile("src/pages/blog/[slug].astro"), "utf8");

  assert.match(detail, /getPublishedBlogPost\(env, slug\)/);
  assert.match(detail, /if \(result\.status === 404\)[\s\S]*status: 404/);
  assert.match(detail, /set:html=\{safeBody\}/);
  assert.doesNotMatch(detail, /set:html=\{post\.body\}/);

  for (const selector of [
    "p",
    "h2",
    "h3",
    "strong",
    "em",
    "code",
    "pre",
    "pre code",
    "blockquote",
    "ol",
    "ul",
    "li",
    "a",
    "a:hover",
    "a:focus-visible",
  ]) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      detail,
      new RegExp(`\\.post-body :global\\(${escapedSelector}\\)\\s*\\{`),
      `public prose must style ${selector}`
    );
  }

  assert.match(detail, /\.post-body\s*\{[\s\S]*overflow-wrap:\s*break-word/);
  assert.match(detail, /\.post-body :global\(pre\)\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.match(detail, /\.post-body :global\(pre code\)\s*\{[\s\S]*white-space:\s*pre/);
  assert.match(detail, /@media \(max-width: 480px\)[\s\S]*\.post-body :global\(pre\)/);
});
