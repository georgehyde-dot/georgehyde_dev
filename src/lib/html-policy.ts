/**
 * Allowlist sanitizer for stored blog post HTML.
 *
 * @decision DEC-SH-005
 * @title Sanitize stored HTML with a maintained parser
 * @status accepted
 * @rationale Blog bodies are rendered with set:html, so browser-facing safety
 *   must not depend on a handwritten HTML parser. sanitize-html parses input
 *   and emits only the exact elements and attributes produced by the editor.
 *   The same authority runs before persistence and before public rendering.
 */

import sanitizeHtml from "sanitize-html";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export const MAX_STORED_HTML_LENGTH = 100_000;

const ALLOWED_TAGS = [
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "em",
  "h2",
  "h3",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "span",
  "strong",
  "ul",
];

/** Sanitizes blog HTML and rejects bodies that become empty. */
export function validateStoredHtml(input: unknown): ValidationResult<string> {
  if (typeof input !== "string") {
    return { ok: false, error: "Body is required" };
  }

  if (input.length > MAX_STORED_HTML_LENGTH) {
    return { ok: false, error: "Body is too large" };
  }

  const value = sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    enforceHtmlBoundary: true,
    nonTextTags: ["script", "style", "textarea", "option", "noscript"],
    transformTags: {
      a: (tagName, attributes) => {
        const href = attributes.href
          ?.trim()
          .replace(/^`+|`+$/g, "")
          .replace(/[\u0000-\u001f\u007f\s]+/g, "");
        if (href && /^(?:javascript|data|vbscript):/i.test(href)) {
          delete attributes.href;
        }
        return { tagName, attribs: attributes };
      },
    },
  }).trim();

  if (!value || !sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim()) {
    return { ok: false, error: "Body is required" };
  }

  return { ok: true, value };
}
