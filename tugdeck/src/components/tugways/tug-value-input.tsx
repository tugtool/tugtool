/**
 * TugValueInput — Compact inline numeric editor with formatted display.
 *
 * Standalone field for displaying and editing a single numeric value.
 * Supports formatted display (e.g. "75%"), type-to-replace on focus,
 * arrow key increment/decrement, validate-on-commit, and Escape to revert.
 * All input value management is imperative via refs — no React state for
 * the display/edit cycle. [L06]
 *
 * Per [L11], TugValueInput is a control that owns state the editing
 * actions operate on: a caret, selection, and the input's native
 * undo stack. Inside a `ResponderChainProvider` it registers as a
 * responder node and handles `cut` / `copy` / `paste` / `selectAll`
 * / `undo` / `redo` — delegating to native DOM APIs on the underlying
 * `<input>` element exactly like `tug-input.tsx` and `tug-textarea.tsx`.
 * It also dispatches a `setValue` action with `phase: "discrete"` on
 * every commit path (blur, Enter, arrow key). Outside a provider,
 * the input renders plainly without chain participation — matching
 * the two-path pattern from A2.7.
 *
 * When used standalone, parents bind via the `setValueNumber` slot
 * in `useResponderForm` using a gensym'd `senderId`. When nested
 * inside `TugSlider`, the slider passes its own `senderId` down so
 * both the slider drag and the value-input edits dispatch under the
 * same sender — the parent handler receives both and can branch on
 * `event.phase` (`"change"` for live scrub, `"discrete"` for the
 * text field commit).
 *
 * Right-click opens a `TugEditorContextMenu` anchored at the cursor
 * with cut / copy / paste / selectAll items (same precedent as
 * `tug-prompt-input`).
 *
 * Laws: [L06] appearance via DOM refs not React state,
 *       [L11] controls emit actions; responders handle actions,
 *       [L15] token-driven states, [L16] pairings declared,
 *       [L19] component authoring guide
 * Decisions: [D05] component token naming
 */

import "./tug-value-input.css";

