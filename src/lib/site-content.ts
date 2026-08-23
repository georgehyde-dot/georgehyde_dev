/**
 * Canonical content authority for Words and the curated homepage.
 *
 * @decision DEC-SR-002A
 * @title Keep selection and project in independent BLOG_POSTS authorities
 * @status accepted
 * @rationale Words, homepage selection, and the featured project use separate
 *   keys in the existing binding. Independent writes prevent cross-request
 *   read/modify/write loss without locks, CAS, or another storage service.
 *
 * @decision DEC-SR-003
 * @title Bootstrap deterministic homepage content with a marker-last migration
 * @status accepted
 * @rationale Missing seed keys are materialized only while the migration marker
 *   is absent. Writes never replace present values, the marker is written last,
 *   and marked state never falls back to or resurrects the seed constants.
 *
 * @decision DEC-SR-004A
 * @title Preserve inline text and add spacing only at semantic block boundaries
 * @status accepted
 * @rationale sanitize-html parser callbacks decode entities and identify block
 *   boundaries. Concatenating inline text exactly avoids punctuation corruption.
 *
 * @decision DEC-SR-005A
 * @title Enforce selected-Word integrity with independent singleton updates
 * @status accepted
 * @rationale A selected Word cannot be deleted. Selection and project updates
 *   each write only their own key, so concurrent requests preserve both results.
 *
 * @decision DEC-SR-003B
 * @title Upgrade the selection authority in place and mark schema v2 last
 * @status accepted
 * @rationale The existing selection key remains canonical. Marker-controlled
 *   migration accepts the legacy scalar only before v2, preserves its order as
 *   a one-item list, validates referents, and writes the v2 marker last.
 */

import sanitizeHtml from "sanitize-html";

import { getPublishedBlogPost } from "./public-blog.ts";
import {
  listPublishedPosts,
  type Env,
} from "./kv-store.ts";
import {
  validateFeaturedProject,
  validateHomepageSelection,
  validateLegacyHomepageSelection,
  validateSelectedWordIds,
  validateStoredFeaturedProject,
  validateStoredWord,
  validateWordId,
  validateWordInput,
  type FeaturedProject,
  type HomepageSelection,
  type StoredFeaturedProject,
  type StoredWord,
  type WordInput,
} from "./site-validation.ts";

export type WordEntry = StoredWord;
export type {
  FeaturedProject,
  HomepageSelection,
  StoredFeaturedProject,
  WordInput,
};

export const WORD_PREFIX = "word:";
export const HOMEPAGE_SELECTION_KEY = "site:homepage-selection:v1";
export const FEATURED_PROJECT_KEY = "site:featured-project:v1";
export const MIGRATION_KEY = "site:migration:homepage-v1";
export const MAX_POST_EXCERPT_CODE_POINTS = 240;

const SEED_TIMESTAMP = "2026-08-22T00:00:00.000Z";

