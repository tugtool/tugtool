/**
 * GalleryListViewFilter — visual showcase + smoke test for
 * `useFilteredDataSource`.
 *
 * Mounts a `TugInput` above a `TugListView`; the input's value drives
 * a case-insensitive substring predicate that the list view consumes
 * via `useFilteredDataSource`. The card demonstrates the
 * UISearchController-style split landed in Phase 1 [D01]: the host
 * owns the search field; the primitive consumes a derived data
 * source. The `TugInput` is OUTSIDE the list view's DOM tree.
 *
 * Matching uses the shared `caseInsensitiveSubstring` from
 * `@/lib/text-match` — the same utility the picker (Phase 2) uses,
 * so both surfaces feel identical. Match ranges flow through to
 * `renderHighlighted`, which paints `<mark>` spans over the matched
 * substring portions. Case-insensitive is the default per the user
 * point that filesystem case-sensitivity does not dictate typeahead
 * case-sensitivity (typing `tugtool` should find `Tugtool`).
 *
 * The synthetic data is 50 fictional project paths with diverse
 * owners, roots, and project names so substring filtering produces
 * visually distinct narrowings — typing `tugtool` collapses to a
 * handful of matches; typing `/Users/Alex/` collapses to ten. Path-
 * shaped data also previews the eventual picker UX (Phase 2): the
 * picker's `path-recent` rows match this rough shape.
 *
 * Manual smoke (this card's reason for existing):
 *   - Type characters into the input — the list narrows to items
 *     whose path contains the typed substring case-insensitively per
 *     [Spec S01]; the matched span is highlighted in each row.
 *   - Type `TUGTOOL` (uppercase) — the same rows match as `tugtool`,
 *     and the highlight covers the original-case span in each path.
 *   - Backspace — the list widens. Scroll position should be stable
 *     across filter changes (no jumps to top, no flicker).
 *   - The "X of Y" diagnostic above the list reflects the live
 *     filtered count vs. the base count.
 *   - The cell renderer shows each row's filtered index AND its base
 *     index, so the `baseIndexFor` mapping is visible.
 *
 * Laws:
 *  - [L02] data source enters React via `useSyncExternalStore` (the
 *    list view's contract; the filter wrapper is itself such a store
 *    via `getVersion` / `subscribe`).
 *  - [L19] gallery-card authoring (module docstring, exported
 *    component, registered in `gallery-registrations.tsx`).
 *  - [L20] visual treatment via inline styles scoped to this card's
 *    cell renderer; no reach into `--tugx-list-view-*`.
 *
 * Decisions:
 *  - tugplan-dev-picker-redesign [D01] uitableview-search-split —
 *    the host owns the input.
 *  - [Spec S06] — `useFilteredDataSource(base, predicate, filterToken)`
 *    contract; `query` (a useState string) drives both the predicate
 *    closure's capture AND the `filterToken`.
 *
 * Cell-renderer / base-binding pattern:
 *  - The wrapper exposes `baseIndexFor(filteredIndex)` for index
 *    translation, but typed extension methods (`itemAt`, `rowAt`)
 *    live on the BASE data source, not the wrapper. The canonical
 *    pattern is to build cell renderers inside the host so the
 *    closure captures the base reference; renderers route through
 *    `baseIndexFor` to translate the wrapper index, then read the
 *    typed extension on the captured base. That's what this card
 *    does — see the `useMemo` block below.
 */

import "./gallery.css";

import React from "react";

import { TugInput } from "@/components/tugways/tug-input";
import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewCellRenderer,
  type TugListViewDataSource,
} from "@/components/tugways/tug-list-view";
import {
  useFilteredDataSource,
  type FilteredTugListViewDataSource,
} from "@/components/tugways/use-filtered-data-source";
import {
  caseInsensitiveSubstring,
  type MatchResult,
} from "@/lib/text-match";

// ---------------------------------------------------------------------------
// Synthetic data source
// ---------------------------------------------------------------------------

interface PathItem {
  readonly id: string;
  readonly kind: string;
  readonly path: string;
}

/**
 * Build 50 fictional project paths. Five owners × five roots × two
 * projects per (owner, root) cell — yields a list with multiple
 * overlapping prefixes and suffixes so substring filtering produces
 * visually distinct narrowings.
 */
