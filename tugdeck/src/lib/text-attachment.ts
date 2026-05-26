/**
 * `text-attachment` — classification + read pipeline for text-typed
 * files dropped into the prompt entry.
 *
 * ## Scope
 *
 * Tug ships dropped / pasted **images** through the
 * `image-downsample` canvas pipeline as `image` content blocks, and
 * **workspace-relative `@`-mentions** as path text that claude
 * `Read`s on demand. This module covers the third case: a text file
 * dragged from Finder (a `README.md` from the user's desktop, a
 * `.json` config, a `.ts` snippet copied to scratch) whose bytes
 * the user expects claude to see.
 *
 * Without this branch, a Finder-dropped text file would surface its
 * filename in `wireText` but the contents would never reach claude
 * — claude has no path to `Read` because the file is outside the
 * workspace. tugcode's `buildContentBlocks` (`session.ts:331-334`)
 * already wraps any non-image `Attachment` in a `text` content
 * block with `att.content` as the body verbatim; this module
 * supplies the matching browser-side capture so the wire ships
 * the file's bytes.
 *
 * ## Out of scope
 *
 * Binary non-image formats (PDF, archives, audio, video) stay
 * deferred indefinitely. `application/pdf` would need an Anthropic
 * `document` content block (see [Q03] in `roadmap/tide-atoms.md`),
 * which the v1 tugcode `buildContentBlocks` does not emit. Other
 * binaries have no place to land in the API today.
 *
 * ## What counts as "text"
 *
 * Two complementary checks. A file is text if:
 *
 *  - its `File.type` starts with `text/` (`text/plain`,
 *    `text/markdown`, `text/csv`, `text/html`, `text/x-python`, …), OR
 *  - its `File.type` is in {@link TEXT_MIME_EXACT} (a curated set
 *    of `application/*` MIMEs that are essentially text — JSON,
 *    YAML, JavaScript, etc.), OR
 *  - its `File.type` is empty (Finder reports no MIME for many
 *    plain extensions like `.ts`, `.rs`) AND the filename's
 *    extension matches {@link TEXT_EXTENSION_ALLOWLIST}.
 *
 * Order matters: callers run image classification first
 * (`classifySourceMime` from `image-downsample.ts`), so an
 * `image/svg+xml` source goes to the image branch (rasterize to
 * PNG) rather than being read as XML text. Only files the image
 * classifier rejects fall through to {@link isTextSource}.
 *
 * ## Sizing
 *
 * Text attachments cap at {@link MAX_TEXT_BYTE_SIZE} (1 MB). Larger
 * payloads are rejected so a stray dropped `package-lock.json`
 * doesn't dominate claude's context window. The cap is independent
 * of the per-image cap because text contributes to a different
 * content-block class (`text` block size is bounded mainly by the
 * request-total ceiling, not a per-block decode budget).
 *
 * Laws: [L02] external state — this module is pure / async-pure,
 *       no React. [L19] file-structure / docstring discipline.
 *
 * References:
 *  - [D02](roadmap/tide-atoms.md#d02-image-attach-text-rest) —
 *    atoms with bytes ride as Attachments; atoms without bytes ride
 *    as substituted text.
 *  - [Spec S02](roadmap/tide-atoms.md#s02-atom-bytes-store) — the
 *    bytes-store entries this module produces use the same
 *    `{content, mediaType}` shape as image entries, with `content`
 *    holding raw text instead of base64.
 *  - tugcode `session.ts:331-334` — non-image `Attachment` shipping
 *    path that consumes what we produce here.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum text-attachment size in bytes (UTF-8 encoded). A stray
 * `package-lock.json` would otherwise eat the request budget; a
 * 1 MB cap keeps text attachments meaningful without spilling.
 *
 * Sized in UTF-8 bytes (not code points / characters) because that
 * is what claude's tokenizer ultimately consumes and what the
 * request-payload byte ceiling measures.
 */
export const MAX_TEXT_BYTE_SIZE = 1 * 1024 * 1024;

/**
 * Exact-match MIME allowlist for `application/*` types that are
 * essentially text. The `text/` prefix check covers everything else.
 *
 * Kept narrow: only formats that meaningfully decode as a single
 * UTF-8 string. Archive / binary types (`application/zip`,
 * `application/octet-stream`) intentionally excluded.
 */
const TEXT_MIME_EXACT: ReadonlySet<string> = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/javascript",
  "application/typescript",
  "application/x-typescript",
  "application/x-sh",
  "application/sql",
  "application/graphql",
]);

