/**
 * Canonical content authority for titled Words, collected Projects, and the
 * bounded homepage selections stored in BLOG_POSTS.
 *
 * @decision DEC-SCV2-002
 * @title Store Projects as records with an independent ordered selection
 * @status accepted
 * @rationale Project records and their homepage selection use project: keys and
 *   one site selection key. Word and Project mutations therefore never share a
 *   read-modify-write authority, and homepage reads can remain bounded.
 *
 * @decision DEC-SCV2-003
 * @title Upgrade legacy content under a marker-last v3 migration
 * @status accepted
 * @rationale Missing Word titles are materialized once, the featured singleton
 *   is verified into a deterministic Project record and selection, then removed.
 *   The v3 marker is written only after all referents validate, making retries
 *   idempotent without a runtime fallback or a second authority.
 *
 * @decision DEC-SR-004A
 * @title Preserve inline text and add spacing only at semantic block boundaries
 * @status accepted
 * @rationale sanitize-html parser callbacks decode entities and identify block
 *   boundaries. Concatenating inline text exactly avoids punctuation corruption.
 */

import sanitizeHtml from "sanitize-html";
import { getPublishedBlogPost } from "./public-blog.ts";
import { listPublishedPosts, type Env } from "./kv-store.ts";
import {
  validateFeaturedProject,
  validateHomepageProjectSelection,
  validateHomepageSelection,
  validateLegacyHomepageSelection,
  validateProjectId,
  validateProjectInput,
  validateSelectedProjectIds,
  validateSelectedWordIds,
  validateStoredFeaturedProject,
  validateStoredProject,
  validateStoredWord,
  validateWordId,
  validateWordInput,
  type FeaturedProject,
  type HomepageProjectSelection,
  type HomepageSelection,
  type ProjectInput,
  type StoredProject,
  type StoredWord,
  type WordInput,
} from "./site-validation.ts";

export type WordEntry = StoredWord;
export type ProjectEntry = StoredProject;
export type { FeaturedProject, HomepageProjectSelection, HomepageSelection, ProjectInput, WordInput };

export const WORD_PREFIX = "word:";
export const PROJECT_PREFIX = "project:";
export const HOMEPAGE_SELECTION_KEY = "site:homepage-selection:v1";
export const HOMEPAGE_PROJECT_SELECTION_KEY = "site:homepage-project-selection:v1";
/** Migration input only. No public/admin read uses this singleton. */
export const FEATURED_PROJECT_KEY = "site:featured-project:v1";
export const MIGRATION_KEY = "site:migration:homepage-v1";
export const MAX_POST_EXCERPT_CODE_POINTS = 240;

const SEED_TIMESTAMP = "2026-08-22T00:00:00.000Z";
const FEATURED_PROJECT_ID = "featured-project";

export const TOLKIEN_WORD: WordEntry = Object.freeze({
  id: "tolkien-food-cheer-song",
  title: "A Merrier World",
  text: "If more of us valued food and cheer and song above hoarded gold, it would be a merrier world.",
  attribution: "J.R.R. Tolkien",
  source: null,
  createdAt: SEED_TIMESTAMP,
  updatedAt: SEED_TIMESTAMP,
});

export const INITIAL_FEATURED_PROJECT: FeaturedProject = Object.freeze({
  title: "Dynamic Pathfinding in Rust",
  description: "This was a school project for my master's that I really enjoyed. I wrote my own D*Lite implementation in Rust, and used it in a randomly generated maze. The basic idea was that some pathfinding algorithms do better in dynamic environments that change. A* is the defacto option for static pathfinding, so I compared against that with my implementation of D*Lite. I also built a full test suite around the project with some various tuning and data analysis. All in all, a fun experience that confirmed how much I enjoy Rust.",
  url: "https://github.com/georgehyde-dot/dynamic_pathfinding",
});

export const INITIAL_PROJECT: ProjectEntry = Object.freeze({
  id: FEATURED_PROJECT_ID,
  ...INITIAL_FEATURED_PROJECT,
  createdAt: SEED_TIMESTAMP,
  updatedAt: SEED_TIMESTAMP,
});

