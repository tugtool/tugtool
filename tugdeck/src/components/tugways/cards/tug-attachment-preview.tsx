/**
 * tug-attachment-preview.tsx — the general-purpose attachment-preview
 * facility, shared by the transcript (read-only) and the prompt-entry
 * editor (compose phase, deletable).
 *
 * It has two faces, both driven by the per-card {@link AtomBytesStore}:
 *
 *  - the **strip** ({@link TugAttachmentPreview}): a row of thumbnail
 *    tiles, one per image atom, mounted below a user-row body in the
 *    transcript (a fixed-width, wrapping grid) OR as the prompt-entry's Z4C
 *    zone while composing (a single-row, fixed-HEIGHT strip — see the CSS
 *    pair for the two layouts and why the compose one is height-driven).
 *    Each tile paints, in order: the baked `thumbnailDataUrl`; else the
 *    full-resolution bytes the moment they land (the replay window, before
 *    the bake); else a transparent reserved slot — never a dark box.
 *  - the **sheet** ({@link AttachmentPreviewSheet}, internal): the
 *    full-resolution image, opened in a pane-sheet when a tile is
 *    clicked, with ←/→ paging across the message's image set and a Copy
 *    action. The strip owns the sheet via {@link useTugSheet}, so a
 *    consumer drops in `<TugAttachmentPreview …/>` and gets click-to-zoom
 *    for free.
 *
 * Delete: when `deletable` is set (the compose phase — you can't delete an
 * attachment already committed to the transcript), each tile grows a ✕
 * affordance and the sheet a Delete action. Both are [L11] controls: they
 * dispatch `REMOVE_ATTACHMENT` (the atom id on `value`) through the chain
 * to the parent responder, which owns the substrate (editor doc + bytes
 * store) and performs the removal. The strip holds no delete state; it
 * re-renders from the shrunken atom array the responder produces.
 *
 * The bytes-store IS external state: its contents grow on the live path
 * (drop / paste / synthesize) and on the replay path (synthesizer mints
 * entries from JSONL content blocks; thumbnail bake fires fire-and-forget
 * and updates the entry when complete). Both faces subscribe via
 * `useSyncExternalStore` so a late-arriving thumbnail lands as a
 * re-render rather than leaving a tile stuck on its placeholder.
 *
 * Laws:
 *  - [L02] external state (the bytes store) enters React via
 *    `useSyncExternalStore`; the strip snapshot is the per-atom
 *    thumbnail-data-URL projection, stable across quiescent rebuilds.
 *  - [L06] appearance via CSS — tile dimensions, gap, caption
 *    typography, placeholder, hover wash, and the sheet's aspect-lock
 *    all flow from this component's slot family + CSS.
 *  - [L11] the ✕ / Delete are controls — they dispatch `REMOVE_ATTACHMENT`
 *    through the chain; the parent responder owns the delete state.
 *  - [L19] file pair, module docstring, exported props interface,
 *    `data-slot="tug-attachment-preview"` on the strip root.
 *  - [L20] one component-token slot family (`--tugx-attachment-*`).
 *
 * @module components/tugways/cards/tug-attachment-preview
 */

import "./tug-attachment-preview.css";

import * as React from "react";
import { BoneFracture, X } from "lucide-react";

import type { AtomSegment } from "@/lib/tug-atom-img";
import type { AtomBytesStore } from "@/lib/atom-bytes-store";
import { decorateChipLabel } from "./tug-atom-text-body";
import type { TurnAddress } from "../tug-transcript-entry";
import { useTugSheet } from "@/components/tugways/tug-sheet";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { BlockCopyButton } from "@/components/tugways/body-kinds/affordances/block-copy-button";
import { useSeedKeyView } from "@/components/tugways/use-focusable";
import { useItemGroupKeyboard } from "@/components/tugways/use-item-group-keyboard";
import { useSpatialOrder } from "@/components/tugways/use-spatial-order";
import type { SpatialOrder } from "@/components/tugways/spatial-order";
import { useOptionalResponder } from "@/components/tugways/use-responder";
import { useControlDispatch } from "@/components/tugways/use-control-dispatch";
import { ResponderChainContext } from "@/components/tugways/responder-chain";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { writeImageToNativeClipboard } from "@/lib/tug-native-clipboard";

