/**
 * tug-text-editor/clipboard-filters.ts — copy / cut / paste DOM event
 * handlers for atom-bearing tug-text-editor selections.
 *
 * ## Wire format
 *
 * This module owns the *browser-mode* clipboard path (a normal Safari /
 * Chrome tab during development). Inside Tug.app (WKWebView) copy and
 * paste of atom selections go through the native NSPasteboard bridge
 * instead (see `tug-native-clipboard.ts` and `tug-text-editor.tsx`),
 * because WebKit's pasteboard normalization swallows custom MIME types
 * and sanitizes HTML — both of which silently drop atom data. The
 * native bridge writes/reads a Tug-private pasteboard type
 * (`dev.tug.prompt-atoms`) carrying the same sidecar this module emits,
 * so the wire schema below is shared across both paths.
 *
 * In browser mode, two payloads land on the system clipboard for every
 * copy / cut:
 *
 * 1. `text/plain`: human-readable text where each U+FFFC has been
 *    substituted with the atom's label. External apps that paste
 *    plain text see meaningful characters, not tofu glyphs.
 * 2. `application/x-tug-atoms`: the raw JSON sidecar
 *    (`{version, text, atoms}`). Within one browser, the synchronous
 *    `copy`/`paste` event preserves this custom type in-process, so the
 *    paste handler reads it straight back — no HTML envelope needed.
 *
 * ## Self-contained sidecar (atoms carry their bytes)
 *
 * The sidecar is fully self-contained so a selection round-trips across
 * cards / windows / sessions, not just within the card that still holds
 * the bytes. Each atom entry carries its `segment` (including the
 * optional `id`) and, for image atoms whose bytes live in the per-card
 * `AtomBytesStore`, the `bytes` themselves. On paste the handler
 * rehydrates those bytes into the destination card's store keyed by the
 * atom id, so the chip reconstitutes fully — image preview, submit-time
 * wire payload, and all.
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
import { processAttachmentFiles } from "./drop-extension";
import type { AtomBytesEntry, AtomBytesStore } from "@/lib/atom-bytes-store";

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
  atoms: TugAtomsClipboardEntry[];
}

/**
 * One atom in the sidecar. `segment` carries the display identity
 * (including the optional `id`); `bytes` carries the image payload for
 * atoms whose bytes lived in the source card's `AtomBytesStore`, so the
 * sidecar is self-contained — a paste destination rehydrates the bytes
 * into its own store keyed by `segment.id` without any dependency on the
 * source card. Absent for non-image atoms (file / command / link / doc)
 * and for image atoms whose bytes had been evicted before the copy.
 */
export interface TugAtomsClipboardEntry {
  position: number;
  segment: AtomSegment;
  bytes?: AtomBytesEntry;
}

/**
 * Output of `serializeClipboard`. The DOM event handler below wires
 * each field to a clipboard MIME type; tests round-trip the fields
 * via `parseClipboardSidecar`.
 */