const INITIAL_WORD_SELECTION: HomepageSelection = Object.freeze({
  selectedWordIds: [TOLKIEN_WORD.id],
  updatedAt: SEED_TIMESTAMP,
});
const INITIAL_PROJECT_SELECTION: HomepageProjectSelection = Object.freeze({
  selectedProjectIds: [FEATURED_PROJECT_ID],
  updatedAt: SEED_TIMESTAMP,
});

export interface HomepageState {
  wordSelection: HomepageSelection;
  projectSelection: HomepageProjectSelection;
}
export interface HomepageContent {
  state: HomepageState;
  selectedWords: WordEntry[];
  selectedProjects: ProjectEntry[];
}
export interface LatestPostPreview { slug: string; title: string; excerpt: string }

export type SiteContentErrorCode =
  | "duplicate" | "integrity" | "invalid_latest_post" | "not_found"
  | "selected_word" | "selected_project" | "validation";

export class SiteContentError extends Error {
  readonly code: SiteContentErrorCode;
  constructor(code: SiteContentErrorCode, message: string) {
    super(message);
    this.name = "SiteContentError";
    this.code = code;
  }
}

export async function getWord(env: Env, id: unknown): Promise<WordEntry | null> {
  const wordId = requireWordId(id);
  const value = await env.BLOG_POSTS.get(wordKey(wordId), { type: "json" });
  return value === null ? null : requireStoredWord(value, wordId);
}

export async function listWords(env: Env): Promise<WordEntry[]> {
  return listEntries(env, WORD_PREFIX, getWord);
}

export async function createWord(env: Env, input: WordInput, now = new Date().toISOString()): Promise<WordEntry> {
  const validated = validateWordInput(input);
  if (!validated.ok) throw validationError(validated.error);
  if (await getWord(env, validated.value.id)) throw new SiteContentError("duplicate", `A Word with id "${validated.value.id}" already exists`);
  const word = requireStoredWord({ ...validated.value, createdAt: now, updatedAt: now }, validated.value.id, "validation");
  await putWord(env, word);
  return word;
}

export async function updateWord(env: Env, id: unknown, input: Omit<WordInput, "id">, updatedAt = new Date().toISOString()): Promise<WordEntry> {
  const wordId = requireWordId(id);
  const existing = await getWord(env, wordId);
  if (!existing) throw new SiteContentError("not_found", `Word not found: ${wordId}`);
  const validated = validateWordInput({ ...input, id: wordId });
  if (!validated.ok) throw validationError(validated.error);
  const word = requireStoredWord({ ...validated.value, createdAt: existing.createdAt, updatedAt }, wordId, "validation");
  await putWord(env, word);
  return word;
}

export async function deleteWord(env: Env, id: unknown): Promise<void> {
  const wordId = requireWordId(id);
  const selection = await getHomepageSelection(env);
  if (!selection && (await env.BLOG_POSTS.get(MIGRATION_KEY)) !== null) throw new SiteContentError("integrity", "Homepage Word selection is missing");
  if (selection?.selectedWordIds.includes(wordId)) throw new SiteContentError("selected_word", "Deselect this Word before deleting it");
  if (!(await getWord(env, wordId))) throw new SiteContentError("not_found", `Word not found: ${wordId}`);
  await env.BLOG_POSTS.delete(wordKey(wordId));
}

export async function getProject(env: Env, id: unknown): Promise<ProjectEntry | null> {
  const projectId = requireProjectId(id);
  const value = await env.BLOG_POSTS.get(projectKey(projectId), { type: "json" });
  return value === null ? null : requireStoredProject(value, projectId);
}

export async function listProjects(env: Env): Promise<ProjectEntry[]> {
  return listEntries(env, PROJECT_PREFIX, getProject);
}

export async function createProject(env: Env, input: ProjectInput, now = new Date().toISOString()): Promise<ProjectEntry> {
  const validated = validateProjectInput(input);
  if (!validated.ok) throw validationError(validated.error);
  if (await getProject(env, validated.value.id)) throw new SiteContentError("duplicate", `A Project with id "${validated.value.id}" already exists`);
  const project = requireStoredProject({ ...validated.value, createdAt: now, updatedAt: now }, validated.value.id, "validation");
  await putProject(env, project);
  return project;
}

