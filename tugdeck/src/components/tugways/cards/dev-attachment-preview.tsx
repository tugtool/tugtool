/**
 * dev-attachment-preview.tsx — pane-sheet attachment preview body.
 *
 * Renders a single image attachment at its natural pixel dimensions,
 * bounded by the sheet body (which is itself bounded by the host
 * pane). Mounted inside a {@link TugSheetContent} body via the
 * `useTugSheet().showSheet({ content: ... })` imperative path —
 * clicking a thumbnail in {@link TugAttachmentStrip} opens this
 * preview for the corresponding atom. The host sheet runs with
 * `hideHeader`, so the preview owns its own top bar: the title at the
 * left and a right-aligned actions cluster (Copy today, room for more)
 * laid out like a tool-call header. Copy writes the image itself to
 * the clipboard as PNG via the shared {@link BlockCopyButton}.
 *
 * Image source: the per-card `AtomBytesStore` entry keyed by
 * `atom.id`. Content is base64; we wrap into a `data:` URL with the
 * stored mediaType so the browser knows what to decode. The bytes
 * already round-tripped through the downsample pipeline, so the
 * preview shows what the model saw — not the user's original file.
 *
 * The image is subscribed via `useSyncExternalStore` so a late-
 * arriving bake (the replay-path case, rare for the preview surface
 * but possible when the user clicks immediately after replay) lands
 * as a re-render rather than leaving the sheet on an empty body.
 *
 * Sizing: `display: block; margin: auto` to center inside the sheet
 * body; `max-width: 100%; max-height: 100%` to constrain natural
 * dimensions to the available card area. The image's own
 * width/height attributes are deliberately left absent so the
 * browser uses the intrinsic resource dimensions — small images
 * render at 1:1 pixel size; large images downscale to fit.
 *
 * Laws:
 *  - [L02] external state (bytes store) enters React via
 *    `useSyncExternalStore`.
 *  - [L06] appearance via CSS — width/height behavior, centering,
 *    and the empty-body fallback are all stylesheet-driven.
 *  - [L19] file pair (`dev-attachment-preview.tsx` +
 *    `dev-attachment-preview.css`), module docstring, exported
 *    props interface, `data-slot="dev-attachment-preview"`.
 *
 * @module components/tugways/cards/dev-attachment-preview
 */

import "./dev-attachment-preview.css";

import * as React from "react";

import type { AtomSegment } from "@/lib/tug-atom-img";
import type { AtomBytesStore } from "@/lib/atom-bytes-store";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { BlockCopyButton } from "@/components/tugways/body-kinds/affordances/block-copy-button";
import { useSeedKeyView } from "@/components/tugways/use-focusable";

/**
 * Decode `dataUrl` to a PNG `Blob` for the clipboard. The clipboard's
 * image flavor is `image/png` everywhere; a source that is already PNG
 * passes through, anything else (JPEG/WebP) re-encodes through an
 * offscreen canvas. Returned as a promise so the caller can hand it
 * straight to `new ClipboardItem({ "image/png": buildPngBlob(...) })`
 * — WebKit honors a promise-valued clipboard item, which keeps the
 * async decode inside the originating user gesture (a pre-resolved
 * blob would lose transient activation and reject with NotAllowed).
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
 * Write the preview image to the clipboard as a PNG. Resolves `true`
 * on a confirmed write (so {@link BlockCopyButton} flashes "Copied"),
 * `false` when the clipboard image API is unavailable or the write
 * rejects — the honest-feedback contract ([L23]).
 */