/**
 * Extension fallback for files whose `File.type` is empty. Finder
 * reports no MIME for many source-code extensions (`.ts`, `.rs`,
 * `.go`, `.swift`, …) because the macOS UTI table doesn't have
 * an explicit mapping. This list captures the common cases so a
 * user dropping a `.ts` from their editor gets the same behavior
 * they'd get for `.md`.
 *
 * Lowercase, no leading dot. Matches against the substring after
 * the last `.` of the filename.
 */
const TEXT_EXTENSION_ALLOWLIST: ReadonlySet<string> = new Set([
  // Markup / docs
  "txt",
  "md",
  "markdown",
  "rst",
  "adoc",
  "log",
  // Data / config
  "json",
  "yaml",
  "yml",
  "toml",
  "ini",
  "conf",
  "xml",
  "csv",
  "tsv",
  "env",
  "properties",
  // Script / source
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "scala",
  "swift",
  "m",
  "mm",
  "c",
  "cc",
  "cpp",
  "cxx",
  "h",
  "hh",
  "hpp",
  "hxx",
  "cs",
  "fs",
  "fsx",
  "vb",
  "php",
  "lua",
  "pl",
  "pm",
  "r",
  "jl",
  "dart",
  "ex",
  "exs",
  "erl",
  "hs",
  "lhs",
  "ml",
  "mli",
  "nim",
  "zig",
  // Web
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "vue",
  "svelte",
  // Shell
  "sh",
  "bash",
  "zsh",
  "fish",
  "ksh",
  // Query / schema
  "sql",
  "graphql",
  "gql",
  "proto",
  // Build / infra
  "dockerfile",
  "makefile",
  "rakefile",
  "gemfile",
  "podfile",
  "lock",
  "patch",
  "diff",
]);

// ---------------------------------------------------------------------------
// Pure-logic classifier
// ---------------------------------------------------------------------------

/**
 * Strip RFC 6838 parameters from a MIME string and lowercase the
 * type/subtype. Real-world WebKit drag-drop reports bare MIMEs
 * (`"text/plain"`), but some environments append `;charset=utf-8`
 * or similar — Bun's `File` constructor does this for text types,
 * and HTTP-sourced files via fetch might too. Normalizing makes
 * allowlist comparisons robust either way.
 *
 * @example
 * ```ts
 * normalizeMime("text/plain;charset=utf-8") // → "text/plain"
 * normalizeMime("APPLICATION/JSON")           // → "application/json"
 * normalizeMime("")                           // → ""
 * ```
 */
function normalizeMime(mime: string): string {
  const semicolon = mime.indexOf(";");
  return (semicolon >= 0 ? mime.slice(0, semicolon) : mime)
    .trim()
    .toLowerCase();
}

/**
 * MIME-only text-source check. Returns `true` when `mediaType`
 * itself is a known text MIME — without consulting any filename or
 * extension. Used by the `dragover` rejection gate, which has access
 * to `DataTransferItem.type` but cannot read filenames during a
 * drag (a WebKit security restriction: `getAsFile()` returns `null`
 * until drop fires).
 *
 * Stricter than {@link isTextSource}: empty MIME does NOT count as
 * a text source here (we have no extension to fall back on at drag
 * time). At drop time, full classification — including the
 * extension fallback — runs through `isTextSource`.
 *
 * @example
 * ```ts
 * isTextMimeType("text/markdown")            // true
 * isTextMimeType("application/json")         // true
 * isTextMimeType("text/plain;charset=utf-8") // true
 * isTextMimeType("")                         // false (no extension info at dragover)
 * isTextMimeType("application/pdf")          // false
 * ```
 */
export function isTextMimeType(mediaType: string): boolean {
  const type = normalizeMime(mediaType);
  if (type === "") return false;
  if (type.startsWith("text/")) return true;
  return TEXT_MIME_EXACT.has(type);
}

/**
 * Return `true` when `file` looks like a text source the drop /
 * paste pipeline should read into a text Attachment. Pure function —
 * reads `file.type` and `file.name` only.
 *
 * Three-stage check:
 *  1. Normalized MIME starts with `text/`.
 *  2. Normalized MIME is in the `application/*` text allowlist.
 *  3. MIME is empty (Finder didn't infer one) AND the filename's
 *     extension is in the extension allowlist.
 *
 * Callers should run image classification first
 * (`classifySourceMime` from `image-downsample.ts`); SVG and other
 * image MIMEs are NOT counted as text by this function, but they
 * would short-circuit upstream anyway.
 *
 * @example
 * ```ts
 * isTextSource(new File(["x"], "README.md", { type: "text/markdown" }))   // true
 * isTextSource(new File(["x"], "config.toml", { type: "application/toml" })) // true
 * isTextSource(new File(["x"], "snippet.ts", { type: "" }))               // true (extension fallback)
 * isTextSource(new File(["x"], "archive.zip", { type: "application/zip" })) // false
 * isTextSource(new File(["x"], "photo.png", { type: "image/png" }))       // false
 * ```
 */
