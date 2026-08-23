/**
 * @decision DEC-SR-002A
 * @title Production-sequence coverage for curated site content state
 * @status accepted
 * @rationale These tests exercise the same BLOG_POSTS operations used by the
 *   later admin and public pages, including pagination, migration recovery,
 *   referential integrity, and the existing public-blog validation path.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FEATURED_PROJECT_KEY,
  HOMEPAGE_SELECTION_KEY,
  INITIAL_FEATURED_PROJECT,
  MIGRATION_KEY,
  TOLKIEN_WORD,
  WORD_PREFIX,
  bootstrapSiteContent,
  createWord,
  deleteWord,
  getFeaturedProject,
  getHomepageContent,
  getHomepageSelection,
  getHomepageState,
  getLatestPublishedPostPreview,
  getWord,
  listWords,
  updateFeaturedProject,
  updateHomepageSelection,
  updateWord,
} from "../src/lib/site-content.ts";
import {
  MAX_PROJECT_DESCRIPTION_LENGTH,
  MAX_WORD_TEXT_LENGTH,
  validateFeaturedProject,
  validateHomepageSelection,
  validateHomepageSelectionSlots,
  validateLegacyHomepageSelection,
  validateSelectedWordIds,
  validateStoredFeaturedProject,
  validateStoredWord,
  validateWordId,
  validateWordInput,
} from "../src/lib/site-validation.ts";
import { putBlogPost } from "../src/lib/kv-store.ts";

const T0 = "2026-08-22T00:00:00.000Z";
const T1 = "2026-08-22T01:00:00.000Z";
const T2 = "2026-08-22T02:00:00.000Z";

function createMemoryKv({ pageSize = 2, failOnceFor = [] } = {}) {
  const records = new Map();
  const failures = new Set(failOnceFor);
  const writes = [];
  const gets = [];
  const lists = [];
  let beforePut = async () => {};

  return {
    async get(key, options) {
      gets.push(key);
      const record = records.get(key);
      if (!record) return null;
      return options?.type === "json" ? JSON.parse(record.value) : record.value;
    },
    async put(key, value, options = {}) {
      writes.push(key);
      if (failures.delete(key)) {
        throw new Error(`injected put failure: ${key}`);
      }
      await beforePut(key);
      records.set(key, { value, metadata: options.metadata });
    },
    async delete(key) {
      records.delete(key);
    },
    async list({ prefix = "", cursor } = {}) {
      lists.push({ prefix, cursor });
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
    gets,
    lists,
    setBeforePut(callback) {
      beforePut = callback;
    },
  };
}

function createEnv(kv = createMemoryKv()) {
  return { BLOG_POSTS: kv };
}

function word(id, createdAt, overrides = {}) {
  return {
    id,
    text: `${id} text`,
    attribution: `${id} author`,
    source: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function wordInput(id, overrides = {}) {
  return {
    id,
    text: `${id} text`,
    attribution: `${id} author`,
    source: null,
    ...overrides,
  };
}

test("site validation owns Word, project, and stored singleton boundaries", () => {
  assert.equal(WORD_PREFIX, "word:");
  assert.match(HOMEPAGE_SELECTION_KEY, /^site:/);
  assert.match(FEATURED_PROJECT_KEY, /^site:/);
  assert.match(MIGRATION_KEY, /^site:/);
  assert.equal(WORD_PREFIX.startsWith("post:"), false);
  assert.equal(HOMEPAGE_SELECTION_KEY.startsWith(WORD_PREFIX), false);
  assert.notEqual(HOMEPAGE_SELECTION_KEY, FEATURED_PROJECT_KEY);

  assert.deepEqual(validateWordId("  a-valid-id-2  "), { ok: true, value: "a-valid-id-2" });
  for (const invalid of ["", "UPPER", "two--hyphens", "-leading", "trailing-", "with space", 3]) {
    assert.equal(validateWordId(invalid).ok, false);
  }

  assert.deepEqual(validateWordInput({
    id: "poem-one",
    text: "  First line\r\nSecond line  ",
    attribution: "  A. Poet  ",
    source: " https://example.com/source ",
  }), {
    ok: true,
    value: {
      id: "poem-one",
      text: "First line\nSecond line",
      attribution: "A. Poet",
      source: "https://example.com/source",
    },
  });
  assert.equal(validateWordInput({ id: "x", text: "", attribution: "A", source: null }).error, "Text is required");
  assert.equal(validateWordInput({ id: "x", text: "x".repeat(MAX_WORD_TEXT_LENGTH + 1), attribution: "A", source: null }).error, "Text is too long");
  assert.equal(validateWordInput({ id: "x", text: "Text", attribution: "", source: null }).error, "Attribution is required");
  assert.equal(validateWordInput({ id: "x", text: "Text", attribution: "A", source: "http://example.com" }).error, "Source must be an absolute HTTPS URL");
  assert.equal(validateWordInput({ id: "x", text: "Text", attribution: "A", source: 42 }).error, "Source must be an absolute HTTPS URL");

  const project = {
    title: " Project ",
    description: " Description ",
    url: " https://github.com/example/project ",
  };
  assert.deepEqual(validateFeaturedProject(project), {
    ok: true,
    value: {
      title: "Project",
      description: "Description",
      url: "https://github.com/example/project",
    },
  });
  assert.equal(validateFeaturedProject({ ...project, description: "x".repeat(MAX_PROJECT_DESCRIPTION_LENGTH + 1) }).error, "Project description is too long");
  assert.equal(validateFeaturedProject({ ...project, url: "/relative" }).error, "Project URL must be an absolute HTTPS URL");

  assert.equal(validateStoredWord({ ...word("valid", T0), createdAt: "yesterday" }).error, "Stored Word has an invalid createdAt");
  assert.deepEqual(validateSelectedWordIds(["one"]), { ok: true, value: ["one"] });
  assert.deepEqual(validateSelectedWordIds(["one", "two", "three", "four", "five"]), {
    ok: true,
    value: ["one", "two", "three", "four", "five"],
  });
  assert.equal(validateSelectedWordIds([]).error, "Select at least one Word");
  assert.equal(validateSelectedWordIds(["one", "two", "three", "four", "five", "six"]).error, "Select no more than five Words");
  assert.equal(validateSelectedWordIds(["one", "one"]).error, "Selected Words must be unique");
  assert.equal(validateSelectedWordIds(["one", "Bad ID"]).error, "Selected Words contain an invalid Word id");
  assert.deepEqual(validateHomepageSelectionSlots(["one", "two", "", "", ""]), {
    ok: true,
    value: ["one", "two"],
  });
  assert.equal(validateHomepageSelectionSlots(["one", "", "three", "", ""]).error, "Homepage Word slots must be contiguous");
  assert.equal(validateHomepageSelectionSlots(["one"]).error, "Homepage selection requires exactly five slots");
  assert.equal(validateHomepageSelection({ selectedWordIds: ["valid"], updatedAt: T0 }).ok, true);
  assert.equal(validateHomepageSelection({ selectedWordIds: ["missing"], updatedAt: "now" }).error, "Stored homepage selection has an invalid updatedAt");
  assert.equal(validateHomepageSelection({ selectedWordId: "legacy", updatedAt: T0 }).ok, false);
  assert.equal(validateLegacyHomepageSelection({ selectedWordId: "legacy", updatedAt: T0 }).ok, true);
  assert.equal(validateStoredFeaturedProject({ ...project, updatedAt: T0 }).ok, true);
  assert.equal(validateStoredFeaturedProject({ ...project, updatedAt: "now" }).error, "Stored featured project has an invalid updatedAt");
});

test("Words list paginates every word: key and orders createdAt then id deterministically", async () => {
  const kv = createMemoryKv({ pageSize: 1 });
  const env = createEnv(kv);
  await kv.put("unrelated:key", "ignored");
  await createWord(env, wordInput("z-later-id"), T1);
  await createWord(env, wordInput("a-later-id"), T1);
  await createWord(env, wordInput("oldest"), T0);

  assert.deepEqual((await listWords(env)).map(({ id }) => id), [
    "oldest",
    "a-later-id",
    "z-later-id",
  ]);
  assert.equal(await getWord(env, "absent"), null);
});

test("real bootstrap to CRUD sequence preserves independent selection and project state", async () => {
  const kv = createMemoryKv({ pageSize: 1 });
  const env = createEnv(kv);

  const initial = await bootstrapSiteContent(env);
  assert.deepEqual(initial.selectedWords, [TOLKIEN_WORD]);
  assert.deepEqual(initial.state.featuredProject, {
    ...INITIAL_FEATURED_PROJECT,
    updatedAt: T0,
  });
  assert.equal(kv.records.has("word:tolkien-food-cheer-song"), true);
  assert.equal(kv.records.has(HOMEPAGE_SELECTION_KEY), true);
  assert.equal(kv.records.has(FEATURED_PROJECT_KEY), true);
  assert.equal(kv.records.has(["site", "homepage", "v1"].join(":")), false);
  assert.equal(kv.records.has(MIGRATION_KEY), true);
  assert.equal(kv.writes.at(-1), MIGRATION_KEY);
  assert.deepEqual(JSON.parse(kv.records.get(MIGRATION_KEY).value), { version: 2 });
  assert.deepEqual((await listWords(env)).map(({ id }) => id), [TOLKIEN_WORD.id]);

  await updateWord(env, TOLKIEN_WORD.id, {
    text: `${TOLKIEN_WORD.text}\nA retained second line.`,
    attribution: TOLKIEN_WORD.attribution,
    source: "https://www.tolkienestate.com/",
  }, T1);
  const editedTolkien = await getWord(env, TOLKIEN_WORD.id);
  assert.equal(editedTolkien.createdAt, TOLKIEN_WORD.createdAt);
  assert.equal(editedTolkien.updatedAt, T1);
  const newProject = {
    title: "A different project",
    description: "A field-scoped project update.",
    url: "https://github.com/georgehyde-dot/another-project",
  };
  await updateFeaturedProject(env, newProject, T1);
  assert.deepEqual((await getHomepageSelection(env)).selectedWordIds, [TOLKIEN_WORD.id]);

  await assert.rejects(() => deleteWord(env, TOLKIEN_WORD.id), (error) => error.code === "selected_word");

  await createWord(env, {
    id: "another-word",
    text: "Another line",
    attribution: "Another writer",
    source: null,
  }, T1);
  await updateHomepageSelection(env, ["another-word", TOLKIEN_WORD.id], T2);
  assert.deepEqual(await getFeaturedProject(env), { ...newProject, updatedAt: T1 });
  await assert.rejects(() => deleteWord(env, TOLKIEN_WORD.id), (error) => error.code === "selected_word");
  await updateHomepageSelection(env, ["another-word"], T2);
  await deleteWord(env, TOLKIEN_WORD.id);
  assert.equal(await getWord(env, TOLKIEN_WORD.id), null);
  assert.deepEqual((await getHomepageContent(env)).selectedWords.map(({ id }) => id), ["another-word"]);
  await assert.rejects(() => deleteWord(env, TOLKIEN_WORD.id), (error) => error.code === "not_found");

  await assert.rejects(() => updateHomepageSelection(env, ["does-not-exist"], T2), (error) => error.code === "not_found");
});

test("ordered selection reads one to five Words directly and rejects every invalid state", async () => {
  const kv = createMemoryKv({ pageSize: 1 });
  const env = createEnv(kv);
  await bootstrapSiteContent(env);
  for (let index = 1; index <= 5; index += 1) {
    await createWord(env, wordInput(`chosen-${index}`), `2026-08-22T0${index}:00:00.000Z`);
  }
  const selectedWordIds = ["chosen-5", TOLKIEN_WORD.id, "chosen-2", "chosen-4", "chosen-1"];
  await updateHomepageSelection(env, selectedWordIds, T2);

  kv.gets.length = 0;
  kv.lists.length = 0;
  const content = await getHomepageContent(env);
  assert.deepEqual(content.selectedWords.map(({ id }) => id), selectedWordIds);
  assert.equal(kv.lists.length, 0);
  assert.deepEqual(kv.gets, [
    HOMEPAGE_SELECTION_KEY,
    FEATURED_PROJECT_KEY,
    ...selectedWordIds.map((id) => `${WORD_PREFIX}${id}`),
  ]);

  for (const invalid of [
    [],
    ["chosen-1", "chosen-1"],
    ["chosen-1", "Bad ID"],
    ["chosen-1", "chosen-2", "chosen-3", "chosen-4", "chosen-5", TOLKIEN_WORD.id],
    ["does-not-exist"],
  ]) {
    const writesBefore = kv.writes.length;
    await assert.rejects(() => updateHomepageSelection(env, invalid, T2));
    assert.equal(kv.writes.length, writesBefore);
  }

  for (const selected of selectedWordIds) {
    await assert.rejects(() => deleteWord(env, selected), (error) => error.code === "selected_word");
  }

  const corruptSelections = [
    { selectedWordId: "chosen-1", updatedAt: T2 },
    { updatedAt: T2 },
    { selectedWordIds: [], updatedAt: T2 },
    { selectedWordIds: ["chosen-1", "chosen-1"], updatedAt: T2 },
    { selectedWordIds: ["chosen-1", "chosen-2", "chosen-3", "chosen-4", "chosen-5", TOLKIEN_WORD.id], updatedAt: T2 },
    { selectedWordIds: ["Bad ID"], updatedAt: T2 },
    { selectedWordIds: ["chosen-1"], updatedAt: "invalid" },
  ];
  for (const corrupt of corruptSelections) {
    await kv.put(HOMEPAGE_SELECTION_KEY, JSON.stringify(corrupt));
    await assert.rejects(() => bootstrapSiteContent(env), (error) => error.code === "integrity");
  }
  await kv.put(HOMEPAGE_SELECTION_KEY, JSON.stringify({
    selectedWordIds: ["dangling-word"],
    updatedAt: T2,
  }));
  await assert.rejects(() => bootstrapSiteContent(env), (error) => error.code === "integrity");
});

test("legacy selection upgrades in place and advances the existing marker to v2 last", async () => {
  const kv = createMemoryKv();
  const env = createEnv(kv);
  await kv.put(`${WORD_PREFIX}${TOLKIEN_WORD.id}`, JSON.stringify(TOLKIEN_WORD));
  await kv.put(HOMEPAGE_SELECTION_KEY, JSON.stringify({
    selectedWordId: TOLKIEN_WORD.id,
    updatedAt: T1,
  }));
  await kv.put(FEATURED_PROJECT_KEY, JSON.stringify({
    ...INITIAL_FEATURED_PROJECT,
    updatedAt: T1,
  }));
  await kv.put(MIGRATION_KEY, JSON.stringify({ version: 1 }));
  const writesBefore = kv.writes.length;

  let failMarkerOnce = true;
  kv.setBeforePut(async (key) => {
    if (key === MIGRATION_KEY && failMarkerOnce) {
      failMarkerOnce = false;
      throw new Error("injected v2 marker failure");
    }
  });
  await assert.rejects(() => bootstrapSiteContent(env), /injected v2 marker failure/);
  assert.deepEqual(JSON.parse(kv.records.get(HOMEPAGE_SELECTION_KEY).value), {
    selectedWordIds: [TOLKIEN_WORD.id],
    updatedAt: T1,
  });
  assert.deepEqual(JSON.parse(kv.records.get(MIGRATION_KEY).value), { version: 1 });

  const content = await bootstrapSiteContent(env);
  assert.deepEqual(content.selectedWords.map(({ id }) => id), [TOLKIEN_WORD.id]);
  assert.deepEqual(JSON.parse(kv.records.get(MIGRATION_KEY).value), { version: 2 });
  assert.equal(kv.writes.at(-1), MIGRATION_KEY);
  const writesAfterUpgrade = kv.writes.length;
  await bootstrapSiteContent(env);
  assert.equal(kv.writes.length, writesAfterUpgrade);
  assert.deepEqual(kv.writes.slice(writesBefore), [
    HOMEPAGE_SELECTION_KEY,
    MIGRATION_KEY,
    MIGRATION_KEY,
  ]);
});

test("concurrent selection and project writes persist independently under forced interleaving", async () => {
  const kv = createMemoryKv();
  const env = createEnv(kv);
  await bootstrapSiteContent(env);
  await createWord(env, wordInput("concurrent-selection"), T1);

  let arrivals = 0;
  let release;
  const bothWritesArrived = new Promise((resolve) => {
    release = resolve;
  });
  kv.setBeforePut(async (key) => {
    if (key !== HOMEPAGE_SELECTION_KEY && key !== FEATURED_PROJECT_KEY) return;
    arrivals += 1;
    if (arrivals === 2) release();
    await bothWritesArrived;
  });

  const concurrentProject = {
    title: "Concurrent project",
    description: "This write must survive the selection write.",
    url: "https://example.com/concurrent-project",
  };
  await Promise.all([
    updateHomepageSelection(env, ["concurrent-selection", TOLKIEN_WORD.id], T1),
    updateFeaturedProject(env, concurrentProject, T2),
  ]);

  const state = await getHomepageState(env);
  assert.deepEqual(state.selection, {
    selectedWordIds: ["concurrent-selection", TOLKIEN_WORD.id],
    updatedAt: T1,
  });
  assert.deepEqual(state.featuredProject, {
    ...concurrentProject,
    updatedAt: T2,
  });
  assert.equal(arrivals, 2);
  assert.equal(kv.writes.filter((key) => key === HOMEPAGE_SELECTION_KEY).length, 2);
  assert.equal(kv.writes.filter((key) => key === FEATURED_PROJECT_KEY).length, 2);
});

test("bootstrap retries partial writes, never overwrites present values, and marks last", async () => {
  for (const failingKey of [
    `word:${TOLKIEN_WORD.id}`,
    HOMEPAGE_SELECTION_KEY,
    FEATURED_PROJECT_KEY,
    MIGRATION_KEY,
  ]) {
    const kv = createMemoryKv({ failOnceFor: [failingKey] });
    const env = createEnv(kv);
    await assert.rejects(() => bootstrapSiteContent(env), new RegExp(failingKey));
    await bootstrapSiteContent(env);

    assert.equal(kv.writes.at(-1), MIGRATION_KEY);
    assert.equal(kv.records.has(`word:${TOLKIEN_WORD.id}`), true);
    assert.equal(kv.records.has(HOMEPAGE_SELECTION_KEY), true);
    assert.equal(kv.records.has(FEATURED_PROJECT_KEY), true);
    assert.equal(kv.records.has(["site", "homepage", "v1"].join(":")), false);
    assert.equal(kv.records.has(MIGRATION_KEY), true);
    for (const seedKey of [
      `word:${TOLKIEN_WORD.id}`,
      HOMEPAGE_SELECTION_KEY,
      FEATURED_PROJECT_KEY,
    ]) {
      assert.equal(
        kv.writes.filter((key) => key === seedKey).length,
        failingKey === seedKey ? 2 : 1
      );
    }
  }

  const kv = createMemoryKv();
  const env = createEnv(kv);
  const editedWord = word(TOLKIEN_WORD.id, T0, { text: "Admin-edited Tolkien text" });
  const editedProject = {
    title: "Already configured",
    description: "Do not replace me.",
    url: "https://example.com/project",
  };
  await kv.put(`word:${editedWord.id}`, JSON.stringify(editedWord));
  await kv.put(HOMEPAGE_SELECTION_KEY, JSON.stringify({
    selectedWordIds: [editedWord.id],
    updatedAt: T1,
  }));
  await kv.put(FEATURED_PROJECT_KEY, JSON.stringify({ ...editedProject, updatedAt: T1 }));
  const writesBefore = kv.writes.length;
  const content = await bootstrapSiteContent(env);
  assert.equal(content.selectedWords[0].text, editedWord.text);
  assert.deepEqual(content.state.featuredProject, { ...editedProject, updatedAt: T1 });
  assert.deepEqual(kv.writes.slice(writesBefore), [MIGRATION_KEY]);
});

test("bootstrap adds a missing deterministic seed without replacing custom selection", async () => {
  const kv = createMemoryKv();
  const env = createEnv(kv);
  const customWord = word("custom-selection", T0, { text: "Keep this selected" });
  const customProject = {
    title: "Custom project",
    description: "Configured before bootstrap.",
    url: "https://example.com/custom-project",
  };
  await kv.put(`word:${customWord.id}`, JSON.stringify(customWord));
  await kv.put(HOMEPAGE_SELECTION_KEY, JSON.stringify({
    selectedWordIds: [customWord.id],
    updatedAt: T1,
  }));
  await kv.put(FEATURED_PROJECT_KEY, JSON.stringify({ ...customProject, updatedAt: T1 }));

  const content = await bootstrapSiteContent(env);
  assert.equal(content.selectedWords[0].id, customWord.id);
  assert.deepEqual(content.state.featuredProject, { ...customProject, updatedAt: T1 });
  assert.deepEqual((await listWords(env)).map(({ id }) => id), [
    customWord.id,
    TOLKIEN_WORD.id,
  ]);
  assert.deepEqual(kv.writes.slice(-2), [
    `word:${TOLKIEN_WORD.id}`,
    MIGRATION_KEY,
  ]);
});

test("migration marker prevents fallback and reseeding after content deletion", async () => {
  const kv = createMemoryKv();
  const env = createEnv(kv);
  await bootstrapSiteContent(env);
  await kv.delete(`word:${TOLKIEN_WORD.id}`);

  await assert.rejects(() => bootstrapSiteContent(env), (error) => error.code === "integrity");
  assert.equal(kv.records.has(`word:${TOLKIEN_WORD.id}`), false);
  assert.equal(kv.writes.filter((key) => key === `word:${TOLKIEN_WORD.id}`).length, 1);

  await kv.delete(HOMEPAGE_SELECTION_KEY);
  await assert.rejects(() => bootstrapSiteContent(env), (error) => error.code === "integrity");
  assert.equal(kv.records.has(HOMEPAGE_SELECTION_KEY), false);

  const projectKv = createMemoryKv();
  const projectEnv = createEnv(projectKv);
  await bootstrapSiteContent(projectEnv);
  await projectKv.delete(FEATURED_PROJECT_KEY);
  await assert.rejects(() => bootstrapSiteContent(projectEnv), (error) => error.code === "integrity");
  assert.equal(projectKv.records.has(FEATURED_PROJECT_KEY), false);
});

test("latest preview follows real post storage and public validation with deterministic ordering", async () => {
  const env = createEnv();
  assert.equal(await getLatestPublishedPostPreview(env), null);

  await putBlogPost(env, {
    slug: "older",
    title: "Older",
    body: "<p>Older body</p>",
    author: "George Hyde",
    createdAt: T0,
    updatedAt: T2,
    published: true,
  });
  await putBlogPost(env, {
    slug: "z-tied",
    title: "Z tied",
    body: "<p>Wrong tie winner</p>",
    author: "George Hyde",
    createdAt: T1,
    updatedAt: T1,
    published: true,
  });
  await putBlogPost(env, {
    slug: "a-tied",
    title: "A tied",
    body: "<p>Fish &amp; chips.</p><blockquote><strong>Second</strong> line.</blockquote><p>Emoji 🙂 stay intact.</p>",
    author: "George Hyde",
    createdAt: T1,
    updatedAt: T1,
    published: true,
  });
  await putBlogPost(env, {
    slug: "new-draft",
    title: "Draft",
    body: "<p>Draft</p>",
    author: "George Hyde",
    createdAt: T2,
    updatedAt: T2,
    published: false,
  });

  assert.deepEqual(await getLatestPublishedPostPreview(env), {
    slug: "a-tied",
    title: "A tied",
    excerpt: "Fish & chips. Second line. Emoji 🙂 stay intact.",
  });
});

test("excerpt decoding preserves entity and inline punctuation while separating semantic blocks", async () => {
  const env = createEnv();
  await putBlogPost(env, {
    slug: "spacing",
    title: "Spacing",
    body: "<p>AT&amp;T says &quot;hello&quot;; 2 &lt; 3.</p><p>Hello <strong>world</strong>.</p><blockquote>Next block.</blockquote>",
    author: "George Hyde",
    createdAt: T1,
    updatedAt: T1,
    published: true,
  });

  const preview = await getLatestPublishedPostPreview(env);
  assert.equal(
    preview.excerpt,
    'AT&T says "hello"; 2 < 3. Hello world. Next block.'
  );
  assert.doesNotMatch(preview.excerpt, /\s[.;,!?]/u);
});

test("latest preview caps Unicode code points at a word boundary and fails on invalid newest HTML", async () => {
  const env = createEnv();
  const longBody = `<p>${"word ".repeat(80)}🙂 tail</p>`;
  await putBlogPost(env, {
    slug: "valid",
    title: "Valid",
    body: longBody,
    author: "George Hyde",
    createdAt: T0,
    updatedAt: T0,
    published: true,
  });
  const preview = await getLatestPublishedPostPreview(env);
  assert.ok([...preview.excerpt].length <= 240);
  assert.match(preview.excerpt, /word…$/);
  assert.doesNotMatch(preview.excerpt, /\ud83d$/);

  await putBlogPost(env, {
    slug: "invalid-newest",
    title: "Invalid newest",
    body: "<script>alert(1)</script>",
    author: "George Hyde",
    createdAt: T2,
    updatedAt: T2,
    published: true,
  });
  await assert.rejects(
    () => getLatestPublishedPostPreview(env),
    (error) => error.code === "invalid_latest_post" && /invalid-newest/.test(error.message)
  );
});
