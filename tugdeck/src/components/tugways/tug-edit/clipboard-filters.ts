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
import {
  atomImgHTML,
  TUG_ATOM_CHAR,
  type AtomSegment,
} from "@/lib/tug-atom-img";
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
  /**
   * HTML representation of the copied range — escaped text segments
   * interleaved with `<img data-atom-label data-atom-value
   * data-atom-type>` elements at U+FFFC positions, produced via
   * `atomImgHTML`. Empty string when no atoms are in range (a plain
   * `text/html` payload would only duplicate `text/plain`, which the
   * substrate's bridge-paste handler already prefers).
   *
   * Why html in addition to the sidecar: the substrate's primary
   * paste path inside Tug.app reads the system clipboard via the
   * native bridge (`tug-native-clipboard.ts`), which exposes
   * `text/plain` and `text/html` only — custom MIME types (the
   * sidecar) never cross that bridge. Without html, an in-app copy
   * of an atom-bearing range pastes as label-substituted plain text
   * and atoms vanish. Browsers, by contrast, see the full
   * `clipboardData` set on a paste event so the sidecar still wins
   * the browser-mode round trip.
   */
  html: string;
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

  // Build the html payload by walking `text` glyph-by-glyph, emitting
  // an `atomImgHTML` element at each U+FFFC and HTML-escaping every
  // text segment. Position-keyed lookup avoids worrying about
  // text-substitution length drift the way `fallback` had to.
  let html = "";
  if (local.length > 0) {
    const byPosition = new Map<number, AtomSegment>();
    for (const a of local) byPosition.set(a.position, a.segment);
    let textBuf = "";
    for (let i = 0; i < text.length; i++) {
      const seg = byPosition.get(i);
      if (seg !== undefined) {
        if (textBuf.length > 0) {
          html += escapeHtml(textBuf);
          textBuf = "";
        }
        html += atomImgHTML(seg.type, seg.label, seg.value);
        // Skip the U+FFFC character itself — it has no rendered
        // counterpart in html, the img element fills its slot.
        continue;
      }
      textBuf += text[i];
    }
    if (textBuf.length > 0) {
      html += escapeHtml(textBuf);
    }
  }

  return {
    text,
    fallback,
    sidecar: local.length > 0 ? { version: 1, atoms: local } : null,
    html,
  };
}

/**
 * Escape `&`, `<`, `>` for safe placement inside an HTML payload's
 * text positions. Quotes (`"`, `'`) are not escaped — they only need
 * escaping inside attribute values, and our html payload only places
 * raw text between (or around) `<img>` elements, never inside an
 * attribute. The result is consumed by `DOMParser` on the paste side
 * and by external apps' clipboard html readers; both treat unescaped
 * quotes in text content as plain characters.
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Parse result for `parseClipboardHtml` — same shape `parseClipboardSidecar`
 * implies after pairing with the `text/plain` payload, but built directly
 * from html so the bridge-paste path can build a single transaction.
 */
export interface ParsedClipboardHtml {
  /** Document text, with U+FFFC at each atom position. */
  docText: string;
  /** Atoms with positions relative to `docText` (i.e. matching its U+FFFC). */
  atoms: { position: number; segment: AtomSegment }[];
}

/**
 * Parse a clipboard `text/html` payload produced by `serializeClipboard`
 * (or by tug-prompt-input's contentEditable copy, which serializes
 * the same `<img data-atom-*>` shape).
 *
 * Walks the parsed body's nodes — text and `<img data-atom-label>`
 * elements only — accumulating a `docText` string with U+FFFC at each
 * atom position and a parallel atoms array. Other element kinds
 * (`<span>`, `<br>`, WebKit's clipboard `<meta>` wrapper, etc.) are
 * descended through; their text-node children contribute, their
 * non-`<img data-atom-label>` element children are ignored.
 *
 * Returns `null` when:
 *   - the input doesn't parse as valid html,
 *   - no `<img data-atom-label>` element appears anywhere in the body,
 *   - any encountered atom img is missing one of `data-atom-type` /
 *     `data-atom-label` / `data-atom-value`.
 *
 * Callers should fall back to a pure-text paste in any of those
 * cases (see `tug-edit.tsx` native-bridge paste branch).
 */
export function parseClipboardHtml(html: string): ParsedClipboardHtml | null {
  if (html === "") return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }
  let docText = "";
  const atoms: { position: number; segment: AtomSegment }[] = [];
  let sawAtom = false;

  const walk = (node: Node): boolean => {
    // Returns false on a malformed atom-img encounter so the caller
    // can short-circuit. Text accumulation and atom collection
    // mutate the closures above.
    if (node.nodeType === Node.TEXT_NODE) {
      docText += node.textContent ?? "";
      return true;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return true;
    }
    const el = node as HTMLElement;
    if (el.tagName === "IMG" && el.hasAttribute("data-atom-label")) {
      const type = el.dataset.atomType;
      const label = el.dataset.atomLabel;
      const value = el.dataset.atomValue;
      if (
        typeof type !== "string"
        || typeof label !== "string"
        || typeof value !== "string"
      ) {
        return false;
      }
      atoms.push({
        position: docText.length,
        segment: { kind: "atom", type, label, value },
      });
      docText += TUG_ATOM_CHAR;
      sawAtom = true;
      return true;
    }
    // BR carries a newline in clipboard html — preserve it so a
    // multi-line copy round-trips.
    if (el.tagName === "BR") {
      docText += "\n";
      return true;
    }
    // Any other element: descend into children, ignore the wrapper.
    for (const child of Array.from(el.childNodes)) {
      if (!walk(child)) return false;
    }
    return true;
  };

  for (const child of Array.from(doc.body.childNodes)) {
    if (!walk(child)) return null;
  }
  if (!sawAtom) return null;
  return { docText, atoms };
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
    // text/html: carries atom <img> markup so the paste path inside
    // Tug.app's native bridge (which exposes only plain + html, never
    // custom MIMEs) can reconstruct atoms. Browser-mode paste still
    // prefers the sidecar — html is the cross-bridge fallback.
    dt.setData("text/html", payload.html);
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
