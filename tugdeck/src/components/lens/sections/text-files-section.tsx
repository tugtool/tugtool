/**
 * text-files-section.tsx — the Lens **Text Files** section: a `TugListView`
 * over the open Text cards. One Tab stop in the Lens; arrows rove, Enter/click
 * fronts the open card (`focus-session-card`). The recently-open files (the
 * recent-documents MRU) are no longer listed here — they hang off the section
 * header's recents menu, which mirrors File ▸ Open Recent.
 *
 * Laws: [L02] deck + recents enter React through `useSyncExternalStore` (in the
 * data source, and the header menu); [L06] cursor/selection appearance is CSS
 * on engine attributes; [L22] the FocusManager owns the cursor.
 *
 * @module components/lens/sections/text-files-section
 */

import "./text-files-section.css";

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { Clock3, FileText } from "lucide-react";

import { registerLensSection } from "@/components/lens/lens-section-registry";
import type { LensSectionHost } from "@/components/lens/lens-section-registry";
import { setSectionHasContent } from "@/components/lens/lens-section-content";
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
import { TugButton } from "@/components/tugways/internal/tug-button";
import { TugPopupMenu } from "@/components/tugways/internal/tug-popup-menu";
import type { TugPopupMenuEntry } from "@/components/tugways/internal/tug-popup-menu";
import {
  basename,
  buildTextFilesRows,
  dirname,
  useLensTextFilesDataSource,
  type LensTextFilesDataSource,
} from "./text-files-data-source";

/** File ▸ Open Recent caps its list at 10; the header menu mirrors that. */
const RECENTS_MENU_LIMIT = 10;
/** Sentinel item id for the menu's "Clear Menu" entry. */
const CLEAR_RECENTS_ITEM_ID = "\0clear-recents";

// The section's remembered selection — the last-touched row id, mapped to a
// cursor seed on the next Cmd-L / Tab ([P10]). Module-level so it outlives a
// collapse toggle; valid while the Lens is a singleton card.
let lastSelectedTextId: string | null = null;

/** Abbreviate a macOS home prefix (`/Users/<name>`) to `~` for display. */
function displayDir(dir: string): string {
  return dir.replace(/^\/Users\/[^/]+(?=\/|$)/, "~");
}

/** A two-line row on the shared `TugListRow` chrome: filename (title) over its
 *  dimmed directory (subtitle). */
function FileRow({
  name,
  dir,
}: {
  name: string;
  dir: string;
}): React.ReactElement {
  return (
    <TugListRow
      className="text-files-row"
      title={name}
      titleSize="sm"
      subtitle={dir.length > 0 ? displayDir(dir) : undefined}
    />
  );
}

const TextFilesCell: TugListViewCellRenderer<LensTextFilesDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<LensTextFilesDataSource>) => {
  const row = dataSource.rowAt(index);
  return (
    <FileRow name={row.title} dir={row.path !== null ? dirname(row.path) : ""} />
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
  const dataSource = useLensTextFilesDataSource();
  const count = dataSource.numberOfItems();
  const listRef = useRef<TugListViewHandle>(null);

  // Every row is a cursorable open-file cell. Publish whether the band holds
  // any so the Lens skips it for the Cmd-L seed / Tab walk when it is empty.
  const hasContent = count > 0;
  useLayoutEffect(() => {
    setSectionHasContent(host.focusGroup, hasContent);
    return () => setSectionHasContent(host.focusGroup, false);
  }, [host.focusGroup, hasContent]);

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

  return (
    <div className="text-files-section">
      {count === 0 ? (
        // Empty label instead of the list — an empty `flex: 1` list would grow
        // and open a gap under the band (see the Sessions section).
        <div className="text-files-empty">No open files</div>
      ) : (
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
      )}
    </div>
  );
}

/** Register the Text Files section. Called once at boot from `main.tsx`. */
export function registerTextFilesSection(): void {
  registerLensSection({
    kind: "text-files",
    title: "Text Files",
    glyph: <FileText size={14} />,
    collapsedSummary: () => <TextFilesCollapsedSummary />,
    headerActions: () => <TextFilesHeaderActions />,
    body: (host) => <TextFilesSectionBody host={host} />,
  });
}
