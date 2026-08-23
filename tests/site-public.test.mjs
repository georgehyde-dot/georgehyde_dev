/**
 * Public homepage and Words collection contract.
 *
 * @decision DEC-SR-001
 * @title Render curated public content directly through SSR authorities
 * @status accepted
 * @rationale These tests couple the public Astro surfaces to the canonical
 *   BLOG_POSTS helpers and exercise the same stored-data sequence the Worker
 *   renders, while source invariants prohibit legacy/client fallback paths.
 */

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import {
  bootstrapSiteContent,
  createWord,
  getLatestPublishedPostPreview,
  listWords,
  updateFeaturedProject,
  updateHomepageSelection,
} from "../src/lib/site-content.ts";
import { putBlogPost } from "../src/lib/kv-store.ts";

const projectFile = (path) => new URL(`../${path}`, import.meta.url);

function createMemoryKv(pageSize = 2) {
  const records = new Map();
  return {
    async get(key, options) {
      const record = records.get(key);
      if (!record) return null;
      return options?.type === "json" ? JSON.parse(record.value) : record.value;
    },
    async put(key, value, options = {}) {
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
  };
}

function createEnv() {
  return { BLOG_POSTS: createMemoryKv() };
}

function post({ slug, title, body, createdAt, published }) {
  return {
    slug,
    title,
    body,
    author: "George Hyde",
    createdAt,
    updatedAt: createdAt,
    published,
  };
}

test("public source uses SSR canonical reads and escaped text expressions", async () => {
  const [home, words] = await Promise.all([
    readFile(projectFile("src/pages/index.astro"), "utf8"),
    readFile(projectFile("src/pages/words/index.astro"), "utf8"),
  ]);

  for (const source of [home, words]) {
    assert.match(source, /export const prerender = false/);
    assert.match(source, /cloudflare:workers/);
    assert.doesNotMatch(source, /set:html|client:|fetch\s*\(/i);
  }

  assert.match(home, /bootstrapSiteContent\(env\)/);
  assert.match(home, /getLatestPublishedPostPreview\(env\)/);
  assert.match(home, /selectedWords\.map\(\(word, index\)/);
  assert.match(home, /\{word\.text\}/);
  assert.match(home, /\{word\.attribution\}/);
  assert.match(home, /\{featuredProject\.title\}/);
  assert.match(home, /\{featuredProject\.description\}/);
  assert.match(home, /href=\{featuredProject\.url\}/);
  assert.match(home, /href=\{`\/blog\/\$\{latestPost\.slug\}`\}/);
  assert.match(home, /\{latestPost\.excerpt\}/);
  assert.match(home, /No published posts yet\./);
  assert.match(home, /href="\/words"/);
  assert.match(home, /href="\/blog"/);
  assert.match(home, /href="https:\/\/github\.com\/georgehyde-dot"/);
  assert.match(home, /href="mailto:hello@georgehyde\.dev"/);

  assert.match(words, /await bootstrapSiteContent\(env\)/);
  assert.match(words, /await listWords\(env\)/);
  assert.match(words, /words\.map\(\(word\)/);
  assert.match(words, /\{word\.text\}/);
  assert.match(words, /\{word\.attribution\}/);
  assert.match(words, /href=\{word\.source\}/);
  assert.doesNotMatch(home + words, /TOLKIEN_WORD|INITIAL_FEATURED_PROJECT/);
});

test("canonical public sequence selects configured content and newest published post", async () => {
  const env = createEnv();
  await bootstrapSiteContent(env);
  await createWord(
    env,
    {
      id: "script-like-poem",
      text: "<script>alert('word')</script>\nSecond & final line",
      attribution: "A <Writer> & Friend",
      source: "https://example.com/poem?x=%3Ctag%3E&y=1",
    },
    "2026-08-23T00:00:00.000Z"
  );
  await updateHomepageSelection(env, ["script-like-poem", "tolkien-food-cheer-song"]);
  await updateFeaturedProject(env, {
    title: "Project <One> & Two",
    description: "A very long configured description with <markup> & punctuation.",
    url: "https://example.com/project?x=%3Ctag%3E&y=1",
  });

  await putBlogPost(env, post({
    slug: "older-published",
    title: "Older Published",
    body: "<p>Older body.</p>",
    createdAt: "2026-08-20T00:00:00.000Z",
    published: true,
  }));
  await putBlogPost(env, post({
    slug: "newest-published",
    title: "Newest <Published> & Post",
    body: "<p>First &amp; newest line.</p><p>Second <strong>safe</strong> line.</p>",
    createdAt: "2026-08-22T00:00:00.000Z",
    published: true,
  }));
  await putBlogPost(env, post({
    slug: "newer-draft",
    title: "Newer Draft",
    body: "<p>Must not appear.</p>",
    createdAt: "2026-08-23T00:00:00.000Z",
    published: false,
  }));

  const [content, words, preview] = await Promise.all([
    bootstrapSiteContent(env),
    listWords(env),
    getLatestPublishedPostPreview(env),
  ]);
  assert.deepEqual(content.selectedWords.map(({ id }) => id), [
    "script-like-poem",
    "tolkien-food-cheer-song",
  ]);
  assert.equal(content.state.featuredProject.title, "Project <One> & Two");
  assert.deepEqual(words.map((word) => word.id), [
    "tolkien-food-cheer-song",
    "script-like-poem",
  ]);
  assert.deepEqual(preview, {
    slug: "newest-published",
    title: "Newest <Published> & Post",
    excerpt: "First & newest line. Second safe line.",
  });
});

test("homepage section and configured slide order are exact", async () => {
  const home = await readFile(projectFile("src/pages/index.astro"), "utf8");
  const latest = home.indexOf(">Latest Blog Post<");
  const words = home.indexOf(">Words I Like<");
  const project = home.indexOf(">Featured Project<");
  assert.ok(latest >= 0 && latest < words && words < project);

  assert.match(home, /selectedWords\.map\(\(word, index\)/);
  assert.match(home, /data-word-slide/);
  assert.match(home, /hidden=\{index !== 0\}/);
  assert.match(home, /aria-label="Previous Word"/);
  assert.match(home, /aria-label="Next Word"/);
  assert.match(home, /aria-live="polite"/);
  assert.match(home, /disabled=\{selectedWords\.length === 1\}/);
  assert.doesNotMatch(home, /setInterval|setTimeout|autoplay|auto-rotate/i);
});

test("minimal carousel script wraps both directions and disables one-item controls", async () => {
  const home = await readFile(projectFile("src/pages/index.astro"), "utf8");
  const script = home.match(/<script is:inline>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "inline carousel script must exist");

  const execute = (count) => {
    const slides = Array.from({ length: count }, () => ({ hidden: false }));
    const handlers = {};
    const previous = {
      disabled: false,
      addEventListener(_type, handler) { handlers.previous = handler; },
    };
    const next = {
      disabled: false,
      addEventListener(_type, handler) { handlers.next = handler; },
    };
    const status = { textContent: "" };
    const carousel = {
      querySelectorAll(selector) {
        assert.equal(selector, "[data-word-slide]");
        return slides;
      },
      querySelector(selector) {
        return {
          "[data-word-previous]": previous,
          "[data-word-next]": next,
          "[data-word-status]": status,
        }[selector];
      },
    };
    runInNewContext(script, {
      document: { querySelector: () => carousel },
    });
    return { slides, handlers, previous, next, status };
  };

  const three = execute(3);
  assert.deepEqual(three.slides.map(({ hidden }) => hidden), [false, true, true]);
  assert.equal(three.status.textContent, "Word 1 of 3");
  three.handlers.previous();
  assert.deepEqual(three.slides.map(({ hidden }) => hidden), [true, true, false]);
  assert.equal(three.status.textContent, "Word 3 of 3");
  three.handlers.next();
  assert.deepEqual(three.slides.map(({ hidden }) => hidden), [false, true, true]);

  const one = execute(1);
  assert.equal(one.previous.disabled, true);
  assert.equal(one.next.disabled, true);
  assert.deepEqual(one.slides.map(({ hidden }) => hidden), [false]);
});

test("homepage has a truthful empty-post state through the real preview helper", async () => {
  const env = createEnv();
  await bootstrapSiteContent(env);
  assert.equal(await getLatestPublishedPostPreview(env), null);
});

test("legacy public surfaces are deleted rather than hidden or redirected", async () => {
  const [home, words] = await Promise.all([
    readFile(projectFile("src/pages/index.astro"), "utf8"),
    readFile(projectFile("src/pages/words/index.astro"), "utf8"),
  ]);
  const publicSource = `${home}\n${words}`;

  for (const forbidden of [
    "Work in Progress",
    "Quote of the Day",
    "Current Thoughts",
    "Recent Project",
    "GitHub Activity",
    "api.github",
    "ghchart",
    "contribution",
    "progress-orb",
    "progress-indicator",
    "project-modal",
    "showProjectModal",
    "/progress",
  ]) assert.doesNotMatch(publicSource, new RegExp(forbidden, "i"));

  await assert.rejects(
    access(projectFile("src/pages/progress.astro")),
    (error) => error?.code === "ENOENT"
  );
});

test("public layouts preserve multiline and long content at narrow widths", async () => {
  const [home, words] = await Promise.all([
    readFile(projectFile("src/pages/index.astro"), "utf8"),
    readFile(projectFile("src/pages/words/index.astro"), "utf8"),
  ]);
  for (const source of [home, words]) {
    assert.match(source, /@media \(max-width:/);
    assert.match(source, /overflow-wrap:\s*anywhere/);
    assert.match(source, /white-space:\s*pre-wrap/);
  }
  assert.match(home, /-webkit-line-clamp:\s*3/);
  assert.match(words, /width:\s*min\(/);
  assert.doesNotMatch(home, /localStorage|sessionStorage|indexedDB|document\.cookie|location\.|history\.|fetch\s*\(/);
  assert.doesNotMatch(home, /React|Vue|Svelte|Alpine|Stimulus/);
});
