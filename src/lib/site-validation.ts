/**
 * Validation authority for Words and curated homepage state.
 *
 * @decision DEC-SR-004
 * @title Store Words as validated plain text and require HTTPS references
 * @status accepted
 * @rationale Words need line breaks, not a second rich-text policy. Keeping all
 *   Word identifiers, text, attribution, source, project, and stored-record
 *   validation here prevents admin forms and public readers from drifting.
 *
 * @decision DEC-SR-002B
 * @title Validate one ordered set of one to five homepage Words
 * @status accepted
 * @rationale The selection singleton stores one strict ordered id list. Slot
 *   parsing is explicit, rejects gaps, duplicates, and overflow, and never
 *   silently truncates or deduplicates forged state.
 */

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export const WORD_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_WORD_ID_LENGTH = 120;
export const MAX_WORD_TEXT_LENGTH = 20_000;
export const MAX_ATTRIBUTION_LENGTH = 240;
export const MAX_SOURCE_URL_LENGTH = 2_048;
export const MAX_PROJECT_TITLE_LENGTH = 160;
export const MAX_PROJECT_DESCRIPTION_LENGTH = 4_000;
export const MAX_PROJECT_URL_LENGTH = 2_048;
export const MAX_HOMEPAGE_WORDS = 5;
export const HOMEPAGE_WORD_SLOT_COUNT = 5;

export interface WordInput {
  id: string;
  text: string;
  attribution: string;
  source: string | null;
}

export interface StoredWord extends WordInput {
  createdAt: string;
  updatedAt: string;
}

export interface FeaturedProject {
  title: string;
  description: string;
  url: string;
}

export interface HomepageSelection {
  selectedWordIds: string[];
  updatedAt: string;
}

export interface LegacyHomepageSelection {
  selectedWordId: string;
  updatedAt: string;
}

export interface StoredFeaturedProject extends FeaturedProject {
  updatedAt: string;
}

export function validateWordId(input: unknown): ValidationResult<string> {
  const value = typeof input === "string" ? input.trim() : "";
  if (
    !value ||
    value.length > MAX_WORD_ID_LENGTH ||
    !WORD_ID_PATTERN.test(value)
  ) {
    return { ok: false, error: "Invalid Word id" };
  }
  return { ok: true, value };
}

export function validateWordInput(input: unknown): ValidationResult<WordInput> {
  if (!isRecord(input)) return { ok: false, error: "Invalid Word" };

  const id = validateWordId(input.id);
  if (!id.ok) return id;

  const text = normalizeMultilineText(input.text);
  if (!text) return { ok: false, error: "Text is required" };
  if (text.length > MAX_WORD_TEXT_LENGTH) {
    return { ok: false, error: "Text is too long" };
  }

  const attribution = normalizeSingleLine(input.attribution);
  if (!attribution) return { ok: false, error: "Attribution is required" };
  if (attribution.length > MAX_ATTRIBUTION_LENGTH) {
    return { ok: false, error: "Attribution is too long" };
  }

  if (
    input.source !== null &&
    input.source !== undefined &&
    typeof input.source !== "string"
  ) {
    return { ok: false, error: "Source must be an absolute HTTPS URL" };
  }
  const source = optionalText(input.source);
  if (source && source.length > MAX_SOURCE_URL_LENGTH) {
    return { ok: false, error: "Source is too long" };
  }
  if (source && !isAbsoluteHttpsUrl(source)) {
    return { ok: false, error: "Source must be an absolute HTTPS URL" };
  }

  return {
    ok: true,
    value: { id: id.value, text, attribution, source },
  };
}

export function validateStoredWord(input: unknown): ValidationResult<StoredWord> {
  const word = validateWordInput(input);
  if (!word.ok) return word;
  if (!isRecord(input) || !isCanonicalIsoTimestamp(input.createdAt)) {
    return { ok: false, error: "Stored Word has an invalid createdAt" };
  }
  if (!isCanonicalIsoTimestamp(input.updatedAt)) {
    return { ok: false, error: "Stored Word has an invalid updatedAt" };
  }
  return {
    ok: true,
    value: {
      ...word.value,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    },
  };
}

export function validateFeaturedProject(
  input: unknown
): ValidationResult<FeaturedProject> {
  if (!isRecord(input)) return { ok: false, error: "Invalid featured project" };

  const title = normalizeSingleLine(input.title);
  if (!title) return { ok: false, error: "Project title is required" };
  if (title.length > MAX_PROJECT_TITLE_LENGTH) {
    return { ok: false, error: "Project title is too long" };
  }

  const description = normalizeMultilineText(input.description);
  if (!description) {
    return { ok: false, error: "Project description is required" };
  }
  if (description.length > MAX_PROJECT_DESCRIPTION_LENGTH) {
    return { ok: false, error: "Project description is too long" };
  }

  const url = optionalText(input.url);
  if (!url) return { ok: false, error: "Project URL is required" };
  if (url.length > MAX_PROJECT_URL_LENGTH) {
    return { ok: false, error: "Project URL is too long" };
  }
  if (!isAbsoluteHttpsUrl(url)) {
    return { ok: false, error: "Project URL must be an absolute HTTPS URL" };
  }

  return { ok: true, value: { title, description, url } };
}