import React, { useRef, useCallback, useId, useLayoutEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { TugFormatter } from "@/lib/tug-format";
import { clamp, validateNumericInput } from "@/lib/tug-validate";
import { useTugBoxDisabled } from "./internal/tug-box-context";
import { useResponderChain } from "./responder-chain-provider";
import { useResponder } from "./use-responder";
import type { ActionHandlerResult } from "./responder-chain";
import {
  TugEditorContextMenu,
  type TugEditorContextMenuEntry,
} from "./tug-editor-context-menu";

// ---- Props ----

export interface TugValueInputProps
  extends Omit<React.ComponentPropsWithoutRef<"input">, "value" | "onChange" | "defaultValue" | "type" | "size"> {
  /** Current numeric value. Display is derived from this via the formatter. */
  value: number;
  /**
   * Stable opaque sender id for chain dispatches. Auto-derived via
   * `useId()` if omitted. Parent responders disambiguate multi-input
   * forms by matching this id in their `setValue` handler bindings.
   * When nested inside `TugSlider`, the slider passes its own senderId
   * down so both the drag and text-input dispatches share the same
   * sender. [L11]
   */
  senderId?: string;
  /** Formatter for display/parse. When absent, shows raw number. */
  formatter?: TugFormatter<number>;
  /** Minimum value. Used for clamping on commit and arrow key lower bound. */
  min?: number;
  /** Maximum value. Used for clamping on commit and arrow key upper bound. */
  max?: number;
  /**
   * Step increment for arrow keys and snap-to-step on commit.
   * @default 1
   */
  step?: number;
  /**
   * Visual size variant.
   * @selector .tug-value-input-sm | .tug-value-input-md | .tug-value-input-lg
   * @default "md"
   */
  size?: "sm" | "md" | "lg";
  /**
   * What the input shows when focused for editing.
   * - "display" (default): stripped display-space number ("50%" → "50", "2.5 s" → "2.5")
   * - "raw": internal value ("50%" → "0.5")
   * @default "display"
   */
  editMode?: "display" | "raw";
  /**
   * @selector [aria-disabled="true"]
   * @default false
   */
  disabled?: boolean;
}

// ---- Helpers ----

/** Strip non-numeric decoration from a formatted string, keeping digits, decimal, and minus. */
function extractNumericPart(formatted: string): string {
  return formatted.replace(/[^0-9.\-]/g, "");
}

// ---- Shared editing hook ----
//
// Encapsulates all the imperative DOM value management (display/edit
// cycle, focus/blur/keydown handlers, ref tracking). Called by both
// the plain and responder variants so the variants don't duplicate
// ~200 lines of editing logic.

interface UseValueInputEditingOptions {
  value: number;
  formatter: TugFormatter<number> | undefined;
  min: number | undefined;
  max: number | undefined;
  step: number;
  editMode: "display" | "raw";
  dispatchCommit: (committed: number) => void;
}

interface UseValueInputEditingResult {
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  displayValue: string;
  inputWidth: string;
  handleFocus: () => void;
  handleMouseUp: (e: React.MouseEvent<HTMLInputElement>) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  handleBlur: () => void;
}

function useValueInputEditing({
  value,
  formatter,
  min,
  max,
  step,
  editMode,
  dispatchCommit,
}: UseValueInputEditingOptions): UseValueInputEditingResult {
  // ---- Imperative value management [L06] ----
  //
  // All input value changes go through DOM. No React state for the display/edit
  // cycle — this prevents re-renders on every keystroke and preserves text selection.
  const inputRef = useRef<HTMLInputElement | null>(null);
  const editingRef = useRef<boolean>(false);
  const escapeRef = useRef<boolean>(false);
  // Guards against mouseup deselecting text after click-to-focus.
  const justFocusedRef = useRef<boolean>(false);

  // ---- Input width based on max value length ----
  const displayMax = formatter ? formatter.format(max ?? 100) : String(max ?? 100);
  const inputWidth = `${displayMax.length + 2}ch`;

  // ---- Sync display value when not editing [L06] ----
  //
  // When value prop changes externally (e.g. slider drag, parent state update)
  // and the input is not being edited, update the DOM directly.
  const displayValue = formatter ? formatter.format(value) : String(value);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input && !editingRef.current) {
      input.value = displayValue;
    }
  }, [displayValue]);

  // ---- Focus handler ----
  const handleFocus = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    editingRef.current = true;
    escapeRef.current = false;
    justFocusedRef.current = true;

    if (editMode === "raw") {
      // Show internal value: "50%" → "0.5"
      input.value = String(value);
    } else {
      // Show display-space number without decoration: "50%" → "50", "2.5 s" → "2.5"
      const formatted = formatter ? formatter.format(value) : String(value);
      input.value = extractNumericPart(formatted);
    }
    input.select();
  }, [value, formatter, editMode]);

  // ---- MouseUp handler ----
  //
  // Prevent the mouseup after click-to-focus from placing the cursor
  // and deselecting the text. Only suppressed on the first mouseup
  // after focus — subsequent clicks within the field work normally.
  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLInputElement>) => {
      if (justFocusedRef.current) {
        e.preventDefault();
        justFocusedRef.current = false;
      }
    },
    [],
  );

  // ---- KeyDown handler ----
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.currentTarget.blur();
      } else if (e.key === "Escape") {
        escapeRef.current = true;
        // Revert to display value before blurring.
        const display = formatter ? formatter.format(value) : String(value);
        e.currentTarget.value = display;
        editingRef.current = false;
        e.currentTarget.blur();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const effectiveMax = max ?? Infinity;
        const next = clamp(value + step, -Infinity, effectiveMax);
        // Guard: at max, clamp returns value unchanged — no dispatch.
        if (next !== value) dispatchCommit(next);
        const input = inputRef.current;
        if (input) {
          const formatted = formatter ? formatter.format(next) : String(next);
          input.value = editMode === "display" ? extractNumericPart(formatted) : String(next);
          input.select();
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const effectiveMin = min ?? -Infinity;
        const next = clamp(value - step, effectiveMin, Infinity);
        // Guard: at min, clamp returns value unchanged — no dispatch.
        if (next !== value) dispatchCommit(next);
        const input = inputRef.current;
        if (input) {
          const formatted = formatter ? formatter.format(next) : String(next);
          input.value = editMode === "display" ? extractNumericPart(formatted) : String(next);
          input.select();
        }
      }
    },
    [value, formatter, editMode, min, max, step, dispatchCommit],
  );

  // ---- Blur handler ----
  const handleBlur = useCallback(() => {
    const input = inputRef.current;
    editingRef.current = false;

    if (escapeRef.current) {
      escapeRef.current = false;
      return;
    }

    // Parse the typed text back to an internal value.
    const raw = input?.value ?? "";
    const effectiveMin = min ?? -Infinity;
    const effectiveMax = max ?? Infinity;
    let parsed: number | null = null;

    if (formatter) {
      // Try formatter parse first — handles decorated input ("75%", "$42").
      parsed = formatter.parse(raw);
      // If that fails and we're in display mode, the user may have typed a
      // bare number in display space (e.g., "75" meaning 75%). Re-decorate
      // and parse again.
      if (parsed === null && editMode === "display") {
        // Attempt to reconstruct: format a known value, replace its numeric
        // portion with the user's input, then parse the result.
        const template = formatter.format(value);
        const reconstructed = template.replace(extractNumericPart(template), raw);
        parsed = formatter.parse(reconstructed);
      }
    }

    // Clamp and snap if formatter parse succeeded.
    if (parsed !== null) {
      parsed = clamp(parsed, effectiveMin, effectiveMax);
      const base = effectiveMin === -Infinity ? 0 : effectiveMin;
      parsed = Math.round((parsed - base) / step) * step + base;
    }

    // Fall back to plain numeric validation if no formatter or formatter failed.
    if (parsed === null) {
      parsed = validateNumericInput(raw, { min: effectiveMin, max: effectiveMax, step });
    }

    // Only dispatch when the parsed value actually differs from
    // the current prop. Tabbing through a form of untouched inputs
    // would otherwise fire one spurious `setValue` dispatch per
    // blur — the equality guard saves every responder in the chain
    // walk from re-evaluating identical payloads.
    if (parsed !== null && parsed !== value) {
      dispatchCommit(parsed);
    }

    // Restore display format (whether committed or reverted).
    if (input) {
      const committed = parsed ?? value;
      input.value = formatter ? formatter.format(committed) : String(committed);
    }
  }, [min, max, step, value, formatter, editMode, dispatchCommit]);

  return {
    inputRef,
    displayValue,
    inputWidth,
    handleFocus,
    handleMouseUp,
    handleKeyDown,
    handleBlur,
  };
}

