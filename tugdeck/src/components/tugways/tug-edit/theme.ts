/**
 * tug-edit/theme.ts — `EditorView.theme` extension binding CodeMirror 6
 * editor-internal selectors to the tug 7-element token system.
 *
 * The rules read CSS variables directly (`var(--tug7-…)`), so theme
 * switches at the application level (brio ↔ harmony) propagate to the
 * editor without remount and without explicit `subscribeThemeChange`
 * wiring [D06].
 *
 * Caret and selection rendering:
 *
 *   - **Caret**: native browser caret driven by `caret-color` on
 *     `.cm-content`. The browser sizes the caret to the line-box,
 *     and the `.cm-line::before` ghost element below pins every
 *     line's box to the line-height (≈24.5px) regardless of
 *     content, so the caret is uniform across text and atom
 *     positions.
 *   - **Selection**: a custom layer (`tug-edit/selection-layer.ts`)
 *     paints `.cm-selectionBackground` divs behind every non-empty
 *     range. These are real DOM nodes — they cover atom widgets
 *     cleanly and persist when the editor loses focus. Native
 *     `::selection` is suppressed below so it doesn't double-paint
 *     with the layer.
 *
 * This intentionally does NOT use `drawSelection` from
 * `@codemirror/view` — that bundles a styled `.cm-cursor` (which
 * wobbles between text and atom positions because it's sized by
 * `coordsAtPos`'s glyph rect) and a `Prec.highest` theme that
 * forces `caret-color: transparent !important` and `::selection:
 * transparent !important`. Both undermine the native-caret-with-
 * uniform-height approach used here.
 *
 * Selectors covered:
 *
 *   `&`                            — editor root (.cm-editor)
 *   `.cm-content`                  — editable text surface; sets
 *                                    `caret-color`, `font-size`, and
 *                                    `line-height`
 *   `.cm-line`                     — per-line wrapper
 *   `.cm-line::before`             — zero-width line-height-tall
 *                                    ghost that pins line-box height
 *                                    so the caret is uniform
 *   `.cm-content img[data-atom-label]`
 *                                  — atom widgets — vertical-align
 *                                    middle so a 24px atom never
 *                                    grows the line box past the
 *                                    line-height we set on
 *                                    `.cm-content`
 *   `.cm-selectionBackground`      — custom selection-layer overlay;
 *                                    active / inactive variants split
 *                                    on `&.cm-focused`
 *   `.cm-content ::selection`      — native ::selection — bg
 *                                    transparent (overlay handles
 *                                    background) and fg recolored to
 *                                    the selection-text token so
 *                                    selected glyphs read clearly
 *                                    against the overlay
 *   `&.cm-readonly`                — readonly state surface + text
 *
 * Line metrics: `.cm-content` carries an explicit `font-size` and
 * `line-height` so every line has the same height regardless of
 * whether it contains text, atoms, or both. The atom rendering path
 * (`tug-atom-img.ts`) bakes its layout against a 14px base; the
 * line-height of 1.75 (≈24.5px) accommodates the atom's 24px height
 * with a sub-pixel margin.
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
  // Active selection bg / fg use the CSS `Highlight` / `HighlightText`
  // system colors directly (see `.cm-selectionBackground` and
  // `.cm-content ::selection` rules below). System colors give us
  // pixel-perfect parity with native `::selection` rendering on
  // focused fields without needing to declare them as tokens here.
  // Inactive variant — applied to the selection overlay when the
  // editor itself has lost focus (e.g., the user clicked a nearby
  // button) but the selection should remain visibly present.
  // Cross-*card* inactive paint is a separate mechanism: the host
  // card routes the engine selection through
  // `selectionGuard.cardRanges` and the
  // `::highlight(inactive-selection)` Custom Highlight rule declared
  // in `tug-pane.css` ([L23]).
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

  // Editable text surface. The native caret is colored via
  // `caret-color`; the browser sizes it from the line's line-height
  // rather than the adjacent glyph's metrics, which is what we want
  // when atoms (24px tall) sit next to text (~18px tall). Explicit
  // font-size and line-height pin the line metrics so every line is
  // the same height regardless of contents.
  ".cm-content": {
    caretColor: TOKENS.caret,
    fontFamily: "inherit",
    fontSize: "14px",
    lineHeight: "1.75",
    padding: "8px 10px",
  },

  ".cm-line": {
    padding: "0",
  },

  // The browser sizes the caret to the tallest inline content in the
  // current line — text glyphs (~18px), atom widgets (24px), or the
  // CSS line-height, whichever is largest. Without something pinning
  // every line to a uniform tallest inline element, the caret jumps
  // height as it moves between text-only and atom-bearing positions.
  // The fix is the ghost-element trick: a zero-width, 1.75em-tall
  // inline-block prepended to every line via `::before`. The line's
  // tallest inline content is now always the ghost, so the caret is
  // always 1.75em (24.5px at 14px font-size). Selection unaffected
  // because the pseudo isn't in the DOM tree — it doesn't participate
  // in the document model, only in line layout. Used by Slack,
  // Discord, Linear and friends for the same reason.
  ".cm-line::before": {
    content: '""',
    display: "inline-block",
    width: "0",
    height: "1.75em",
    verticalAlign: "middle",
  },

  // Atom widgets render via `tug-atom-img.ts` as `<img>` elements with
  // an inline `vertical-align` offset designed for the host's flowing
  // text baseline. Inside the editor we pin them to vertical-align
  // middle so the 24px atom centers in the 24.5px line box and never
  // pushes the line box taller. `!important` is required because the
  // atom rendering applies vertical-align as an inline style.
  ".cm-content img[data-atom-label]": {
    verticalAlign: "middle !important",
  },

  // Selection overlay painted by `tug-edit/selection-layer.ts`.
  // The `.cm-selectionBackground` divs are layered behind the
  // editable surface, so they cover atom widgets cleanly and
  // persist when the editor loses focus.
  //
  // `--tugx-edit-selection-bg-rest` is a tug-edit-specific token
  // (defined in `brio.css` and `harmony.css`) that resolves to a
  // higher-chroma blue than the shared
  // `--tug7-surface-selection-primary-normal-plain-rest`. The
  // shared token is tuned for native `::selection` rendering,
  // where WebKit substitutes the OS system selection color on
  // focused fields and the literal CSS color is mostly cosmetic.
  // Our overlay is a `<div>` background — WebKit honors the
  // literal color verbatim, with no system substitution — so we
  // need a saturated source value to render as vivid blue
  // rather than the pale tint the shared token produces when
  // painted as a layer.
  // !important is required: CM6's base theme has a rule
  // `&light.cm-focused > .cm-scroller > .cm-selectionLayer
  // .cm-selectionBackground { background: #d7d4f0 }` (a pale lilac)
  // at specificity (0,6,0), which beats any plain selector we can
  // write. The shorthand `background` also resets `background-color`,
  // so a later longhand alone can't override it without an
  // `!important` win or matching specificity.
  ".cm-selectionBackground": {
    backgroundColor: "var(--tugx-edit-selection-bg-rest) !important",
  },

  // Dim the overlay to the tug "inactive" selection token when the
  // editor itself has lost focus (within a still-focused card,
  // e.g. the user clicked an adjacent button). Cross-card inactive
  // paint is handled at the pane level via `selectionGuard.cardRanges`
  // and the `::highlight(inactive-selection)` rule in `tug-pane.css`
  // ([L23]).
  "&:not(.cm-focused) .cm-selectionBackground": {
    backgroundColor: TOKENS.selectionBgInactive + " !important",
  },

  // Native ::selection paints the selected text glyphs themselves.
  // The overlay handles the background; setting `background:
  // transparent` here prevents a double-paint with the overlay,
  // and the `color` recolors the glyphs to the tug
  // selection-text token so they read clearly against the overlay.
  ".cm-content ::selection": {
    backgroundColor: "transparent",
    color: "var(--tug7-element-selection-text-normal-plain-rest)",
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