export function validateHomepageSelection(
  input: unknown
): ValidationResult<HomepageSelection> {
  if (!isRecord(input) || "selectedWordId" in input) {
    return { ok: false, error: "Invalid stored homepage selection" };
  }
  const selectedWordIds = validateSelectedWordIds(input.selectedWordIds);
  if (!selectedWordIds.ok) {
    return { ok: false, error: `Stored homepage selection is invalid: ${selectedWordIds.error}` };
  }
  if (!isCanonicalIsoTimestamp(input.updatedAt)) {
    return { ok: false, error: "Stored homepage selection has an invalid updatedAt" };
  }
  return {
    ok: true,
    value: {
      selectedWordIds: selectedWordIds.value,
      updatedAt: input.updatedAt,
    },
  };
}

/** Strict canonical validation for the ordered persisted id list. */
export function validateSelectedWordIds(
  input: unknown
): ValidationResult<string[]> {
  if (!Array.isArray(input)) {
    return { ok: false, error: "Selected Words must be a list" };
  }
  if (input.length === 0) {
    return { ok: false, error: "Select at least one Word" };
  }
  if (input.length > MAX_HOMEPAGE_WORDS) {
    return { ok: false, error: "Select no more than five Words" };
  }

  const selectedWordIds: string[] = [];
  for (const candidate of input) {
    const wordId = validateWordId(candidate);
    if (!wordId.ok) {
      return { ok: false, error: "Selected Words contain an invalid Word id" };
    }
    if (selectedWordIds.includes(wordId.value)) {
      return { ok: false, error: "Selected Words must be unique" };
    }
    selectedWordIds.push(wordId.value);
  }
  return { ok: true, value: selectedWordIds };
}

/** Parses exactly five ordered admin slots without filtering non-trailing gaps. */
export function validateHomepageSelectionSlots(
  input: unknown
): ValidationResult<string[]> {
  if (!Array.isArray(input) || input.length !== HOMEPAGE_WORD_SLOT_COUNT) {
    return { ok: false, error: "Homepage selection requires exactly five slots" };
  }
  if (input.some((value) => typeof value !== "string")) {
    return { ok: false, error: "Homepage Word slots are invalid" };
  }

  const firstUnused = input.indexOf("");
  if (
    firstUnused !== -1 &&
    input.slice(firstUnused).some((value) => value !== "")
  ) {
    return { ok: false, error: "Homepage Word slots must be contiguous" };
  }
  return validateSelectedWordIds(
    firstUnused === -1 ? input : input.slice(0, firstUnused)
  );
}

/** Legacy v1 shape accepted only by the marker-controlled migration. */
export function validateLegacyHomepageSelection(
  input: unknown
): ValidationResult<LegacyHomepageSelection> {
  if (!isRecord(input) || "selectedWordIds" in input) {
    return { ok: false, error: "Invalid legacy homepage selection" };
  }
  const selectedWordId = validateWordId(input.selectedWordId);
  if (!selectedWordId.ok) {
    return { ok: false, error: "Legacy homepage selection has an invalid selected Word" };
  }
  if (!isCanonicalIsoTimestamp(input.updatedAt)) {
    return { ok: false, error: "Legacy homepage selection has an invalid updatedAt" };
  }
  return {
    ok: true,
    value: { selectedWordId: selectedWordId.value, updatedAt: input.updatedAt },
  };
}

export function validateStoredFeaturedProject(
  input: unknown
): ValidationResult<StoredFeaturedProject> {
  const project = validateFeaturedProject(input);
  if (!project.ok) return project;
  if (!isRecord(input) || !isCanonicalIsoTimestamp(input.updatedAt)) {
    return { ok: false, error: "Stored featured project has an invalid updatedAt" };
  }
  return {
    ok: true,
    value: { ...project.value, updatedAt: input.updatedAt },
  };
}

function normalizeSingleLine(input: unknown): string {
  return typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
}

function normalizeMultilineText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.replace(/\r\n?/g, "\n").trim();
}

function optionalText(input: unknown): string | null {
  if (input === null || input === undefined || input === "") return null;
  return typeof input === "string" ? input.trim() || null : null;
}

function isAbsoluteHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isCanonicalIsoTimestamp(input: unknown): input is string {
  if (typeof input !== "string") return false;
  const time = Date.parse(input);
  return Number.isFinite(time) && new Date(time).toISOString() === input;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