// ---- Shared rendering ----

function buildInputClassName(
  size: "sm" | "md" | "lg",
  className: string | undefined,
): string {
  return cn("tug-value-input", `tug-value-input-${size}`, className);
}

// ---- Plain variant (no provider) ----

const TugValueInputPlain = React.forwardRef<HTMLInputElement, TugValueInputProps>(
  function TugValueInputPlain(
    {
      value,
      senderId: _senderId,
      formatter,
      min,
      max,
      step = 1,
      size = "md",
      editMode = "display",
      disabled = false,
      className,
      style,
      ...rest
    },
    ref,
  ) {
    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;

    // No provider → dispatch is a no-op. Editing still works natively.
    const dispatchCommit = useCallback((_v: number) => {
      /* no-op — no manager in scope */
    }, []);

    const editing = useValueInputEditing({
      value,
      formatter,
      min,
      max,
      step,
      editMode,
      dispatchCommit,
    });

    const mergedRef = useCallback(
      (node: HTMLInputElement | null) => {
        editing.inputRef.current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
        }
      },
      [ref, editing.inputRef],
    );

    return (
      <input
        ref={mergedRef}
        type="text"
        data-slot="tug-value-input"
        className={buildInputClassName(size, className)}
        defaultValue={editing.displayValue}
        style={{ width: editing.inputWidth, ...style }}
        aria-disabled={effectiveDisabled || undefined}
        aria-label="Value"
        onFocus={editing.handleFocus}
        onMouseUp={editing.handleMouseUp}
        onKeyDown={editing.handleKeyDown}
        onBlur={editing.handleBlur}
        {...rest}
      />
    );
  },
);

// ---- Responder variant (inside provider) ----

