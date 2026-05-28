/**
 * dev-attachment-preview.tsx — pane-sheet attachment preview body.
 *
 * Renders a single image attachment at its natural pixel dimensions,
 * bounded by the sheet body (which is itself bounded by the host
 * pane). Mounted inside a {@link TugSheetContent} body via the
 * `useTugSheet().showSheet({ content: ... })` imperative path —
 * clicking a thumbnail in {@link TugAttachmentStrip} opens this
 * preview for the corresponding atom.
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

export interface TideAttachmentPreviewProps {
  /**
   * The image atom whose bytes should render. The atom's `id` keys
   * into the bytes-store; an atom without an id (or whose entry has
   * not yet landed) renders the empty-body placeholder.
   */
  atom: AtomSegment;
  /** Per-card bytes store carrying the image content + mediaType. */
  bytesStore: AtomBytesStore;
  /**
   * Dismiss callback wired to the host sheet's `close`. Invoked when
   * the user clicks the Done button (or activates it via Return — the
   * filled-action variant auto-registers as the chain's default
   * button so Enter routes here naturally).
   *
   * Required for keyboard dismissal to work: the Done button is the
   * only tabbable element inside the sheet body, so Radix
   * FocusScope auto-focuses it on mount and the sheet's trapped
   * focus keeps keydowns flowing — Escape / Cmd+. then bubble to
   * the sheet's own keymap and dispatch `cancelDialog` through the
   * chain. Without an interactive child, FocusScope would leave
   * focus outside the sheet and neither Return nor Escape would
   * route.
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

export function TideAttachmentPreview({
  atom,
  bytesStore,
  onClose,
}: TideAttachmentPreviewProps): React.ReactElement {
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

  return (
    <div
      data-slot="dev-attachment-preview"
      className="dev-attachment-preview"
    >
      <div
        data-slot="dev-attachment-preview__image-area"
        className="dev-attachment-preview__image-area"
      >
        {dataUrl !== null ? (
          <img
            data-slot="dev-attachment-preview__image"
            className="dev-attachment-preview__image"
            src={dataUrl}
            alt={atom.label}
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
          emphasis="filled"
          role="action"
          onClick={onClose}
        >
          Done
        </TugPushButton>
      </div>
    </div>
  );
}
