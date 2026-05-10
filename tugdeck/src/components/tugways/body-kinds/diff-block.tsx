/**
 * `DiffBlock` — Layer-1 body kind for inline unified-diff rendering.
 *
 * Renders a unified-diff card with a path + change-counts header, one
 * collapsible band per hunk, three-class line rows (context, add,
 * remove), and word-level intra-line highlighting via
 * `diff-match-patch` for paired remove/add lines. Composed by the
 * Layer-2 wrapper `EditToolBlock` (#step-11) per Table T02; reachable
 * directly from `RenderInput`-routed body kinds whose data shape is
 * "a diff the user wants to inspect."
 *
 * Why a body kind, not a tool wrapper:
 *   `DiffBlock` holds the rendering for a single rectangle of diff
 *   content — header, hunks, lines, intra-line highlights. The
 *   tool-specific framing (status pill, undo link, "X lines edited"
 *   summary derived from the structured result) lives in the wrapper
 *   that composes us. This is the [D05] two-layer split.
 *
 * Render strategy (no streaming — Table T01: DiffBlock streams = no):
 *   - Three input shapes are accepted via the `source` discriminant on
 *     `DiffData`:
 *       * `unified` — synchronous: parsed in JS via `parseUnifiedDiffText`.
 *         First-paint ready without any WASM.
 *       * `hunks` — synchronous: already-prepared hunks render directly.
 *       * `two-text` — asynchronous: lazy-loads `tugdiff-wasm` per [D10],
 *         then computes hunks via `imara-diff`. A "Computing diff…"
 *         placeholder is shown until the engine resolves.
 *   - Hunk collapse is logical state — the *number* of rendered rows
 *     changes, so it lives in `useState` (per-hunk Set keyed by index).
 *   - Word-level intra-line highlight runs only when `diff-match-patch`
 *     is loaded; until then the line content renders plain. The library
 *     load is fired once on first relevant paint, then cached per-card.
 *   - Syntax highlighting per line is opt-in via a Shiki path (matches
 *     `FileBlock`'s convention) — the same `EXT_TO_LANG` map and the
 *     same DOM-imperative swap; failures leave the plain-text fallback.
 *
 * Laws:
 *  - [L03] No event listeners that depend on mount-then-paint timing
 *    in this body — the collapse / view-toggle handlers are React
 *    onClicks, not document-level listeners.
 *  - [L06] appearance — Shiki swap and word-highlight rendering are
 *    DOM-imperative writes; React state holds only logical UI state
 *    (the collapsed-hunk Set, the view-mode flag, the loaded-engine
 *    promise resolution counter).
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="diff-body"` on the root, this docstring.
 *  - [L20] component-token sovereignty — owns the `--tugx-diff-*`
 *    slot family ([Table T07]).
 *
 * Decisions:
 *  - [D05] two-layer split: body kind (this file) vs. tool wrapper
 *    (edit-tool-block.tsx in #step-11).
 *  - [D09] `imara-diff` via `tugdiff-wasm` for line-level diff.
 *  - [D10] `tugdiff-wasm` and `diff-match-patch` are lazy — they don't
 *    appear in the boot bundle.
 *
 * @module components/tugways/body-kinds/diff-block
 */

import "./diff-block.css";

import React from "react";

