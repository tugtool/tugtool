/**
 * TugPromptInput — rich text input with inline atom support.
 *
 * Wraps TugTextEngine in a React-compliant shell. The contentEditable
 * div is internal — the consumer interacts via props and imperative handle.
 * Atoms are <img> elements with SVG data URIs (see lib/tug-atom-img.ts).
 *
 * Laws: [L01] single mount, [L03] useLayoutEffect for registrations,
 *        [L06] appearance via CSS, [L07] stable refs,
 *        [L15] token-driven states, [L16] pairings declared,
 *        [L19] component authoring guide, [L22] direct DOM updates,
 *        [L23] editing state persists across reload/quit via tugbank
 */

import "./tug-prompt-input.css";
import "./tug-completion-menu.css";

import React, { useRef, useState, useLayoutEffect, useImperativeHandle, useCallback, useMemo, useId } from "react";
import { cn } from "@/lib/utils";
import { TugTextEngine } from "@/lib/tug-text-engine";
import { TugEditorContextMenu, type TugEditorContextMenuEntry } from "@/components/tugways/tug-editor-context-menu";
import type {
  AtomSegment,
  InputAction,
  CompletionItem,
  CompletionProvider,
  HistoryProvider,
  DropHandler,
  TugTextInputDelegate,
  TugTextEditingState,
} from "@/lib/tug-text-engine";
import { useTugcardPersistence } from "@/components/tugways/use-tugcard-persistence";
import { subscribeThemeChange, unsubscribeThemeChange } from "@/theme-tokens";
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionHandlerResult } from "@/components/tugways/responder-chain";
import { hasNativeClipboardBridge, readClipboardViaNative } from "@/lib/tug-native-clipboard";

// Re-export for consumers that import from the component module
export type { TugTextInputDelegate } from "@/lib/tug-text-engine";

/**
 * TugPromptInput props interface.
 */
export interface TugPromptInputProps extends Omit<React.ComponentPropsWithoutRef<"div">, "onChange"> {
  /**
   * Placeholder text shown when the input is empty.
   * @default ""
   */
  placeholder?: string;
  /**
   * Maximum visible rows before scrolling.
   * @default 8
   */
  maxRows?: number;
  /**
   * Action for the Return key (main keyboard).
   * @default "submit"
   */
  returnAction?: InputAction;
  /**
   * Action for the Enter key (numpad).
   * @default "submit"
   */
  numpadEnterAction?: InputAction;
  /**
   * Called when the user submits (Return/Enter with submit action).
   */
  onSubmit?: () => void;
  /**
   * Called when content changes (typing, atom insertion, deletion, undo).
   */
  onChange?: () => void;
  /**
   * Completion providers keyed by trigger character (e.g. { "@": fileProvider, "/": commandProvider }).
   */
  completionProviders?: Record<string, CompletionProvider>;
  /**
   * History provider for Cmd+Up/Down navigation through previous submissions.
   */
  historyProvider?: HistoryProvider;
  /**
   * Called when typeahead state changes. The popup is rendered internally;
   * this callback is for external observers of typeahead state.
   */
  onTypeaheadChange?: (active: boolean, filtered: CompletionItem[], selectedIndex: number) => void;
  /**
   * Drop handler for file drag-and-drop → atom conversion.
   */
  dropHandler?: DropHandler;
  /**
   * Whether the input is disabled.
   * @selector .tug-prompt-input-disabled
   * @default false
   */
  disabled?: boolean;
  /**
   * Direction the completion popup opens relative to the trigger.
   * @default "up"
   */
  completionDirection?: "up" | "down";
  /**
   * Direction the editor grows as lines are added.
   * "down" — top edge fixed, bottom extends (default).
   * "up" — bottom edge fixed, top extends (chat-style).
   * @default "down"
   */
  growDirection?: "up" | "down";
  /**
   * Expand the editor to fill available container space.
   * The container must be a flex column with a constrained height.
   * When true, maxRows is ignored and the editor fills the flex parent.
   * @default false
   */
  maximized?: boolean;
  /**
   * Focus indication style.
   * "background" — subtle background shift on focus (default).
   * "ring" — accent border ring on focus.
   * @default "background"
   */
  focusStyle?: "background" | "ring";
  /**
   * Remove visible border. For embedding in compound components
   * where the parent owns the border treatment.
   * @default false
   */
  borderless?: boolean;
  /**
   * Characters that trigger route detection when typed as the first character.
   * The character is consumed and onRouteChange fires.
   * If the character is also a completion trigger, it's kept for completion.
   */
  routePrefixes?: string[];
  /**
   * Called when a route prefix is detected as the first character.
   */
  onRouteChange?: (route: string | null) => void;
  /**
   * Whether to persist editing state via tugbank [L23].
   * Set to false for test harness editors or transient inputs.
   * @default true
   */
  persistState?: boolean;
}

