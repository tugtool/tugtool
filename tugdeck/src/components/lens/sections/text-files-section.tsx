/**
 * text-files-section.tsx — the Lens **Text Files** section: a `TugListView`
 * over the open Text cards. One Tab stop in the Lens; arrows rove, Enter/click
 * fronts the open card (`focus-session-card`). The recently-open files (the
 * recent-documents MRU) are no longer listed here — they hang off the section
 * header's recents menu, which mirrors File ▸ Open Recent.
 *
 * Rows carry the same trailing reorder grip the Sessions and Snippets rows do,
 * driven by the shared `useBlockReorder` FLIP and committing to `lensStore`'s
 * `textFileOrder` on drop.
 *
 * Laws: [L02] deck + recents enter React through `useSyncExternalStore` (in the
 * data source, and the header menu); [L06] cursor/selection appearance is CSS
 * on engine attributes; [L22] the FocusManager owns the cursor.
 *
 * @module components/lens/sections/text-files-section
 */

import "./text-files-section.css";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { Clock3, FileText } from "lucide-react";

import { registerLensSection } from "@/components/lens/lens-section-registry";
import type { LensSectionHost } from "@/components/lens/lens-section-registry";
import { setSectionContent } from "@/components/lens/lens-section-content";
import { dispatchAction } from "@/action-dispatch";
import { getDeckStore } from "@/lib/deck-store-registry";
import {
  getReachableRecentDocumentsSnapshot,
  probeRecentDocuments,
  subscribeRecentDocuments,
} from "@/lib/recent-documents";
import { TugListView } from "@/components/tugways/tug-list-view";
import type {
  TugListViewCellProps,
  TugListViewCellRenderer,
  TugListViewDelegate,
  TugListViewHandle,
} from "@/components/tugways/tug-list-view";
import { TugListRow } from "@/components/tugways/tug-list-row";
import { TugLabel } from "@/components/tugways/tug-label";
import { SlotPicker } from "@/components/lens/slot-picker";
import { BlockGrip } from "@/components/tugways/body-kinds/affordances/block-grip";
import { BlockDropCaret } from "@/components/lens/block-drop-caret";
import { useBlockReorder } from "@/components/lens/block-reorder";
import { lensStore } from "@/lib/lens-store/lens-store";
import { TugButton } from "@/components/tugways/internal/tug-button";
import { TugPopupMenu } from "@/components/tugways/internal/tug-popup-menu";
import type { TugPopupMenuEntry } from "@/components/tugways/internal/tug-popup-menu";
import { renderFilterHighlight } from "@/components/tugways/filter-highlight";
import {
  getFilterQuery,
  getFilterVersion,
  subscribeFilterQuery,
} from "@/components/lens/lens-filter-store";
import {
  basename,
  buildTextFilesRows,
  dirname,
  displayDir,
  useLensTextFilesDataSource,
  type LensTextFilesDataSource,
} from "./text-files-data-source";

// The reorder-drag matches each row by its stable id on the row's `TugListRow`
// element; the FLIP translates that element, the store commit persists the new
// order. Deliberately NOT `data-card-id`: that attribute is the card HOST's, and
// a row carrying it would make `[data-card-id="…"]` resolve to a Lens row
// instead of the card's own pane.
const ROW_SELECTOR = ".text-files-row[data-text-card-id]";
const ROW_KIND_ATTR = "data-text-card-id";

/** Row verbs the section body hands the module-level cell — the reorder grip. */
interface TextFilesCellContextValue {
  onGripPointerDown: (cardId: string, event: React.PointerEvent) => void;
}
const TextFilesCellContext =
  React.createContext<TextFilesCellContextValue | null>(null);

/** File ▸ Open Recent caps its list at 10; the header menu mirrors that. */
const RECENTS_MENU_LIMIT = 10;
/** Sentinel item id for the menu's "Clear Menu" entry. */
const CLEAR_RECENTS_ITEM_ID = "\0clear-recents";

// The section's remembered selection — the last-touched row id, mapped to a
// cursor seed on the next Cmd-L / Tab ([P10]). Module-level so it outlives a
// collapse toggle; valid while the Lens is a singleton card.
let lastSelectedTextId: string | null = null;

/** This section's kind — the key its filter query lives under. */
const SECTION_KIND = "text-files";

/** The band's live filter query, read straight from the store ([L02]). */
function useTextFilesFilterQuery(): string {
  useSyncExternalStore(subscribeFilterQuery, getFilterVersion);
  return getFilterQuery(SECTION_KIND);
}

