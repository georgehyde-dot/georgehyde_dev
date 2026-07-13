/**
 * Stored HTML policy for blog post bodies.
 *
 * This module is the single authority for deciding whether HTML is acceptable
 * to store and later render with Astro's set:html directive. It rejects known
 * executable constructs; it is not a general-purpose sanitizer for arbitrary
 * user-generated HTML.
 *
 * @decision DEC-SH-002
 * @title Central stored-HTML policy without a sanitizer dependency
 * @status accepted
 * @rationale The site has one owner-author only, so the immediate risk is
 *   accidental executable markup or a future write-path mistake, not hostile
 *   multi-user HTML. A small reject policy covers the dangerous constructs
 *   required by the hardening plan while avoiding a new sanitizer dependency
 *   and avoiding false claims that this helper can safely clean arbitrary HTML.
 */

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export const MAX_STORED_HTML_LENGTH = 100_000;

const UNSAFE_URL_SCHEME_RE = /^(?:javascript|data|vbscript):/i;
const ENTITY_RE = /&(#x[0-9a-f]+|#\d+|colon|tab|newline);?/gi;
const EVENT_HANDLER_ATTRIBUTE_RE = /^on[a-z][a-z0-9_-]*$/i;
const EXECUTABLE_TAGS = new Set([
  "base",
  "button",
  "embed",
  "form",
  "iframe",
  "input",
  "link",
  "math",
  "meta",
  "object",
  "script",
  "select",
  "style",
  "svg",
  "textarea",
]);
const URL_ATTRIBUTES = new Set([
  "action",
  "archive",
  "background",
  "cite",
  "classid",
  "codebase",
  "data",
  "formaction",
  "href",
  "icon",
  "longdesc",
  "manifest",
  "ping",
  "poster",
  "profile",
  "src",
  "srcdoc",
  "srcset",
  "usemap",
  "xlink:href",
]);
const URL_LIST_ATTRIBUTES = new Set(["archive", "ping"]);
const SRCSET_ATTRIBUTES = new Set(["srcset"]);

interface HtmlTagCandidate {
  name: string;
  attributesSource: string;
}

interface HtmlAttribute {
  name: string;
  value: string;
}

/**
 * Validates stored blog body HTML before persistence or public rendering.
 *
 * The returned value is trimmed to match the editor's submission behavior and
 * to keep empty whitespace-only posts out of KV.
 */
export function validateStoredHtml(input: unknown): ValidationResult<string> {
  if (typeof input !== "string") {
    return { ok: false, error: "Body is required" };
  }

  if (input.length > MAX_STORED_HTML_LENGTH) {
    return { ok: false, error: "Body is too large" };
  }

  const html = input.trim();
  if (!html) {
    return { ok: false, error: "Body is required" };
  }

  const scan = inspectHtml(html);

  if (scan.hasScriptTag) {
    return { ok: false, error: "Body contains a script tag" };
  }

  if (scan.hasEventHandlerAttribute) {
    return { ok: false, error: "Body contains an event-handler attribute" };
  }

  if (scan.hasExecutableTag) {
    return { ok: false, error: "Body contains an executable tag" };
  }

  if (scan.hasUnsafeUrlAttribute) {
    return { ok: false, error: "Body contains an unsafe URL scheme" };
  }

  return { ok: true, value: html };
}

function inspectHtml(html: string): {
  hasScriptTag: boolean;
  hasEventHandlerAttribute: boolean;
  hasExecutableTag: boolean;
  hasUnsafeUrlAttribute: boolean;
} {
  const result = {
    hasScriptTag: false,
    hasEventHandlerAttribute: false,
    hasExecutableTag: false,
    hasUnsafeUrlAttribute: false,
  };

  for (const tag of scanHtmlTags(html)) {
    if (tag.name === "script") {
      result.hasScriptTag = true;
    }

    if (EXECUTABLE_TAGS.has(tag.name)) {
      result.hasExecutableTag = true;
    }

    for (const attribute of scanHtmlAttributes(tag.attributesSource)) {
      if (EVENT_HANDLER_ATTRIBUTE_RE.test(attribute.name)) {
        result.hasEventHandlerAttribute = true;
      }

      if (
        URL_ATTRIBUTES.has(attribute.name) &&
        hasUnsafeUrlAttributeValue(attribute.name, attribute.value)
      ) {
        result.hasUnsafeUrlAttribute = true;
      }
    }
  }

  return result;
}

function* scanHtmlTags(html: string): Generator<HtmlTagCandidate> {
  for (let index = 0; index < html.length; index += 1) {
    if (html[index] !== "<") {
      continue;
    }

    let cursor = index + 1;
    cursor = skipHtmlWhitespace(html, cursor);

    if (html[cursor] === "/") {
      cursor = skipHtmlWhitespace(html, cursor + 1);
    }

    if (!isAsciiLetter(html[cursor])) {
      continue;
    }

    const nameStart = cursor;
    while (isTagNameCharacter(html[cursor])) {
      cursor += 1;
    }

    const name = html.slice(nameStart, cursor).toLowerCase();
    const attributesStart = cursor;
    const tagEnd = findTagEnd(html, cursor);
    yield {
      name,
      attributesSource: html.slice(attributesStart, tagEnd),
    };

    index = tagEnd;
  }
}

function* scanHtmlAttributes(source: string): Generator<HtmlAttribute> {
  let index = 0;

  while (index < source.length) {
    index = skipHtmlAttributeDelimiters(source, index);
    if (index >= source.length) {
      break;
    }

    const nameStart = index;
    while (index < source.length && !isHtmlAttributeNameTerminator(source[index])) {
      index += 1;
    }

    const name = source.slice(nameStart, index).toLowerCase();
    index = skipHtmlWhitespace(source, index);

    let value = "";
    if (source[index] === "=") {
      index = skipHtmlWhitespace(source, index + 1);
      const quote = source[index];

      if (quote === "\"" || quote === "'" || quote === "`") {
        const valueStart = index + 1;
        const valueEnd = source.indexOf(quote, valueStart);
        if (valueEnd === -1) {
          value = source.slice(valueStart);
          index = source.length;
        } else {
          value = source.slice(valueStart, valueEnd);
          index = valueEnd + 1;
        }
      } else {
        const valueStart = index;
        while (index < source.length && !isHtmlUnquotedValueTerminator(source[index])) {
          index += 1;
        }
        value = source.slice(valueStart, index);
      }
    }

    if (name) {
      yield { name, value };
    }
  }
}

function findTagEnd(html: string, start: number): number {
  let quote: "\"" | "'" | null = null;

  for (let index = start; index < html.length; index += 1) {
    const character = html[index];

    if (quote) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }

    if (character === ">") {
      return index;
    }
  }

  return html.length;
}