export interface ClipboardSerialization {
  /** Plain text including U+FFFC at atom positions. */
  text: string;
  /** Plain text with atom labels in place of U+FFFC — for external apps. */
  fallback: string;
  /** JSON sidecar payload with atom data; null if no atoms in range. */
  sidecar: TugAtomsClipboardPayload | null;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a `[from, to)` slice of an editor state into clipboard
 * payloads. Pure: takes only the data it needs, returns plain values.
 * Tested in isolation; the DOM event handler below is the thin shell.
 *
 * `getBytes`, when supplied, resolves an atom id to its stored image
 * bytes so the sidecar can carry them inline (self-contained paste). It
 * is the source card's `AtomBytesStore.get`; omit it (or return null)
 * for editors without a bytes-store, in which case image atoms travel
 * as metadata only.
 */
export function serializeClipboard(
  text: string,
  atoms: readonly PositionedAtom[],
  from: number,
  getBytes?: (id: string) => AtomBytesEntry | null,
): ClipboardSerialization {
  const local: TugAtomsClipboardEntry[] = atoms.map((a) => {
    const entry: TugAtomsClipboardEntry = {
      position: a.position - from,
      segment: a.segment,
    };
    const id = a.segment.id;
    if (id !== undefined && getBytes !== undefined) {
      const bytes = getBytes(id);
      if (bytes !== null) entry.bytes = bytes;
    }
    return entry;
  });

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

  return {
    text,
    fallback,
    sidecar,
  };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Validate and parse a JSON sidecar payload. The sidecar travels two
 * ways into this function:
 *   - browser-mode paste reads `application/x-tug-atoms` from
 *     `clipboardData` and hands the raw JSON here;
 *   - the Tug.app native bridge reads the `dev.tug.prompt-atoms`
 *     pasteboard type and hands the raw JSON here.
 *
 * Preserves the optional `segment.id` and per-atom `bytes` (the
 * self-contained image payload) so a paste destination can rehydrate
 * the bytes into its own store. Returns null on malformed JSON or
 * schema mismatch, so the caller falls back to plain-text paste.
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
    const out: TugAtomsClipboardEntry[] = [];
    for (const a of atomsRaw as unknown[]) {
      if (typeof a !== "object" || a === null) return null;
      const entry = a as Record<string, unknown>;
      if (typeof entry.position !== "number") return null;
      const seg = entry.segment as Record<string, unknown> | undefined;
      if (!seg || seg.kind !== "atom") return null;
      if (typeof seg.type !== "string") return null;
      if (typeof seg.label !== "string") return null;
      if (typeof seg.value !== "string") return null;
      const segment: AtomSegment = {
        kind: "atom",
        type: seg.type,
        label: seg.label,
        value: seg.value,
      };
      if (typeof seg.id === "string") segment.id = seg.id;
      const out_entry: TugAtomsClipboardEntry = {
        position: entry.position,
        segment,
      };
      const bytes = parseBytesEntry(entry.bytes);
      if (bytes !== null) out_entry.bytes = bytes;
      out.push(out_entry);
    }
    return { version: 1, text: obj.text, atoms: out };
  } catch {
    return null;
  }
}

/**
 * Validate a sidecar atom's `bytes` field against the `AtomBytesEntry`
 * shape. Returns null for absent or malformed bytes — an atom without
 * recoverable bytes still pastes as a (pending) chip; we just don't
 * rehydrate the store for it.
 */
function parseBytesEntry(raw: unknown): AtomBytesEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.content !== "string") return null;
  if (typeof b.mediaType !== "string") return null;
  const entry: AtomBytesEntry = { content: b.content, mediaType: b.mediaType };
  if (typeof b.thumbnailDataUrl === "string") {
    entry.thumbnailDataUrl = b.thumbnailDataUrl;
  }
  return entry;
}

/**
 * Rehydrate a sidecar's image bytes into a destination `AtomBytesStore`.
 * For each pasted atom that carries both an `id` and `bytes`, `put` the
 * bytes keyed by id so the reconstituted chip resolves non-pending and
 * the submit-time wire payload finds its image. No-op for atoms without
 * bytes (file / command / link / doc) and when no store is available.
 *
 * Shared by the browser-mode paste handler and the native-bridge paste
 * path so both reconstitute images identically.
 */
