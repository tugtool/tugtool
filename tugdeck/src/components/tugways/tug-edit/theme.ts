/**
 * tug-edit/theme.ts — `EditorView.theme` extension binding CodeMirror 6
 * editor-internal selectors to the tug 7-element token system.
 *
 * The rules read CSS variables directly (`var(--tug7-…)`), so theme
 * switches at the application level (brio ↔ harmony) propagate to the
 * editor without remount and without explicit `subscribeThemeChange`
 * wiring [D06].
 *
 * Selectors covered:
 *
 *   `&`                            — editor root (.cm-editor)
 *   `.cm-content`                  — editable text surface
 *   `.cm-line`                     — per-line wrapper (no own appearance)
 *   `.cm-cursor, .cm-dropCursor`   — primary caret + drop indicator
 *   `.cm-selectionBackground`      — span CM6 paints behind ranged selection
 *   `&.cm-focused .cm-selectionBackground`
 *                                  — active (focused) selection paint
 *   `&.cm-readonly`                — readonly state surface + text
 *
 * Host-wrapper styling (rest/hover/focus border, focus-style variants,
 * borderless modifier, disabled state) lives in `tug-edit.css` so it
 * participates in `audit-tokens lint`.
 *
 * Laws: [L06] appearance via CSS, [L15] token-driven control states,
 *        [L16] foreground-only rules — host wrapper rules in CSS carry
 *        @tug-renders-on annotations; the editor-internal rules in this
 *        file always pair element + surface together so they are
 *        self-documenting per L16, [L18] element/surface vocabulary,
 *        [L19] file structure, [L20] only own-scope tokens.
 */

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

// ---------------------------------------------------------------------------
// Token references
// ---------------------------------------------------------------------------

/**
 * Token references used in the theme. Centralized so future swaps (e.g.
 * promoting to `--tugx-edit-*` aliases per [L17]) happen in one place.
 */
const TOKENS = {
  contentFg: "var(--tug7-element-field-text-normal-plain-rest)",
  contentBg: "var(--tug7-surface-field-primary-normal-plain-rest)",
  contentBgFocus: "var(--tug7-surface-field-primary-normal-plain-focus)",
  contentBgDisabled: "var(--tug7-surface-field-primary-normal-plain-disabled)",
  contentFgDisabled: "var(--tug7-element-field-text-normal-plain-disabled)",
  contentBgReadonly: "var(--tug7-surface-field-primary-normal-plain-readonly)",
  contentFgReadonly: "var(--tug7-element-field-text-normal-plain-readonly)",
  caret: "var(--tug7-element-field-border-normal-plain-active)",
  selectionBgActive: "var(--tug7-surface-selection-primary-normal-plain-rest)",
  selectionFgActive: "var(--tug7-element-selection-text-normal-plain-rest)",
  selectionBgInactive: "var(--tug7-surface-selection-primary-normal-plain-inactive)",
} as const;

// ---------------------------------------------------------------------------
// tugTheme
// ---------------------------------------------------------------------------

/**
 * The CodeMirror 6 theme extension for `TugEdit`.
 *
 * Each rule pairs an element token with its surface token (or sets only
 * appearance properties whose surface is established by an enclosing
 * rule), so [L16] is satisfied without separate `@tug-renders-on`
 * annotations — the surface is in the same rule.
 */
export const tugTheme: Extension = EditorView.theme({
  // Editor root — establishes the surface and base content text color.
  "&": {
    color: TOKENS.contentFg,
    backgroundColor: TOKENS.contentBg,
    height: "100%",
  },

  // Editable text surface. CM6 hides the native caret via
  // `caret-color: transparent` on `.cm-content` and renders a styled
  // `.cm-cursor` div instead, so we keep the same convention here and
  // color the cursor explicitly below.
  ".cm-content": {
    caretColor: "transparent",
    fontFamily: "inherit",
    padding: "8px 10px",
  },

  ".cm-line": {
    padding: "0",
  },

  // Primary caret + drop-position indicator.
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: TOKENS.caret,
    borderLeftWidth: "1.5px",
  },

  // Inactive (blurred) ranged selection — CM6 still paints
  // `.cm-selectionBackground` when the editor is not focused; we use the
  // tug "inactive" selection surface so it visibly differs from the
  // focused state without going invisible.
  ".cm-selectionBackground, ::selection": {
    backgroundColor: TOKENS.selectionBgInactive,
  },

  // Active (focused) ranged selection — the normal native selection
  // appearance for tug surfaces.
  "&.cm-focused .cm-selectionBackground, &.cm-focused ::selection": {
    backgroundColor: TOKENS.selectionBgActive,
    color: TOKENS.selectionFgActive,
  },

  // Focus-state surface — subtle background tint shift in the default
  // focus style. Host-wrapper variants (`data-focus-style="ring"`) live
  // in `tug-edit.css`; this rule covers the default ("background") path
  // for the inner editing surface.
  "&.cm-focused": {
    backgroundColor: TOKENS.contentBgFocus,
    outline: "none",
  },

  // Readonly surface + text.
  "&.cm-readonly": {
    backgroundColor: TOKENS.contentBgReadonly,
    color: TOKENS.contentFgReadonly,
  },

  // Disabled surface + text. CM6 toggles the editable contenteditable
  // attribute when `EditorState.readOnly` is set; we treat the host
  // wrapper's `data-disabled` as the source of truth for visual state
  // and color the inner surface to match.
  "&[data-disabled]": {
    backgroundColor: TOKENS.contentBgDisabled,
    color: TOKENS.contentFgDisabled,
    cursor: "not-allowed",
  },
});
