/**
 * tug-edit/clipboard-filters.ts — copy / cut / paste DOM event
 * handlers for atom-bearing tug-edit selections.
 *
 * ## Wire format
 *
 * Two payloads land on the system clipboard for every copy / cut:
 *
 * 1. `text/plain`: human-readable text where each U+FFFC has been
 *    substituted with the atom's label. External apps that paste
 *    plain text see meaningful characters, not tofu glyphs.
 * 2. `text/html`: a single `<span data-tug-atoms="…">…</span>`
 *    element. The `data-tug-atoms` attribute carries a base64-
 *    encoded JSON sidecar (`{version, text, atoms}`) — the
 *    self-contained payload tug-edit reads back on paste. The span's
 *    visible text is the same label-substituted string text/plain
 *    carries, so external apps that prefer rich html still get
 *    something readable.
 *
 * Browsers also receive an `application/x-tug-atoms` MIME with the
 * raw JSON sidecar — see the browser-mode paste path below. WebKit
 * does NOT propagate that custom MIME to NSPasteboard with its own
 * type (it packs everything into `com.apple.WebKit.custom-pasteboard-
 * data`, an undocumented archive blob), so the Tug.app native paste
 * bridge can't read it. The `data-tug-atoms` HTML attribute survives
 * WebKit's pasteboard normalization unchanged (verified empirically
 * in `at0045-pasteboard-custom-mime-probe.test.ts`), which is why we
 * route the cross-bridge atom data through that channel.
 *
 * ## Why this format and not "real" rich html
 *
 * An earlier iteration emitted text/html as a sequence of `<img
 * data-atom-*>` elements interleaved with text segments, parsed via
 * DOMParser on paste. WebKit normalizes that html for the pasteboard
 * (wrapping content in `<span style="…">`, dropping comments,
 * dropping `<script>`, splitting newlines into paragraphs), and the
 * DOM walker missed atoms in multi-line / multi-atom selections
 * because the structure didn't match the walker's assumptions. The
 * `data-tug-atoms` envelope solves this: we own both ends of the
 * channel, the data is opaque to WebKit's html serializer, and the
 * decoder is a single regex + base64 + JSON.parse.
 *
 * Laws: [L06] DOM clipboard manipulation, no React state, [L07]
 *        event handlers receive the live `view` from CM6's dispatch,
 *        [L11] clipboard operations are responder actions on the
 *        component-owned document, [L19] file structure, [L22]
 *        direct DOM event handling without React round-trip.
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
 *
 * `text` carries the document text with U+FFFC at each atom position;
 * `atoms` carries one entry per U+FFFC with the segment data. The
 * payload is fully self-contained — a paste handler can rebuild the
 * destination doc + decorations from this alone, no dependency on
 * `text/plain` (which the browser may or may not have available, and
 * which carries label-substituted text anyway).
 */
export interface TugAtomsClipboardPayload {
  version: 1;
  /** Document text with U+FFFC at atom positions. */
  text: string;
  /** Atoms aligned with U+FFFC characters in `text`. */
  atoms: { position: number; segment: AtomSegment }[];
}

/**
 * Output of `serializeClipboard`. The DOM event handler below wires
 * each field to a clipboard MIME type; tests round-trip the fields
 * via `parseClipboardSidecar` / `parseClipboardHtmlEnvelope`.
 */
export interface ClipboardSerialization {
  /** Plain text including U+FFFC at atom positions. */
  text: string;
  /** Plain text with atom labels in place of U+FFFC — for external apps. */
  fallback: string;
  /** JSON sidecar payload with atom data; null if no atoms in range. */
  sidecar: TugAtomsClipboardPayload | null;
  /**
   * Single-element `<span data-tug-atoms="BASE64_JSON">…</span>` html
   * envelope carrying the sidecar. Empty string when there are no
   * atoms in the range — browser-mode paste handlers fall back to
   * plain text and the bridge-paste path treats absence as "no atoms
   * in this clipboard".
   */
  html: string;
}

// ---------------------------------------------------------------------------
// Base64 helpers (UTF-8 safe)
// ---------------------------------------------------------------------------

/**
 * Encode a UTF-8 string as base64. `btoa` requires Latin-1, so we
 * route through `TextEncoder` and a binary string. Used for the
 * `data-tug-atoms` envelope so atom labels with non-ASCII characters
 * survive the round trip.
 */
function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/**
 * Inverse of `utf8ToBase64`. Returns null on malformed base64 or
 * UTF-8 — callers should fall back to plain-text paste.
 */