const TugValueInputWithResponder = React.forwardRef<HTMLInputElement, TugValueInputProps>(
  function TugValueInputWithResponder(
    {
      value,
      senderId,
      formatter,
      min,
      max,
      step = 1,
      size = "md",
      editMode = "display",
      disabled = false,
      className,
      style,
      onContextMenu,
      ...rest
    },
    ref,
  ) {
    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;

    // ---- Chain dispatch [L11] ----
    const manager = useResponderChain();
    const fallbackSenderId = useId();
    const effectiveSenderId = senderId ?? fallbackSenderId;
    const dispatchCommit = useCallback(
      (committed: number) => {
        if (!manager) return;
        manager.dispatch({
          action: "setValue",
          value: committed,
          sender: effectiveSenderId,
          phase: "discrete",
        });
      },
      [manager, effectiveSenderId],
    );

    const editing = useValueInputEditing({
      value,
      formatter,
      min,
      max,
      step,
      editMode,
      dispatchCommit,
    });

    // Mounted flag for paste continuation — prevents writing to a
    // detached input after unmount.
    const mountedRef = useRef(true);
    React.useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);

    // ---- Editing action handlers ----
    //
    // Mirror the `tug-input.tsx` pattern: execCommand for
    // cut/copy/undo/redo (native undo-stack integration), native
    // `select()` for selectAll, and Clipboard API + `setRangeText`
    // for paste (two-phase continuation).
    const handleCut = useCallback((): ActionHandlerResult => {
      if (effectiveDisabled) return;
      if (!editing.inputRef.current) return;
      document.execCommand("cut");
    }, [effectiveDisabled, editing.inputRef]);

    const handleCopy = useCallback((): ActionHandlerResult => {
      if (effectiveDisabled) return;
      document.execCommand("copy");
    }, [effectiveDisabled]);

    const handlePaste = useCallback((): ActionHandlerResult => {
      if (effectiveDisabled) return;
      const el = editing.inputRef.current;
      if (!el) return;
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
          el.dispatchEvent(new Event("input", { bubbles: true }));
        });
      };
    }, [effectiveDisabled, editing.inputRef]);

    const handleSelectAll = useCallback((): ActionHandlerResult => {
      if (effectiveDisabled) return;
      editing.inputRef.current?.select();
    }, [effectiveDisabled, editing.inputRef]);

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

    // Compose three refs onto one input: internal (for editing
    // handlers), forwarded (for consumer), responder (for
    // data-responder-id).
    const composedRef = useCallback(
      (node: HTMLInputElement | null) => {
        editing.inputRef.current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
        }
        responderRef(node);
      },
      [ref, editing.inputRef, responderRef],
    );

    // ---- Context menu ----
    const [menuState, setMenuState] = useState<{
      x: number;
      y: number;
      hasSelection: boolean;
    } | null>(null);

    const handleContextMenu = useCallback(
      (e: React.MouseEvent<HTMLInputElement>) => {
        if (effectiveDisabled) return;
        e.preventDefault();
        const el = editing.inputRef.current;
        if (!el) return;
        const hasSelection =
          el.selectionStart !== null &&
          el.selectionEnd !== null &&
          el.selectionStart !== el.selectionEnd;
        setMenuState({ x: e.clientX, y: e.clientY, hasSelection });
        onContextMenu?.(e);
      },
      [effectiveDisabled, onContextMenu, editing.inputRef],
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
          type="text"
          data-slot="tug-value-input"
          className={buildInputClassName(size, className)}
          defaultValue={editing.displayValue}
          style={{ width: editing.inputWidth, ...style }}
          aria-disabled={effectiveDisabled || undefined}
          aria-label="Value"
          onFocus={editing.handleFocus}
          onMouseUp={editing.handleMouseUp}
          onKeyDown={editing.handleKeyDown}
          onBlur={editing.handleBlur}
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
 * TugValueInput — chain-aware when inside a provider, plain when not.
 *
 * Branches at render time on the presence of a ResponderChainManager:
 * no provider → plain `<input>` render with the native editing cycle;
 * provider present → responder-wired render with cut/copy/paste/
 * selectAll/undo/redo handlers registered on the chain, plus a
 * right-click context menu dispatching the same actions.
 */
export const TugValueInput = React.forwardRef<HTMLInputElement, TugValueInputProps>(
  function TugValueInput(props, ref) {
    const manager = useResponderChain();
    if (manager === null) {
      return <TugValueInputPlain {...props} ref={ref} />;
    }
    return <TugValueInputWithResponder {...props} ref={ref} />;
  },
);