// ---------------------------------------------------------------------------
// Strip props
// ---------------------------------------------------------------------------

export interface TugAttachmentPreviewProps {
  /**
   * Transcript entry address, threaded through to each tile's caption so
   * the strip and the inline chip share an identical label. Omitted
   * (`undefined`) for a surface with no committed turn yet — the
   * prompt-entry compose phase, or a queued (ghost) send — in which case
   * the caption is the atom's bare `image-N` label, matching the inline
   * chip on that same surface.
   */
  address?: TurnAddress;
  /**
   * Image atoms from the surface's substrate, already filtered to
   * `type === "image"` by the caller. Order is the same order the inline
   * chips appear in.
   */
  atoms: ReadonlyArray<AtomSegment>;
  /**
   * Per-card bytes-store handle. Both the strip and the sheet subscribe
   * to it via `useSyncExternalStore` so a late-arriving thumbnail bake
   * re-renders the affected tile without external orchestration.
   */
  bytesStore: AtomBytesStore;
  /**
   * Compose-phase delete affordance. When `true`, each tile grows a ✕ and
   * the preview sheet a Delete button; activating either dispatches the
   * `REMOVE_ATTACHMENT` action (carrying the atom id) through the chain to
   * the parent responder — which owns the substrate (editor doc + bytes
   * store) and performs the removal ([L11]). The strip itself holds no
   * delete state; it re-renders from the shrunken `atoms` array the
   * responder produces. Omitted (`false`) on the transcript — a committed
   * attachment can't be deleted.
   * @selector [data-deletable]
   */
  deletable?: boolean;
  /** Forwarded to the strip root element. */
  className?: string;
  /** Forwarded to the strip root element (for test anchoring). */
  "data-testid"?: string;
}

// ---------------------------------------------------------------------------
// useSyncExternalStore subscription (strip)
// ---------------------------------------------------------------------------

interface TileSnapshot {
  readonly atomId: string;
  readonly label: string;
  readonly value: string;
  readonly thumbnailDataUrl: string | undefined;
  /**
   * Full-resolution bytes + media type when the store entry is present.
   * Used as the paint fallback before the thumbnail bake lands (the replay
   * window, where `put` writes content first and the thumbnail follows) so
   * a tile shows the real image rather than an empty box.
   */
  readonly content: string | undefined;
  readonly mediaType: string | undefined;
  /**
   * The atom resolves to a bytes-store entry that carries no usable
   * pixels — neither a thumbnail nor full content. This is the
   * "broken image" state: a recalled history atom whose bytes are gone
   * and whose durable thumbnail was never captured (re-seeded as an empty
   * marker). Distinct from the pre-pixel drop window (no entry at all),
   * which stays a transparent reserved slot.
   */
  readonly broken: boolean;
}

function buildSnapshot(
  atoms: ReadonlyArray<AtomSegment>,
  bytesStore: AtomBytesStore,
): ReadonlyArray<TileSnapshot> {
  const out: TileSnapshot[] = [];
  for (const atom of atoms) {
    const id = atom.id ?? "";
    const entry = id.length > 0 ? bytesStore.get(id) : null;
    const hasThumb = (entry?.thumbnailDataUrl ?? "").length > 0;
    const hasContent = (entry?.content ?? "").length > 0;
    out.push({
      atomId: id,
      label: atom.label,
      value: atom.value,
      thumbnailDataUrl: entry?.thumbnailDataUrl,
      content: entry?.content,
      mediaType: entry?.mediaType,
      broken: entry !== null && !hasThumb && !hasContent,
    });
  }
  return out;
}

/**
 * `Object.is`-stable snapshot key for the strip's `useSyncExternalStore`
 * contract. Recomputed only when the atoms array reference changes or any
 * tile's thumbnail-data-URL changes; without it every `getSnapshot` would
 * allocate a fresh array and React would tear under concurrent renders.
 */