export const TOLKIEN_WORD: WordEntry = Object.freeze({
  id: "tolkien-food-cheer-song",
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

const INITIAL_HOMEPAGE_SELECTION: HomepageSelection = Object.freeze({
  selectedWordIds: [TOLKIEN_WORD.id],
  updatedAt: SEED_TIMESTAMP,
});

const INITIAL_STORED_FEATURED_PROJECT: StoredFeaturedProject = Object.freeze({
  ...INITIAL_FEATURED_PROJECT,
  updatedAt: SEED_TIMESTAMP,
});

export interface HomepageState {
  selection: HomepageSelection;
  featuredProject: StoredFeaturedProject;
}

export interface HomepageContent {
  state: HomepageState;
  selectedWords: WordEntry[];
}

export interface LatestPostPreview {
  slug: string;
  title: string;
  excerpt: string;
}

export type SiteContentErrorCode =
  | "duplicate"
  | "integrity"
  | "invalid_latest_post"
  | "not_found"
  | "selected_word"
  | "validation";

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
  if (value === null) return null;
  return requireStoredWord(value, wordId);
}

/** Lists every Word across all KV pages, oldest first with id as the tie-break. */
export async function listWords(env: Env): Promise<WordEntry[]> {
  const words: WordEntry[] = [];
  let cursor: string | undefined;

  do {
    const page = await env.BLOG_POSTS.list({ prefix: WORD_PREFIX, cursor });
    for (const key of page.keys) {
      const id = key.name.slice(WORD_PREFIX.length);
      const word = await getWord(env, id);
      if (word === null) {
        throw new SiteContentError(
          "integrity",
          `Word disappeared while listing: ${id}`
        );
      }
      words.push(word);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor !== undefined);

  words.sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  );
  return words;
}

/** Creates a Word and rejects an existing id rather than silently overwriting it. */
export async function createWord(
  env: Env,
  input: WordInput,
  now: string = new Date().toISOString()
): Promise<WordEntry> {
  const validated = validateWordInput(input);
  if (!validated.ok) throw validationError(validated.error);
  if (await getWord(env, validated.value.id)) {
    throw new SiteContentError(
      "duplicate",
      `A Word with id "${validated.value.id}" already exists`
    );
  }

  const word = requireStoredWord(
    { ...validated.value, createdAt: now, updatedAt: now },
    validated.value.id,
    "validation"
  );
  await putWord(env, word);
  return word;
}

/** Updates mutable Word fields while preserving id and createdAt. */
export async function updateWord(
  env: Env,
  id: unknown,
  input: Omit<WordInput, "id">,
  updatedAt: string = new Date().toISOString()
): Promise<WordEntry> {
  const wordId = requireWordId(id);
  const existing = await getWord(env, wordId);
  if (!existing) {
    throw new SiteContentError("not_found", `Word not found: ${wordId}`);
  }
  const validated = validateWordInput({ ...input, id: wordId });
  if (!validated.ok) throw validationError(validated.error);
  const word = requireStoredWord(
    { ...validated.value, createdAt: existing.createdAt, updatedAt },
    wordId,
    "validation"
  );
  await putWord(env, word);
  return word;
}

/** Rejects deletion while the singleton still refers to this Word. */
export async function deleteWord(env: Env, id: unknown): Promise<void> {
  const wordId = requireWordId(id);
  const selection = await getHomepageSelection(env);
  if (!selection && (await env.BLOG_POSTS.get(MIGRATION_KEY)) !== null) {
    throw new SiteContentError("integrity", "Homepage selection is missing");
  }
  if (selection?.selectedWordIds.includes(wordId)) {
    throw new SiteContentError(
      "selected_word",
      "Select another Word before deleting this one"
    );
  }
  if (!(await getWord(env, wordId))) {
    throw new SiteContentError("not_found", `Word not found: ${wordId}`);
  }
  await env.BLOG_POSTS.delete(wordKey(wordId));
}

export async function getHomepageSelection(
  env: Env
): Promise<HomepageSelection | null> {
  const value = await env.BLOG_POSTS.get(HOMEPAGE_SELECTION_KEY, {
    type: "json",
  });
  if (value === null) return null;
  const validated = validateHomepageSelection(value);
  if (!validated.ok) {
    throw new SiteContentError("integrity", validated.error);
  }
  return validated.value;
}

export async function getFeaturedProject(
  env: Env
): Promise<StoredFeaturedProject | null> {
  const value = await env.BLOG_POSTS.get(FEATURED_PROJECT_KEY, { type: "json" });
  if (value === null) return null;
  const validated = validateStoredFeaturedProject(value);
  if (!validated.ok) {
    throw new SiteContentError("integrity", validated.error);
  }
  return validated.value;
}

/** Joins independent reads for presentation without becoming a write authority. */
export async function getHomepageState(env: Env): Promise<HomepageState> {
  const [selection, featuredProject] = await Promise.all([
    getHomepageSelection(env),
    getFeaturedProject(env),
  ]);
  if (!selection) {
    throw new SiteContentError("integrity", "Homepage selection is missing");
  }
  if (!featuredProject) {
    throw new SiteContentError("integrity", "Featured project is missing");
  }
  return { selection, featuredProject };
}

/** Returns only a referentially complete homepage; dangling state is an error. */
export async function getHomepageContent(env: Env): Promise<HomepageContent> {
  const state = await getHomepageState(env);
  const selectedWords = await Promise.all(
    state.selection.selectedWordIds.map(async (wordId) => {
      const word = await getWord(env, wordId);
      if (!word) {
        throw new SiteContentError(
          "integrity",
          `Selected Word is missing: ${wordId}`
        );
      }
      return word;
    })
  );
  return { state, selectedWords };
}

export async function updateHomepageSelection(
  env: Env,
  selectedWordIds: unknown,
  updatedAt: string = new Date().toISOString()
): Promise<HomepageSelection> {
  const selected = validateSelectedWordIds(selectedWordIds);
  if (!selected.ok) throw validationError(selected.error);
  for (const wordId of selected.value) {
    if (!(await getWord(env, wordId))) {
      throw new SiteContentError("not_found", `Word not found: ${wordId}`);
    }
  }
  return writeHomepageSelection(env, {
    selectedWordIds: selected.value,
    updatedAt,
  });
}

export async function updateFeaturedProject(
  env: Env,
  project: unknown,
  updatedAt: string = new Date().toISOString()
): Promise<StoredFeaturedProject> {
  const featuredProject = validateFeaturedProject(project);
  if (!featuredProject.ok) throw validationError(featuredProject.error);
  return writeFeaturedProject(env, {
    ...featuredProject.value,
    updatedAt,
  });
}

/**
 * Materializes the deterministic seed only before the migration marker exists.
 * Each present key is preserved, so a retry resumes without reverting admin data.
 */
export async function bootstrapSiteContent(env: Env): Promise<HomepageContent> {
  const migrationVersion = await getMigrationVersion(env);
  if (migrationVersion === 2) return getHomepageContent(env);

  if (migrationVersion === 1) {
    await upgradeLegacyHomepageSelection(env);
    const content = await getHomepageContent(env);
    await writeMigrationMarker(env);
    return content;
  }

  if ((await env.BLOG_POSTS.get(wordKey(TOLKIEN_WORD.id))) === null) {
    await putWord(env, TOLKIEN_WORD);
  }
  if ((await env.BLOG_POSTS.get(HOMEPAGE_SELECTION_KEY)) === null) {
    await writeHomepageSelection(env, INITIAL_HOMEPAGE_SELECTION);
  } else {
    await upgradeLegacyHomepageSelection(env);
  }
  if ((await env.BLOG_POSTS.get(FEATURED_PROJECT_KEY)) === null) {
    await writeFeaturedProject(env, INITIAL_STORED_FEATURED_PROJECT);
  }

  const content = await getHomepageContent(env);
  await writeMigrationMarker(env);
  return content;
}

async function getMigrationVersion(env: Env): Promise<0 | 1 | 2> {
  const raw = await env.BLOG_POSTS.get(MIGRATION_KEY);
  if (raw === null) return 0;
  try {
    const marker = JSON.parse(raw) as unknown;
    if (
      typeof marker === "object" &&
      marker !== null &&
      !Array.isArray(marker) &&
      ((marker as { version?: unknown }).version === 1 ||
        (marker as { version?: unknown }).version === 2)
    ) {
      return (marker as { version: 1 | 2 }).version;
    }
  } catch {
    // Fall through to the single integrity failure below.
  }
  throw new SiteContentError("integrity", "Homepage migration marker is invalid");
}

async function upgradeLegacyHomepageSelection(env: Env): Promise<void> {
  const stored = await env.BLOG_POSTS.get(HOMEPAGE_SELECTION_KEY, {
    type: "json",
  });
  if (stored === null) {
    throw new SiteContentError("integrity", "Homepage selection is missing");
  }

  const current = validateHomepageSelection(stored);
  if (current.ok) return;
  const legacy = validateLegacyHomepageSelection(stored);
  if (!legacy.ok) {
    throw new SiteContentError("integrity", current.error);
  }
  if (!(await getWord(env, legacy.value.selectedWordId))) {
    throw new SiteContentError(
      "integrity",
      `Selected Word is missing: ${legacy.value.selectedWordId}`
    );
  }
  await writeHomepageSelection(env, {
    selectedWordIds: [legacy.value.selectedWordId],
    updatedAt: legacy.value.updatedAt,
  });
}

async function writeMigrationMarker(env: Env): Promise<void> {
  await env.BLOG_POSTS.put(MIGRATION_KEY, JSON.stringify({ version: 2 }));
}

/**
 * Selects the actual newest published post and validates it through the public
 * render authority before parser-based, entity-decoded plain-text extraction.
 */
export async function getLatestPublishedPostPreview(
  env: Env
): Promise<LatestPostPreview | null> {
  const published = await listPublishedPosts(env);
  if (published.length === 0) return null;
  published.sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || a.slug.localeCompare(b.slug)
  );

  const latest = published[0];
  const publicPost = await getPublishedBlogPost(env, latest.slug);
  if (publicPost.status !== 200) {
    const detail = publicPost.status === 500 ? `: ${publicPost.error}` : "";
    throw new SiteContentError(
      "invalid_latest_post",
      `Latest published post is not renderable: ${latest.slug}${detail}`
    );
  }

  return {
    slug: publicPost.post.slug,
    title: publicPost.post.title,
    excerpt: truncateExcerpt(extractPlainText(publicPost.safeBody)),
  };
}

