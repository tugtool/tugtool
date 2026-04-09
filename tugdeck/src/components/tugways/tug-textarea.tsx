/**
 * TugTextarea — tugways public API for multi-line text inputs.
 *
 * Wraps a plain <textarea> element (not a Radix primitive). All visual states
 * are driven by --tug7-field-* tokens — theme switches update CSS
 * variables at the DOM level with no React re-renders.
 *
 * Auto-resize adjusts height imperatively via the native input event [L06].
 * Character counter renders below the textarea when maxLength is set.
 *
 * ## Chain participation (A2.7)
 *
 * When rendered inside a `<ResponderChainProvider>`, TugTextarea
 * registers itself as a responder node and handles the six standard
 * editing actions (`cut`, `copy`, `paste`, `selectAll`, `undo`,
 * `redo`), delegating to native DOM APIs on the underlying
 * `<textarea>` element. See `tug-input.tsx` for the detailed
 * rationale behind the execCommand-vs-Clipboard-API choices — the
 * same trade-offs apply here. Each textarea uses its own native undo
 * stack, and the chain's innermost-first walk routes actions to the
 * currently focused one via the focusin listener in
 * `responder-chain-provider.tsx`.
 *
 * Like TugInput, TugTextarea uses a two-path rendering strategy: it
 * falls back to a plain `<textarea>` render when no provider is in
 * scope, so it can still be used in standalone previews / tests.
 *
 * Laws: [L06] appearance via CSS / imperative DOM for auto-resize,
 *       [L11] controls emit actions; responders handle actions,
 *       [L15] token-driven states, [L16] pairings declared,
 *       [L19] component authoring guide
 * Decisions: [D04] token-driven control state model,
 *            [D05] component token naming
 */

import "./tug-textarea.css";

