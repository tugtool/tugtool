/**
 * Shared contrast exception sets — Phase 2 ground truth.
 *
 * This module consolidates all contrast exception sets from across the test suite.
 * Each entry is annotated with [design-choice] or [phase-3-bug] to provide
 * machine-parseable categorisation for Phase 3 work planning.
 *
 * Machine query examples:
 *   grep '\[phase-3-bug\]' contrast-exceptions.ts
 *   grep '\[design-choice\]' contrast-exceptions.ts
 *
 * References: [D03], Spec S03, #exception-module-structure
 */

// ---------------------------------------------------------------------------
// KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS
//
// Element tokens that the derivation engine produces below perceptual contrast
// thresholds for known structural or design reasons. These are excluded from
// the zero-unexpected-failures assertions so the tests track real regressions
// rather than documented design constraints.
// ---------------------------------------------------------------------------

/**
 * Element (fg/icon/border) tokens known to be below contrast thresholds by design
 * or by structural engine constraints that are not regressions.
 */
export const KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS: ReadonlySet<string> = new Set([
  // A — secondary / tertiary text hierarchy (intentionally reduced contrast)
  "--tug-base-fg-subtle", // [design-choice] tertiary text: visual hierarchy below primary
  "--tug-base-fg-placeholder", // [design-choice] placeholder: intentionally subdued input hint
  "--tug-base-fg-link-hover", // [design-choice] link hover: brand hue recognition > max contrast
  "--tug-base-fg-link", // [design-choice] link: brand hue recognition > max contrast
  "--tug-base-control-selected-fg", // [design-choice] selected item label on translucent tint; composited stack passes
  "--tug-base-control-highlighted-fg", // [design-choice] highlighted item label on translucent tint; composited stack passes
  "--tug-base-selection-fg", // [design-choice] text-selection overlay fg; composited stack passes

  // B — text/icon on vivid accent or semantic backgrounds (design constraint)
  "--tug-base-fg-onAccent", // [design-choice] on-fill text for accent fills; accent hue is vivid mid-tone
  "--tug-base-icon-onAccent", // [design-choice] on-fill icon for accent fills; same constraint as fg-onAccent
  "--tug-base-fg-onDanger", // [design-choice] on-fill text for danger fills; danger bg creates contrast ~53 ceiling

  // C — interactive state tokens on vivid colored filled button backgrounds
  // (hover/active states are transient; filled button bg hues may be vivid mid-tones)
  "--tug-base-control-filled-accent-fg-hover", // [design-choice] transient hover state on vivid accent bg
  "--tug-base-control-filled-accent-fg-active", // [design-choice] transient active state on vivid accent bg
  "--tug-base-control-filled-accent-icon-hover", // [design-choice] transient hover state on vivid accent bg
  "--tug-base-control-filled-accent-icon-active", // [design-choice] transient active state on vivid accent bg
  "--tug-base-control-filled-action-fg-hover", // [design-choice] transient hover state on vivid action bg
  "--tug-base-control-filled-action-fg-active", // [design-choice] transient active state on vivid action bg
  "--tug-base-control-filled-action-icon-hover", // [design-choice] transient hover state on vivid action bg
  "--tug-base-control-filled-action-icon-active", // [design-choice] transient active state on vivid action bg
  "--tug-base-control-filled-danger-fg-hover", // [design-choice] transient hover state on vivid danger bg
  "--tug-base-control-filled-danger-fg-active", // [design-choice] transient active state on vivid danger bg
  "--tug-base-control-filled-danger-icon-hover", // [design-choice] transient hover state on vivid danger bg
  "--tug-base-control-filled-danger-icon-active", // [design-choice] transient active state on vivid danger bg
  "--tug-base-control-filled-agent-fg-hover", // [design-choice] transient hover state on vivid agent bg
  "--tug-base-control-filled-agent-fg-active", // [design-choice] transient active state on vivid agent bg
  "--tug-base-control-filled-agent-icon-hover", // [design-choice] transient hover state on vivid agent bg
  "--tug-base-control-filled-agent-icon-active", // [design-choice] transient active state on vivid agent bg
  "--tug-base-control-filled-data-fg-hover", // [design-choice] transient hover on vivid data bg; teal hue ceiling constraint
  "--tug-base-control-filled-data-fg-active", // [design-choice] transient active on vivid data bg; teal hue ceiling constraint
  "--tug-base-control-filled-data-icon-hover", // [design-choice] transient hover on vivid data bg; teal hue ceiling constraint
  "--tug-base-control-filled-data-icon-active", // [design-choice] transient active on vivid data bg; teal hue ceiling constraint
  "--tug-base-control-filled-success-fg-hover", // [design-choice] transient hover on vivid success bg; green hue ceiling constraint
  "--tug-base-control-filled-success-fg-active", // [design-choice] transient active on vivid success bg
  "--tug-base-control-filled-success-icon-hover", // [design-choice] transient hover on vivid success bg
  "--tug-base-control-filled-success-icon-active", // [design-choice] transient active on vivid success bg
  "--tug-base-control-filled-caution-fg-hover", // [design-choice] caution-bg-hover at t=40 (L=0.75); structural ceiling
  "--tug-base-control-filled-caution-fg-active", // [design-choice] caution-bg-active at t=50; structural ceiling
  "--tug-base-control-filled-caution-icon-hover", // [design-choice] transient hover on caution bg
  "--tug-base-control-filled-caution-icon-active", // [design-choice] transient active on caution bg

  // C2 — outlined/ghost hover/active: transparent bg means fg contrast is against parent surface
  "--tug-base-control-outlined-action-fg-hover", // [design-choice] transparent bg hover; contrast measured against parent surface
  "--tug-base-control-outlined-action-fg-active", // [design-choice] transparent bg active; contrast measured against parent surface
  "--tug-base-control-outlined-action-icon-hover", // [design-choice] transparent bg hover; contrast measured against parent surface
  "--tug-base-control-outlined-action-icon-active", // [design-choice] transparent bg active; contrast measured against parent surface
  "--tug-base-control-outlined-agent-fg-rest", // [design-choice] outlined agent: colored bg reduces default fg contrast in dark mode
  "--tug-base-control-outlined-agent-fg-hover", // [design-choice] agent hue at rest lightness; structural
  "--tug-base-control-outlined-agent-fg-active", // [design-choice] agent hue at rest lightness; structural
  "--tug-base-control-outlined-agent-icon-rest", // [design-choice] outlined agent icon at rest state
  "--tug-base-control-outlined-agent-icon-hover", // [design-choice] agent hue at hover lightness
  "--tug-base-control-outlined-agent-icon-active", // [design-choice] agent hue at active lightness

  // C3 — ghost-danger rest/hover/active: danger hue at mid-tone is below contrast 60 large-text
  "--tug-base-control-ghost-danger-fg-rest", // [design-choice] danger hue mid-tone; contrast ~40-41 below large-text threshold 60
  "--tug-base-control-ghost-danger-fg-hover", // [design-choice] danger hue hover state; same structural constraint
  "--tug-base-control-ghost-danger-fg-active", // [design-choice] danger hue active state; same structural constraint
  "--tug-base-control-ghost-danger-icon-active", // [design-choice] danger hue active icon; same structural constraint

  // D — semantic tone tokens (status/informational colors — medium visual weight by design)
  "--tug-base-tone-accent-fg", // [design-choice] semantic signal token; mid-tone hue for visual weight, not primary text contrast
  "--tug-base-tone-active-fg", // [design-choice] semantic signal token; mid-tone hue
  "--tug-base-tone-agent-fg", // [design-choice] semantic signal token; mid-tone hue
  "--tug-base-tone-data-fg", // [design-choice] semantic signal token; mid-tone hue
  "--tug-base-tone-success-fg", // [design-choice] semantic signal token; mid-tone hue
  "--tug-base-tone-caution-fg", // [design-choice] semantic signal token; mid-tone hue
  "--tug-base-tone-danger-fg", // [design-choice] semantic signal token; mid-tone hue
  "--tug-base-tone-accent-icon", // [design-choice] semantic signal icon; mid-tone hue
  "--tug-base-tone-active-icon", // [design-choice] semantic signal icon; mid-tone hue
  "--tug-base-tone-agent-icon", // [design-choice] semantic signal icon; mid-tone hue
  "--tug-base-tone-data-icon", // [design-choice] semantic signal icon; mid-tone hue
  "--tug-base-tone-success-icon", // [design-choice] semantic signal icon; mid-tone hue
  "--tug-base-tone-caution-icon", // [design-choice] semantic signal icon; mid-tone hue
  "--tug-base-tone-danger-icon", // [design-choice] semantic signal icon; mid-tone hue

  // D2 — bare tone-danger: chromatic danger signal; gamut ceiling prevents reaching contrast 75
  // The red hue at high intensity clips in sRGB at high tones, reducing the effective OKLab-L
  // below what the contrast floor targets. An independent gamut-mapping derivation path is
  // required to fix this; that is engine-level work deferred to Phase 4.
  "--tug-base-tone-danger", // [phase-4-engine] gamut ceiling: vivid red at high tone clips in sRGB, reducing effective OKLab-L; resolving requires gamut-mapping-aware derivation path (Phase 4)

  // E — UI control indicators (form elements / state indicators)
  "--tug-base-accent-default", // [design-choice] accent-default is a UI indicator not primary text; mid-tone by design
  "--tug-base-toggle-thumb", // [design-choice] toggle thumb is a structural indicator; white thumb on track is evaluated separately
  "--tug-base-toggle-icon-mixed", // [design-choice] mixed-state indicator icon; intentionally subdued
  "--tug-base-checkmark-fg", // [design-choice] checkmark inside filled checkbox bg; real contrast is checkmark on checkbox bg
  "--tug-base-radio-dot", // [design-choice] radio dot inside radio bg; real contrast is dot on radio bg
  "--tug-base-range-thumb", // [design-choice] range thumb indicator; structural component visibility

  // E2 — muted / disabled element tokens below perceptual contrast thresholds
  "--tug-base-icon-muted", // [design-choice] muted icon: intentionally lower-contrast for visual hierarchy
  "--tug-base-fg-disabled", // [design-choice] disabled state: intentionally low contrast to signal inactive
  "--tug-base-icon-disabled", // [design-choice] disabled state icon
  "--tug-base-field-fg-disabled", // [design-choice] disabled field text: intentionally low contrast

  // F — Badge tinted border tokens: alpha 35%; compositing produces contrast ~19-24, below 30 threshold
  "--tug-base-badge-tinted-accent-border", // [design-choice] tinted badge border: subtle same-hue outline; reinforced by filled bg and text
  "--tug-base-badge-tinted-action-border", // [design-choice] tinted badge border; same rationale as accent
  "--tug-base-badge-tinted-agent-border", // [design-choice] tinted badge border; same rationale as accent
  "--tug-base-badge-tinted-data-border", // [design-choice] tinted badge border; same rationale as accent
  "--tug-base-badge-tinted-danger-border", // [design-choice] tinted badge border; same rationale as accent
  "--tug-base-badge-tinted-success-border", // [design-choice] tinted badge border; same rationale as accent
  "--tug-base-badge-tinted-caution-border", // [design-choice] tinted badge border; same rationale as accent

  // G — Tab chrome
  "--tug-base-tab-fg-hover", // [design-choice] tab hover state: below contrast 75 body-text in both dark and light

  // H — Non-text component visibility tokens below contrast 30 by design
  "--tug-base-toggle-track-off", // [design-choice] inactive toggle track: intentionally lower-contrast to signal off state
  "--tug-base-toggle-track-mixed", // [design-choice] mixed-state toggle track: intentionally subdued
  "--tug-base-toggle-track-off-hover", // [design-choice] hover on inactive toggle track
  "--tug-base-toggle-track-mixed-hover", // [design-choice] hover on mixed-state toggle track
  "--tug-base-toggle-track-on", // [design-choice] on-state toggle track: may start below 30 in some configs; auto-adjusted
  "--tug-base-field-border-rest", // [design-choice] subtle field boundary in dark mode; active border uses vivid accent and passes
  "--tug-base-field-border-hover", // [design-choice] field border hover; same structural constraint as rest
  "--tug-base-field-border-disabled", // [design-choice] non-interactive state border; intentionally low-contrast (decorative)
  "--tug-base-field-border-readOnly", // [design-choice] read-only state border; intentionally low-contrast (decorative)
  "--tug-base-border-default", // [design-choice] structural separator; intentionally subtle for visual hierarchy
  "--tug-base-border-muted", // [design-choice] muted separator; intentionally subtle
]);

