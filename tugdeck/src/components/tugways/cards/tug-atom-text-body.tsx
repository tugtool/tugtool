/**
 * tug-atom-text-body.tsx — pure React walker that renders the
 * `(text, atoms)` substrate into interleaved text + atom-chip `<img>`
 * elements at each `U+FFFC` position.
 *
 * Consumed by the transcript user-message row (`UserMessageCell` in
 * `tide-card-transcript.tsx`). Each atom chip is built via the shared
 * `buildAtomSVGDataUri` helper, so the transcript's chips and the
 * editor's atom widgets are pixel-identical: same SVG, same theme
 * tokens, same baseline offset.
 *
 * **Replaced-element behaviour rides on `<img>`.** The transcript
 * chips aren't editable, but the editor's atoms also render via
 * `<img>` (`createAtomImgElement` → `buildAtomSVGDataUri` internally),
 * which is what keeps the editor's caret / selection / clipboard
 * semantics free per HTML spec. The shared helper is the consistency
 * boundary; React vs. imperative DOM is a per-surface choice.
 *
 * The walking substrate ({@link walkAtomText}) is exported separately
 * so pure-logic tests pin the (text, atoms) → segments mapping
 * without needing to mount the component.
 *
 * Laws:
 *  - [L06] all chip appearance flows from the SVG data URI + per-image
 *    inline style (verticalAlign / margin). No React state for
 *    appearance, no className-conditional logic.
 *  - [L19] file pair, module docstring, exported props interface,
 *    `data-slot="tug-atom-text-body"` on the root span; forwardRef so
 *    consumers can attach a ref (the transcript cell uses it as a
 *    menu-anchor target).
 *
 * @module components/tugways/cards/tug-atom-text-body
 */

import "./tug-atom-text-body.css";
import "@/lib/tug-atom-chip.css";

import * as React from "react";

import {
  TUG_ATOM_CHAR,
  buildAtomSVGDataUri,
  getAtomFontSnapshot,
  getAtomHeightPx,
  subscribeAtomFont,
  type AtomSegment,
} from "@/lib/tug-atom-img";
import { formatSequenceNumber } from "../tug-transcript-entry";

// ---------------------------------------------------------------------------
// Walking substrate — exported for pure-logic tests
// ---------------------------------------------------------------------------

/**
 * One segment in the walked output of {@link walkAtomText}: either a
 * run of plain text, an atom occurrence (paired with its entry from
 * the parallel `atoms` array), or a `stray-ffc` — a `U+FFFC` that had
 * no matching atom in `atoms`.
 *
 * The `stray-ffc` case is the defensive branch matching
 * `buildWirePayload`'s invariant ([Spec S03]): when the atoms array
 * is shorter than the count of `U+FFFC` characters in the text, the
 * surplus is rendered as a visible character rather than crashing.
 */
export type AtomTextSegment =
  | { kind: "text"; text: string }
  | { kind: "atom"; atom: AtomSegment }
  | { kind: "stray-ffc" };

/**
 * Walk `text`, splitting at `U+FFFC` characters. For each `U+FFFC`
 * the parallel-indexed entry in `atoms` becomes an `atom` segment;
 * any `U+FFFC` past the end of `atoms` becomes a `stray-ffc` segment.
 *
 * Pure — no React, no DOM, no theme reads. Stable for same inputs.
 */