export function rehydrateSidecarBytes(
  payload: TugAtomsClipboardPayload,
  store: AtomBytesStore | null,
): void {
  if (store === null) return;
  for (const a of payload.atoms) {
    const id = a.segment.id;
    if (id !== undefined && a.bytes !== undefined) {
      store.put(id, a.bytes);
    }
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
  getBytesStore: () => AtomBytesStore | null,
): boolean {
  const { from, to } = view.state.selection.main;
  if (from === to) return false; // empty selection — let CM6 default fire

  const text = view.state.doc.sliceString(from, to);
  const atoms = getAtomsInRange(view.state, from, to);
  const store = getBytesStore();
  const getBytes = store !== null ? (id: string) => store.get(id) : undefined;
  const payload = serializeClipboard(text, atoms, from, getBytes);

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
 * Walk a `DataTransferItemList` and return the `File` objects for
 * items whose MIME starts with `image/`. The shape DataTransferItem
 * is awkward — items can be type `file`, type `string`, or both —
 * and `getAsFile()` returns `null` for non-file items. This helper
 * isolates that quirk so the paste handler stays readable.
 *
 * Returns `null` when no image items are present (the common case —
 * text paste, internal sidecar paste); callers fall through to the
 * sidecar/text path. Returns an empty array only if items report as
 * images but `getAsFile()` yields nothing (rare; defensive).
 */
function extractImageFiles(
  items: DataTransferItemList | null,
): readonly File[] | null {
  if (items === null || items.length === 0) return null;
  const out: File[] = [];
  let anyImage = false;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    if (item.kind !== "file") continue;
    if (!item.type.startsWith("image/")) continue;
    anyImage = true;
    const file = item.getAsFile();
    if (file !== null) out.push(file);
  }
  return anyImage ? out : null;
}

/**
 * Handle a paste event in browser mode (the substrate's
 * native-bridge paste path lives in `tug-text-editor.tsx` and calls
 * `parseClipboardHtmlEnvelope` directly). The browser-mode handler
 * has three branches in priority order:
 *
 *  1. **Image clipboard items.** If `clipboardData.items` contains
 *     one or more `image/*` files (Cmd+Shift+4 screenshot pastes,
 *     copy-from-Preview, etc.), claim the event and route the files
 *     through the same async pipeline drop uses — downsample, mint
 *     ids, populate the bytes-store, insert atoms.
 *  2. **Tug atom sidecar.** The custom MIME (`application/x-tug-atoms`)
 *     carries an internal copy from another tug surface. Decodes
 *     and re-inserts atoms verbatim.
 *  3. **Default.** Returns false; CM6's default text-paste path
 *     handles the event.
 *
 * Image pastes only fire when a bytes-store is available. Without a
 * store (gallery card, future detached prompt-entry), image items
 * fall through to the next branch — typically nothing comes back
 * since clipboards with image items don't usually carry the
 * substrate's atom sidecar.
 */
function handlePaste(
  view: EditorView,
  event: ClipboardEvent,
  getBytesStore: () => AtomBytesStore | null,
  onAttachmentError: (message: string) => void,
  getPastedCommandResolver: () => PastedCommandResolver | null,
): boolean {
  const dt = event.clipboardData;
  if (dt === null) return false;

  // Branch 1: image clipboard items. Only fires when a bytes-store
  // is available; otherwise we have nowhere to stash the bytes and
  // the user would get an atom with no content.
  const bytesStore = getBytesStore();
  if (bytesStore !== null) {
    const imageFiles = extractImageFiles(dt.items);
    if (imageFiles !== null && imageFiles.length > 0) {
      event.preventDefault();
      const { from } = view.state.selection.main;
      void processAttachmentFiles(
        view,
        imageFiles,
        from,
        bytesStore,
        onAttachmentError,
      );
      return true;
    }
  }

  // Branch 2: tug atom sidecar (internal copy/paste).
  const sidecarRaw = dt.getData(TUG_ATOMS_MIME);
  if (sidecarRaw !== "") {
    const sidecar = parseClipboardSidecar(sidecarRaw);
    if (sidecar !== null) {
      // Rehydrate any carried image bytes into this card's store first,
      // so the reconstituted chips resolve non-pending immediately.
      rehydrateSidecarBytes(sidecar, bytesStore);
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
        // Reveal the caret after the paste — without this the sidecar-paste
        // path leaves the caret below the fold on a paste that overflows the
        // visible rows. (The `keepCaretVisible` listener also re-checks
        // post-layout, but flag the transaction too for the immediate case.)
        scrollIntoView: true,
      });

      event.preventDefault();
      return true;
    }
  }

  // Branch 3: external plain text whose first position is an exact slash
  // command → chip it, keeping the rest of the paste as its argument text.
  const resolve = getPastedCommandResolver();
  if (resolve !== null) {
    const plain = dt.getData("text/plain");
    if (plain !== "" && tryInsertLeadingCommandPaste(view, plain, resolve)) {
      event.preventDefault();
      return true;
    }
  }

  // Branch 4: default — CM6's plain-text paste handles the event.
  return false;
}

// ---------------------------------------------------------------------------
// Leading-command paste
// ---------------------------------------------------------------------------

/**
 * Resolve a pasted command token to the atom segment to chip it as, or `null`
 * when the token isn't a recognized command. Both the full namespaced name
 * (`tugplug:implement`) and its unqualified leaf (`implement`) resolve — the
 * same rule as accepting a typed `/command ` against the popup. The host builds
 * this from its live command catalog; omitted (gallery / standalone) ⇒ no
 * recognition.
 */
export type PastedCommandResolver = (token: string) => AtomSegment | null;