// ---------------------------------------------------------------------------
// INTENTIONALLY_BELOW_THRESHOLD
//
// Element tokens intentionally below contrast thresholds used in
// theme-accessibility tests and contrast-dashboard tests (body-text scope).
// This is a narrower subset of KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS focused
// on the body-text checks in T3.5 and T7.2.
// ---------------------------------------------------------------------------

/**
 * Element tokens intentionally or structurally below contrast 75 in the Brio
 * dark theme body-text checks.
 */
export const INTENTIONALLY_BELOW_THRESHOLD: ReadonlySet<string> = new Set([
  "--tug-base-fg-link", // [design-choice] link fg: brand hue recognition over max contrast
  "--tug-base-control-selected-fg", // [design-choice] selected item label on translucent tint
  "--tug-base-control-highlighted-fg", // [design-choice] highlighted item label on translucent tint
  "--tug-base-selection-fg", // [design-choice] text-selection overlay fg; composited stack passes
  "--tug-base-tab-fg-active", // [design-choice] active tab label: deliberately reduced contrast to avoid competing with content
  "--tug-base-fg-subtle", // [design-choice] tertiary text hierarchy
  "--tug-base-fg-placeholder", // [design-choice] placeholder: intentionally subdued input hint
  "--tug-base-fg-link-hover", // [design-choice] link hover: brand hue recognition
  "--tug-base-fg-muted", // [design-choice] muted text hierarchy (contrast ~61, below body-text 75, passes subdued-text 45)
  "--tug-base-field-fg-readOnly", // [design-choice] read-only field text (contrast ~61, passes subdued-text 45)
  "--tug-base-tab-fg-rest", // [design-choice] tab chrome rest state: intentionally low contrast for visual hierarchy
  "--tug-base-tab-fg-hover", // [design-choice] tab chrome hover state
]);