export function walkAtomText(
  text: string,
  atoms: ReadonlyArray<AtomSegment>,
): AtomTextSegment[] {
  const segments: AtomTextSegment[] = [];
  let buf = "";
  let atomIndex = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === TUG_ATOM_CHAR) {
      if (buf.length > 0) {
        segments.push({ kind: "text", text: buf });
        buf = "";
      }
      const atom = atoms[atomIndex];
      if (atom === undefined) {
        segments.push({ kind: "stray-ffc" });
      } else {
        segments.push({ kind: "atom", atom });
      }
      atomIndex++;
    } else {
      buf += ch;
    }
  }
  if (buf.length > 0) {
    segments.push({ kind: "text", text: buf });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Chip-label decoration — pure, exported for tests
// ---------------------------------------------------------------------------

/**
 * Compute the chip's displayed label given an atom and an optional
 * transcript message number.
 *
 * - When `messageNumber` is set AND the atom is an image, the label is
 *   prefixed with `#NNNN-` (zero-padded to 4 digits via
 *   {@link formatSequenceNumber}). Example: `messageNumber=1`,
 *   `atom.label="image-1"` → `"#0001-image-1"`. This is the
 *   transcript-side rendering — the chip's label matches the
 *   per-message attachment-strip caption ([Step 6](roadmap/tide-atoms.md#step-6)).
 * - When `messageNumber` is unset, the atom's stored `label` is
 *   returned verbatim. This is the editor's pre-submit rendering case:
 *   the editor has no transcript position to encode.
 * - Non-image atoms (file, doc, link, command) always render their
 *   stored `label` verbatim — file paths and URLs carry no per-message
 *   linkage to encode.
 *
 * Pure on inputs.
 */
export function decorateChipLabel(
  atom: AtomSegment,
  messageNumber: number | undefined,
): string {
  if (messageNumber === undefined || atom.type !== "image") {
    return atom.label;
  }
  return `${formatSequenceNumber(messageNumber)}-${atom.label}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface TugAtomTextBodyProps {
  /** Raw substrate text with `U+FFFC` placeholders at atom positions. */
  text: string;
  /**
   * Parallel atoms array. The Nth `U+FFFC` in `text` pairs with
   * `atoms[N]`. Defensive: extra `U+FFFC` characters past `atoms.length`
   * render as visible text (no crash).
   */
  atoms: ReadonlyArray<AtomSegment>;
  /**
   * Optional 1-based transcript message number. When set, each image
   * atom's *displayed* chip label is decorated as
   * `#${pad4(messageNumber)}-${atom.label}` (e.g., `#0001-image-1`) —
   * the linkage between an inline chip and its companion entry in the
   * per-message attachment strip ([Step 6](roadmap/tide-atoms.md#step-6)).
   * Non-image atoms are unaffected. When unset (the editor's
   * pre-submit rendering case), atoms render with their stored
   * `label` verbatim.
   */
  messageNumber?: number;
  /** Forwarded to the root span. */
  className?: string;
  /** Forwarded to the root span (for test anchoring). */
  "data-testid"?: string;
}

/**
 * Render an atom-bearing substrate as a span containing interleaved
 * text and atom-chip `<img>` elements. See module docstring for the
 * shared-chip-builder rationale and the laws this component honours.
 */
export const TugAtomTextBody = React.forwardRef<
  HTMLSpanElement,
  TugAtomTextBodyProps
>(function TugAtomTextBody(
  { text, atoms, messageNumber, className, "data-testid": dataTestid },
  ref,
) {
  // [L02] Subscribe to atom-font state so chips re-bake when the user
  // changes their editor font preference. The snapshot itself isn't
  // read directly — `buildAtomSVGDataUri` reads module state inside
  // the SVG bake — but the subscription forces this component to
  // re-render when the font changes, which re-invokes the bake with
  // the fresh module state.
  React.useSyncExternalStore(subscribeAtomFont, getAtomFontSnapshot);
  const segments = walkAtomText(text, atoms);
  // Publish the atom's pixel height as a component-scope CSS variable
  // so the stylesheet can floor `line-height: max(1lh, …)` to at
  // least atom-tall. Read at render time from the shared substrate
  // (`getAtomHeightPx()`), matching the editor's host-wrapper pattern
  // for `--tug-text-editor-atom-height`.
  const hostStyle: React.CSSProperties = {
    ["--tugx-atom-text-body-atom-height" as string]: `${getAtomHeightPx()}px`,
  };
  return (
    <span
      ref={ref}
      data-slot="tug-atom-text-body"
      className={className}
      data-testid={dataTestid}
      style={hostStyle}
    >
      {segments.map((seg, i) => {
        if (seg.kind === "text") {
          return <React.Fragment key={`t-${i}`}>{seg.text}</React.Fragment>;
        }
        if (seg.kind === "stray-ffc") {
          return (
            <React.Fragment key={`s-${i}`}>{TUG_ATOM_CHAR}</React.Fragment>
          );
        }
        const displayLabel = decorateChipLabel(seg.atom, messageNumber);
        const { dataUri, width, height } = buildAtomSVGDataUri(
          seg.atom.type,
          displayLabel,
          seg.atom.value,
        );
        // No inline `vertical-align` — the shared
        // `.tug-atom-chip { vertical-align: middle }` rule (in
        // `lib/tug-atom-chip.css`) is load-bearing here: it centres
        // the chip in a line-box that is at least atom-tall (via the
        // `line-height` floor above), which is what prevents
        // clipping AND prevents an atom from growing its line
        // relative to neighbours.
        return (
          <img
            key={`a-${i}`}
            className="tug-atom-chip"
            src={dataUri}
            alt={displayLabel}
            width={width}
            height={height}
            title={seg.atom.value}
          />
        );
      })}
    </span>
  );
});

// ---------------------------------------------------------------------------
// Copy-text formatter
// ---------------------------------------------------------------------------

/**
 * Format an atom-bearing substrate as plain text suitable for the
 * clipboard. Walks the same `(text, atoms)` pair the renderer walks,
 * substituting each atom occurrence with either a CommonMark inline
 * link `[label](value)` (when `value` is a meaningful URL distinct
 * from the label — e.g., an `@`-completed workspace path) or just
 * the bare label (when `value === label`, meaning the substrate has
 * no extra info to encode — e.g., a dropped file, since browsers
 * don't expose absolute paths for drag-and-drop files for security).
 *
 * A stray `U+FFFC` (atom missing or wrong-shape in the parallel
 * array) is passed through verbatim — visible regression rather
 * than a silent drop, mirroring `buildWirePayload`'s defensive
 * posture ([Spec S03]).
 *
 * The transcript user-row's COPY button reads this output so the
 * copied text carries an honest representation of each atom —
 * pasting into a markdown surface renders `@`-completion atoms as
 * proper links; dropped-file atoms paste as bare filenames since
 * there is no path to represent.
 */
export function formatAtomTextForCopy(
  text: string,
  atoms: ReadonlyArray<AtomSegment>,
): string {
  const segments = walkAtomText(text, atoms);
  let out = "";
  for (const seg of segments) {
    if (seg.kind === "text") {
      out += seg.text;
    } else if (seg.kind === "stray-ffc") {
      out += TUG_ATOM_CHAR;
    } else if (seg.atom.value === seg.atom.label) {
      // No extra info to encode — drop the markdown-link wrapping
      // and emit the bare label. Avoids the redundant
      // `[raphael.jpeg](raphael.jpeg)` shape for browser-dropped
      // files where `f.name` is all the platform exposes.
      out += seg.atom.label;
    } else {
      // Use angle brackets so spaces, parens, and other non-URL-safe
      // chars in the path don't break CommonMark's link parsing.
      out += `[${seg.atom.label}](<${seg.atom.value}>)`;
    }
  }
  return out;
}