export async function updateProject(env: Env, id: unknown, input: Omit<ProjectInput, "id">, updatedAt = new Date().toISOString()): Promise<ProjectEntry> {
  const projectId = requireProjectId(id);
  const existing = await getProject(env, projectId);
  if (!existing) throw new SiteContentError("not_found", `Project not found: ${projectId}`);
  const validated = validateProjectInput({ ...input, id: projectId });
  if (!validated.ok) throw validationError(validated.error);
  const project = requireStoredProject({ ...validated.value, createdAt: existing.createdAt, updatedAt }, projectId, "validation");
  await putProject(env, project);
  return project;
}

export async function deleteProject(env: Env, id: unknown): Promise<void> {
  const projectId = requireProjectId(id);
  const selection = await getHomepageProjectSelection(env);
  if (!selection && (await env.BLOG_POSTS.get(MIGRATION_KEY)) !== null) throw new SiteContentError("integrity", "Homepage Project selection is missing");
  if (selection?.selectedProjectIds.includes(projectId)) throw new SiteContentError("selected_project", "Deselect this Project before deleting it");
  if (!(await getProject(env, projectId))) throw new SiteContentError("not_found", `Project not found: ${projectId}`);
  await env.BLOG_POSTS.delete(projectKey(projectId));
}

export async function getHomepageSelection(env: Env): Promise<HomepageSelection | null> {
  const value = await env.BLOG_POSTS.get(HOMEPAGE_SELECTION_KEY, { type: "json" });
  if (value === null) return null;
  const validated = validateHomepageSelection(value);
  if (!validated.ok) throw new SiteContentError("integrity", validated.error);
  return validated.value;
}

export async function getHomepageProjectSelection(env: Env): Promise<HomepageProjectSelection | null> {
  const value = await env.BLOG_POSTS.get(HOMEPAGE_PROJECT_SELECTION_KEY, { type: "json" });
  if (value === null) return null;
  const validated = validateHomepageProjectSelection(value);
  if (!validated.ok) throw new SiteContentError("integrity", validated.error);
  return validated.value;
}

export async function getHomepageState(env: Env): Promise<HomepageState> {
  const [wordSelection, projectSelection] = await Promise.all([getHomepageSelection(env), getHomepageProjectSelection(env)]);
  if (!wordSelection) throw new SiteContentError("integrity", "Homepage Word selection is missing");
  if (!projectSelection) throw new SiteContentError("integrity", "Homepage Project selection is missing");
  return { wordSelection, projectSelection };
}

export async function getHomepageContent(env: Env): Promise<HomepageContent> {
  const state = await getHomepageState(env);
  const [selectedWords, selectedProjects] = await Promise.all([
    Promise.all(state.wordSelection.selectedWordIds.map(async (id) => {
      const word = await getWord(env, id);
      if (!word) throw new SiteContentError("integrity", `Selected Word is missing: ${id}`);
      return word;
    })),
    Promise.all(state.projectSelection.selectedProjectIds.map(async (id) => {
      const project = await getProject(env, id);
      if (!project) throw new SiteContentError("integrity", `Selected Project is missing: ${id}`);
      return project;
    })),
  ]);
  return { state, selectedWords, selectedProjects };
}

export async function updateHomepageSelection(env: Env, selectedWordIds: unknown, updatedAt = new Date().toISOString()): Promise<HomepageSelection> {
  const selected = validateSelectedWordIds(selectedWordIds);
  if (!selected.ok) throw validationError(selected.error);
  for (const id of selected.value) if (!(await getWord(env, id))) throw new SiteContentError("not_found", `Word not found: ${id}`);
  return writeWordSelection(env, { selectedWordIds: selected.value, updatedAt });
}

export async function updateHomepageProjectSelection(env: Env, selectedProjectIds: unknown, updatedAt = new Date().toISOString()): Promise<HomepageProjectSelection> {
  const selected = validateSelectedProjectIds(selectedProjectIds);
  if (!selected.ok) throw validationError(selected.error);
  for (const id of selected.value) if (!(await getProject(env, id))) throw new SiteContentError("not_found", `Project not found: ${id}`);
  return writeProjectSelection(env, { selectedProjectIds: selected.value, updatedAt });
}