import { detectLanguage } from "./file-block";
import {
  parseUnifiedDiffText,
  wordLevelDiffSync,
  type WordDiffSegment,
} from "@/lib/diff/parse-unified-diff";
import {
  countDiffStats,
  type DiffData,
  type DiffHunk,
  type DiffLine,
} from "@/lib/diff/types";
import {
  readDiffViewMode,
  writeDiffViewMode,
  type DiffViewMode,
} from "@/lib/diff/diff-view-pref";
import {
  renderLineSegments,
  wordRangesForSide,
  type RenderedSegment,
  type WordRange,
} from "@/lib/diff/render-line";
import {
  parseShikiLineHtml,
  type SyntaxToken,
} from "@/lib/diff/syntax-tokens-from-shiki";
import { loadTugdiffWasm } from "@/lib/lazy/load-tugdiff-wasm";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DiffBlockProps {
  /**
   * The diff data to render. When undefined, the block renders nothing
   * visible (empty `data-slot="diff-body"` for layout consistency).
   */
  data?: DiffData;

  /**
   * Initial collapse state for the *whole* diff. When `true`, all hunks
   * collapse on mount; when `false`, all hunks render expanded.
   * Defaults to `false`. Per-hunk collapse is independently togglable
   * via the hunk header, regardless of this prop.
   */
  collapsed?: boolean;

  /** Fired when the user toggles the whole-diff collapsed state. */
  onToggleCollapsed?: (next: boolean) => void;

  /** Forwarded class name for cascade-scoped customization. */
  className?: string;

  /**
   * "Embedded" mode — composed inside a host that already paints a
   * container and a header (e.g. `ToolWrapperChrome` in
   * `EditToolBlock`). When `true`, the standalone frame is dropped so
   * the body sits flush with the host.
   */
  embedded?: boolean;

  /**
   * Identifier used for tugbank-persisted per-card preferences.
   * Currently scopes the inline ↔ side-by-side `viewMode`. When
   * omitted, `viewMode` falls back to the prop / default and is not
   * persisted. The Tide card consumer normally passes its own
   * `cardId` through.
   */
  cardId?: string;

  /**
   * Initial render mode. When `cardId` is set and a saved preference
   * exists, that wins over this prop on first render so the user's
   * choice survives reload. Falls back to `"inline"`.
   */
  viewMode?: DiffViewMode;

  /**
   * Notification callback fired when the user clicks the view-mode
   * toggle. The component still updates its own internal state and
   * (when `cardId` is present) writes the new value to tugbank — this
   * callback is purely informational for hosts that want to mirror
   * the choice elsewhere.
   */
  onViewModeChange?: (next: DiffViewMode) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_SLOT_ROOT = "diff-body";
const DATA_SLOT_HEADER = "diff-header";
const DATA_SLOT_HUNKS = "diff-hunks";
const DATA_SLOT_HUNK = "diff-hunk";
const DATA_SLOT_HUNK_HEADER = "diff-hunk-header";
const DATA_SLOT_HUNK_ROWS = "diff-hunk-rows";
const DATA_SLOT_LINE = "diff-line";
const DATA_SLOT_SBS_ROW = "diff-sbs-row";
const DATA_SLOT_SBS_CELL = "diff-sbs-cell";
const DATA_SLOT_VIEW_TOGGLE = "diff-view-toggle";
const DATA_SLOT_TOGGLE = "diff-toggle";
const DATA_SLOT_PATH = "diff-path";
const DATA_SLOT_STATS = "diff-stats";
const DATA_SLOT_LOADING = "diff-loading";
const DATA_SLOT_COLLAPSED_HINT = "diff-collapsed-hint";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Last segment of a path; empty input → "". */
export function basename(filePath: string): string {
  if (filePath.length === 0) return "";
  const segments = filePath.split(/[\\/]/);
  return segments[segments.length - 1] ?? "";
}

/**
 * Compose the conventional unified-diff hunk-header text for display.
 * Mirrors what `git diff` shows after the `@@`: the byte ranges and any
 * carry-over header text. The leading/trailing `@@` markers are part
 * of the rendered text since the header band visually identifies the
 * line as the hunk separator.
 */
export function composeHunkHeader(hunk: DiffHunk): string {
  const before = formatRange(hunk.before_start, hunk.before_count);
  const after = formatRange(hunk.after_start, hunk.after_count);
  const tail = hunk.header.length === 0 ? "" : ` ${hunk.header}`;
  return `@@ -${before} +${after} @@${tail}`;
}

function formatRange(start: number, count: number): string {
  if (count === 1) return `${start}`;
  return `${start},${count}`;
}

/**
 * Pair adjacent (remove, add) lines in a hunk for word-level
 * highlighting. A "pair" is `lines[i]` of kind `remove` followed
 * directly by `lines[i + 1]` of kind `add`. Returns a `Map` keyed
 * on the index of the `remove` line, with the `add` line's index as
 * value.
 */
export function pairRemoveAddIndices(
  lines: readonly { kind: string }[],
): Map<number, number> {
  const pairs = new Map<number, number>();
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].kind === "remove" && lines[i + 1].kind === "add") {
      pairs.set(i, i + 1);
    }
  }
  return pairs;
}

