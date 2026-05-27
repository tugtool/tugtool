/**
 * tug-text-editor/drop-extension.ts — file-drop atom insertion + live drop
 * caret indicator.
 *
 * Wires three concerns into one extension:
 *
 *   1. **Drop caret indicator.** A live thin-vertical-line caret
 *      tracks the resolved drop position in real time as the user
 *      drags a file over the editor. Without this the user has no
 *      idea where their drop will land — a critical UX gap. The
 *      caret position carries the same vertical bias the existing
 *      `TugTextEngine` uses (`DROP_Y_OFFSET_RATIO`): the hit-test
 *      point is shifted ~0.9 line-heights upward so the resolved
 *      position sits above the drag ghost rather than behind it.
 *
 *   2. **`dragover` accept.** `preventDefault()` on `dragover` is
 *      required to indicate the editor accepts drops; without it
 *      the OS refuses the drag and no `drop` event ever fires.
 *      We further set `dataTransfer.dropEffect = "copy"` so the
 *      cursor shows the copy-cursor variant.
 *
 *   3. **`drop` insertion.** `preventDefault()` to suppress the
 *      WebView's default navigate-to-file-URL behavior, then a
 *      single transaction inserts each dropped file as an atom at
 *      the (bias-adjusted) drop offset. File → atom conversion
 *      defers to a host-supplied `DropHandler` thunk; without one
 *      an extension-based default classifies known image formats
 *      as `image` and everything else as `file`.
 *
 * The caret is implemented with CM6's standard StateField +
 * ViewPlugin + `requestMeasure` pattern — same shape as CM6's
 * built-in `dropCursor` extension. We don't compose `dropCursor`
 * directly because its `dragover` observer doesn't apply the Y
 * bias and runs as `eventObservers` (which cannot
 * `preventDefault`); we need the bias and we need to claim the
 * dragover event so the `drop` event ever fires.
 *
 * The whole drop is one CM6 transaction: a single `changes` insert
 * of `N × U+FFFC` followed by `addAtomsEffect.of([…])` carrying
 * every atom's segment + position. CM6 only ever observes the
 * post-drop state — there's no intermediate frame where the
 * placeholder characters render without their widgets.
 *
 * Laws: [L06] appearance via DOM (the drop caret is an
 *        absolutely-positioned `<div>` in `view.scrollDOM`, not
 *        React state; atom widgets render as images), [L07] the
 *        dropHandler thunk reads the latest host-supplied handler
 *        at fire time, [L13] no rAF — the caret position is
 *        committed via `view.requestMeasure` (CM6's measure-phase
 *        scheduler), the drop is one transaction dispatched
 *        directly from the DOM event handler, [L19] file structure
 *        (`tug-text-editor/drop-extension.ts` paired with
 *        `tug-text-editor-drop.test.ts`).
 *
 * Third-party notice: CodeMirror 6 (MIT) — see
 * `THIRD_PARTY_NOTICES.md`. The drop caret pattern (StateField
 * tracking a position + ViewPlugin painting it via
 * `requestMeasure`) is adapted from CM6's `dropCursor`
 * implementation.
 */

import { StateEffect, StateField } from "@codemirror/state";
import type { Extension, Transaction } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import type { PluginValue, ViewUpdate } from "@codemirror/view";
import {
  TUG_ATOM_CHAR,
  type AtomSegment,
} from "@/lib/tug-atom-img";
import { addAtomsEffect, removeAtomById } from "./atom-decoration";
import type { DropHandler } from "@/lib/tug-text-types";
import {
  classifySourceMime,
  downsampleImage,
  type DownsampleError,
} from "@/lib/image-downsample";
import {
  describeTextAttachmentError,
  isTextMimeType,
  isTextSource,
  readTextAttachment,
} from "@/lib/text-attachment";
import type { AtomBytesStore } from "@/lib/atom-bytes-store";
import {
  getCurrentDragFiles,
  type NativeDragFileEntry,
} from "@/lib/native-drag-bridge";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Fraction of line-height to shift the drop hit-point upward.
 *
 * Mirror of `DROP_Y_OFFSET_RATIO` in `tug-text-engine.ts`. The drag
 * ghost rendered by the OS sits centered on the cursor; without the
 * bias, `posAtCoords` resolves to the position *under* the ghost,
 * which is hidden from the user. Shifting the hit-test point ~0.9
 * line-heights upward puts the resolved position directly above the
 * ghost where the eye is naturally looking.
 *
 * The negative value subtracts from `clientY`. Keeping the constant
 * shape and name identical to the engine so a future alignment pass
 * (or a regression report citing one) maps to both substrates.
 */
const DROP_Y_OFFSET_RATIO = -0.9;

/** File extensions classified as images for the default file→atom map. */
const IMG_EXTS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
]);

/** CSS class applied to the drop caret indicator element. */
const DROP_CARET_CLASS = "cm-tug-drop-caret";

// ---------------------------------------------------------------------------
// Default file → atom conversion
// ---------------------------------------------------------------------------