/** Marker-last and non-overwriting except for the one-time legacy schema rewrite. */
export async function bootstrapSiteContent(env: Env): Promise<HomepageContent> {
  const version = await getMigrationVersion(env);
  if (version === 3) {
    if ((await env.BLOG_POSTS.get(FEATURED_PROJECT_KEY)) !== null) throw new SiteContentError("integrity", "Legacy featured Project singleton remains after v3 migration");
    return getHomepageContent(env);
  }
  await ensureWordSeedAndSelection(env, version);
  await migrateWordTitles(env);
  await migrateProjects(env, version);
  const content = await getHomepageContent(env);
  await env.BLOG_POSTS.put(MIGRATION_KEY, JSON.stringify({ version: 3 }));
  return content;
}

async function ensureWordSeedAndSelection(env: Env, version: 0 | 1 | 2): Promise<void> {
  if (version === 0 && (await env.BLOG_POSTS.get(wordKey(TOLKIEN_WORD.id))) === null) await putWord(env, TOLKIEN_WORD);
  const stored = await env.BLOG_POSTS.get(HOMEPAGE_SELECTION_KEY, { type: "json" });
  if (stored === null) {
    if (version !== 0) throw new SiteContentError("integrity", "Homepage Word selection is missing");
    await writeWordSelection(env, INITIAL_WORD_SELECTION);
    return;
  }
  const current = validateHomepageSelection(stored);
  if (current.ok) return;
  const legacy = validateLegacyHomepageSelection(stored);
  if (!legacy.ok) throw new SiteContentError("integrity", current.error);
  const rawWord = await env.BLOG_POSTS.get(wordKey(legacy.value.selectedWordId), { type: "json" });
  if (rawWord === null) throw new SiteContentError("integrity", `Selected Word is missing: ${legacy.value.selectedWordId}`);
  await writeWordSelection(env, { selectedWordIds: [legacy.value.selectedWordId], updatedAt: legacy.value.updatedAt });
}

async function migrateWordTitles(env: Env): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.BLOG_POSTS.list({ prefix: WORD_PREFIX, cursor });
    for (const { name } of page.keys) {
      const id = name.slice(WORD_PREFIX.length);
      const raw = await env.BLOG_POSTS.get(name, { type: "json" });
      if (raw === null) throw new SiteContentError("integrity", `Word disappeared during migration: ${id}`);
      const strict = validateStoredWord(raw);
      if (strict.ok) {
        if (strict.value.id !== id) throw new SiteContentError("integrity", `Stored Word id does not match key: ${id}`);
        continue;
      }
      if (!isRecord(raw) || "title" in raw) throw new SiteContentError("integrity", strict.error);
      const title = id === TOLKIEN_WORD.id ? TOLKIEN_WORD.title : deriveLegacyWordTitle(raw.text);
      await putWord(env, requireStoredWord({ ...raw, title }, id));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor !== undefined);
}