function buildItems(): PathItem[] {
  const owners = ["Alex", "Ben", "Cory", "Dana", "Ellie"];
  const roots = ["projects", "src", "Mounts/u", "Documents", "code"];
  const projects = [
    "tugtool",
    "wisdom",
    "atlas",
    "horizon",
    "echo",
    "mosaic",
    "summit",
    "harbor",
    "delta",
    "axiom",
  ];
  const items: PathItem[] = [];
  let i = 0;
  for (const owner of owners) {
    for (const root of roots) {
      for (let p = 0; p < 2; p += 1) {
        const project = projects[(i + p) % projects.length];
        items.push({
          id: `id-${i}`,
          kind: "path",
          path: `/Users/${owner}/${root}/${project}`,
        });
        i += 1;
      }
    }
  }
  return items;
}

class GalleryListViewFilterDataSource implements TugListViewDataSource {
  private readonly items: ReadonlyArray<PathItem>;
  private readonly listeners = new Set<() => void>();

  constructor(items: ReadonlyArray<PathItem>) {
    this.items = items;
  }

  numberOfItems(): number {
    return this.items.length;
  }

  idForIndex(index: number): string {
    return this.items[index].id;
  }

  kindForIndex(index: number): string {
    return this.items[index].kind;
  }

  /** Cell-renderer accessor — reads the full path item at `index`. */
  itemAt(index: number): PathItem {
    return this.items[index];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Static data — version is constant. `useSyncExternalStore` compares
   * with `Object.is`; a constant satisfies the "no spurious re-render"
   * contract because identity never changes.
   */
  getVersion(): unknown {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Cell-renderer styles
// ---------------------------------------------------------------------------

const PATH_CELL_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--tug-space-sm)",
  padding: "var(--tug-space-xs) var(--tug-space-sm)",
  fontFamily: "var(--tug-font-family-mono)",
  fontSize: "var(--tug-font-size-sm)",
  borderRadius: "var(--tug-radius-sm)",
  background: "var(--tug7-surface-global-primary-normal-default-rest)",
  color: "var(--tug7-element-global-text-normal-default-rest)",
};

const INDEX_LABEL_STYLE: React.CSSProperties = {
  fontFamily: "var(--tug-font-family-mono)",
  fontSize: "var(--tug-font-size-xs)",
  color: "var(--tug7-element-global-text-normal-muted-rest)",
  flexShrink: 0,
  minWidth: "8em",
};

/**
 * Highlight style for matched substring spans. `<mark>` is the
 * semantic element for "marked or highlighted text" per HTML
 * Standard; we override the user agent's yellow background with a
 * theme-token equivalent so the highlight reads as part of the
 * surface, not a browser default.
 */
const MATCH_HIGHLIGHT_STYLE: React.CSSProperties = {
  background: "var(--tug7-surface-global-data-tinted-default-rest)",
  color: "var(--tug7-element-global-text-normal-default-rest)",
  borderRadius: "var(--tug-radius-2xs)",
  padding: "0 1px",
};

/**
 * Render a string with `<mark>` highlights at the supplied match
 * ranges. `matches` is a list of half-open `[start, end)` ranges in
 * UTF-16 code unit offsets — the same coordinate `String.slice()`
 * uses, so splitting the source by these boundaries is exact.
 *
 * Empty `matches` → return the text as a single string node, no
 * highlights.
 */
function renderHighlighted(
  text: string,
  matches: ReadonlyArray<readonly [number, number]>,
): React.ReactNode {
  if (matches.length === 0) return text;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of matches) {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark key={`m-${start}`} style={MATCH_HIGHLIGHT_STYLE}>
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

// ---------------------------------------------------------------------------
// Gallery card
// ---------------------------------------------------------------------------

const HEADER_BAR_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--tug-space-sm)",
  padding: "var(--tug-space-sm) var(--tug-space-md)",
  borderBottom:
    "1px solid var(--tug7-element-global-border-normal-default-rest)",
  flexShrink: 0,
};

const INPUT_HOST_STYLE: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const DIAGNOSTIC_STYLE: React.CSSProperties = {
  fontSize: "var(--tug-font-size-xs)",
  fontFamily: "var(--tug-font-family-mono)",
  color: "var(--tug7-element-global-text-normal-muted-rest)",
  flexShrink: 0,
};

const LIST_VIEW_HOST_STYLE: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  position: "relative",
};