/** A two-line row on the shared `TugListRow` chrome: filename over its dimmed
 *  directory — the same two-line type scale the Sessions rows wear (`sm` title,
 *  `xs` second line; see `text-files-section.css`). Both lines paint their
 *  filter matches — against the exact strings rendered here, which is why the
 *  abbreviated directory (not the raw path) is what both the matcher and the
 *  highlighter see.
 *
 *  The content column is authored by hand for the same reason the Sessions row
 *  authors its own: a shared `trailing` accessory spans BOTH lines and so
 *  centers on the row, which put this row's slot picker at a different height
 *  from the one two sections up. Riding the title line — the one line both row
 *  types have — is what makes the two pickers line up down the Lens.
 *
 *  A card with unsaved changes carries the same `•` after its filename that the
 *  card's own header wears (`text-card.tsx` sets it on `cardTitleStore`), so
 *  the dirty bit reads identically wherever the file appears. */
function FileRow({
  cardId,
  name,
  dir,
  unsaved,
}: {
  cardId: string;
  name: string;
  dir: string;
  unsaved: boolean;
}): React.ReactElement {
  const ctx = React.useContext(TextFilesCellContext);
  const filterQuery = useTextFilesFilterQuery();
  const shownDir = dir.length > 0 ? displayDir(dir) : "";
  return (
    <TugListRow
      className="text-files-row"
      data-text-card-id={cardId}
      grip={
        ctx !== null ? (
          <BlockGrip
            onPointerDown={(e) => ctx.onGripPointerDown(cardId, e)}
          />
        ) : undefined
      }
    >
      <span className="text-files-row-headline">
        <TugLabel className="tug-list-row-title" size="sm" maxLines={1}>
          {renderFilterHighlight(name, filterQuery)}
          {unsaved ? (
            <span
              className="text-files-row-unsaved"
              data-testid="lens-text-file-unsaved"
              title="Unsaved changes"
              aria-label="Unsaved changes"
            >
              •
            </span>
          ) : null}
        </TugLabel>
        <SlotPicker cardId={cardId} />
      </span>
      {shownDir.length > 0 ? (
        <TugLabel
          className="tug-list-row-subtitle"
          size="sm"
          emphasis="calm"
          maxLines={1}
        >
          {renderFilterHighlight(shownDir, filterQuery)}
        </TugLabel>
      ) : null}
    </TugListRow>
  );
}

const TextFilesCell: TugListViewCellRenderer<LensTextFilesDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<LensTextFilesDataSource>) => {
  const row = dataSource.rowAt(index);
  return (
    <FileRow
      cardId={row.cardId}
      name={row.title}
      dir={row.path !== null ? dirname(row.path) : ""}
      unsaved={row.unsaved}
    />
  );
};

const TEXT_FILES_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<LensTextFilesDataSource>
> = {
  "text-open": TextFilesCell,
};

/** Live collapsed summary: the open-file count. */
function TextFilesCollapsedSummary(): React.ReactElement {
  const deckStore = getDeckStore();
  const deck = useSyncExternalStore(
    deckStore?.subscribe ?? (() => () => {}),
    deckStore !== null ? deckStore.getSnapshot : () => null,
    () => null,
  );
  const open = useMemo(() => buildTextFilesRows({ deck }).length, [deck]);
  if (open === 0) return <>No open files</>;
  return <>{`${open} open`}</>;
}

/** The header recents menu — mirrors File ▸ Open Recent. A `clock-3` icon
 *  button (left of the fold chevron) opens a menu of the reachable recent-
 *  documents MRU; picking one dispatches `open-file`, "Clear Menu" empties the
 *  list. Recents enter React via `useSyncExternalStore` ([L02]); a probe on
 *  mount drops any file deleted while the section was elsewhere. */
function TextFilesHeaderActions(): React.ReactElement {
  const recents = useSyncExternalStore(
    subscribeRecentDocuments,
    getReachableRecentDocumentsSnapshot,
    getReachableRecentDocumentsSnapshot,
  );

  useEffect(() => {
    probeRecentDocuments();
  }, []);

  const items = useMemo<TugPopupMenuEntry[]>(() => {
    const paths = recents.slice(0, RECENTS_MENU_LIMIT);
    if (paths.length === 0) {
      return [{ id: "__none__", label: "No Recent Documents", disabled: true }];
    }
    const entries: TugPopupMenuEntry[] = paths.map((path) => ({
      id: path,
      label: basename(path),
    }));
    entries.push({ type: "separator" });
    entries.push({ id: CLEAR_RECENTS_ITEM_ID, label: "Clear Menu" });
    return entries;
  }, [recents]);

  const handleSelect = (id: string): void => {
    if (id === CLEAR_RECENTS_ITEM_ID) {
      dispatchAction({ action: "clear-recent-documents" });
      return;
    }
    if (id === "__none__") return;
    dispatchAction({ action: "open-file", path: id });
  };

  return (
    <TugPopupMenu
      align="end"
      trigger={
        <TugButton
          subtype="icon"
          emphasis="ghost"
          role="action"
          size="xs"
          icon={<Clock3 size={16} />}
          aria-label="Open recent"
          title="Open Recent"
        />
      }
      items={items}
      onSelect={handleSelect}
    />
  );
}

