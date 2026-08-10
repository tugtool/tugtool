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
import { paneTitleBarMenuStore } from "@/lib/pane-title-bar-menu-store";
import { openPathInOS } from "@/lib/os-open";
import { useResponder } from "@/components/tugways/use-responder";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
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

/**
 * The masthead's third line: what kind of document this is, in the words a
 * reader would use.
 *
 * `classifyFileKind` answers with a coarse `FileKind` — the three branches
 * the card body switches on — and "image" is not what a reader calls a PNG.
 * So the extension supplies the name and the classification supplies the
 * category, which is why this is composed here rather than asked of the
 * classifier. A PDF also says how long it is, once the surface has told the
 * card ([Q03] leaves image dimensions and byte size to a follow-on; the line
 * takes them without changing shape when they arrive).
 */
function fileKindLabel(path: string, pdfPages: number | null): string {
  const kind = classifyFileKind(path);
  if (kind === "pdf") {
    return pdfPages === null
      ? "PDF"
      : `PDF · ${pdfPages} ${pdfPages === 1 ? "page" : "pages"}`;
  }
  const dot = basename(path).lastIndexOf(".");
  const ext = dot <= 0 ? null : basename(path).slice(dot + 1).toUpperCase();
  if (kind === "image") return ext === null ? "Image" : `${ext} image`;
  return ext ?? "File";
}

export function FileViewCardContent({ cardId }: { cardId: string }) {
  const [path, setPath] = useState<string | null>(null);
  const [view, setView] = useState<PdfViewState | undefined>(undefined);
  // How many pages the bound PDF turned out to have; null until the surface
  // reports, and for every non-PDF kind.
  const [pdfPages, setPdfPages] = useState<number | null>(null);
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
        // A different document has a different length; the old count would be
        // a resting lie on the masthead until the new one loaded.
        setPdfPages(null);
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

  // ---- Title + masthead sync (pane chrome) ----
  //
  // Published from the moment the card HAS a path, not when the bytes land: a
  // tier that appeared once the image decoded would grow the chrome under a
  // reader who is already looking at the card. Until then the card holds no
  // document at all and is not a document card, so the pre-bind state still
  // clears.
  //
  // The string and the payload go out in one `set` — the tab bar and the
  // Window menu read the string, the pane renders the payload, and two calls
  // would race the store's equality guard into notifying twice. Teardown is a
  // separate effect below, keyed on the card alone: a `clear` in this
  // effect's cleanup would run before every re-publish (a PDF reporting its
  // page count, a rebind) and notify unconditionally, defeating that guard.
  useLayoutEffect(() => {
    if (path === null) {
      cardTitleStore.clear(cardId);
      return;
    }
    const name = basename(path);
    cardTitleStore.set(cardId, name, {
      kind: "card-masthead",
      icon: classifyFileKind(path) === "image" ? "Image" : "FileText",
      title: name,
      description: path,
      descriptionKind: "path",
      detail: fileKindLabel(path, pdfPages),
    });
  }, [cardId, path, pdfPages]);

  // Reveal in Finder — the one verb this card has, and a bound viewer card
  // always has a real file to reveal. Membership is the card's; the row's
  // label, its enablement, and any chord are the command table's ([L30]).
  useLayoutEffect(() => {
    if (path === null) {
      paneTitleBarMenuStore.set(cardId, null);
      return;
    }
    paneTitleBarMenuStore.set(cardId, [
      { commandId: TUG_ACTIONS.REVEAL_CARD_FILE },
    ]);
  }, [cardId, path]);

  // What this card published to the pane goes away with the card, and only
  // then ([L27]) — one teardown for both channels.
  useLayoutEffect(
    () => () => {
      cardTitleStore.clear(cardId);
      paneTitleBarMenuStore.set(cardId, null);
    },
    [cardId],
  );

  // The `…` row's landing point. Key-card routed, so it arrives here however
  // focus happens to sit when the menu row is chosen.
  const {
    ResponderScope: CardContentResponderScope,
    responderRef: cardContentResponderRef,
  } = useResponder({
    id: `${cardId}-card-content`,
    kind: "card-content",
    actions: {
      [TUG_ACTIONS.REVEAL_CARD_FILE]: () => {
        const live = pathRef.current;
        if (live !== null) openPathInOS(live, "reveal");
      },
    },
  });

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
    <CardContentResponderScope>
      <div
        ref={cardContentResponderRef as (el: HTMLDivElement | null) => void}
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
            onDocumentInfo={(info) => setPdfPages(info.pages)}
          />
        ) : (
          <TugLabel className="file-view-card-notice">
            Tug can&rsquo;t display this file yet.
          </TugLabel>
        )}
      </div>
    </CardContentResponderScope>
  );
}
