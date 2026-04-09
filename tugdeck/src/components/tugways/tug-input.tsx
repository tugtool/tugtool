/**
 * TugInput — tugways public API for text inputs.
 *
 * Wraps a plain <input> element (not a Radix primitive). All visual states
 * are driven by --tug7-field-* tokens — theme switches update CSS
 * variables at the DOM level with no React re-renders.
 *
 * ## Chain participation (A2.7)
 *
 * When rendered inside a `<ResponderChainProvider>`, TugInput registers
 * itself as a responder node and handles the six standard editing
 * actions: `cut`, `copy`, `paste`, `selectAll`, `undo`, `redo`. These
 * are dispatched through the chain by the keybinding map in the
 * provider (⌘X/⌘C/⌘V/⌘A and later ⌘Z/⌘⇧Z), and also by any
 * context-menu UI that fires `manager.dispatch({action: "cut", ...})`.
 *
 * The handlers delegate to native DOM APIs on the underlying
 * `<input>` element, so each input uses its own native undo stack
 * (per the responder chain's innermost-first walk guarantee — the
 * focused input is always first responder via the focusin listener
 * in `responder-chain-provider.tsx`):
 *
 *   - `cut`       → `document.execCommand("cut")`
 *   - `copy`      → `document.execCommand("copy")`
 *   - `paste`     → `navigator.clipboard.readText()` + `input.setRangeText()`
 *                   (two-phase: sync clipboard read, continuation
 *                   inserts the text after any menu activation blink)
 *   - `selectAll` → `input.select()`
 *   - `undo`      → `document.execCommand("undo")`
 *   - `redo`      → `document.execCommand("redo")`
 *
 * ### Why execCommand for cut/copy/undo/redo
 *
 * `document.execCommand` is deprecated but still works in every major
 * browser for native input elements, and it is the *only* API that
 * integrates with the input's native undo stack. The Clipboard API
 * replacement (`navigator.clipboard.writeText`) does not push a cut
 * onto the input's undo stack, so a cut made via the Clipboard API
 * cannot be reversed with ⌘Z. execCommand sidesteps this by routing
 * through the browser's legacy editing infrastructure.
 *
 * ### Why Clipboard API for paste
 *
 * `document.execCommand("paste")` is blocked in Chrome for web pages
 * (security / privacy: the clipboard may contain sensitive data from
 * other apps). The Clipboard API's `readText` is the supported path.
 * The handler returns a continuation callback so the async clipboard
 * read can start inside the user gesture and the insertion runs after
 * any menu blink animation. Limitation: paste via this path does NOT
 * integrate with the native input's undo stack (⌘Z after a paste
 * will undo a previous edit, not the paste itself). This is a
 * browser-level constraint, not a bug in TugInput.
 *
 * ## Two-path rendering (no-provider fallback)
 *
 * TugInput may legitimately render outside a `ResponderChainProvider`
 * — e.g. in Storybook-style standalone previews, in tests that don't
 * set up the chain, or in pre-mount snapshots. `useResponder` throws
 * outside a provider (deliberately — see its docstring), so TugInput
 * branches at render time: if `useResponderChain()` returns `null`,
 * it renders a plain `<input>` with no chain registration; if the
 * manager is present, it renders the inner `TugInputWithResponder`
 * variant that registers and wires the handlers. This keeps the
 * strict invariant of `useResponder` intact while letting consumers
 * use `TugInput` anywhere.
 *
 * Laws: [L06] appearance via CSS, [L11] controls emit actions;
 *       responders handle actions, [L15] token-driven states,
 *       [L16] pairings declared, [L19] component authoring guide
 * Decisions: [D04] token-driven control state model,
 *            [D05] component token naming
 */

import "./tug-input.css";

import React, { useCallback, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useTugBoxDisabled } from "./internal/tug-box-context";
import { useResponderChain } from "./responder-chain-provider";
import { useResponder } from "./use-responder";
import type { ActionHandlerResult } from "./responder-chain";
import {
  TugEditorContextMenu,
  type TugEditorContextMenuEntry,
} from "./tug-editor-context-menu";

// ---- Types ----

/** TugInput size names — matches TugButton sizes */
export type TugInputSize = "sm" | "md" | "lg";

/** TugInput validation state */
export type TugInputValidation = "default" | "invalid" | "valid" | "warning";