/**
 * Convert a `FileList` into atom segments using only the file name.
 *
 * Image extensions land as `type: "image"` so the atom renders with
 * the image-kind treatment from `tug-atom-img`; everything else
 * lands as `type: "file"`. The label and value are both the bare
 * filename — callers that need real paths (or content hashes, or
 * server-side URLs) supply their own `DropHandler` and the default
 * is bypassed entirely.
 */
function defaultFilesToAtoms(files: FileList): AtomSegment[] {
  const out: AtomSegment[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    const type = IMG_EXTS.has(ext) ? "image" : "file";
    out.push({ kind: "atom", type, label: f.name, value: f.name });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Position resolution
// ---------------------------------------------------------------------------

/**
 * Resolve `(clientX, clientY)` to a document offset, applying the
 * DROP_Y_OFFSET_RATIO bias so the result sits above the drag ghost
 * rather than behind it.
 *
 * Returns `null` when the resolver can't anchor the bias-adjusted
 * point (typical for drops landing above the first line). Exported
 * for test-side coverage of the bias math without having to
 * synthesize a `DragEvent`.
 */
export function dropOffsetAtCoords(
  view: EditorView,
  clientX: number,
  clientY: number,
): number | null {
  const lh = view.defaultLineHeight;
  const adjustedY = clientY + lh * DROP_Y_OFFSET_RATIO;
  // `posAtCoords` reads measured layout state; on pre-measure mounts
  // it can throw "Reading the editor layout isn't allowed during an
  // update" or a related InvalidStateError. Treat any throw as
  // "couldn't resolve the point" so the caller falls back to
  // end-of-doc rather than the whole drop pipeline failing.
  try {
    return view.posAtCoords({ x: clientX, y: adjustedY });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Drop-caret state field + effect
// ---------------------------------------------------------------------------

/**
 * Effect carrying the new drop-caret document position (or `null`
 * to hide the caret). Read by the StateField below; produced by
 * the DOM event handlers.
 */
const setTugDropCaretPos = StateEffect.define<number | null>();

/**
 * StateField holding the live drop-caret document position, or
 * `null` when no drag is in progress. Maps through document
 * changes so a long-running drag over a doc-changing editor
 * (rare, but possible) doesn't lock the caret to a stale offset.
 */
const tugDropCaretField = StateField.define<number | null>({
  create(): number | null {
    return null;
  },
  update(pos: number | null, tr: Transaction): number | null {
    let next = pos === null ? null : tr.changes.mapPos(pos);
    for (const effect of tr.effects) {
      if (effect.is(setTugDropCaretPos)) {
        next = effect.value;
      }
    }
    return next;
  },
});

// ---------------------------------------------------------------------------
// Drop-caret painter (ViewPlugin)
// ---------------------------------------------------------------------------

interface DropCaretMeasure {
  left: number;
  top: number;
  height: number;
}

/**
 * ViewPlugin that owns the drop-caret `<div>` and reconciles its
 * position with the StateField on every update. Uses
 * `view.requestMeasure` for layout reads + writes — same pattern
 * as CM6's built-in `dropCursor`.
 *
 * Plugin lifecycle:
 *   - Construct: lazy — the caret element is created on first
 *     non-null position so editors that never see a drop pay no
 *     DOM cost.
 *   - Update: when the StateField position changes, schedule a
 *     measure read + write.
 *   - Destroy: remove the caret element.
 */
class TugDropCaretPlugin implements PluginValue {
  caret: HTMLDivElement | null = null;
  private readonly measureReq = {
    read: this.readPos.bind(this),
    write: this.writePos.bind(this),
  };

  constructor(private readonly view: EditorView) {}

  update(update: ViewUpdate): void {
    const pos = update.state.field(tugDropCaretField);
    if (pos === null) {
      // No active drag — drop the caret element so a stale stub
      // doesn't survive subsequent layout changes.
      if (this.caret !== null) {
        this.caret.remove();
        this.caret = null;
      }
      return;
    }
    if (this.caret === null) {
      this.caret = this.view.scrollDOM.appendChild(
        document.createElement("div"),
      );
      this.caret.className = DROP_CARET_CLASS;
    }
    // Re-measure when the position changed, the doc changed (CM6
    // re-laid out lines), or geometry changed (window resize, font
    // load, etc.).
    if (
      update.startState.field(tugDropCaretField) !== pos
      || update.docChanged
      || update.geometryChanged
    ) {
      this.view.requestMeasure(this.measureReq);
    }
  }

  /**
   * Measure-phase read: convert the StateField position into
   * scrollDOM-relative coords so the caret sits at the resolved
   * drop point and scrolls with the content.
   *
   * Caret height matches `view.defaultLineHeight` (the line-box
   * height pinned by the `.cm-line::before` ghost in
   * `tug-text-editor/theme.ts`) rather than the glyph rect from
   * `coordsAtPos` — the regular browser caret renders at the
   * full line-box height, and the drop caret should match so
   * the user reads them as the same kind of position indicator.
   * The caret is centered vertically on the glyph rect so a
   * mid-line atom (24px) and adjacent text (~18px) both produce
   * the same drop-caret position.
   *
   * Returns `null` when the position cannot be resolved (typical
   * for drops above the first line); the writer then hides the
   * caret by sliding it off-screen.
   */
  private readPos(): DropCaretMeasure | null {
    const pos = this.view.state.field(tugDropCaretField);
    if (pos === null) return null;
    const rect = this.view.coordsAtPos(pos);
    if (rect === null) return null;
    const outer = this.view.scrollDOM.getBoundingClientRect();
    const lineHeight = this.view.defaultLineHeight;
    const center = (rect.top + rect.bottom) / 2;
    return {
      left: rect.left - outer.left + this.view.scrollDOM.scrollLeft,
      top: center - lineHeight / 2 - outer.top + this.view.scrollDOM.scrollTop,
      height: lineHeight,
    };
  }

  /**
   * Measure-phase write: position the caret element. When the
   * read returned `null`, slide the caret off-screen rather than
   * removing it (the StateField is still non-null, so the
   * destroy path isn't appropriate; off-screen positioning is
   * the same trick CM6's built-in dropCursor uses).
   */
  private writePos(measured: DropCaretMeasure | null): void {
    if (this.caret === null) return;
    if (measured === null) {
      this.caret.style.left = "-100000px";
      return;
    }
    this.caret.style.left = `${measured.left}px`;
    this.caret.style.top = `${measured.top}px`;
    this.caret.style.height = `${measured.height}px`;
  }

  destroy(): void {
    if (this.caret !== null) {
      this.caret.remove();
      this.caret = null;
    }
  }
}

const tugDropCaretPlugin = ViewPlugin.fromClass(TugDropCaretPlugin);

// ---------------------------------------------------------------------------
// Insertion helper
// ---------------------------------------------------------------------------

/**
 * Dispatch a single transaction inserting `atoms` at `pos`.
 *
 * Each atom takes one document character (the U+FFFC sentinel),
 * matched by an `addAtomsEffect` entry whose `position` falls inside
 * the just-inserted run. The selection lands immediately after the
 * last inserted atom — same convention as `insertAtomAt` /
 * `insertAtomAtSelection`. No `scrollIntoView`: the user's eye is
 * already on the drop site, so an automatic scroll would be jarring.
 *
 * Exported so tests can drive the insertion without a `DragEvent`.
 */
export function insertAtomsAt(
  view: EditorView,
  pos: number,
  atoms: readonly AtomSegment[],
): void {
  if (atoms.length === 0) return;
  const insert = TUG_ATOM_CHAR.repeat(atoms.length);
  const positioned = atoms.map((segment, i) => ({
    position: pos + i,
    segment,
  }));
  view.dispatch({
    changes: { from: pos, insert },
    effects: [
      addAtomsEffect.of(positioned),
      // Hide the drop caret in the same transaction as the
      // insertion — atomic from the user's perspective.
      setTugDropCaretPos.of(null),
    ],
    selection: { anchor: pos + atoms.length },
    userEvent: "input.tug-atom-drop",
  });
}

// ---------------------------------------------------------------------------
// Theme — drop-caret styling
// ---------------------------------------------------------------------------

/**
 * Drop-caret styling. Width / position / pointer-events are
 * structural; color is themed via the same token the engine uses,
 * so brio and harmony pick up the right blue without needing a
 * separate per-substrate theme entry.
 */
const tugDropCaretTheme = EditorView.baseTheme({
  [`.${DROP_CARET_CLASS}`]: {
    position: "absolute",
    width: "2px",
    borderRadius: "1px",
    pointerEvents: "none",
    backgroundColor: "var(--tug7-element-highlight-fill-normal-drop-rest)",
  },
});

// ---------------------------------------------------------------------------
// Image-attachment async pipeline
// ---------------------------------------------------------------------------

/**
 * Convert a `DownsampleError` into a user-facing string suitable for
 * the `attachment_rejected` banner. The discriminated shape lets us
 * tailor copy per failure mode; the resulting messages match the
 * surface entries in [Table T01]
 * (`roadmap/tide-atoms.md#t01-failure-modes`).
 *
 * Exported for the paste handler (in `clipboard-filters.ts`) which
 * uses the same convention.
 */
export function describeDownsampleError(
  err: DownsampleError,
  filename: string,
): string {
  switch (err.kind) {
    case "unsupported-format":
      return `Image format unsupported: ${err.mediaType}`;
    case "too-large-after-fallback": {
      const mb = (err.byteSize / 1024 / 1024).toFixed(1);
      return `Image too large after compression: ${filename} (${mb} MB)`;
    }
    case "decode-failed":
      return `Could not decode image: ${filename}`;
  }
}

/**
 * Drop-time supportedness check. Walks `dataTransfer.files`, which
 * is fully populated with real MIME info at the moment `drop`
 * fires (unlike at `dragenter` / `dragover`, where WebKit redacts
 * per-item MIME info entirely — `dataTransfer.items.length === 0`
 * for cross-origin file drags from Finder). Returns `true` if any
 * file is an image (per `classifySourceMime`) or a text source
 * (per `isTextMimeType`, with empty MIME treated as potentially
 * text by extension — the drop pipeline's full `isTextSource`
 * does the filename fallback).
 *
 * Used by the `drop` handler to silently refuse drops whose every
 * file is known-unsupported (PDF, archive, audio, video, etc.). The
 * user sees no atom and no banner; the OS already gave them a
 * "copy" cursor during drag (WebKit gave us no way to refuse it at
 * the cursor — see Step 3.5.7's native-bridge work for the cursor-
 * level rejection path), so the empty result is the only signal.
 *
 * WebKit reference: bug #223517 (DataTransferItemList is empty
 * during dragenter/dragover events when dragging files) —
 * unresolved as of December 2023. Confirmed empirically in
 * WKWebView via the Step 3.5.7 instrumentation pass: `types`
 * carries `["Files"]` during drag but `items` and `files` are
 * both length-0; only at `drop` time does WKWebView reveal the
 * real MIME and filename.
 */
function dropHasSupportedFile(dataTransfer: DataTransfer | null): boolean {
  if (dataTransfer === null) return false;
  const files = dataTransfer.files;
  if (!files || files.length === 0) return false;
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]!;
    const mime = file.type;
    // Empty MIME — could still be text by extension (e.g., `.ts`
    // from Finder). Optimistic accept; the drop pipeline runs
    // `isTextSource` which does the extension classification.
    if (mime === "") return true;
    if (classifySourceMime(mime) !== "unsupported") return true;
    if (isTextMimeType(mime)) return true;
  }
  return false;
}

/**
 * Native-bridge supportedness check. Operates on the
 * `PasteboardSnapshot` pushed in by the Swift host
 * (`tugapp/Sources/Drag/TugDragDestination.swift`) at every
 * `draggingEntered:` / `draggingUpdated:`. Mirrors the drop-time
 * `dropHasSupportedFile` logic — any image-classifiable MIME or text-
 * classifiable MIME makes the drag acceptable. An entry whose
 * `mimeType` is absent is treated optimistically (true): the final
 * classification at drop time runs `isTextSource` which does the
 * filename-extension fallback, and refusing at the cursor based on
 * missing MIME would over-reject (e.g. `.ts` files from Finder
 * sometimes arrive without a registered MIME).
 *
 * Returns `true` if at least one entry is supported; `false` only
 * when *every* entry is known-unsupported (e.g. a PDF-only drag).
 * The drop extension uses the boolean to drive the three-state
 * `setDropActive` accept / reject ring during drag — the first
 * branch the JS world has ever had into per-item MIME during drag
 * inside WKWebView. See `tugapp/Sources/Drag/PasteboardSnapshot.swift`.
 */
function nativeDragHasSupportedFile(
  entries: readonly NativeDragFileEntry[],
): boolean {
  if (entries.length === 0) return false;
  for (const entry of entries) {
    const mime = entry.mimeType;
    if (mime === undefined || mime === "") {
      // Missing MIME — could still be text by extension. Optimistic
      // accept; drop-time classifier does the final filtering.
      return true;
    }
    if (classifySourceMime(mime) !== "unsupported") return true;
    if (isTextMimeType(mime)) return true;
  }
  return false;
}

/**
 * Mint a stable atom id for a freshly-dropped or freshly-pasted
 * file. UUIDs are the right shape (large keyspace, no coordination,
 * no collisions across cards or sessions). Defensive `??` covers
 * vanishingly unlikely future engines without `crypto.randomUUID`.
 */
function mintAtomId(): string {
  return typeof crypto !== "undefined"
    && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `atom-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Per-file classification result. `kind === "skeleton"` means the
 * file can produce an atom + bytes (after async processing); the
 * skeleton atom is inserted synchronously and bytes land later.
 * Unsupported files don't reach this classifier in pure-unsupported
 * drags (rejected at `dragover` per Step 3.5.2) and are silently
 * skipped in mixed drops — they never appear in the output array.
 */
type ClassifiedDrop =
  | {
      kind: "skeleton-image";
      file: File;
      atom: AtomSegment;
    }
  | {
      kind: "skeleton-text";
      file: File;
      atom: AtomSegment;
    };

/**
 * Synchronously decide what each file should become. Returns a flat
 * array — image / text classifications mint atom ids and build the
 * skeleton atom right here so the caller can immediately insert
 * placeholders into the doc.
 *
 * The classification has three branches: image → text → silent-skip.
 * In WKWebView all file drags are cursor-accepted (WebKit redacts
 * per-item MIME during drag — see `dropHasSupportedFile`), so any
 * unsupported file reaches this classifier even for pure-unsupported
 * drops. The drop handler's call to `dropHasSupportedFile` refuses
 * pure-unsupported drops before this classifier runs; what reaches
 * here is either fully-supported drops or mixed drops where some
 * subset is unsupported. The classifier silently drops unsupported
 * entries from the output — the supported subset still processes.
 * No banner: the user already saw the copy cursor, so a banner on
 * top would be jarring; the missing chip is the signal.
 *
 * When Step 3.5.7's native bridge lands, cursor-level rejection
 * comes back and pure-unsupported drops never reach this code path.
 */
function classifyDroppedFiles(files: readonly File[]): ClassifiedDrop[] {
  const out: ClassifiedDrop[] = [];
  for (const file of files) {
    // Branch 1: image (png / jpeg / gif / webp / heic / heif / avif
    // and svg via rasterization).
    const cls = classifySourceMime(file.type);
    if (cls !== "unsupported") {
      out.push({
        kind: "skeleton-image",
        file,
        atom: {
          kind: "atom",
          type: "image",
          label: file.name,
          value: file.name,
          id: mintAtomId(),
        },
      });
      continue;
    }
    // Branch 2: text — `text/*`, known `application/*` text MIMEs,
    // or empty MIME with a text-allowlisted extension.
    if (isTextSource(file)) {
      out.push({
        kind: "skeleton-text",
        file,
        atom: {
          kind: "atom",
          type: "file",
          label: file.name,
          value: file.name,
          id: mintAtomId(),
        },
      });
      continue;
    }
    // Branch 3: unsupported. Silently drop — the dragover gate
    // already refused all-unsupported drags; this branch only
    // matters for mixed drops where the supported subset still
    // processes. Per [D02](roadmap/tide-atoms.md#d02-image-attach-text-rest)
    // and Step 3.5.2.
  }
  return out;
}

/**
 * Convert user-dropped or user-pasted files into atoms — instant
 * skeleton insertion at the drop position, then async byte-fill in
 * the background.
 *
 * The synchronous half:
 *  1. Classify each file (image / text / reject).
 *  2. Reject branch immediately publishes its banner message; no
 *     atom is inserted (per [D02]).
 *  3. Image / text branches mint UUIDs, build skeleton atoms with
 *     the id set but NO bytes-store entry yet. The atom widget's
 *     `toDOM` queries the bytes-store via `atomBytesStoreFacet`,
 *     finds no entry, and renders in the pending appearance
 *     (dimmed + pulsing) — instant feedback at the drop point.
 *  4. `insertAtomsAt` dispatches all skeleton atoms in one
 *     transaction. The user sees them appear at the drop point
 *     synchronously.
 *
 * The asynchronous half runs in the background, one job per
 * skeleton atom:
 *  - Image: `downsampleImage(file)` → on success, `bytesStore.put`
 *    populates the entry; the bytes-store's `subscribe` notification
 *    fires `syncPendingAttributes`, which mutates the atom widget's
 *    `data-pending` attribute off via direct DOM. On failure,
 *    `removeAtomById` deletes the skeleton atom and the error
 *    surfaces via `onError`.
 *  - Text: same shape with `readTextAttachment`.
 *
 * The view's liveness is checked through `view.dom.isConnected`
 * before dispatching the failure-path deletion — if the editor
 * unmounted while we were processing, the deletion is suppressed
 * (the doc is gone anyway).
 *
 * Returns `void` synchronously; the async work is fire-and-forget.
 * Callers don't need to `await`.
 *
 * Exported so the paste handler in `clipboard-filters.ts` can share
 * the same pipeline.
 */
export function processAttachmentFiles(
  view: EditorView,
  files: readonly File[],
  insertPos: number,
  bytesStore: AtomBytesStore,
  onError: (message: string) => void,
): void {
  if (files.length === 0) return;

  // Step 1 — synchronous classification. Unsupported files have
  // already been rejected at `dragover` (Step 3.5.2); only the
  // mixed-drop case (supported + unsupported in one drag) might
  // contain unsupported entries that the classifier silently
  // drops. Either way, the returned list contains only skeleton
  // entries.
  const skeletons = classifyDroppedFiles(files);
  if (skeletons.length === 0) return;

  // Step 2 — synchronous skeleton atom insertion. Atoms appear at
  // the drop point immediately; the pending appearance signals
  // that async byte-fill is still running.
  const skeletonAtoms: AtomSegment[] = skeletons.map((s) => s.atom);
  insertAtomsAt(view, insertPos, skeletonAtoms);

  // Step 3.5.5 — fix for "skeleton sometimes fails to appear in a
  // brand-new empty editor". When the user drops a file before
  // having clicked into the editor (the common case on a freshly-
  // opened card), the editor isn't focused and CM6 may not have
  // run its initial measure pass — the widget gets minted in the
  // decoration set but the layout doesn't paint it. Force both:
  //
  //  - `view.focus()` puts DOM focus on `contentDOM` so the
  //    editor becomes the active responder. Idempotent when
  //    already focused.
  //  - `view.requestMeasure(...)` queues a measure pass that
  //    triggers the widget's `toDOM` and a layout flush, ensuring
  //    the chip paints in the same frame as the insertion.
  //
  // Both calls are no-ops in the common case (already-focused +
  // already-measured editor); they only matter for the
  // empty-editor drop path the v1 design missed.
  view.focus();
  view.requestMeasure({ read: () => null });

  // Step 3 — fire-and-forget async byte-fill, one job per skeleton.
  // Each job is independent; failures don't poison siblings.
  for (const skeleton of skeletons) {
    void runAttachmentJob(view, skeleton, bytesStore, onError);
  }
}

/**
 * Run the async half of a single attachment job. Populates the
 * bytes-store on success (which notifies the pending-sync plugin
 * → the atom widget transitions out of pending appearance), or
 * removes the skeleton atom on failure (which surfaces via
 * `onError` in the same call).
 *
 * Defensive try / catch around the await: a synchronous throw from
 * `downsampleImage` / `readTextAttachment` would otherwise reject
 * the spawning Promise unhandled. Wrap so the user gets a clean
 * banner message and the skeleton atom is cleaned up.
 */
async function runAttachmentJob(
  view: EditorView,
  job:
    | { kind: "skeleton-image"; file: File; atom: AtomSegment }
    | { kind: "skeleton-text"; file: File; atom: AtomSegment },
  bytesStore: AtomBytesStore,
  onError: (message: string) => void,
): Promise<void> {
  const id = job.atom.id;
  // Defensive — every skeleton path mints an id; this branch is
  // unreachable at runtime but keeps TypeScript honest about the
  // optional field.
  if (id === undefined) return;

  try {
    if (job.kind === "skeleton-image") {
      const outcome = await downsampleImage(job.file);
      if (!outcome.ok) {
        // Remove skeleton, surface error.
        if (view.dom.isConnected) removeAtomById(view, id);
        onError(describeDownsampleError(outcome.error, job.file.name));
        return;
      }
      bytesStore.put(id, {
        content: outcome.result.content,
        mediaType: outcome.result.mediaType,
        // Carry the downsample pipeline's already-baked thumbnail
        // through to the bytes-store so the post-submit synthesizer
        // sees a fully-populated entry and doesn't re-bake. Per
        // [Step 5c](roadmap/tide-atoms.md#step-5c) — Step 6's strip
        // renderer reads `thumbnailDataUrl` unconditionally.
        thumbnailDataUrl: outcome.result.thumbnailDataUrl,
      });
      return;
    }
    // job.kind === "skeleton-text"
    const outcome = await readTextAttachment(job.file);
    if (!outcome.ok) {
      if (view.dom.isConnected) removeAtomById(view, id);
      onError(describeTextAttachmentError(outcome.error, job.file.name));
      return;
    }
    bytesStore.put(id, {
      content: outcome.result.content,
      mediaType: outcome.result.mediaType,
    });
  } catch (err) {
    // Pipeline threw — surface generically, remove the skeleton.
    if (view.dom.isConnected) removeAtomById(view, id);
    const reason = err instanceof Error ? err.message : "unknown error";
    onError(`Attachment processing failed: ${job.file.name} (${reason})`);
  }
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

/**
 * Drop-active state. Three-valued, written to `data-drop-active`
 * on the host wrapper:
 *
 *  - `null`    — no drag in progress; attribute absent.
 *  - `"accept"` — drag contains at least one supported item; the
 *                editor will accept the drop. Border ring paints in
 *                the standard drop color.
 *  - `"reject"` — drag is over the editor but contains no supported
 *                items (e.g., a PDF dragged from Finder). The
 *                editor refuses the drop; border ring paints in
 *                the danger color so the user sees the rejection
 *                visually in addition to the OS no-drop cursor.
 *
 * Per Step 3.5.2 (and the post-3.5 cursor / border regression
 * fix). The "reject" variant was added because v1 silently hid the
 * border for unsupported drags, leaving the user with no signal
 * that their drag was even seen.
 */
type DropActiveState = "accept" | "reject" | null;

/**
 * Decide the drag outcome for the current `dragenter` / `dragover`
 * event by consulting the native bridge first, with the pre-3.5.7
 * accept-all behavior as the fallback when the bridge is absent,
 * empty, or has not yet posted its first snapshot.
 *
 * Returns `"accept"` when the bridge is absent (browser-only dev,
 * tests, or the first dragover frame before
 * `evaluateJavaScript("window.__tugActiveDrag = …")` has run on
 * the JS thread — see the bridge file's docstring for the timing
 * resolution). Returns `"accept"` when the bridge reports at least
 * one supported file. Returns `"accept"` when the bridge reports an
 * empty `files: []` array — the native side captures that shape only
 * when no file URLs were on the pasteboard at all (today it returns
 * null instead, but the JS reader is defensive in case a future
 * Swift-side change emits an empty array; treating it as accept
 * keeps the fallback identical to "no bridge data available" and
 * lets drop-time classification do the final filtering).
 *
 * Returns `"reject"` only when the bridge reports a non-empty list
 * of which *every* entry is known-unsupported — the cursor-level
 * rejection case that this step exists to enable.
 *
 * Exported for `__tests__/tug-text-editor-drop-bridge.test.ts` which
 * stubs `window.__tugActiveDrag` and asserts each branch.
 */
export function dragOutcomeFromBridge(): "accept" | "reject" {
  const files = getCurrentDragFiles();
  if (files === null) return "accept";
  if (files.length === 0) return "accept";
  return nativeDragHasSupportedFile(files) ? "accept" : "reject";
}

/**
 * Mark/clear the host's `data-drop-active` attribute. The CSS in
 * `tug-text-editor.css` keys the drop ring, caret-hide, and inactive-
 * selection-paint rules off this attribute presence; an additional
 * `[data-drop-active="reject"]` rule overrides the ring color for
 * the rejection variant.
 *
 * Idempotent — checking before mutating avoids redundant attribute
 * writes that would re-trigger MutationObservers (none today, but
 * cheap insurance).
 */
function setDropActive(host: HTMLElement | null, state: DropActiveState): void {
  if (host === null) return;
  const current = host.getAttribute("data-drop-active");
  if (state === null) {
    if (current !== null) host.removeAttribute("data-drop-active");
    return;
  }
  if (current !== state) {
    host.setAttribute("data-drop-active", state);
  }
}

/**
 * Build the drop-handling extension.
 *
 * `host` is the `tug-text-editor` wrapper `<div>` rendered by `TugTextEditor`.
 * The drop pipeline writes the `data-drop-active` attribute on
 * this element so the CSS rules in `tug-text-editor.css` can paint the
 * drop ring, hide the regular caret, and switch the selection
 * overlay to the inactive variant — all while a drag is in
 * progress, restored to the pre-drag appearance the moment the
 * drag ends (drop / dragleave-out / dragend).
 *
 * `getDropHandler` is a thunk so the React shell can mirror its
 * `dropHandler` prop into a ref and pass a closure that reads the
 * ref at fire time — same [L07] pattern the keymap and completion
 * extensions use. Returns `null` to opt into the default
 * extension-based file→atom conversion.
 *
 * `getBytesStore` and `onAttachmentError` are the bytes-store-aware
 * additions (Step 2 of `roadmap/tide-atoms.md`). When `getBytesStore`
 * returns a live `AtomBytesStore`, the drop pipeline runs through
 * the async `processAttachmentFiles` path: image files are
 * downsampled, given a stable UUID, and stashed in the store; the
 * resulting atoms carry the id. When `getBytesStore` returns `null`
 * (gallery cards, prompt-entry instances unrelated to a tide
 * session), the legacy synchronous `defaultFilesToAtoms` path runs
 * — image atoms come back with `value: filename` and no bytes,
 * exactly as before.
 *
 * `onAttachmentError(message)` publishes a downsample-rejection
 * message to the host's banner channel. Routes to
 * `CodeSessionStore.publishAttachmentError` in production; tests can
 * pass a spy.
 *
 * A host-supplied `getDropHandler()` still wins over the default —
 * the gallery card uses that escape hatch to inject deterministic
 * test atoms. When both `getBytesStore()` and `getDropHandler()` are
 * non-null, the custom handler takes precedence and no async
 * processing happens.
 *
 * The DOM event handlers attach to `view.contentDOM` via
 * `EditorView.domEventHandlers`. Drag events on the scroller
 * padding (the gap between contentDOM and scrollDOM) bubble up
 * through contentDOM in WebKit, so this is sufficient coverage —
 * users dropping on the visible editor area always reach the
 * handlers.
 *
 * Returns an array of extensions (StateField + ViewPlugin + theme +
 * event handlers) so the consumer doesn't have to know the
 * internal pieces.
 */
export function tugDropExtension(
  host: HTMLElement | null,
  getDropHandler: () => DropHandler | null,
  getBytesStore: () => AtomBytesStore | null = () => null,
  onAttachmentError: (message: string) => void = () => undefined,
): Extension {
  return [
    tugDropCaretField,
    tugDropCaretPlugin,
    tugDropCaretTheme,
    EditorView.domEventHandlers({
      dragenter(event, _view) {
        // Only claim file drags. Keyboard-driven or application-
        // specific drags pass through.
        if (!event.dataTransfer?.types.includes("Files")) return false;
        // Claim the event so CM6's internal drag handler doesn't
        // also try to accept it with `dropEffect = "copy"` (which
        // would be redundant but defensive in case CM6's behavior
        // changes).
        event.preventDefault();
        setDropActive(host, dragOutcomeFromBridge());
        return true;
      },
      dragover(event, view) {
        if (!event.dataTransfer?.types.includes("Files")) return false;
        event.preventDefault();
        const outcome = dragOutcomeFromBridge();
        setDropActive(host, outcome);
        try {
          // `dropEffect = "none"` is the AppKit no-drop signal — the
          // OS paints the standard refused-drag cursor (no green
          // plus). `"copy"` is the accept cursor. WebKit honors
          // both inside WKWebView; in browser-only dev paths where
          // the bridge is absent, `outcome` defaults to `"accept"`
          // and we set `"copy"` — same Path A behavior as before.
          event.dataTransfer.dropEffect = outcome === "reject" ? "none" : "copy";
        } catch {
          // `dropEffect` is read-only in some environments.
        }

        // Update the drop-caret StateField. Only show the caret on
        // accept — a reject drag has no destination position to
        // indicate, and showing a caret would suggest the drop
        // would land somewhere.
        const pos = outcome === "reject"
          ? null
          : dropOffsetAtCoords(view, event.clientX, event.clientY);
        if (view.state.field(tugDropCaretField) !== pos) {
          view.dispatch({ effects: setTugDropCaretPos.of(pos) });
        }
        return true;
      },
      dragleave(event, view) {
        // Only hide when the cursor truly exits the editor — a
        // dragleave fires for every internal element-to-element
        // crossing too. `relatedTarget` names the element being
        // entered; if it's inside contentDOM, the drag is still
        // over the editor.
        const related = event.relatedTarget as Node | null;
        if (related !== null && view.contentDOM.contains(related)) {
          return false;
        }
        setDropActive(host, null);
        if (view.state.field(tugDropCaretField) !== null) {
          view.dispatch({ effects: setTugDropCaretPos.of(null) });
        }
        return false;
      },
      dragend(_event, view) {
        setDropActive(host, null);
        if (view.state.field(tugDropCaretField) !== null) {
          view.dispatch({ effects: setTugDropCaretPos.of(null) });
        }
        return false;
      },
      drop(event, view) {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) {
          // No files — clear the caret if a previous dragover
          // left one up, then bail without preventDefault so the
          // browser handles the (non-file) drop natively.
          setDropActive(host, null);
          if (view.state.field(tugDropCaretField) !== null) {
            view.dispatch({ effects: setTugDropCaretPos.of(null) });
          }
          return false;
        }

        // At drop time `dataTransfer.files` is fully populated with
        // real MIME info — this is the actual supportedness check
        // (the dragenter/dragover check was binary "is a file drag"
        // only, per WebKit's redaction). If every file in the drop
        // is unsupported, refuse silently: the user already saw the
        // copy cursor, so a banner on top would be jarring. The
        // missing chip is the signal.
        if (!dropHasSupportedFile(event.dataTransfer ?? null)) {
          event.preventDefault();
          setDropActive(host, null);
          if (view.state.field(tugDropCaretField) !== null) {
            view.dispatch({ effects: setTugDropCaretPos.of(null) });
          }
          return true;
        }

        // Suppress the WebView's default file-URL navigation. Done
        // first so even an early `return` below leaves the page
        // intact.
        event.preventDefault();
        setDropActive(host, null);

        const pos = dropOffsetAtCoords(view, event.clientX, event.clientY);
        const insertPos = pos !== null ? pos : view.state.doc.length;

        // Custom host-supplied handler wins — gallery cards use this
        // to inject deterministic test atoms without going through
        // the downsample path.
        const handler = getDropHandler();
        if (handler !== null) {
          const atoms = handler(files);
          if (atoms.length === 0) {
            if (view.state.field(tugDropCaretField) !== null) {
              view.dispatch({ effects: setTugDropCaretPos.of(null) });
            }
            return true;
          }
          insertAtomsAt(view, insertPos, atoms);
          return true;
        }

        // Hide the drop caret synchronously — the async pipeline
        // will dispatch its own insertion transaction once
        // processing completes, but the user already let go of the
        // drag and the caret should track that.
        if (view.state.field(tugDropCaretField) !== null) {
          view.dispatch({ effects: setTugDropCaretPos.of(null) });
        }

        const bytesStore = getBytesStore();
        if (bytesStore === null) {
          // No bytes-store — fall back to the legacy synchronous
          // default. Image atoms come back with no bytes; this
          // matches the pre-Step-2 behavior for hosts that don't
          // participate in attachment bytes (gallery card without
          // a custom handler, future detached prompt-entries).
          const atoms = defaultFilesToAtoms(files);
          if (atoms.length === 0) return true;
          insertAtomsAt(view, insertPos, atoms);
          return true;
        }

        // Bytes-store-aware path: synchronously classifies files,
        // inserts skeleton atoms at the drop point for image / text
        // sources, and spawns fire-and-forget async byte-fill jobs.
        // Unsupported files (PDF / archive / audio / video) surface
        // via `onAttachmentError` instead of inserting a chip.
        processAttachmentFiles(
          view,
          Array.from(files),
          insertPos,
          bytesStore,
          onAttachmentError,
        );
        return true;
      },
    }),
  ];
}
