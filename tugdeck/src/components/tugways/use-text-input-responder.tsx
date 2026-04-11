/**
 * useTextInputResponder — shared responder wiring for native text inputs.
 *
 * Encapsulates the six standard editing actions (`cut`, `copy`, `paste`,
 * `selectAll`, `undo`, `redo`), a right-click `TugEditorContextMenu`,
 * and responder-node registration for a single `<input>` or
 * `<textarea>` DOM element. One source of truth for every native text
 * input in the tugways suite — tug-input, tug-textarea, and
 * tug-value-input all consume this hook.
 *
 * Why one hook and not three copies:
 *
 * - All three components touch the exact same browser editing APIs
 *   (`execCommand`, `navigator.clipboard`, `select()`, `setRangeText`).
 * - All three components open the same context menu with the same
 *   items at the same coordinates.
 * - Paste in particular is subtle (see the handler body below) and
 *   any divergence invites Safari-vs-Chrome regressions.
 *
 * ## Action handlers (two-phase)
 *
 * Each handler returns an `ActionHandlerResult` — either `void` or a
 * continuation callback. The sync body runs inside the dispatching
 * user gesture; the continuation runs at the caller's commit point
 * (keyboard path = immediately; context menu path = after the ~120ms
 * activation blink). This matches the pattern documented on
 * `responder-chain.ts` and in tug-prompt-input.tsx.
 *
 *   - cut       → sync: `execCommand("copy")` so the selection stays
 *                        visible during the blink
 *                 continuation: `execCommand("delete")` — pushes to
 *                               the native undo stack.
 *   - copy      → sync-only: `execCommand("copy")`.
 *   - paste     → sync: capture clipboard data via the paste event
 *                        (see below); no Clipboard API, no nag.
 *                 continuation: insert the captured data after the
 *                               activation blink.
 *   - selectAll → continuation: `input.select()`.
 *   - undo      → continuation: `execCommand("undo")`.
 *   - redo      → continuation: `execCommand("redo")`.
 *
 * ## Paste — native bridge with browser fallback
 *
 * Goal: no Safari "Paste" permission popup, AND the text insertion
 * happens after the menu item's activation blink (not before).
 *
 * Safari's permission popup fires whenever JavaScript reads the
 * clipboard via the JS-level Clipboard API (`navigator.clipboard.*`)
 * or via `document.execCommand("paste")` on contentEditable. In
 * Safari 16.4+ there is no JavaScript-only code path that reads the
 * clipboard without the popup. The only clean fix in a WKWebView app
 * is to delegate to the native side: Swift reads `NSPasteboard` (no
 * popup, no prompt) and passes the contents back to JavaScript via
 * `evaluateJavaScript`. See `lib/tug-native-clipboard.ts` and
 * `tugapp/Sources/MainWindow.swift` for the bridge implementation.
 *
 * The paste handler therefore branches on `hasNativeClipboardBridge()`:
 *
 *   1. **Native bridge present (Tug.app production).** Kick off
 *      `readClipboardViaNative()` immediately — the promise is created
 *      inside the user gesture so it stays alive across the menu
 *      blink. Return a continuation that awaits the promise and
 *      inserts the resolved text via `setRangeText` after the blink.
 *      Zero clipboard-API calls, zero execCommand calls, zero popup.
 *
 *   2. **No bridge (browser dev / tests).** Fall back to the
 *      "capture the paste event fired by execCommand" pattern:
 *      register a one-time paste listener on `el`, call
 *      `document.execCommand("paste")`, intercept the event to
 *      `preventDefault()` and read `clipboardData`, defer insertion
 *      to the continuation. On browsers where execCommand is blocked
 *      (Chrome), fall through once more to
 *      `navigator.clipboard.readText()` kicked off inside the user
 *      gesture so the read is authorized.
 *
 * In all paths the DOM write lands in the continuation so the user
 * sees the menu item blink first, then the pasted text, matching the
 * order of every other editing action.
 *
 * ## Context menu
 *
 * Right-click on the host element opens a `TugEditorContextMenu`
 * anchored at the cursor with Cut / Copy / Paste / Select All.
 * Cut and Copy are disabled when there is no ranged selection —
 * matching native input behavior where right-click does not
 * auto-select a word. Menu item activation dispatches through the
 * chain; the innermost-first walk routes it right back to the host
 * input and the sync/continuation split described above fires.
 *
 * ## Usage
 *
 * The hook returns a pre-composed `ref`, a pre-bridged
 * `handleContextMenu`, and a ready-to-render `contextMenu` element,
 * so every consumer is the same three-line wire-up:
 *
 * ```tsx
 * const inputRef = useRef<HTMLInputElement | null>(null);
 * const { composedRef, handleContextMenu, contextMenu } =
 *   useTextInputResponder({
 *     inputRef,
 *     disabled,
 *     forwardedRef,           // optional — merged into composedRef
 *     onContextMenu,          // optional — chained after menu opens
 *   });
 *
 * return (
 *   <>
 *     <input
 *       ref={composedRef}
 *       onContextMenu={handleContextMenu}
 *       ...
 *     />
 *     {contextMenu}
 *   </>
 * );
 * ```
 *
 * `composedRef` populates the hook's internal `inputRef`, applies the
 * consumer's `forwardedRef` (function or object form), and writes
 * `data-responder-id` for the chain's first-responder resolution —
 * all in one ref callback. Consumers do not compose refs themselves.
 *
 * Laws: [L06] appearance via CSS/DOM,
 *       [L11] controls emit actions; responders handle actions,
 *       [L19] component authoring guide
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useOptionalResponder } from "./use-responder";
import { useResponderChain } from "./responder-chain-provider";
import type { ActionHandler, ActionHandlerResult } from "./responder-chain";
import { TUG_ACTIONS, type TugAction } from "./action-vocabulary";
import {
  TugEditorContextMenu,
  type TugEditorContextMenuEntry,
} from "./tug-editor-context-menu";
import {
  hasNativeClipboardBridge,
  readClipboardViaNative,
  warnIfWKWebViewRace,
} from "@/lib/tug-native-clipboard";
import {
  type TextSelectionAdapter,
  type NativeInputSelectionAdapterExtras,
  type RightClickClassification,
  findWordBoundaries,
} from "./text-selection-adapter";

// ---- applyPastedText — pure helper ----
//
// The tail of every paste branch (native bridge, execCommand event
// capture, Clipboard API fallback) does the same work: guard against
// the component being unmounted while the async read was in flight,
// guard against the element being detached, capture the current
// selection range, replace it with the pasted text via
// `setRangeText`, and dispatch a synthetic `input` event so
// controlled React inputs stay in sync with the DOM value.
//
// Before extraction, this tail was triplicated across three branches
// in `handlePaste` — three near-identical blocks in one function,
// each with the same mountedRef guard, the same null-input guard,
// the same selectionStart/End capture, the same setRangeText call
// with `"end"` cursor placement, and the same input-event dispatch.
// Extracting it (a) eliminates the duplication, and (b) turns the
// bug-prone half of paste (state: mountedRef, inputRef, selection
// range, event dispatch) into a pure function that can be unit
// tested in happy-dom without any clipboard polyfill at all.
//
// The function is exported so tests can exercise it directly. It is
// not intended for use outside the paste-handler cascade — consumers
// building their own paste should go through the full hook.
export function applyPastedText(
  inputRef: React.MutableRefObject<TextInputLikeElement | null>,
  mountedRef: React.MutableRefObject<boolean>,
  text: string,
): void {
  // Guard against the component unmounting between the async read
  // starting and the continuation running — the input ref may still
  // point at a detached element, and writing to it would be a silent
  // no-op in the browser but a confusing footgun in tests.
  if (!mountedRef.current) return;
  // Empty clipboard (or a native bridge read that resolved with no
  // text / no html payload) is a no-op — don't dispatch a spurious
  // input event for a no-op edit.
  if (!text) return;
  const node = inputRef.current;
  if (!node) return;
  // `selectionStart` / `selectionEnd` can be null on some element
  // states (not all input types are text — `<input type="number">`
  // doesn't expose selection); fall back to "insert at end" in that
  // case, matching native paste behavior when the browser can't
  // resolve a caret.
  const start = node.selectionStart ?? node.value.length;
  const end = node.selectionEnd ?? node.value.length;
  // `"end"` leaves the caret after the inserted text, matching the
  // behavior of a native paste.
  node.setRangeText(text, start, end, "end");
  // Synthetic input event so React's controlled-input bookkeeping
  // picks up the new value via its onChange listener — without this,
  // controlled consumers would see a DOM value that disagrees with
  // their React state until the next keystroke.
  node.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Any DOM element that has an editable text value, caret, and selection. */
