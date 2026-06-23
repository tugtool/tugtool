/**
 * dev-attachment-preview.tsx — pane-sheet attachment preview body.
 *
 * Renders one of a message's image attachments at its natural pixel
 * dimensions, bounded by the sheet body (which is itself bounded by the
 * host pane). Mounted inside a {@link TugSheetContent} body via the
 * `useTugSheet().showSheet({ content: ... })` imperative path — clicking
 * a thumbnail in {@link TugAttachmentStrip} opens this preview on that
 * atom, and ←/→ step through the rest of the message's images (clamped
 * at the ends). The host sheet runs with `hideHeader`, so the preview
 * owns its own top bar: the current image's title at the left and a
 * right-aligned actions cluster (Copy today, room for more) laid out
 * like a tool-call header. Copy — by click or by Cmd-C — writes the
 * current image itself to the clipboard as PNG via the shared
 * {@link BlockCopyButton}. A multi-image set also gets a row of paging
 * dots in the footer (one per image, the current one filled), centered
 * under the image and clickable to jump straight to a given image.
 *
 * Keyboard: ←/→ are handled by a bubble-phase `onKeyDown` on the root
 * (bare arrows aren't claimed by the keybinding map, and the sheet's
 * trapped focus keeps them flowing up from the focused control). Cmd-C
 * is claimed by the capture-phase keybinding pipeline as the `COPY`
 * action, so it can't reach `onKeyDown`; the preview registers as a
 * responder with a `COPY` handler instead, and the sheet's focus resting
 * inside this root makes it the first responder the dispatch lands on.
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
import { useOptionalResponder } from "@/components/tugways/use-responder";
import { ResponderChainContext } from "@/components/tugways/responder-chain";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { writeImageToNativeClipboard } from "@/lib/tug-native-clipboard";

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
  // Prefer the native NSPasteboard bridge inside Tug.app. The WKWebView's JS
  // Clipboard image write (`navigator.clipboard.write` + `ClipboardItem`) does
  // not work here — the same reason clipboard READ is bridged natively — so the
  // web path below is only the browser-dev fallback. The base64 payload is the
  // part of the data URL after the comma (the raw image bytes).
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

export interface DevAttachmentPreviewProps {
  /**
   * The full set of image atoms for the message whose strip was
   * clicked, in strip order. The preview opens on {@link startIndex}
   * and the user steps through the rest with ←/→ (see the keydown
   * handler). Each atom's `id` keys into the bytes-store; an atom
   * without an id (or whose entry has not yet landed) renders the
   * empty-body placeholder for that step.
   */
  atoms: ReadonlyArray<AtomSegment>;
  /**
   * Index into {@link atoms} of the thumbnail the user clicked — the
   * step the preview opens on. Clamped into range defensively.
   */
  startIndex: number;
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
  atoms,
  startIndex,
  bytesStore,
  onClose,
}: DevAttachmentPreviewProps): React.ReactElement {
  // The step the preview currently shows. ←/→ walk it across `atoms`
  // (clamped at the ends); the title, image, and Copy target all follow
  // the current atom. `startIndex` is clamped defensively so an out-of-
  // range open lands on a real atom rather than `undefined`.
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
  const dataUrl = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );

  // ←/→ step the current image. Bare arrows only — a modified arrow
  // belongs to the editor / spatial plane, never to the gallery. Stepping
  // clamps at the ends, so the first/last image is a soft stop rather than
  // a wrap (no surprise jump from the first image back to the last). The
  // sheet traps focus and the keydown bubbles from the focused control
  // (the Done button) up to this root, so the handler sees every arrow
  // without the preview owning DOM focus itself.
  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((i) => clamp(i - 1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setIndex((i) => clamp(i + 1));
      }
    },
    [clamp],
  );

  // Cmd-C copies the current image. The chord is matched in the
  // capture-phase keybinding pipeline and dispatched as the `COPY` action
  // to the first responder — so a local `onKeyDown` never sees it
  // (Stage 1 stops propagation once handled). We register this preview as
  // a responder with a `COPY` handler instead: the sheet's trapped focus
  // resting inside this root makes the preview the first responder, so the
  // walk lands here. The handler clicks the Copy button rather than calling
  // the clipboard directly, so Cmd-C and a pointer-click share ONE path —
  // including the button's "Copied" confirmation flash ([L23]).
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const responderId = React.useId();
  const chainManager = React.useContext(ResponderChainContext);
  const { ResponderScope, responderRef } = useOptionalResponder({
    id: responderId,
    actions: {
      [TUG_ACTIONS.COPY]: () => {
        const button = rootRef.current?.querySelector<HTMLElement>(
          '[data-slot="dev-attachment-preview__copy"]',
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
    <ResponderScope>
    <div
      ref={setRoot}
      data-slot="dev-attachment-preview"
      className="dev-attachment-preview"
      // The whole preview refuses first-responder promotion: a pointer-down
      // anywhere inside (the image, the header, the Copy button) must NOT
      // coarsen the key view onto the sheet box and strip the Done button of
      // its seeded default ring. Done stays the resting default; Tab still
      // reaches Copy (the focus walk is a separate subsystem).
      data-tug-focus="refuse"
      // Claim first responder when focus lands anywhere in the preview — the
      // same fix `TugConfirmPopover` uses. The refuse above (and the buttons'
      // own `refuse` default) means the provider's `focusin` promotion never
      // lands the preview as first responder, so a Cmd-C → `COPY` dispatch
      // (routed to the first responder) would otherwise miss the open preview
      // and copy the host editor's selection. Claiming it here — from the
      // preview's own React focus handler, which `refuse` does not gate — makes
      // the COPY handler above the dispatch target while the sheet is open. The
      // sheet's focus trap captured the prior first responder at push, so it is
      // restored on close. Idempotent.
      onFocus={handleRootFocus}
      onKeyDown={onKeyDown}
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
            emphasis="outlined"
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
            alt={atom?.label ?? title}
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
      {/* Footer — a three-part flex row: an empty left spacer, the centered
          paging dots, and the right-aligned Done button. The two outer cells
          are equal-weight (`flex: 1`), so the dots cell lands on the row's
          true center — under the image's horizontal center — while Done stays
          pinned to the trailing edge. `align-items: center` lines the dots up
          vertically with Done. (Built explicitly rather than reusing
          `tug-sheet-actions` so the centering is a real flow item, not an
          absolute overlay.) */}
      <div className="dev-attachment-preview__footer">
        <div className="dev-attachment-preview__footer-side" />
        {/* Paging dots — one per image, the current one filled. Shown only for
            a multi-image set; a single attachment needs no pager. Each dot is a
            click target that jumps to its image; the dots live inside the
            preview's `refuse` root, so a click navigates without stealing
            Done's seeded default ring. */}
        <div
          data-slot="dev-attachment-preview__pager"
          className="dev-attachment-preview__pager"
          role="tablist"
          aria-label="Image"
        >
          {count > 1 &&
            atoms.map((a, i) => (
              <button
                key={a.id !== undefined && a.id.length > 0 ? `id-${a.id}` : `pos-${i}`}
                type="button"
                className="dev-attachment-preview__dot"
                data-active={i === index ? "" : undefined}
                role="tab"
                aria-selected={i === index ? "true" : "false"}
                aria-label={a.value}
                onClick={() => setIndex(clamp(i))}
              />
            ))}
        </div>
        <div className="dev-attachment-preview__footer-side dev-attachment-preview__footer-end">
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
    </div>
    </ResponderScope>
  );
}
