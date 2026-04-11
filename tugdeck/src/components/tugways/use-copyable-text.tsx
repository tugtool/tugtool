/**
 * useCopyableText — hook for copyable components.
 *
 * Provides right-click → Copy for components that display informational
 * text the user might want to copy but should never directly select.
 * Examples: labels, timestamps, status lines.
 *
 * The hook:
 *   - Registers the component as a responder with a `copy` handler
 *   - Shows a TugEditorContextMenu on right-click with Copy enabled
 *     and Cut/Paste/SelectAll disabled
 *   - Copies the element's text content to the clipboard
 *   - Does NOT set user-select: text — the component inherits none
 *   - No visible selection highlight ever appears
 *
 * This is the "copyable" category from the three-category selection
 * model (selectable, copyable, chrome). See tuglaws/selection-model.md.
 *
 * Usage:
 *   const ref = useRef<HTMLElement>(null);
 *   const { composedRef, handleContextMenu, contextMenu } = useCopyableText({ ref });
 *   return (
 *     <>
 *       <span ref={composedRef} onContextMenu={handleContextMenu}>
 *         {timestamp}
 *       </span>
 *       {contextMenu}
 *     </>
 *   );
 *
 * Laws: [L11] controls emit actions; responders handle actions
 */

import React, { useCallback, useId, useMemo, useState } from "react";
import { TugEditorContextMenu, type TugEditorContextMenuEntry } from "./tug-editor-context-menu";
import { useOptionalResponder } from "./use-responder";
import { useResponderChain } from "./responder-chain-provider";
import type { ActionHandlerResult } from "./responder-chain";
import { TUG_ACTIONS } from "./action-vocabulary";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseCopyableTextOptions {
  /**
   * Ref to the host element. The hook reads `textContent` from it
   * for the copy handler. Must be the same element the returned
   * `composedRef` is attached to.
   */
  ref: React.MutableRefObject<HTMLElement | null>;
  /**
   * Optional override for the text to copy. When provided, the copy
   * handler uses this instead of `el.textContent`. Useful when the
   * element contains child elements whose text should be filtered.
   */
  getText?: () => string;
  /**
   * When true, the context menu is suppressed and the copy handler
   * is a no-op.
   */
  disabled?: boolean;
  /**
   * Forwarded ref from the consumer. Composed with the hook's
   * internal ref so both land on the same DOM element.
   */
  forwardedRef?: React.Ref<HTMLElement>;
}

export interface UseCopyableTextResult {
  /**
   * Attach to the host element. Populates the hook's internal ref,
   * applies the forwarded consumer ref, and writes data-responder-id
   * for chain resolution.
   */
  composedRef: (el: HTMLElement | null) => void;
  /**
   * Pass to the element's onContextMenu prop. Opens the Copy menu.
   */
  handleContextMenu: (e: React.MouseEvent) => void;
  /**
   * Render this alongside the element. Contains the TugEditorContextMenu
   * portal. Returns null outside a ResponderChainProvider.
   */
  contextMenu: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCopyableText({
  ref,
  getText,
  disabled,
  forwardedRef,
}: UseCopyableTextOptions): UseCopyableTextResult {
  const manager = useResponderChain();

  // ---- Menu state ----
  const [menuState, setMenuState] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenuState(null), []);

  // ---- Action handlers ----

  const handleCopy = useCallback((): ActionHandlerResult => {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;
    const text = getText ? getText() : (el.textContent ?? "");
    if (text) {
      void navigator.clipboard.writeText(text);
    }
  }, [ref, getText, disabled]);

  // ---- Responder registration ----

  const responderId = useId();

  const { responderRef } = useOptionalResponder({
    id: responderId,
    actions: {
      [TUG_ACTIONS.COPY]: handleCopy,
    },
  });

  // ---- Composed ref ----

  const composedRef = useCallback(
    (el: HTMLElement | null) => {
      (ref as React.MutableRefObject<HTMLElement | null>).current = el;
      responderRef(el);
      if (typeof forwardedRef === "function") {
        forwardedRef(el);
      } else if (forwardedRef) {
        (forwardedRef as React.MutableRefObject<HTMLElement | null>).current = el;
      }
    },
    [ref, responderRef, forwardedRef],
  );

  // ---- Context menu ----

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (disabled || !manager) return;
      e.preventDefault();
      setMenuState({ x: e.clientX, y: e.clientY });
    },
    [disabled, manager],
  );

  const menuItems = useMemo<TugEditorContextMenuEntry[]>(
    () => [
      { action: TUG_ACTIONS.CUT, label: "Cut", shortcut: "\u2318X", disabled: true },
      { action: TUG_ACTIONS.COPY, label: "Copy", shortcut: "\u2318C" },
      { action: TUG_ACTIONS.PASTE, label: "Paste", shortcut: "\u2318V", disabled: true },
      { type: "separator" },
      { action: TUG_ACTIONS.SELECT_ALL, label: "Select All", shortcut: "\u2318A", disabled: true },
    ],
    [],
  );

  const contextMenu = manager ? (
    <TugEditorContextMenu
      open={menuState !== null}
      x={menuState?.x ?? 0}
      y={menuState?.y ?? 0}
      items={menuItems}
      onClose={closeMenu}
    />
  ) : null;

  return { composedRef, handleContextMenu, contextMenu };
}
