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
 *   - **Caret**: a custom layer (`tug-edit/caret-layer.ts`) paints a
 *     single `tug-edit-caret` div at the head of the main selection
 *     when the editor is focused and the selection is collapsed.
 *     Native WebKit contentEditable caret is suppressed via
 *     `caret-color: transparent` on `.cm-content` because its paint
 *     cache stales across layout-shifting transitions (history-nav
 *     doc swap, typeahead deactivate, atom removal) and produced
 *     doubled-caret strokes.
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
 * transparent !important`. The latter collides with the
 * `.cm-content ::selection { color: ... }` glyph-recolor rule
 * declared below. The custom caret + selection layers together
 * cover what drawSelection would, without the precedence battle.
 *
 * Selectors covered:
 *
 *   `&`                            — editor root (.cm-editor)
 *   `.cm-content`                  — editable text surface; sets
 *                                    `caret-color: transparent` to
 *                                    suppress WebKit's native caret
 *                                    (the layer paints the visible
 *                                    one), `font-size`, and
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
  // Caret stroke color — applied to the `.tug-edit-caret` marker
  // painted by `caret-layer.ts`, NOT to `.cm-content`'s caret-color
  // (that's `transparent` to suppress the native caret).
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

  // Editable text surface. The native WebKit contentEditable caret
  // is suppressed (`caret-color: transparent`) because its paint
  // cache stales across layout-shifting transitions; the visible
  // caret is painted by `caret-layer.ts` instead. Explicit
  // font-size and line-height pin the line metrics so every line is
  // the same height regardless of contents — `caret-layer.ts` reads
  // `lineBlockAt(head).height` to size the caret stroke, so this
  // line-height directly controls caret height too.
  //
  // The four typography rules (`fontFamily`, `fontSize`,
  // `lineHeight`, `letterSpacing`) read CSS custom properties so the
  // React shell's `fontFamily` / `fontSize` / `lineHeight` /
  // `letterSpacing` props can override per-instance via inline
  // `style={{...}}` on the host wrapper without rebuilding the
  // theme. The variable names match `tug-prompt-input.css`'s tokens
  // so the same tokens drive both substrates; the inline fallbacks
  // here keep the rendered metrics stable when no token is set
  // (storybook, unit tests, or hosts that haven't loaded the theme
  // CSS).
  ".cm-content": {
    caretColor: "transparent",
    fontFamily: "var(--tug-font-family-editor, inherit)",
    fontSize: "var(--tug-font-size-editor, 14px)",
    lineHeight: "var(--tug-line-height-editor, 1.75)",
    letterSpacing: "var(--tug-letter-spacing-editor, normal)",
    padding: "8px 10px",
  },

  ".cm-line": {
    padding: "0",
  },

  // Pin every line's line-box to a uniform `1lh` (one line-height
  // unit) regardless of inline content. Without this, a line's
  // line-box height is the tallest inline content's height — text
  // glyphs, atom widgets (24px), or the CSS line-height, whichever
  // is largest. `caret-layer.ts` reads the rendered `.cm-line`
  // height to size the caret stroke; the ghost pins that height to
  // a constant tied to the configured `line-height`. Same trick
  // used by Slack, Discord, Linear and friends. Selection
  // unaffected because the pseudo isn't in the DOM tree — it
  // doesn't participate in the document model, only in line layout.
  // `1lh` is a CSS Values 4 length unit equal to the computed
  // line-height of the element, so it tracks any unit (unitless
  // multiplier, em, px) that callers pass through the
  // `lineHeight` prop.
  ".cm-line::before": {
    content: '""',
    display: "inline-block",
    width: "0",
    height: "1lh",
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

  // Caret-overlay layer painted by `tug-edit/caret-layer.ts`. The
  // layer is non-interactive — pointer events fall through to the
  // editable surface so clicks land on the right offset.
  ".tug-edit-caret-layer": {
    pointerEvents: "none",
  },

  // Caret blink animation — `steps(1)` produces the same hard
  // on/off cadence WebKit's native caret uses. Driven by the
  // layer's own animation declaration so the keyframes only run
  // while the editor is focused. Two animation names alternated on
  // each selection change would let us restart the blink cycle
  // (CM6's `cm-blink` / `cm-blink2` pattern), but for the substrate
  // a single keyframe is sufficient — the layer rebuilds on each
  // selectionSet, which restarts the animation implicitly.
  "&.cm-focused > .cm-scroller > .tug-edit-caret-layer": {
    animation: "tug-edit-caret-blink 1.2s steps(1) infinite",
  },

  "@keyframes tug-edit-caret-blink": {
    "0%": { opacity: 1 },
    "50%": { opacity: 0 },
    "100%": { opacity: 1 },
  },

  // The caret stroke itself. `caret-layer.ts` constructs each
  // marker with width=2, height=line-block — this rule colors it.
  ".tug-edit-caret": {
    backgroundColor: TOKENS.caret,
  },

  // While the user is mid mouse-drag (mousedown without mouseup
  // yet), suppress the caret entirely. The selection is in flux —
  // the moment `selectionSet` fires from the next mousemove, the
  // caret-layer would briefly paint a collapsed cursor at the
  // mousedown anchor before the range widens. Matches WebKit's
  // native behavior of hiding the caret during drag-selection.
  // Toggled by `tugCaretInteractionPlugin`'s mousedown / global
  // mouseup pair in `caret-layer.ts`.
  "&[data-tug-edit-dragging] .tug-edit-caret-layer": {
    display: "none",
  },

  // While the user is actively typing (any keydown within the last
  // ~500ms), freeze the blink animation and pin the caret to full
  // opacity. Standard text-editor behavior since the 1980s — the
  // caret stays solid during typing and resumes blinking after a
  // pause. Toggled by `tugCaretInteractionPlugin`'s keydown +
  // idle-timer in `caret-layer.ts`.
  "&[data-tug-edit-typing].cm-focused > .cm-scroller > .tug-edit-caret-layer": {
    animation: "none",
    opacity: 1,
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

  // Line-number gutter — rendered by the `lineNumbers()` extension
  // when the substrate's `lineNumbers` prop is true. Pairs the
  // tug-edit-specific alias tokens (defined in tug-edit.css's
  // component-scope `body` block) with the editor's typography
  // variables so the gutter inherits any prop-driven font / size /
  // line-height changes.
  //
  // CM6's default gutter has no background and no separator — the
  // gutter sits flush against `.cm-content`. We carry our own
  // background + right-edge border to read as a distinct column.
  //
  // Typography rules:
  //   - **font-size** is 90% of the content font-size (a `calc()`
  //     over the same `--tug-font-size-editor` variable that drives
  //     `.cm-content`). Numbers read as ancillary chrome, not as
  //     content peers.
  //   - **line-height** is computed in pixels via `calc()` over
  //     `--tug-font-size-editor` × `--tug-line-height-editor`. We
  //     do NOT use the unitless line-height multiplier directly:
  //     a unitless multiplier resolves against the gutter's *own*
  //     font-size (which we just shrank to 90%), so the gutter
  //     rows would be 90% as tall as content rows and lose
  //     vertical alignment. Multiplying the variables ourselves
  //     gives the same pixel line-height as the content,
  //     regardless of the gutter's font-size.
  ".cm-gutters": {
    backgroundColor: "var(--tugx-edit-gutter-bg-rest)",
    color: "var(--tugx-edit-gutter-text-rest)",
    borderRight: "1px solid var(--tugx-edit-gutter-border-rest)",
    fontFamily: "var(--tug-font-family-editor, inherit)",
    fontSize:
      "calc(var(--tug-font-size-editor, 14px) * 0.9)",
    lineHeight:
      "calc(var(--tug-font-size-editor, 14px) * var(--tug-line-height-editor, 1.75))",
    letterSpacing: "var(--tug-letter-spacing-editor, normal)",
  },

  // Per-line cell inside the gutter.
  //
  // - **Horizontal padding** gives the digit breathing room without
  //   nudging the content's column.
  // - **Vertical padding-top** is a small downward nudge that
  //   compensates for the smaller font sitting visually high in the
  //   row. Tunable.
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0.5px 8px 0 6px",
  },
});