/**
 * When pasted plain text begins with `/<command>` and the paste lands at the
 * document's very first position, replace that `/<command>` with a command chip
 * and keep the remaining pasted text as its argument — e.g. pasting
 * `/tugplug:implement roadmap/foo.md` yields `[chip] roadmap/foo.md`. The
 * insert and the atom decoration go out in one transaction.
 *
 * Returns true (and dispatches) on a recognized leading command; returns false
 * — no dispatch — when the caret isn't at offset 0, the text has no leading
 * `/token`, or the token isn't a known command, so the caller's default paste
 * runs untouched.
 */
export function tryInsertLeadingCommandPaste(
  view: EditorView,
  text: string,
  resolve: PastedCommandResolver,
): boolean {
  const { from, to } = view.state.selection.main;
  const plan = planLeadingCommandPaste(text, from, resolve);
  if (plan === null) return false;
  view.dispatch({
    changes: { from, to, insert: plan.insert },
    effects: addAtomsEffect.of([{ position: from, segment: plan.segment }]),
    selection: { anchor: from + plan.insert.length },
    userEvent: "input.paste",
    scrollIntoView: true,
  });
  return true;
}

/**
 * Pure decision behind {@link tryInsertLeadingCommandPaste}: given the pasted
 * text, the caret offset it lands at, and the resolver, return the text to
 * insert (the atom's U+FFFC char + a separator + the remaining pasted text) and
 * the command's atom segment — or `null` when there's nothing to chip: the
 * caret isn't at offset 0, the text has no leading `/token`, or the token isn't
 * a known command. A separating space follows the chip (as a typed accept
 * leaves) unless the remaining pasted text already opens with whitespace, so
 * the chip never glues onto an argument nor doubles a space. Exported for the
 * test suite.
 */
export function planLeadingCommandPaste(
  text: string,
  from: number,
  resolve: PastedCommandResolver,
): { insert: string; segment: AtomSegment } | null {
  // Only when the command would occupy the document's first position.
  if (from !== 0) return null;
  const match = /^\/(\S+)/.exec(text);
  if (match === null) return null;
  const segment = resolve(match[1]!);
  if (segment === null) return null;
  // The token is `\S+`, so `rest` is empty or already starts with whitespace;
  // add the separator only when it doesn't (i.e. the command stood alone).
  const rest = text.slice(match[0].length);
  const sep = /^\s/.test(rest) ? "" : " ";
  return { insert: TUG_ATOM_CHAR + sep + rest, segment };
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

/**
 * Build the clipboard extension. Optional thunks unlock the
 * image-paste branch ([Step 2] of `roadmap/dev-atoms.md`):
 *
 *  - `getBytesStore`: per-card bytes-store; when present, image
 *    clipboard items route through the async downsample pipeline.
 *    Default `() => null` keeps the pre-Step-2 behavior (image
 *    pastes fall through to text).
 *  - `onAttachmentError`: surfaces downsample-rejection messages on
 *    the host's banner channel. Default no-op.
 *
 * Copy and cut paths are unchanged; they don't need the new params.
 */
export function clipboardExtension(
  getBytesStore: () => AtomBytesStore | null = () => null,
  onAttachmentError: (message: string) => void = () => undefined,
  getPastedCommandResolver: () => PastedCommandResolver | null = () => null,
): Extension {
  return EditorView.domEventHandlers({
    copy(event, view) {
      return handleCopyOrCut(view, event, false, getBytesStore);
    },
    cut(event, view) {
      return handleCopyOrCut(view, event, true, getBytesStore);
    },
    paste(event, view) {
      return handlePaste(
        view,
        event,
        getBytesStore,
        onAttachmentError,
        getPastedCommandResolver,
      );
    },
  });
}

/**
 * Pre-Step-2 const export. Equivalent to `clipboardExtension()` with
 * default thunks (no bytes-store wiring, no error surfacing). Kept
 * for consumers (and tests) that don't participate in attachment
 * bytes; new consumers should call `clipboardExtension` directly.
 */
export const clipboardExt: Extension = clipboardExtension();

// `TUG_ATOM_CHAR` is re-exported from this module so callers (notably
// tests) can build sidecar fixtures without a separate import. It's
// the same character `tug-atom-img` exports.
export { TUG_ATOM_CHAR };