function extractPlainText(safeHtml: string): string {
  const pieces: string[] = [];
  const blockTags = new Set([
    "blockquote",
    "h2",
    "h3",
    "li",
    "ol",
    "p",
    "pre",
    "ul",
  ]);
  sanitizeHtml(safeHtml, {
    allowedTags: [],
    allowedAttributes: {},
    onOpenTag(tagName) {
      if (tagName === "br") pieces.push(" ");
    },
    onCloseTag(tagName) {
      if (blockTags.has(tagName)) pieces.push(" ");
    },
    textFilter(text) {
      // sanitize-html parses entities before escaping text for safe HTML output.
      // Undo exactly that output escaping to retain the parser-decoded text.
      pieces.push(
        text
          .replaceAll("&lt;", "<")
          .replaceAll("&gt;", ">")
          .replaceAll("&amp;", "&")
      );
      return "";
    },
  });
  return pieces.join("").replace(/\s+/gu, " ").trim();
}

function truncateExcerpt(value: string): string {
  const codePoints = [...value];
  if (codePoints.length <= MAX_POST_EXCERPT_CODE_POINTS) return value;

  const budget = MAX_POST_EXCERPT_CODE_POINTS - 1;
  const candidate = codePoints.slice(0, budget).join("").trimEnd();
  const nextCodePoint = codePoints[budget];
  const boundary = candidate.search(/\s+\S*$/u);
  const truncated = /\s/u.test(nextCodePoint)
    ? candidate
    : boundary > 0
      ? candidate.slice(0, boundary)
      : candidate;
  return `${truncated.trimEnd()}…`;
}