export type TextInputLikeElement = HTMLInputElement | HTMLTextAreaElement;

// ---------------------------------------------------------------------------
// createNativeInputAdapter
// ---------------------------------------------------------------------------

/**
 * Factory that wraps a native `<input>` or `<textarea>` element in a
 * `TextSelectionAdapter`.
 *
 * The returned object also satisfies `NativeInputSelectionAdapterExtras`,
 * which exposes `capturePreRightClick()` — call this at `pointerdown` time
 * (when `event.button === 2`) to snapshot the selection before the browser
 * moves the caret. `classifyRightClick` then compares the post-mousedown
 * position against that snapshot.
 *
 * See: [D04] NativeInputSelectionAdapter captures pre-click state via
 * explicit call.
 *
 * @param el  The host `<input>` or `<textarea>` DOM element.
 * @returns   `TextSelectionAdapter & NativeInputSelectionAdapterExtras`
 */
export function createNativeInputAdapter(
  el: TextInputLikeElement,
): TextSelectionAdapter & NativeInputSelectionAdapterExtras {
  // Snapshot of the selection state captured at pointerdown (button === 2).
  // `classifyRightClick` reads this to compare against the post-mousedown
  // browser-placed caret. Initialized to null — `capturePreRightClick`
  // must be called before `classifyRightClick` for a meaningful result.
  let preRightClickStart: number | null = null;
  let preRightClickEnd: number | null = null;

  return {
    /**
     * True when there is a non-collapsed (ranged) selection.
     * Guards against null — `selectionStart`/`selectionEnd` are null on
     * non-text input types (e.g. `<input type="number">`).
     */
    hasRangedSelection(): boolean {
      return (
        el.selectionStart !== null &&
        el.selectionEnd !== null &&
        el.selectionStart !== el.selectionEnd
      );
    },

    /**
     * The currently selected text, or `""` when there is no ranged selection.
     */
    getSelectedText(): string {
      if (!this.hasRangedSelection()) return "";
      return el.value.slice(el.selectionStart!, el.selectionEnd!);
    },

    /** Select all content in the element. */
    selectAll(): void {
      el.select();
    },

    /**
     * Expand the browser-placed caret to word boundaries using
     * `findWordBoundaries`.
     */
    expandToWord(): void {
      const offset = el.selectionStart ?? 0;
      const { start, end } = findWordBoundaries(el.value, offset);
      el.setSelectionRange(start, end);
    },

    /**
     * Capture the pre-right-click selection state.
     *
     * Call this at `pointerdown` time when `event.button === 2`, before the
     * browser's mousedown handler moves the caret. `classifyRightClick`
     * compares the post-mousedown offset against this snapshot.
     */
    capturePreRightClick(): void {
      preRightClickStart = el.selectionStart;
      preRightClickEnd = el.selectionEnd;
    },

    /**
     * Restore the selection range captured by `capturePreRightClick`.
     * No-op if no snapshot was captured.
     */
    restorePreRightClick(): void {
      if (preRightClickStart === null || preRightClickEnd === null) return;
      el.setSelectionRange(preRightClickStart, preRightClickEnd);
    },

    /**
     * Classify a right-click relative to the selection captured at the last
     * `capturePreRightClick()` call.
     *
     * The `clientX`/`clientY`/`proximityThreshold` parameters are unused —
     * native input adapters use offset comparison (exact) rather than geometry.
     *
     * Algorithm:
     *   1. Read the current `selectionStart` (browser-placed after mousedown).
     *   2. If the captured snapshot was collapsed and the new offset matches
     *      either captured boundary → `"near-caret"`.
     *   3. If the captured snapshot was ranged and the new offset falls within
     *      `[capturedStart, capturedEnd)` → `"within-range"`.
     *   4. Otherwise → `"elsewhere"`.
     */
    classifyRightClick(
      _clientX: number,
      _clientY: number,
      _proximityThreshold: number,
    ): RightClickClassification {
      const newOffset = el.selectionStart;
      if (newOffset === null) return "elsewhere";

      const capturedStart = preRightClickStart;
      const capturedEnd = preRightClickEnd;

      // No snapshot — treat as "elsewhere".
      if (capturedStart === null || capturedEnd === null) return "elsewhere";

      const capturedIsCollapsed = capturedStart === capturedEnd;

      if (capturedIsCollapsed) {
        // Case 1: collapsed selection — click is near the caret if the
        // browser placed the new caret within one character of the
        // captured offset. Exact match is too strict — a right-click
        // slightly to the left or right of the caret lands one offset
        // away, and that should still count as "near".
        return Math.abs(newOffset - capturedStart) <= 1 ? "near-caret" : "elsewhere";
      }

      // Case 2: ranged selection — click is within the range if the browser
      // placed the caret inside [capturedStart, capturedEnd).
      if (newOffset >= capturedStart && newOffset < capturedEnd) {
        return "within-range";
      }

      // Case 3: click fell outside the selection.
      return "elsewhere";
    },

    /**
     * The browser already placed the caret via mousedown; call `expandToWord`
     * to extend it to word boundaries.
     *
     * The `clientX`/`clientY` parameters are unused — native inputs do not
     * support `caretPositionFromPoint` geometry for their internal text
     * rendering.
     */
    selectWordAtPoint(_clientX: number, _clientY: number): void {
      this.expandToWord();
    },
  };
}

