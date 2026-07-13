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
 * the base bundle carries none of them. `TugTextCardEditor` swaps the
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

import { EditorState, type Extension } from "@codemirror/state";
import {
  syntaxHighlighting,
  HighlightStyle,
  ensureSyntaxTree,
  syntaxTree,
} from "@codemirror/language";
import { highlightTree, tags } from "@lezer/highlight";
import { StyleModule } from "style-mod";

// ---------------------------------------------------------------------------
// Highlight style — Lezer tags → Tug token slots
// ---------------------------------------------------------------------------

/**
 * Raw token-driven highlight style — the single source of truth for the
 * Lezer-tag → Tug-token-slot mapping. Every color reads a CSS variable
 * so the six themes restyle highlighted code live.
 *
 * Used two ways from one definition, so the live editor and every static
 * transcript surface color identically: wrapped in `syntaxHighlighting`
 * for the editor ({@link tugHighlightStyle}), and passed directly to
 * `highlightTree` for static fragment tokenization ({@link
 * tokenizeFragment}). The tag map is deliberately broad — operators,
 * punctuation, constants, tags, and attributes each land in their own
 * slot — so diffs and read/write snippets read as richly as the editor.
 */
export const tugHighlightStyleInner = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.self], color: "var(--tug-syntax-keyword)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.character], color: "var(--tug-syntax-string)" },
  { tag: tags.escape, color: "var(--tug-syntax-string-expression)" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--tug-syntax-number)" },
  { tag: [tags.comment, tags.blockComment, tags.lineComment, tags.docComment], color: "var(--tugx-syntax-comment)", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--tug-syntax-function)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--tug-syntax-type)" },
  { tag: tags.propertyName, color: "var(--tug-syntax-property)" },
  { tag: [tags.definition(tags.variableName), tags.local(tags.variableName)], color: "var(--tug-syntax-variable)" },
  { tag: [tags.constant(tags.variableName), tags.standard(tags.name), tags.labelName], color: "var(--tug-syntax-constant)" },
  { tag: [tags.meta, tags.processingInstruction, tags.annotation], color: "var(--tug-syntax-decorator)" },
  { tag: tags.tagName, color: "var(--tug-syntax-tag)" },
  { tag: tags.attributeName, color: "var(--tug-syntax-attribute)" },
  { tag: [tags.operator, tags.compareOperator, tags.logicOperator, tags.arithmeticOperator, tags.bitwiseOperator, tags.updateOperator, tags.definitionOperator, tags.typeOperator, tags.derefOperator], color: "var(--tugx-syntax-operator)" },
  { tag: [tags.punctuation, tags.separator, tags.bracket, tags.angleBracket, tags.squareBracket, tags.paren, tags.brace], color: "var(--tugx-syntax-punctuation)" },
  { tag: tags.heading, color: "var(--tug-syntax-keyword)", fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.monospace, color: "var(--tug-syntax-code)" },
  { tag: [tags.link, tags.url], color: "var(--tug-syntax-string)", textDecoration: "underline" },
]);

/** Editor-extension form of {@link tugHighlightStyleInner}. */
export const tugHighlightStyle: Extension = syntaxHighlighting(tugHighlightStyleInner);

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
  go: () => import("@codemirror/lang-go").then((m) => m.go()),
  java: () => import("@codemirror/lang-java").then((m) => m.java()),
  sql: () => import("@codemirror/lang-sql").then((m) => m.sql()),
  // Legacy stream modes for languages without a maintained Lezer port.
  dockerfile: legacy(async () => {
    const m = await import("@codemirror/legacy-modes/mode/dockerfile");
    return { mode: m.dockerFile };
  }),
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
  go: "Go",
  java: "Java",
  sql: "SQL",
  dockerfile: "Dockerfile",
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
  { id: "go", label: "Go", ext: "go" },
  { id: "java", label: "Java", ext: "java" },
  { id: "sql", label: "SQL", ext: "sql" },
  { id: "dockerfile", label: "Dockerfile", ext: "dockerfile" },
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

// ---------------------------------------------------------------------------
// Language-id aliasing (markdown fences / diff language labels)
// ---------------------------------------------------------------------------

/**
 * Map a free-form language id (as it appears in a markdown fence
 * `language-X` class or a diff's detected language) to the registry's
 * extension key. Only ids that don't already match an extension need an
 * entry; everything else falls through to the id itself (so `"ts"`,
 * `"py"`, … work unchanged). Unknown ids resolve to plain text.
 */
const LANG_ID_ALIASES: Record<string, string> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  rust: "rs",
  golang: "go",
  shell: "sh",
  shellscript: "sh",
  bash: "sh",
  zsh: "sh",
  "c++": "cpp",
  cxx: "cpp",
  yml: "yaml",
  markdown: "md",
  docker: "dockerfile",
  htm: "html",
};

/** Resolve a language id/alias to a registered extension key, or null. */
function extForLangId(langId: string): string | null {
  const id = langId.toLowerCase().trim();
  if (id === "") return null;
  const aliased = LANG_ID_ALIASES[id] ?? id;
  return aliased in LOADERS ? aliased : null;
}

