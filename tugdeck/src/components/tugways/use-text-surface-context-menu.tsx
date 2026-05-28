/**
 * useTextSurfaceContextMenu — single source of truth for right-click
 * context menus on text-bearing surfaces.
 *
 * Consolidates the menu-state, pointerdown capture, contextmenu
 * pipeline, and `TugEditorContextMenu` render that previously lived
 * inline (and slightly differently) in four places: the editor host
 * (`tug-text-editor`), the markdown view (`tug-markdown-view`), the
 * native-input responder (`use-text-input-responder`), and the
 * transcript cells (`dev-card-transcript`). Selection mechanics
 * (CM6 transactions, native input setSelectionRange, DOM
 * setBaseAndExtent) live in the consumer's `TextSelectionAdapter`;
 * this hook owns the React-side wiring that's identical across them.
 *
 * Each consumer:
 *   - Constructs an adapter for its surface.
 *   - Calls `useTextSurfaceContextMenu({ adapter, capabilities, ... })`.
 *   - Attaches the returned `onPointerDown` / `onContextMenu` to its
 *     surface element (via React event props or a native listener,
 *     depending on the consumer's existing pattern).
 *   - Renders the returned `menu` somewhere in its tree (it portals).
 *   - Registers its own action handlers on the responder chain — the
 *     hook does not own COPY/CUT/PASTE/SELECT_ALL implementations,
 *     because those are surface-specific (CodeMirror's clipboardExt,
 *     native execCommand, virtualized select-all CSS visual, etc.).
 *
 * Right-click pipeline (adapter-driven):
 *
 *   1. `onPointerDown(event)` — when `event.button === 2` and the
 *      adapter is non-null, calls `adapter.capturePreRightClick()` so
 *      the contextmenu handler can restore from a snapshot taken
 *      *before* the browser's mousedown ran.
 *
 *   2. `onContextMenu(event)` — calls `event.preventDefault` to
 *      suppress the system menu, then asks the adapter to run the
 *      right-click pipeline (`prepareSelectionForRightClick`). The
 *      adapter restores its snapshot, classifies the click, and
 *      either keeps the restored range (`within-range`/`near-caret`)
 *      or expands to a fresh word at the click point (`elsewhere`).
 *      The result is committed via the surface's native API (CM6
 *      transaction, `setSelectionRange`, DOM `setBaseAndExtent`),
 *      which is what makes the selection survive the
 *      `preventDefault` — WebKit reverts only its own tentative
 *      smart-click, not JS-driven commits.
 *
 *   3. The adapter returns the resulting `hasSelection`. The hook
 *      stores it on `menuState` and rebuilds the menu's items via
 *      `buildTextEditingMenuItems({ hasSelection, canEdit })` so
 *      Cut / Copy / Paste / Select All enablement is consistent
 *      across every surface.
 *
 * Optional `hasSelectionOverride`: a consumer can provide a function
 * that the hook calls *instead of* sampling from the adapter. The
 * markdown view uses this to fold its "logical select-all" CSS-visual
 * flag into Copy enablement — its virtualized select-all paints a CSS
 * class instead of holding a DOM Selection, so the menu's Cut / Copy
 * gates need to reflect the flag, not just the DOM range.
 *
 * Tuglaws cross-check:
 *   - [L02] no external store enters via this hook; menu open/close
 *     is `useState` (data the menu owns).
 *   - [L06] menu visibility (open / closed) is React state because the
 *     menu's lifecycle is structural — the portal mounts and
 *     unmounts based on it. Selection mutations stay in the DOM
 *     via the adapter; we never mirror selection into React state.
 *   - [L07] handlers register via the consumer's `useResponder` and
 *     are reached via the menu's `useControlDispatch` (targeted to
 *     `parentId`) inside `TugEditorContextMenu`; this hook never
 *     closes over stale handler closures — it doesn't own handlers.
 *   - [L11] the menu items dispatch typed `TugAction`s to the parent
 *     responder via `useControlDispatch` (`sendToTarget(parentId)`),
 *     the canonical "control dispatches to its parent responder"
 *     shape used by every other tugway control. The consumer must
 *     render the returned `menu` inside its own `<ResponderScope>`
 *     so `parentId` resolves to the consumer's responder; the
 *     editor, the markdown view, and the transcript cells already
 *     do this, and `useTextInputResponder` wraps the menu inside
 *     the input's scope before returning it.
 *   - [L12] selection mutations route through the adapter, which
 *     respects whatever boundary discipline `SelectionGuard` enforces
 *     for the surface's card.
 *   - [L19] component-authoring conventions: file pair (.tsx + this
 *     module docstring), exported props interface, no `data-slot`
 *     since the hook renders no DOM of its own (the menu's slot is
 *     `tug-editor-context-menu`).
 *   - [L23] adapters JS-commit selection so user-visible state
 *     survives the `preventDefault` that suppresses the system menu.
 *   - [L24] zone discipline: menuState (data) → React state, menu
 *     visibility (structure) → React render, menu hover paint
 *     (appearance) → CSS in tug-menu.css.
 */

import React, { useCallback, useMemo, useState } from "react";

import {
  TugEditorContextMenu,
  type TugEditorContextMenuEntry,
} from "./tug-editor-context-menu";
import {
  buildTextEditingMenuItems,
  type TextEditingMenuCapabilities,
} from "./text-editing-menu";
import type { TextSelectionAdapter } from "./text-selection-adapter";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Capability flags that drive the menu items' enabled state. A
 * narrowed view of `TextEditingMenuCapabilities` from
 * `text-editing-menu.ts` — `hasSelection` is sampled by the hook
 * itself (from the adapter or `hasSelectionOverride`), so consumers
 * supply only the surface-static `canEdit` flag.
 */
