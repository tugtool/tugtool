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
 *      cursor shows the copy-cursor variant. The editor accepts
 *      every file drag — there is no cursor-level rejection — so
 *      we don't need to look at per-file MIME information at this
 *      stage.
 *
 *   3. **`drop` insertion.** `preventDefault()` to suppress the
 *      WebView's default navigate-to-file-URL behavior, then a
 *      single transaction inserts each dropped file into the
 *      editor. Files with image extensions (png / jpg / jpeg /
 *      gif / svg / webp) become atoms (image chips routed through
 *      the downsample pipeline when a bytes-store is available);
 *      every other file inserts its basename as plain text. Mixed
 *      drops interleave the two with single-space separators, all
 *      in one CM6 transaction.
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
  downsampleImage,
  type DownsampleError,
} from "@/lib/image-downsample";
import type { AtomBytesStore } from "@/lib/atom-bytes-store";

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
// Drop classification — image vs filename text
// ---------------------------------------------------------------------------

/**
 * Decide whether a file should render as an image atom (chip) or
 * insert its basename as plain text. Extension-based: anything with
 * a recognized image extension (png / jpg / jpeg / gif / svg / webp)
 * becomes an atom; everything else becomes filename text.
 *
 * Extension-based on purpose. Inline atom-chip support is images-only
 * (the downsample pipeline only handles raster + svg). Non-image
 * basenames as plain text fall through to the regular text channel
 * without any chip machinery — the model just reads the literal name
 * in the user's message.
 */
function isImageFile(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return IMG_EXTS.has(ext);
}

/**
 * One item in the mixed-drop insertion plan. An `atom` item carries
 * an `AtomSegment` that lands at a `U+FFFC` placeholder in the doc;
 * a `text` item inserts a literal substring (currently used for the
 * basename of non-image dropped files).
 */
type DropMixedItem =
  | { kind: "atom"; segment: AtomSegment }
  | { kind: "text"; text: string };

/**
 * Default no-bytes-store path: convert a `FileList` into a flat list
 * of mixed items, one per file in order. Image-extension files
 * become atom items (no `id`, no bytes — the downsample pipeline
 * only runs in the bytes-store-aware path); everything else becomes
 * a text item carrying the basename.
 *
 * Used by gallery cards / standalone harness where no
 * `AtomBytesStore` is wired. The bytes-store-aware path (the live
 * editor) routes through `processAttachmentFiles` which builds the
 * same item shape but also mints atom ids and starts async
 * byte-fill jobs.
 */
