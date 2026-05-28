/**
 * tug-attachment-strip.tsx — per-message image-thumbnail strip
 * mounted below the user-row body in the transcript.
 *
 * Source of truth is the user message's image-atom array
 * (`UserMessage.attachments`, post-Step-5c shape). For each image
 * atom, the strip renders a fixed-aspect tile whose `<img>` source
 * is the bytes-store entry's `thumbnailDataUrl` (populated by Step
 * 5c's synthesizer at construction time, live AND replay). The
 * tile's caption is `#${pad4(messageNumber)}-${atom.label}` — the
 * same string the inline chip carries via `decorateChipLabel`, so a
 * reader can pair an in-line chip with its strip thumbnail by label
 * alone.
 *
 * The bytes-store IS external state: its contents grow on the live
 * path (drop / paste / synthesize) and on the replay path
 * (synthesizer mints entries from JSONL content blocks; thumbnail
 * bake fires fire-and-forget and updates the entry when complete).
 * The strip subscribes via `useSyncExternalStore` so a late-arriving
 * thumbnail (the replay-path bake) lands as a re-render rather than
 * leaving the tile stuck on its placeholder.
 *
 * Laws:
 *  - [L02] external state enters React via `useSyncExternalStore`;
 *    the bytes-store is the external store. Snapshot is the strip's
 *    per-atom thumbnail-data-URL projection, stable across quiescent
 *    rebuilds.
 *  - [L06] appearance via CSS — the tile dimensions, gap, label
 *    typography, and placeholder appearance all flow from the
 *    component's own slot family + CSS. No React state drives
 *    appearance.
 *  - [L19] file pair, module docstring, exported props interface,
 *    `data-slot="tug-attachment-strip"` on the root span/div.
 *
 * References:
 *  - [Spec S06](roadmap/dev-atoms.md#s06-attachment-strip)
 *  - [Step 6](roadmap/dev-atoms.md#step-6)
 *  - [D04](roadmap/dev-atoms.md#d04-no-bytes-on-snapshot) — only the
 *    side-table-resident bytes-store carries thumbnails; the React
 *    snapshot stays lightweight.
 *
 * @module components/tugways/cards/tug-attachment-strip
 */

import "./tug-attachment-strip.css";

import * as React from "react";

import type { AtomSegment } from "@/lib/tug-atom-img";
import type { AtomBytesStore } from "@/lib/atom-bytes-store";
import { decorateChipLabel } from "./tug-atom-text-body";

// ---------------------------------------------------------------------------
// Two-line caption split (Finder-style)
// ---------------------------------------------------------------------------

/**
 * Split a `decorateChipLabel` output into Finder-style two-line
 * caption parts. When the label carries the transcript-position
 * prefix (`#NNNN-`), the first line is the prefix (including its
 * trailing hyphen) and the second line is the suffix
 * (e.g., `image-N`). Labels without the prefix (atoms in surfaces
 * where `messageNumber` is unset) return as a single line.
 *
 * The hyphen between the prefix and suffix is "owned" by line 1 —
 * matching macOS Finder's filename-wrap behaviour where a trailing
 * hyphen stays attached to the breaking line. The join of the
 * returned lines is exactly the input label, so the equality
 * contract "chip-label === strip-caption-as-a-string" holds:
 * `splitChipLabelLines(s).join('') === s`.
 *
 * Pure on input; exported for tests.
 */
