/**
 * `FileBlock` — Layer-1 body kind for read-only file viewing.
 *
 * Renders a file's contents inline in the transcript with a
 * line-numbered gutter, a "Showing N of M lines" header, an
 * extension-derived language label, optional Shiki syntax
 * highlighting, click-line-to-copy, in-instance Cmd+F search, and
 * collapse-by-default for long files. Composed by the Layer-2
 * wrappers `ReadToolBlock` (#step-8) and `WriteToolBlock` (later) per
 * Table T02; reachable directly from `RenderInput`-routed body kinds
 * whose data shape is "a file the user wants to look at."
 *
 * Why a body kind, not a tool wrapper:
 *   FileBlock holds the rendering for a single rectangle of file
 *   content — gutter, content, and the file-scoped affordances. The
 *   tool-specific framing (path-shortening header, line-range badge,
 *   "showing N of M" footer derived from the structured result)
 *   lives in the wrapper that composes us. This is the [D05]
 *   two-layer split.
 *
 * Render strategy (no streaming — Table T01: FileBlock streams = no):
 *   - Synchronous React render lays out the gutter + content rows so
 *     the layout is correct on first paint and predictable in tests.
 *   - When a language is detectable from the file extension, an
 *     async effect kicks Shiki off in parallel; on resolve, the
 *     per-line highlighted HTML is written into the line content
 *     elements directly (DOM-imperative per [L06]). Shiki failures
 *     leave the plain-text fallback in place.
 *   - Collapse is logical state, not appearance — the *number* of
 *     rendered rows changes, so it lives in `useState` (controllable
 *     via the [Spec S02] `collapsed` / `onToggleCollapsed` props).
 *     The audit (§5.1) puts the threshold at 80 lines (Read P50 = 50,
 *     so 50 was too aggressive — it would fold half of every file).
 *   - Search is in-instance: the document-level Cmd+F is intercepted
 *     only when this FileBlock contains the active element. Match
 *     highlighting is applied to a parallel layer of `<mark>` spans
 *     so it works whether or not Shiki has finished.
 *
 * Laws:
 *  - [L03] `useLayoutEffect` for the Cmd+F document listener so the
 *    handler is registered before any keystroke can land between
 *    mount and paint.
 *  - [L06] appearance — the search match-highlight, the Shiki swap,
 *    and the copied-line flash all write the DOM directly. React
 *    state holds only logical UI state (collapsed, searchOpen,
 *    query, matchIndex).
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="file-body"` on the root, this docstring.
 *  - [L20] component-token sovereignty — owns the `--tugx-file-*`
 *    slot family ([Table T07]).
 *
 * Decisions:
 *  - [D05] two-layer split: body kind (this file) vs. tool wrapper
 *    (read-tool-block.tsx in #step-8).
 *  - [D06] Shiki for syntax highlighting; lazy language load to keep
 *    the initial bundle small. The 17-language warm set in
 *    `code-block-utils.ts` covers the audit's top hits (84% of files
 *    are no-language anyway, per audit §5.4).
 *  - Audit §5.1: collapse threshold = 80 lines.
 *
 * @module components/tugways/body-kinds/file-block
 */

import "./file-block.css";

import React from "react";
import { ChevronsDown, ChevronsUp } from "lucide-react";

import { TugCue } from "@/components/tugways/tug-cue";
import { TugIconButton } from "@/components/tugways/tug-icon-button";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Structured file-view data — the body's render input.
 *
 * `content` is the literal text of the (possibly windowed) file
 * region the producer wants to show. `startLine` (1-based) and
 * `numLines` describe what region of the source file this content
 * came from; `totalLines` (when known) drives the "Showing N of M"
 * header. All three are optional because they aren't always
 * meaningful (e.g., a generated paste has no source-file extent).
 */
export interface FileData {
  /**
   * Source path, used for language detection and the (consumer-owned)
   * header label. May be empty — "" disables both.
   */
  filePath: string;

  /** File contents to render, as a single newline-separated string. */
  content: string;

  /**
   * 1-based line number of the first line of `content`. Defaults to
   * 1 when omitted.
   */
  startLine?: number;

  /**
   * Number of lines this view actually shows. When omitted, computed
   * from `content`. Mostly redundant with the parsed line count, but
   * useful when the producer knows the count up front (e.g., a Read
   * with `limit` set).
   */
  numLines?: number;

