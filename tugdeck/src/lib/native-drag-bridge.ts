/**
 * tug-native-drag-bridge — native drag-snapshot bridge for Tug.app (WKWebView).
 *
 * ## Why this exists
 *
 * WKWebView's JavaScript layer cannot see per-item MIME info during
 * `dragenter` / `dragover` events for cross-origin file drags from
 * Finder — a long-standing WebKit limitation tracked as
 * [WebKit bug #223517](https://bugs.webkit.org/show_bug.cgi?id=223517)
 * (unresolved as of December 2023). `DataTransfer.types` carries the
 * single entry `"Files"` and `DataTransfer.items.length` is `0` until
 * the user actually releases — at which point the full file metadata
 * appears, but the chance to refuse with a cursor-level no-drop ring
 * is gone.
 *
 * The native host of Tug.app (Swift `TugWebView` subclass + an
 * `NSDraggingDestination` snoop) sits outside the WebContent sandbox
 * and *can* read `NSPasteboard` freely. It serializes the resolved
 * file metadata (name, MIME type, size) into a JSON snapshot and
 * pushes it into JS via `evaluateJavaScript("window.__tugActiveDrag = …")`
 * on every `draggingEntered:` / `draggingUpdated:`. On
 * `draggingExited:` / `concludeDragOperation:` it clears the global
 * back to `null`. This module wraps the global in a typed reader so
 * the drop extension can drive the three-state `setDropActive`
 * accept / reject ring against real MIME data — restoring the
 * cursor-level rejection UX that Step 3.5.2 originally targeted.
 *
 * ## Timing
 *
 * `WKWebView.evaluateJavaScript` is asynchronous: the assignment is
 * queued on the WebContent runloop, not executed inline. The OS
 * dispatches drag events through the WebView synchronously — the
 * native `draggingEntered:` override runs *before* WebKit synthesizes
 * the JS dragenter event. Even so, the eval-JS task and the
 * synthesized dragenter event both land on the same JS thread, and
 * the task queued first is processed first. In practice:
 *
 *   - The native side calls `evaluateJavaScript("...= …")` *before*
 *     calling `super.draggingEntered`, so the assignment task is
 *     enqueued first.
 *   - The first JS dragenter event after a fresh drag may still race
 *     ahead of the assignment by one tick — readers that find
 *     `null` here should fall through to the
 *     `dataTransfer.types.includes("Files")` legacy path (binary
 *     "is a file drag" signal). That keeps the first-frame UX
 *     identical to pre-3.5.7 always-accept.
 *   - Every subsequent dragover frame sees the snapshot and can
 *     classify accurately.
 *
 * The one-frame race window is the tide-atoms plan's resolution to
 * [Q05](roadmap/tide-atoms.md#q05-bridge-timing). Acceptable for the
 * UX goal — sustained drags spend ≫ 1 frame over the editor, so the
 * reject ring stabilizes well before the user decides whether to
 * release.
 *
 * ## When to use
 *
 * In drag-event handlers that need MIME information during
 * `dragenter` / `dragover` — primarily the prompt-entry's drop
 * extension. Check the return value for `null` and fall through to
 * the legacy types-only signal when the bridge is absent (browser-
 * only development, tests, or the one-frame race described above).
 *
 * The native bridge is a strictly-additive optimization: with it
 * present, unsupported drops show the red reject ring + OS no-drop
 * cursor during drag; without it, the editor falls back to
 * accept-all-and-classify-at-drop (Path A behavior shipped in
 * [Step 3.5.6](roadmap/tide-atoms.md#step-3-5-6)).
 */

/**
 * One dragged file's metadata as resolved by the native side. Shape
 * mirrors `PasteboardSnapshot.FileEntry` in
 * `tugapp/Sources/Drag/PasteboardSnapshot.swift`. All fields land
 * via JSON, so primitive types only.
 */
export interface NativeDragFileEntry {
  /** Last path component (e.g. `"screenshot.png"`). */
  readonly name: string;
  /**
   * Resolved MIME type (e.g. `"image/png"`, `"text/plain"`), or
   * `undefined` when no UTI mapped to a MIME on the native side.
   * The drop extension treats `undefined` the same way it treats an
   * empty `File.type` at drop time: optimistic accept, with
   * extension-allowlist fallback in the final classifier.
   */
  readonly mimeType?: string;
  /**
   * File size in bytes, or `undefined` when the resource value
   * wasn't readable. Not used for supportedness decisions today —
   * captured for future use (oversize-image early reject, etc.).
   */
  readonly size?: number;
}

/**
 * The snapshot shape pushed by the native side into
 * `window.__tugActiveDrag`. A `null` value means "no active drag" —
 * either no drag is in progress, the drag has just ended, or this
 * page is not running inside Tug.app at all.
 */
export interface NativeDragSnapshot {
  readonly files: readonly NativeDragFileEntry[];
}

/**
 * Read the current native drag snapshot. Returns `null` when the
 * native bridge is absent (browser-only development), when no drag
 * is in progress, or when the snapshot has been cleared by
 * `draggingExited:` / `concludeDragOperation:` on the native side.
 *
 * The native side guarantees the global is either `null` or a valid
 * `{ files: [...] }` object — but defensive shape checks here guard
 * against a malformed assignment (e.g. a test-injected stub or a
 * future Swift-side bug) producing a runtime exception in the drop
 * extension's hot path.
 */
export function getNativeDragSnapshot(): NativeDragSnapshot | null {
  const raw = (globalThis as { __tugActiveDrag?: unknown }).__tugActiveDrag;
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return null;
  const candidate = raw as { files?: unknown };
  if (!Array.isArray(candidate.files)) return null;
  const files: NativeDragFileEntry[] = [];
  for (const entry of candidate.files) {
    if (entry === null || typeof entry !== "object") continue;
    const fileCandidate = entry as { name?: unknown; mimeType?: unknown; size?: unknown };
    if (typeof fileCandidate.name !== "string") continue;
    const file: NativeDragFileEntry = {
      name: fileCandidate.name,
      mimeType: typeof fileCandidate.mimeType === "string" ? fileCandidate.mimeType : undefined,
      size: typeof fileCandidate.size === "number" ? fileCandidate.size : undefined,
    };
    files.push(file);
  }
  return { files };
}

/**
 * Convenience accessor — returns the `files` array directly, or
 * `null` if no snapshot is available. Equivalent to
 * `getNativeDragSnapshot()?.files ?? null`, but keeps the call
 * site terse at the drop-extension reader.
 */
export function getCurrentDragFiles(): readonly NativeDragFileEntry[] | null {
  return getNativeDragSnapshot()?.files ?? null;
}
