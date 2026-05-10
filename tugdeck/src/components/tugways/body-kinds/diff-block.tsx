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

import {
  parseUnifiedDiffText,
  wordLevelDiffSync,
  type WordDiffSegment,
} from "@/lib/diff/parse-unified-diff";
import {
  countDiffStats,
  type DiffData,
  type DiffHunk,
} from "@/lib/diff/types";
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

export const DiffBlock: React.FC<DiffBlockProps> = ({
  data,
  collapsed: collapsedProp,
  onToggleCollapsed,
  className,
  embedded = false,
}) => {
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

  const [wordEngine, setWordEngine] = React.useState<
    | (new () => {
        diff_main(a: string, b: string): Array<[number, string]>;
        diff_cleanupSemantic(diffs: Array<[number, string]>): void;
      })
    | null
  >(null);

  React.useEffect(() => {
    if (hunks === null || hunks.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("diff-match-patch");
        if (cancelled) return;
        type Ctor = new () => {
          diff_main(a: string, b: string): Array<[number, string]>;
          diff_cleanupSemantic(diffs: Array<[number, string]>): void;
        };
        const Engine = (mod.default ?? mod) as unknown as Ctor;
        setWordEngine(() => Engine);
      } catch {
        // Word-level highlighting is a polish layer; failure is fine.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hunks]);

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
            disabled
            aria-label="Side-by-side view (coming soon)"
            title="Side-by-side view — coming soon"
          >
            Side by side
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
                  {hunk.lines.map((line, lineIndex) => {
                    const wordSegments =
                      wordEngine !== null && pairs.has(lineIndex)
                        ? computeWordSegments(
                            wordEngine,
                            line.content,
                            hunk.lines[pairs.get(lineIndex) as number].content,
                            "remove",
                          )
                        : wordEngine !== null && isPairedAdd(pairs, lineIndex)
                          ? computeWordSegments(
                              wordEngine,
                              hunk.lines[
                                findPairedRemove(pairs, lineIndex) as number
                              ].content,
                              line.content,
                              "add",
                            )
                          : null;
                    return (
                      <div
                        key={lineIndex}
                        className="tugx-diff-line"
                        data-slot={DATA_SLOT_LINE}
                        data-kind={line.kind}
                        data-line-index={lineIndex}
                      >
                        <span
                          className="tugx-diff-gutter-before"
                          aria-hidden="true"
                        >
                          {line.before_lineno ?? ""}
                        </span>
                        <span
                          className="tugx-diff-gutter-after"
                          aria-hidden="true"
                        >
                          {line.after_lineno ?? ""}
                        </span>
                        <span
                          className="tugx-diff-marker"
                          aria-hidden="true"
                        >
                          {markerFor(line.kind)}
                        </span>
                        <span className="tugx-diff-content">
                          {wordSegments === null
                            ? line.content === ""
                              ? " "
                              : line.content
                            : renderWordSegments(wordSegments)}
                        </span>
                      </div>
                    );
                  })}
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

/**
 * Compute the segments to render for one side of a paired remove/add.
 * `side` selects which segments to keep: `"remove"` keeps `equal` +
 * `delete`; `"add"` keeps `equal` + `insert`.
 */
function computeWordSegments(
  Engine: new () => {
    diff_main(a: string, b: string): Array<[number, string]>;
    diff_cleanupSemantic(diffs: Array<[number, string]>): void;
  },
  before: string,
  after: string,
  side: "remove" | "add",
): WordDiffSegment[] {
  const all = wordLevelDiffSync(before, after, Engine);
  return all.filter((segment) => {
    if (segment.tag === "equal") return true;
    if (side === "remove") return segment.tag === "delete";
    return segment.tag === "insert";
  });
}

function renderWordSegments(segments: WordDiffSegment[]): React.ReactNode {
  return segments.map((segment, i) => {
    if (segment.tag === "equal") {
      return (
        <React.Fragment key={i}>
          {segment.text}
        </React.Fragment>
      );
    }
    const className =
      segment.tag === "insert"
        ? "tugx-diff-word-add"
        : "tugx-diff-word-remove";
    return (
      <span key={i} className={className} data-slot="diff-word">
        {segment.text}
      </span>
    );
  });
}

function markerFor(kind: string): string {
  if (kind === "add") return "+";
  if (kind === "remove") return "−";
  return " ";
}