function base64ToUtf8(b64: string): string | null {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

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

  const sidecar: TugAtomsClipboardPayload | null = local.length > 0
    ? { version: 1, text, atoms: local }
    : null;

  let html = "";
  if (sidecar !== null) {
    const encoded = utf8ToBase64(JSON.stringify(sidecar));
    // Visible content is the label-substituted text — html-escaped so
    // an external app pasting rich html sees readable text. The
    // `data-tug-atoms` attribute is opaque to non-tug consumers.
    html = `<span data-tug-atoms="${encoded}">${escapeHtml(fallback)}</span>`;
  }

  return {
    text,
    fallback,
    sidecar,
    html,
  };
}

/**
 * Escape `&`, `<`, `>` for safe placement inside an HTML payload's
 * text positions. The `data-tug-atoms` attribute value is base64 so
 * needs no escaping; only the visible text content does.
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Extract the sidecar from a clipboard `text/html` payload by
 * regex-matching the `data-tug-atoms` attribute. Survives WebKit's
 * pasteboard normalization (which adds `<span style>` wrappers and
 * may inject `<meta>` headers but leaves data-attributes untouched —
 * verified by `at0045-pasteboard-custom-mime-probe.test.ts`).
 *
 * Returns null when:
 *   - the input has no `data-tug-atoms` attribute,
 *   - the attribute value isn't valid base64 / utf-8,
 *   - the decoded JSON doesn't match the `TugAtomsClipboardPayload` schema.
 *
 * In any of those cases the caller should fall back to plain-text paste.
 */
export function parseClipboardHtmlEnvelope(
  html: string,
): TugAtomsClipboardPayload | null {
  if (html === "") return null;
  // Match `data-tug-atoms="…"` with double or single quotes.
  const match = /data-tug-atoms=(?:"([^"]*)"|'([^']*)')/.exec(html);
  if (match === null) return null;
  const encoded = match[1] ?? match[2] ?? "";
  if (encoded === "") return null;
  const json = base64ToUtf8(encoded);
  if (json === null) return null;
  return parseClipboardSidecar(json);
}

/**
 * Validate and parse a JSON sidecar payload. Used by:
 *   - browser-mode paste (reads `application/x-tug-atoms` from
 *     `clipboardData`, hands the raw JSON to this function),
 *   - `parseClipboardHtmlEnvelope` (decodes base64 then validates here).
 *
 * Returns null on malformed JSON or schema mismatch.
 */
export function parseClipboardSidecar(
  raw: string,
): TugAtomsClipboardPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (obj.version !== 1) return null;
    if (typeof obj.text !== "string") return null;
    const atomsRaw = obj.atoms;
    if (!Array.isArray(atomsRaw)) return null;
    const out: { position: number; segment: AtomSegment }[] = [];
    for (const a of atomsRaw as unknown[]) {
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
    return { version: 1, text: obj.text, atoms: out };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// DOM event handlers
// ---------------------------------------------------------------------------

/**
 * Handle a copy/cut event on the editor. Writes the plain-text,
 * sidecar, and html payloads, then on cut dispatches a delete
 * transaction through the view. Returns `true` if the event was
 * fully handled (so the caller's `domEventHandlers` should
 * `preventDefault`).
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
 * Handle a paste event in browser mode (the substrate's
 * native-bridge paste path lives in `tug-edit.tsx` and calls
 * `parseClipboardHtmlEnvelope` directly). The browser-mode handler
 * prefers the custom MIME sidecar — it's the most reliable carrier
 * inside a single WebKit instance because no html normalization
 * intervenes.
 */
function handlePaste(view: EditorView, event: ClipboardEvent): boolean {
  const dt = event.clipboardData;
  if (dt === null) return false;

  const sidecarRaw = dt.getData(TUG_ATOMS_MIME);
  if (sidecarRaw === "") return false; // no sidecar — let CM6 default paste run

  const sidecar = parseClipboardSidecar(sidecarRaw);
  if (sidecar === null) return false;

  const { from, to } = view.state.selection.main;
  const placedAtoms: PositionedAtom[] = sidecar.atoms.map((a) => ({
    position: from + a.position,
    segment: a.segment,
  }));

  view.dispatch({
    changes: { from, to, insert: sidecar.text },
    effects: placedAtoms.length > 0 ? addAtomsEffect.of(placedAtoms) : [],
    selection: { anchor: from + sidecar.text.length },
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

// `TUG_ATOM_CHAR` is re-exported from this module so callers (notably
// tests) can build sidecar fixtures without a separate import. It's
// the same character `tug-atom-img` exports.
export { TUG_ATOM_CHAR };