import React, { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
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

/** TugTextarea size names — matches TugInput and TugButton sizes */
export type TugTextareaSize = "sm" | "md" | "lg";

/** TugTextarea validation state */
export type TugTextareaValidation = "default" | "invalid" | "valid" | "warning";

/** TugTextarea resize direction */
export type TugTextareaResize = "horizontal" | "vertical" | "both";

/** TugTextarea props — extends native textarea attributes. */
export interface TugTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> {
  /**
   * Visual size variant.
   * @selector .tug-textarea-size-sm | .tug-textarea-size-md | .tug-textarea-size-lg
   * @default "md"
   */
  size?: TugTextareaSize;
  /**
   * Validation state. Controls border color.
   * @selector .tug-textarea-invalid | .tug-textarea-valid | .tug-textarea-warning
   * @default "default"
   */
  validation?: TugTextareaValidation;
  /**
   * User-resizable direction. Sets CSS resize property.
   * When omitted, the textarea is not user-resizable (resize: none).
   * @selector .tug-textarea-resize-horizontal | .tug-textarea-resize-vertical | .tug-textarea-resize-both
   * @default undefined (not resizable)
   */
  resize?: TugTextareaResize;
  /**
   * Number of visible text rows. Maps to the HTML rows attribute.
   * @default 3
   */
  rows?: number;
  /**
   * Maximum character count. When provided, renders a character counter
   * below the textarea showing "current / max".
   * @default undefined (no limit, no counter)
   */
  maxLength?: number;
  /**
   * Auto-resize: grow the textarea height to fit content, up to maxRows.
   * Implemented via imperative DOM height adjustment [L06].
   * @default false
   */
  autoResize?: boolean;
  /**
   * Maximum rows before scrolling kicks in. Only meaningful when autoResize is true.
   * @default undefined (no limit — grows indefinitely)
   */
  maxRows?: number;
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

// ---- Shared rendering helper ----
//
// Both the plain and responder-wired variants render identical JSX.
// The only seam is how the textarea's ref is composed: the plain
// variant forwards straight through to the consumer's ref, while the
// responder variant also writes data-responder-id via `extraRef`. By
// collapsing the rendering into a single helper, we keep the CSS
// classes, the auto-resize effect, the character counter, and the
// maxLength wrapper in one place.

interface TugTextareaBodyProps
  extends Omit<TugTextareaProps, "size" | "validation" | "resize" | "focusStyle" | "borderless"> {
  size: TugTextareaSize;
  validation: TugTextareaValidation;
  resize?: TugTextareaResize;
  focusStyle: "background" | "ring";
  borderless: boolean;
  /** Additional ref callback applied alongside the forwarded ref. */
  extraRef?: (el: HTMLTextAreaElement | null) => void;
  /** The forwarded ref from the public component. */
  forwardedRef: React.Ref<HTMLTextAreaElement>;
}

const TugTextareaBody: React.FC<TugTextareaBodyProps> = ({
  size,
  validation,
  resize,
  rows = 3,
  maxLength,
  autoResize = false,
  maxRows,
  focusStyle,
  borderless,
  className,
  disabled,
  onChange,
  value,
  defaultValue,
  extraRef,
  forwardedRef,
  ...rest
}) => {
  const boxDisabled = useTugBoxDisabled();
  const effectiveDisabled = disabled || boxDisabled;

  // Internal ref for imperative DOM manipulation; merged with forwarded
  // ref and the optional extraRef (responderRef).
  const internalRef = useRef<HTMLTextAreaElement | null>(null);

  // Counter state — track current character count for the counter display.
  const [charCount, setCharCount] = useState<number>(() => {
    if (value !== undefined) return String(value).length;
    if (defaultValue !== undefined) return String(defaultValue).length;
    return 0;
  });

  // Merge the forwarded ref, internal ref, and extraRef onto the one
  // textarea element. React calls setRef with the element on mount
  // and with null on unmount, so we must clean up the extraRef the
  // same way we clean up the forwarded ref.
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      internalRef.current = el;
      if (typeof forwardedRef === "function") {
        forwardedRef(el);
      } else if (forwardedRef) {
        (forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
      }
      extraRef?.(el);
    },
    [forwardedRef, extraRef],
  );

  // Auto-resize: adjust height imperatively on input events [L06].
  useLayoutEffect(() => {
    if (!autoResize) return;
    const el = internalRef.current;
    if (!el) return;

    const adjust = () => {
      // Collapse to auto so scrollHeight reflects content only.
      el.style.height = "auto";
      const scrollHeight = el.scrollHeight;

      if (maxRows) {
        const style = window.getComputedStyle(el);
        const lineHeight = parseFloat(style.lineHeight) || 16;
        const paddingTop = parseFloat(style.paddingTop) || 0;
        const paddingBottom = parseFloat(style.paddingBottom) || 0;
        const maxHeight = lineHeight * maxRows + paddingTop + paddingBottom;

        if (scrollHeight > maxHeight) {
          el.style.height = maxHeight + "px";
          el.style.overflow = "auto";
        } else {
          el.style.height = scrollHeight + "px";
          el.style.overflow = "hidden";
        }
      } else {
        el.style.height = scrollHeight + "px";
        el.style.overflow = "hidden";
      }
    };

    // Size on mount.
    adjust();

    // Listen to native input events for immediate response.
    el.addEventListener("input", adjust);
    return () => {
      el.removeEventListener("input", adjust);
    };
  }, [autoResize, maxRows]);

  // Handle onChange to track character count for the counter.
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setCharCount(e.target.value.length);
      onChange?.(e);
    },
    [onChange],
  );

  const textareaClassName = cn(
    "tug-textarea",
    `tug-textarea-size-${size}`,
    validation === "invalid" && "tug-textarea-invalid",
    validation === "valid" && "tug-textarea-valid",
    validation === "warning" && "tug-textarea-warning",
    resize && !autoResize && `tug-textarea-resize-${resize}`,
    autoResize && "tug-textarea-auto-resize",
    className,
  );

  // Determine counter color class.
  const counterClassName = cn(
    "tug-textarea-counter",
    maxLength !== undefined &&
      charCount >= maxLength &&
      "tug-textarea-counter-danger",
    maxLength !== undefined &&
      charCount < maxLength &&
      charCount >= maxLength - Math.ceil(maxLength * 0.1) &&
      "tug-textarea-counter-warning",
  );

  const textarea = (
    <textarea
      ref={setRef}
      data-slot="tug-textarea"
      data-focus-style={focusStyle}
      data-borderless={borderless || undefined}
      className={textareaClassName}
      disabled={effectiveDisabled}
      aria-invalid={validation === "invalid" ? "true" : undefined}
      rows={rows}
      maxLength={maxLength}
      value={value}
      defaultValue={defaultValue}
      onChange={handleChange}
      {...rest}
    />
  );

  if (maxLength !== undefined) {
    return (
      <div className="tug-textarea-wrapper">
        {textarea}
        <span className={counterClassName}>
          {charCount} / {maxLength}
        </span>
      </div>
    );
  }

  return textarea;
};