// ---- Persistence helper ----

/**
 * Internal component that registers tugcard persistence for TugPromptInput.
 * Conditionally rendered (only when persistState=true) so the hook isn't
 * called for test harness editors, avoiding registration collisions.
 *
 * onRestore may fire before the engine's useLayoutEffect creates the engine
 * (React fires child effects before parent effects). The pendingRestore ref
 * buffers the state until the engine mounts and applies it.
 */
function TugPromptInputPersistence({
  engineRef,
  pendingRestoreRef,
}: {
  engineRef: React.RefObject<TugTextEngine | null>;
  pendingRestoreRef: React.RefObject<TugTextEditingState | null>;
}) {
  // The Tugcard persistence protocol expects onRestore to trigger a re-render
  // so the no-deps useLayoutEffect in useTugcardPersistence fires and calls
  // onContentReady (which removes visibility:hidden). Without this setState,
  // the direct DOM write via restoreState produces no re-render, onContentReady
  // never fires, and the card stays invisible.
  const [, setRestoreCount] = useState(0);
  useTugcardPersistence<TugTextEditingState>({
    onSave: () => {
      const empty: TugTextEditingState = { text: "", atoms: [], selection: null };
      const engine = engineRef.current;
      if (!engine) return empty;
      return engine.captureState();
    },
    onRestore: (state) => {
      if (engineRef.current) {
        engineRef.current.restoreState(state);
      } else {
        pendingRestoreRef.current = state;
      }
      setRestoreCount(c => c + 1);
    },
  });
  return null;
}

// ---- Constants ----

const DEFAULT_MAX_ROWS = 12;
const LINE_HEIGHT = 24;
const PADDING_Y = 14;

// ---- Component ----