export function GalleryListViewFilter(): React.ReactElement {
  // Static base data source — instantiated once per mount.
  const baseRef = React.useRef<GalleryListViewFilterDataSource | null>(null);
  if (baseRef.current === null) {
    baseRef.current = new GalleryListViewFilterDataSource(buildItems());
  }
  const base = baseRef.current;

  // Query state owned by the host. The same `query` value is captured
  // by the predicate closure AND passed as the `filterToken` — the
  // canonical [Spec S06] pattern.
  const [query, setQuery] = React.useState("");

  // Predicate built fresh per render; the latest closure captures the
  // current `query`. The hook's `setLatestPredicate` write picks it
  // up; recompute fires when `filterToken` (also `query`) changes
  // identity per `Object.is`.
  //
  // Case-INSENSITIVE substring match per [Spec S01] — uses the
  // shared `caseInsensitiveSubstring` matcher in `@/lib/text-match`
  // so the picker, the gallery card, and any future small-list
  // consumer all behave identically. Unicode case folding handles
  // accented Latin (É → é); see the matcher's module docstring for
  // the rare expansion-bearing edge case.
  const predicate = React.useCallback(
    (i: number, ds: TugListViewDataSource): boolean => {
      const item = (ds as GalleryListViewFilterDataSource).itemAt(i);
      return caseInsensitiveSubstring(query, item.path) !== null;
    },
    [query],
  );

  const filtered = useFilteredDataSource(base, predicate, query);

  // Live `query` mirror so the cell renderer (memoized against
  // `base`) can read the latest query without rebuilding the
  // renderer identity on every keystroke. The renderer fires fresh
  // matchers per cell render — the wrapper's version-bump on each
  // token change re-renders every visible cell, which then reads the
  // current `queryRef.current` and computes its highlight ranges.
  const queryRef = React.useRef(query);
  queryRef.current = query;

  // Cell renderer built inside the host so the closure captures
  // `base`. The renderer routes the wrapper's filtered `index`
  // through `baseIndexFor` to read the typed extension (`itemAt`)
  // off the base — this is the canonical pattern for typed cell
  // renderers consuming a `FilteredTugListViewDataSource`.
  //
  // Memoized against `base`; the base is stable for the host's
  // lifetime, so the renderer identity stays stable across re-renders
  // and React reconciler doesn't churn on filter changes.
  const cellRenderers = React.useMemo<
    Record<string, TugListViewCellRenderer<TugListViewDataSource>>
  >(() => {
    const PathCell: TugListViewCellRenderer<TugListViewDataSource> = ({
      index,
      dataSource,
    }: TugListViewCellProps<TugListViewDataSource>) => {
      const wrapper = dataSource as FilteredTugListViewDataSource;
      const baseIndex = wrapper.baseIndexFor(index);
      const item = base.itemAt(baseIndex);
      // Recompute the match against the live query; the matcher is
      // cheap (single `indexOf` over a lowercased copy) and the
      // renderer only runs for cells in the rendered window.
      const match: MatchResult | null = caseInsensitiveSubstring(
        queryRef.current,
        item.path,
      );
      const ranges = match?.matches ?? [];
      return (
        <div style={PATH_CELL_STYLE} data-testid="gallery-list-view-filter-path">
          <span style={INDEX_LABEL_STYLE}>{`#${index} (base ${baseIndex})`}</span>
          <span>{renderHighlighted(item.path, ranges)}</span>
        </div>
      );
    };
    return { path: PathCell };
  }, [base]);

  const baseCount = base.numberOfItems();
  const filteredCount = filtered.numberOfItems();
  const diagnostic = `${filteredCount} of ${baseCount} matches`;

  return (
    <div
      className="cg-content"
      data-testid="gallery-list-view-filter"
      style={{ padding: 0, gap: 0, overflow: "hidden", height: "100%" }}
    >
      <div style={HEADER_BAR_STYLE}>
        <div style={INPUT_HOST_STYLE}>
          <TugInput
            type="search"
            placeholder="Filter paths (case-insensitive substring)"
            value={query}
            onChange={(e) =>
              setQuery((e.target as HTMLInputElement).value)
            }
          />
        </div>
        <span style={DIAGNOSTIC_STYLE}>{diagnostic}</span>
      </div>
      <div style={LIST_VIEW_HOST_STYLE}>
        <TugListView
          dataSource={filtered}
          cellRenderers={cellRenderers}
          scrollKey="gallery-list-view-filter"
        />
      </div>
    </div>
  );
}