function defaultFilesToMixedItems(files: FileList): DropMixedItem[] {
  const out: DropMixedItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    if (isImageFile(f)) {
      out.push({
        kind: "atom",
        segment: { kind: "atom", type: "image", label: f.name, value: f.name },
      });
    } else {
      out.push({ kind: "text", text: f.name });
    }
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
 * Thin wrapper over {@link insertMixedAt} for the custom-host-handler
 * path, whose `DropHandler` contract returns `AtomSegment[]` directly.
 * Exported so tests can drive the insertion without a `DragEvent`.
 */
export function insertAtomsAt(
  view: EditorView,
  pos: number,
  atoms: readonly AtomSegment[],
): void {
  insertMixedAt(
    view,
    pos,
    atoms.map((segment) => ({ kind: "atom", segment })),
  );
}

/**
 * Dispatch a single transaction inserting a mix of atom + text items
 * at `pos`. Items are joined with a single space; each atom takes
 * one `U+FFFC` placeholder paired with an `addAtomsEffect` entry at
 * the corresponding position, and each text item inserts its literal
 * substring verbatim.
 *
 * Selection lands immediately after the last inserted character — the
 * same end-of-insert convention `insertAtomsAt` used in the
 * atoms-only era. Hides the drop caret in the same transaction.
 *
 * Used by the bytes-store-aware path (`processAttachmentFiles`) and
 * the no-bytes-store default path. The atoms-only `insertAtomsAt`
 * wrapper feeds through here too, so multi-image drops also pick up
 * single-space separators between chips.
 */
function insertMixedAt(
  view: EditorView,
  pos: number,
  items: readonly DropMixedItem[],
): void {
  if (items.length === 0) return;
  let insert = "";
  const positioned: Array<{ position: number; segment: AtomSegment }> = [];
  for (let i = 0; i < items.length; i += 1) {
    if (i > 0) insert += " ";
    const item = items[i]!;
    if (item.kind === "atom") {
      positioned.push({ position: pos + insert.length, segment: item.segment });
      insert += TUG_ATOM_CHAR;
    } else {
      insert += item.text;
    }
  }
  view.dispatch({
    changes: { from: pos, insert },
    effects: [
      addAtomsEffect.of(positioned),
      // Hide the drop caret in the same transaction as the
      // insertion — atomic from the user's perspective.
      setTugDropCaretPos.of(null),
    ],
    selection: { anchor: pos + insert.length },
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
 * (`roadmap/dev-atoms.md#t01-failure-modes`).
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
 * Per-file classification result. `kind === "skeleton-image"` means
 * the file has an image extension and will produce an atom + bytes
 * (after async downsample); the skeleton atom is inserted
 * synchronously and bytes land later. `kind === "filename-text"`
 * means the file is non-image and its basename will land as plain
 * text in the same insertion transaction.
 */
type ClassifiedDrop =
  | { kind: "skeleton-image"; file: File; atom: AtomSegment }
  | { kind: "filename-text"; text: string };

/**
 * Synchronously decide what each file should become. Image-extension
 * files mint an atom id and build the skeleton atom here so the
 * caller can insert it immediately; non-image files emit a text
 * entry carrying the basename so the same insertion transaction can
 * splice it into the doc verbatim.
 *
 * Order is preserved — caller can flatten this list to mixed-item
 * shape and feed it straight to {@link insertMixedAt}.
 */
function classifyDroppedFiles(files: readonly File[]): ClassifiedDrop[] {
  const out: ClassifiedDrop[] = [];
  for (const file of files) {
    if (isImageFile(file)) {
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
    } else {
      out.push({ kind: "filename-text", text: file.name });
    }
  }
  return out;
}

/**
 * Convert user-dropped or user-pasted files into atoms + filename
 * text — instant skeleton insertion at the drop position, then async
 * byte-fill in the background for the image entries.
 *
 * The synchronous half:
 *  1. Classify each file. Image extensions become skeleton-image
 *     entries (mint id, build atom segment); everything else
 *     becomes a filename-text entry carrying the basename.
 *  2. Flatten to {@link DropMixedItem}s and dispatch one transaction
 *     via {@link insertMixedAt}: each image takes one `U+FFFC`
 *     paired with the skeleton atom; each non-image takes its
 *     basename verbatim; consecutive items are joined with a single
 *     space. The user sees the full mixed insertion at the drop
 *     point synchronously.
 *
 * The asynchronous half runs in the background, one job per
 * skeleton-image entry. Filename-text entries have no async work —
 * they're plain prose in the doc once the transaction commits.
 *  - Image: `downsampleImage(file)` → on success, `bytesStore.put`
 *    populates the entry; the bytes-store's `subscribe` notification
 *    fires `syncPendingAttributes`, which mutates the atom widget's
 *    `data-pending` attribute off via direct DOM. On failure,
 *    `removeAtomById` deletes the skeleton atom and the error
 *    surfaces via `onError`.
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

  // Step 1 — synchronous classification. Image-extension files yield
  // skeleton-image entries; everything else yields filename-text.
  const classified = classifyDroppedFiles(files);
  if (classified.length === 0) return;

  // Step 2 — flatten to mixed items + one-transaction insert. Atoms
  // and text interleave in input order with single-space separators.
  const items: DropMixedItem[] = classified.map((entry) =>
    entry.kind === "skeleton-image"
      ? { kind: "atom" as const, segment: entry.atom }
      : { kind: "text" as const, text: entry.text },
  );
  insertMixedAt(view, insertPos, items);

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

  // Step 3 — fire-and-forget async byte-fill, one job per
  // skeleton-image entry. Filename-text entries have no async work.
  for (const entry of classified) {
    if (entry.kind === "skeleton-image") {
      void runAttachmentJob(view, entry, bytesStore, onError);
    }
  }
}

/**
 * Run the async half of a single attachment job. Downsamples the
 * image and populates the bytes-store on success (which notifies
 * the pending-sync plugin → the atom widget transitions out of
 * pending appearance), or removes the skeleton atom on failure
 * (which surfaces via `onError` in the same call).
 *
 * Defensive try / catch around the await: a synchronous throw from
 * `downsampleImage` would otherwise reject the spawning Promise
 * unhandled. Wrap so the user gets a clean banner message and the
 * skeleton atom is cleaned up.
 */
async function runAttachmentJob(
  view: EditorView,
  job: { kind: "skeleton-image"; file: File; atom: AtomSegment },
  bytesStore: AtomBytesStore,
  onError: (message: string) => void,
): Promise<void> {
  const id = job.atom.id;
  // Defensive — every skeleton path mints an id; this branch is
  // unreachable at runtime but keeps TypeScript honest about the
  // optional field.
  if (id === undefined) return;

  try {
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
      // [Step 5c](roadmap/dev-atoms.md#step-5c) — Step 6's strip
      // renderer reads `thumbnailDataUrl` unconditionally.
      thumbnailDataUrl: outcome.result.thumbnailDataUrl,
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
 * Drop-active state. Two-valued, written to `data-drop-active` on
 * the host wrapper:
 *
 *  - `null`     — no drag in progress; attribute absent.
 *  - `"accept"` — drag is over the editor; the drop will be accepted.
 *                Border ring paints in the standard drop color.
 *
 * The editor accepts every file drag — there is no cursor-level
 * rejection. Image-extension files become atoms; everything else
 * inserts as filename text. So the only state distinction during
 * drag is "drag in progress" vs not, and `null` / `"accept"` is
 * enough.
 */
type DropActiveState = "accept" | null;

/**
 * Mark/clear the host's `data-drop-active` attribute. The CSS in
 * `tug-text-editor.css` keys the drop ring, caret-hide, and inactive-
 * selection-paint rules off this attribute presence.
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
 * additions (Step 2 of `roadmap/dev-atoms.md`). When `getBytesStore`
 * returns a live `AtomBytesStore`, the drop pipeline runs through
 * the async `processAttachmentFiles` path: image-extension files are
 * downsampled, given a stable UUID, and stashed in the store; the
 * resulting atoms carry the id. Non-image files insert their
 * basename as plain text in the same transaction. When `getBytesStore`
 * returns `null` (gallery cards, prompt-entry instances unrelated to
 * a tide session), the synchronous `defaultFilesToMixedItems` path
 * runs — image atoms come back with `value: filename` and no bytes;
 * non-image entries still ride as filename text.
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
        setDropActive(host, "accept");
        return true;
      },
      dragover(event, view) {
        if (!event.dataTransfer?.types.includes("Files")) return false;
        event.preventDefault();
        setDropActive(host, "accept");
        try {
          // `"copy"` is the standard accept cursor. The editor accepts
          // every file drag — images become atoms, everything else
          // inserts as filename text — so there is no reject branch
          // here.
          event.dataTransfer.dropEffect = "copy";
        } catch {
          // `dropEffect` is read-only in some environments.
        }

        const pos = dropOffsetAtCoords(view, event.clientX, event.clientY);
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
          // No bytes-store — fall back to the synchronous default.
          // Image atoms come back with no bytes; non-image files
          // ride as plain filename text. Used by gallery cards and
          // future detached prompt-entries that don't participate
          // in attachment bytes.
          const items = defaultFilesToMixedItems(files);
          if (items.length === 0) return true;
          insertMixedAt(view, insertPos, items);
          return true;
        }

        // Bytes-store-aware path: synchronously classifies files,
        // inserts skeleton atoms + filename text at the drop point,
        // and spawns fire-and-forget async byte-fill jobs for the
        // image entries. Non-image files arrive in the same
        // transaction as plain filename prose.
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
