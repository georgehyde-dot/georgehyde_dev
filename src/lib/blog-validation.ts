/**
 * Blog form validation and parsing.
 *
 * Admin API routes call this module instead of carrying their own regexes or
 * ad hoc form parsing. Body HTML validation delegates to html-policy.ts so
 * there is still exactly one stored-HTML authority.
 *
 * @decision DEC-SH-002
 * @title Central blog input validation authority
 * @status accepted
 * @rationale Slug, title, body, and published-state checks previously lived in
 *   individual admin routes, which made policy drift likely. Central parsing
 *   keeps create/update behavior aligned and gives tests one authority to
 *   exercise for write-path validation.
 */

import { validateStoredHtml, type ValidationResult } from "./html-policy.ts";

export const SLUG_PATTERN = /^[a-z0-9-]+$/;
export const MAX_TITLE_LENGTH = 160;

export interface CreatePostInput {
  title: string;
  slug: string;
  body: string;
  published: boolean;
}

export interface UpdatePostInput {
  title: string;
  body: string;
  published: boolean;
}

export function validateRouteSlug(slug: unknown): ValidationResult<string> {
  if (typeof slug !== "string" || !slug.trim()) {
    return { ok: false, error: "Invalid slug" };
  }

  const value = slug.trim();
  if (!SLUG_PATTERN.test(value)) {
    return { ok: false, error: "Invalid slug" };
  }

  return { ok: true, value };
}

export function validateCreatePostForm(
  formData: FormData
): ValidationResult<CreatePostInput> {
  const title = validateTitle(readTextField(formData, "title"));
  if (!title.ok) return title;

  const slug = validateSlug(readTextField(formData, "slug"));
  if (!slug.ok) return slug;

  const body = validateStoredHtml(readTextField(formData, "body", false));
  if (!body.ok) return body;

  const published = validatePublished(formData);
  if (!published.ok) return published;

  return {
    ok: true,
    value: {
      title: title.value,
      slug: slug.value,
      body: body.value,
      published: published.value,
    },
  };
}

export function validateUpdatePostForm(
  formData: FormData
): ValidationResult<UpdatePostInput> {
  const title = validateTitle(readTextField(formData, "title"));
  if (!title.ok) return title;

  const body = validateStoredHtml(readTextField(formData, "body", false));
  if (!body.ok) return body;

  const published = validatePublished(formData);
  if (!published.ok) return published;

  return {
    ok: true,
    value: {
      title: title.value,
      body: body.value,
      published: published.value,
    },
  };
}

function validateTitle(value: string | null): ValidationResult<string> {
  const title = value?.trim() ?? "";
  if (!title) {
    return { ok: false, error: "Title is required" };
  }

  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: "Title is too long" };
  }

  return { ok: true, value: title };
}

function validateSlug(value: string | null): ValidationResult<string> {
  const slug = value?.trim() ?? "";
  if (!slug) {
    return { ok: false, error: "Slug is required" };
  }

  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      error: "Slug must contain only lowercase letters, digits, and hyphens",
    };
  }

  return { ok: true, value: slug };
}

function validatePublished(formData: FormData): ValidationResult<boolean> {
  const raw = formData.get("published");
  if (raw === null) {
    return { ok: true, value: false };
  }

  if (raw === "on") {
    return { ok: true, value: true };
  }

  return { ok: false, error: "Published must be submitted as a checkbox" };
}

function readTextField(
  formData: FormData,
  fieldName: string,
  trim = true
): string | null {
  const value = formData.get(fieldName);
  if (typeof value !== "string") {
    return null;
  }

  return trim ? value.trim() : value;
}