function skipHtmlAttributeDelimiters(source: string, index: number): number {
  let cursor = index;
  while (
    cursor < source.length &&
    (isHtmlWhitespace(source[cursor]) || source[cursor] === "/" || source[cursor] === ">")
  ) {
    cursor += 1;
  }
  return cursor;
}

function skipHtmlWhitespace(source: string, index: number): number {
  let cursor = index;
  while (cursor < source.length && isHtmlWhitespace(source[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function isHtmlWhitespace(character: string | undefined): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\f" ||
    character === "\r"
  );
}

function isAsciiLetter(character: string | undefined): boolean {
  return (
    character !== undefined &&
    ((character >= "a" && character <= "z") || (character >= "A" && character <= "Z"))
  );
}

function isTagNameCharacter(character: string | undefined): boolean {
  return (
    character !== undefined &&
    ((character >= "a" && character <= "z") ||
      (character >= "A" && character <= "Z") ||
      (character >= "0" && character <= "9") ||
      character === ":" ||
      character === "-")
  );
}

function isHtmlAttributeNameTerminator(character: string | undefined): boolean {
  return (
    character === undefined ||
    isHtmlWhitespace(character) ||
    character === "/" ||
    character === ">" ||
    character === "="
  );
}

function isHtmlUnquotedValueTerminator(character: string | undefined): boolean {
  return (
    character === undefined ||
    isHtmlWhitespace(character) ||
    character === ">"
  );
}

function hasUnsafeUrlAttributeValue(attributeName: string, value: string): boolean {
  if (attributeName === "srcdoc") {
    return true;
  }

  if (SRCSET_ATTRIBUTES.has(attributeName)) {
    return hasUnsafeSrcsetValue(value);
  }

  if (URL_LIST_ATTRIBUTES.has(attributeName)) {
    return hasUnsafeUrlListValue(value);
  }

  return hasUnsafeUrlScheme(value);
}

function hasUnsafeUrlListValue(value: string): boolean {
  return value.split(/\s+/).some((candidate) => hasUnsafeUrlScheme(candidate));
}

function hasUnsafeSrcsetValue(value: string): boolean {
  return value.split(",").some((candidate) => {
    const [url] = candidate.trim().split(/\s+/, 1);
    return hasUnsafeUrlScheme(url ?? "");
  });
}

function hasUnsafeUrlScheme(value: string): boolean {
  const decoded = decodeHtmlEntities(value)
    .replace(/^`+|`+$/g, "")
    .replace(/[\u0000-\u001f\u007f\s]+/g, "")
    .toLowerCase();

  return UNSAFE_URL_SCHEME_RE.test(decoded);
}

function decodeHtmlEntities(value: string): string {
  return value.replace(ENTITY_RE, (_match, entity: string) => {
    const normalized = entity.toLowerCase();

    if (normalized.startsWith("#x")) {
      return codePointToString(Number.parseInt(normalized.slice(2), 16));
    }

    if (normalized.startsWith("#")) {
      return codePointToString(Number.parseInt(normalized.slice(1), 10));
    }

    if (normalized === "colon") return ":";
    if (normalized === "tab") return "\t";
    if (normalized === "newline") return "\n";

    return "";
  });
}

function codePointToString(codePoint: number): string {
  if (!Number.isFinite(codePoint)) {
    return "";
  }

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return "";
  }
}