/** TugInput props — extends native input attributes. */
export interface TugInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /**
   * Visual size variant.
   * @selector .tug-input-size-sm | .tug-input-size-md | .tug-input-size-lg
   * @default "md"
   */
  size?: TugInputSize;
  /**
   * Validation state. Controls border color.
   * @selector .tug-input-invalid | .tug-input-valid | .tug-input-warning
   * @default "default"
   */
  validation?: TugInputValidation;
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
}

// ---- Shared rendering ----
//
// Both the plain and responder-wired variants render the same JSX:
// a single `<input>` with our computed className and data attributes.
// The only difference is whether the ref composes a responder
// registration or forwards straight through.

function buildInputClassName(
  size: TugInputSize,
  validation: TugInputValidation,
  className: string | undefined,
): string {
  return cn(
    "tug-input",
    `tug-input-size-${size}`,
    validation === "invalid" && "tug-input-invalid",
    validation === "valid" && "tug-input-valid",
    validation === "warning" && "tug-input-warning",
    className,
  );
}

// ---- Plain variant (no provider) ----

const TugInputPlain = React.forwardRef<HTMLInputElement, TugInputProps>(
  function TugInputPlain(
    {
      size = "md",
      validation = "default",
      focusStyle = "background",
      borderless = false,
      className,
      disabled,
      ...rest
    },
    ref,
  ) {
    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;

    return (
      <input
        ref={ref}
        data-slot="tug-input"
        data-focus-style={focusStyle}
        data-borderless={borderless || undefined}
        className={buildInputClassName(size, validation, className)}
        disabled={effectiveDisabled}
        aria-invalid={validation === "invalid" ? "true" : undefined}
        {...rest}
      />
    );
  },
);

// ---- Responder variant (inside provider) ----

