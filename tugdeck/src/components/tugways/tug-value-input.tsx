/**
 * TugValueInput — Compact inline numeric editor with formatted display.
 *
 * Standalone field for displaying and editing a single numeric value.
 * Supports formatted display (e.g. "75%"), type-to-replace on focus,
 * arrow key increment/decrement, validate-on-commit, and Escape to revert.
 * All input value management is imperative via refs — no React state for
 * the display/edit cycle. [L06]
 *
 * Per [L11], TugValueInput is a control: on commit (blur, Enter, or arrow
 * increment/decrement) it dispatches a `setValue` action with `phase:
 * "discrete"` through the responder chain. Every commit path is discrete
 * because a text input has no scrub semantics — there's no begin/change/
 * commit window like a slider drag. Escape reverts without dispatching.
 *
 * When used standalone (e.g. numeric fields in settings forms), parents
 * bind via the `setValueNumber` slot in `useResponderForm` using a
 * gensym'd `senderId`. When nested inside `TugSlider`, the slider passes
 * its own `senderId` down so both the slider drag and the value-input
 * edits dispatch under the same sender — the parent handler receives
 * both and can branch on `event.phase` (`"change"` for live scrub,
 * `"discrete"` for the text field commit).
 *
 * Laws: [L06] appearance via DOM refs not React state,
 *       [L11] controls emit actions; responders handle actions,
 *       [L15] token-driven states, [L16] pairings declared,
 *       [L19] component authoring guide
 * Decisions: [D05] component token naming
 */

import "./tug-value-input.css";

import React, { useRef, useCallback, useId, useLayoutEffect } from "react";
import { cn } from "@/lib/utils";
import type { TugFormatter } from "@/lib/tug-format";
import { clamp, validateNumericInput } from "@/lib/tug-validate";
import { useTugBoxDisabled } from "./internal/tug-box-context";
import { useResponderChain } from "./responder-chain-provider";

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

// ---- TugValueInput ----

export const TugValueInput = React.forwardRef<HTMLInputElement, TugValueInputProps>(
  function TugValueInput(
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
      ...rest
    },
    ref,
  ) {
    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;

    // ---- Chain dispatch [L11] ----
    //
    // All commit paths (blur, Enter, arrow keys) dispatch `setValue`
    // with `phase: "discrete"`. The manager is null in standalone
    // previews / unit tests that don't mount a ResponderChainProvider
    // — in that case dispatches become no-ops, matching A2 convention.
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

    // ---- Imperative value management [L06] ----
    //
    // All input value changes go through DOM. No React state for the display/edit
    // cycle — this prevents re-renders on every keystroke and preserves text selection.

    const inputRef = useRef<HTMLInputElement>(null);
    const editingRef = useRef<boolean>(false);
    const escapeRef = useRef<boolean>(false);
    // Guards against mouseup deselecting text after click-to-focus.
    const justFocusedRef = useRef<boolean>(false);

    // ---- Merge forwarded ref with local ref ----

    const mergedRef = useCallback(
      (node: HTMLInputElement | null) => {
        (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
        }
      },
      [ref],
    );

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
          dispatchCommit(next);
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
          dispatchCommit(next);
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

      if (parsed !== null) {
        dispatchCommit(parsed);
      }

      // Restore display format (whether committed or reverted).
      if (input) {
        const committed = parsed ?? value;
        input.value = formatter ? formatter.format(committed) : String(committed);
      }
    }, [min, max, step, value, formatter, editMode, dispatchCommit]);

    return (
      <input
        ref={mergedRef}
        type="text"
        data-slot="tug-value-input"
        className={cn("tug-value-input", `tug-value-input-${size}`, className)}
        defaultValue={displayValue}
        style={{ width: inputWidth, ...style }}
        aria-disabled={effectiveDisabled || undefined}
        aria-label="Value"
        onFocus={handleFocus}
        onMouseUp={handleMouseUp}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        {...rest}
      />
    );
  },
);
