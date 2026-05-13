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
 * Find row:
 *  - `<TugBlockFindRow>` mounted with `.tugx-diff-find` between the
 *    identity header and the hunk stack, gated on
 *    `findSession.state.open && !collapsed`. State, focus discipline,
 *    reload-survival slot, and the `data-tug-focus-key` axis live in
 *    `useBlockFindSession` ([D95] framework focus boundary). DiffBlock
 *    owns the responder (`diffBlockResponder`) that the session's
 *    action map (`FIND` / `FIND_NEXT` / `FIND_PREVIOUS`) attaches to;
 *    Cmd-F dispatched through the chain reaches `findSession.open`
 *    which fires `onBeforeOpen` (uncollapse + first-responder promote)
 *    before flipping the row open.
 *  - Substrate-side match-highlighting against the diff cells is out
 *    of scope here — the row's state, focus, and reload survival
 *    work standalone; navigation stubs to no-op until a diff-editor
 *    search bridge lands. Match-count reads 0 in the meantime.
 *
 * Laws:
 *  - [L02] External state enters React via `useSyncExternalStore`. The
 *    persisted view-mode preference is owned by tugbank and accessed
 *    through the `useDiffViewMode` hook in `diff-view-pref.ts`. The
 *    ephemeral view-mode (when no `cardId` is provided) is local
 *    component data per [L24] and lives in `useState`.
 *  - [L03] No event listeners that depend on mount-then-paint timing
 *    in this body — the collapse / view-toggle handlers are React
 *    onClicks, not document-level listeners.
 *  - [L06] appearance — line-row backgrounds, view-mode layout, and
 *    collapse visibility flow through `data-*` attributes and CSS;
 *    React state holds only logical UI state (the collapsed-hunk Set,
 *    the local-fallback view mode, the loaded-engine handles).
 *  - [L11] DiffBlock owns the find session via `useBlockFindSession`
 *    and registers `diffBlockResponder` carrying that session's
 *    action map. `viewToggleForm` registers as a child responder so
 *    chain walks from inside its choice group reach the diff block's
 *    `FIND_NEXT` / `FIND_PREVIOUS` handlers via the parent.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="diff-body"` on the root, this docstring.
 *  - [L20] component-token sovereignty — owns the `--tugx-diff-*`
 *    slot family ([Table T07]).
 *  - [L24] state zoning — appearance via DOM (data-attrs + CSS); local
 *    data via `useState` (collapsed-set, ephemeral view mode, async
 *    hunk results, loaded engines); structure / external state via
 *    `useSyncExternalStore` (the persisted view-mode hook).
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
import { createPortal } from "react-dom";
import {
  AlignLeft,
  ChevronDown,
  ChevronRight,
  Columns2,
} from "lucide-react";

import { TugCue } from "@/components/tugways/tug-cue";
import { TugChoiceGroup, type TugChoiceItem } from "@/components/tugways/tug-choice-group";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { useOptionalResponder } from "@/components/tugways/use-responder";
import { useResponderChain } from "@/components/tugways/responder-chain-provider";
import { useChromeActionsTarget } from "@/components/tugways/cards/tool-wrappers/tool-wrapper-chrome";
import { useOuterScrollport } from "@/components/tugways/internal/outer-scrollport-context";
import { useOuterScrollOnModifierWheel } from "@/components/tugways/internal/use-outer-scroll-on-modifier-wheel";
import { usePositionStableClick } from "@/components/tugways/internal/use-position-stable-click";
import { useBlockFindSession } from "@/components/tugways/internal/use-block-find-session";
import { TugBlockFindRow } from "@/components/tugways/internal/tug-block-find-row";
import {
  useComponentStatePreservation,
  useSavedComponentState,
} from "@/components/tugways/use-component-state-preservation";
import { BlockCopyButton, BlockFoldCue } from "./affordances";
import { detectLanguage } from "./file-block";
import {
  parseUnifiedDiffText,
  wordLevelDiffSync,
} from "@/lib/diff/parse-unified-diff";
import {
  countDiffStats,
  type DiffData,
  type DiffHunk,
  type DiffLine,
} from "@/lib/diff/types";
import {
  useDiffViewMode,
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
   * `EditToolBlock`). When `true`:
   *
   *   - The standalone frame is dropped so the body sits flush with
   *     the host.
   *   - DiffBlock's own header (path + stats) is hidden — the wrapper
   *     owns identity.
   *   - The resting affordances (fold cue, view-toggle) portal into
   *     the host's chrome actions slot via
   *     `ChromeActionsTargetContext`. This is the load-bearing
   *     contract: `embedded={true}` MUST be used under a
   *     `ToolWrapperChrome` so the affordances have somewhere to
   *     surface. Using `embedded={true}` outside a chrome is
   *     unsupported.
   *
   * @default false
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

  /**
   * Opt-in key for the Component State Preservation Protocol. When
   * set, DiffBlock persists its uncontrolled `collapsed` flag into
   * `bag.components` so a Developer > Reload restores the fold state.
   * Undefined opts out (gallery, standalone). View-mode persistence
   * runs through `cardId` + tugbank independently — that channel
   * predates the protocol. [A9]
   */
  componentStatePreservationKey?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_SLOT_ROOT = "diff-body";
const DATA_SLOT_HEADER = "diff-header";
const DATA_SLOT_HUNKS = "diff-hunks";
const DATA_SLOT_HUNK = "diff-hunk";
const DATA_SLOT_HUNK_ROWS = "diff-hunk-rows";
const DATA_SLOT_LINE = "diff-line";
const DATA_SLOT_SBS_ROW = "diff-sbs-row";
const DATA_SLOT_SBS_CELL = "diff-sbs-cell";
const DATA_SLOT_VIEW_TOGGLE = "diff-view-toggle";
const DATA_SLOT_PATH = "diff-path";
const DATA_SLOT_STATS = "diff-stats";
const DATA_SLOT_LOADING = "diff-loading";

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
 * Pair removes and adds in a hunk for word-level highlighting.
 *
 * Algorithm matches `groupSideBySideRows`: walk the lines once, and
 * inside each run of consecutive non-context lines, zip the removes
 * with the adds index-for-index. `[r1, r2, a1, a2]` produces
 * `r1↔a1, r2↔a2`; `[r1, r2, a1]` produces `r1↔a1` (r2 unpaired);
 * `[r1, a1, a2]` produces `r1↔a1` (a2 unpaired).
 *
 * This is the same pairing semantics as `git diff --color-words`
 * and is the only way the inline view's word-level overlay agrees
 * with the side-by-side view on the same hunk.
 *
 * Returns a `Map<removeIndex, addIndex>`.
 */
export function pairRemoveAddIndices(
  lines: readonly { kind: string }[],
): Map<number, number> {
  const pairs = new Map<number, number>();
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind === "context") {
      i += 1;
      continue;
    }
    const removeIndices: number[] = [];
    const addIndices: number[] = [];
    while (i < lines.length && lines[i].kind !== "context") {
      if (lines[i].kind === "remove") removeIndices.push(i);
      else if (lines[i].kind === "add") addIndices.push(i);
      i += 1;
    }
    const max = Math.min(removeIndices.length, addIndices.length);
    for (let k = 0; k < max; k++) {
      pairs.set(removeIndices[k], addIndices[k]);
    }
  }
  return pairs;
}

/**
 * One row of the side-by-side layout. Each cell carries both its
 * `DiffLine` (for content rendering) and its `lineIndex` in the
 * source hunk (for keying into the precomputed
 * `wordRangesByLineIndex` map without an `indexOf` scan).
 *
 * `paired` is `true` when both cells are present *and* the row is a
 * remove + add pair (not a context-on-both-sides row) — this is what
 * the word-level overlay keys on.
 */
export interface SideBySideRow {
  left: DiffLine | null;
  right: DiffLine | null;
  /** Index of `left` in the source hunk's `lines` array, or `null` if the cell is blank. */
  leftIndex: number | null;
  /** Index of `right` in the source hunk's `lines` array, or `null` if the cell is blank. */
  rightIndex: number | null;
  paired: boolean;
}

/**
 * Group a hunk's flat line list into side-by-side rows.
 *
 * Algorithm: walk the lines once, tracking each line's own index.
 * Context lines emit a single shared row. Runs of consecutive
 * non-context lines are partitioned into removes and adds, then
 * zipped index-for-index — `[remove, remove, add, add]` becomes
 * `(remove, add), (remove, add)`; `[remove, add, add]` becomes
 * `(remove, add), (blank, add)`. Same pairing semantics as
 * `pairRemoveAddIndices` and `git diff --color-words`.
 */
export function groupSideBySideRows(
  lines: readonly DiffLine[],
): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.kind === "context") {
      rows.push({
        left: line,
        right: line,
        leftIndex: i,
        rightIndex: i,
        paired: false,
      });
      i += 1;
      continue;
    }
    // Collect a run of consecutive non-context lines, tracking indices.
    const removes: Array<{ line: DiffLine; index: number }> = [];
    const adds: Array<{ line: DiffLine; index: number }> = [];
    while (i < lines.length && lines[i].kind !== "context") {
      if (lines[i].kind === "remove") removes.push({ line: lines[i], index: i });
      else adds.push({ line: lines[i], index: i });
      i += 1;
    }
    const max = Math.max(removes.length, adds.length);
    for (let k = 0; k < max; k++) {
      const r = removes[k];
      const a = adds[k];
      rows.push({
        left: r?.line ?? null,
        right: a?.line ?? null,
        leftIndex: r?.index ?? null,
        rightIndex: a?.index ?? null,
        paired: r !== undefined && a !== undefined,
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
// Copy-text composition
// ---------------------------------------------------------------------------

/**
 * Build the clipboard text for a DiffBlock's Copy affordance.
 *
 *  - `unified` source: return `data.text` verbatim. The user pasted-in
 *    or generated diff text round-trips losslessly (file path
 *    headers, `\ No newline at end of file` markers, hunk text
 *    preserved).
 *  - `hunks` / `two-text` sources: reconstruct a unified-diff text
 *    from the parsed hunks. Loses anything the parser dropped
 *    (commit-message preamble, custom indices) but produces output
 *    that `git apply` / patch can consume — the standard expectation
 *    when a user clicks "copy this diff".
 *
 * Returns the empty string when `hunks` is null (async two-text load
 * still pending) so the disabled-when-no-text contract holds without
 * the caller needing a separate null check. The Copy button keys off
 * the same emptiness, so an empty return value disables the click
 * without ever reaching the clipboard API.
 *
 * Exported for tests so the line-prefix + path-header rules are
 * pin-able without the renderer in the loop.
 */
export function composeDiffCopyText(
  data: DiffData,
  hunks: DiffHunk[] | null,
): string {
  if (data.source === "unified") {
    return data.text;
  }
  if (hunks === null || hunks.length === 0) {
    return "";
  }
  const parts: string[] = [];
  const filePath = data.filePath ?? "";
  if (filePath.length > 0) {
    // Standard unified-diff path headers. Useful when the consumer
    // pastes the result into `git apply` or a code-review tool —
    // without them, only the `@@` hunk markers and lines survive.
    parts.push(`--- a/${filePath}`);
    parts.push(`+++ b/${filePath}`);
  }
  for (const hunk of hunks) {
    parts.push(composeHunkHeader(hunk));
    for (const line of hunk.lines) {
      const prefix =
        line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
      parts.push(prefix + line.content);
    }
  }
  // Trailing newline so `git apply` doesn't complain about an
  // unterminated final line in the patch.
  return parts.join("\n") + "\n";
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
  componentStatePreservationKey,
}) => {
  // -- Telescoping pin: write the identity-header height -------------------
  //
  // The hunk headers below pin under the identity header. In standalone
  // mode they need to clear the header's height; in embedded mode the
  // header isn't rendered and the variable stays unset (calc() falls
  // back to 0). Same architecture as FileBlock — see file-block.tsx
  // for the full rationale.
  //
  // The body-kind actions row lives INSIDE the chrome / identity
  // header (no separate sticky strip), so the only
  // telescoping height this body kind writes is the header's. The
  // hunk-header `top:` calc loses the formerly-needed
  // `--tugx-diff-actions-height` term.
  //
  // [L03] useLayoutEffect — variable set before paint.
  // [L06] DOM write, never React state.
  // [L20] DiffBlock owns `--tugx-diff-*` (the variable is in that family).
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const headerRef = React.useRef<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const header = headerRef.current;
    if (root === null) return;
    if (header === null) {
      root.style.removeProperty("--tugx-diff-header-height");
      return;
    }
    const write = (px: number): void => {
      root.style.setProperty("--tugx-diff-header-height", `${px}px`);
    };
    write(header.offsetHeight);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const boxes = entry.borderBoxSize;
      const next =
        boxes !== undefined && boxes.length > 0
          ? boxes[0].blockSize
          : entry.contentRect.height;
      write(next);
    });
    observer.observe(header);
    return () => {
      observer.disconnect();
    };
  }, [embedded, data === undefined]);

  // Chrome actions target — non-null when this DiffBlock is composed
  // inside a `ToolWrapperChrome`. The resting affordances (fold cue,
  // view-toggle) portal into the chrome's actions slot when embedded,
  // or render in `.tugx-diff-header` trailing area when standalone.
  // See `file-block.tsx` for the corresponding pattern; the same
  // portal contract applies here.
  const chromeActionsTarget = useChromeActionsTarget();

  // Dev-mode misconfiguration check — `embedded={true}` requires a
  // parent `ToolWrapperChrome` so affordances have a portal target.
  // Without one, the identity header is suppressed AND the portal
  // target is `null`, so fold cue / view-toggle vanish silently. The
  // setTimeout defers past the chrome's first-render
  // ref-callback → state-update → re-render cycle so the warn doesn't
  // fire spuriously when the chrome IS present. See `file-block.tsx`'s
  // version for the full rationale; the pattern is identical.
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!embedded) return;
    if (chromeActionsTarget !== null) return;
    const handle = window.setTimeout(() => {
      console.warn(
        "DiffBlock: `embedded={true}` requires a parent `ToolWrapperChrome`. " +
          "Without one, the body kind's identity header is suppressed AND its " +
          "affordances (fold cue, view-toggle) have nowhere to portal — the " +
          "user loses access to them silently. Either compose under a chrome " +
          "or set `embedded={false}`.",
      );
    }, 0);
    return () => {
      window.clearTimeout(handle);
    };
  }, [embedded, chromeActionsTarget]);

  // -- View mode (inline | side-by-side) ------------------------------------
  //
  // Two distinct shapes coexist:
  //
  //   1. Persisted (per-card): the preference is owned by tugbank.
  //      Per [L02] it enters React via `useSyncExternalStore`
  //      (`useDiffViewMode` subscribes to tugbank's domain-changed
  //      callback). Toggling writes optimistically through tugbank's
  //      local cache so the subscription re-fires synchronously and
  //      the UI updates without waiting for a server round-trip.
  //   2. Ephemeral (no `cardId`): the consumer hasn't opted into
  //      persistence — e.g., gallery cards, ad-hoc usage. The toggle
  //      flips local React state. This local state is purely
  //      component-scoped per [L24]'s "local data" zone, so `useState`
  //      is the correct mechanism.
  //
  // Composition order: controlled prop > persisted (when cardId) >
  // local fallback > "inline".
  const persistedViewMode = useDiffViewMode(cardId);
  const [localViewMode, setLocalViewMode] = React.useState<DiffViewMode | null>(
    null,
  );
  const viewMode: DiffViewMode =
    viewModeProp ??
    (cardId !== undefined ? persistedViewMode : null) ??
    localViewMode ??
    "inline";

  // Apply a specific next view mode. Persistence and local-state
  // resolution mirror what `toggleViewMode` used to do; pulling the
  // explicit value out of the callback lets the responder-chain
  // `selectValue` handler thread the segment's value straight
  // through. Live-state via a ref ([L07]) keeps the choice-group
  // handler stable across renders.
  const applyViewMode = React.useCallback(
    (next: DiffViewMode) => {
      if (cardId !== undefined) {
        writeDiffViewMode(cardId, next);
      } else {
        setLocalViewMode(next);
      }
      onViewModeChange?.(next);
    },
    [cardId, onViewModeChange],
  );

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
  //
  // Computed-value pattern. Mirrors the `viewMode` resolution above:
  // the parent's prop wins when provided, local state covers the
  // uncontrolled case. No `useEffect` syncs a prop into state — that
  // pattern would create a "controlled prop says X, local state
  // says Y" divergence after a click in uncontrolled mode.
  // Mount-in-saved-state: seed `useState`'s initializer with the saved
  // fold (when any) so the first paint reflects the user's last-saved
  // state. See `tuglaws/state-preservation.md` → "Restoring saved state
  // at mount".
  const savedComponentState = useSavedComponentState<{ collapsed?: boolean }>(
    componentStatePreservationKey,
  );
  const [localCollapsed, setLocalCollapsed] = React.useState<boolean>(
    () =>
      typeof savedComponentState?.collapsed === "boolean"
        ? savedComponentState.collapsed
        : false,
  );
  const collapsed =
    collapsedProp !== undefined ? collapsedProp : localCollapsed;

  // ---- Component-state preservation (uncontrolled state) ---------------
  //
  // Persist `collapsed` into `bag.components` so a Developer > Reload
  // restores the fold state. View-mode persistence runs through
  // tugbank (`cardId` route) independently; we don't double-persist
  // it here. DiffBlock has no inner scrollport (the hunks flow in
  // document order), so no scroll-position field. [A9]
  useComponentStatePreservation<{ collapsed?: boolean }>({
    componentStatePreservationKey,
    captureState: () => ({ collapsed }),
  });

  // ---- Responder identity for find + view-toggle chain ----------------
  //
  // DiffBlock graduates to "responder + responder parent" once the find
  // row lands. The block's stable id is held in `diffBlockResponderId`
  // (`React.useId`) so the find session's form responder
  // (`parentResponderId`) and the view-toggle form responder
  // (`parentId`) can both register as children. Without an explicit
  // parentId on the view-toggle form, sibling hook calls in the same
  // component would all read the same outer `ResponderParentContext`
  // and register as SIBLINGS of `diffBlockResponder` — chain walks
  // from inside the choice group would skip past the block entirely
  // and Cmd-G / Shift-Cmd-G would not reach `FIND_NEXT` /
  // `FIND_PREVIOUS`.
  const diffBlockResponderId = React.useId();

  // Chain manager — promotes the block to first-responder after a
  // focus-refusing click (fold cue, Find button affordances carry
  // `data-tug-focus="refuse"`, so the provider's pointerdown skips
  // chain promotion on their clicks). The manager is `null` outside
  // a `ResponderChainProvider` (gallery cards, unit tests); promote
  // calls short-circuit via `?.`.
  const chainManager = useResponderChain();

  // Position-stable click infrastructure. Two complementary mechanisms
  // keep the click target stable across layout changes:
  //
  //   1. Scrollport-level tail spacer (`tailSpacer` prop on
  //      `TugListView`, wired by tide-card-transcript): raises the
  //      scrollport's `maxScrollTop` so a collapse that shrinks the
  //      document doesn't immediately force the browser to clamp
  //      `scrollTop` below the value the position-stable hook would
  //      need to write.
  //
  //   2. `usePositionStableClick`: after the mutator runs (and the
  //      DOM has settled via `flushSync`), measures the click target's
  //      new viewport Y and writes the exact `scrollTop` that puts it
  //      back at the snapshot Y. With the tail spacer raising the
  //      ceiling, the target scrollTop typically falls inside the
  //      valid range and the write sticks.
  //
  // Both buttons (fold cue, view-toggle) route through the hook. The
  // fold cue benefits especially from the combination: collapse
  // shrinks the document a lot, but the tail spacer absorbs the
  // shrinkage and the hook fine-tunes the final scrollTop to keep
  // the chrome under the user's cursor.
  const outerScrollport = useOuterScrollport();
  const outerScrollportRef = React.useRef<HTMLElement | null>(null);
  outerScrollportRef.current = outerScrollport;

  // Cmd/Ctrl-wheel routes to the outer card scrollport. DiffBlock
  // does not currently install an inner scrollport (the diff body
  // flows in the document), but the contract is surface-wide: any
  // inner scrolling that future variants introduce (e.g. a max-height
  // mode for very tall multi-hunk diffs) is bypassed identically by
  // virtue of attaching to the root. Without this, a future inner
  // scroll would stutter the outer card skim until the bypass was
  // also wired in — wiring it preemptively keeps the contract
  // consistent across all body kinds. See
  // `use-outer-scroll-on-modifier-wheel.ts` for the contract.
  useOuterScrollOnModifierWheel({
    innerRef: rootRef,
    outerScrollportRef,
  });
  // The view-toggle is a `TugChoiceGroup` (a `div[role=radiogroup]`),
  // not a single button — `viewToggleRef` points at the choice
  // group's root so the position-stable hook anchors against the
  // cluster as a whole. Activating any segment dispatches
  // `selectValue` through the responder chain (see
  // `viewToggleForm.selectValue` below), and the chain handler
  // routes the side effect through `stableViewToggleClick` to
  // preserve the cluster's viewport position across the layout
  // change the new view mode triggers. (The Copy + fold-cue
  // affordances are library components that own their own
  // position-stable click wiring internally — no refs threaded
  // through here.)
  const viewToggleRef = React.useRef<HTMLDivElement | null>(null);
  const { stableClick: stableViewToggleClick } = usePositionStableClick({
    targetRef: viewToggleRef,
    scrollportRef: outerScrollportRef,
  });

  // Fold-cue toggle callback. The `BlockFoldCue` affordance has
  // already dispatched `tug-disengage-follow-bottom` and routed the
  // click through its position-stable wrapper; this callback owns
  // DiffBlock's state mutation (controlled vs uncontrolled) and
  // host notification.
  const handleFoldToggle = React.useCallback((next: boolean) => {
    if (collapsedProp === undefined) {
      setLocalCollapsed(next);
    }
    onToggleCollapsed?.(next);
  }, [collapsedProp, onToggleCollapsed]);

  // ---- Copy text source ------------------------------------------------
  //
  // `copyText` memo drives the render-time disabled check on
  // `BlockCopyButton`; `getCopyText` is the closure the affordance
  // reads at click time. The affordance owns the confirmation
  // flash, timer cleanup, and clipboard call.
  const copyText = React.useMemo(
    () => (data === undefined ? "" : composeDiffCopyText(data, hunks)),
    [data, hunks],
  );
  const copyTextRef = React.useRef<string>(copyText);
  React.useLayoutEffect(() => {
    copyTextRef.current = copyText;
  }, [copyText]);
  const getCopyText = React.useCallback(() => copyTextRef.current, []);

  // ---- View-toggle responder form -------------------------------------
  //
  // The view-toggle migrated from a `TugPushButton` (label-flipping
  // `widthStabilize` shim) to a `TugChoiceGroup` (two visible
  // segments — Side by side, Inline). TugChoiceGroup is a control
  // per [L11]: clicking a segment dispatches `selectValue` with the
  // segment's value and the configured `senderId`. DiffBlock is the
  // responder for `viewMode`, so it registers a `selectValue`
  // handler that maps the segment value back to `applyViewMode`.
  //
  // The handler runs `applyViewMode` inside `stableViewToggleClick`
  // so the cluster's viewport position stays put across the layout
  // change a view-mode flip can trigger (inline ↔ side-by-side
  // re-arranges row count for hunks with unpaired removes/adds; the
  // document height can shift by ~10–20% on a large diff).
  //
  // `tug-disengage-follow-bottom` fires BEFORE the state update so
  // any host TugListView releases its auto-pin lock — same contract
  // FileBlock / DiffBlock fold cues use.
  //
  // The `senderId` is `useId`-derived (gensym hygiene per
  // useResponderForm's docstring). A latest-ref carries
  // `applyViewMode` so the handler is stable across renders while
  // still calling the most-recent closure.
  const viewToggleSenderId = React.useId();
  const applyViewModeRef = React.useRef(applyViewMode);
  React.useLayoutEffect(() => {
    applyViewModeRef.current = applyViewMode;
  }, [applyViewMode]);
  const stableViewToggleClickRef = React.useRef(stableViewToggleClick);
  React.useLayoutEffect(() => {
    stableViewToggleClickRef.current = stableViewToggleClick;
  }, [stableViewToggleClick]);
  const viewToggleForm = useResponderForm({
    // Explicit parentId — without it the form registers as a sibling
    // of `diffBlockResponder` (both hook calls read the same outer
    // ResponderParentContext) and chain walks from inside the choice
    // group skip past the block entirely. See comment at
    // `diffBlockResponderId` above for the full rationale.
    parentId: diffBlockResponderId,
    selectValue: {
      [viewToggleSenderId]: (next: string) => {
        // Disengage follow-bottom BEFORE the mutator runs — same
        // contract as the fold cue toggle.
        rootRef.current?.dispatchEvent(
          new CustomEvent("tug-disengage-follow-bottom", { bubbles: true }),
        );
        // Type-narrow the segment value into DiffViewMode at the
        // chain boundary. Unknown values are no-ops — the choice
        // group is configured with exactly two items so this is
        // defensive; an unrecognized value would indicate a
        // misconfiguration upstream.
        const value = next === "side-by-side" ? "side-by-side" : "inline";
        stableViewToggleClickRef.current?.(() => {
          applyViewModeRef.current?.(value);
        });
      },
    },
  });

  // ---- Find UI session ----------------------------------------------------
  //
  // Single source for the find-row state machine, focus discipline,
  // reload-survival slot, and `data-tug-focus-key` composition. The
  // hook (consumer of the framework focus axis per [D95]) owns the
  // row's internal lifecycle; DiffBlock contributes the pre-open work
  // (uncollapse on collapsed → expand, first-responder promotion) and
  // — once a diff-editor search bridge ships — the substrate-side
  // navigation hooks. Until then `findNext` / `findPrevious` stub to
  // no-op; the row still opens, accepts input, preserves focus across
  // activation paths, and survives reload via the [A9] slot.
  const findSession = useBlockFindSession({
    scope: "diff-block-find",
    componentStatePreservationKey,
    parentResponderId: diffBlockResponderId,
    navigation: {
      findNext: () => undefined,
      findPrevious: () => undefined,
    },
    onBeforeOpen: () => {
      if (collapsed) {
        // Reveal the body so the row pins below the identity header
        // with the diff content visible. Disengage the host list's
        // bottom-pin in the same beat (mirrors the fold-cue toggle).
        rootRef.current?.dispatchEvent(
          new CustomEvent("tug-disengage-follow-bottom", { bubbles: true }),
        );
        if (collapsedProp === undefined) {
          setLocalCollapsed(false);
        }
        onToggleCollapsed?.(false);
      }
      // Promote DiffBlock to first-responder so Cmd-F dispatches
      // arriving while the chain is still settling find their way
      // home. Idempotent if we already own first-responder.
      chainManager?.makeFirstResponder(diffBlockResponderId);
    },
  });

  // ---- Responder registration -----------------------------------------
  //
  // DiffBlock owns the find session via `findSession` and is the
  // responder for the find-related actions per [L11]. The action map
  // comes from the session — Cmd-F / Cmd-G / Shift-Cmd-G dispatched
  // through the chain reach the session's handlers, which in turn
  // call `findSession.open` / the substrate-specific navigation.
  // Registered ONCE at mount with stable handlers ([L07]: the session's
  // action map is memoized and the handlers read live state through
  // refs).
  const diffBlockResponder = useOptionalResponder({
    id: diffBlockResponderId,
    actions: findSession.actions,
  });

  // Choice items are module-level constants (immutable) so the
  // observer-driven sliding indicator inside TugChoiceGroup doesn't
  // re-attach on every render. The labels match the user-facing
  // language; aria-label echoes the label (icon-only segments would
  // require aria-label, but ours carry visible text — the aria-label
  // here is for symmetry across the items array).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const viewToggleItems = React.useMemo<TugChoiceItem[]>(
    () => [
      {
        value: "side-by-side",
        label: "Side by side",
        icon: <Columns2 aria-hidden="true" />,
        iconPosition: "left",
        "aria-label": "Side by side",
      },
      {
        value: "inline",
        label: "Inline",
        icon: <AlignLeft aria-hidden="true" />,
        iconPosition: "left",
        "aria-label": "Inline",
      },
    ],
    [],
  );

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

  // -- Per-hunk derived render data (memoized) ------------------------------
  //
  // `pairs`, `wordRangesByLineIndex`, and `sbsRows` are all functions
  // of `(hunks, wordEngine)`. Recomputing them on every render
  // (including viewMode/collapse toggles) was wasteful — `useMemo`
  // pins the work to the inputs that actually drive it.
  const renderData = React.useMemo(
    () => (hunks === null ? null : deriveHunkRenderData(hunks, wordEngine)),
    [hunks, wordEngine],
  );

  const stats = React.useMemo(
    () => (hunks === null ? { added: 0, removed: 0 } : countDiffStats(hunks)),
    [hunks],
  );

  // -- Render ----------------------------------------------------------------

  // Composed root ref — same shape as FileBlock's `composedRootRef`.
  // Forwards to the local `rootRef` (used to dispatch the disengage-
  // follow-bottom event and as a measurement anchor) AND to the
  // diff-block responder's ref-callback (writes `data-responder-id`
  // so the chain can walk through this responder). The view-toggle
  // form is a child responder reached via `parentId` and chain-walk;
  // it does not need its own DOM element. Defined as a stable
  // callback per [L24]'s structure-zone treatment of ref callbacks.
  const composedRootRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el;
      diffBlockResponder.responderRef(el);
    },
    [diffBlockResponder.responderRef],
  );

  if (data === undefined) {
    return (
      <diffBlockResponder.ResponderScope>
        <viewToggleForm.ResponderScope>
          <div
            ref={composedRootRef}
            data-slot={DATA_SLOT_ROOT}
            data-empty="true"
            className={
              className === undefined ? "tugx-diff" : `tugx-diff ${className}`
            }
          />
        </viewToggleForm.ResponderScope>
      </diffBlockResponder.ResponderScope>
    );
  }

  const rootClass =
    "tugx-diff" + (className === undefined ? "" : ` ${className}`);

  const filePath = data.filePath ?? "";
  const headerBasename = basename(filePath);

  if (hunks === null) {
    return (
      <diffBlockResponder.ResponderScope>
        <viewToggleForm.ResponderScope>
          <div
            ref={composedRootRef}
            data-slot={DATA_SLOT_ROOT}
            data-loading="true"
            data-embedded={embedded ? "true" : undefined}
            data-view-mode={viewMode}
            className={rootClass}
          >
            {embedded ? null : (
              <div
                ref={headerRef}
                className="tugx-diff-header"
                data-slot={DATA_SLOT_HEADER}
              >
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
        </viewToggleForm.ResponderScope>
      </diffBlockResponder.ResponderScope>
    );
  }

  const empty = hunks.length === 0;

  // Compose the resting affordances cluster (view-toggle + Copy +
  // fold cue) once; render inline (standalone) or via portal into
  // the chrome's actions slot (embedded). Ordering: features
  // (view-toggle → Copy) → fold cue (rightmost). The fold cue is
  // the fixed-landmark affordance; features sit to its left.
  //
  // Copy and fold-cue come from the `body-kinds/affordances/`
  // library — the contract (position-stable click, ghost
  // typography, 2xs scale, focus-refuse, confirmation flash,
  // width-stabilize for Copy, disengage-follow-bottom event for
  // fold) is encapsulated there. View-toggle is a `TugChoiceGroup`
  // — both segments visible at all times via the ghost emphasis
  // bracket frame.
  const hunkCountWord = hunks.length === 1 ? "hunk" : "hunks";
  const cueLabel = `${hunks.length} ${hunkCountWord}`;
  // Copy disabled when there's no composable text — empty memo
  // means async hunks still loading, or hunks parsed to nothing.
  const copyDisabled = copyText.length === 0;
  const affordances = empty ? null : (
    <>
      <TugChoiceGroup
        ref={viewToggleRef}
        className="tugx-diff-view-toggle"
        data-slot={DATA_SLOT_VIEW_TOGGLE}
        items={viewToggleItems}
        value={viewMode}
        senderId={viewToggleSenderId}
        size="2xs"
        emphasis="ghost"
        disabled={collapsed}
        aria-label="Diff view mode"
      />
      <BlockCopyButton
        className="tugx-diff-copy"
        data-slot="diff-copy"
        disabled={copyDisabled}
        aria-label="Copy diff"
        getText={getCopyText}
      />
      <BlockFoldCue
        className="tugx-diff-fold-cue"
        data-slot="diff-fold-cue"
        collapsed={collapsed}
        onToggle={handleFoldToggle}
        label={cueLabel}
        ariaLabelCollapse="Collapse diff"
        ariaLabelExpand="Expand diff"
      />
    </>
  );

  const portaledAffordances =
    embedded && chromeActionsTarget !== null && affordances !== null
      ? createPortal(
          <span
            className="tugx-diff-actions-cluster"
            data-slot="diff-actions"
          >
            {affordances}
          </span>,
          chromeActionsTarget,
        )
      : null;

  return (
    <diffBlockResponder.ResponderScope>
    <viewToggleForm.ResponderScope>
    <div
      ref={composedRootRef}
      data-slot={DATA_SLOT_ROOT}
      data-empty={empty ? "true" : "false"}
      data-collapsed={collapsed ? "true" : "false"}
      data-embedded={embedded ? "true" : undefined}
      data-view-mode={viewMode}
      className={rootClass}
    >
      {embedded ? null : (
        <div
          ref={headerRef}
          className="tugx-diff-header"
          data-slot={DATA_SLOT_HEADER}
        >
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
          <span className="tugx-diff-header-spacer" />
          {affordances !== null ? (
            <span
              className="tugx-diff-actions-cluster"
              data-slot="diff-actions"
            >
              {affordances}
            </span>
          ) : null}
        </div>
      )}
      {portaledAffordances}

      {findSession.state.open && !empty && !collapsed ? (
        <TugBlockFindRow
          findSession={findSession}
          ariaLabel="Find in diff"
          className="tugx-diff-find"
        />
      ) : null}

      {!collapsed && renderData !== null ? (
        <div className="tugx-diff-hunks" data-slot={DATA_SLOT_HUNKS}>
          {renderData.map((hunkData, index) => {
            const isHunkCollapsed = collapsedHunks.has(index);
            return (
              <div
                key={index}
                className="tugx-diff-hunk"
                data-slot={DATA_SLOT_HUNK}
                data-hunk-index={index}
                data-collapsed={isHunkCollapsed ? "true" : "false"}
              >
                <TugCue
                  role="muted"
                  align="start"
                  mono
                  icon={
                    isHunkCollapsed ? (
                      <ChevronRight aria-hidden />
                    ) : (
                      <ChevronDown aria-hidden />
                    )
                  }
                  aria-expanded={!isHunkCollapsed}
                  aria-label={isHunkCollapsed ? "Expand hunk" : "Collapse hunk"}
                  onClick={() => toggleHunk(index)}
                  className="tugx-diff-hunk-header"
                >
                  {composeHunkHeader(hunkData.hunk)}
                </TugCue>
                <div
                  className="tugx-diff-hunk-rows"
                  data-slot={DATA_SLOT_HUNK_ROWS}
                >
                  {viewMode === "inline"
                    ? renderInlineHunkBody(hunkData, syntaxByLine)
                    : renderSideBySideHunkBody(hunkData, syntaxByLine)}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
    </viewToggleForm.ResponderScope>
    </diffBlockResponder.ResponderScope>
  );
};

// ---------------------------------------------------------------------------
// Per-hunk derived render data
// ---------------------------------------------------------------------------

/**
 * Per-hunk derived state used by the renderer. Computed once per
 * `(hunks, wordEngine)` change via `useMemo` so re-renders that
 * don't change the diff (toggling viewMode, expand/collapse, etc.)
 * don't re-walk the hunk lines.
 */
interface HunkRenderData {
  hunk: DiffHunk;
  pairs: Map<number, number>;
  /**
   * Per-line word-level ranges keyed by `lineIndex`. Only populated
   * for lines participating in a (remove, add) pair. One
   * `wordLevelDiffSync` call per *pair*, not per line — both sides
   * share the same `WordDiffSegment[]` projected onto opposite sides
   * via `wordRangesForSide`.
   */
  wordRangesByLineIndex: Map<number, WordRange[]>;
  /** Side-by-side row layout for this hunk. Computed eagerly so the
   * SBS render path is a pure lookup. */
  sbsRows: SideBySideRow[];
}

/**
 * Compute everything the renderer needs for one hunk: pairing,
 * per-line word ranges, side-by-side row layout. Called once per
 * `(hunks, wordEngine)` tuple via `useMemo`.
 */
function deriveHunkRenderData(
  hunks: readonly DiffHunk[],
  wordEngine: WordEngineCtor | null,
): HunkRenderData[] {
  return hunks.map((hunk) => {
    const pairs = pairRemoveAddIndices(hunk.lines);
    const wordRangesByLineIndex = new Map<number, WordRange[]>();
    if (wordEngine !== null) {
      for (const [removeIdx, addIdx] of pairs) {
        const segments = wordLevelDiffSync(
          hunk.lines[removeIdx].content,
          hunk.lines[addIdx].content,
          wordEngine,
        );
        wordRangesByLineIndex.set(
          removeIdx,
          wordRangesForSide(segments, "remove"),
        );
        wordRangesByLineIndex.set(
          addIdx,
          wordRangesForSide(segments, "add"),
        );
      }
    }
    const sbsRows = groupSideBySideRows(hunk.lines);
    return { hunk, pairs, wordRangesByLineIndex, sbsRows };
  });
}

// ---------------------------------------------------------------------------
// Word-level helpers
// ---------------------------------------------------------------------------

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
  data: HunkRenderData,
  syntaxByLine: ReadonlyMap<string, SyntaxToken[]>,
): React.ReactNode {
  const { hunk, wordRangesByLineIndex } = data;
  return hunk.lines.map((line, lineIndex) => {
    const wordRanges = wordRangesByLineIndex.get(lineIndex) ?? null;
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
          {/* Context lines have `before_lineno === after_lineno` — showing
              the same number in both gutters reads as visual noise. Render
              the number only in the `before` gutter for context lines; the
              `after` gutter stays as an empty placeholder so the 4-column
              grid stays aligned. Add / remove lines still fill the
              appropriate side. */}
          {line.kind === "context" ? "" : (line.after_lineno ?? "")}
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
 *
 * Word-level ranges come from `data.wordRangesByLineIndex` —
 * precomputed once per `(hunks, wordEngine)` change via
 * `deriveHunkRenderData`. The SBS row's `paired` flag and the
 * inline `pairs` Map agree by construction (both routed through
 * `pairRemoveAddIndices`'s run-zip), so a paired SBS row always
 * has corresponding entries in `wordRangesByLineIndex`.
 */
function renderSideBySideHunkBody(
  data: HunkRenderData,
  syntaxByLine: ReadonlyMap<string, SyntaxToken[]>,
): React.ReactNode {
  const { sbsRows, wordRangesByLineIndex } = data;
  return sbsRows.map((row, rowIndex) => {
    const leftRanges =
      row.leftIndex !== null
        ? (wordRangesByLineIndex.get(row.leftIndex) ?? null)
        : null;
    const rightRanges =
      row.rightIndex !== null
        ? (wordRangesByLineIndex.get(row.rightIndex) ?? null)
        : null;
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
