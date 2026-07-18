/**
 * text-files-section.tsx — the Lens **Text Files** section: a `TugListView`
 * over the open Text cards plus the recently-open files (the recent-documents
 * MRU). One Tab stop in the Lens; arrows rove, Enter/click front an open card
 * (`focus-session-card`) or open a recent path (`open-file`).
 *
 * Laws: [L02] deck + recents enter React through `useSyncExternalStore` (in the
 * data source); [L06] cursor/selection appearance is CSS on engine attributes;
 * [L22] the FocusManager owns the cursor.
 *
 * @module components/lens/sections/text-files-section
 */

import "./text-files-section.css";

import React, { useMemo, useSyncExternalStore } from "react";
import { FileText } from "lucide-react";

import { registerLensSection } from "@/components/lens/lens-section-registry";
import type { LensSectionHost } from "@/components/lens/lens-section-registry";
import { dispatchAction } from "@/action-dispatch";
import { getDeckStore } from "@/lib/deck-store-registry";
import {
  getRecentDocumentsSnapshot,
  subscribeRecentDocuments,
} from "@/lib/recent-documents";
import { TugListView } from "@/components/tugways/tug-list-view";
import type {
  TugListViewCellProps,
  TugListViewCellRenderer,
  TugListViewDelegate,
} from "@/components/tugways/tug-list-view";
import {
  basename,
  buildTextFilesRows,
  dirname,
  useLensTextFilesDataSource,
  type LensTextFilesDataSource,
} from "./text-files-data-source";

// The section's remembered selection — the last-touched row id, mapped to a
// cursor seed on the next Cmd-L / Tab ([P10]). Module-level so it outlives a
// collapse toggle; valid while the Lens is a singleton card.
let lastSelectedTextId: string | null = null;

/** A two-line row: filename over its (dimmed) directory. */
function FileRow({
  name,
  dir,
  recent,
}: {
  name: string;
  dir: string;
  recent?: boolean;
}): React.ReactElement {
  return (
    <div className={recent ? "text-files-row text-files-row-recent" : "text-files-row"}>
      <span className="text-files-name" title={dir ? `${dir}/${name}` : name}>
        {name}
      </span>
      {dir.length > 0 ? <span className="text-files-dir">{dir}</span> : null}
    </div>
  );
}

const TextFilesCell: TugListViewCellRenderer<LensTextFilesDataSource> = ({
  index,
  dataSource,
}: TugListViewCellProps<LensTextFilesDataSource>) => {
  const row = dataSource.rowAt(index);
  switch (row.kind) {
    case "text-open":
      return (
        <FileRow
          name={row.title}
          dir={row.path !== null ? dirname(row.path) : ""}
        />
      );
    case "text-recent":
      return <FileRow name={basename(row.path)} dir={dirname(row.path)} recent />;
    case "text-recents-header":
      return <div className="text-files-header">Recent</div>;
  }
};

const TEXT_FILES_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<LensTextFilesDataSource>
> = {
  "text-open": TextFilesCell,
  "text-recent": TextFilesCell,
  "text-recents-header": TextFilesCell,
};

/** Live collapsed summary: `N open · M recent`. */
function TextFilesCollapsedSummary(): React.ReactElement {
  const deckStore = getDeckStore();
  const deck = useSyncExternalStore(
    deckStore?.subscribe ?? (() => () => {}),
    deckStore !== null ? deckStore.getSnapshot : () => null,
    () => null,
  );
  const recents = useSyncExternalStore(
    subscribeRecentDocuments,
    getRecentDocumentsSnapshot,
    getRecentDocumentsSnapshot,
  );
  const { open, recent } = useMemo(() => {
    const rows = buildTextFilesRows({ deck, recents });
    return {
      open: rows.filter((r) => r.kind === "text-open").length,
      recent: rows.filter((r) => r.kind === "text-recent").length,
    };
  }, [deck, recents]);
  if (open === 0 && recent === 0) return <>No files</>;
  return <>{`${open} open · ${recent} recent`}</>;
}

function TextFilesSectionBody({ host }: { host: LensSectionHost }): React.ReactElement {
  const dataSource = useLensTextFilesDataSource();
  const count = dataSource.numberOfItems();

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
      if (row.kind === "text-open") {
        dispatchAction({ action: "focus-session-card", cardId: row.cardId });
      } else if (row.kind === "text-recent") {
        dispatchAction({ action: "open-file", path: row.path });
      }
    };
    return { onSelect: activate, onActivate: activate };
  }, [dataSource]);

  return (
    <div className="text-files-section">
      <TugListView<LensTextFilesDataSource>
        dataSource={dataSource}
        delegate={delegate}
        cellRenderers={TEXT_FILES_CELL_RENDERERS}
        scrollKey="lens-text-files"
        inline
        rowLayout="pill"
        focusGroup={host.focusGroup}
        commitOnEnter="act"
        initialSelectedIndex={initialSelectedIndex}
        className="lens-text-files-list"
      />
      {count === 0 ? (
        <div className="text-files-empty">No open or recent files</div>
      ) : null}
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
    body: (host) => <TextFilesSectionBody host={host} />,
  });
}
