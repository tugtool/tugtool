/**
 * `SearchResultBlock` — Layer-1 body kind for grouped search results.
 *
 * A *list-shaped* body kind ([#bk-conformance] item 9): like
 * `PathListBlock` ([#step-15]) it is built on `TugListView` rather than
 * rendering rows by hand, so it inherits the data-source contract and
 * consistent cell wrappers. `GrepToolBlock` ([#step-16]) composes it
 * `embedded` for its content mode.
 *
 * Composition (mirrors `PathListBlock` / `JsonTreeBlock`):
 *  - Header (standalone only) — an optional identity `label`, the file
 *    + match counts, an optional "truncated at N files" indicator, and
 *    a trailing actions cluster (Copy). In `embedded` mode the header
 *    is suppressed and the cluster portals into the host
 *    `ToolBlockChrome`'s actions slot.
 *  - Body — a `TugListView` in `inline` mode (every row rendered, no
 *    windowing). The block grows to its natural height and the *outer*
 *    transcript scrolls; it is not boxed into an inner scroller. Rows
 *    are of two kinds: a clickable file-header row and a match row.
 *
 * Grouping + collapse:
 *  - Results are grouped by file. Each file gets a collapsible header
 *    row (twist chevron + path + match count); clicking it folds the
 *    file's match rows away. Collapse is logical UI state — it changes
 *    *which* rows exist, not how a row looks ([L06]) — so it lives in
 *    React state and is persisted through the [A9] component-state
 *    axis.
 *
 * Match rendering:
 *  - Each match row shows the matched line (line number + text with
 *    the match span highlighted) and any surrounding context lines
 *    above / below it, rendered dimmer. The highlight is driven by
 *    explicit char `spans` carried on the match — no regex is executed
 *    at render time, so a complex or invalid pattern can never break
 *    the render.
 *  - File paths use the shared `MiddleEllipsisPath` ([#bk-conformance]
 *    item 8) — the same CSS-driven middle-ellipsis the file tool
 *    wrappers use.
 *
 * What this body kind does NOT do:
 *  - Render a text-entry / find field. A card has at most one
 *    text-entry surface ([#bk-conformance] item 2); this block
 *    *displays* search results — the query comes from the `Grep` tool
 *    call, not an in-block input. SearchResultBlock renders zero
 *    `<input>` / `<textarea>` elements.
 *  - Make match rows interactive. Results are display-only; a
 *    click-to-open affordance is a deferred follow-on (same deferral
 *    as `EditToolBlock`'s filetree link).
 *
 * Laws:
 *  - [L06] collapse state is logical state (which rows exist) → React
 *    state; row hover and the match highlight are pure CSS.
 *  - [L11] SearchResultBlock owns no responder. Copy is a
 *    `BlockCopyButton` (a self-contained control); the file-header
 *    toggle is a plain click on an inert row, no first-responder
 *    dependency.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="search-result-body"` on the root, this docstring.
 *  - [L20] component-token sovereignty — owns `--tugx-search-*`;
 *    consumes `--tugx-block-*` for the shared block scaffold and
 *    cascade-tunes `--tugx-list-view-*` for its instance.
 *  - [L23] collapse state survives reload via
 *    `useComponentStatePreservation`.
 *
 * Decisions:
 *  - [D05] two-layer split: this body kind owns result rendering; the
 *    tool block (`GrepToolBlock`) owns chrome.
 *
 * @module components/tugways/body-kinds/search-result-block
 */

import "./search-result-block.css";

import React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight } from "lucide-react";

import { MiddleEllipsisPath } from "@/components/tugways/cards/tool-blocks/middle-ellipsis-path";
import { useChromeActionsTarget } from "@/components/tugways/cards/tool-blocks/tool-block-chrome";
import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewCellRenderer,
  type TugListViewDataSource,
} from "@/components/tugways/tug-list-view";
import {
  useComponentStatePreservation,
  useSavedComponentState,
} from "@/components/tugways/use-component-state-preservation";
import { BlockActionsCluster, BlockCopyButton } from "./affordances";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A half-open `[start, end)` char range within a match line's `text`,
 * to be rendered highlighted. Ranges are clamped / merged at render
 * time by {@link splitMatchSegments}, so a producer may emit raw,
 * unsorted, or overlapping spans without breaking the render.
 */