/** State of the right-click context menu. `null` when closed. */
export interface TextInputContextMenuState {
  x: number;
  y: number;
  hasSelection: boolean;
}

export interface UseTextInputResponderOptions<T extends TextInputLikeElement> {
  /**
   * Ref to the host input/textarea DOM element. The hook reads
   * `selectionStart` / `selectionEnd` on it for context-menu
   * enablement and calls `select()` / `setRangeText()` on it from the
   * handlers. Must be the same element the returned `composedRef`
   * is attached to.
   */
  inputRef: React.MutableRefObject<T | null>;
  /**
   * When true, all handlers short-circuit before touching the DOM and
   * the context menu refuses to open. This is defence-in-depth — a
   * disabled input normally cannot receive focus, but
   * `manager.sendToTarget(id, ...)` can target it directly and must not
   * mutate a disabled field.
   */
  disabled: boolean;
  /**
   * Consumer's forwarded ref (from `React.forwardRef`). When provided,
   * `composedRef` applies it alongside writing the hook's internal
   * `inputRef` and the responder chain's `data-responder-id`. Handles
   * both callback refs and `MutableRefObject` refs. Omit when the
   * caller composes refs itself.
   */
  forwardedRef?: React.Ref<T>;
  /**
   * Consumer's `onContextMenu` handler. The returned
   * `handleContextMenu` opens the right-click menu first and then
   * invokes this callback, so consumers still observe the event for
   * analytics, logging, or additional side effects without breaking
   * the menu. Parameterized on `T` so consumers pass a native
   * `React.MouseEventHandler<HTMLInputElement>` /
   * `HTMLTextAreaElement` without variance conflicts.
   */
  onContextMenu?: (e: React.MouseEvent<T>) => void;
}