const TugInputWithResponder = React.forwardRef<HTMLInputElement, TugInputProps>(
  function TugInputWithResponder(
    {
      size = "md",
      validation = "default",
      focusStyle = "background",
      borderless = false,
      className,
      disabled,
      onContextMenu,
      ...rest
    },
    ref,
  ) {
    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;

    // Local ref to the input DOM node — needed by the action handlers
    // to reach `selectionStart`, `select()`, `setRangeText()`, etc.
    // We compose it with the forwarded ref so consumers still get
    // their ref too.
    const inputRef = useRef<HTMLInputElement | null>(null);
    const composeInputRef = useCallback(
      (el: HTMLInputElement | null) => {
        inputRef.current = el;
        if (typeof ref === "function") {
          ref(el);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
        }
      },
      [ref],
    );

    // Mounted flag used by the async paste continuation to avoid
    // writing to a detached input after unmount. useRef is enough
    // because reads in the continuation are synchronous relative to
    // React's render cycle.
    const mountedRef = useRef(true);
    React.useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);

    // Disabled inputs never handle actions — the early returns in each
    // handler defend against the dispatch layer somehow sending actions
    // to a disabled input (which shouldn't happen via normal focus, but
    // can happen if a consumer calls manager.dispatchTo(id, ...) directly).
    const handleCut = useCallback((): ActionHandlerResult => {
      if (effectiveDisabled) return;
      const el = inputRef.current;
      if (!el) return;
      // execCommand("cut") is the only API that integrates with the
      // native input's undo stack.
      document.execCommand("cut");
    }, [effectiveDisabled]);

    const handleCopy = useCallback((): ActionHandlerResult => {
      if (effectiveDisabled) return;
      document.execCommand("copy");
    }, [effectiveDisabled]);

    const handlePaste = useCallback((): ActionHandlerResult => {
      if (effectiveDisabled) return;
      const el = inputRef.current;
      if (!el) return;
      // Two-phase: start the async clipboard read inside the user
      // gesture (transient activation propagates through this call),
      // then insert in the continuation so a menu blink can precede
      // the DOM mutation if the dispatch came from a context menu.
      // Limitation: setRangeText does not push to the native undo
      // stack, so ⌘Z will not undo the paste. execCommand("paste") is
      // blocked in Chrome for web pages, so there is no better
      // alternative today.
      const readPromise =
        typeof navigator !== "undefined" && navigator.clipboard?.readText
          ? navigator.clipboard.readText().catch(() => "")
          : Promise.resolve("");
      return () => {
        void readPromise.then((text) => {
          if (!text) return;
          if (!mountedRef.current) return;
          const start = el.selectionStart ?? el.value.length;
          const end = el.selectionEnd ?? el.value.length;
          el.setRangeText(text, start, end, "end");
          // Fire a synthetic input event so React's onChange sees the
          // update and controlled inputs stay in sync.
          el.dispatchEvent(new Event("input", { bubbles: true }));
        });
      };
    }, [effectiveDisabled]);

    const handleSelectAll = useCallback((): ActionHandlerResult => {
      if (effectiveDisabled) return;
      inputRef.current?.select();
    }, [effectiveDisabled]);

    const handleUndo = useCallback((): ActionHandlerResult => {
      if (effectiveDisabled) return;
      document.execCommand("undo");
    }, [effectiveDisabled]);

    const handleRedo = useCallback((): ActionHandlerResult => {
      if (effectiveDisabled) return;
      document.execCommand("redo");
    }, [effectiveDisabled]);

    const responderId = useId();
    const { responderRef } = useResponder({
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

    // Compose three refs onto one input element: the forwarded ref
    // (from the consumer), the internal inputRef (used by handlers),
    // and the responderRef (writes data-responder-id for the chain's
    // findResponderForTarget walk).
    const composedRef = useCallback(
      (el: HTMLInputElement | null) => {
        composeInputRef(el);
        responderRef(el);
      },
      [composeInputRef, responderRef],
    );

    // ---- Context menu (right-click) ----
    //
    // Matches the tug-prompt-input precedent: on right-click over the
    // input, open a TugEditorContextMenu anchored at the cursor with
    // cut / copy / paste / selectAll items. Cut and Copy are disabled
    // when there is no ranged selection. Menu item activation
    // dispatches the item's action through the chain; the innermost-
    // first walk routes it right back to this input, which handles
    // it via the same execCommand / Clipboard API path used by the
    // keyboard shortcuts.
    //
    // The menu is a portaled positioned `<div>` that never steals
    // focus, so the input keeps its caret and selection while the
    // menu is open — clipboard commands run inside a user gesture
    // from the menu item's mousedown handler.
    const [menuState, setMenuState] = useState<{
      x: number;
      y: number;
      hasSelection: boolean;
    } | null>(null);

    const handleContextMenu = useCallback(
      (e: React.MouseEvent<HTMLInputElement>) => {
        if (effectiveDisabled) return;
        e.preventDefault();
        const el = inputRef.current;
        if (!el) return;
        // Native input right-click does NOT auto-select a word; it
        // positions the caret and enables Cut/Copy only if a prior
        // selection exists. Match that behavior.
        const hasSelection =
          el.selectionStart !== null &&
          el.selectionEnd !== null &&
          el.selectionStart !== el.selectionEnd;
        setMenuState({ x: e.clientX, y: e.clientY, hasSelection });
        onContextMenu?.(e);
      },
      [effectiveDisabled, onContextMenu],
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

    return (
      <>
        <input
          ref={composedRef}
          data-slot="tug-input"
          data-focus-style={focusStyle}
          data-borderless={borderless || undefined}
          className={buildInputClassName(size, validation, className)}
          disabled={effectiveDisabled}
          aria-invalid={validation === "invalid" ? "true" : undefined}
          onContextMenu={handleContextMenu}
          {...rest}
        />
        <TugEditorContextMenu
          open={menuState !== null}
          x={menuState?.x ?? 0}
          y={menuState?.y ?? 0}
          items={menuItems}
          onClose={closeMenu}
        />
      </>
    );
  },
);

// ---- Public component ----

/**
 * TugInput — chain-aware when inside a provider, plain when not.
 *
 * Branches at render time on the presence of a ResponderChainManager:
 * no provider → plain `<input>` render (pre-A2.7 behavior), provider
 * present → responder-wired render with cut/copy/paste/selectAll/
 * undo/redo handlers registered on the chain.
 *
 * Switching between the two variants across provider boundaries
 * remounts the input (React sees a different component type). This
 * is acceptable because ResponderChainProvider identity is stable in
 * real apps — the branch is effectively decided at mount.
 */
export const TugInput = React.forwardRef<HTMLInputElement, TugInputProps>(
  function TugInput(props, ref) {
    const manager = useResponderChain();
    if (manager === null) {
      return <TugInputPlain {...props} ref={ref} />;
    }
    return <TugInputWithResponder {...props} ref={ref} />;
  },
);