export type SearchResultSpan = readonly [start: number, end: number];

/** One context line surrounding a match — a line number + its text. */
export interface SearchResultContextLine {
  /** 1-based line number. */
  line: number;
  /** Full text of the line. */
  text: string;
}

/** One match within a file — the matched line plus its context. */
export interface SearchResultMatch {
  /** 1-based line number of the matched line. */
  line: number;
  /** Full text of the matched line. */
  text: string;
  /** Char ranges within `text` to render highlighted. */
  spans: readonly SearchResultSpan[];
  /** Context lines immediately before the match, in ascending order. */
  before?: readonly SearchResultContextLine[];
  /** Context lines immediately after the match, in ascending order. */
  after?: readonly SearchResultContextLine[];
}

/** One file's matches, in producer order. */
export interface SearchResultFile {
  path: string;
  matches: readonly SearchResultMatch[];
}

/** Structured search-result data — the body's render input. */
export interface SearchResultData {
  /** The matched files, in producer order. */
  files: readonly SearchResultFile[];

  /**
   * When the producer truncated the result, the total file count it
   * would otherwise have returned — drives the "truncated at N files"
   * indicator. Undefined → the list is complete.
   */
  truncatedAt?: number;
}

export interface SearchResultBlockProps {
  /**
   * The search-result data. When undefined (or `files` is empty) the
   * block renders an empty `data-slot="search-result-body"` marker for
   * layout consistency.
   */
  data?: SearchResultData;

  /**
   * Optional identity label shown at the leading edge of the
   * standalone header (e.g. "matches"). Ignored in `embedded` mode —
   * the host owns identity there.
   */
  label?: string;

  /**
   * "Embedded" mode — composed inside a host that already paints a
   * container and a header (e.g. `ToolBlockChrome` in
   * `GrepToolBlock`). When `true` the standalone frame + header are
   * dropped and the actions cluster portals into the host chrome's
   * actions slot. MUST be used under a `ToolBlockChrome`.
   *
   * @default false
   */
  embedded?: boolean;

  /** Forwarded class name for cascade-scoped customization. */
  className?: string;

  /**
   * Opt-in key for the [A9] Component State Preservation Protocol.
   * When set, SearchResultBlock persists its per-file collapse set
   * into `bag.components` so a Developer > Reload restores it.
   * Undefined opts out (gallery, standalone).
   */
  componentStatePreservationKey?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FILE_CELL_KIND = "file";
const MATCH_CELL_KIND = "match";

const DATA_SLOT_ROOT = "search-result-body";
const DATA_SLOT_HEADER = "search-result-header";
const DATA_SLOT_ACTIONS = "search-result-actions";

// ---------------------------------------------------------------------------
// Pure helpers — exported because tests pin them
// ---------------------------------------------------------------------------

/** Total match count across every file in the result. */
export function totalMatchCount(data: SearchResultData): number {
  let total = 0;
  for (const file of data.files) total += file.matches.length;
  return total;
}

/** Compose the standalone-header file count, e.g. "1 file" / "3 files". */
export function composeFileCountLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "file" : "files"}`;
}

/** Compose the standalone-header match count, e.g. "1 match" / "12 matches". */
export function composeMatchCountLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "match" : "matches"}`;
}

/**
 * Compose the "truncated at N files" indicator, or `undefined` when
 * the result is complete. `truncatedAt` is the producer's
 * pre-truncation file total.
 */
export function composeSearchTruncationLabel(
  truncatedAt: number | undefined,
): string | undefined {
  if (truncatedAt === undefined) return undefined;
  return `truncated at ${truncatedAt.toLocaleString()} files`;
}

/** One run of a match line — a slice of text, flagged as a hit or not. */
export interface SearchTextSegment {
  text: string;
  /** `true` when this run falls inside a (clamped, merged) match span. */
  hit: boolean;
}

/**
 * Split a match line's `text` into alternating plain / highlighted
 * runs from its `spans`. Spans are defensively normalized first —
 * each is clamped to `[0, text.length]`, zero-width / inverted spans
 * are dropped, the rest are sorted and overlapping / adjacent spans
 * are merged — so a producer may emit raw, unsorted, or overlapping
 * ranges and the output is still a clean, gap-free run list. Empty
 * runs are never emitted.
 */