export interface UseTextInputResponderResult<T extends TextInputLikeElement> {
  /**
   * Attach to the host input/textarea element. Populates the hook's
   * internal `inputRef`, applies the forwarded consumer ref (if any),
   * and writes `data-responder-id` for the chain's innermost-first
   * responder resolution — one ref callback, three destinations.
   */
  composedRef: (el: T | null) => void;
  /**
   * Pass to the input's `onContextMenu` prop. Opens the editor
   * context menu at the cursor and chains the consumer's
   * `onContextMenu` callback after (if provided). Samples the
   * current selection at open time so Cut/Copy are disabled when
   * no range is selected — matching native input behavior.
   */
  handleContextMenu: (e: React.MouseEvent<T>) => void;
  /**
   * Ready-to-render `<TugEditorContextMenu>` element (or `null` when
   * no chain provider is in scope — see note below). Drop as a
   * sibling of the input/textarea. The hook owns its open state,
   * cursor position, item list, and close handler — consumers never
   * touch any of it.
   *
   * Returns `null` when the hook is called outside a
   * `ResponderChainProvider`: `TugEditorContextMenu` internally
   * requires a chain manager to dispatch cut/copy/paste through, so
   * it can't render without one. The opener is likewise gated, so
   * the menu is never opened in the no-provider case. On a provider
   * transition the `contextMenu` slot flips between `null` and the
   * real menu element; the sibling input element is unaffected, so
   * caret and focus survive.
   */
  contextMenu: React.ReactNode;
}