async function putWord(env: Env, word: WordEntry): Promise<void> {
  await env.BLOG_POSTS.put(wordKey(word.id), JSON.stringify(word), {
    metadata: { id: word.id, createdAt: word.createdAt },
  });
}

async function writeHomepageSelection(
  env: Env,
  selection: HomepageSelection
): Promise<HomepageSelection> {
  const validated = validateHomepageSelection(selection);
  if (!validated.ok) throw validationError(validated.error);
  await env.BLOG_POSTS.put(
    HOMEPAGE_SELECTION_KEY,
    JSON.stringify(validated.value)
  );
  return validated.value;
}

async function writeFeaturedProject(
  env: Env,
  project: StoredFeaturedProject
): Promise<StoredFeaturedProject> {
  const validated = validateStoredFeaturedProject(project);
  if (!validated.ok) throw validationError(validated.error);
  await env.BLOG_POSTS.put(FEATURED_PROJECT_KEY, JSON.stringify(validated.value));
  return validated.value;
}

function requireWordId(id: unknown): string {
  const validated = validateWordId(id);
  if (!validated.ok) throw validationError(validated.error);
  return validated.value;
}

function requireStoredWord(
  value: unknown,
  expectedId: string,
  errorCode: "integrity" | "validation" = "integrity"
): WordEntry {
  const validated = validateStoredWord(value);
  if (!validated.ok) throw new SiteContentError(errorCode, validated.error);
  if (validated.value.id !== expectedId) {
    throw new SiteContentError(
      errorCode,
      `Stored Word id does not match key: ${expectedId}`
    );
  }
  return validated.value;
}

function validationError(message: string): SiteContentError {
  return new SiteContentError("validation", message);
}

function wordKey(id: string): string {
  return `${WORD_PREFIX}${id}`;
}
