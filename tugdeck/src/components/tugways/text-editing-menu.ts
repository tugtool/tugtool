/**
 * text-editing-menu — single source of truth for the standard
 * cut / copy / paste / select-all context menu.
 *
 * The four items appear in the same order with the same labels and
 * the same shortcut hints across every text-bearing surface in the
 * suite — the prompt-entry editor, the transcript view, and any
 * future read-only or editable text surface that needs a context
 * menu. The disabled rules are the only thing that varies, and they
 * vary by capability:
 *
 *   - Cut requires a selection AND an editable surface.
 *   - Copy requires a selection.
 *   - Paste requires an editable surface.
 *   - Select All is always enabled.
 *
 * Consumers pass capability flags (`hasSelection`, `canEdit`) and
 * receive an items array shaped like both `TugContextMenu`'s and
 * `TugEditorContextMenu`'s entry types. The two component types are
 * structurally identical for the fields used here, so consumers
 * pass the result through with a single TypeScript cast at the
 * call site.
 *
 * Why a shared builder rather than a shared item type:
 *   - The two menu components (`TugContextMenu`, `TugEditorContextMenu`)
 *     have slightly different generic and field expectations beyond
 *     the four-item universe, and unifying their entry types is a
 *     larger refactor than this layer needs.
 *   - Capabilities are the part that legitimately varies; the labels,
 *     shortcuts, order, and disabled-rule shape are universal. A
 *     builder gates the variable part and pins the universal part.
 *
 * No icons. The standard text-editing menu is text-only across the
 * suite; the four labels read cleanly as a list and adding icons
 * would crowd the menu without informational gain. Consumer-specific
 * additions (e.g. a custom action above the separator) can pick
 * their own iconography in a follow-up shape — the builder doesn't
 * police that, it just owns the universal four.
 */

import { TUG_ACTIONS } from "./action-vocabulary";
import type { TugAction } from "./action-vocabulary";

/**
 * Capability flags read by `buildTextEditingMenuItems` to decide
 * which of the four items are enabled.
 */
export interface TextEditingMenuCapabilities {
  /**
   * True iff a non-collapsed selection exists and is in scope for
   * the menu's host (e.g. inside the cell that opened the menu).
   * When false: Cut and Copy are disabled — they would be no-ops.
   */
  hasSelection: boolean;
  /**
   * True iff the menu's host accepts text mutations. Editable
   * substrates (CodeMirror editor, contenteditable) pass `true`;
   * read-only surfaces (transcript view) pass `false`. When false:
   * Cut and Paste are disabled — they have nowhere to land.
   */
  canEdit: boolean;
}

/**
 * Shape of one entry in the universal text-editing menu. Only the
 * fields shared by `TugContextMenuEntry` and `TugEditorContextMenuEntry`
 * are described here; consumers cast at the use site.
 */
export interface TextEditingMenuEntry {
  /** Discriminator — `"item"` (default) or `"separator"`. */
  type?: "item" | "separator";
  /** Action to dispatch when the item activates. Omit on separators. */
  action?: TugAction;
  /** Visible label. Omit on separators. */
  label?: string;
  /** Keyboard-shortcut hint rendered after the label. Display only. */
  shortcut?: string;
  /** Disabled flag — non-interactive when true. */
  disabled?: boolean;
}

/**
 * Build the universal four-item text-editing menu. Order, labels,
 * and shortcut hints are fixed; disabled state is computed from
 * `caps`.
 */
export function buildTextEditingMenuItems(
  caps: TextEditingMenuCapabilities,
): TextEditingMenuEntry[] {
  const { hasSelection, canEdit } = caps;
  return [
    {
      action: TUG_ACTIONS.CUT,
      label: "Cut",
      shortcut: "⌘X",
      disabled: !hasSelection || !canEdit,
    },
    {
      action: TUG_ACTIONS.COPY,
      label: "Copy",
      shortcut: "⌘C",
      disabled: !hasSelection,
    },
    {
      action: TUG_ACTIONS.PASTE,
      label: "Paste",
      shortcut: "⌘V",
      disabled: !canEdit,
    },
    { type: "separator" },
    {
      action: TUG_ACTIONS.SELECT_ALL,
      label: "Select All",
      shortcut: "⌘A",
    },
  ];
}
