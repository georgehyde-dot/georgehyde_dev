import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  validateCreatePostForm,
  validateRouteSlug,
  validateUpdatePostForm,
} from "../src/lib/blog-validation.ts";
import { authorizeAdminOwner } from "../src/lib/admin-auth.ts";
import { validateStoredHtml } from "../src/lib/html-policy.ts";
import {
  deleteBlogPost,
  getBlogPost,
  listAllPosts,
  listPublishedPosts,
} from "../src/lib/kv-store.ts";
import { getPublishedBlogPost } from "../src/lib/public-blog.ts";
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

test("owner authorization denies production fallback and non-owner users", () => {
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
    authorizeAdminOwner("user_any", createEnv({ ADMIN_OWNER_USER_ID: "", ENVIRONMENT: "local" })),
    {
      ok: true,
      reason: "local_clerk_fallback",
    }
  );
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
  const [packageJson, wrangler, astroConfig, home, progress, detail, editor, newPost, createRoute, updateRoute] =
    await Promise.all([
      readFile(projectFile("package.json"), "utf8"),
      readFile(projectFile("wrangler.toml"), "utf8"),
      readFile(projectFile("astro.config.mjs"), "utf8"),
      readFile(projectFile("src/pages/index.astro"), "utf8"),
      readFile(projectFile("src/pages/progress.astro"), "utf8"),
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
  assert.match(astroConfig, /adapter: cloudflare\(\)/);

  assert.match(home, /export const prerender = true/);
  assert.match(home, /href="\/blog"/);
  assert.match(progress, /export const prerender = true/);
  assert.doesNotMatch(progress, /console\.log/);
  assert.doesNotMatch(home + progress, /LinkedIn/i);

  assert.doesNotMatch(detail, /set:html=\{post\.body\}/);
  assert.match(detail, /safeBody/);
  assert.match(editor, /type="hidden" id="body" name="body"/);
  assert.match(createRoute, /validateCreatePostForm/);
  assert.match(updateRoute, /validateUpdatePostForm/);
  assert.doesNotMatch(newPost + createRoute + updateRoute, /SLUG_RE|\/\^\[a-z0-9-|\[a-z0-9-\]\+/);
});