export function isTextSource(file: File): boolean {
  const type = normalizeMime(file.type);
  if (type.startsWith("text/")) return true;
  if (type !== "" && TEXT_MIME_EXACT.has(type)) return true;
  if (type === "") {
    const name = file.name.toLowerCase();
    const dotIdx = name.lastIndexOf(".");
    if (dotIdx >= 0 && dotIdx < name.length - 1) {
      const ext = name.slice(dotIdx + 1);
      return TEXT_EXTENSION_ALLOWLIST.has(ext);
    }
    // Extensionless empty-MIME files (e.g., `Makefile`, `Dockerfile`,
    // `README`) — accept the common bare names.
    return TEXT_EXTENSION_ALLOWLIST.has(name);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Async read pipeline
// ---------------------------------------------------------------------------

/**
 * Discriminated error from {@link readTextAttachment}. Mirrors the
 * shape `DownsampleError` uses in `image-downsample.ts` so the drop
 * pipeline's error-surface code reads symmetrically across image
 * and text branches.
 */
export type TextAttachmentError =
  | { kind: "too-large"; byteSize: number; cap: number }
  | { kind: "read-failed"; reason: string };

/**
 * Successful read result. `content` is the file's UTF-8 text; the
 * effective `mediaType` is the source's `File.type` when present,
 * otherwise `text/plain` (Finder failed to infer; the bytes are
 * UTF-8 text by virtue of {@link isTextSource} having matched on
 * extension).
 *
 * `byteSize` is the encoded UTF-8 length, not the JS string length.
 * The two differ for any non-ASCII content (emoji, accented Latin,
 * CJK); the wire ceiling is byte-counted, so we surface bytes.
 */
export interface TextAttachmentResult {
  content: string;
  mediaType: string;
  byteSize: number;
}

/**
 * Discriminated outcome. The function never throws — every failure
 * comes back through the `error` arm so the drop pipeline can
 * surface a clean banner without try/catch around every call.
 */
export type TextAttachmentOutcome =
  | { ok: true; result: TextAttachmentResult }
  | { ok: false; error: TextAttachmentError };

/**
 * Read `file` as UTF-8 text, validating size. Returns the raw text
 * + the effective MIME for the bytes-store entry.
 *
 * The size check is post-decode: we read the file, measure UTF-8
 * bytes, then either accept or reject. Two-pass would be faster
 * for huge inputs but text-attachment cap is 1 MB so the
 * difference is immaterial.
 *
 * @example
 * ```ts
 * const out = await readTextAttachment(file);
 * if (!out.ok) {
 *   surface(describeTextAttachmentError(out.error, file.name));
 *   return;
 * }
 * bytesStore.put(id, { content: out.result.content, mediaType: out.result.mediaType });
 * ```
 */
export async function readTextAttachment(
  file: File,
): Promise<TextAttachmentOutcome> {
  let content: string;
  try {
    content = await file.text();
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "read-failed",
        reason: err instanceof Error ? err.message : String(err),
      },
    };
  }
  // UTF-8 byte length — `Blob.size` (post-decode) is not available
  // here since `file.text()` already converted to a string. Use
  // `TextEncoder` so the measurement matches what the wire actually
  // ships.
  const byteSize = new TextEncoder().encode(content).byteLength;
  if (byteSize > MAX_TEXT_BYTE_SIZE) {
    return {
      ok: false,
      error: { kind: "too-large", byteSize, cap: MAX_TEXT_BYTE_SIZE },
    };
  }
  // Effective MIME: prefer the source's reported type (stripped of
  // any `;charset=...` parameter — the wire shape carries the
  // canonical `type/subtype`); fall back to `text/plain` when the
  // file came through with no MIME at all (passed
  // {@link isTextSource} via the extension allowlist, so it is
  // UTF-8 text).
  const normalized = normalizeMime(file.type);
  const mediaType = normalized !== "" ? normalized : "text/plain";
  return { ok: true, result: { content, mediaType, byteSize } };
}

/**
 * Convert a `TextAttachmentError` into a user-facing banner string.
 * Mirrors `describeDownsampleError` in `drop-extension.ts`.
 */
export function describeTextAttachmentError(
  err: TextAttachmentError,
  filename: string,
): string {
  switch (err.kind) {
    case "too-large": {
      const mb = (err.byteSize / 1024 / 1024).toFixed(2);
      const capMb = (err.cap / 1024 / 1024).toFixed(0);
      return `Text file too large: ${filename} (${mb} MB exceeds ${capMb} MB cap)`;
    }
    case "read-failed":
      return `Could not read text file: ${filename} (${err.reason})`;
  }
}