  /**
   * Total lines in the source file (not just the rendered window).
   * Drives the "Showing N of M lines" header. When equal to or less
   * than `numLines`, the header simplifies to "N lines" — a partial
   * window is the only case where M is interesting.
   */
  totalLines?: number;
}

export interface FileBlockProps {
  /**
   * The file data to render. When undefined, the block renders
   * nothing visible (empty `data-slot="file-body"` for layout
   * consistency).
   */
  data?: FileData;

  /**
   * Initial collapse state ([Spec S02]). When undefined, the
   * component picks the default from `collapseThreshold`: collapsed
   * if the line count exceeds the threshold, expanded otherwise.
   */
  collapsed?: boolean;

  /**
   * Notification callback fired when the user toggles the
   * collapsed state. Stateless when omitted (the component still
   * tracks local state internally — this is uncontrolled-mode).
   */
  onToggleCollapsed?: (next: boolean) => void;

  /** Forwarded class name for cascade-scoped customization. */
  className?: string;

  /**
   * Threshold for default-folded behavior. Defaults to
   * `DEFAULT_COLLAPSE_THRESHOLD` (80, per audit §5.1). Files at or
   * below this many lines render expanded by default; files above it
   * fold by default.
   */
  collapseThreshold?: number;

  /**
   * "Embedded" mode — composed inside a host that already paints a
   * container and a header (e.g. `ToolWrapperChrome` in
   * `ReadToolBlock`). When `true`:
   *
   *   - The standalone frame (background / border / radius / outer
   *     margin) is dropped so the body sits flush with the host.
   *   - FileBlock's own header (basename + lang badge + line counts +
   *     search toggle + collapse toggle) is hidden — the wrapper
   *     owns the file's identity in its own header. Search /
   *     collapse affordances are deferred to the wrapper UX.
   *
   * Default `false` — standalone usage (gallery, RenderInput-routed)
   * keeps its frame and header.
   *
   * @default false
   */
  embedded?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default-collapse threshold in lines. 80 per the session-audit
 * §5.1: Read P50 = 50 so the previous threshold of 50 folded half of
 * every file by default — too aggressive. 80 lines catches the upper
 * ~40% — long enough to scan-or-skip, short enough not to fold the
 * average file.
 */
export const DEFAULT_COLLAPSE_THRESHOLD = 80;

const DATA_SLOT_ROOT = "file-body";

const DATA_SLOT_HEADER = "file-header";
const DATA_SLOT_BODY = "file-body-rows";
const DATA_SLOT_ROW = "file-row";
const DATA_SLOT_GUTTER = "file-gutter";
const DATA_SLOT_CONTENT = "file-content";
const DATA_SLOT_SEARCH_TOGGLE = "file-search-toggle";
const DATA_SLOT_SEARCH_BAR = "file-search-bar";
const DATA_SLOT_SEARCH_INPUT = "file-search-input";
const DATA_SLOT_SEARCH_PREV = "file-search-prev";
const DATA_SLOT_SEARCH_NEXT = "file-search-next";
const DATA_SLOT_SEARCH_COUNT = "file-search-count";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Map filename extension → Shiki language identifier. Covers the
 * languages we ship preloaded plus a handful Shiki can lazy-load.
 * Returns `undefined` when the extension is unknown — the component
 * then renders plain monospace, which per audit §5.4 is the dominant
 * case anyway (84% of fenced blocks have no language).
 */
const EXT_TO_LANG: Readonly<Record<string, string>> = Object.freeze({
  ts: "typescript",
  tsx: "tsx",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyi: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  cs: "csharp",
  fs: "fsharp",
  ml: "ocaml",
  hs: "haskell",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  clj: "clojure",
  cljs: "clojure",
  scala: "scala",
  groovy: "groovy",
  lua: "lua",
  php: "php",
  pl: "perl",
  pm: "perl",
  r: "r",
  jl: "julia",
  zig: "zig",
  v: "v",
  dart: "dart",
  vue: "vue",
  svelte: "svelte",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  fish: "shellscript",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  md: "markdown",
  markdown: "markdown",
  mdx: "mdx",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  sql: "sql",
  dockerfile: "dockerfile",
  makefile: "makefile",
  proto: "proto",
  graphql: "graphql",
  gql: "graphql",
  tex: "latex",
  diff: "diff",
  patch: "diff",
});

/**
 * Detect the Shiki language identifier for a file path, by extension.
 * Returns `undefined` when the extension is unknown.
 *
 * Special-cases bare filenames whose name is itself the language hint
 * (Dockerfile, Makefile) since they have no extension.
 */
export function detectLanguage(filePath: string): string | undefined {
  const base = filePath.split(/[\\/]/).pop() ?? "";
  if (base === "") return undefined;
  if (base === "Dockerfile") return "dockerfile";
  if (base === "Makefile" || base === "makefile") return "makefile";

  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return undefined;
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_TO_LANG[ext];
}

/**
 * Split content into an array of lines. The trailing newline (if
 * present) does NOT produce a final empty line — the editor
 * convention. An empty string returns `[]`.
 */
export function splitContentLines(content: string): string[] {
  if (content.length === 0) return [];
  const parts = content.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/**
 * Compose the "Showing N of M lines" header label.
 *  - When `totalLines` is unknown or equals `numLines`, returns
 *    "N lines".
 *  - When `totalLines > numLines`, returns
 *    "Showing N of M lines".
 */
export function composeLineCountLabel(
  numLines: number,
  totalLines: number | undefined,
): string {
  if (totalLines === undefined || totalLines <= numLines) {
    return `${numLines} ${numLines === 1 ? "line" : "lines"}`;
  }
  return `Showing ${numLines} of ${totalLines} lines`;
}

/** Last segment of a path, with leading "/" stripped. Empty input → "". */
export function basename(filePath: string): string {
  if (filePath.length === 0) return "";
  const segments = filePath.split(/[\\/]/);
  return segments[segments.length - 1] ?? "";
}

/**
 * Match a literal substring in a line, returning the [start, end]
 * ranges of every occurrence. Case-insensitive. Returns `[]` for an
 * empty query — the search bar shows zero matches without highlighting
 * the entire content.
 */
export function findMatches(
  text: string,
  query: string,
): Array<[number, number]> {
  if (query.length === 0) return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const ranges: Array<[number, number]> = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    ranges.push([at, at + needle.length]);
    from = at + needle.length;
  }
  return ranges;
}

// ---------------------------------------------------------------------------
// Highlighting — Shiki is loaded asynchronously per [D06].
// ---------------------------------------------------------------------------

/**
 * Pluggable async highlight function. The default implementation
 * uses the existing project-wide Shiki singleton from
 * `code-block-utils.ts`. Overridable via `injectHighlighter` for
 * tests and gallery cards.
 */
export type LineHighlighter = (
  content: string,
  language: string,
) => Promise<string[] | null>;

let _highlighter: LineHighlighter | null = null;

/**
 * Replace the highlighter implementation. Tests pass a synchronous
 * stub here so the Shiki path is exercised without touching the
 * shared singleton. Pass `null` to restore the default.
 */
export function injectHighlighter(impl: LineHighlighter | null): void {
  _highlighter = impl;
}

/**
 * Highlight content as an array of HTML strings, one per line.
 * Lazy-loads Shiki on first use; resolves to `null` when the
 * language is unsupported or Shiki isn't available (the caller then
 * keeps the plain-text fallback).
 */
async function highlightLines(
  content: string,
  language: string,
): Promise<string[] | null> {
  if (_highlighter !== null) {
    return _highlighter(content, language);
  }
  try {
    const utils = await import(
      "@/_archive/cards/conversation/code-block-utils"
    );
    const highlighter = await utils.getHighlighter();
    const normalized = utils.normalizeLanguage(language);
    const loaded = highlighter.getLoadedLanguages() as string[];
    if (!loaded.includes(normalized)) {
      try {
        await (highlighter as { loadLanguage: (l: string) => Promise<void> })
          .loadLanguage(normalized);
      } catch {
        return null;
      }
    }
    const html = highlighter.codeToHtml(content, {
      lang: normalized,
      theme: "github-dark",
    });
    // Shiki output: <pre …><code>(<span class="line">…</span>\n)+</code></pre>
    const lineMatches = html.match(
      /<span class="line"[^>]*>[\s\S]*?<\/span>(?=\n|<\/code>)/g,
    );
    if (lineMatches === null) return null;
    return lineMatches;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Match-highlight DOM mutation
// ---------------------------------------------------------------------------

/**
 * For each `<.tugx-file-content>` row, paint match highlights as a
 * sibling overlay element rather than wrapping the existing content —
 * the existing content might be highlighted HTML from Shiki, and
 * surgery on that risks breaking spans. The overlay is plain-text
 * and uses CSS to position over the same baseline.
 *
 * Returns the flat list of rendered match elements in document order
 * so the caller can scroll / focus the active one.
 */
function paintMatchOverlay(
  body: HTMLElement,
  lines: string[],
  query: string,
  activeMatchIndex: number,
): HTMLElement[] {
  const matches: HTMLElement[] = [];
  const rows = body.querySelectorAll<HTMLElement>(
    `[data-slot="${DATA_SLOT_ROW}"]`,
  );
  rows.forEach((row) => {
    const overlay = row.querySelector<HTMLElement>(".tugx-file-overlay");
    if (overlay === null) return;
    overlay.replaceChildren();
    overlay.style.display = query.length === 0 ? "none" : "";
  });

  if (query.length === 0) return matches;

  rows.forEach((row, index) => {
    const lineText = lines[index] ?? "";
    const overlay = row.querySelector<HTMLElement>(".tugx-file-overlay");
    if (overlay === null) return;

    const ranges = findMatches(lineText, query);
    if (ranges.length === 0) return;

    let cursor = 0;
    for (const [start, end] of ranges) {
      if (start > cursor) {
        overlay.appendChild(
          document.createTextNode(lineText.slice(cursor, start)),
        );
      }
      const mark = document.createElement("mark");
      mark.className = "tugx-file-mark";
      mark.dataset.slot = "file-search-match";
      mark.textContent = lineText.slice(start, end);
      overlay.appendChild(mark);
      matches.push(mark);
      cursor = end;
    }
    if (cursor < lineText.length) {
      overlay.appendChild(
        document.createTextNode(lineText.slice(cursor)),
      );
    }
  });

  matches.forEach((m, i) => {
    if (i === activeMatchIndex) {
      m.classList.add("tugx-file-mark--active");
      m.dataset.active = "true";
    } else {
      m.classList.remove("tugx-file-mark--active");
      m.dataset.active = "false";
    }
  });

  return matches;
}

// ---------------------------------------------------------------------------
// Icons (lucide-style 14×14)
// ---------------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

function buildSearchIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const c = document.createElementNS(SVG_NS, "circle");
  c.setAttribute("cx", "11");
  c.setAttribute("cy", "11");
  c.setAttribute("r", "7");
  svg.appendChild(c);
  const l = document.createElementNS(SVG_NS, "line");
  l.setAttribute("x1", "21");
  l.setAttribute("y1", "21");
  l.setAttribute("x2", "16.65");
  l.setAttribute("y2", "16.65");
  svg.appendChild(l);
  return svg;
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

const EMPTY_CONTENT_LINES: string[] = [];

export const FileBlock: React.FC<FileBlockProps> = ({
  data,
  collapsed: collapsedProp,
  onToggleCollapsed,
  className,
  collapseThreshold = DEFAULT_COLLAPSE_THRESHOLD,
  embedded = false,
}) => {
  // -- Lines, language, header label -----------------------------------------

  const lines = React.useMemo(
    () => (data === undefined ? EMPTY_CONTENT_LINES : splitContentLines(data.content)),
    [data?.content],
  );
  const startLine = data?.startLine ?? 1;
  const language = React.useMemo(
    () => (data === undefined ? undefined : detectLanguage(data.filePath)),
    [data?.filePath],
  );
  const numLines = data?.numLines ?? lines.length;
  const headerLabel = composeLineCountLabel(numLines, data?.totalLines);

  // -- Collapse: controlled-ish (initial from prop, internal updates) --------

  const overThreshold = lines.length > collapseThreshold;
  const initialCollapsed =
    collapsedProp !== undefined ? collapsedProp : overThreshold;
  const [collapsed, setCollapsed] = React.useState<boolean>(initialCollapsed);

  // Sync to controlled prop when it changes upstream (lets parents
  // drive collapse from chrome elsewhere in the row).
  React.useEffect(() => {
    if (collapsedProp !== undefined) setCollapsed(collapsedProp);
  }, [collapsedProp]);

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      onToggleCollapsed?.(next);
      return next;
    });
  }, [onToggleCollapsed]);

  // -- Search state ----------------------------------------------------------

  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const [searchOpen, setSearchOpen] = React.useState<boolean>(false);
  const [query, setQuery] = React.useState<string>("");
  const [matchCount, setMatchCount] = React.useState<number>(0);
  const [activeMatch, setActiveMatch] = React.useState<number>(0);

  // Open / close search; closing also clears the highlight.
  const closeSearch = React.useCallback(() => {
    setSearchOpen(false);
    setQuery("");
    setMatchCount(0);
    setActiveMatch(0);
    if (searchInputRef.current !== null) {
      searchInputRef.current.value = "";
    }
  }, []);

  const openSearch = React.useCallback(() => {
    if (collapsed) {
      setCollapsed(false);
      onToggleCollapsed?.(false);
    }
    setSearchOpen(true);
  }, [collapsed, onToggleCollapsed]);

  // Cmd+F (Ctrl+F) intercept — only when this FileBlock is focused
  // or contains the active element. [L03] mount in useLayoutEffect so
  // a keystroke between mount and paint doesn't reach the browser.
  React.useLayoutEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      const root = rootRef.current;
      if (root === null) return;
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const inThisBlock =
        document.activeElement !== null &&
        root.contains(document.activeElement);
      if (meta && key === "f" && inThisBlock) {
        e.preventDefault();
        e.stopPropagation();
        openSearch();
        // Defer focus to after state-flush so the rendered input
        // exists in the DOM.
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
        window.setTimeout(() => searchInputRef.current?.select(), 0);
      } else if (e.key === "Escape" && searchOpen && inThisBlock) {
        e.preventDefault();
        closeSearch();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [openSearch, closeSearch, searchOpen]);

  // -- Search match-overlay paint --------------------------------------------

  React.useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body === null) return;
    const matches = paintMatchOverlay(body, lines, query, activeMatch);
    setMatchCount(matches.length);
    if (matches.length > 0) {
      const safeIndex = Math.min(activeMatch, matches.length - 1);
      const target = matches[safeIndex];
      if (typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ block: "nearest" });
      }
    }
  }, [query, lines, activeMatch, collapsed]);

  // Reset match index when the query changes.
  React.useEffect(() => {
    setActiveMatch(0);
  }, [query]);

  // -- Search nav ------------------------------------------------------------

  const stepMatch = React.useCallback(
    (delta: 1 | -1) => {
      setActiveMatch((current) => {
        if (matchCount === 0) return 0;
        const next = (current + delta + matchCount) % matchCount;
        return next;
      });
    },
    [matchCount],
  );

  const onSearchKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        stepMatch(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeSearch();
      }
    },
    [stepMatch, closeSearch],
  );

  // -- Click-line-to-copy ----------------------------------------------------

  const onRowClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const row = e.currentTarget;
      const text = row.dataset.text ?? "";
      const writeText = navigator.clipboard?.writeText.bind(navigator.clipboard);
      if (writeText === undefined) return;
      writeText(text)
        .then(() => {
          row.classList.add("is-copied");
          window.setTimeout(() => row.classList.remove("is-copied"), 800);
        })
        .catch(() => {
          // Swallow — failure is silent; the user simply doesn't see
          // the confirmation flash.
        });
    },
    [],
  );

  // -- Async Shiki highlight -------------------------------------------------

  React.useEffect(() => {
    if (data === undefined) return;
    if (language === undefined) return;
    if (lines.length === 0) return;

    let cancelled = false;
    (async () => {
      const highlighted = await highlightLines(data.content, language);
      if (cancelled) return;
      const body = bodyRef.current;
      if (body === null) return;
      if (highlighted === null) return;

      const rows = body.querySelectorAll<HTMLElement>(
        `[data-slot="${DATA_SLOT_ROW}"]`,
      );
      rows.forEach((row, i) => {
        const contentEl = row.querySelector<HTMLElement>(
          `[data-slot="${DATA_SLOT_CONTENT}"]`,
        );
        if (contentEl === null) return;
        const lineHtml = highlighted[i];
        if (lineHtml === undefined) return;
        contentEl.innerHTML = lineHtml;
        contentEl.dataset.highlighted = "true";
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [data?.content, language, lines.length]);

  // -- Render ----------------------------------------------------------------

  if (data === undefined) {
    return (
      <div
        ref={rootRef}
        data-slot={DATA_SLOT_ROOT}
        data-empty="true"
        className={
          className === undefined ? "tugx-file" : `tugx-file ${className}`
        }
      />
    );
  }

  const langClass =
    language === undefined ? "" : ` tugx-file--lang-${language}`;
  const rootClass =
    `tugx-file${langClass}` +
    (className === undefined ? "" : ` ${className}`);
  const visibleLines = collapsed ? [] : lines;

  return (
    <div
      ref={rootRef}
      data-slot={DATA_SLOT_ROOT}
      data-empty={lines.length === 0 ? "true" : "false"}
      data-language={language ?? "plain"}
      data-collapsed={collapsed ? "true" : "false"}
      data-embedded={embedded ? "true" : undefined}
      className={rootClass}
      tabIndex={-1}
    >
      {embedded ? null : (
      <div className="tugx-file-header" data-slot={DATA_SLOT_HEADER}>
        <span
          className="tugx-file-path"
          data-slot="file-path"
          title={data.filePath}
        >
          {basename(data.filePath)}
        </span>
        {language !== undefined ? (
          <span className="tugx-file-lang" data-slot="file-lang">
            {language}
          </span>
        ) : null}
        <span className="tugx-file-counts" data-slot="file-counts">
          {headerLabel}
        </span>
        <span className="tugx-file-spacer" />
        {!collapsed && lines.length > 0 ? (
          <button
            type="button"
            className="tugx-file-icon-btn"
            data-slot={DATA_SLOT_SEARCH_TOGGLE}
            aria-label={searchOpen ? "Close search" : "Search in file"}
            aria-pressed={searchOpen}
            onClick={() => (searchOpen ? closeSearch() : openSearch())}
            ref={(node) => {
              if (node !== null && node.childElementCount === 0) {
                node.appendChild(buildSearchIcon());
              }
            }}
          />
        ) : null}
        {overThreshold ? (
          <TugIconButton
            icon={collapsed ? <ChevronsDown /> : <ChevronsUp />}
            aria-label={collapsed ? "Expand file" : "Collapse file"}
            onClick={toggleCollapsed}
          />
        ) : null}
      </div>
      )}

      {searchOpen && !collapsed ? (
        <div className="tugx-file-search-bar" data-slot={DATA_SLOT_SEARCH_BAR}>
          <input
            ref={searchInputRef}
            type="text"
            className="tugx-file-search-input"
            data-slot={DATA_SLOT_SEARCH_INPUT}
            defaultValue=""
            placeholder="Find in file"
            aria-label="Find in file"
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={onSearchKeyDown}
          />
          <span
            className="tugx-file-search-count"
            data-slot={DATA_SLOT_SEARCH_COUNT}
          >
            {query.length === 0
              ? ""
              : matchCount === 0
                ? "no matches"
                : `${activeMatch + 1}/${matchCount}`}
          </span>
          <button
            type="button"
            className="tugx-file-search-step"
            data-slot={DATA_SLOT_SEARCH_PREV}
            aria-label="Previous match"
            disabled={matchCount === 0}
            onClick={() => stepMatch(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="tugx-file-search-step"
            data-slot={DATA_SLOT_SEARCH_NEXT}
            aria-label="Next match"
            disabled={matchCount === 0}
            onClick={() => stepMatch(1)}
          >
            ↓
          </button>
          <button
            type="button"
            className="tugx-file-search-close"
            aria-label="Close search"
            onClick={closeSearch}
          >
            ×
          </button>
        </div>
      ) : null}

      <div
        ref={bodyRef}
        className="tugx-file-rows"
        data-slot={DATA_SLOT_BODY}
        role="presentation"
      >
        {visibleLines.map((line, i) => (
          <div
            key={i}
            className="tugx-file-row"
            data-slot={DATA_SLOT_ROW}
            data-line={startLine + i}
            data-text={line}
            onClick={onRowClick}
          >
            <span
              className="tugx-file-gutter"
              data-slot={DATA_SLOT_GUTTER}
              aria-hidden="true"
            >
              {startLine + i}
            </span>
            <span
              className="tugx-file-content"
              data-slot={DATA_SLOT_CONTENT}
            >
              {line === "" ? " " : line}
            </span>
            <span className="tugx-file-overlay" aria-hidden="true" />
          </div>
        ))}
        {collapsed && lines.length > 0 ? (
          <TugCue
            role="active"
            icon={<ChevronsDown />}
            aria-expanded={false}
            onClick={toggleCollapsed}
            className="tugx-file-collapsed-hint"
          >
            {`${lines.length.toLocaleString()} lines folded — click to expand`}
          </TugCue>
        ) : null}
      </div>
    </div>
  );
};
