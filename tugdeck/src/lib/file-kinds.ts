/**
 * file-kinds.ts — which card a path opens into, decided by extension.
 *
 * The deck edits text and *views* everything else. This module is the one
 * place that draws that line: `classifyFileKind` maps a path to the kind of
 * card it belongs in, and every open flows through it via
 * `openFileInCard`.
 *
 * The table is a closed allowlist, never a conformance test. Camera RAW
 * conforms to `public.image` but WebKit's `<img>` cannot reliably decode it,
 * so a type appears here only when the deck can actually render it. Anything
 * unlisted classifies as `"text"` and takes the Text card path unchanged.
 *
 * The same extension list lives in tugcast's `fs_blob.rs` MIME table and in
 * `AppDelegate.viewableContentTypes`; all three move together when a type is
 * added.
 *
 * @module lib/file-kinds
 */

/** The card family a path opens into. */
export type FileKind = "text" | "image" | "pdf";

/**
 * Extensions the deck can display, lowercase and without the dot. Any
 * extension absent from this map is text.
 */
export const VIEWABLE_EXTENSIONS: Readonly<Record<string, FileKind>> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  jfif: "image",
  gif: "image",
  webp: "image",
  heic: "image",
  heif: "image",
  avif: "image",
  tiff: "image",
  tif: "image",
  bmp: "image",
  ico: "image",
  pdf: "pdf",
};

/**
 * The lowercase extension of `path` without its dot, or null when the
 * basename has none (or is a dotfile like `.env`, whose leading dot names
 * the file rather than an extension).
 */
export function extensionOf(path: string): string | null {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  const dot = basename.lastIndexOf(".");
  if (dot <= 0) return null;
  return basename.slice(dot + 1).toLowerCase();
}

/** The card family `path` opens into. */
export function classifyFileKind(path: string): FileKind {
  const ext = extensionOf(path);
  if (ext === null) return "text";
  return VIEWABLE_EXTENSIONS[ext] ?? "text";
}

/** True when `path` opens into a read-only viewer card rather than a Text card. */
export function isViewableFile(path: string): boolean {
  return classifyFileKind(path) !== "text";
}

/**
 * The tugcast URL a viewer card points an `<img>` / `<embed>` at. Relative,
 * so it resolves against the page origin in both serving modes — tugcast
 * serving the built frontend, and the Vite dev server proxying `/api`.
 */
export function blobUrl(path: string): string {
  return `/api/fs/blob?path=${encodeURIComponent(path)}`;
}