export type TextSurfaceCapabilities = Omit<TextEditingMenuCapabilities, "hasSelection">;

export interface UseTextSurfaceContextMenuOptions {
  /**
   * Selection adapter for the surface. The hook calls
   * `capturePreRightClick` on right-button pointerdown and
   * `prepareSelectionForRightClick` on contextmenu.
   *
   * `null` is supported for surfaces that have no selection model
   * (the menu still opens via the contextmenu listener; `hasSelection`
   * defaults to `false` unless `hasSelectionOverride` is supplied).
   */
  adapter: TextSelectionAdapter | null;

  /**
   * Whether the surface accepts text mutations (Cut, Paste). Read-only
   * surfaces (markdown view, transcript) pass `false`; editable
   * surfaces (editor, native input) pass `true`. Drives the menu
   * items' enabled state via `buildTextEditingMenuItems`.
   */
  capabilities: TextSurfaceCapabilities;

  /**
   * Optional override of the `hasSelection` sample taken from the
   * adapter. When supplied, the hook calls this function instead of
   * `adapter.prepareSelectionForRightClick`'s return value (the
   * adapter's selection work still runs; only the menu-enablement
   * sample is overridden). Used by `tug-markdown-view` to fold its
   * `selectAllActiveRef` (CSS-visual select-all flag) into Copy
   * enablement.
   */
  hasSelectionOverride?: () => boolean;
}

export interface UseTextSurfaceContextMenuResult {
  /**
   * Pointerdown handler. Attach to the surface element (via a
   * `pointerdown` native listener inside `useLayoutEffect`, or via a
   * React `onPointerDown` prop). On `event.button === 2`, calls
   * `adapter.capturePreRightClick()`.
   */
  onPointerDown: (event: PointerEvent) => void;

  /**
   * Contextmenu handler. Attach to the surface element. Calls
   * `preventDefault`, runs the adapter's right-click pipeline,
   * computes `hasSelection`, opens the menu at the click point.
   */
  onContextMenu: (event: MouseEvent) => void;

  /**
   * Render this in the consumer's tree. The menu portals to the
   * canvas overlay, so its DOM position doesn't matter — but its
   * React-tree position does control parent-context lookups for any
   * child responders inside the menu (currently none, but kept
   * consistent with the rest of the chain pattern).
   */
  menu: React.ReactNode;

  /**
   * Imperative close. Useful for consumer-driven dismissal (e.g.,
   * a programmatic action that should also close any open menu).
   */
  closeMenu: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface MenuState {
  x: number;
  y: number;
  hasSelection: boolean;
}

export function useTextSurfaceContextMenu(
  options: UseTextSurfaceContextMenuOptions,
): UseTextSurfaceContextMenuResult {
  const { adapter, capabilities, hasSelectionOverride } = options;

  // The single piece of React state the hook owns: open/closed +
  // anchor + hasSelection sample. `null` means closed. Open is
  // structural (the portal mounts / unmounts based on it) so it
  // belongs in React state per [L24].
  const [menuState, setMenuState] = useState<MenuState | null>(null);

  const closeMenu = useCallback(() => {
    setMenuState(null);
  }, []);

  // Pointerdown — only acts on right-button. Capture pre-click state
  // so the contextmenu handler can restore.
  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      if (event.button !== 2) return;
      adapter?.capturePreRightClick();
    },
    [adapter],
  );

  // Contextmenu — preventDefault, run adapter pipeline, compute
  // hasSelection, open the menu.
  const onContextMenu = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      let hasSelection = false;
      if (adapter !== null) {
        hasSelection = adapter.prepareSelectionForRightClick(
          event.clientX,
          event.clientY,
        );
      }
      // Override hook: markdown view's CSS-visual select-all is
      // hasSelection-true even when no DOM range exists.
      if (hasSelectionOverride !== undefined) {
        hasSelection = hasSelectionOverride();
      }
      setMenuState({ x: event.clientX, y: event.clientY, hasSelection });
    },
    [adapter, hasSelectionOverride],
  );

  // Build the menu items via the shared builder so every surface
  // shows the same labels, shortcuts, and order. Disabled state
  // follows from capabilities + hasSelection.
  const items = useMemo<TugEditorContextMenuEntry[]>(
    () =>
      buildTextEditingMenuItems({
        hasSelection: menuState?.hasSelection ?? false,
        canEdit: capabilities.canEdit,
      }) as TugEditorContextMenuEntry[],
    [menuState?.hasSelection, capabilities.canEdit],
  );

  // Only mount the menu component when there's an open state.
  // `TugEditorContextMenu` calls `useRequiredResponderChain` at the
  // top of its body — mounting it outside a chain provider throws,
  // even with `open: false`. Conditional mount mirrors the legacy
  // pattern (`{menuState !== null && <TugEditorContextMenu />}`) so
  // unit tests and standalone harnesses that never open the menu
  // don't need a chain provider just to instantiate the consumer.
  const menu =
    menuState !== null ? (
      <TugEditorContextMenu
        open
        x={menuState.x}
        y={menuState.y}
        items={items}
        onClose={closeMenu}
      />
    ) : null;

  return {
    onPointerDown,
    onContextMenu,
    menu,
    closeMenu,
  };
}