async function migrateProjects(env: Env, version: 0 | 1 | 2): Promise<void> {
  const singletonRaw = await env.BLOG_POSTS.get(FEATURED_PROJECT_KEY, { type: "json" });
  const targetRaw = await env.BLOG_POSTS.get(projectKey(FEATURED_PROJECT_ID), { type: "json" });
  const selectionRaw = await env.BLOG_POSTS.get(HOMEPAGE_PROJECT_SELECTION_KEY, { type: "json" });
  if (singletonRaw === null && targetRaw === null && selectionRaw === null) {
    if (version !== 0) throw new SiteContentError("integrity", "Legacy featured Project and v3 Project state are missing");
    await putProject(env, INITIAL_PROJECT);
    await writeProjectSelection(env, INITIAL_PROJECT_SELECTION);
  } else if (version === 0 && singletonRaw === null && targetRaw !== null && selectionRaw === null) {
    // A fresh bootstrap may have persisted the Project before its selection.
    // Resume only when the deterministic seed is byte-for-field equivalent.
    assertProjectCollisionFree(requireStoredProject(targetRaw, FEATURED_PROJECT_ID), INITIAL_PROJECT);
    await writeProjectSelection(env, INITIAL_PROJECT_SELECTION);
  } else if (singletonRaw !== null) {
    const singleton = validateStoredFeaturedProject(singletonRaw);
    if (!singleton.ok) throw new SiteContentError("integrity", singleton.error);
    const expected = requireStoredProject({ id: FEATURED_PROJECT_ID, title: singleton.value.title, description: singleton.value.description, url: singleton.value.url, createdAt: singleton.value.updatedAt, updatedAt: singleton.value.updatedAt }, FEATURED_PROJECT_ID);
    if (targetRaw === null) await putProject(env, expected);
    else assertProjectCollisionFree(requireStoredProject(targetRaw, FEATURED_PROJECT_ID), expected);
    if (selectionRaw === null) await writeProjectSelection(env, { selectedProjectIds: [FEATURED_PROJECT_ID], updatedAt: singleton.value.updatedAt });
    else if (!requireProjectSelection(selectionRaw).selectedProjectIds.includes(FEATURED_PROJECT_ID)) throw new SiteContentError("integrity", "Existing Project selection does not include migrated featured Project");
  } else {
    if (targetRaw === null || selectionRaw === null) throw new SiteContentError("integrity", "Partial Project migration state is invalid");
    requireStoredProject(targetRaw, FEATURED_PROJECT_ID);
    if (!requireProjectSelection(selectionRaw).selectedProjectIds.includes(FEATURED_PROJECT_ID)) throw new SiteContentError("integrity", "Migrated featured Project is not selected");
  }
  const selection = await getHomepageProjectSelection(env);
  if (!selection) throw new SiteContentError("integrity", "Homepage Project selection is missing");
  for (const id of selection.selectedProjectIds) if (!(await getProject(env, id))) throw new SiteContentError("integrity", `Selected Project is missing: ${id}`);
  if (singletonRaw !== null) await env.BLOG_POSTS.delete(FEATURED_PROJECT_KEY);
}

function assertProjectCollisionFree(actual: ProjectEntry, expected: ProjectEntry): void {
  if (
    actual.title !== expected.title ||
    actual.description !== expected.description ||
    actual.url !== expected.url ||
    actual.createdAt !== expected.createdAt ||
    actual.updatedAt !== expected.updatedAt
  ) throw new SiteContentError("integrity", `Project migration collision: ${FEATURED_PROJECT_ID}`);
}

function deriveLegacyWordTitle(text: unknown): string {
  if (typeof text !== "string") throw new SiteContentError("integrity", "Legacy Word text is invalid");
  const title = text.replace(/\r\n?/gu, "\n").split("\n").map((line) => line.trim()).find(Boolean);
  if (!title) throw new SiteContentError("integrity", "Legacy Word cannot derive a title");
  return title;
}

async function getMigrationVersion(env: Env): Promise<0 | 1 | 2 | 3> {
  const raw = await env.BLOG_POSTS.get(MIGRATION_KEY);
  if (raw === null) return 0;
  try {
    const marker = JSON.parse(raw) as { version?: unknown };
    if (marker && (marker.version === 1 || marker.version === 2 || marker.version === 3)) return marker.version;
  } catch { /* unified integrity failure below */ }
  throw new SiteContentError("integrity", "Homepage migration marker is invalid");
}

export async function getLatestPublishedPostPreview(env: Env): Promise<LatestPostPreview | null> {
  const published = await listPublishedPosts(env);
  if (published.length === 0) return null;
  published.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.slug.localeCompare(b.slug));
  const latest = published[0];
  const publicPost = await getPublishedBlogPost(env, latest.slug);
  if (publicPost.status !== 200) {
    const detail = publicPost.status === 500 ? `: ${publicPost.error}` : "";
    throw new SiteContentError("invalid_latest_post", `Latest published post is not renderable: ${latest.slug}${detail}`);
  }
  return { slug: publicPost.post.slug, title: publicPost.post.title, excerpt: truncateExcerpt(extractPlainText(publicPost.safeBody)) };
}

