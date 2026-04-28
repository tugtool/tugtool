/**
 * tug-edit/clipboard-filters.ts — copy / cut / paste DOM event
 * handlers that round-trip atom segments through a custom MIME type.
 *
 * Plain-text clipboard contains the U+FFFC characters in their natural
 * positions plus a label fallback (so external apps see something
 * meaningful where each atom would have rendered). Tug-internal
 * clipboards also carry a JSON sidecar under a private MIME type
 * (`application/x-tug-atoms`) listing the atoms with positions
 * relative to the copied text. On paste, if the sidecar is present
 * the atoms are reconstructed; otherwise the paste falls back to a
 * pure-text insert (any U+FFFC characters are stripped so external
 * paste never produces tofu glyphs) [Q02].
 *
 * Laws: [L06] DOM clipboard manipulation, no React state, [L07] event
 *        handlers receive the live `view` from CM6's dispatch, [L11]
 *        clipboard operations are responder actions on the
 *        component-owned document, [L19] file structure, [L22] direct
 *        DOM event handling without React round-trip.
 */

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { TUG_ATOM_CHAR, type AtomSegment } from "@/lib/tug-atom-img";
import {
  addAtomsEffect,
  getAtomsInRange,
  type PositionedAtom,
} from "./atom-decoration";

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

/** Custom MIME type carrying the atom-sidecar JSON inside a tug clipboard. */
export const TUG_ATOMS_MIME = "application/x-tug-atoms";

/**
 * Schema for the sidecar payload. `version` allows future evolution;
 * any reader should refuse to apply payloads with versions it does
 * not understand and fall back to plain-text paste.
 */
export interface TugAtomsClipboardPayload {
  version: 1;
  /**
   * Atoms in the copied range, with positions relative to the copied
   * text (i.e. the same offsets used by the U+FFFC characters in the
   * `text/plain` payload).
   */
  atoms: { position: number; segment: AtomSegment }[];
}

/**
 * Build the plain-text clipboard payload for a copy operation. Atoms
 * appear as U+FFFC in the same positions they occupied in the source
 * doc, so a paste in a tug-aware editor uses the sidecar to repaint
 * widgets and a paste in a non-tug editor sees the U+FFFC fallback.
 *
 * For external clipboards (where the sidecar is invisible), each
 * U+FFFC is replaced with the atom label so the result is human-
 * readable plain text. The "in-app rich" and "external readable"
 * payloads are produced from the same source so we never have to
 * keep them in sync manually.
 */
export interface ClipboardSerialization {
  /** Plain text including U+FFFC at atom positions. */
  text: string;
  /** Plain text with atom labels in place of U+FFFC — for external apps. */
  fallback: string;
  /** JSON sidecar payload with atom data; null if no atoms in range. */
  sidecar: TugAtomsClipboardPayload | null;
}

/**
 * Serialize a `[from, to)` slice of an editor state into clipboard
 * payloads. Pure: takes only the data it needs, returns plain values.
 * Tested in isolation; the DOM event handler below is the thin shell.
 */
export function serializeClipboard(
  text: string,
  atoms: readonly PositionedAtom[],
  from: number,
): ClipboardSerialization {
  const local: { position: number; segment: AtomSegment }[] = atoms.map((a) => ({
    position: a.position - from,
    segment: a.segment,
  }));

  let fallback = text;
  if (local.length > 0) {
    // Replace each U+FFFC with the corresponding atom's label, walking
    // back-to-front so earlier replacements don't shift later positions.
    const sorted = [...local].sort((a, b) => b.position - a.position);
    for (const a of sorted) {
      fallback = fallback.slice(0, a.position)
        + a.segment.label
        + fallback.slice(a.position + 1);
    }
  }

  return {
    text,
    fallback,
    sidecar: local.length > 0 ? { version: 1, atoms: local } : null,
  };
}

/**
 * Parse a clipboard payload back into the segments needed to apply
 * a tug paste. Returns `null` if the sidecar is missing or malformed
 * — callers should fall back to plain-text paste.
 */