/**
 * Resolve the language support extension for a free-form language id
 * (a markdown fence tag, a `TugCodeView` `language` prop), lazy-loading
 * the grammar chunk. Resolves `null` for unknown ids / load failure so
 * the surface stays plain text.
 */
export function languageForLangId(langId: string): Promise<Extension | null> {
  return languageForExtension(extForLangId(langId));
}

// ---------------------------------------------------------------------------
// Static fragment tokenization (diff hunks, read/write snippets, fences)
// ---------------------------------------------------------------------------

/** One syntax run within a single line of a fragment (line-relative). */
export interface FragmentToken {
  /** Start column in the line (inclusive). */
  start: number;
  /** End column in the line (exclusive). */
  end: number;
  /** Generated highlight class(es) from {@link tugHighlightStyleInner}. */
  className: string;
}

/** Cap on the forced parse of one fragment; on timeout we fall back to
 *  whatever the incremental tree already covers (plain text at worst). */
const PARSE_TIMEOUT_MS = 100;

/** The highlight style's generated CSS is mounted once, lazily, so the
 *  classes `highlightTree` emits resolve to `--tug-syntax-*` colors even
 *  outside a live `EditorView` (which would mount it itself). */
let highlightModuleMounted = false;
function ensureHighlightModuleMounted(): void {
  if (highlightModuleMounted) return;
  if (typeof document === "undefined") return;
  const mod = tugHighlightStyleInner.module;
  if (mod !== null) StyleModule.mount(document, mod);
  highlightModuleMounted = true;
}

/** Offsets of each line's first character in `text` (index 0 = line 0). */
function lineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
  }
  return starts;
}

/** Index of the line containing absolute offset `pos`. */
function lineIndexAt(starts: number[], pos: number): number {
  // Linear from a hint would suffice, but a small binary search keeps
  // whole-file snippets cheap.
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Tokenize `text` through a resolved CodeMirror language extension and
 * return per-line syntax runs. Line N of the input maps to result[N].
 *
 * Builds a headless `EditorState` over the fragment, forces a full parse
 * (`ensureSyntaxTree`), and walks `highlightTree` with the shared
 * {@link tugHighlightStyleInner} — the exact grammar + style the live
 * editor uses, so a fragment colors identically to the same file open in
 * a Text card. A styled run that spans a line break (e.g. a block
 * comment) is split at line boundaries so each line owns its own runs.
 */
async function tokenizeWithExtension(
  text: string,
  languageExt: Extension | null,
): Promise<FragmentToken[][]> {
  const starts = lineStartOffsets(text);
  const perLine: FragmentToken[][] = starts.map(() => []);
  if (languageExt === null || text.length === 0) return perLine;
  ensureHighlightModuleMounted();
  const state = EditorState.create({ doc: text, extensions: [languageExt] });
  const tree = ensureSyntaxTree(state, text.length, PARSE_TIMEOUT_MS) ?? syntaxTree(state);
  highlightTree(tree, tugHighlightStyleInner, (from, to, className) => {
    const first = lineIndexAt(starts, from);
    for (let line = first; line < starts.length && starts[line] < to; line++) {
      // Line content excludes its trailing newline.
      const contentEnd = line + 1 < starts.length ? starts[line + 1] - 1 : text.length;
      const segStart = Math.max(from, starts[line]);
      const segEnd = Math.min(to, contentEnd);
      if (segEnd > segStart) {
        perLine[line].push({
          start: segStart - starts[line],
          end: segEnd - starts[line],
          className,
        });
      }
    }
  });
  return perLine;
}

/** Per-line syntax runs for `text`, keyed by lowercase file extension. */
export async function tokenizeFragment(
  text: string,
  ext: string | null,
): Promise<FragmentToken[][]> {
  return tokenizeWithExtension(text, await languageForExtension(ext));
}

/** Per-line syntax runs for `text`, keyed by a language id/alias. */
export async function tokenizeFragmentByLangId(
  text: string,
  langId: string,
): Promise<FragmentToken[][]> {
  return tokenizeWithExtension(text, await languageForExtension(extForLangId(langId)));
}

/** Escape the five HTML-significant characters for safe innerHTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Highlight `text` to an HTML string (class-per-token `<span>`s, classes
 * only — no inline styles), suitable for a `<code>` element's innerHTML.
 * Lines are joined with `\n`; unstyled gaps are emitted as escaped text.
 * Unknown languages return the whole text escaped and uncolored.
 */
export async function highlightFragmentToHtml(
  text: string,
  langId: string,
): Promise<string> {
  const perLine = await tokenizeFragmentByLangId(text, langId);
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const runs = perLine[i] ?? [];
    let col = 0;
    for (const run of runs) {
      if (run.start > col) out.push(escapeHtml(line.slice(col, run.start)));
      out.push(
        `<span class="${run.className}">${escapeHtml(line.slice(run.start, run.end))}</span>`,
      );
      col = run.end;
    }
    if (col < line.length) out.push(escapeHtml(line.slice(col)));
    if (i < lines.length - 1) out.push("\n");
  }
  return out.join("");
}