// ---------------------------------------------------------------------------
// KNOWN_PAIR_EXCEPTIONS
//
// Specific (element, surface) pairs below threshold due to structural derivation
// constraints that cannot be resolved by tone-bumping alone. Keyed as
// "elementToken|surfaceToken" strings.
// ---------------------------------------------------------------------------

/**
 * Specific (element, surface) pairs below threshold — global (applies to all recipes).
 */
export const KNOWN_PAIR_EXCEPTIONS: ReadonlySet<string> = new Set([
  // Focused-vs-unfocused decorative comparisons (border-vs-border, informational)
  // Perceptual contrast is designed for element-on-area contrast, not border-vs-border. [D05]
  "--tug-base-accent-cool-default|--tug-base-field-border-rest", // [design-choice] border-vs-border decorative comparison; not element-on-area
  "--tug-base-accent-cool-default|--tug-base-control-outlined-action-border-rest", // [design-choice] border-vs-border decorative comparison; not element-on-area

  // fg-inverse placement issues
  // B06: fg-inverse on tone-danger (dock badge text): both tokens are near-white in dark mode,
  // producing white-on-white contrast ~21. This requires a mode-aware fg-inverse derivation
  // path — engine work deferred to Phase 4. fg-inverse is "on-fill" text; tone-danger is used
  // as a badge bg. The pair structurally cannot pass without mode-aware token selection.
  "--tug-base-fg-inverse|--tug-base-tone-danger", // [phase-4-engine] dock badge text: fg-inverse and tone-danger are both near-white in dark mode; resolving requires mode-aware on-fill token selection (Phase 4)
  // B07: fg-inverse on surface-default (ghost/outlined badge in light mode): fg-inverse is
  // near-white (L~0.94) in both modes; light-mode surface-default is also near-white.
  // This is a structural polarity mismatch — the same exception is in RECIPE_PAIR_EXCEPTIONS.harmony.
  // No engine change can make fg-inverse both near-white (for dark fills) and near-black
  // (for light surfaces) without a mode-aware derivation path.
  // Removed from global KNOWN_PAIR_EXCEPTIONS (this only fails in harmony light mode, not brio).
  // RECIPE_PAIR_EXCEPTIONS.harmony carries the [design-choice] entry for the harmony recipe.
  "--tug-base-fg-inverse|--tug-base-surface-screen", // [design-choice] fg-inverse is for on-fill text (dark bg fills); structural polarity mismatch on light surface-screen

  // Filled button border-hover/-active on matching hover/active bg: same-hue outline by design
  "--tug-base-control-filled-accent-border-hover|--tug-base-control-filled-accent-bg-hover", // [design-choice] same-hue border on hover bg; decorative subtle outline
  "--tug-base-control-filled-accent-border-active|--tug-base-control-filled-accent-bg-active", // [design-choice] same-hue border on active bg; decorative subtle outline
  "--tug-base-control-filled-action-border-hover|--tug-base-control-filled-action-bg-hover", // [design-choice] same-hue border on hover bg; decorative subtle outline
  "--tug-base-control-filled-action-border-active|--tug-base-control-filled-action-bg-active", // [design-choice] same-hue border on active bg; decorative subtle outline
  "--tug-base-control-filled-danger-border-hover|--tug-base-control-filled-danger-bg-hover", // [design-choice] same-hue border on hover bg; decorative subtle outline
  "--tug-base-control-filled-danger-border-active|--tug-base-control-filled-danger-bg-active", // [design-choice] same-hue border on active bg; decorative subtle outline

  // Ghost/outlined button border-hover/-active: same-hue border on semi-transparent hover tint
  "--tug-base-control-ghost-danger-border-hover|--tug-base-control-ghost-danger-bg-hover", // [design-choice] same-hue border on semi-transparent hover tint; decorative
  "--tug-base-control-ghost-danger-border-active|--tug-base-control-ghost-danger-bg-active", // [design-choice] same-hue border on semi-transparent active tint; decorative

  // Ghost/outlined button fg-hover/-active on matching semi-transparent hover/active bg
  // The bg is a 10-20% alpha tint of the fg hue; interaction highlight is informational, not contrast-critical
  "--tug-base-control-ghost-action-fg-hover|--tug-base-control-ghost-action-bg-hover", // [design-choice] interaction highlight on 10-20% alpha tint; informational not contrast-critical
  "--tug-base-control-ghost-action-fg-active|--tug-base-control-ghost-action-bg-active", // [design-choice] interaction highlight on alpha tint; informational
  "--tug-base-control-ghost-option-fg-hover|--tug-base-control-ghost-option-bg-hover", // [design-choice] interaction highlight on alpha tint; informational
  "--tug-base-control-ghost-option-fg-active|--tug-base-control-ghost-option-bg-active", // [design-choice] interaction highlight on alpha tint; informational
  "--tug-base-control-outlined-option-fg-hover|--tug-base-control-outlined-option-bg-hover", // [design-choice] interaction highlight on alpha tint; informational
  "--tug-base-control-outlined-option-fg-active|--tug-base-control-outlined-option-bg-active", // [design-choice] interaction highlight on alpha tint; informational
  "--tug-base-control-outlined-option-icon-active|--tug-base-control-outlined-option-bg-active", // [design-choice] interaction highlight on alpha tint; informational

  // Toggle-track self-pairings: same token used as both background and border
  "--tug-base-toggle-track-on-hover|--tug-base-toggle-track-on-hover", // [design-choice] same token as element and surface; contrast always 0 by definition; decorative
  "--tug-base-toggle-track-disabled|--tug-base-toggle-track-disabled", // [design-choice] same token as element and surface; contrast always 0 by definition; decorative

  // B08: tone-danger on surface-overlay (danger menu item label text): vivid red clips in sRGB
  // at high tones, reducing effective OKLab-L and preventing contrast 75 in dark mode.
  // The gamut ceiling is the same structural constraint as B01 (tone-danger as element token).
  // Resolving requires gamut-mapping-aware derivation — engine work deferred to Phase 4.
  "--tug-base-tone-danger|--tug-base-surface-overlay", // [phase-4-engine] danger menu item text: vivid red gamut ceiling prevents reaching contrast 75; resolving requires gamut-mapping-aware derivation (Phase 4)
]);