export function parseClipboardSidecar(raw: string): TugAtomsClipboardPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (obj.version !== 1) return null;
    const atoms = obj.atoms;
    if (!Array.isArray(atoms)) return null;
    const out: { position: number; segment: AtomSegment }[] = [];
    for (const a of atoms as unknown[]) {
      if (typeof a !== "object" || a === null) return null;
      const entry = a as Record<string, unknown>;
      if (typeof entry.position !== "number") return null;
      const seg = entry.segment as Record<string, unknown> | undefined;
      if (!seg || seg.kind !== "atom") return null;
      if (typeof seg.type !== "string") return null;
      if (typeof seg.label !== "string") return null;
      if (typeof seg.value !== "string") return null;
      out.push({
        position: entry.position,
        segment: {
          kind: "atom",
          type: seg.type,
          label: seg.label,
          value: seg.value,
        },
      });
    }
    return { version: 1, atoms: out };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// DOM event handlers
// ---------------------------------------------------------------------------

/**
 * Handle a copy/cut event on the editor. Writes the plain-text and
 * sidecar payloads, then on cut dispatches a delete transaction
 * through the view. Returns `true` if the event was fully handled
 * (so the caller's `domEventHandlers` should `preventDefault`).
 */
function handleCopyOrCut(
  view: EditorView,
  event: ClipboardEvent,
  isCut: boolean,
): boolean {
  const { from, to } = view.state.selection.main;
  if (from === to) return false; // empty selection — let CM6 default fire

  const text = view.state.doc.sliceString(from, to);
  const atoms = getAtomsInRange(view.state, from, to);
  const payload = serializeClipboard(text, atoms, from);

  const dt = event.clipboardData;
  if (dt === null) return false;

  if (payload.sidecar !== null) {
    dt.setData("text/plain", payload.fallback);
    dt.setData(TUG_ATOMS_MIME, JSON.stringify(payload.sidecar));
  } else {
    dt.setData("text/plain", payload.text);
  }

  event.preventDefault();

  if (isCut) {
    view.dispatch({
      changes: { from, to, insert: "" },
      selection: { anchor: from },
      userEvent: "delete.cut",
    });
  }
  return true;
}

/**
 * Handle a paste event. If a tug atom sidecar is present, reconstruct
 * atoms in the inserted text and dispatch a single transaction that
 * lays down both the U+FFFC characters and the matching decorations.
 * Otherwise fall through and let CM6's default paste handle the text.
 */
function handlePaste(view: EditorView, event: ClipboardEvent): boolean {
  const dt = event.clipboardData;
  if (dt === null) return false;

  const sidecarRaw = dt.getData(TUG_ATOMS_MIME);
  if (sidecarRaw === "") return false; // no sidecar — let CM6 default paste run

  const sidecar = parseClipboardSidecar(sidecarRaw);
  if (sidecar === null) return false;

  const plainText = dt.getData("text/plain");

  // Reconstruct the U+FFFC-bearing string. The sidecar's atoms carry
  // positions relative to the copied text; we use them to map atom
  // labels back to U+FFFC so the inserted doc characters match the
  // sidecar's offsets.
  let docText = plainText;
  const sorted = [...sidecar.atoms].sort((a, b) => b.position - a.position);
  for (const a of sorted) {
    // Verify the label is at `position` before replacing — guards
    // against misaligned external editing of the clipboard payload.
    const label = a.segment.label;
    if (docText.slice(a.position, a.position + label.length) === label) {
      docText = docText.slice(0, a.position)
        + TUG_ATOM_CHAR
        + docText.slice(a.position + label.length);
    }
    // If the label doesn't line up, leave the text alone for that
    // atom — paste will produce the textual form without a widget,
    // which is the safer fallback.
  }

  const { from, to } = view.state.selection.main;

  // Compute the absolute positions for the new atom decorations,
  // rebased onto the post-insertion document.
  const placedAtoms: PositionedAtom[] = [];
  for (const a of sidecar.atoms) {
    if (docText.charCodeAt(a.position) !== TUG_ATOM_CHAR.charCodeAt(0)) continue;
    placedAtoms.push({
      position: from + a.position,
      segment: a.segment,
    });
  }

  view.dispatch({
    changes: { from, to, insert: docText },
    effects: placedAtoms.length > 0 ? addAtomsEffect.of(placedAtoms) : [],
    selection: { anchor: from + docText.length },
    userEvent: "input.paste",
  });

  event.preventDefault();
  return true;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

/**
 * The clipboard extension wires the copy/cut/paste handlers into the
 * editor's DOM event pipeline.
 */
export const clipboardExt: Extension = EditorView.domEventHandlers({
  copy(event, view) {
    return handleCopyOrCut(view, event, false);
  },
  cut(event, view) {
    return handleCopyOrCut(view, event, true);
  },
  paste(event, view) {
    return handlePaste(view, event);
  },
});
