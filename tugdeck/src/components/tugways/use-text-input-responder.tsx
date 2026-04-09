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
 * ```tsx
 * const inputRef = useRef<HTMLInputElement | null>(null);
 * const { responderRef, menuState, handleContextMenu, closeMenu, menuItems } =
 *   useTextInputResponder({ inputRef, disabled });
 *
 * return (
 *   <>
 *     <input
 *       ref={composeRefs(inputRef, responderRef, forwardedRef)}
 *       onContextMenu={handleContextMenu}
 *       ...
 *     />
 *     <TugEditorContextMenu
 *       open={menuState !== null}
 *       x={menuState?.x ?? 0}
 *       y={menuState?.y ?? 0}
 *       items={menuItems}
 *       onClose={closeMenu}
 *     />
 *   </>
 * );
 * ```
 *
 * Laws: [L06] appearance via CSS/DOM,
 *       [L11] controls emit actions; responders handle actions,
 *       [L19] component authoring guide
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useResponder } from "./use-responder";
import type { ActionHandler, ActionHandlerResult } from "./responder-chain";
import type { TugAction } from "./action-vocabulary";
import type { TugEditorContextMenuEntry } from "./tug-editor-context-menu";
import { hasNativeClipboardBridge, readClipboardViaNative } from "@/lib/tug-native-clipboard";

/** Any DOM element that has an editable text value, caret, and selection. */
export type TextInputLikeElement = HTMLInputElement | HTMLTextAreaElement;

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
   * handlers. Must be the same element the returned `responderRef`
   * is attached to.
   */
  inputRef: React.MutableRefObject<T | null>;
  /**
   * When true, all handlers short-circuit before touching the DOM and
   * the context menu refuses to open. This is defence-in-depth — a
   * disabled input normally cannot receive focus, but
   * `manager.dispatchTo(id, ...)` can target it directly and must not
   * mutate a disabled field.
   */
  disabled: boolean;
}

export interface UseTextInputResponderResult {
  /**
   * Attach this to the same DOM element as `inputRef`. It writes
   * `data-responder-id` for first-responder resolution via the chain
   * provider's document-level capture listeners.
   */
  responderRef: (el: Element | null) => void;
  /** Current state of the context menu. `null` when closed. */
  menuState: TextInputContextMenuState | null;
  /**
   * Attach to the input's `onContextMenu` prop. Opens the context
   * menu at the cursor and samples the current selection for
   * Cut/Copy enablement.
   */
  handleContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
  /** Close the context menu. Pass to `TugEditorContextMenu.onClose`. */
  closeMenu: () => void;
  /** Items to pass to `TugEditorContextMenu.items`. */
  menuItems: TugEditorContextMenuEntry[];
}

export function useTextInputResponder<T extends TextInputLikeElement>({
  inputRef,
  disabled,
}: UseTextInputResponderOptions<T>): UseTextInputResponderResult {
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
    if (hasNativeClipboardBridge()) {
      const nativeReadPromise = readClipboardViaNative();
      return () => {
        if (!mountedRef.current) return;
        void nativeReadPromise.then(({ text }) => {
          if (!text || !mountedRef.current) return;
          const node = inputRef.current;
          if (!node) return;
          const start = node.selectionStart ?? node.value.length;
          const end = node.selectionEnd ?? node.value.length;
          node.setRangeText(text, start, end, "end");
          node.dispatchEvent(new Event("input", { bubbles: true }));
        });
      };
    }

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
        if (!mountedRef.current) return;
        const node = inputRef.current;
        if (!node) return;
        const start = node.selectionStart ?? node.value.length;
        const end = node.selectionEnd ?? node.value.length;
        node.setRangeText(text, start, end, "end");
        node.dispatchEvent(new Event("input", { bubbles: true }));
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
        if (!text || !mountedRef.current) return;
        const node = inputRef.current;
        if (!node) return;
        const start = node.selectionStart ?? node.value.length;
        const end = node.selectionEnd ?? node.value.length;
        node.setRangeText(text, start, end, "end");
        node.dispatchEvent(new Event("input", { bubbles: true }));
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
    cut: handleCut,
    copy: handleCopy,
    paste: handlePaste,
    selectAll: handleSelectAll,
    undo: handleUndo,
    redo: handleRedo,
  };
  const { responderRef } = useResponder({ id: responderId, actions });

  // ---- Context menu state ----

  const [menuState, setMenuState] = useState<TextInputContextMenuState | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (disabled) return;
      e.preventDefault();
      const node = inputRef.current;
      if (!node) return;
      // Native input right-click does not auto-select a word; it
      // positions the caret and enables Cut/Copy only when a prior
      // selection exists. Match that behavior.
      const hasSelection =
        node.selectionStart !== null &&
        node.selectionEnd !== null &&
        node.selectionStart !== node.selectionEnd;
      setMenuState({ x: e.clientX, y: e.clientY, hasSelection });
    },
    [disabled, inputRef],
  );

  const closeMenu = useCallback(() => setMenuState(null), []);

  const menuItems = useMemo<TugEditorContextMenuEntry[]>(() => {
    const hasSelection = menuState?.hasSelection ?? false;
    return [
      { action: "cut", label: "Cut", shortcut: "\u2318X", disabled: !hasSelection },
      { action: "copy", label: "Copy", shortcut: "\u2318C", disabled: !hasSelection },
      { action: "paste", label: "Paste", shortcut: "\u2318V" },
      { type: "separator" },
      { action: "selectAll", label: "Select All", shortcut: "\u2318A" },
    ];
  }, [menuState?.hasSelection]);

  return {
    responderRef,
    menuState,
    handleContextMenu,
    closeMenu,
    menuItems,
  };
}