// ---- Plain variant (no provider) ----

const TugTextareaPlain = React.forwardRef<HTMLTextAreaElement, TugTextareaProps>(
  function TugTextareaPlain(
    {
      size = "md",
      validation = "default",
      resize,
      focusStyle = "background",
      borderless = false,
      ...rest
    },
    ref,
  ) {
    return (
      <TugTextareaBody
        size={size}
        validation={validation}
        resize={resize}
        focusStyle={focusStyle}
        borderless={borderless}
        forwardedRef={ref}
        {...rest}
      />
    );
  },
);

// ---- Responder variant (inside provider) ----

const TugTextareaWithResponder = React.forwardRef<HTMLTextAreaElement, TugTextareaProps>(
  function TugTextareaWithResponder(
    {
      size = "md",
      validation = "default",
      resize,
      focusStyle = "background",
      borderless = false,
      disabled,
      onContextMenu,
      ...rest
    },
    ref,
  ) {
    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;

    // Local ref to the textarea DOM node for the action handlers to
    // reach `select()`, `setRangeText()`, etc. Composed onto the
    // textarea alongside the forwarded ref and responderRef via the
    // shared body's `extraRef` slot.
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    // Mounted flag used by the async paste continuation to avoid
    // writing to a detached textarea after unmount.
    const mountedRef = useRef(true);
    React.useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);

    const handleCut = useCallback((): ActionHandlerResult => {
      if (effectiveDisabled) return;
      if (!textareaRef.current) return;
      document.execCommand("cut");
    }, [effectiveDisabled]);

    const handleCopy = useCallback((): ActionHandlerResult => {
      if (effectiveDisabled) return;
      document.execCommand("copy");
    }, [effectiveDisabled]);

    const handlePaste = useCallback((): ActionHandlerResult => {
      if (effectiveDisabled) return;
      const el = textareaRef.current;
      if (!el) return;
      // See tug-input.tsx for the execCommand-vs-Clipboard-API
      // rationale and the known undo-stack limitation of paste via
      // setRangeText.
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
    }, [effectiveDisabled]);

    const handleSelectAll = useCallback((): ActionHandlerResult => {
      if (effectiveDisabled) return;
      textareaRef.current?.select();
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

    // Compose the internal textareaRef with the responder ref via the
    // shared body's `extraRef` slot. The body handles merging the
    // forwarded ref itself.
    const extraRef = useCallback(
      (el: HTMLTextAreaElement | null) => {
        textareaRef.current = el;
        responderRef(el);
      },
      [responderRef],
    );

    // ---- Context menu (right-click) ----
    //
    // Same pattern as tug-input.tsx and tug-prompt-input.tsx: open a
    // portaled TugEditorContextMenu at the click coordinates with
    // cut/copy/paste/selectAll items. Menu item activation dispatches
    // through the chain and the innermost-first walk routes it back
    // to this textarea, which handles it via the normal handlers.
    const [menuState, setMenuState] = useState<{
      x: number;
      y: number;
      hasSelection: boolean;
    } | null>(null);

    const handleContextMenu = useCallback(
      (e: React.MouseEvent<HTMLTextAreaElement>) => {
        if (effectiveDisabled) return;
        e.preventDefault();
        const el = textareaRef.current;
        if (!el) return;
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
        <TugTextareaBody
          size={size}
          validation={validation}
          resize={resize}
          focusStyle={focusStyle}
          borderless={borderless}
          disabled={disabled}
          extraRef={extraRef}
          forwardedRef={ref}
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
 * TugTextarea — chain-aware when inside a provider, plain when not.
 *
 * Same two-path strategy as TugInput: if no `ResponderChainProvider`
 * is in scope, fall back to a plain `<textarea>` render; otherwise
 * register as a responder and wire the six editing actions.
 */
export const TugTextarea = React.forwardRef<
  HTMLTextAreaElement,
  TugTextareaProps
>(function TugTextarea(props, ref) {
  const manager = useResponderChain();
  if (manager === null) {
    return <TugTextareaPlain {...props} ref={ref} />;
  }
  return <TugTextareaWithResponder {...props} ref={ref} />;
});