export function splitMatchSegments(
  text: string,
  spans: readonly SearchResultSpan[],
): SearchTextSegment[] {
  const len = text.length;

  // Normalize: clamp, drop empties, sort, merge.
  const normalized: Array<[number, number]> = [];
  for (const [rawStart, rawEnd] of spans) {
    const start = Math.max(0, Math.min(rawStart, len));
    const end = Math.max(0, Math.min(rawEnd, len));
    if (end > start) normalized.push([start, end]);
  }
  normalized.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const span of normalized) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span[0] <= last[1]) {
      last[1] = Math.max(last[1], span[1]);
    } else {
      merged.push([span[0], span[1]]);
    }
  }

  if (merged.length === 0) {
    return text.length > 0 ? [{ text, hit: false }] : [];
  }

  const segments: SearchTextSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), hit: false });
    }
    segments.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < len) {
    segments.push({ text: text.slice(cursor), hit: false });
  }
  return segments;
}

/**
 * Serialize a search result to plain text for the Copy affordance —
 * each file path on its own line, followed by its matched lines
 * indented as `  {line}: {text}`.
 */
export function composeSearchResultText(data: SearchResultData): string {
  const lines: string[] = [];
  for (const file of data.files) {
    lines.push(file.path);
    for (const match of file.matches) {
      lines.push(`  ${match.line}: ${match.text}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Row model — the flattened file-header / match sequence
// ---------------------------------------------------------------------------

/** A file-header row — the collapsible group head. */
interface FileRow {
  kind: typeof FILE_CELL_KIND;
  id: string;
  path: string;
  matchCount: number;
  collapsed: boolean;
}

/** A match row — one match within a file. */
interface MatchRow {
  kind: typeof MATCH_CELL_KIND;
  id: string;
  filePath: string;
  match: SearchResultMatch;
}

/** A row in the flattened list — a file header or one of its matches. */
export type SearchRow = FileRow | MatchRow;

/**
 * Flatten the grouped result into the `TugListView` row sequence: one
 * file-header row per file, followed — for files not in the
 * `collapsed` set — by one match row per match. Ids are positional so
 * they are stable across a re-render with the same data and distinct
 * across files even if two files share a path-less basename.
 */
export function buildSearchRows(
  files: readonly SearchResultFile[],
  collapsed: ReadonlySet<string>,
): SearchRow[] {
  const rows: SearchRow[] = [];
  files.forEach((file, fileIndex) => {
    const isCollapsed = collapsed.has(file.path);
    rows.push({
      kind: FILE_CELL_KIND,
      id: `f:${fileIndex}:${file.path}`,
      path: file.path,
      matchCount: file.matches.length,
      collapsed: isCollapsed,
    });
    if (isCollapsed) return;
    file.matches.forEach((match, matchIndex) => {
      rows.push({
        kind: MATCH_CELL_KIND,
        id: `m:${fileIndex}:${matchIndex}`,
        filePath: file.path,
        match,
      });
    });
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Data source — TugListView-backed, immutable per instance
// ---------------------------------------------------------------------------

const NOOP_UNSUBSCRIBE = (): void => {};

/**
 * A `TugListView` data source over an immutable, already-flattened row
 * array. Each SearchResultBlock render that changes the visible rows
 * (a collapse toggle, new data) builds a fresh instance — the array
 * never mutates in place, so `subscribe` is a no-op and `getVersion`
 * returns the array reference (stable per instance, distinct across
 * instances). The file-collapse toggle callback rides the instance so
 * the file-header cell renderer can reach it without a context.
 */
class SearchResultDataSource implements TugListViewDataSource {
  constructor(
    private readonly rows: readonly SearchRow[],
    private readonly onToggleFile: (path: string) => void,
  ) {}

  numberOfItems(): number {
    return this.rows.length;
  }

  idForIndex(index: number): string {
    return this.rows[index].id;
  }

  kindForIndex(index: number): string {
    return this.rows[index].kind;
  }

  subscribe(): () => void {
    return NOOP_UNSUBSCRIBE;
  }

  getVersion(): unknown {
    return this.rows;
  }

  /** Cell-renderer accessor — the row at `index`. */
  rowAt(index: number): SearchRow {
    return this.rows[index];
  }

  /** Cell-renderer callback — toggle a file's collapse state. */
  requestToggleFile(path: string): void {
    this.onToggleFile(path);
  }
}

// ---------------------------------------------------------------------------
// Cell renderers
// ---------------------------------------------------------------------------

/**
 * A collapsible file-header row — twist chevron + path + match count.
 * Clicking the row toggles the file's collapse state. Mirrors
 * `JsonTreeBlock`'s container line: a plain click on an inert row, no
 * role / tabindex.
 */
const FileHeaderCell: TugListViewCellRenderer<SearchResultDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<SearchResultDataSource>) => {
  const row = dataSource.rowAt(index);
  if (row.kind !== FILE_CELL_KIND) return null;

  return (
    <div
      className="tugx-search-file"
      data-slot="search-result-file"
      data-collapsed={row.collapsed ? "true" : "false"}
      onClick={() => dataSource.requestToggleFile(row.path)}
    >
      <span className="tugx-search-twist" aria-hidden="true">
        {row.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
      </span>
      <MiddleEllipsisPath path={row.path} />
      <span className="tugx-search-file-count" data-slot="search-result-file-count">
        {composeMatchCountLabel(row.matchCount)}
      </span>
    </div>
  );
};

/** One context line — a dim line number + line text. */
const ContextLine: React.FC<{ line: SearchResultContextLine }> = ({ line }) => (
  <div className="tugx-search-line tugx-search-line--context">
    <span className="tugx-search-lineno">{line.line}</span>
    <span className="tugx-search-linetext">{line.text}</span>
  </div>
);

/**
 * A match row — the matched line (line number + highlighted text)
 * bracketed by its `before` / `after` context lines. The highlight is
 * driven entirely by the match's char `spans` via
 * {@link splitMatchSegments}.
 */
const MatchCell: TugListViewCellRenderer<SearchResultDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<SearchResultDataSource>) => {
  const row = dataSource.rowAt(index);
  if (row.kind !== MATCH_CELL_KIND) return null;
  const { match } = row;
  const segments = splitMatchSegments(match.text, match.spans);

  return (
    <div className="tugx-search-match" data-slot="search-result-match">
      {match.before?.map((line) => (
        <ContextLine key={`b${line.line}`} line={line} />
      ))}
      <div className="tugx-search-line tugx-search-line--match">
        <span className="tugx-search-lineno">{match.line}</span>
        <span className="tugx-search-linetext">
          {segments.map((segment, segmentIndex) =>
            segment.hit ? (
              <mark key={segmentIndex} className="tugx-search-hit">
                {segment.text}
              </mark>
            ) : (
              <span key={segmentIndex}>{segment.text}</span>
            ),
          )}
        </span>
      </div>
      {match.after?.map((line) => (
        <ContextLine key={`a${line.line}`} line={line} />
      ))}
    </div>
  );
};

/** Cell-renderer dispatch map — module-scope, two row shapes. */
const CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<SearchResultDataSource>
> = {
  [FILE_CELL_KIND]: FileHeaderCell,
  [MATCH_CELL_KIND]: MatchCell,
};

// ---------------------------------------------------------------------------
// Persisted state
// ---------------------------------------------------------------------------

/** Serialized state for the [A9] component-state axis. */
interface SearchResultPersistedState {
  /** Paths of files the user has collapsed. */
  collapsed?: string[];
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

export const SearchResultBlock: React.FC<SearchResultBlockProps> = ({
  data,
  label,
  embedded = false,
  className,
  componentStatePreservationKey,
}) => {
  // ---- Collapse state — logical UI state, React-owned per [L06] ------
  const savedState = useSavedComponentState<SearchResultPersistedState>(
    componentStatePreservationKey,
  );
  const [collapsed, setCollapsed] = React.useState<Set<string>>(
    () => new Set(savedState?.collapsed ?? []),
  );
  useComponentStatePreservation<SearchResultPersistedState>({
    componentStatePreservationKey,
    captureState: () => ({ collapsed: [...collapsed] }),
  });

  const handleToggleFile = React.useCallback((path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // ---- Rows + data source --------------------------------------------
  const files = data?.files;
  const rows = React.useMemo(
    () => (files === undefined ? [] : buildSearchRows(files, collapsed)),
    [files, collapsed],
  );
  const dataSource = React.useMemo(
    () => new SearchResultDataSource(rows, handleToggleFile),
    [rows, handleToggleFile],
  );

  // ---- Copy source ---------------------------------------------------
  //
  // `dataRef` carries the live data so `BlockCopyButton`'s `getText`
  // closure reads the freshest result at fire time ([L07]).
  const dataRef = React.useRef<SearchResultData | undefined>(data);
  React.useLayoutEffect(() => {
    dataRef.current = data;
  }, [data]);
  const getResultText = React.useCallback(
    () => (dataRef.current === undefined ? "" : composeSearchResultText(dataRef.current)),
    [],
  );

  // ---- Chrome actions target (embedded composition) ------------------
  const chromeActionsTarget = useChromeActionsTarget();

  // Dev-mode misconfiguration check — `embedded={true}` requires a
  // parent `ToolBlockChrome` or the actions cluster has nowhere to
  // portal. Mirrors `PathListBlock` / `FileBlock`'s deferred-warn
  // pattern: the chrome publishes its actions target via a
  // `useState`-tracked ref callback, so the target is `null` on the
  // body kind's first render under a legal chrome — the `setTimeout`
  // defers past reconciliation and the cleanup cancels the warn if the
  // target becomes non-null.
  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!embedded) return;
    if (chromeActionsTarget !== null) return;
    const handle = window.setTimeout(() => {
      console.warn(
        "SearchResultBlock: `embedded={true}` requires a parent " +
          "`ToolBlockChrome`. Without one the actions cluster (Copy) " +
          "has nowhere to portal and the user loses access to it " +
          "silently. Either compose under a chrome or set " +
          "`embedded={false}`.",
      );
    }, 0);
    return () => {
      window.clearTimeout(handle);
    };
  }, [embedded, chromeActionsTarget]);

  // ---- Empty data: layout-consistent marker --------------------------
  if (data === undefined || data.files.length === 0) {
    return (
      <div
        data-slot={DATA_SLOT_ROOT}
        data-empty="true"
        data-embedded={embedded ? "true" : undefined}
        className={
          className === undefined
            ? "tugx-search"
            : `tugx-search ${className}`
        }
      />
    );
  }

  const rootClass =
    "tugx-search" + (className === undefined ? "" : ` ${className}`);

  // The actions cluster — Copy. Composed once; rendered inline in
  // `.tugx-search-header` (standalone) or portaled into the host
  // chrome's actions slot (embedded).
  const actions = (
    <BlockCopyButton
      data-slot="search-result-copy"
      aria-label="Copy search results"
      getText={getResultText}
    />
  );

  const portaledActions =
    embedded && chromeActionsTarget !== null
      ? createPortal(
          <BlockActionsCluster data-slot={DATA_SLOT_ACTIONS}>
            {actions}
          </BlockActionsCluster>,
          chromeActionsTarget,
        )
      : null;

  const truncationLabel = composeSearchTruncationLabel(data.truncatedAt);

  return (
    <div
      data-slot={DATA_SLOT_ROOT}
      data-empty="false"
      data-embedded={embedded ? "true" : undefined}
      className={rootClass}
    >
      {embedded ? null : (
        <div className="tugx-search-header" data-slot={DATA_SLOT_HEADER}>
          {label !== undefined ? (
            <span className="tugx-search-label" data-slot="search-result-label">
              {label}
            </span>
          ) : null}
          <span className="tugx-search-count" data-slot="search-result-count">
            {composeFileCountLabel(data.files.length)}
            {" · "}
            {composeMatchCountLabel(totalMatchCount(data))}
          </span>
          {truncationLabel !== undefined ? (
            <span
              className="tugx-search-truncation"
              data-slot="search-result-truncation"
            >
              {truncationLabel}
            </span>
          ) : null}
          <span className="tugx-search-header-spacer" />
          <BlockActionsCluster data-slot={DATA_SLOT_ACTIONS}>
            {actions}
          </BlockActionsCluster>
        </div>
      )}
      {portaledActions}

      {/* `inline` — every row in document order, no windowing. The
       * block grows to its natural height; the outer transcript owns
       * the scroll. */}
      <TugListView<SearchResultDataSource>
        dataSource={dataSource}
        cellRenderers={CELL_RENDERERS}
        className="tugx-search-list"
        inline
      />
    </div>
  );
};