export function useTextInputResponder<T extends TextInputLikeElement>({
  inputRef,
  disabled,
  forwardedRef,
  onContextMenu: consumerOnContextMenu,
}: UseTextInputResponderOptions<T>): UseTextInputResponderResult<T> {
  // Read the chain manager once. `useResponderChain` (unlike
  // `useRequiredResponderChain`) returns `null` when no provider is
  // in scope. The hook uses this to decide whether to render the
  // right-click context menu and whether to let the opener fire:
  // outside a provider the menu cannot dispatch cut/copy/paste
  // through the chain, so it's gated off. When a provider enters or
  // leaves mid-lifecycle, the menu availability flips with it, but
  // the host input element itself stays mounted — see the
  // `useOptionalResponder` docstring for why state survives the
  // transition.
  const manager = useResponderChain();

  // Mounted flag for the async paste continuation. `useRef` is enough
  // because the continuation reads it synchronously in a promise
  // callback; no subscriber semantics are required.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---- Action handlers ----
  //
  // See the module docstring for the full rationale of each sync /
  // continuation split. The disabled guards in every handler are
  // defence-in-depth (see UseTextInputResponderOptions.disabled).

  const handleCut = useCallback((): ActionHandlerResult => {
    if (disabled) return;
    if (!inputRef.current) return;
    // Sync: copy the current selection to the clipboard so it stays
    // visible during the menu item's activation blink.
    document.execCommand("copy");
    // Continuation: remove the selection after the blink. execCommand
    // routes the deletion through the native editing pipeline so it
    // pushes onto the input's undo stack.
    return () => {
      document.execCommand("delete");
    };
  }, [disabled, inputRef]);

  const handleCopy = useCallback((): ActionHandlerResult => {
    if (disabled) return;
    // Sync-only: nothing to defer past the blink.
    document.execCommand("copy");
  }, [disabled]);

  const handlePaste = useCallback((): ActionHandlerResult => {
    if (disabled) return;
    const el = inputRef.current;
    if (!el) return;

    // ---- Native bridge path (Tug.app WKWebView) ----
    //
    // Preferred: ask the Swift side to read NSPasteboard and send the
    // contents back. This is the only path that avoids Safari's
    // "Paste" permission popup — neither `navigator.clipboard.*` nor
    // `document.execCommand("paste")` qualify, because both read the
    // clipboard from inside the JavaScript context and Safari treats
    // that as a prompt-required action. NSPasteboard access from the
    // native Cocoa side does not trigger any popup.
    //
    // The read is kicked off immediately (inside the user gesture, so
    // the menu stays live) and the insertion is deferred to the
    // continuation so the text appears after the activation blink —
    // matching cut / selectAll / undo / redo on every browser.
    // `hasNativeClipboardBridge()` is a live check, not a module-load
    // cache — a late-installed bridge (Swift registers after first JS
    // execution) is picked up on the next paste. The diagnostic for
    // the race window where a user pastes before the bridge install
    // lives at the fall-through site below via `warnIfWKWebViewRace`.
    if (hasNativeClipboardBridge()) {
      const nativeReadPromise = readClipboardViaNative();
      return () => {
        if (!mountedRef.current) return;
        void nativeReadPromise.then(({ text }) => {
          applyPastedText(inputRef, mountedRef, text);
        });
      };
    }

    // ---- Fall-through race diagnostic ----
    //
    // We're taking the JS Clipboard API path. In a normal browser
    // that's legitimate (no WKWebView, no native bridge expected).
    // Inside a WKWebView it's the race condition from the audit:
    // the Swift-side `clipboardRead` handler should have been
    // installed by MainWindow.swift before the first JS execution,
    // but for whatever reason wasn't. Emit a one-shot console
    // warning so the race is audible in dev consoles; production
    // Tug.app with a correctly-installed bridge stays silent.
    warnIfWKWebViewRace();

    // ---- Browser fallback (no WKWebView bridge) ----
    //
    // Development in Chrome / Firefox, Storybook, standalone previews,
    // tests. No native bridge → fall back to the "capture the paste
    // event fired by execCommand" pattern that works in the browsers
    // that still honor execCommand("paste"), then to the Clipboard API
    // path for the ones that don't.
    //
    // Register a one-time paste listener BEFORE calling execCommand so
    // we can intercept the synchronous paste event it fires. Focus the
    // element explicitly: execCommand("paste") fires the paste event
    // on the currently-focused element, and in test environments
    // `document.activeElement` must resolve to `el` for the spy to
    // target it correctly.
    el.focus();
    let pasteEventFired = false;
    let capturedText = "";
    const onPaste = (e: Event) => {
      const ce = e as ClipboardEvent;
      pasteEventFired = true;
      // Prevent the browser's native insertion — we'll insert manually
      // in the continuation, after the activation blink.
      ce.preventDefault();
      capturedText = ce.clipboardData?.getData("text/plain") ?? "";
    };
    el.addEventListener("paste", onPaste, { once: true });

    try {
      document.execCommand("paste");
    } catch {
      // Some browsers throw; treat as failure (Chrome path).
    }
    // Remove listener in case execCommand fired no event (Chrome).
    el.removeEventListener("paste", onPaste);

    if (pasteEventFired) {
      const text = capturedText;
      if (!text) return; // clipboard was empty — no-op
      return () => {
        applyPastedText(inputRef, mountedRef, text);
      };
    }

    // Last-resort: Clipboard API. execCommand is blocked and the
    // paste event never fired. Kick off the clipboard read NOW (still
    // inside the user gesture) so the read is authorized, then insert
    // in the continuation.
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
      return;
    }
    const readPromise = navigator.clipboard.readText().catch(() => "");
    return () => {
      if (!mountedRef.current) return;
      void readPromise.then((text) => {
        applyPastedText(inputRef, mountedRef, text);
      });
    };
  }, [disabled, inputRef]);

  const handleSelectAll = useCallback((): ActionHandlerResult => {
    if (disabled) return;
    return () => {
      inputRef.current?.select();
    };
  }, [disabled, inputRef]);

  const handleUndo = useCallback((): ActionHandlerResult => {
    if (disabled) return;
    return () => {
      document.execCommand("undo");
    };
  }, [disabled]);

  const handleRedo = useCallback((): ActionHandlerResult => {
    if (disabled) return;
    return () => {
      document.execCommand("redo");
    };
  }, [disabled]);

  // ---- Responder registration ----
  //
  // `useResponder` installs a live Proxy over `options.actions` — so
  // a fresh object literal each render is fine, every dispatch reads
  // the latest handler identities via the ref. No need to memoize
  // the actions map here.

  const responderId = useId();
  const actions: Partial<Record<TugAction, ActionHandler>> = {
    [TUG_ACTIONS.CUT]: handleCut,
    [TUG_ACTIONS.COPY]: handleCopy,
    [TUG_ACTIONS.PASTE]: handlePaste,
    [TUG_ACTIONS.SELECT_ALL]: handleSelectAll,
    [TUG_ACTIONS.UNDO]: handleUndo,
    [TUG_ACTIONS.REDO]: handleRedo,
  };
  // `useOptionalResponder` (not `useResponder`) so the three consuming
  // components — TugInput, TugTextarea, TugValueInput — can render
  // as a single component regardless of whether a ResponderChainProvider
  // is in scope. When the provider is absent, registration and the
  // `data-responder-id` attribute are skipped; when present, the
  // behavior is identical to `useResponder`. The component type and
  // DOM element stay stable across provider transitions, so caret
  // position, focus, and selection survive any test that wraps or
  // unwraps a provider around a mounted leaf control.
  const { responderRef } = useOptionalResponder({ id: responderId, actions });

  // ---- Ref composition ----
  //
  // One callback writes three destinations:
  //   1. The hook's internal `inputRef` (so the action handlers can
  //      reach `selectionStart`, `select()`, `setRangeText()`, etc.).
  //   2. The consumer's forwarded ref (if provided) — honored for both
  //      function refs and MutableRefObject refs, matching React's
  //      own ref-handling semantics.
  //   3. `responderRef` from `useResponder`, which writes
  //      `data-responder-id` for the chain's innermost-first walk.
  //
  // Every consumer of this hook used to open-code this merge. Moving
  // it into the hook removes ~12 duplicated lines per consumer and
  // eliminates the "did you remember to call responderRef last?"
  // footgun.

  const composedRef = useCallback(
    (el: T | null) => {
      inputRef.current = el;
      if (typeof forwardedRef === "function") {
        forwardedRef(el);
      } else if (forwardedRef) {
        (forwardedRef as React.MutableRefObject<T | null>).current = el;
      }
      responderRef(el);
    },
    [inputRef, forwardedRef, responderRef],
  );

  // ---- Pre-right-click selection capture ----
  //
  // Native inputs move the caret on mousedown (before contextmenu
  // fires), so we snapshot the selection at pointerdown (button === 2)
  // to know what the user's selection looked like before the browser
  // touched it. The adapter ref is created lazily per pointerdown so
  // it always wraps the current element.

  const preRightClickAdapterRef = useRef<
    (TextSelectionAdapter & NativeInputSelectionAdapterExtras) | null
  >(null);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onPointerDown = (e: Event) => {
      if (!(e instanceof PointerEvent) || e.button !== 2) return;
      const adapter = createNativeInputAdapter(el);
      adapter.capturePreRightClick();
      preRightClickAdapterRef.current = adapter;
    };
    el.addEventListener("pointerdown", onPointerDown);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
    };
  });

  // ---- Context menu state ----

  const [menuState, setMenuState] = useState<TextInputContextMenuState | null>(null);

  // Opens the menu at the cursor. Consumers reach this via the
  // bridged `handleContextMenu` below, which also fires the
  // consumer's own `onContextMenu` prop afterward.
  //
  // Gated on `manager !== null`: outside a chain provider the menu
  // items have nowhere to dispatch their cut/copy/paste actions, so
  // suppress the menu entirely rather than show disabled items or
  // invite a crash when the menu tries to consume the chain. Native
  // right-click behavior on the underlying input is unaffected — the
  // browser's default context menu is shown instead (we don't call
  // `preventDefault` when we bail early).
  const openMenu = useCallback(
    (e: React.MouseEvent<T>) => {
      if (disabled) return;
      if (manager === null) return;
      e.preventDefault();
      const node = inputRef.current;
      if (!node) return;

      const adapter = preRightClickAdapterRef.current;
      if (!adapter) {
        // No pointerdown capture — fall back to current selection state.
        const hasSelection =
          node.selectionStart !== null &&
          node.selectionEnd !== null &&
          node.selectionStart !== node.selectionEnd;
        setMenuState({ x: e.clientX, y: e.clientY, hasSelection });
        return;
      }

      // Classify the right-click against the pre-click selection.
      const classification = adapter.classifyRightClick(e.clientX, e.clientY, 0);

      let hasSelection: boolean;
      if (classification === "elsewhere") {
        // Click landed away from the selection — the browser already
        // moved the caret to the click point during mousedown. Expand
        // to word boundaries from the browser-placed caret.
        adapter.selectWordAtPoint(e.clientX, e.clientY);
        hasSelection = adapter.hasRangedSelection();
      } else if (classification === "within-range") {
        // Click inside a ranged selection — restore the pre-click range
        // (browser mousedown collapsed it to a caret at the click point).
        adapter.restorePreRightClick();
        hasSelection = true;
      } else {
        // "near-caret" — restore the original caret position (browser
        // may have shifted it by one offset during mousedown).
        adapter.restorePreRightClick();
        hasSelection = false;
      }

      preRightClickAdapterRef.current = null;
      setMenuState({ x: e.clientX, y: e.clientY, hasSelection });
    },
    [disabled, manager, inputRef],
  );

  // Bridge: menu first, consumer callback after. Previously every
  // consumer open-coded this two-liner.
  const handleContextMenu = useCallback(
    (e: React.MouseEvent<T>) => {
      openMenu(e);
      consumerOnContextMenu?.(e);
    },
    [openMenu, consumerOnContextMenu],
  );

  const closeMenu = useCallback(() => setMenuState(null), []);

  const menuItems = useMemo<TugEditorContextMenuEntry[]>(() => {
    const hasSelection = menuState?.hasSelection ?? false;
    return [
      { action: TUG_ACTIONS.CUT, label: "Cut", shortcut: "\u2318X", disabled: !hasSelection },
      { action: TUG_ACTIONS.COPY, label: "Copy", shortcut: "\u2318C", disabled: !hasSelection },
      { action: TUG_ACTIONS.PASTE, label: "Paste", shortcut: "\u2318V" },
      { type: "separator" },
      { action: TUG_ACTIONS.SELECT_ALL, label: "Select All", shortcut: "\u2318A" },
    ];
  }, [menuState?.hasSelection]);

  // Ready-to-render context menu. Consumers used to build this JSX
  // themselves in three places with identical props. Now the hook
  // owns the entire menu surface; consumers just interpolate
  // `{contextMenu}` into their render output.
  //
  // Gated on `manager !== null`: `TugEditorContextMenu` internally
  // calls `useRequiredResponderChain` (to obtain the manager it
  // dispatches into), so rendering it outside a provider would throw
  // at mount. When there is no chain, we return `null` for
  // `contextMenu` — the openMenu callback above is already gated on
  // the same condition, so `menuState` can never be non-null in the
  // no-provider case, and the null slot never transitions to an open
  // menu. Across a provider transition (null → non-null), the
  // contextMenu position in the JSX fragment swaps from `null` to a
  // fresh `TugEditorContextMenu`; the sibling `<input>` element
  // stays mounted at its own position, so caret and focus survive
  // the swap.
  const contextMenu: React.ReactNode =
    manager !== null ? (
      <TugEditorContextMenu
        open={menuState !== null}
        x={menuState?.x ?? 0}
        y={menuState?.y ?? 0}
        items={menuItems}
        onClose={closeMenu}
      />
    ) : null;

  return {
    composedRef,
    handleContextMenu,
    contextMenu,
  };
}
