/**
 * text-files-section.tsx — the Lens **Text Files** section: a `TugListView`
 * over the open Text cards. One Tab stop in the Lens; arrows rove, Enter/click
 * fronts the open card (`focus-session-card`). The recently-open files (the
 * recent-documents MRU) are no longer listed here — they hang off the section
 * header's recents menu, which mirrors File ▸ Open Recent.
 *
 * A row is one line — the filename, with the directory reaching the user as the
 * hover title and, when two open files share a name, as a muted trailing run
 * beside it. A close box leads the row — the column the Sessions rows give
 * their phase dot — and sends `close` to that card by identity, so the file's
 * own close guard runs; it is reachable by descending onto the row
 * (ArrowRight), ahead of the slot picker.
 *
 * A row is carried to reorder it, exactly as the Sessions and Snippets rows
 * are — the shared `useBlockReorder` FLIP, committing to `lensStore`'s
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
import { Clock3, FileText, X } from "lucide-react";

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
import { LENS_LIST_PRESENTATION } from "@/components/lens/lens-list-presentation";
import { SlotPicker } from "@/components/lens/slot-picker";
import { BlockDropCaret } from "@/components/lens/block-drop-caret";
import { useBlockReorder } from "@/components/lens/block-reorder";
import { lensStore } from "@/lib/lens-store/lens-store";
import { TugButton } from "@/components/tugways/internal/tug-button";
import { TugIconButton } from "@/components/tugways/tug-icon-button";
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
  displayPath,
  useLensTextFilesDataSource,
  type LensTextFilesDataSource,
} from "./text-files-data-source";
import { useResponderChain } from "@/components/tugways/responder-chain-provider";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";

// The reorder-drag matches each row by its stable id on the row's `TugListRow`
// element; the FLIP translates that element, the store commit persists the new
// order. Deliberately NOT `data-card-id`: that attribute is the card HOST's, and
// a row carrying it would make `[data-card-id="…"]` resolve to a Lens row
// instead of the card's own pane.
const ROW_SELECTOR = ".text-files-row[data-text-card-id]";
const ROW_KIND_ATTR = "data-text-card-id";

/** Row verbs the section body hands the module-level cell — the reorder and
 *  the close box. */
interface TextFilesCellContextValue {
  onRowPointerDown: (cardId: string, event: React.PointerEvent) => void;
  onClose: (cardId: string) => void;
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

/** Focus group for the row's close box. The rows render inside `TugListView`'s
 *  per-row `FocusModeContext`, so the button registers into its own row's
 *  descend scope — the mode scopes the walk, this constant is only the
 *  within-row ordering. ArrowRight on the cursor row descends onto it, past the
 *  slot picker. Same authoring as the Snippets row's delete. */
const ROW_ACTION_FOCUS_GROUP = "lens-text-file-row-actions";

/** A one-line row on the shared `TugListRow` chrome: the filename, the slot
 *  picker, and a close box. The directory is not ink — it reaches the user as
 *  the row's hover title, which carries the whole abbreviated path.
 *
 *  When two open files share a filename, the shortest trailing directory run
 *  that tells them apart rides beside the name, muted (`roadmap`, `Desktop`),
 *  so the list never shows two rows the user cannot choose between. The
 *  filename alone paints filter matches — the suffix is disambiguation, not the
 *  row's voice.
 *
 *  The content column is authored by hand for the same reason the Sessions row
 *  authors its own: it carries the slot picker on the name line, which is what
 *  lines the two sections' pickers up down the Lens.
 *
 *  A card with unsaved changes carries the same `•` after its filename that the
 *  card's own header wears (`text-card.tsx` sets it on `cardTitleStore`), so
 *  the dirty bit reads identically wherever the file appears. */
function FileRow({
  cardId,
  name,
  hoverPath,
  disambiguator,
  unsaved,
}: {
  cardId: string;
  name: string;
  hoverPath: string;
  disambiguator: string | null;
  unsaved: boolean;
}): React.ReactElement {
  const ctx = React.useContext(TextFilesCellContext);
  const filterQuery = useTextFilesFilterQuery();
  return (
    <TugListRow
      className="text-files-row"
      data-text-card-id={cardId}
      leading={
        <TugIconButton
          className="text-files-row-close"
          icon={<X size={12} />}
          size="xs"
          aria-label={`Close ${name}`}
          title={`Close ${name}`}
          focusGroup={ROW_ACTION_FOCUS_GROUP}
          focusOrder={0}
          onClick={(e) => {
            // Closing is not a row activation — stop it reaching the cell.
            e?.stopPropagation();
            ctx?.onClose(cardId);
          }}
        />
      }
      // The row is its own reorder handle — a vertical drag from anywhere on
      // it that is not the close box or the slot picker carries it ([P08]).
      onPointerDown={(e) => ctx?.onRowPointerDown(cardId, e)}
    >
      {/* The path is the row's hover title: `TugListRow` owns the `title` prop
          as row text, so the tooltip rides the content column instead. */}
      <span
        className="text-files-row-headline"
        title={hoverPath.length > 0 ? hoverPath : undefined}
      >
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
        {disambiguator !== null ? (
          <span
            className="text-files-row-where"
            data-testid="lens-text-file-where"
          >
            {disambiguator}
          </span>
        ) : null}
        <SlotPicker cardId={cardId} />
      </span>
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
      hoverPath={row.path !== null ? displayPath(row.path) : ""}
      disambiguator={row.disambiguator}
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

  // Reorder by carrying the row: commit on drop. Rows match by
  // `data-text-card-id`; the FLIP animates the row, the store commit persists
  // the new user order. Newly opened files (absent from `textFileOrder`) stay
  // at the bottom until the user moves them.
  const listWrapRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<HTMLDivElement | null>(null);
  const { onRowPointerDown: beginRowReorder } = useBlockReorder({
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
  // The gesture is simply never armed while the filter is on.
  const onRowPointerDown = useCallback(
    (cardId: string, event: React.PointerEvent): void => {
      if (filtering) return;
      beginRowReorder(cardId, event);
    },
    [filtering, beginRowReorder],
  );
  // The close box names the card it closes — `close-tab` carrying the row's own
  // `cardId`, walked from that card up to its host pane. This is the tab ×'s
  // event, and for the same reason: `close` means "close the active one", which
  // is only ever the row the user aimed at by luck. A row for a background tab
  // would close its pane's front card instead — the wrong file, silently. The
  // named path also keeps the close guard attached to the card it concerns, so
  // a dirty Text buffer is activated before it raises its save sheet.
  const chain = useResponderChain();
  const onClose = useCallback(
    (cardId: string): void => {
      // `sendToTarget` throws on an unregistered target, and a row can outlive
      // its card by a frame (the deck snapshot the rows were built from is one
      // render behind the unmount).
      if (chain === null || !chain.hasResponder(cardId)) return;
      chain.sendToTarget(cardId, {
        action: TUG_ACTIONS.CLOSE_TAB,
        value: cardId,
        phase: "discrete",
      });
    },
    [chain],
  );
  const cellContext = useMemo<TextFilesCellContextValue>(
    () => ({ onRowPointerDown, onClose }),
    [onRowPointerDown, onClose],
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
              ringPlacement="inset"
              inline
              rowLayout="flush"
              focusGroup={hasContent ? host.focusGroup : undefined}
              commitOnEnter="act"
              initialSelectedIndex={initialSelectedIndex}
              {...LENS_LIST_PRESENTATION}
              className="lens-oneline-list lens-text-files-list"
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