function snapshotKey(snap: ReadonlyArray<TileSnapshot>): string {
  let key = "";
  for (const t of snap) {
    // Content presence (not the bytes themselves) joins the key so the
    // tile re-renders when content lands ahead of its thumbnail — without
    // hashing the whole base64 string on every snapshot. `broken` joins it
    // too so a same-id atom flipping from broken-marker to real bytes (or
    // back) busts the cache even though its presence flags didn't move.
    key += `${t.atomId}|${t.thumbnailDataUrl ?? ""}|${
      (t.content ?? "").length > 0 ? "c" : ""
    }|${t.broken ? "b" : ""}|`;
  }
  return key;
}

// ---------------------------------------------------------------------------
// Strip component — the public face
// ---------------------------------------------------------------------------

/**
 * The attachment-preview strip. See the module docstring for the
 * substrate, subscription model, and the laws this honours.
 *
 * Returns `null` when `atoms` is empty (no DOM is rendered, so the
 * containing surface's height accounting sees no strip contribution —
 * the transcript row collapses to body-only, and the prompt-entry Z4C
 * zone takes no vertical space).
 */
export const TugAttachmentPreview = React.forwardRef<
  HTMLDivElement,
  TugAttachmentPreviewProps
>(function TugAttachmentPreview(
  {
    address,
    atoms,
    bytesStore,
    deletable = false,
    className,
    "data-testid": dataTestid,
  },
  ref,
) {
  // [L11] control side: the ✕ / Delete dispatch `REMOVE_ATTACHMENT` (the
  // atom id on `value`) to the parent responder, which owns the substrate
  // and performs the removal. The strip holds no delete state itself. The
  // dispatch resolves the parent responder at THIS render location (inside
  // the prompt-entry's `ResponderScope`), so it targets the prompt-entry
  // even for the Delete button that renders in the portaled sheet.
  const { dispatch: controlDispatch } = useControlDispatch();
  const removeSenderId = React.useId();
  const dispatchRemove = React.useCallback(
    (atom: AtomSegment): void => {
      if (atom.id === undefined) return;
      controlDispatch({
        action: TUG_ACTIONS.REMOVE_ATTACHMENT,
        value: atom.id,
        sender: removeSenderId,
        phase: "discrete",
      });
    },
    [controlDispatch, removeSenderId],
  );

  const cacheRef = React.useRef<{
    atoms: ReadonlyArray<AtomSegment>;
    key: string;
    snap: ReadonlyArray<TileSnapshot>;
  } | null>(null);

  const subscribe = React.useCallback(
    (listener: () => void) => bytesStore.subscribe(listener),
    [bytesStore],
  );
  const getSnapshot = React.useCallback((): ReadonlyArray<TileSnapshot> => {
    const candidate = buildSnapshot(atoms, bytesStore);
    const key = snapshotKey(candidate);
    const cached = cacheRef.current;
    if (cached !== null && cached.atoms === atoms && cached.key === key) {
      return cached.snap;
    }
    cacheRef.current = { atoms, key, snap: candidate };
    return candidate;
  }, [atoms, bytesStore]);

  const tiles = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // The strip owns the sheet: a tile click opens the full-resolution
  // preview on that atom, stepping across the rest with ←/→. The sheet is
  // per-pane (TugSheet's portal), so visually at most one preview shows at
  // a time regardless of which row hosts the hook.
  const { showSheet, renderSheet } = useTugSheet();
  const openPreview = React.useCallback(
    (atom: AtomSegment, clickedIndex: number): void => {
      void showSheet({
        title: atom.value,
        // The preview owns its own top bar (title + actions), so the
        // sheet's header is suppressed; `title` stays for aria-label. `xl`
        // + drag-resize gives the image real room; `aspectLockContent`
        // locks the panel to the image's aspect so the margin stays
        // uniform; `maxHostFraction` keeps it within 90% of the card.
        hideHeader: true,
        displayWidth: "xl",
        resizable: true,
        aspectLockContent: true,
        maxHostFraction: 0.9,
        content: (close) => (
          <AttachmentPreviewSheet
            atoms={atoms}
            startIndex={clickedIndex}
            bytesStore={bytesStore}
            onClose={() => close()}
            onRemove={
              deletable
                ? (a) => {
                    dispatchRemove(a);
                    // Deleting from the preview returns to the strip, which
                    // reflects the removal from the responder's updated atom
                    // array — simpler than live-shrinking the open sheet.
                    close();
                  }
                : undefined
            }
          />
        ),
      });
    },
    [showSheet, atoms, bytesStore, deletable, dispatchRemove],
  );

  // Empty atoms → no DOM. The host surface sees no strip contribution.
  if (tiles.length === 0) return null;

  return (
    <div
      ref={ref}
      data-slot="tug-attachment-preview"
      data-deletable={deletable ? "" : undefined}
      className={className}
      data-testid={dataTestid}
    >
      {tiles.map((tile, i) => {
        const caption = decorateChipLabel(atoms[i] as AtomSegment, address);
        // Paint order, FOUC-free: the baked thumbnail when present; else
        // the full-resolution bytes the moment they land (the replay
        // window, where content arrives before the thumbnail bake); else
        // `undefined` — render a transparent reserved slot, NEVER a dark
        // box, for the brief drop-time window before any pixels exist.
        // If a bake never lands (corrupt / exotic codec on replay), the
        // content fallback persists — the tile shows the original scaled
        // down rather than an empty box. Heavier than a thumbnail, but rare
        // and strictly better than the alternative.
        const hasThumb =
          tile.thumbnailDataUrl !== undefined &&
          tile.thumbnailDataUrl.length > 0;
        const hasContent =
          tile.content !== undefined &&
          tile.content.length > 0 &&
          tile.mediaType !== undefined &&
          tile.mediaType.length > 0;
        const src = hasThumb
          ? tile.thumbnailDataUrl
          : hasContent
            ? `data:${tile.mediaType};base64,${tile.content}`
            : undefined;
        return (
          <div
            key={tile.atomId.length > 0 ? `id-${tile.atomId}` : `pos-${i}`}
            data-slot="tug-attachment-preview__cell"
            className="tug-attachment-preview__cell"
          >
            <div
              role="button"
              tabIndex={0}
              data-slot="tug-attachment-preview__tile"
              className="tug-attachment-preview__tile"
              onClick={() => openPreview(atoms[i] as AtomSegment, i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openPreview(atoms[i] as AtomSegment, i);
                }
              }}
              aria-label={caption}
              title={tile.value}
            >
              <span
                data-slot="tug-attachment-preview__thumb"
                className="tug-attachment-preview__thumb"
                // The frame (border + fill) is gated on this in CSS, so the
                // pre-pixel window shows nothing instead of an empty box.
                data-has-image={src !== undefined ? "" : undefined}
              >
                {src !== undefined ? (
                  <img
                    className="tug-attachment-preview__thumb-img"
                    src={src}
                    alt={caption}
                  />
                ) : tile.broken ? (
                  // Broken image: the atom points at a bytes-store entry
                  // with no pixels — a recalled history image whose bytes
                  // are gone and whose durable thumbnail was never captured.
                  // A fractured-bone glyph reads as "this image is broken"
                  // rather than a blank slot that looks like it's still
                  // loading.
                  <span
                    data-slot="tug-attachment-preview__broken"
                    className="tug-attachment-preview__broken"
                    aria-label="Image unavailable"
                    title="Image unavailable"
                  >
                    <BoneFracture aria-hidden="true" />
                  </span>
                ) : (
                  // No pixels yet (the brief pre-bake drop window): a
                  // transparent, reserved slot — never a dark box. The
                  // fixed-height zone already holds the space, so the image
                  // simply pops in when the bake lands.
                  <span
                    data-slot="tug-attachment-preview__placeholder"
                    className="tug-attachment-preview__placeholder"
                    aria-hidden="true"
                  />
                )}
                {deletable && (src !== undefined || tile.broken) && (
                  // Compose-phase delete. A component-owned overlay affordance
                  // (not a TugButton) pinned to the thumbnail's own top-right
                  // corner, so it stays flush regardless of cell/caption width.
                  // It is an [L11] control — the click dispatches
                  // `REMOVE_ATTACHMENT` through the chain — and
                  // `data-tug-focus="refuse"` keeps focus on the editor.
                  // `stopPropagation` keeps the X from also opening the sheet.
                  <button
                    type="button"
                    data-slot="tug-attachment-preview__delete"
                    className="tug-attachment-preview__delete"
                    data-tug-focus="refuse"
                    aria-label={`Remove ${tile.value}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatchRemove(atoms[i] as AtomSegment);
                    }}
                  >
                    <X size={12} strokeWidth={2.5} aria-hidden="true" />
                  </button>
                )}
              </span>
              <span
                data-slot="tug-attachment-preview__caption"
                className="tug-attachment-preview__caption"
              >
                {caption}
              </span>
            </div>
          </div>
        );
      })}
      {renderSheet()}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sheet body — the full-resolution preview (internal)
// ---------------------------------------------------------------------------

/**
 * Decode `dataUrl` to a PNG `Blob` for the clipboard. The clipboard's
 * image flavor is `image/png` everywhere; a PNG source passes through,
 * anything else (JPEG/WebP) re-encodes through an offscreen canvas.
 * Returned as a promise so the caller can hand it straight to
 * `new ClipboardItem({ "image/png": buildPngBlob(...) })` — WebKit honors
 * a promise-valued clipboard item, keeping the async decode inside the
 * originating user gesture (a pre-resolved blob would lose transient
 * activation and reject with NotAllowed).
 */
async function buildPngBlob(dataUrl: string): Promise<Blob> {
  const sourceBlob = await (await fetch(dataUrl)).blob();
  if (sourceBlob.type === "image/png") return sourceBlob;
  const objectUrl = URL.createObjectURL(sourceBlob);
  try {
    const png = await new Promise<Blob | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (ctx === null) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((out) => resolve(out), "image/png");
      };
      img.onerror = () => resolve(null);
      img.src = objectUrl;
    });
    if (png === null) throw new Error("png re-encode failed");
    return png;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Write the preview image to the clipboard as a PNG. Resolves `true` on a
 * confirmed write (so {@link BlockCopyButton} flashes "Copied"), `false`
 * when the clipboard image API is unavailable or the write rejects — the
 * honest-feedback contract ([L23]).
 */
async function copyImageToClipboard(dataUrl: string): Promise<boolean> {
  // Prefer the native NSPasteboard bridge inside Tug.app. The WKWebView's
  // JS clipboard image write does not work there — the same reason
  // clipboard READ is bridged natively — so the web path below is only the
  // browser-dev fallback.
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : "";
  if (writeImageToNativeClipboard(base64)) {
    return true;
  }
  const clip = navigator.clipboard;
  if (
    clip === undefined ||
    clip === null ||
    typeof ClipboardItem === "undefined" ||
    typeof clip.write !== "function"
  ) {
    return false;
  }
  try {
    await clip.write([new ClipboardItem({ "image/png": buildPngBlob(dataUrl) })]);
    return true;
  } catch {
    return false;
  }
}

// Focus-group order of the sheet's keyboard stops, in Tab order. The
// leaf buttons (Copy / Delete / Done) and the pager share one closed
// spatial ring; the pager is a delegating selection group whose interior
// cursor roves the dots. Delete is conditional — its slot is simply
// absent when the sheet isn't deletable.
const PREVIEW_COPY_ORDER = 0;
const PREVIEW_DELETE_ORDER = 1;
const PREVIEW_PAGER_ORDER = 2;
const PREVIEW_DONE_ORDER = 3;

interface AttachmentPreviewSheetProps {
  /**
   * The full set of image atoms for the surface whose strip was clicked,
   * in strip order. The preview opens on {@link startIndex}; the user
   * steps through the rest via the footer pager dots.
   */
  atoms: ReadonlyArray<AtomSegment>;
  /** Index into {@link atoms} the preview opens on. Clamped defensively. */
  startIndex: number;
  /** Per-card bytes store carrying the image content + mediaType. */
  bytesStore: AtomBytesStore;
  /** Dismiss callback wired to the host sheet's `close`. */
  onClose?: () => void;
  /**
   * Internal remove hook supplied by {@link TugAttachmentPreview} when the
   * surface is deletable. The owner wires it to dispatch `REMOVE_ATTACHMENT`
   * (and close the sheet); the sheet just calls it for the current image
   * when the footer Delete button is activated. Not a public API — the
   * chain-dispatch ([L11]) lives in the owner.
   */
  onRemove?: (atom: AtomSegment) => void;
}

/**
 * Project the bytes-store entry for `atom` into a data URL string, or
 * `null` when the atom has no id or no entry is present.
 */
function buildPreviewSnapshot(
  atom: AtomSegment,
  bytesStore: AtomBytesStore,
): string | null {
  const id = atom.id;
  if (id === undefined || id.length === 0) return null;
  const entry = bytesStore.get(id);
  if (entry === null) return null;
  // Prefer the full-resolution bytes; fall back to the durable thumbnail
  // for a recalled preview-only entry (no full bytes, but a thumbnail rode
  // history) so the sheet shows the (smaller) image rather than nothing. A
  // broken entry has neither — the sheet renders its empty state.
  if (entry.content.length > 0 && entry.mediaType.length > 0) {
    return `data:${entry.mediaType};base64,${entry.content}`;
  }
  if (entry.thumbnailDataUrl !== undefined && entry.thumbnailDataUrl.length > 0) {
    return entry.thumbnailDataUrl;
  }
  return null;
}

function AttachmentPreviewSheet({
  atoms,
  startIndex,
  bytesStore,
  onClose,
  onRemove,
}: AttachmentPreviewSheetProps): React.ReactElement {
  const count = atoms.length;
  const clamp = React.useCallback(
    (i: number): number => Math.min(Math.max(i, 0), Math.max(count - 1, 0)),
    [count],
  );
  const [index, setIndex] = React.useState(() => clamp(startIndex));
  const atom = atoms[index];
  const title = atom?.value ?? "";

  const subscribe = React.useCallback(
    (listener: () => void) => bytesStore.subscribe(listener),
    [bytesStore],
  );
  const getSnapshot = React.useCallback(
    () => (atom !== undefined ? buildPreviewSnapshot(atom, bytesStore) : null),
    [atom, bytesStore],
  );
  const dataUrl = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Cmd-C copies the current image. The chord is matched in the
  // capture-phase keybinding pipeline and dispatched as the `COPY` action
  // to the first responder, so a local `onKeyDown` never sees it. We
  // register this preview as a responder with a `COPY` handler instead;
  // the sheet's trapped focus resting inside this root makes the preview
  // the first responder. The handler clicks the Copy button so Cmd-C and a
  // pointer-click share ONE path — including the "Copied" flash ([L23]).
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const responderId = React.useId();
  const chainManager = React.useContext(ResponderChainContext);
  const { ResponderScope, responderRef } = useOptionalResponder({
    id: responderId,
    actions: {
      [TUG_ACTIONS.COPY]: () => {
        const button = rootRef.current?.querySelector<HTMLElement>(
          '[data-slot="tug-attachment-preview-sheet__copy"]',
        );
        button?.click();
      },
    },
  });
  const setRoot = React.useCallback(
    (el: HTMLDivElement | null): void => {
      rootRef.current = el;
      responderRef(el);
    },
    [responderRef],
  );
  const handleRootFocus = React.useCallback((): void => {
    if (
      chainManager !== null &&
      chainManager.getFirstResponder() !== responderId
    ) {
      chainManager.makeFirstResponder(responderId);
    }
  }, [chainManager, responderId]);

  // Focus language ([tuglaws/focus-language.md]). The sheet wraps this body
  // in a `FocusModeScope` trap, so these calls bind to the trapped mode.
  //
  //  - Every keyboard stop — Copy, Delete, the pager, Done — is authored
  //    into ONE focus group and placed in ONE closed spatial ring on both
  //    axes. `Tab` walks them in order; any arrow roves them, and no arrow
  //    direction is left undeclared (which would dead-beep).
  //  - The pager is a roving item-container ([P01]): its dots are interior
  //    cursor members the spatial navigator traverses as part of the ring
  //    (an off-edge arrow falls through to the adjacent node — Delete on
  //    the left, Done on the right). In `live` commit mode each interior
  //    move pages the image (the tab-bar model). So ←/→ page the preview
  //    while the cursor is inside the pager.
  //  - Done is the persistent default ring, so `Return` always dismisses
  //    (never the destructive Delete). The opening key view is seeded on
  //    the PAGER for a multi-image set — so arrows page the instant the
  //    sheet opens — and on Done for a single image (no pager).
  const focusGroup = React.useId();
  const hasDelete = onRemove !== undefined && atom !== undefined;
  const hasPager = count > 1;
  useSeedKeyView(
    `${focusGroup}:${hasPager ? PREVIEW_PAGER_ORDER : PREVIEW_DONE_ORDER}`,
  );
  const sheetSpatialOrder = React.useMemo<SpatialOrder>(() => {
    const pagerNode = `${focusGroup}:${PREVIEW_PAGER_ORDER}`;
    const nodes = [`${focusGroup}:${PREVIEW_COPY_ORDER}`];
    if (hasDelete) nodes.push(`${focusGroup}:${PREVIEW_DELETE_ORDER}`);
    if (hasPager) nodes.push(pagerNode);
    nodes.push(`${focusGroup}:${PREVIEW_DONE_ORDER}`);
    return {
      // A single closed ring on both axes — every node has all four arrow
      // directions declared, so no direction is left undeclared (no
      // dead-arrow warning).
      rings: [
        { axis: "horizontal", nodes, closed: true },
        { axis: "vertical", nodes, closed: true },
      ],
      // The pager is a delegating selection group: the resolver checks this
      // BEFORE the ring, so an in-bounds arrow roves the dots (paging the
      // image), and only an off-the-end arrow falls through to the ring
      // (crossing to the adjacent button). `length` is the dot count.
      groups: hasPager ? [{ node: pagerNode, length: count }] : [],
    };
  }, [focusGroup, hasDelete, hasPager, count]);
  useSpatialOrder(sheetSpatialOrder);

  // The pager — a roving item-container over the dots. `live` commit pages
  // the image as the cursor moves; a pointer click moves the cursor too
  // (`setCursor`) so keyboard and mouse share one selection. The dot
  // elements are collected from refs in render order.
  const pagerId = React.useId();
  const dotRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const pageTo = React.useCallback(
    (i: number): void => setIndex(clamp(i)),
    [clamp],
  );
  const pager = useItemGroupKeyboard({
    id: pagerId,
    group: focusGroup,
    order: PREVIEW_PAGER_ORDER,
    register: hasPager,
    commit: "live",
    collectItems: () => dotRefs.current.slice(0, count),
    initialIndex: () => clamp(index),
    onSelect: (_el, i) => pageTo(i),
    onMove: (_el, i) => pageTo(i),
  });
  // Keep the cursor's item range in sync with the rendered dots. The
  // keyboard handler and a pointer `setCursor` both depend on this range,
  // so it must be registered before events fire ([L03]) — `useLayoutEffect`,
  // not `useEffect`. `syncItems` is stable, so this runs on mount and only
  // re-runs on a real count change.
  const pagerSyncItems = pager.syncItems;
  React.useLayoutEffect(() => {
    pagerSyncItems();
  }, [count, pagerSyncItems]);

  // The image area is the sheet's aspect-lock region: its `aspect-ratio`
  // (set from the image's natural dimensions on load) drives the panel's
  // content height. Written to the DOM directly — appearance via DOM, not
  // React state ([L06]).
  const imageAreaRef = React.useRef<HTMLDivElement>(null);
  const handleImageLoad = React.useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>): void => {
      const img = event.currentTarget;
      const area = imageAreaRef.current;
      if (area === null || img.naturalWidth === 0 || img.naturalHeight === 0)
        return;
      area.style.setProperty(
        "--preview-aspect",
        String(img.naturalWidth / img.naturalHeight),
      );
    },
    [],
  );

  return (
    <ResponderScope>
      <div
        ref={setRoot}
        data-slot="tug-attachment-preview-sheet"
        className="tug-attachment-preview-sheet"
        // The whole preview refuses first-responder promotion: a
        // pointer-down anywhere inside must NOT coarsen the key view onto
        // the sheet box and strip the Done button of its seeded default
        // ring. Done stays the resting default; Tab still reaches Copy.
        data-tug-focus="refuse"
        onFocus={handleRootFocus}
      >
        {/* Top bar — title at the left, a right-aligned actions cluster.
            The sheet runs with `hideHeader`, so this bar owns the title. */}
        <div
          data-slot="tug-attachment-preview-sheet__bar"
          className="tug-attachment-preview-sheet__bar"
        >
          <span className="tug-attachment-preview-sheet__title">{title}</span>
          <div className="tug-attachment-preview-sheet__actions">
            <BlockCopyButton
              subtype="text"
              size="md"
              emphasis="outlined"
              aria-label="Copy image"
              data-slot="tug-attachment-preview-sheet__copy"
              disabled={dataUrl === null}
              copyAction={() => copyImageToClipboard(dataUrl ?? "")}
              focusGroup={focusGroup}
              focusOrder={PREVIEW_COPY_ORDER}
            />
          </div>
        </div>
        <div
          ref={imageAreaRef}
          data-slot="tug-attachment-preview-sheet__image-area"
          data-tug-aspect-region=""
          className="tug-attachment-preview-sheet__image-area"
        >
          {dataUrl !== null ? (
            <img
              data-slot="tug-attachment-preview-sheet__image"
              className="tug-attachment-preview-sheet__image"
              src={dataUrl}
              alt={atom?.label ?? title}
              onLoad={handleImageLoad}
            />
          ) : (
            <div
              data-slot="tug-attachment-preview-sheet__empty"
              className="tug-attachment-preview-sheet__empty"
              aria-hidden="true"
            />
          )}
        </div>
        {/* Footer — a three-part flex row: a left cell (Delete when
            compose-phase), the centered paging dots, and the right-aligned
            Done button. The outer cells are equal-weight so the dots land
            on the row's true center while Done stays pinned to the trailing
            edge. */}
        <div className="tug-attachment-preview-sheet__footer">
          <div className="tug-attachment-preview-sheet__footer-side">
            {hasDelete && (
              <TugPushButton
                emphasis="outlined"
                role="danger"
                onClick={() => onRemove?.(atom as AtomSegment)}
                focusGroup={focusGroup}
                focusOrder={PREVIEW_DELETE_ORDER}
              >
                Delete
              </TugPushButton>
            )}
          </div>
          {/* Pager — a roving item-container ([P01]). The container is the
              single Tab stop; the dots are its cursor members. ←/→ rove the
              cursor and `live` commit pages the image. A click moves the
              cursor too (`setCursor`) so pointer and keyboard share one
              selection. Rendered only for a multi-image set. */}
          {hasPager ? (
            <div
              ref={pager.attachRoot}
              onKeyDown={pager.onKeyDown}
              data-slot="tug-attachment-preview-sheet__pager"
              className="tug-attachment-preview-sheet__pager"
              role="tablist"
              aria-label="Image"
            >
              {atoms.map((a, i) => (
                <button
                  key={
                    a.id !== undefined && a.id.length > 0
                      ? `id-${a.id}`
                      : `pos-${i}`
                  }
                  ref={(el) => {
                    dotRefs.current[i] = el;
                  }}
                  type="button"
                  className="tug-attachment-preview-sheet__dot"
                  data-active={i === index ? "" : undefined}
                  role="tab"
                  aria-selected={i === index ? "true" : "false"}
                  aria-label={a.value}
                  onClick={() => {
                    pager.setCursor(i);
                    setIndex(clamp(i));
                  }}
                />
              ))}
            </div>
          ) : (
            <div
              data-slot="tug-attachment-preview-sheet__pager"
              className="tug-attachment-preview-sheet__pager"
            />
          )}
          <div className="tug-attachment-preview-sheet__footer-side tug-attachment-preview-sheet__footer-end">
            <TugPushButton
              emphasis="primary"
              role="action"
              onClick={onClose}
              focusGroup={focusGroup}
              focusOrder={PREVIEW_DONE_ORDER}
              persistentDefaultRing
            >
              Done
            </TugPushButton>
          </div>
        </div>
      </div>
    </ResponderScope>
  );
}