/**
 * One row of the side-by-side layout. Either cell may be null when
 * the row is a lone remove (right blank) or lone add (left blank).
 * Context lines emit the same line on both sides.
 *
 * `paired` is `true` when both cells are present *and* the row is a
 * remove + add pair (not a context-on-both-sides row) — this is what
 * the word-level overlay keys on.
 */
export interface SideBySideRow {
  left: DiffLine | null;
  right: DiffLine | null;
  paired: boolean;
}

/**
 * Group a hunk's flat line list into side-by-side rows.
 *
 * Algorithm: walk the lines once. Context lines emit a single shared
 * row. Runs of consecutive non-context lines are partitioned into
 * removes and adds, then zipped index-for-index — `[remove, remove,
 * add, add]` becomes `(remove, add), (remove, add)`; `[remove, add,
 * add]` becomes `(remove, add), (blank, add)`. This matches the way
 * `git diff --color-words` and most side-by-side viewers align
 * paired changes.
 */
export function groupSideBySideRows(
  lines: readonly DiffLine[],
): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.kind === "context") {
      rows.push({ left: line, right: line, paired: false });
      i += 1;
      continue;
    }
    // Collect a run of consecutive non-context lines.
    const removes: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].kind !== "context") {
      if (lines[i].kind === "remove") removes.push(lines[i]);
      else adds.push(lines[i]);
      i += 1;
    }
    const max = Math.max(removes.length, adds.length);
    for (let k = 0; k < max; k++) {
      const left = removes[k] ?? null;
      const right = adds[k] ?? null;
      rows.push({
        left,
        right,
        paired: left !== null && right !== null,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Hunk preparation: source → DiffHunk[]
// ---------------------------------------------------------------------------

/**
 * Resolve a `DiffData` into hunks. The `unified` and `hunks` sources
 * resolve synchronously; `two-text` returns `null` until the WASM
 * engine is ready (the caller awaits the engine and re-asks).
 *
 * Exported for tests; production callers go through the React hook.
 */
export function prepareHunksSync(data: DiffData): DiffHunk[] | null {
  switch (data.source) {
    case "unified":
      return parseUnifiedDiffText(data.text);
    case "hunks":
      return data.hunks;
    case "two-text":
      return null;
  }
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

const EMPTY_HUNKS: DiffHunk[] = [];
const EMPTY_SYNTAX_MAP: ReadonlyMap<string, SyntaxToken[]> = new Map();

export const DiffBlock: React.FC<DiffBlockProps> = ({
  data,
  collapsed: collapsedProp,
  onToggleCollapsed,
  className,
  embedded = false,
  cardId,
  viewMode: viewModeProp,
  onViewModeChange,
}) => {
  // -- View mode (inline | side-by-side) ------------------------------------
  //
  // Initial value priority: tugbank persistence > prop > "inline".
  // The synchronous read in the useState initializer means the first
  // paint already reflects the user's saved choice — no flash of
  // inline-then-flip.
  const [viewMode, setViewMode] = React.useState<DiffViewMode>(() => {
    if (cardId !== undefined) {
      const saved = readDiffViewMode(cardId);
      if (saved !== null) return saved;
    }
    return viewModeProp ?? "inline";
  });

  // If the parent flips the controlled `viewModeProp` after mount,
  // honor it (mirrors how `collapsed` is handled below).
  React.useEffect(() => {
    if (viewModeProp !== undefined) setViewMode(viewModeProp);
  }, [viewModeProp]);

  const toggleViewMode = React.useCallback(() => {
    setViewMode((prev) => {
      const next: DiffViewMode = prev === "inline" ? "side-by-side" : "inline";
      if (cardId !== undefined) writeDiffViewMode(cardId, next);
      onViewModeChange?.(next);
      return next;
    });
  }, [cardId, onViewModeChange]);

  // -- Hunk resolution -------------------------------------------------------

  const syncHunks = React.useMemo(
    () => (data === undefined ? EMPTY_HUNKS : prepareHunksSync(data)),
    [data],
  );

  // For the two-text input shape, the WASM engine resolves
  // asynchronously — hold its hunks in state and render them once
  // available.
  const [asyncHunks, setAsyncHunks] = React.useState<DiffHunk[] | null>(null);

  React.useEffect(() => {
    if (data === undefined) return;
    if (data.source !== "two-text") return;

    let cancelled = false;
    loadTugdiffWasm()
      .then((engine) => {
        if (cancelled) return;
        const hunks = engine.two_text_diff(data.before, data.after);
        setAsyncHunks(hunks);
      })
      .catch(() => {
        if (cancelled) return;
        // WASM unavailable; surface an empty hunk array — the
        // "Computing diff…" placeholder collapses to "no changes" on
        // empty output, which is a reasonable degraded state.
        setAsyncHunks([]);
      });

    return () => {
      cancelled = true;
    };
  }, [data]);

  const hunks: DiffHunk[] | null =
    syncHunks !== null ? syncHunks : asyncHunks;

  // -- Whole-diff collapsed state -------------------------------------------

  const [collapsed, setCollapsed] = React.useState<boolean>(
    collapsedProp ?? false,
  );

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

  // -- Per-hunk collapsed state ---------------------------------------------

  const [collapsedHunks, setCollapsedHunks] = React.useState<Set<number>>(
    () => new Set(),
  );

  const toggleHunk = React.useCallback((index: number) => {
    setCollapsedHunks((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // -- Word-level engine load -----------------------------------------------

  const [wordEngine, setWordEngine] = React.useState<WordEngineCtor | null>(
    null,
  );

  React.useEffect(() => {
    if (hunks === null || hunks.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("diff-match-patch");
        if (cancelled) return;
        const Engine = (mod.default ?? mod) as unknown as WordEngineCtor;
        setWordEngine(() => Engine);
      } catch {
        // Word-level highlighting is a polish layer; failure is fine.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hunks]);

  // -- Syntax-highlight tokens (Shiki) --------------------------------------
  //
  // When `data.filePath` has a recognized extension, we lazy-load
  // Shiki and compute per-line syntax tokens. Tokens are stored in
  // a Map<line-content, SyntaxToken[]> keyed on the line text — same
  // text reuses the same tokenization regardless of which hunk it
  // appears in. Empty / unknown languages leave the map empty and
  // the renderer falls back to plain text + word-level overlay.
  const language = data === undefined ? undefined : detectLanguage(data.filePath ?? "");
  const [syntaxByLine, setSyntaxByLine] = React.useState<
    ReadonlyMap<string, SyntaxToken[]>
  >(EMPTY_SYNTAX_MAP);

  React.useEffect(() => {
    if (hunks === null || hunks.length === 0) return;
    if (language === undefined) return;

    let cancelled = false;
    (async () => {
      try {
        const utils = await import(
          "@/_archive/cards/conversation/code-block-utils"
        );
        const highlighter = await utils.getHighlighter();
        if (cancelled) return;
        const normalized = utils.normalizeLanguage(language);
        const loaded = highlighter.getLoadedLanguages() as string[];
        if (!loaded.includes(normalized)) {
          try {
            await (highlighter as { loadLanguage: (l: string) => Promise<void> })
              .loadLanguage(normalized);
          } catch {
            return;
          }
          if (cancelled) return;
        }

        // Collect every unique line text across all hunks.
        const uniqueLines = new Set<string>();
        for (const hunk of hunks) {
          for (const line of hunk.lines) {
            if (line.content.length > 0) uniqueLines.add(line.content);
          }
        }

        const map = new Map<string, SyntaxToken[]>();
        for (const text of uniqueLines) {
          const html = highlighter.codeToHtml(text, {
            lang: normalized,
            theme: "github-dark",
          });
          // Shiki wraps in <pre><code><span class="line">…</span></code></pre>.
          // Use a lookahead to anchor on the line-span's actual close
          // (the one followed by `\n` or `</code>`), since the inner
          // styled spans also use `</span>`.
          const lineMatch = html.match(
            /<span class="line"[^>]*>([\s\S]*?)<\/span>(?=\n|<\/code>)/,
          );
          const inner = lineMatch === null ? "" : lineMatch[1];
          map.set(text, parseShikiLineHtml(inner));
        }

        if (!cancelled) setSyntaxByLine(map);
      } catch {
        // Syntax highlighting is a polish layer; failure is fine.
        // The renderer falls back to plain text + word overlay.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hunks, language]);

  // -- Render ----------------------------------------------------------------

  if (data === undefined) {
    return (
      <div
        data-slot={DATA_SLOT_ROOT}
        data-empty="true"
        className={
          className === undefined ? "tugx-diff" : `tugx-diff ${className}`
        }
      />
    );
  }

  const rootClass =
    "tugx-diff" + (className === undefined ? "" : ` ${className}`);

  const filePath = data.filePath ?? "";
  const headerBasename = basename(filePath);

  if (hunks === null) {
    return (
      <div
        data-slot={DATA_SLOT_ROOT}
        data-loading="true"
        data-embedded={embedded ? "true" : undefined}
        data-view-mode={viewMode}
        className={rootClass}
      >
        {embedded ? null : (
          <div className="tugx-diff-header" data-slot={DATA_SLOT_HEADER}>
            {headerBasename === "" ? null : (
              <span
                className="tugx-diff-path"
                data-slot={DATA_SLOT_PATH}
                title={filePath}
              >
                {headerBasename}
              </span>
            )}
            <span className="tugx-diff-spacer" />
          </div>
        )}
        <div className="tugx-diff-loading" data-slot={DATA_SLOT_LOADING}>
          Computing diff…
        </div>
      </div>
    );
  }

  const stats = countDiffStats(hunks);
  const empty = hunks.length === 0;

  return (
    <div
      data-slot={DATA_SLOT_ROOT}
      data-empty={empty ? "true" : "false"}
      data-collapsed={collapsed ? "true" : "false"}
      data-embedded={embedded ? "true" : undefined}
      data-view-mode={viewMode}
      className={rootClass}
    >
      {embedded ? null : (
        <div className="tugx-diff-header" data-slot={DATA_SLOT_HEADER}>
          {headerBasename === "" ? null : (
            <span
              className="tugx-diff-path"
              data-slot={DATA_SLOT_PATH}
              title={filePath}
            >
              {headerBasename}
            </span>
          )}
          <span
            className="tugx-diff-stats"
            data-slot={DATA_SLOT_STATS}
            aria-label={`${stats.added} added, ${stats.removed} removed`}
          >
            <span className="tugx-diff-stats-add">+{stats.added}</span>
            <span className="tugx-diff-stats-remove">−{stats.removed}</span>
          </span>
          <span className="tugx-diff-spacer" />
          <button
            type="button"
            className="tugx-diff-view-toggle"
            data-slot={DATA_SLOT_VIEW_TOGGLE}
            aria-pressed={viewMode === "side-by-side"}
            aria-label={
              viewMode === "side-by-side"
                ? "Switch to inline diff"
                : "Switch to side-by-side diff"
            }
            onClick={toggleViewMode}
          >
            {viewMode === "side-by-side" ? "Inline" : "Side by side"}
          </button>
          {empty ? null : (
            <button
              type="button"
              className="tugx-diff-toggle"
              data-slot={DATA_SLOT_TOGGLE}
              aria-expanded={!collapsed}
              onClick={toggleCollapsed}
            >
              {collapsed ? "Expand" : "Collapse"}
            </button>
          )}
        </div>
      )}

      {collapsed && !empty ? (
        <div
          className="tugx-diff-collapsed-hint"
          data-slot={DATA_SLOT_COLLAPSED_HINT}
        >
          {hunks.length} {hunks.length === 1 ? "hunk" : "hunks"} folded — click
          Expand to view
        </div>
      ) : null}

      {!collapsed ? (
        <div className="tugx-diff-hunks" data-slot={DATA_SLOT_HUNKS}>
          {hunks.map((hunk, index) => {
            const isHunkCollapsed = collapsedHunks.has(index);
            const pairs = pairRemoveAddIndices(hunk.lines);
            return (
              <div
                key={index}
                className="tugx-diff-hunk"
                data-slot={DATA_SLOT_HUNK}
                data-hunk-index={index}
                data-collapsed={isHunkCollapsed ? "true" : "false"}
              >
                <div
                  className="tugx-diff-hunk-header"
                  data-slot={DATA_SLOT_HUNK_HEADER}
                  onClick={() => toggleHunk(index)}
                  role="button"
                  tabIndex={0}
                  aria-expanded={!isHunkCollapsed}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleHunk(index);
                    }
                  }}
                >
                  <span className="tugx-diff-hunk-header-text">
                    {composeHunkHeader(hunk)}
                  </span>
                  <span className="tugx-diff-spacer" />
                  <button
                    type="button"
                    className="tugx-diff-hunk-toggle"
                    aria-label={isHunkCollapsed ? "Expand hunk" : "Collapse hunk"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleHunk(index);
                    }}
                  >
                    {isHunkCollapsed ? "▸" : "▾"}
                  </button>
                </div>
                <div
                  className="tugx-diff-hunk-rows"
                  data-slot={DATA_SLOT_HUNK_ROWS}
                >
                  {viewMode === "inline"
                    ? renderInlineHunkBody(hunk, pairs, wordEngine, syntaxByLine)
                    : renderSideBySideHunkBody(hunk, wordEngine, syntaxByLine)}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Word-level helpers
// ---------------------------------------------------------------------------

function isPairedAdd(
  pairs: Map<number, number>,
  lineIndex: number,
): boolean {
  for (const addIndex of pairs.values()) {
    if (addIndex === lineIndex) return true;
  }
  return false;
}

function findPairedRemove(
  pairs: Map<number, number>,
  addIndex: number,
): number | undefined {
  for (const [removeIndex, mappedAdd] of pairs.entries()) {
    if (mappedAdd === addIndex) return removeIndex;
  }
  return undefined;
}

function markerFor(kind: string): string {
  if (kind === "add") return "+";
  if (kind === "remove") return "−";
  return " ";
}

// ---------------------------------------------------------------------------
// Per-mode render helpers
// ---------------------------------------------------------------------------

type WordEngineCtor = new () => {
  diff_main(a: string, b: string): Array<[number, string]>;
  diff_cleanupSemantic(diffs: Array<[number, string]>): void;
};

/**
 * Render the inner content of a line. When syntax tokens or word
 * ranges are present, the merge happens via `renderLineSegments` and
 * each output segment becomes a `<span>` carrying both its inline
 * style (Shiki) and word-level class (overlay) where applicable.
 * Empty input collapses to a single non-breaking space so the row
 * preserves its baseline height.
 */
function renderLineContent(
  text: string,
  syntaxTokens: SyntaxToken[] | null,
  wordRanges: WordRange[] | null,
): React.ReactNode {
  if (text.length === 0) return " ";
  if (
    (syntaxTokens === null || syntaxTokens.length === 0) &&
    (wordRanges === null || wordRanges.length === 0)
  ) {
    return text;
  }
  const segments = renderLineSegments(text, syntaxTokens, wordRanges);
  return segments.map((seg, i) => renderSegment(seg, i));
}

function renderSegment(
  segment: RenderedSegment,
  key: number,
): React.ReactNode {
  const { text, style, className } = segment;
  if (style === "" && className === null) {
    return <React.Fragment key={key}>{text}</React.Fragment>;
  }
  return (
    <span
      key={key}
      className={className ?? undefined}
      data-slot={className === null ? undefined : "diff-word"}
      style={style === "" ? undefined : parseInlineStyle(style)}
    >
      {text}
    </span>
  );
}

/**
 * Convert a `;`-separated CSS string from Shiki (e.g.
 * `"color:#79B8FF;font-style:italic"`) into the React `style` prop
 * shape (`{ color: "#79B8FF", fontStyle: "italic" }`).
 */
function parseInlineStyle(css: string): React.CSSProperties {
  const out: Record<string, string> = {};
  for (const decl of css.split(";")) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).trim();
    const value = decl.slice(colon + 1).trim();
    if (prop.length === 0 || value.length === 0) continue;
    // Convert kebab-case to camelCase.
    const camel = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[camel] = value;
  }
  return out as React.CSSProperties;
}

/** Inline view: one row per line, 4-column grid. */
function renderInlineHunkBody(
  hunk: DiffHunk,
  pairs: Map<number, number>,
  wordEngine: WordEngineCtor | null,
  syntaxByLine: ReadonlyMap<string, SyntaxToken[]>,
): React.ReactNode {
  return hunk.lines.map((line, lineIndex) => {
    const pairedAddIndex = pairs.get(lineIndex);
    const isRemovePair = pairedAddIndex !== undefined;
    const removePartnerIndex = isPairedAdd(pairs, lineIndex)
      ? findPairedRemove(pairs, lineIndex)
      : undefined;

    let wordRanges: WordRange[] | null = null;
    if (wordEngine !== null) {
      if (isRemovePair) {
        const segments = wordLevelDiffSync(
          line.content,
          hunk.lines[pairedAddIndex].content,
          wordEngine,
        );
        wordRanges = wordRangesForSide(segments, "remove");
      } else if (removePartnerIndex !== undefined) {
        const segments = wordLevelDiffSync(
          hunk.lines[removePartnerIndex].content,
          line.content,
          wordEngine,
        );
        wordRanges = wordRangesForSide(segments, "add");
      }
    }

    const syntaxTokens = syntaxByLine.get(line.content) ?? null;

    return (
      <div
        key={lineIndex}
        className="tugx-diff-line"
        data-slot={DATA_SLOT_LINE}
        data-kind={line.kind}
        data-line-index={lineIndex}
      >
        <span className="tugx-diff-gutter-before" aria-hidden="true">
          {line.before_lineno ?? ""}
        </span>
        <span className="tugx-diff-gutter-after" aria-hidden="true">
          {line.after_lineno ?? ""}
        </span>
        <span className="tugx-diff-marker" aria-hidden="true">
          {markerFor(line.kind)}
        </span>
        <span className="tugx-diff-content">
          {renderLineContent(line.content, syntaxTokens, wordRanges)}
        </span>
      </div>
    );
  });
}

/**
 * Side-by-side view: rows of (left, right) cells.
 *
 *   - Context lines occupy both cells with the same content.
 *   - Paired remove+add: word-level overlay applies to both cells
 *     (delete-tagged segments visible on the left, insert-tagged on
 *     the right; equal segments show on both).
 *   - Lone remove leaves the right cell blank with a tint;
 *     lone add leaves the left cell blank with a tint.
 */
function renderSideBySideHunkBody(
  hunk: DiffHunk,
  wordEngine: WordEngineCtor | null,
  syntaxByLine: ReadonlyMap<string, SyntaxToken[]>,
): React.ReactNode {
  const rows = groupSideBySideRows(hunk.lines);
  return rows.map((row, rowIndex) => {
    let leftRanges: WordRange[] | null = null;
    let rightRanges: WordRange[] | null = null;
    if (row.paired && row.left !== null && row.right !== null && wordEngine !== null) {
      const segments = wordLevelDiffSync(
        row.left.content,
        row.right.content,
        wordEngine,
      );
      leftRanges = wordRangesForSide(segments, "remove");
      rightRanges = wordRangesForSide(segments, "add");
    }
    return (
      <div
        key={rowIndex}
        className="tugx-diff-sbs-row"
        data-slot={DATA_SLOT_SBS_ROW}
        data-row-index={rowIndex}
        data-paired={row.paired ? "true" : "false"}
      >
        {renderSideBySideCell("left", row.left, leftRanges, syntaxByLine)}
        {renderSideBySideCell("right", row.right, rightRanges, syntaxByLine)}
      </div>
    );
  });
}

function renderSideBySideCell(
  side: "left" | "right",
  line: DiffLine | null,
  wordRanges: WordRange[] | null,
  syntaxByLine: ReadonlyMap<string, SyntaxToken[]>,
): React.ReactNode {
  if (line === null) {
    return (
      <div
        className="tugx-diff-sbs-cell"
        data-slot={DATA_SLOT_SBS_CELL}
        data-side={side}
        data-kind="blank"
      >
        <span className="tugx-diff-gutter-before" aria-hidden="true" />
        <span className="tugx-diff-marker" aria-hidden="true" />
        <span className="tugx-diff-content" />
      </div>
    );
  }
  const lineno = side === "left" ? line.before_lineno : line.after_lineno;
  const syntaxTokens = syntaxByLine.get(line.content) ?? null;
  return (
    <div
      className="tugx-diff-sbs-cell"
      data-slot={DATA_SLOT_SBS_CELL}
      data-side={side}
      data-kind={line.kind}
    >
      <span className="tugx-diff-gutter-before" aria-hidden="true">
        {lineno ?? ""}
      </span>
      <span className="tugx-diff-marker" aria-hidden="true">
        {markerFor(line.kind)}
      </span>
      <span className="tugx-diff-content">
        {renderLineContent(line.content, syntaxTokens, wordRanges)}
      </span>
    </div>
  );
}