function extractPlainText(safeHtml: string): string {
  const pieces: string[] = [];
  const blocks = new Set(["blockquote", "h2", "h3", "li", "ol", "p", "pre", "ul"]);
  sanitizeHtml(safeHtml, {
    allowedTags: [], allowedAttributes: {},
    onOpenTag(tag) { if (tag === "br") pieces.push(" "); },
    onCloseTag(tag) { if (blocks.has(tag)) pieces.push(" "); },
    textFilter(value) { pieces.push(value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")); return ""; },
  });
  return pieces.join("").replace(/\s+/gu, " ").trim();
}

function truncateExcerpt(value: string): string {
  const points = [...value];
  if (points.length <= MAX_POST_EXCERPT_CODE_POINTS) return value;
  const candidate = points.slice(0, MAX_POST_EXCERPT_CODE_POINTS - 1).join("").trimEnd();
  const next = points[MAX_POST_EXCERPT_CODE_POINTS - 1];
  const boundary = candidate.search(/\s+\S*$/u);
  const truncated = /\s/u.test(next) ? candidate : boundary > 0 ? candidate.slice(0, boundary) : candidate;
  return `${truncated.trimEnd()}…`;
}

async function listEntries<T>(env: Env, prefix: string, get: (env: Env, id: string) => Promise<T | null>): Promise<T[]> {
  const entries: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.BLOG_POSTS.list({ prefix, cursor });
    for (const key of page.keys) {
      const id = key.name.slice(prefix.length);
      const entry = await get(env, id);
      if (!entry) throw new SiteContentError("integrity", `Entry disappeared while listing: ${id}`);
      entries.push(entry);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor !== undefined);
  return entries.sort((a, b) => {
    const left = a as { createdAt: string; id: string };
    const right = b as { createdAt: string; id: string };
    return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
  });
}

async function putWord(env: Env, word: WordEntry): Promise<void> { await env.BLOG_POSTS.put(wordKey(word.id), JSON.stringify(word), { metadata: { id: word.id, createdAt: word.createdAt } }); }
async function putProject(env: Env, project: ProjectEntry): Promise<void> { await env.BLOG_POSTS.put(projectKey(project.id), JSON.stringify(project), { metadata: { id: project.id, createdAt: project.createdAt } }); }
async function writeWordSelection(env: Env, selection: HomepageSelection): Promise<HomepageSelection> {
  const valid = validateHomepageSelection(selection); if (!valid.ok) throw validationError(valid.error);
  await env.BLOG_POSTS.put(HOMEPAGE_SELECTION_KEY, JSON.stringify(valid.value)); return valid.value;
}
async function writeProjectSelection(env: Env, selection: HomepageProjectSelection): Promise<HomepageProjectSelection> {
  const valid = validateHomepageProjectSelection(selection); if (!valid.ok) throw validationError(valid.error);
  await env.BLOG_POSTS.put(HOMEPAGE_PROJECT_SELECTION_KEY, JSON.stringify(valid.value)); return valid.value;
}
function requireWordId(id: unknown): string { const valid = validateWordId(id); if (!valid.ok) throw validationError(valid.error); return valid.value; }
function requireProjectId(id: unknown): string { const valid = validateProjectId(id); if (!valid.ok) throw validationError(valid.error); return valid.value; }
function requireStoredWord(value: unknown, id: string, code: "integrity" | "validation" = "integrity"): WordEntry {
  const valid = validateStoredWord(value); if (!valid.ok) throw new SiteContentError(code, valid.error);
  if (valid.value.id !== id) throw new SiteContentError(code, `Stored Word id does not match key: ${id}`); return valid.value;
}
function requireStoredProject(value: unknown, id: string, code: "integrity" | "validation" = "integrity"): ProjectEntry {
  const valid = validateStoredProject(value); if (!valid.ok) throw new SiteContentError(code, valid.error);
  if (valid.value.id !== id) throw new SiteContentError(code, `Stored Project id does not match key: ${id}`); return valid.value;
}
function requireProjectSelection(value: unknown): HomepageProjectSelection { const valid = validateHomepageProjectSelection(value); if (!valid.ok) throw new SiteContentError("integrity", valid.error); return valid.value; }
function validationError(message: string): SiteContentError { return new SiteContentError("validation", message); }
function wordKey(id: string): string { return `${WORD_PREFIX}${id}`; }
function projectKey(id: string): string { return `${PROJECT_PREFIX}${id}`; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