async function copyImageToClipboard(dataUrl: string): Promise<boolean> {
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

export interface DevAttachmentPreviewProps {
  /**
   * The image atom whose bytes should render. The atom's `id` keys
   * into the bytes-store; an atom without an id (or whose entry has
   * not yet landed) renders the empty-body placeholder.
   */
  atom: AtomSegment;
  /**
   * Title shown at the left of the preview's own top bar. The host
   * sheet runs with `hideHeader`, so this is the only title surface —
   * wrappers pass the atom's label/value.
   */
  title: string;
  /** Per-card bytes store carrying the image content + mediaType. */
  bytesStore: AtomBytesStore;
  /**
   * Dismiss callback wired to the host sheet's `close`. Invoked when
   * the user clicks the Done button (or activates it via Return — the
   * filled-action variant auto-registers as the chain's default
   * button so Enter routes here naturally).
   *
   * Required for keyboard dismissal to work: the Done button is the
   * sheet's seeded default key view (`useSeedKeyView` arms its
   * `focusGroup:0` so the ring + filled promotion rest on it the
   * instant the sheet opens, regardless of the Copy button that now
   * precedes it in the DOM), and the sheet's trapped focus keeps
   * keydowns flowing — Return routes to the seeded default, Escape /
   * Cmd+. bubble to the sheet's own keymap and dispatch `cancelDialog`
   * through the chain. Without an interactive child, FocusScope would
   * leave focus outside the sheet and neither would route.
   */
  onClose?: () => void;
}

/**
 * Project the bytes-store entry for `atom` into a data URL string,
 * or `null` when the atom has no id or no entry is present. Cached
 * by structural key so `useSyncExternalStore` doesn't tear on
 * repeated calls within the same store snapshot.
 */
function buildPreviewSnapshot(
  atom: AtomSegment,
  bytesStore: AtomBytesStore,
): string | null {
  const id = atom.id;
  if (id === undefined || id.length === 0) return null;
  const entry = bytesStore.get(id);
  if (entry === null) return null;
  return `data:${entry.mediaType};base64,${entry.content}`;
}

export function DevAttachmentPreview({
  atom,
  title,
  bytesStore,
  onClose,
}: DevAttachmentPreviewProps): React.ReactElement {
  const subscribe = React.useCallback(
    (listener: () => void) => bytesStore.subscribe(listener),
    [bytesStore],
  );
  const getSnapshot = React.useCallback(
    () => buildPreviewSnapshot(atom, bytesStore),
    [atom, bytesStore],
  );
  const dataUrl = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );

  // Seed the Done button as the sheet's live default (filled+ring) on open.
  const doneFocusGroup = React.useId();
  useSeedKeyView(`${doneFocusGroup}:0`);

  // The image area is the sheet's aspect-lock region: its `aspect-ratio`
  // (set from the image's natural dimensions on load) drives the panel's
  // content height, so the margin around the image stays uniform and
  // drag-resize follows the aspect. Until the image loads we leave the CSS
  // fallback (square) in place. Written to the DOM directly — appearance via
  // DOM, not React state ([L06]).
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
    <div
      data-slot="dev-attachment-preview"
      className="dev-attachment-preview"
      // The whole preview refuses first-responder promotion: a pointer-down
      // anywhere inside (the image, the header, the Copy button) must NOT
      // coarsen the key view onto the sheet box and strip the Done button of
      // its seeded default ring. Done stays the resting default; Tab still
      // reaches Copy (the focus walk is a separate subsystem).
      data-tug-focus="refuse"
    >
      {/* Top bar — title at the left, a right-aligned actions cluster
          mirroring the tool-call header layout. The sheet runs with
          `hideHeader`, so this bar owns the title. */}
      <div
        data-slot="dev-attachment-preview__bar"
        className="dev-attachment-preview__bar"
      >
        <span className="dev-attachment-preview__title">{title}</span>
        <div className="dev-attachment-preview__actions">
          <BlockCopyButton
            subtype="icon-text"
            size="xs"
            aria-label="Copy image"
            data-slot="dev-attachment-preview__copy"
            disabled={dataUrl === null}
            copyAction={() => copyImageToClipboard(dataUrl ?? "")}
          />
        </div>
      </div>
      <div
        ref={imageAreaRef}
        data-slot="dev-attachment-preview__image-area"
        data-tug-aspect-region=""
        className="dev-attachment-preview__image-area"
      >
        {dataUrl !== null ? (
          <img
            data-slot="dev-attachment-preview__image"
            className="dev-attachment-preview__image"
            src={dataUrl}
            alt={atom.label}
            onLoad={handleImageLoad}
          />
        ) : (
          <div
            data-slot="dev-attachment-preview__empty"
            className="dev-attachment-preview__empty"
            aria-hidden="true"
          />
        )}
      </div>
      <div className="tug-sheet-actions">
        <TugPushButton
          emphasis="primary"
          role="action"
          onClick={onClose}
          focusGroup={doneFocusGroup}
          focusOrder={0}
        >
          Done
        </TugPushButton>
      </div>
    </div>
  );
}
