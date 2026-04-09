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
 * actions (`cut`, `copy`, `paste`, `selectAll`, `undo`, `redo`) via
 * the shared `useTextInputResponder` hook. See its module docstring
 * for the execCommand-vs-Clipboard-API rationale, the two-phase
 * dispatch pattern, and the reason paste must run synchronously.
 * TugTextarea and TugValueInput consume the same hook.
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

import React, { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { useTugBoxDisabled } from "./internal/tug-box-context";
import { useResponderChain } from "./responder-chain-provider";
import { useTextInputResponder } from "./use-text-input-responder";
import { TugEditorContextMenu } from "./tug-editor-context-menu";

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

    // Local ref to the input DOM node — needed by the editing action
    // handlers in the shared hook to reach `selectionStart`,
    // `select()`, `setRangeText()`, etc.
    const inputRef = useRef<HTMLInputElement | null>(null);

    // All six editing actions, the right-click context menu, and
    // responder-node registration come from the shared hook. See
    // `use-text-input-responder.tsx` for the dispatch semantics,
    // paste-sync rationale, and disabled-guard rules.
    const {
      responderRef,
      menuState,
      handleContextMenu: openMenu,
      closeMenu,
      menuItems,
    } = useTextInputResponder({ inputRef, disabled: effectiveDisabled });

    // Compose three refs onto one input element: the forwarded ref
    // (from the consumer), the internal inputRef (used by handlers
    // inside the hook), and the responderRef (writes data-responder-id
    // for the chain's findResponderForTarget walk).
    const composedRef = useCallback(
      (el: HTMLInputElement | null) => {
        inputRef.current = el;
        if (typeof ref === "function") {
          ref(el);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
        }
        responderRef(el);
      },
      [ref, responderRef],
    );

    // Bridge the hook's menu opener with the consumer's optional
    // `onContextMenu` prop — the consumer still gets to observe the
    // event after the menu state has been set.
    const handleContextMenu = useCallback(
      (e: React.MouseEvent<HTMLInputElement>) => {
        openMenu(e);
        onContextMenu?.(e);
      },
      [openMenu, onContextMenu],
    );

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
