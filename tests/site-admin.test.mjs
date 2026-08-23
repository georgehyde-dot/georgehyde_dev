/**
 * @decision DEC-SR-005A
 * @title Exercise secure admin mutations through independent content helpers
 * @status accepted
 * @rationale Handler-level production sequences prove authorization happens
 *   before bootstrap, HTML forms retain PRG behavior, and selection/project
 *   requests cannot replace one another's independently stored state.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  FEATURED_PROJECT_KEY,
  HOMEPAGE_SELECTION_KEY,
  TOLKIEN_WORD,
  bootstrapSiteContent,
  createWord,
  getFeaturedProject,
  getHomepageSelection,
  getHomepageState,
  getWord,
  listWords,
} from "../src/lib/site-content.ts";
import {
  MAX_ATTRIBUTION_LENGTH,
  MAX_PROJECT_DESCRIPTION_LENGTH,
  MAX_PROJECT_TITLE_LENGTH,
  MAX_PROJECT_URL_LENGTH,
  MAX_SOURCE_URL_LENGTH,
  MAX_WORD_TEXT_LENGTH,
} from "../src/lib/site-validation.ts";
import {
  ALL as rejectCreateWordMethod,
  POST as createWordRoute,
} from "../src/pages/admin/api/words/index.ts";
import {
  ALL as rejectMutateWordMethod,
  POST as mutateWordRoute,
} from "../src/pages/admin/api/words/[id].ts";
import {
  ALL as rejectHomepageMethod,
  POST as mutateHomepageRoute,
} from "../src/pages/admin/api/homepage.ts";

const T0 = "2026-08-23T00:00:00.000Z";

function createMemoryKv(pageSize = 2) {
  const records = new Map();
  const writes = [];
  let beforePut = async () => {};

  return {
    async get(key, options) {
      const record = records.get(key);
      if (!record) return null;
      return options?.type === "json" ? JSON.parse(record.value) : record.value;
    },
    async put(key, value, options = {}) {
      writes.push(key);
      await beforePut(key);
      records.set(key, { value, metadata: options.metadata });
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
      const page = keys.slice(start, start + pageSize);
      const next = start + pageSize;
      return {
        keys: page,
        list_complete: next >= keys.length,
        cursor: next >= keys.length ? undefined : String(next),
      };
    },
    records,
    writes,
    setBeforePut(callback) {
      beforePut = callback;
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

function formRequest(entries, { origin = "https://georgehyde.dev" } = {}) {
  const form = new FormData();
  for (const [key, value] of entries) form.append(key, value);
  return new Request("https://georgehyde.dev/admin/api/content", {
    method: "POST",
    headers: origin === null ? undefined : { Origin: origin },
    body: form,
  });
}

function malformedRequest() {
  return new Request("https://georgehyde.dev/admin/api/content", {
    method: "POST",
    headers: {
      Origin: "https://georgehyde.dev",
      "Content-Type": "multipart/form-data; boundary=broken",
    },
    body: "not multipart form data",
  });
}

function apiContext({ env, request, id, userId = "user_owner" }) {
  return {
    params: id ? { id } : {},
    request,
    locals: {
      runtime: { env },
      auth: () => ({ userId, sessionId: userId ? "sess_test" : null }),
    },
    redirect(location, status) {
      return new Response(null, { status, headers: { Location: location } });
    },
  };
}

function localEnv() {
  return createEnv({
    ENVIRONMENT: "local",
    LOCAL_AUTH_BYPASS: "true",
    ADMIN_OWNER_USER_ID: "",
  });
}

function snapshot(env) {
  return JSON.stringify(
    [...env.BLOG_POSTS.records.entries()].map(([key, record]) => [key, record])
  );
}

const poemFields = [
  ["id", "a-small-poem"],
  ["text", "First line\nSecond line"],
  ["attribution", "A. Poet"],
  ["source", "https://example.com/poem"],
];

function selectionFields(ids) {
  const slots = ids.length <= 5
    ? [...ids, ...Array.from({ length: 5 - ids.length }, () => "")]
    : ids;
  return [
    ["_action", "selection"],
    ...slots.map((id) => ["selectedWordIds", id]),
  ];
}

test("exact local mode completes real Words CRUD, selection, and independent project sequence", async () => {
  const env = localEnv();

  const created = await createWordRoute(apiContext({
    env,
    userId: null,
    request: formRequest(poemFields, { origin: null }),
  }));
  assert.equal(created.status, 303);
  assert.equal(created.headers.get("Location"), "/admin/words");
  assert.equal((await getWord(env, "a-small-poem")).text, "First line\nSecond line");

  const updated = await mutateWordRoute(apiContext({
    env,
    id: "a-small-poem",
    userId: null,
    request: formRequest([
      ["text", "Edited first line\nEdited second line"],
      ["attribution", "A. Poet"],
      ["source", ""],
    ], { origin: null }),
  }));
  assert.equal(updated.status, 303);
  assert.equal(updated.headers.get("Location"), "/admin/words");
  assert.equal((await getWord(env, "a-small-poem")).text, "Edited first line\nEdited second line");

  const selected = await mutateHomepageRoute(apiContext({
    env,
    userId: null,
    request: formRequest(selectionFields(["a-small-poem", TOLKIEN_WORD.id]), { origin: null }),
  }));
  assert.equal(selected.status, 303);
  assert.equal(selected.headers.get("Location"), "/admin/words");
  assert.deepEqual((await getHomepageSelection(env)).selectedWordIds, ["a-small-poem", TOLKIEN_WORD.id]);

  const projectBefore = await getFeaturedProject(env);
  const projectUpdated = await mutateHomepageRoute(apiContext({
    env,
    userId: null,
    request: formRequest([
      ["_action", "project"],
      ["title", "A configured project"],
      ["description", "Saved independently from selection."],
      ["url", "https://github.com/georgehyde-dot/configured"],
    ], { origin: null }),
  }));
  assert.equal(projectUpdated.status, 303);
  assert.equal(projectUpdated.headers.get("Location"), "/admin/homepage");
  assert.deepEqual((await getHomepageSelection(env)).selectedWordIds, ["a-small-poem", TOLKIEN_WORD.id]);
  assert.notDeepEqual(await getFeaturedProject(env), projectBefore);

  const beforeRejectedDelete = snapshot(env);
  const rejectedDelete = await mutateWordRoute(apiContext({
    env,
    id: "a-small-poem",
    userId: null,
    request: formRequest([["_method", "delete"]], { origin: null }),
  }));
  assert.equal(rejectedDelete.status, 409);
  assert.equal(snapshot(env), beforeRejectedDelete);

  const reselected = await mutateHomepageRoute(apiContext({
    env,
    userId: null,
    request: formRequest(selectionFields([TOLKIEN_WORD.id]), { origin: null }),
  }));
  assert.equal(reselected.status, 303);

  const deleted = await mutateWordRoute(apiContext({
    env,
    id: "a-small-poem",
    userId: null,
    request: formRequest([["_method", "delete"]], { origin: null }),
  }));
  assert.equal(deleted.status, 303);
  assert.equal(deleted.headers.get("Location"), "/admin/words");
  assert.equal(await getWord(env, "a-small-poem"), null);
  assert.deepEqual((await listWords(env)).map(({ id }) => id), [TOLKIEN_WORD.id]);
});

test("ordered five-slot handler persists one to five selections and rejects forged state", async () => {
  const env = localEnv();
  await bootstrapSiteContent(env);
  for (let index = 1; index <= 5; index += 1) {
    await createWord(env, {
      id: `slot-word-${index}`,
      text: `Slot ${index}`,
      attribution: "Tester",
      source: null,
    }, `2026-08-23T0${index}:00:00.000Z`);
  }

  const one = await mutateHomepageRoute(apiContext({
    env,
    userId: null,
    request: formRequest(selectionFields(["slot-word-3"]), { origin: null }),
  }));
  assert.equal(one.status, 303);
  assert.deepEqual((await getHomepageSelection(env)).selectedWordIds, ["slot-word-3"]);

  const orderedFive = ["slot-word-5", TOLKIEN_WORD.id, "slot-word-2", "slot-word-4", "slot-word-1"];
  const five = await mutateHomepageRoute(apiContext({
    env,
    userId: null,
    request: formRequest(selectionFields(orderedFive), { origin: null }),
  }));
  assert.equal(five.status, 303);
  assert.equal(five.headers.get("Location"), "/admin/words");
  assert.deepEqual((await getHomepageSelection(env)).selectedWordIds, orderedFive);

  for (const [ids, expectedStatus] of [
    [[], 400],
    [["slot-word-1", "slot-word-1"], 400],
    [["slot-word-1", "slot-word-2", "slot-word-3", "slot-word-4", "slot-word-5", TOLKIEN_WORD.id], 400],
    [["missing-word"], 404],
  ]) {
    const before = snapshot(env);
    const response = await mutateHomepageRoute(apiContext({
      env,
      userId: null,
      request: formRequest(selectionFields(ids), { origin: null }),
    }));
    assert.equal(response.status, expectedStatus);
    assert.equal(snapshot(env), before);
  }

  const beforeMissingSlots = snapshot(env);
  const missingSlots = await mutateHomepageRoute(apiContext({
    env,
    userId: null,
    request: formRequest([["_action", "selection"]], { origin: null }),
  }));
  assert.equal(missingSlots.status, 400);
  assert.equal(snapshot(env), beforeMissingSlots);
});

test("actual homepage handlers preserve concurrent independent updates", async () => {
  const env = localEnv();
  await bootstrapSiteContent(env);
  await createWord(env, {
    id: "concurrent-word",
    text: "Concurrent selection",
    attribution: "Tester",
    source: null,
  }, T0);

  let arrivals = 0;
  let release;
  const bothArrived = new Promise((resolve) => { release = resolve; });
  env.BLOG_POSTS.setBeforePut(async (key) => {
    if (key !== HOMEPAGE_SELECTION_KEY && key !== FEATURED_PROJECT_KEY) return;
    arrivals += 1;
    if (arrivals === 2) release();
    await bothArrived;
  });
  const writesBefore = env.BLOG_POSTS.writes.length;

  await Promise.all([
    mutateHomepageRoute(apiContext({
      env,
      userId: null,
      request: formRequest(selectionFields(["concurrent-word", TOLKIEN_WORD.id]), { origin: null }),
    })),
    mutateHomepageRoute(apiContext({
      env,
      userId: null,
      request: formRequest([
        ["_action", "project"],
        ["title", "Concurrent project"],
        ["description", "Both writes survive."],
        ["url", "https://example.com/concurrent"],
      ], { origin: null }),
    })),
  ]);

  assert.deepEqual(env.BLOG_POSTS.writes.slice(writesBefore).sort(), [
    FEATURED_PROJECT_KEY,
    HOMEPAGE_SELECTION_KEY,
  ].sort());
  const state = await getHomepageState(env);
  assert.deepEqual(state.selection.selectedWordIds, ["concurrent-word", TOLKIEN_WORD.id]);
  assert.equal(state.featuredProject.title, "Concurrent project");
});

test("validation, conflicts, missing records, and malformed forms never mutate content", async () => {
  for (const entries of [
    [["id", "Bad ID"], ["text", "Text"], ["attribution", "Author"]],
    [["id", "too-long"], ["text", "x".repeat(MAX_WORD_TEXT_LENGTH + 1)], ["attribution", "Author"]],
    [["id", "no-author"], ["text", "Text"], ["attribution", ""]],
    [["id", "long-author"], ["text", "Text"], ["attribution", "x".repeat(MAX_ATTRIBUTION_LENGTH + 1)]],
    [["id", "bad-source"], ["text", "Text"], ["attribution", "Author"], ["source", "http://example.com"]],
    [["id", "long-source"], ["text", "Text"], ["attribution", "Author"], ["source", `https://example.com/${"x".repeat(MAX_SOURCE_URL_LENGTH)}`]],
  ]) {
    const env = localEnv();
    const before = snapshot(env);
    const response = await createWordRoute(apiContext({
      env,
      userId: null,
      request: formRequest(entries, { origin: null }),
    }));
    assert.equal(response.status, 400);
    assert.equal(snapshot(env), before);
  }

  const duplicateEnv = localEnv();
  await createWordRoute(apiContext({
    env: duplicateEnv,
    userId: null,
    request: formRequest(poemFields, { origin: null }),
  }));
  const duplicateBefore = snapshot(duplicateEnv);
  const duplicate = await createWordRoute(apiContext({
    env: duplicateEnv,
    userId: null,
    request: formRequest(poemFields, { origin: null }),
  }));
  assert.equal(duplicate.status, 409);
  assert.equal(snapshot(duplicateEnv), duplicateBefore);

  const invalidUpdateBefore = snapshot(duplicateEnv);
  const invalidUpdate = await mutateWordRoute(apiContext({
    env: duplicateEnv,
    id: "a-small-poem",
    userId: null,
    request: formRequest([
      ["text", "Changed"],
      ["attribution", "A. Poet"],
      ["source", "http://example.com"],
    ], { origin: null }),
  }));
  assert.equal(invalidUpdate.status, 400);
  assert.equal(snapshot(duplicateEnv), invalidUpdateBefore);

  for (const operation of [
    () => mutateWordRoute(apiContext({
      env: duplicateEnv,
      id: "missing-word",
      userId: null,
      request: formRequest([["text", "Text"], ["attribution", "Author"]], { origin: null }),
    })),
    () => mutateWordRoute(apiContext({
      env: duplicateEnv,
      id: "missing-word",
      userId: null,
      request: formRequest([["_method", "delete"]], { origin: null }),
    })),
    () => mutateHomepageRoute(apiContext({
      env: duplicateEnv,
      userId: null,
      request: formRequest(selectionFields(["missing-word"]), { origin: null }),
    })),
  ]) {
    const before = snapshot(duplicateEnv);
    const response = await operation();
    assert.equal(response.status, 404);
    assert.equal(snapshot(duplicateEnv), before);
  }

  for (const projectFields of [
    [["title", "Project"], ["description", "Description"], ["url", "http://example.com"]],
    [["title", "x".repeat(MAX_PROJECT_TITLE_LENGTH + 1)], ["description", "Description"], ["url", "https://example.com"]],
    [["title", "Project"], ["description", "x".repeat(MAX_PROJECT_DESCRIPTION_LENGTH + 1)], ["url", "https://example.com"]],
    [["title", "Project"], ["description", "Description"], ["url", `https://example.com/${"x".repeat(MAX_PROJECT_URL_LENGTH)}`]],
  ]) {
    const before = snapshot(duplicateEnv);
    const response = await mutateHomepageRoute(apiContext({
      env: duplicateEnv,
      userId: null,
      request: formRequest([["_action", "project"], ...projectFields], { origin: null }),
    }));
    assert.equal(response.status, 400);
    assert.equal(snapshot(duplicateEnv), before);
  }

  const malformedEnv = createEnv();
  const malformedBefore = snapshot(malformedEnv);
  const malformed = await createWordRoute(apiContext({
    env: malformedEnv,
    request: malformedRequest(),
  }));
  assert.equal(malformed.status, 400);
  assert.equal(snapshot(malformedEnv), malformedBefore);
});

test("every mutation class enforces production owner and Origin before state changes", async () => {
  const operationFactories = [
    (env, userId, origin) => createWordRoute(apiContext({
      env,
      userId,
      request: formRequest([
        ["id", "new-denied-word"],
        ["text", "Denied"],
        ["attribution", "Tester"],
      ], { origin }),
    })),
    (env, userId, origin) => mutateWordRoute(apiContext({
      env,
      id: "existing-word",
      userId,
      request: formRequest([["text", "Changed"], ["attribution", "Tester"]], { origin }),
    })),
    (env, userId, origin) => mutateWordRoute(apiContext({
      env,
      id: "existing-word",
      userId,
      request: formRequest([["_method", "delete"]], { origin }),
    })),
    (env, userId, origin) => mutateHomepageRoute(apiContext({
      env,
      userId,
      request: formRequest(selectionFields(["existing-word"]), { origin }),
    })),
    (env, userId, origin) => mutateHomepageRoute(apiContext({
      env,
      userId,
      request: formRequest([
        ["_action", "project"],
        ["title", "Denied project"],
        ["description", "Denied"],
        ["url", "https://example.com/denied"],
      ], { origin }),
    })),
  ];
  const denialCases = [
    { userId: null, origin: "https://georgehyde.dev", status: 401 },
    { userId: "user_other", origin: "https://georgehyde.dev", status: 403 },
    { userId: "user_owner", origin: null, status: 403 },
    { userId: "user_owner", origin: "https://evil.example", status: 403 },
  ];

  for (const operation of operationFactories) {
    for (const denial of denialCases) {
      const env = createEnv();
      await bootstrapSiteContent(env);
      await createWord(env, {
        id: "existing-word",
        text: "Existing",
        attribution: "Tester",
        source: null,
      }, T0);
      const before = snapshot(env);
      const response = await operation(env, denial.userId, denial.origin);
      assert.equal(response.status, denial.status);
      assert.equal(snapshot(env), before);
    }

    const missingOwnerEnv = createEnv({ ADMIN_OWNER_USER_ID: "" });
    await bootstrapSiteContent(missingOwnerEnv);
    await createWord(missingOwnerEnv, {
      id: "existing-word",
      text: "Existing",
      attribution: "Tester",
      source: null,
    }, T0);
    const before = snapshot(missingOwnerEnv);
    const response = await operation(
      missingOwnerEnv,
      "user_owner",
      "https://georgehyde.dev"
    );
    assert.equal(response.status, 403);
    assert.equal(snapshot(missingOwnerEnv), before);
  }
});

test("admin APIs reject unsupported HTTP methods with exact Allow headers", () => {
  for (const response of [
    rejectCreateWordMethod(),
    rejectMutateWordMethod(),
    rejectHomepageMethod(),
  ]) {
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "POST");
    assert.equal(response.headers.get("Location"), null);
  }
});

test("admin source surfaces use canonical helpers, SSR forms, and clear navigation", async () => {
  const paths = [
    "src/pages/admin/index.astro",
    "src/pages/admin/words/index.astro",
    "src/pages/admin/words/new.astro",
    "src/pages/admin/words/[id]/edit.astro",
    "src/pages/admin/homepage.astro",
    "src/pages/admin/api/words/index.ts",
    "src/pages/admin/api/words/[id].ts",
    "src/pages/admin/api/homepage.ts",
  ];
  const sources = Object.fromEntries(await Promise.all(paths.map(async (path) => [
    path,
    await readFile(new URL(`../${path}`, import.meta.url), "utf8"),
  ])));

  const adminHome = sources["src/pages/admin/index.astro"];
  for (const href of ["/admin/posts", "/admin/words", "/admin/homepage", "/"]) {
    assert.match(adminHome, new RegExp(`href=["']${href}["']`));
  }

  for (const path of paths.filter((path) => path.endsWith(".astro"))) {
    assert.match(sources[path], /export const prerender = false/);
    assert.doesNotMatch(sources[path], /localStorage|sessionStorage|fetch\s*\(/);
  }

  for (const path of paths.filter((path) => path.endsWith(".ts"))) {
    const source = sources[path];
    assert.match(source, /authorizeMutationOrigin/);
    assert.match(source, /authorizeAdminOwner/);
    assert.match(source, /bootstrapSiteContent/);
    assert.doesNotMatch(source, /BLOG_POSTS\s*\.|["'`]word:|["'`]site:/);
    assert.doesNotMatch(source, /hostname|localStorage|sessionStorage|fetch\s*\(/);
    assert.doesNotMatch(source, /\^\[a-z|new RegExp|URL_PATTERN|ID_PATTERN/);
  }

  assert.match(sources["src/pages/admin/api/words/index.ts"], /createWord/);
  assert.match(sources["src/pages/admin/api/words/[id].ts"], /updateWord/);
  assert.match(sources["src/pages/admin/api/words/[id].ts"], /deleteWord/);
  assert.match(sources["src/pages/admin/api/homepage.ts"], /updateHomepageSelection/);
  assert.match(sources["src/pages/admin/api/homepage.ts"], /updateFeaturedProject/);
  assert.doesNotMatch(sources["src/pages/admin/api/homepage.ts"], /getHomepageState/);
  assert.match(sources["src/pages/admin/api/homepage.ts"], /getAll\("selectedWordIds"\)/);
  assert.match(sources["src/pages/admin/homepage.astro"], /Array\.from\(\{ length: 5 \}/);
  assert.match(sources["src/pages/admin/homepage.astro"], /name="selectedWordIds"/);
  assert.match(sources["src/pages/admin/words/index.astro"], /Homepage position/);
});
