/**
 * @decision DEC-SCV2-004
 * @title Exercise v3 content through production BLOG_POSTS sequences
 * @status accepted
 * @rationale These tests cross validation, migration, collection CRUD,
 *   referential selection, bounded homepage reads, and public blog rendering.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FEATURED_PROJECT_KEY, HOMEPAGE_PROJECT_SELECTION_KEY, HOMEPAGE_SELECTION_KEY,
  INITIAL_FEATURED_PROJECT, MIGRATION_KEY, PROJECT_PREFIX, TOLKIEN_WORD, WORD_PREFIX,
  bootstrapSiteContent, createProject, createWord, deleteProject, deleteWord,
  getHomepageContent, getHomepageProjectSelection, getLatestPublishedPostPreview,
  getProject, getWord, listProjects, listWords, updateHomepageProjectSelection,
  updateHomepageSelection, updateProject, updateWord,
} from "../src/lib/site-content.ts";
import {
  MAX_WORD_TITLE_LENGTH, validateHomepageProjectSelection,
  validateHomepageProjectSelectionSlots, validateHomepageSelectionSlots,
  validateProjectInput, validateSelectedProjectIds, validateSelectedWordIds,
  validateStoredProject, validateStoredWord, validateWordInput,
} from "../src/lib/site-validation.ts";
import { putBlogPost } from "../src/lib/kv-store.ts";

const T0 = "2026-08-22T00:00:00.000Z";
const T1 = "2026-08-22T01:00:00.000Z";
const T2 = "2026-08-22T02:00:00.000Z";

function memoryKv({ pageSize = 2, failOnceFor = [] } = {}) {
  const records = new Map();
  const failures = new Set(failOnceFor);
  const writes = []; const gets = []; const lists = []; const deletes = [];
  let beforePut = async () => {};
  return {
    async get(key, options) { gets.push(key); const record = records.get(key); if (!record) return null; return options?.type === "json" ? JSON.parse(record.value) : record.value; },
    async put(key, value, options = {}) { writes.push(key); if (failures.delete(key)) throw new Error(`injected put failure: ${key}`); await beforePut(key); records.set(key, { value, metadata: options.metadata }); },
    async delete(key) { deletes.push(key); records.delete(key); },
    async list({ prefix = "", cursor } = {}) {
      lists.push({ prefix, cursor });
      const start = cursor ? Number(cursor) : 0;
      const keys = [...records.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b)).map(([name, record]) => ({ name, metadata: record.metadata }));
      const page = keys.slice(start, start + pageSize); const next = start + pageSize;
      return { keys: page, list_complete: next >= keys.length, cursor: next >= keys.length ? undefined : String(next) };
    },
    records, writes, gets, lists, deletes,
    setBeforePut(callback) { beforePut = callback; },
  };
}
const envFor = (kv = memoryKv()) => ({ BLOG_POSTS: kv });
const wordInput = (id, extra = {}) => ({ id, title: `${id} title`, text: `${id} text`, attribution: `${id} author`, source: null, ...extra });
const projectInput = (id, extra = {}) => ({ id, title: `${id} title`, description: `${id} description`, url: `https://example.com/${id}`, ...extra });

test("Word and Project validation is strict at code-point, line, URL, timestamp, and selection boundaries", () => {
  assert.equal(validateWordInput(wordInput("named-word")).ok, true);
  assert.equal(validateWordInput(wordInput("named-word", { title: "" })).error, "Title is required");
  assert.equal(validateWordInput(wordInput("named-word", { title: "one\ntwo" })).error, "Title must be a single line");
  assert.equal(validateWordInput(wordInput("named-word", { title: "😀".repeat(MAX_WORD_TITLE_LENGTH) })).ok, true);
  assert.equal(validateWordInput(wordInput("named-word", { title: "😀".repeat(MAX_WORD_TITLE_LENGTH + 1) })).error, "Title is too long");
  assert.equal(validateStoredWord({ ...wordInput("x"), createdAt: T0, updatedAt: T1 }).ok, true);
  assert.equal(validateStoredWord({ ...wordInput("x"), createdAt: "now", updatedAt: T1 }).ok, false);

  const project = projectInput("project-one", { description: "First\nSecond" });
  assert.deepEqual(validateProjectInput(project), { ok: true, value: project });
  assert.equal(validateProjectInput({ ...project, id: "Bad ID" }).ok, false);
  assert.equal(validateProjectInput({ ...project, title: "one\ntwo" }).error, "Project title must be a single line");
  assert.equal(validateProjectInput({ ...project, url: "http://example.com" }).error, "Project URL must be an absolute HTTPS URL");
  assert.equal(validateStoredProject({ ...project, createdAt: T0, updatedAt: T1 }).ok, true);

  for (const [validate, noun] of [[validateSelectedWordIds, "Words"], [validateSelectedProjectIds, "Projects"]]) {
    assert.equal(validate([]).error, `Select at least one ${noun.slice(0, -1)}`);
    assert.equal(validate(["one"]).ok, true);
    assert.equal(validate(["one", "two", "three", "four", "five"]).ok, true);
    assert.equal(validate(["one", "two", "three", "four", "five", "six"]).ok, false);
    assert.equal(validate(["one", "one"]).ok, false);
    assert.equal(validate(["Bad ID"]).ok, false);
  }
  assert.deepEqual(validateHomepageSelectionSlots(["one", "two", "", "", ""]), { ok: true, value: ["one", "two"] });
  assert.equal(validateHomepageSelectionSlots(["one", "", "three", "", ""]).ok, false);
  assert.deepEqual(validateHomepageProjectSelectionSlots(["one", "", "", "", ""]), { ok: true, value: ["one"] });
  assert.equal(validateHomepageProjectSelection({ selectedProjectIds: ["one"], updatedAt: T0 }).ok, true);
});

test("fresh bootstrap creates titled Tolkien and collected Project, removes singleton authority, and marks v3 last", async () => {
  const kv = memoryKv({ pageSize: 1 }); const env = envFor(kv);
  const content = await bootstrapSiteContent(env);
  assert.deepEqual(content.selectedWords, [TOLKIEN_WORD]);
  assert.equal(content.selectedProjects[0].id, "featured-project");
  assert.deepEqual(({ title: content.selectedProjects[0].title, description: content.selectedProjects[0].description, url: content.selectedProjects[0].url }), INITIAL_FEATURED_PROJECT);
  assert.equal(kv.records.has(FEATURED_PROJECT_KEY), false);
  assert.equal(kv.records.has(`${PROJECT_PREFIX}featured-project`), true);
  assert.equal(kv.records.has(HOMEPAGE_PROJECT_SELECTION_KEY), true);
  assert.deepEqual(JSON.parse(kv.records.get(MIGRATION_KEY).value), { version: 3 });
  assert.equal(kv.writes.at(-1), MIGRATION_KEY);
  const writes = kv.writes.length; await bootstrapSiteContent(env); assert.equal(kv.writes.length, writes);
});

test("fresh bootstrap retries each ordered write without overwriting completed seed state", async () => {
  for (const key of [`${WORD_PREFIX}${TOLKIEN_WORD.id}`, HOMEPAGE_SELECTION_KEY, `${PROJECT_PREFIX}featured-project`, HOMEPAGE_PROJECT_SELECTION_KEY, MIGRATION_KEY]) {
    const kv = memoryKv({ failOnceFor: [key] }); const env = envFor(kv);
    await assert.rejects(() => bootstrapSiteContent(env), new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await bootstrapSiteContent(env);
    assert.deepEqual(JSON.parse(kv.records.get(MIGRATION_KEY).value), { version: 3 });
    assert.equal(kv.writes.at(-1), MIGRATION_KEY);
  }
});

test("legacy v2 migration titles all Words once, preserves singleton Project, deletes it after verification, and retries marker last", async () => {
  const kv = memoryKv({ pageSize: 1 }); const env = envFor(kv);
  const legacyTolkien = { ...TOLKIEN_WORD }; delete legacyTolkien.title;
  const legacyPoem = { id: "legacy-poem", text: "\n  The First Line  \nSecond", attribution: "Poet", source: null, createdAt: T0, updatedAt: T1 };
  await kv.put(`${WORD_PREFIX}${legacyTolkien.id}`, JSON.stringify(legacyTolkien));
  await kv.put(`${WORD_PREFIX}${legacyPoem.id}`, JSON.stringify(legacyPoem));
  await kv.put(HOMEPAGE_SELECTION_KEY, JSON.stringify({ selectedWordId: legacyPoem.id, updatedAt: T1 }));
  await kv.put(FEATURED_PROJECT_KEY, JSON.stringify({ ...INITIAL_FEATURED_PROJECT, updatedAt: T1 }));
  await kv.put(MIGRATION_KEY, JSON.stringify({ version: 2 }));
  let failMarker = true;
  kv.setBeforePut(async (key) => { if (key === MIGRATION_KEY && failMarker) { failMarker = false; throw new Error("marker failure"); } });
  await assert.rejects(() => bootstrapSiteContent(env), /marker failure/);
  assert.equal((await getWord(env, TOLKIEN_WORD.id)).title, "A Merrier World");
  assert.equal((await getWord(env, legacyPoem.id)).title, "The First Line");
  assert.equal(kv.records.has(FEATURED_PROJECT_KEY), false);
  const content = await bootstrapSiteContent(env);
  assert.deepEqual(content.selectedWords.map(({ id }) => id), [legacyPoem.id]);
  assert.equal(content.selectedProjects[0].updatedAt, T1);
  assert.deepEqual(JSON.parse(kv.records.get(MIGRATION_KEY).value), { version: 3 });
  assert.equal(kv.writes.at(-1), MIGRATION_KEY);
});

test("migration rejects corrupt titles, Project collisions, dangling selection, and never overwrites existing state", async () => {
  const collision = memoryKv(); const env = envFor(collision);
  await collision.put(`${WORD_PREFIX}${TOLKIEN_WORD.id}`, JSON.stringify(TOLKIEN_WORD));
  await collision.put(HOMEPAGE_SELECTION_KEY, JSON.stringify({ selectedWordIds: [TOLKIEN_WORD.id], updatedAt: T0 }));
  await collision.put(FEATURED_PROJECT_KEY, JSON.stringify({ ...INITIAL_FEATURED_PROJECT, updatedAt: T0 }));
  await collision.put(`${PROJECT_PREFIX}featured-project`, JSON.stringify({ ...projectInput("featured-project", { title: "Collision" }), createdAt: T0, updatedAt: T0 }));
  await collision.put(MIGRATION_KEY, JSON.stringify({ version: 2 }));
  await assert.rejects(() => bootstrapSiteContent(env), (error) => error.code === "integrity" && /collision/.test(error.message));
  assert.equal((await getProject(env, "featured-project")).title, "Collision");

  const corrupt = memoryKv(); const corruptEnv = envFor(corrupt);
  await corrupt.put(`${WORD_PREFIX}bad`, JSON.stringify({ ...wordInput("bad", { title: "bad\nline" }), createdAt: T0, updatedAt: T0 }));
  await corrupt.put(HOMEPAGE_SELECTION_KEY, JSON.stringify({ selectedWordIds: ["bad"], updatedAt: T0 }));
  await corrupt.put(FEATURED_PROJECT_KEY, JSON.stringify({ ...INITIAL_FEATURED_PROJECT, updatedAt: T0 }));
  await corrupt.put(MIGRATION_KEY, JSON.stringify({ version: 2 }));
  await assert.rejects(() => bootstrapSiteContent(corruptEnv), (error) => error.code === "integrity");

  const dangling = memoryKv(); const danglingEnv = envFor(dangling);
  await bootstrapSiteContent(danglingEnv);
  await dangling.put(HOMEPAGE_PROJECT_SELECTION_KEY, JSON.stringify({ selectedProjectIds: ["missing"], updatedAt: T2 }));
  await assert.rejects(() => bootstrapSiteContent(danglingEnv), (error) => error.code === "integrity");
});

test("paginated collection CRUD preserves order, immutable ids, and selected deletion conflicts", async () => {
  const kv = memoryKv({ pageSize: 1 }); const env = envFor(kv); await bootstrapSiteContent(env);
  await createWord(env, wordInput("z-word"), T1); await createWord(env, wordInput("a-word"), T1);
  await createProject(env, projectInput("z-project"), T1); await createProject(env, projectInput("a-project"), T1);
  assert.deepEqual((await listWords(env)).map(({ id }) => id), [TOLKIEN_WORD.id, "a-word", "z-word"]);
  assert.deepEqual((await listProjects(env)).map(({ id }) => id), ["featured-project", "a-project", "z-project"]);
  const updatedWord = await updateWord(env, "a-word", { title: "Updated Word", text: "Line 1\nLine 2", attribution: "Writer", source: null }, T2);
  const updatedProject = await updateProject(env, "a-project", { title: "Updated Project", description: "Line 1\nLine 2", url: "https://example.com/new" }, T2);
  assert.equal(updatedWord.id, "a-word"); assert.equal(updatedWord.createdAt, T1); assert.equal(updatedProject.id, "a-project"); assert.equal(updatedProject.createdAt, T1);
  await updateHomepageSelection(env, ["a-word"], T2); await updateHomepageProjectSelection(env, ["a-project"], T2);
  await assert.rejects(() => deleteWord(env, "a-word"), (error) => error.code === "selected_word");
  await assert.rejects(() => deleteProject(env, "a-project"), (error) => error.code === "selected_project");
  await updateHomepageSelection(env, [TOLKIEN_WORD.id], T2); await updateHomepageProjectSelection(env, ["featured-project"], T2);
  await deleteWord(env, "a-word"); await deleteProject(env, "a-project");
  assert.equal(await getWord(env, "a-word"), null); assert.equal(await getProject(env, "a-project"), null);
});

test("homepage loads only ordered selected ids by bounded direct reads and invalid writes perform zero mutation", async () => {
  const kv = memoryKv(); const env = envFor(kv); await bootstrapSiteContent(env);
  for (let i = 1; i <= 6; i += 1) { await createWord(env, wordInput(`word-${i}`), T1); await createProject(env, projectInput(`project-${i}`), T1); }
  const words = ["word-5", TOLKIEN_WORD.id, "word-2", "word-4", "word-1"];
  const projects = ["project-5", "featured-project", "project-2", "project-4", "project-1"];
  await updateHomepageSelection(env, words, T2); await updateHomepageProjectSelection(env, projects, T2);
  kv.gets.length = 0; kv.lists.length = 0;
  const content = await getHomepageContent(env);
  assert.deepEqual(content.selectedWords.map(({ id }) => id), words);
  assert.deepEqual(content.selectedProjects.map(({ id }) => id), projects);
  assert.equal(kv.lists.length, 0);
  assert.equal(kv.gets.filter((key) => key.startsWith(WORD_PREFIX)).length, 5);
  assert.equal(kv.gets.filter((key) => key.startsWith(PROJECT_PREFIX)).length, 5);
  for (const [update, invalids] of [
    [updateHomepageSelection, [[], ["word-1", "word-1"], ["word-1", "word-2", "word-3", "word-4", "word-5", "word-6"], ["missing"]]],
    [updateHomepageProjectSelection, [[], ["project-1", "project-1"], ["project-1", "project-2", "project-3", "project-4", "project-5", "project-6"], ["missing"]]],
  ]) for (const invalid of invalids) { const before = kv.writes.length; await assert.rejects(() => update(env, invalid, T2)); assert.equal(kv.writes.length, before); }
});

test("forced concurrent Word and Project selection writes remain independent", async () => {
  const kv = memoryKv(); const env = envFor(kv); await bootstrapSiteContent(env);
  await createWord(env, wordInput("concurrent-word"), T1); await createProject(env, projectInput("concurrent-project"), T1);
  let arrivals = 0; let release; const both = new Promise((resolve) => { release = resolve; });
  kv.setBeforePut(async (key) => { if (![HOMEPAGE_SELECTION_KEY, HOMEPAGE_PROJECT_SELECTION_KEY].includes(key)) return; arrivals += 1; if (arrivals === 2) release(); await both; });
  await Promise.all([updateHomepageSelection(env, ["concurrent-word"], T1), updateHomepageProjectSelection(env, ["concurrent-project"], T2)]);
  assert.deepEqual((await getHomepageContent(env)).selectedWords.map(({ id }) => id), ["concurrent-word"]);
  assert.deepEqual((await getHomepageProjectSelection(env)).selectedProjectIds, ["concurrent-project"]);
  assert.equal(arrivals, 2);
});

test("v3 marker prevents runtime fallback or reseeding after selected content deletion", async () => {
  const kv = memoryKv(); const env = envFor(kv); await bootstrapSiteContent(env);
  await kv.delete(`${WORD_PREFIX}${TOLKIEN_WORD.id}`);
  await assert.rejects(() => bootstrapSiteContent(env), (error) => error.code === "integrity");
  assert.equal(kv.records.has(`${WORD_PREFIX}${TOLKIEN_WORD.id}`), false);
  const projectKv = memoryKv(); const projectEnv = envFor(projectKv); await bootstrapSiteContent(projectEnv);
  await projectKv.delete(`${PROJECT_PREFIX}featured-project`);
  await assert.rejects(() => bootstrapSiteContent(projectEnv), (error) => error.code === "integrity");
  assert.equal(projectKv.records.has(`${PROJECT_PREFIX}featured-project`), false);
});

test("latest preview uses newest published real post, parser-decoded plain text, and fails loudly on invalid newest", async () => {
  const env = envFor(); assert.equal(await getLatestPublishedPostPreview(env), null);
  await putBlogPost(env, { slug: "older", title: "Older", body: "<p>Older</p>", author: "George Hyde", createdAt: T0, updatedAt: T2, published: true });
  await putBlogPost(env, { slug: "a-new", title: "New", body: "<p>AT&amp;T says &quot;hello&quot;.</p><p>Hello <strong>world</strong>.</p><blockquote>Next block.</blockquote>", author: "George Hyde", createdAt: T1, updatedAt: T1, published: true });
  await putBlogPost(env, { slug: "draft", title: "Draft", body: "<p>Draft</p>", author: "George Hyde", createdAt: T2, updatedAt: T2, published: false });
  assert.deepEqual(await getLatestPublishedPostPreview(env), { slug: "a-new", title: "New", excerpt: 'AT&T says "hello". Hello world. Next block.' });
  await putBlogPost(env, { slug: "invalid", title: "Invalid", body: "<script>alert(1)</script>", author: "George Hyde", createdAt: T2, updatedAt: T2, published: true });
  await assert.rejects(() => getLatestPublishedPostPreview(env), (error) => error.code === "invalid_latest_post" && /invalid/.test(error.message));
});

test("latest preview truncates at a Unicode word boundary", async () => {
  const env = envFor(); await putBlogPost(env, { slug: "long", title: "Long", body: `<p>${"word ".repeat(80)}🙂 tail</p>`, author: "George Hyde", createdAt: T0, updatedAt: T0, published: true });
  const preview = await getLatestPublishedPostPreview(env);
  assert.ok([...preview.excerpt].length <= 240); assert.match(preview.excerpt, /word…$/); assert.doesNotMatch(preview.excerpt, /\ud83d$/);
});
