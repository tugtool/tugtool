/**
 * language-registry.ts — file-extension → CodeMirror 6 language support,
 * lazy-loaded, with a Tug-token-driven highlight style.
 *
 * Lezer (CM6's native grammar system) is the highlighting engine: it
 * parses incrementally at keystroke latency, which is what a live
 * editing surface needs (Shiki, also in this repo, is a static
 * tokenizer used for markdown/diff blocks — the wrong regime here).
 *
 * Grammar modules are heavy, so each language loads through a dynamic
 * `import()` on first use — Vite splits them into separate chunks and
 * the base bundle carries none of them. `TugFileEditor` swaps the
 * resolved extension into its language Compartment when the load
 * settles; plain text renders in the meantime.
 *
 * The highlight style maps Lezer's standard tags to the EXISTING
 * theme-aware syntax palette (`--tug-syntax-*` + `--tugx-syntax-comment`,
 * declared in `tug-code.css` with dark/light variants) — the same
 * palette Shiki-rendered code blocks use, so editor highlighting and
 * transcript highlighting read as one vocabulary and theme switches
 * recolor live with no remount.
 *
 * Shared by design: `TugCodeView` / `FileBlock` can adopt the same
 * registry later to highlight read-only transcript files.
 *
 * @module lib/language-registry
 */

import type { Extension } from "@codemirror/state";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

// ---------------------------------------------------------------------------
// Highlight style — Lezer tags → Tug token slots
// ---------------------------------------------------------------------------

/**
 * Token-driven highlight style. Every color reads a CSS variable so
 * the six themes restyle highlighted code live.
 */
export const tugHighlightStyle: Extension = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: "var(--tug-syntax-keyword)" },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--tug-syntax-string)" },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--tug-syntax-number)" },
    { tag: [tags.comment, tags.blockComment, tags.lineComment], color: "var(--tugx-syntax-comment)", fontStyle: "italic" },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--tug-syntax-function)" },
    { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--tug-syntax-type)" },
    { tag: [tags.propertyName, tags.attributeName], color: "var(--tug-syntax-property)" },
    { tag: [tags.definition(tags.variableName), tags.local(tags.variableName)], color: "var(--tug-syntax-variable)" },
    { tag: [tags.meta, tags.processingInstruction], color: "var(--tug-syntax-decorator)" },
    { tag: tags.heading, color: "var(--tug-syntax-keyword)", fontWeight: "bold" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strong, fontWeight: "bold" },
    { tag: tags.link, color: "var(--tug-syntax-string)", textDecoration: "underline" },
  ]),
);

// ---------------------------------------------------------------------------
// Extension → lazy grammar
// ---------------------------------------------------------------------------

type LanguageLoader = () => Promise<Extension>;

/** Wrap a legacy (CM5) stream parser mode as a CM6 extension. */
function legacy(
  load: () => Promise<{ mode: import("@codemirror/language").StreamParser<unknown> }>,
): LanguageLoader {
  return async () => {
    const [{ StreamLanguage }, { mode }] = await Promise.all([
      import("@codemirror/language"),
      load(),
    ]);
    return StreamLanguage.define(mode);
  };
}

/**
 * Loader table keyed by lowercase file extension (no dot). Kept as
 * data so adding a language is one line.
 */
const LOADERS: Record<string, LanguageLoader> = {
  // Lezer grammars.
  js: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  jsx: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  ts: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true })),
  tsx: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true, jsx: true })),
  mjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  cjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  rs: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  py: () => import("@codemirror/lang-python").then((m) => m.python()),
  json: () => import("@codemirror/lang-json").then((m) => m.json()),
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  htm: () => import("@codemirror/lang-html").then((m) => m.html()),
  md: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  markdown: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  // Legacy stream modes for languages without a maintained Lezer port.
  swift: legacy(async () => {
    const m = await import("@codemirror/legacy-modes/mode/swift");
    return { mode: m.swift };
  }),
  sh: legacy(async () => {
    const m = await import("@codemirror/legacy-modes/mode/shell");
    return { mode: m.shell };
  }),
  bash: legacy(async () => {
    const m = await import("@codemirror/legacy-modes/mode/shell");
    return { mode: m.shell };
  }),
  zsh: legacy(async () => {
    const m = await import("@codemirror/legacy-modes/mode/shell");
    return { mode: m.shell };
  }),
  toml: legacy(async () => {
    const m = await import("@codemirror/legacy-modes/mode/toml");
    return { mode: m.toml };
  }),
  yaml: legacy(async () => {
    const m = await import("@codemirror/legacy-modes/mode/yaml");
    return { mode: m.yaml };
  }),
  yml: legacy(async () => {
    const m = await import("@codemirror/legacy-modes/mode/yaml");
    return { mode: m.yaml };
  }),
  c: legacy(async () => {
    const m = await import("@codemirror/legacy-modes/mode/clike");
    return { mode: m.c };
  }),
  h: legacy(async () => {
    const m = await import("@codemirror/legacy-modes/mode/clike");
    return { mode: m.c };
  }),
  cpp: legacy(async () => {
    const m = await import("@codemirror/legacy-modes/mode/clike");
    return { mode: m.cpp };
  }),
};

