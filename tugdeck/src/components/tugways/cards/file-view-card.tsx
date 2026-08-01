/**
 * file-view-card.tsx — the read-only viewer card body.
 *
 * One card renders every viewable file kind; the body branches on
 * `classifyFileKind` of its bound path. A future kind is a branch here, not a
 * new card: one registry entry, one seed shape (`{ path }`), one open-registry
 * story, one Lens filter.
 *
 * The card is strictly read-only. It keeps no dirty state, registers no save
 * plumbing, and publishes no `menuState.file` block — which is why the native
 * File menu's Save / Save As… / Revert to Saved validate disabled while a
 * viewer is frontmost, with no Swift-side change.
 *
 * The bytes come from tugcast's `/api/fs/blob`, which streams them, so the
 * card points an `<img>` at a URL rather than holding content in memory.
 *
 * Laws:
 *  - [L02] the bound path is card state (the persisted bag), and the open
 *    registry is an external module store read through its own subscribe.
 *  - [L03] the open-registry registration lives in `useLayoutEffect` — an
 *    `open-file` for the same path can arrive before a passive effect commits.
 *  - [L06] load / error appearance rides `ImageBlock`'s
 *    `data-tugx-image-status` attribute, never React state for visuals.
 *  - [L20] the card styles its own frame only; `--tugx-image-*` belongs to
 *    `ImageBlock` and is never overridden here.
 *
 * @module components/tugways/cards/file-view-card
 */

import "./file-view-card.css";

import { useLayoutEffect, useRef, useState } from "react";

import { classifyFileKind, blobUrl } from "@/lib/file-kinds";
import { cardTitleStore } from "@/lib/card-title-store";
import {
  notifyOpenFileViewCardsChanged,
  registerOpenFileViewCard,
  unregisterOpenFileViewCard,
} from "@/lib/file-view-open-registry";
import { TugLabel } from "@/components/tugways/tug-label";
import { ImageBlock } from "@/components/tugways/body-kinds/image-block";
import { PdfView, type PdfViewState } from "@/components/tugways/cards/pdf-view";
import { useCardStatePreservation } from "@/components/tugways/use-card-state-preservation";

/**
 * The viewer card's persistence payload: the file it is bound to, plus how
 * the PDF surface was left. Reopening a document at page one and 100% when
 * the reader had it fitted and half way down is exactly the state loss [L23]
 * exists to prevent.
 */
export interface FileViewCardBagContent {
  path: string;
  view?: PdfViewState;
}

/** Narrow an unknown restored bag payload. */
function coerceBagContent(state: unknown): FileViewCardBagContent | null {
  if (state === null || typeof state !== "object") return null;
  const record = state as Record<string, unknown>;
  if (typeof record.path !== "string" || record.path.length === 0) return null;
  const view = coerceViewState(record.view);
  return view === null ? { path: record.path } : { path: record.path, view };
}

/** Narrow the restored PDF view state; anything unrecognized is the default. */
function coerceViewState(value: unknown): PdfViewState | null {
  if (value === null || typeof value !== "object") return null;
  const { pageMode, zoom } = value as Record<string, unknown>;
  if (pageMode !== "continuous" && pageMode !== "single" && pageMode !== "two") {
    return null;
  }
  const validZoom =
    zoom === "fit-width" ||
    zoom === "fit-page" ||
    (typeof zoom === "number" && Number.isFinite(zoom));
  return validZoom ? { pageMode, zoom: zoom as PdfViewState["zoom"] } : null;
}

/** The final path segment — the card's display name. */
function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

export function FileViewCardContent({ cardId }: { cardId: string }) {
  const [path, setPath] = useState<string | null>(null);
  const [view, setView] = useState<PdfViewState | undefined>(undefined);
  // The surface mounts fresh per document, so its opening state is read once
  // per binding; a live prop would fight the reader's own zoom.
  const restoredViewRef = useRef<PdfViewState | undefined>(undefined);
  // The registry's `getPath` reads live at call time ([L07]), so it reads a
  // ref rather than the render-time value.
  const pathRef = useRef<string | null>(null);

  // ---- Card state preservation (the bound path) ----
  //
  // `onSave` reads the current path, so a rebind through the registry's
  // `openFile` persists by construction: Maker ▸ Reload and a cold boot both
  // re-resume the file the card is actually showing, not the one it opened
  // with ([L23]).
  useCardStatePreservation<FileViewCardBagContent | undefined>({
    onSave: () =>
      path === null ? undefined : view === undefined ? { path } : { path, view },
    onRestore: (state) => {
      const content = coerceBagContent(state);
      if (content === null) return;
      restoredViewRef.current = content.view;
      setView(content.view);
      setPath(content.path);
    },
  });

  // ---- open-file reuse registry ----

  useLayoutEffect(() => {
    registerOpenFileViewCard(cardId, {
      getPath: () => pathRef.current,
      openFile: (next) => {
        // A different document arrives at the default view, not the last
        // one's zoom.
        restoredViewRef.current = undefined;
        setView(undefined);
        setPath(next);
      },
    });
    return () => {
      unregisterOpenFileViewCard(cardId);
    };
  }, [cardId]);

  // A fresh card binds its path AFTER mount (the seed restores), so registry
  // consumers that project the card — the Lens Files list — must re-read when
  // the binding lands, not only when the card registers.
  useLayoutEffect(() => {
    pathRef.current = path;
    notifyOpenFileViewCardsChanged();
  }, [path]);

  // ---- Title sync (basename → pane chrome) ----

  useLayoutEffect(() => {
    if (path === null) {
      cardTitleStore.clear(cardId);
      return;
    }
    cardTitleStore.set(cardId, basename(path));
    return () => {
      cardTitleStore.clear(cardId);
    };
  }, [cardId, path]);

  if (path === null) {
    return (
      <div className="file-view-card" data-slot="file-view-card">
        <TugLabel className="file-view-card-notice">No file open.</TugLabel>
      </div>
    );
  }

  const kind = classifyFileKind(path);
  const name = basename(path);

  return (
    <div
      className="file-view-card"
      data-slot="file-view-card"
      data-file-view-kind={kind}
    >
      {kind === "image" ? (
        <ImageBlock
          className="file-view-card-image"
          src={blobUrl(path)}
          alt={name}
        />
      ) : kind === "pdf" ? (
        <PdfView
          key={path}
          path={path}
          cardId={cardId}
          initialState={restoredViewRef.current}
          onStateChange={setView}
        />
      ) : (
        <TugLabel className="file-view-card-notice">
          Tug can&rsquo;t display this file yet.
        </TugLabel>
      )}
    </div>
  );
}