export function splitChipLabelLines(label: string): string[] {
  // Only split when the transcript-position prefix is present. The
  // prefix always starts with `#` (formatSequenceNumber's output);
  // labels in other surfaces (editor pre-submit) don't carry it and
  // render as a single line.
  if (!label.startsWith("#")) return [label];
  // First hyphen marks the prefix→suffix boundary. The atom's
  // stored label (`image-N`) carries its own internal hyphen, but
  // that one is later in the string; `indexOf` finds the first.
  const hyphenIdx = label.indexOf("-");
  if (hyphenIdx < 0) return [label];
  return [label.slice(0, hyphenIdx + 1), label.slice(hyphenIdx + 1)];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TugAttachmentStripProps {
  /**
   * 1-based transcript message number. Threaded through to each
   * tile's caption so the strip and the inline chip share an
   * identical `#NNNN-image-N` label.
   */
  messageNumber: number;
  /**
   * Image atoms from the user message's synthesized substrate
   * (`UserMessage.attachments` filtered to `type === "image"`).
   * Non-image atoms must not appear in this array — the caller is
   * responsible for filtering before passing in. Order is the same
   * order the inline chips appear in.
   */
  atoms: ReadonlyArray<AtomSegment>;
  /**
   * Per-card bytes-store handle. The strip subscribes to it via
   * `useSyncExternalStore` so a late-arriving thumbnail bake (the
   * replay-path case) re-renders the affected tile without any
   * external orchestration.
   */
  bytesStore: AtomBytesStore;
  /**
   * Optional click handler — v1 opens the source image in a new tab
   * by default (the consumer can override per-card to send a
   * dev-card preview, or to surface the original bytes inline).
   * Called with the atom and its position within the strip.
   */
  onAttachmentClick?: (atom: AtomSegment, index: number) => void;
  /** Forwarded to the root element. */
  className?: string;
  /** Forwarded to the root element (for test anchoring). */
  "data-testid"?: string;
}

// ---------------------------------------------------------------------------
// useSyncExternalStore subscription
// ---------------------------------------------------------------------------

/**
 * One tile's projection — the data the React renderer consumes for
 * a single atom. The thumbnail data URL is read from the bytes-store
 * at subscribe time; when it lands (replay-path bake), the
 * subscriber fires and React re-renders with the populated value.
 */
interface TileSnapshot {
  readonly atomId: string;
  readonly label: string;
  readonly value: string;
  readonly thumbnailDataUrl: string | undefined;
}

/**
 * Build the strip's `useSyncExternalStore` projection. Returns one
 * `TileSnapshot` per atom; reads `thumbnailDataUrl` off the
 * bytes-store entry (undefined when the entry exists but bake hasn't
 * fired yet, or when the atom has no `id` — defensive against
 * partially-populated substrates).
 */
function buildSnapshot(
  atoms: ReadonlyArray<AtomSegment>,
  bytesStore: AtomBytesStore,
): ReadonlyArray<TileSnapshot> {
  const out: TileSnapshot[] = [];
  for (const atom of atoms) {
    const id = atom.id ?? "";
    const entry = id.length > 0 ? bytesStore.get(id) : null;
    out.push({
      atomId: id,
      label: atom.label,
      value: atom.value,
      thumbnailDataUrl: entry?.thumbnailDataUrl,
    });
  }
  return out;
}

/**
 * `Object.is`-stable snapshot cache for the strip's
 * `useSyncExternalStore` contract.
 *
 * The snapshot is recomputed only when either:
 *  - the atoms array reference changes (a new user message lands),
 *  - any tile's thumbnail-data-URL changes (the bytes-store notified
 *    a put — typically a replay-path bake completing).
 *
 * Without this cache, every `getSnapshot` call would allocate a
 * fresh array and React's `useSyncExternalStore` would tear under
 * concurrent renders. The cache key is the `(atoms, lastTuple)`
 * pair; the lastTuple is a derived string of `id|thumb` pairs so
 * structural equality is cheap.
 */
function snapshotKey(snap: ReadonlyArray<TileSnapshot>): string {
  let key = "";
  for (const t of snap) {
    key += `${t.atomId}|${t.thumbnailDataUrl ?? ""}|`;
  }
  return key;
}

// ---------------------------------------------------------------------------
// Default click handler
// ---------------------------------------------------------------------------

/**
 * v1 default: open the image's full bytes in a new tab. The source
 * bytes-store entry's `content` is base64; we wrap into a data URL
 * with the entry's mediaType so the browser knows what to render.
 *
 * Gracefully no-ops when:
 *  - the atom has no `id` (no bytes-store entry exists);
 *  - the bytes-store entry is missing (replay-path delete-then-rehydrate
 *    race; v1.x could re-fetch bytes from JSONL on click).
 */
function defaultOnAttachmentClick(
  atom: AtomSegment,
  _index: number,
  bytesStore: AtomBytesStore,
): void {
  const id = atom.id;
  if (id === undefined) return;
  const entry = bytesStore.get(id);
  if (entry === null) return;
  const url = `data:${entry.mediaType};base64,${entry.content}`;
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener");
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Per-message image-thumbnail strip. See module docstring for the
 * substrate, subscription model, and laws.
 *
 * Returns `null` when `atoms` is empty (no DOM is rendered, so the
 * containing row's height accounting via `ResizeObserver` sees the
 * cell's natural height with no strip contribution).
 */
export const TugAttachmentStrip = React.forwardRef<
  HTMLDivElement,
  TugAttachmentStripProps
>(function TugAttachmentStrip(
  {
    messageNumber,
    atoms,
    bytesStore,
    onAttachmentClick,
    className,
    "data-testid": dataTestid,
  },
  ref,
) {
  // `useSyncExternalStore` subscribes to the bytes-store; the
  // subscribe callback is the store's own `subscribe`. `getSnapshot`
  // recomputes the per-atom tile data lazily and caches by
  // structural key so React's stability check holds.
  //
  // `getServerSnapshot` returns the same projection at the empty-
  // store baseline; tugdeck does not run SSR but the hook requires
  // the parameter for the contract.
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

  // Empty atoms → no DOM. The row-height plumbing's `ResizeObserver`
  // sees the cell unchanged. Per [Spec S06].
  if (tiles.length === 0) return null;

  const handleClick = (atom: AtomSegment, index: number): void => {
    if (onAttachmentClick !== undefined) {
      onAttachmentClick(atom, index);
      return;
    }
    defaultOnAttachmentClick(atom, index, bytesStore);
  };

  return (
    <div
      ref={ref}
      data-slot="tug-attachment-strip"
      className={className}
      data-testid={dataTestid}
    >
      {tiles.map((tile, i) => {
        const caption = decorateChipLabel(
          atoms[i] as AtomSegment,
          messageNumber,
        );
        return (
          <button
            key={tile.atomId.length > 0 ? `id-${tile.atomId}` : `pos-${i}`}
            type="button"
            data-slot="tug-attachment-strip__tile"
            className="tug-attachment-strip__tile"
            onClick={() => handleClick(atoms[i] as AtomSegment, i)}
            // The button label for assistive tech is the caption —
            // the same `#NNNN-image-N` string the chip carries.
            aria-label={caption}
            title={tile.value}
          >
            <span
              data-slot="tug-attachment-strip__thumb"
              className="tug-attachment-strip__thumb"
            >
              {tile.thumbnailDataUrl !== undefined ? (
                <img
                  className="tug-attachment-strip__thumb-img"
                  src={tile.thumbnailDataUrl}
                  alt={caption}
                />
              ) : (
                // Placeholder while the replay-path bake settles (or
                // when bake failed; per Spec S04 + bakeThumbnail's
                // null-on-failure contract). The placeholder shares
                // the tile's fixed aspect so layout doesn't reflow
                // when the image lands.
                <span
                  data-slot="tug-attachment-strip__placeholder"
                  className="tug-attachment-strip__placeholder"
                  aria-hidden="true"
                />
              )}
            </span>
            <span
              data-slot="tug-attachment-strip__caption"
              className="tug-attachment-strip__caption"
            >
              {splitChipLabelLines(caption).map((line, lineIdx) => (
                <span
                  key={lineIdx}
                  data-slot="tug-attachment-strip__caption-line"
                  className="tug-attachment-strip__caption-line"
                >
                  {line}
                </span>
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
});