/**
 * Display names for the status bar, keyed by lowercase extension. Kept
 * beside {@link LOADERS} so a language's label and grammar stay in sync.
 * Unmapped extensions fall back to "Plain Text".
 */
const LANGUAGE_LABELS: Record<string, string> = {
  js: "JavaScript",
  jsx: "JavaScript (JSX)",
  ts: "TypeScript",
  tsx: "TypeScript (TSX)",
  mjs: "JavaScript",
  cjs: "JavaScript",
  rs: "Rust",
  py: "Python",
  json: "JSON",
  css: "CSS",
  html: "HTML",
  htm: "HTML",
  md: "Markdown",
  markdown: "Markdown",
  swift: "Swift",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  toml: "TOML",
  yaml: "YAML",
  yml: "YAML",
  c: "C",
  h: "C",
  cpp: "C++",
};

/** Human-readable language name for the status bar (or "Plain Text"). */
export function languageLabelFor(path: string | null): string {
  if (path === null) return "Plain Text";
  const ext = fileExtension(path);
  if (ext === null) return "Plain Text";
  return LANGUAGE_LABELS[ext] ?? "Plain Text";
}

/** A user-pickable language for the status-bar file-type popup. */
export interface SelectableLanguage {
  /** Stable id (also the popup value); `"text"` for plain text. */
  id: string;
  /** Display name. */
  label: string;
  /** Representative extension whose grammar to load; null for plain text. */
  ext: string | null;
}

/**
 * The languages offered in the file-type popup, in menu order. One entry
 * per distinct grammar (aliases like js/mjs collapse to one), plus a
 * leading "Plain Text" that clears the grammar.
 */
export const SELECTABLE_LANGUAGES: readonly SelectableLanguage[] = [
  { id: "text", label: "Plain Text", ext: null },
  { id: "md", label: "Markdown", ext: "md" },
  { id: "js", label: "JavaScript", ext: "js" },
  { id: "jsx", label: "JavaScript (JSX)", ext: "jsx" },
  { id: "ts", label: "TypeScript", ext: "ts" },
  { id: "tsx", label: "TypeScript (TSX)", ext: "tsx" },
  { id: "py", label: "Python", ext: "py" },
  { id: "rs", label: "Rust", ext: "rs" },
  { id: "json", label: "JSON", ext: "json" },
  { id: "css", label: "CSS", ext: "css" },
  { id: "html", label: "HTML", ext: "html" },
  { id: "swift", label: "Swift", ext: "swift" },
  { id: "sh", label: "Shell", ext: "sh" },
  { id: "toml", label: "TOML", ext: "toml" },
  { id: "yaml", label: "YAML", ext: "yaml" },
  { id: "c", label: "C", ext: "c" },
  { id: "cpp", label: "C++", ext: "cpp" },
];

/** The selectable-language id that matches `path`'s extension, else "text". */
export function languageIdForPath(path: string | null): string {
  if (path === null) return "text";
  const ext = fileExtension(path);
  if (ext === null) return "text";
  const match = SELECTABLE_LANGUAGES.find((l) => l.ext === ext);
  if (match !== undefined) return match.id;
  // A grammar exists for the ext but it aliases another entry's label
  // (e.g. mjs → JavaScript); map through the label.
  const label = LANGUAGE_LABELS[ext];
  const byLabel = SELECTABLE_LANGUAGES.find((l) => l.label === label);
  return byLabel?.id ?? "text";
}

/** The representative extension for a selectable-language id (null = plain). */
export function extensionForLanguageId(id: string): string | null {
  return SELECTABLE_LANGUAGES.find((l) => l.id === id)?.ext ?? null;
}

/** Resolved-extension cache so each grammar loads once per session. */
const cache = new Map<string, Promise<Extension>>();

/** Lowercase extension of `path` (no dot), or null when it has none. */
export function fileExtension(path: string): string | null {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null;
  return base.slice(dot + 1).toLowerCase();
}

/** Whether `path` has a registered language. */
export function hasLanguageFor(path: string): boolean {
  const ext = fileExtension(path);
  return ext !== null && ext in LOADERS;
}

/**
 * Resolve the language support extension for `path`, loading the
 * grammar chunk on first use. Resolves `null` for unregistered
 * extensions and on load failure (the editor stays plain text).
 */
export function languageFor(path: string): Promise<Extension | null> {
  return languageForExtension(fileExtension(path));
}

/**
 * Resolve the language support extension for a bare file extension
 * (no dot; null for plain text). Same lazy-load + cache as
 * {@link languageFor}; used when the file type is chosen explicitly
 * (the status-bar file-type popup) rather than derived from a path.
 */
export function languageForExtension(ext: string | null): Promise<Extension | null> {
  if (ext === null) return Promise.resolve(null);
  const loader = LOADERS[ext];
  if (loader === undefined) return Promise.resolve(null);
  let pending = cache.get(ext);
  if (pending === undefined) {
    pending = loader();
    cache.set(ext, pending);
  }
  return pending.catch(() => null);
}