// ---------------------------------------------------------------------------
// RECIPE_PAIR_EXCEPTIONS
//
// Recipe-specific pair exceptions keyed by recipe name (e.g. "brio", "harmony").
// Used by the parameterized recipe validation loop (Step 3).
// ---------------------------------------------------------------------------

/**
 * Recipe-specific pair exceptions. Keyed by recipe name matching keys in EXAMPLE_RECIPES.
 */
export const RECIPE_PAIR_EXCEPTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  // brio (dark mode): no recipe-specific exceptions beyond KNOWN_PAIR_EXCEPTIONS
  brio: new Set<string>(),

  // harmony (light mode with LIGHT_FORMULAS):
  //
  // Phase 3 ground truth — documented via the step-4 parameterized loop against the
  // full pairing map including composited pairings.
  //
  // Harmony uses LIGHT_FORMULAS which inverts the surface/foreground polarity relative to
  // Brio dark. Two structural failures are harmony-specific: they pass in Brio dark but fail in
  // Harmony because the polarity flip makes lighter tokens the "foreground" against lighter surfaces.
  // A third pair (accent-cool-default|field-border-rest) is a global exception already listed in
  // KNOWN_PAIR_EXCEPTIONS and is not repeated here.
  //
  // Cross-referenced via `bun run audit:tokens pairings`:
  //   - fg-inverse|surface-screen: .tug-tab-inactive — fg-inverse (for on-fill dark fills)
  //     placed on light surface-screen; polarity mismatch by design (confirmed CSS selector)
  //   - fg-inverse|surface-default: .tug-badge-ghost and .tug-badge-outlined — fg-inverse
  //     is near-white in dark mode (L~0.94), which becomes near-white on near-white
  //     surface-default (L~0.95) in light mode; contrast abs 6.5 (threshold 30, ui-component)
  //
  // Categorization:
  //   [design-choice]: fg-inverse surface placements are structural; they are on-fill tokens
  //     not designed for use on light surfaces. Phase 3 will introduce a dedicated light-mode
  //     surface token pair that preserves polarity.
  harmony: new Set([
    // --- Harmony-specific structural polarity failures (light mode only) ---

    // fg-inverse is for on-fill text (dark bg fills). In light mode, fg-inverse derives near-white
    // (L~0.94), creating near-zero contrast against near-white surface-screen (L~0.95+).
    // CSS context: .tug-tab-inactive, role: body-text, contrast abs 8.3, threshold 75.
    "--tug-base-fg-inverse|--tug-base-surface-screen", // [design-choice] fg-inverse designed for dark on-fill backgrounds; polarity mismatch on light surface-screen

    // fg-inverse on surface-default: ghost/outlined badge foreground. In dark mode, fg-inverse
    // is near-white (L~0.94) against dark surface-default — high contrast and passes.
    // In light mode, fg-inverse remains near-white while surface-default is also near-white
    // (L~0.95), producing near-zero contrast (abs 6.5). CSS context: .tug-badge-ghost,
    // .tug-badge-outlined. Role: ui-component, threshold 30.
    // Note: Also in KNOWN_PAIR_EXCEPTIONS for dark-mode ghost badge structural issue.
    "--tug-base-fg-inverse|--tug-base-surface-default", // [design-choice] fg-inverse near-white on near-white surface-default in light mode; polarity mismatch; Phase 3 will introduce light-mode fg-inverse token

    // Note: "--tug-base-accent-cool-default|--tug-base-field-border-rest" is already covered by
    // KNOWN_PAIR_EXCEPTIONS (global, applies to all recipes including harmony). It is not repeated here.
  ]),
};