export const TugPromptInput = React.forwardRef<TugTextInputDelegate, TugPromptInputProps>(
  function TugPromptInput({
    placeholder = "",
    maxRows = DEFAULT_MAX_ROWS,
    returnAction = "submit",
    numpadEnterAction = "submit",
    onSubmit,
    onChange,
    completionProviders,
    completionDirection = "up",
    historyProvider,
    onTypeaheadChange,
    dropHandler,
    growDirection = "down",
    maximized = false,
    focusStyle = "background",
    borderless = false,
    disabled = false,
    persistState = true,
    routePrefixes,
    onRouteChange,
    className,
    ...rest
  }: TugPromptInputProps, ref) {
    const editorRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const completionRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<TugTextEngine | null>(null);
    const pendingRestoreRef = useRef<TugTextEditingState | null>(null);

    // Expose TugTextInputDelegate — the UITextInput-inspired API [L07]
    useImperativeHandle(ref, () => ({
      getText() { return engineRef.current?.getText() ?? ""; },
      getAtoms() { return engineRef.current?.getAtoms() ?? []; },
      isEmpty() { return engineRef.current?.isEmpty() ?? true; },
      getSelectedRange() { return engineRef.current?.getSelectedRange() ?? null; },
      setSelectedRange(start: number, end?: number) { engineRef.current?.setSelectedRange(start, end); },
      selectWordAtPoint(clientX: number, clientY: number) { return engineRef.current?.selectWordAtPoint(clientX, clientY) ?? null; },
      get hasMarkedText() { return engineRef.current?.hasMarkedText ?? false; },
      insertText(text: string) { engineRef.current?.insertText(text); },
      insertAtom(atom: AtomSegment) { engineRef.current?.insertAtom(atom); },
      paste(html: string, plain: string) { engineRef.current?.paste(html, plain); },
      deleteSelection() { engineRef.current?.deleteSelection(); },
      deleteRange(start: number, end: number) { return engineRef.current?.deleteRange(start, end) ?? start; },
      deleteBackward() { engineRef.current?.deleteBackward(); },
      deleteForward() { engineRef.current?.deleteForward(); },
      deleteWordBackward() { engineRef.current?.deleteWordBackward(); },
      deleteWordForward() { engineRef.current?.deleteWordForward(); },
      deleteParagraphBackward() { engineRef.current?.deleteParagraphBackward(); },
      deleteParagraphForward() { engineRef.current?.deleteParagraphForward(); },
      selectAll() { engineRef.current?.selectAll(); },
      clear() { engineRef.current?.clear(); },
      undo() { engineRef.current?.undo(); },
      redo() { engineRef.current?.redo(); },
      focus() { engineRef.current?.root.focus(); },
      get isTypeaheadActive() { return engineRef.current?.isTypeaheadActive ?? false; },
      acceptTypeahead(index?: number) { engineRef.current?.acceptTypeahead(index); },
      cancelTypeahead() { engineRef.current?.cancelTypeahead(); },
      typeaheadNavigate(direction: "up" | "down") { engineRef.current?.typeaheadNavigate(direction); },
      captureState() { return engineRef.current?.captureState() ?? { text: "", atoms: [], selection: null }; },
      restoreState(state: TugTextEditingState) { engineRef.current?.restoreState(state); },
      regenerateAtoms() { engineRef.current?.regenerateAtoms(); },
      getEditorElement() { return engineRef.current?.root ?? null; },
    }), []);

    // Stable callback/config refs — engine reads these via closure over refs [L07]
    const onSubmitRef = useRef(onSubmit);
    const onChangeRef = useRef(onChange);
    const onTypeaheadChangeRef = useRef(onTypeaheadChange);
    const completionDirectionRef = useRef(completionDirection);
    const onRouteChangeRef = useRef(onRouteChange);
    useLayoutEffect(() => { onSubmitRef.current = onSubmit; }, [onSubmit]);
    useLayoutEffect(() => { onChangeRef.current = onChange; }, [onChange]);
    useLayoutEffect(() => { onTypeaheadChangeRef.current = onTypeaheadChange; }, [onTypeaheadChange]);
    useLayoutEffect(() => { completionDirectionRef.current = completionDirection; }, [completionDirection]);
    useLayoutEffect(() => { onRouteChangeRef.current = onRouteChange; }, [onRouteChange]);

    // Mount engine once [L01, L03]
    useLayoutEffect(() => {
      const el = editorRef.current;
      if (!el || engineRef.current) return;

      const engine = new TugTextEngine(el);
      engine.maxHeight = LINE_HEIGHT * maxRows + PADDING_Y;
      engine.growDirection = growDirection;
      engine.maximized = maximized;
      engine.completionProviders = completionProviders ?? {};
      engine.historyProvider = historyProvider ?? null;
      engine.dropHandler = dropHandler ?? null;
      engine.returnAction = returnAction;
      engine.numpadEnterAction = numpadEnterAction;
      engine.routePrefixes = routePrefixes ?? [];
      engine.onRouteChange = (route) => onRouteChangeRef.current?.(route);

      // Wire callbacks through refs so they always call the latest prop
      engine.onSubmit = () => onSubmitRef.current?.();
      engine.onChange = () => onChangeRef.current?.();
      engine.onTypeaheadChange = (active, filtered, selectedIndex) => {
        onTypeaheadChangeRef.current?.(active, filtered, selectedIndex);
        // Direct DOM update for completion popup [L06]
        const popup = completionRef.current;
        const container = containerRef.current;
        if (!popup) return;
        if (!active || filtered.length === 0) {
          popup.style.display = "none";
          return;
        }
        // Skip DOM rebuild if results haven't changed (avoids flash between keystrokes).
        const items = popup.querySelectorAll(".tug-completion-menu-item");
        let same = items.length === filtered.length;
        if (same) {
          for (let k = 0; k < filtered.length; k++) {
            const label = items[k]?.querySelector(".tug-completion-menu-label");
            if (label?.textContent !== filtered[k].label) { same = false; break; }
          }
        }
        if (same) {
          // Just update selection highlight — no rebuild needed.
          items.forEach((el, k) => {
            el.className = "tug-completion-menu-item" +
              (k === selectedIndex ? " tug-completion-menu-item-selected" : "");
          });
          popup.style.display = "block";
          return;
        }

        popup.style.display = "block";
        popup.innerHTML = "";
        filtered.forEach((item, i) => {
          const div = document.createElement("div");
          div.className = "tug-completion-menu-item" +
            (i === selectedIndex ? " tug-completion-menu-item-selected" : "");
          const label = document.createElement("span");
          label.className = "tug-completion-menu-label";
          if (item.matches && item.matches.length > 0) {
            // Render with match highlighting.
            let pos = 0;
            for (const [start, end] of item.matches) {
              if (start > pos) {
                label.appendChild(document.createTextNode(item.label.slice(pos, start)));
              }
              const mark = document.createElement("span");
              mark.className = "tug-completion-match";
              mark.textContent = item.label.slice(start, end);
              label.appendChild(mark);
              pos = end;
            }
            if (pos < item.label.length) {
              label.appendChild(document.createTextNode(item.label.slice(pos)));
            }
          } else {
            label.textContent = item.label;
          }
          div.appendChild(label);
          div.addEventListener("pointermove", () => {
            // Move keyboard selection to the hovered item — one highlight.
            engine.typeaheadNavigate(i);
          });
          div.addEventListener("pointerdown", (e) => {
            e.preventDefault(); // Don't steal focus from editor
            engine.acceptTypeahead(i);
          });
          popup.appendChild(div);
        });
        // Position at the @ anchor rect, auto-flipping to avoid clipping.
        // Find the nearest scrollable ancestor (overflow: auto/scroll) to
        // measure available space. The popup stays inside that boundary.
        const anchorRect = engine.typeaheadAnchorRect;
        if (anchorRect && container) {
          const containerRect = container.getBoundingClientRect();
          popup.style.left = `${anchorRect.left - containerRect.left}px`;

          // Measure popup height now that items are rendered
          const popupH = popup.offsetHeight;

          // Find the scrollable ancestor that clips us
          let scrollParent: HTMLElement | null = container.parentElement;
          while (scrollParent) {
            const ov = getComputedStyle(scrollParent).overflowY;
            if (ov === "auto" || ov === "scroll" || ov === "hidden") break;
            scrollParent = scrollParent.parentElement;
          }
          const clipRect = scrollParent?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };

          const spaceAbove = anchorRect.top - clipRect.top;
          const spaceBelow = clipRect.bottom - anchorRect.bottom;
          const preferred = completionDirectionRef.current;
          const useDown = preferred === "down"
            ? spaceBelow >= popupH || spaceBelow >= spaceAbove
            : spaceAbove < popupH && spaceBelow > spaceAbove;

          if (useDown) {
            popup.style.top = `${anchorRect.bottom - containerRect.top + 4}px`;
            popup.style.bottom = "";
          } else {
            popup.style.bottom = `${containerRect.bottom - anchorRect.top + 4}px`;
            popup.style.top = "";
          }
        }
      };

      engineRef.current = engine;

      // Apply any state buffered by onRestore that fired before engine creation
      if (pendingRestoreRef.current) {
        engine.restoreState(pendingRestoreRef.current);
        pendingRestoreRef.current = null;
      }

      return () => {
        engine.teardown();
        engineRef.current = null;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync mutable config to engine [L07]
    useLayoutEffect(() => {
      if (engineRef.current) {
        engineRef.current.returnAction = returnAction;
      }
    }, [returnAction]);

    useLayoutEffect(() => {
      if (engineRef.current) {
        engineRef.current.numpadEnterAction = numpadEnterAction;
      }
    }, [numpadEnterAction]);

    useLayoutEffect(() => {
      if (engineRef.current) {
        engineRef.current.maxHeight = LINE_HEIGHT * maxRows + PADDING_Y;
      }
    }, [maxRows]);

    useLayoutEffect(() => {
      if (engineRef.current) {
        engineRef.current.completionProviders = completionProviders ?? {};
      }
    }, [completionProviders]);

    useLayoutEffect(() => {
      if (engineRef.current) {
        engineRef.current.historyProvider = historyProvider ?? null;
      }
    }, [historyProvider]);

    useLayoutEffect(() => {
      if (engineRef.current) {
        engineRef.current.dropHandler = dropHandler ?? null;
      }
    }, [dropHandler]);

    useLayoutEffect(() => {
      if (engineRef.current) {
        engineRef.current.growDirection = growDirection;
      }
    }, [growDirection]);

    useLayoutEffect(() => {
      if (engineRef.current) {
        engineRef.current.maximized = maximized;
        engineRef.current.relayout();
      }
    }, [maximized]);

    useLayoutEffect(() => {
      if (engineRef.current) {
        engineRef.current.routePrefixes = routePrefixes ?? [];
      }
    }, [routePrefixes]);

    // Regenerate atom images on theme change — direct DOM update [L06, L22]
    useLayoutEffect(() => {
      const onThemeChange = () => { engineRef.current?.regenerateAtoms(); };
      subscribeThemeChange(onThemeChange);
      return () => { unsubscribeThemeChange(onThemeChange); };
    }, []);

    // Prevent interaction when disabled. First-responder promotion
    // is handled centrally by ResponderChainProvider via the
    // document-level pointerdown listener that walks the DOM for
    // data-responder-id — no per-component promotion needed here.
    const handlePointerDown = useCallback((e: React.PointerEvent) => {
      if (disabled) e.preventDefault();
    }, [disabled]);

    // ---- Context menu (cut/copy/paste) ----
    //
    // Uses TugEditorContextMenu — a portaled positioned <div> that never
    // steals focus. The contentEditable retains focus for the entire
    // menu lifecycle, which means:
    //   - the selection highlight stays painted (no overlay needed),
    //   - ⌘X/C/V route to the editor as usual while the menu is open,
    //   - clipboard commands execute inside a synchronous user gesture
    //     (the item's mousedown handler), so execCommand works directly.
    //
    // Right-click preserves the existing selection verbatim — a ranged
    // selection stays ranged, a caret stays a caret, no text that the
    // user didn't ask us to touch ever gets selected. This is harder
    // than it sounds: WebKit's contentEditable has a native "smart
    // click" on right-click that expands the selection to whatever is
    // under the pointer (a word, or a single character like a space),
    // and that mutation runs during the browser's default mousedown
    // handling — before our `contextmenu` listener fires. Reading
    // `engine.getSelectedRange()` in the contextmenu handler would
    // observe the post-expansion state and report hasSelection = true
    // even though the user's original selection was a collapsed caret.
    //
    // Fix: capture the selection at `pointerdown` (button === 2),
    // which fires *before* the browser's native mousedown default
    // action, then restore it in the contextmenu handler before
    // sampling hasSelection. Whatever WebKit did between pointerdown
    // and contextmenu is undone. The restore runs even when the
    // captured selection is null (no prior selection at all — e.g.
    // first right-click into an unfocused editor), in which case we
    // leave the post-click state alone and let hasSelection reflect
    // whatever the browser placed there.

    // Menu state: null when closed, {x, y, hasSelection} when open.
    // hasSelection is sampled once on open and drives Cut/Copy enablement.
    const [menuState, setMenuState] = useState<{
      x: number;
      y: number;
      hasSelection: boolean;
    } | null>(null);

    // Captured at pointerdown on a right-click, restored at contextmenu.
    // See the rationale block above.
    const preRightClickSelectionRef = useRef<{ start: number; end: number } | null>(null);

    useLayoutEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      // Pointerdown runs before the browser's native mousedown default
      // action, so reading the selection here captures it in its
      // pre-right-click state. We don't `preventDefault` — we want the
      // native action to still run (focus the editor, place the caret
      // if none existed) and then we undo the selection portion of
      // that action in the contextmenu handler.
      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 2) return;
        const engine = engineRef.current;
        if (!engine) return;
        if (!engine.root.contains(e.target as Node)) {
          preRightClickSelectionRef.current = null;
          return;
        }
        preRightClickSelectionRef.current = engine.getSelectedRange();
      };
      const onContextMenu = (e: MouseEvent) => {
        const engine = engineRef.current;
        if (!engine) return;
        // Only intercept right-clicks that land inside the editor proper.
        // Clicks on container padding (around the editor) fall through to
        // the browser's native menu.
        if (!engine.root.contains(e.target as Node)) return;
        e.preventDefault();
        // No makeFirstResponder call needed here: the document-level
        // pointerdown listener in ResponderChainProvider has already
        // promoted this node via data-responder-id lookup, and a
        // right-click issues pointerdown before contextmenu.
        //
        // Restore the pre-right-click selection, undoing any native
        // "smart click" expansion WebKit did during mousedown handling.
        // When the captured value is null (user right-clicked before
        // the editor had any selection), we skip the restore and let
        // whatever caret WebKit placed be the effective state — that
        // avoids clearing a caret the user actually expects to see.
        const captured = preRightClickSelectionRef.current;
        if (captured !== null) {
          engine.setSelectedRange(captured.start, captured.end);
        }
        const range = engine.getSelectedRange();
        const hasSelection = range !== null && range.end > range.start;
        setMenuState({ x: e.clientX, y: e.clientY, hasSelection });
      };
      container.addEventListener("pointerdown", onPointerDown);
      container.addEventListener("contextmenu", onContextMenu);
      return () => {
        container.removeEventListener("pointerdown", onPointerDown);
        container.removeEventListener("contextmenu", onContextMenu);
      };
    }, []);

    const closeMenu = useCallback(() => setMenuState(null), []);

    // ---- Responder chain actions (cut / copy / paste) ----
    //
    // Registered via useResponder so both keyboard shortcuts (⌘X/⌘C/⌘V,
    // routed by the keybinding map and responder-chain-provider) and
    // the context menu (which dispatches through the chain) share a
    // single implementation [L11]. Handlers use the two-phase pattern:
    // the synchronous body runs inside the user gesture (clipboard
    // writes, clipboard reads) and an optional continuation callback
    // runs at the caller's commit point. The menu invokes the
    // continuation after its activation blink; the keyboard path
    // invokes it immediately.

    const responderId = useId();

    const handleCut = useCallback((): ActionHandlerResult => {
      const engine = engineRef.current;
      if (!engine) return;
      // Sync phase: write the selection to the clipboard. Use "copy"
      // (not "cut") so the selection stays visible during the activation
      // blink — the continuation deletes it afterward.
      document.execCommand("copy");
      return () => engine.deleteSelection();
    }, []);

    const handleCopy = useCallback((): ActionHandlerResult => {
      // No editor change — no continuation needed.
      document.execCommand("copy");
    }, []);

    const handlePaste = useCallback((): ActionHandlerResult => {
      const engine = engineRef.current;
      if (!engine) return;

      // ---- Native bridge path (Tug.app WKWebView) ----
      //
      // Safari's JavaScript Clipboard API (`navigator.clipboard.*`) and
      // `document.execCommand("paste")` on contentEditable both trigger
      // a floating "Paste" permission popup on every invocation in
      // Safari 16.4+. The only JS-accessible path that avoids the popup
      // inside a WKWebView app is to delegate to the native side: Swift
      // reads `NSPasteboard.general` (no popup, no prompt) and sends
      // the contents back via `evaluateJavaScript`. See
      // `lib/tug-native-clipboard.ts` and
      // `tugapp/Sources/MainWindow.swift` for the bridge.
      //
      // Kick off the read immediately so the promise is created inside
      // the user gesture; insert via `engine.paste(html, plain)` in
      // the continuation so the text lands after the menu activation
      // blink — atom-aware, correct ordering, no popup.
      if (hasNativeClipboardBridge()) {
        const nativeReadPromise = readClipboardViaNative();
        return () => {
          void nativeReadPromise.then(({ text, html }) => engine.paste(html, text));
        };
      }

      // ---- Browser fallback (no WKWebView bridge) ----
      //
      // Development in Chrome / Firefox, Storybook, standalone previews,
      // tests. Use the capture-the-paste-event pattern where possible,
      // then fall back to the Clipboard API.

      // Explicitly focus the editor: execCommand("paste") fires the
      // paste event on the currently-focused element.
      engine.root.focus();

      let pasteEventFired = false;
      let capturedHtml = "";
      let capturedPlain = "";
      const onPaste = (e: ClipboardEvent) => {
        pasteEventFired = true;
        e.preventDefault(); // block native insertion; we insert in continuation
        capturedHtml = e.clipboardData?.getData("text/html") ?? "";
        capturedPlain = e.clipboardData?.getData("text/plain") ?? "";
      };
      engine.root.addEventListener("paste", onPaste, { once: true });

      try {
        document.execCommand("paste");
      } catch {
        // Some browsers throw; treat as failure (Chrome path).
      }
      engine.root.removeEventListener("paste", onPaste);

      if (pasteEventFired) {
        const html = capturedHtml;
        const plain = capturedPlain;
        return () => engine.paste(html, plain);
      }

      // Last-resort: Clipboard API — kick off inside gesture, insert
      // in continuation.
      const readPromise: Promise<{ html: string; plain: string }> = (async () => {
        let html = "";
        let plain = "";
        try {
          const clip = navigator.clipboard;
          if (typeof clip.read === "function") {
            const clipItems = await clip.read();
            for (const item of clipItems) {
              if (!html && item.types.includes("text/html")) {
                html = await (await item.getType("text/html")).text();
              }
              if (!plain && item.types.includes("text/plain")) {
                plain = await (await item.getType("text/plain")).text();
              }
              if (html && plain) break;
            }
          } else if (typeof clip.readText === "function") {
            plain = await clip.readText();
          }
        } catch {
          try {
            plain = await navigator.clipboard.readText();
          } catch {
            /* give up */
          }
        }
        return { html, plain };
      })();

      return () => {
        void readPromise.then(({ html, plain }) => engine.paste(html, plain));
      };
    }, []);

    // ---- selectAll / undo / redo ----
    //
    // These round-trip through the engine's own APIs and all return
    // a continuation so the side effect lands AFTER the context menu
    // activation blink — matching the cut/copy/paste precedent just
    // above. The engine's selectAll / undo / redo are synchronous
    // state transitions (no clipboard / user-gesture constraint), so
    // there is nothing to put in the sync phase. Keyboard-shortcut
    // dispatches run the continuation immediately, so user-facing
    // behavior is identical on the keyboard path. Registering these
    // handlers is what makes ⌘A / ⌘Z / ⇧⌘Z work against the focused
    // editor via the chain once those bindings are wired in the
    // keybinding map.

    const handleSelectAll = useCallback((): ActionHandlerResult => {
      return () => engineRef.current?.selectAll();
    }, []);

    const handleUndo = useCallback((): ActionHandlerResult => {
      return () => engineRef.current?.undo();
    }, []);

    const handleRedo = useCallback((): ActionHandlerResult => {
      return () => engineRef.current?.redo();
    }, []);

    const { ResponderScope, responderRef } = useResponder({
      id: responderId,
      actions: {
        cut: handleCut,
        copy: handleCopy,
        paste: handlePaste,
        selectAll: handleSelectAll,
        undo: handleUndo,
        redo: handleRedo,
      },
    });

    const menuItems = useMemo<TugEditorContextMenuEntry[]>(() => {
      const hasSelection = menuState?.hasSelection ?? false;
      return [
        { action: "cut",       label: "Cut",        shortcut: "\u2318X", disabled: !hasSelection },
        { action: "copy",      label: "Copy",       shortcut: "\u2318C", disabled: !hasSelection },
        { action: "paste",     label: "Paste",      shortcut: "\u2318V" },
        { type: "separator" },
        { action: "selectAll", label: "Select All", shortcut: "\u2318A" },
      ];
    }, [menuState?.hasSelection]);

    // Compose containerRef with responderRef so one DOM element
    // receives both: containerRef is used by the contextmenu listener
    // and by sizing/positioning, and responderRef writes
    // data-responder-id for the chain's first-responder resolution.
    const composedContainerRef = useCallback((el: HTMLDivElement | null) => {
      containerRef.current = el;
      responderRef(el);
    }, [responderRef]);

    return (
      <ResponderScope>
        <div
          ref={composedContainerRef}
          data-slot="tug-prompt-input"
          className={cn(
            "tug-prompt-input",
            disabled && "tug-prompt-input-disabled",
            className,
          )}
          data-maximized={maximized || undefined}
          onPointerDown={handlePointerDown}
          {...rest}
        >
          {persistState && <TugPromptInputPersistence engineRef={engineRef} pendingRestoreRef={pendingRestoreRef} />}
          <div
            ref={editorRef}
            className="tug-prompt-input-editor"
            contentEditable={!disabled}
            role="textbox"
            aria-multiline="true"
            aria-disabled={disabled || undefined}
            data-focus-style={focusStyle}
            data-borderless={borderless || undefined}
            data-maximized={maximized || undefined}
            data-placeholder={placeholder}
            data-empty="true"
            data-td-select="custom"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            suppressContentEditableWarning
          />
          <div
            ref={completionRef}
            data-slot="tug-completion-menu"
            className="tug-completion-menu"
            style={{ display: "none" }}
          />
          <TugEditorContextMenu
            open={menuState !== null}
            x={menuState?.x ?? 0}
            y={menuState?.y ?? 0}
            items={menuItems}
            onClose={closeMenu}
          />
        </div>
      </ResponderScope>
    );
  }
);