function TextFilesSectionBody({ host }: { host: LensSectionHost }): React.ReactElement {
  const filterQuery = useTextFilesFilterQuery();
  const textFileOrder = useSyncExternalStore(
    lensStore.subscribe,
    useCallback(() => lensStore.getSnapshot().textFileOrder, []),
  );
  const dataSource = useLensTextFilesDataSource(filterQuery, textFileOrder);
  const count = dataSource.numberOfItems();
  const filtering = dataSource.isFiltering();
  const listRef = useRef<TugListViewHandle>(null);

  // Every row is a cursorable open-file cell. Publish what the band holds:
  // `navigable` so the Lens skips it for the Cmd-L seed / Tab walk when the
  // list shows nothing, `populated` (the count BEFORE the filter) so the band
  // knows whether there is anything to filter at all.
  const hasContent = count > 0;
  const hasItems = dataSource.unfilteredCount() > 0;
  useLayoutEffect(() => {
    setSectionContent(host.focusGroup, {
      navigable: hasContent,
      populated: hasItems,
    });
    return () =>
      setSectionContent(host.focusGroup, {
        navigable: false,
        populated: false,
      });
  }, [host.focusGroup, hasContent, hasItems]);

  const initialSelectedIndex = useMemo(() => {
    if (lastSelectedTextId === null) return undefined;
    for (let i = 0; i < dataSource.numberOfItems(); i += 1) {
      if (dataSource.idForIndex(i) === lastSelectedTextId) return i;
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, count]);

  const delegate = useMemo<TugListViewDelegate>(() => {
    const activate = (index: number): void => {
      const row = dataSource.rowAt(index);
      if (row === undefined) return;
      lastSelectedTextId = dataSource.idForIndex(index);
      dispatchAction({ action: "focus-session-card", cardId: row.cardId });
    };
    return { onSelect: activate, onActivate: activate };
  }, [dataSource]);

  // Reorder by grip: commit on drop. Rows match by `data-text-card-id`;
  // the FLIP animates the row, the store commit persists the new user order.
  // Newly opened files (absent from `textFileOrder`) stay at the bottom until
  // the user moves them.
  const listWrapRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<HTMLDivElement | null>(null);
  const { onGripPointerDown: beginGripReorder } = useBlockReorder({
    containerRef: listWrapRef,
    caretRef,
    getVisibleOrder: () => dataSource.visibleOrder(),
    commit: (order) => lensStore.setTextFileOrder([...order]),
    selector: ROW_SELECTOR,
    kindAttr: ROW_KIND_ATTR,
  });
  // Reorder is unavailable while a filter is active: the drop order describes
  // only the VISIBLE rows and `setTextFileOrder` persists the whole
  // arrangement, so committing a partial order would scramble the hidden rows.
  // The grips hide via `data-filter-active` + CSS ([L06]); the handler no-ops.
  const onGripPointerDown = useCallback(
    (cardId: string, event: React.PointerEvent): void => {
      if (filtering) return;
      beginGripReorder(cardId, event);
    },
    [filtering, beginGripReorder],
  );
  const cellContext = useMemo<TextFilesCellContextValue>(
    () => ({ onGripPointerDown }),
    [onGripPointerDown],
  );

  return (
    <div className="text-files-section">
      {count === 0 ? (
        // Empty label instead of the list — an empty `flex: 1` list would grow
        // and open a gap under the band (see the Sessions section). "No
        // matches" is the distinct filtered-to-zero face: there ARE open files,
        // the filter is hiding them.
        <div className="text-files-empty" data-testid="lens-text-files-empty">
          {dataSource.unfilteredCount() > 0 ? "No matches" : "None"}
        </div>
      ) : (
        <div
          className="text-files-list-wrap"
          ref={listWrapRef}
          data-filter-active={filtering ? "true" : undefined}
        >
          <BlockDropCaret ref={caretRef} />
          <TextFilesCellContext value={cellContext}>
            <TugListView<LensTextFilesDataSource>
              ref={listRef}
              dataSource={dataSource}
              delegate={delegate}
              cellRenderers={TEXT_FILES_CELL_RENDERERS}
              scrollKey="lens-text-files"
              inline
              rowLayout="flush"
              focusGroup={hasContent ? host.focusGroup : undefined}
              commitOnEnter="act"
              initialSelectedIndex={initialSelectedIndex}
              className="lens-text-files-list"
            />
          </TextFilesCellContext>
        </div>
      )}
    </div>
  );
}

/** Register the Text Files section. Called once at boot from `main.tsx`. */
export function registerTextFilesSection(): void {
  registerLensSection({
    kind: SECTION_KIND,
    title: "Text Files",
    filterable: true,
    glyph: <FileText size={14} />,
    collapsedSummary: () => <TextFilesCollapsedSummary />,
    headerActions: () => <TextFilesHeaderActions />,
    body: (host) => <TextFilesSectionBody host={host} />,
  });
}
