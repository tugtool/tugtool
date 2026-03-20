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
  "--tug-base-element-global-text-normal-subtle-rest", // [design-choice] tertiary text: visual hierarchy below primary
  "--tug-base-element-global-text-normal-placeholder-rest", // [design-choice] placeholder: intentionally subdued input hint
  "--tug-base-element-global-text-normal-link-hover", // [design-choice] link hover: brand hue recognition > max contrast
  "--tug-base-element-global-text-normal-link-rest", // [design-choice] link: brand hue recognition > max contrast
  "--tug-base-element-control-text-normal-selected-rest", // [design-choice] selected item label on translucent tint; composited stack passes
  "--tug-base-element-control-text-normal-highlighted-rest", // [design-choice] highlighted item label on translucent tint; composited stack passes
  "--tug-base-element-selection-text-normal-plain-rest", // [design-choice] text-selection overlay fg; composited stack passes

  // B — text/icon on vivid accent or semantic backgrounds (design constraint)
  "--tug-base-element-global-text-normal-onAccent-rest", // [design-choice] on-fill text for accent fills; accent hue is vivid mid-tone
  "--tug-base-element-global-icon-normal-onAccent-rest", // [design-choice] on-fill icon for accent fills; same constraint as fg-onAccent
  "--tug-base-element-global-text-normal-onDanger-rest", // [design-choice] on-fill text for danger fills; danger bg creates contrast ~53 ceiling

  // C — interactive state tokens on vivid colored filled button backgrounds
  // (hover/active states are transient; filled button bg hues may be vivid mid-tones)
  "--tug-base-element-control-text-filled-accent-hover", // [design-choice] transient hover state on vivid accent bg
  "--tug-base-element-control-text-filled-accent-active", // [design-choice] transient active state on vivid accent bg
  "--tug-base-element-control-icon-filled-accent-hover", // [design-choice] transient hover state on vivid accent bg
  "--tug-base-element-control-icon-filled-accent-active", // [design-choice] transient active state on vivid accent bg
  "--tug-base-element-control-text-filled-action-hover", // [design-choice] transient hover state on vivid action bg
  "--tug-base-element-control-text-filled-action-active", // [design-choice] transient active state on vivid action bg
  "--tug-base-element-control-icon-filled-action-hover", // [design-choice] transient hover state on vivid action bg
  "--tug-base-element-control-icon-filled-action-active", // [design-choice] transient active state on vivid action bg
  "--tug-base-element-control-text-filled-danger-hover", // [design-choice] transient hover state on vivid danger bg
  "--tug-base-element-control-text-filled-danger-active", // [design-choice] transient active state on vivid danger bg
  "--tug-base-element-control-icon-filled-danger-hover", // [design-choice] transient hover state on vivid danger bg
  "--tug-base-element-control-icon-filled-danger-active", // [design-choice] transient active state on vivid danger bg
  "--tug-base-element-control-text-filled-agent-hover", // [design-choice] transient hover state on vivid agent bg
  "--tug-base-element-control-text-filled-agent-active", // [design-choice] transient active state on vivid agent bg
  "--tug-base-element-control-icon-filled-agent-hover", // [design-choice] transient hover state on vivid agent bg
  "--tug-base-element-control-icon-filled-agent-active", // [design-choice] transient active state on vivid agent bg
  "--tug-base-element-control-text-filled-data-hover", // [design-choice] transient hover on vivid data bg; teal hue ceiling constraint
  "--tug-base-element-control-text-filled-data-active", // [design-choice] transient active on vivid data bg; teal hue ceiling constraint
  "--tug-base-element-control-icon-filled-data-hover", // [design-choice] transient hover on vivid data bg; teal hue ceiling constraint
  "--tug-base-element-control-icon-filled-data-active", // [design-choice] transient active on vivid data bg; teal hue ceiling constraint
  "--tug-base-element-control-text-filled-success-hover", // [design-choice] transient hover on vivid success bg; green hue ceiling constraint
  "--tug-base-element-control-text-filled-success-active", // [design-choice] transient active on vivid success bg
  "--tug-base-element-control-icon-filled-success-hover", // [design-choice] transient hover on vivid success bg
  "--tug-base-element-control-icon-filled-success-active", // [design-choice] transient active on vivid success bg
  "--tug-base-element-control-text-filled-caution-hover", // [design-choice] caution-bg-hover at t=40 (L=0.75); structural ceiling
  "--tug-base-element-control-text-filled-caution-active", // [design-choice] caution-bg-active at t=50; structural ceiling
  "--tug-base-element-control-icon-filled-caution-hover", // [design-choice] transient hover on caution bg
  "--tug-base-element-control-icon-filled-caution-active", // [design-choice] transient active on caution bg

  // C2 — outlined/ghost hover/active: transparent bg means fg contrast is against parent surface
  "--tug-base-element-control-text-outlined-action-hover", // [design-choice] transparent bg hover; contrast measured against parent surface
  "--tug-base-element-control-text-outlined-action-active", // [design-choice] transparent bg active; contrast measured against parent surface
  "--tug-base-element-control-icon-outlined-action-hover", // [design-choice] transparent bg hover; contrast measured against parent surface
  "--tug-base-element-control-icon-outlined-action-active", // [design-choice] transparent bg active; contrast measured against parent surface
  "--tug-base-element-control-text-outlined-agent-rest", // [design-choice] outlined agent: colored bg reduces default fg contrast in dark mode
  "--tug-base-element-control-text-outlined-agent-hover", // [design-choice] agent hue at rest lightness; structural
  "--tug-base-element-control-text-outlined-agent-active", // [design-choice] agent hue at rest lightness; structural
  "--tug-base-element-control-icon-outlined-agent-rest", // [design-choice] outlined agent icon at rest state
  "--tug-base-element-control-icon-outlined-agent-hover", // [design-choice] agent hue at hover lightness
  "--tug-base-element-control-icon-outlined-agent-active", // [design-choice] agent hue at active lightness

  // C3 — ghost-danger rest/hover/active: danger hue at mid-tone is below contrast 60 control
  "--tug-base-element-control-text-ghost-danger-rest", // [design-choice] danger hue mid-tone; contrast ~40-41 below control threshold 60
  "--tug-base-element-control-text-ghost-danger-hover", // [design-choice] danger hue hover state; same structural constraint
  "--tug-base-element-control-text-ghost-danger-active", // [design-choice] danger hue active state; same structural constraint
  "--tug-base-element-control-icon-ghost-danger-rest", // [design-choice] danger hue icon at rest; same structural constraint as text version
  "--tug-base-element-control-icon-ghost-danger-hover", // [design-choice] danger hue icon hover state; same structural constraint
  "--tug-base-element-control-icon-ghost-danger-active", // [design-choice] danger hue active icon; same structural constraint

  // D — semantic tone tokens (status/informational colors — medium visual weight by design)
  "--tug-base-element-tone-text-normal-accent-rest", // [design-choice] semantic signal token; mid-tone hue for visual weight, not primary text contrast
  "--tug-base-element-tone-text-normal-active-rest", // [design-choice] semantic signal token; mid-tone hue
  "--tug-base-element-tone-text-normal-agent-rest", // [design-choice] semantic signal token; mid-tone hue
  "--tug-base-element-tone-text-normal-data-rest", // [design-choice] semantic signal token; mid-tone hue
  "--tug-base-element-tone-text-normal-success-rest", // [design-choice] semantic signal token; mid-tone hue
  "--tug-base-element-tone-text-normal-caution-rest", // [design-choice] semantic signal token; mid-tone hue
  "--tug-base-element-tone-text-normal-danger-rest", // [design-choice] semantic signal token; mid-tone hue
  "--tug-base-element-tone-icon-normal-accent-rest", // [design-choice] semantic signal icon; mid-tone hue
  "--tug-base-element-tone-icon-normal-active-rest", // [design-choice] semantic signal icon; mid-tone hue
  "--tug-base-element-tone-icon-normal-agent-rest", // [design-choice] semantic signal icon; mid-tone hue
  "--tug-base-element-tone-icon-normal-data-rest", // [design-choice] semantic signal icon; mid-tone hue
  "--tug-base-element-tone-icon-normal-success-rest", // [design-choice] semantic signal icon; mid-tone hue
  "--tug-base-element-tone-icon-normal-caution-rest", // [design-choice] semantic signal icon; mid-tone hue
  "--tug-base-element-tone-icon-normal-danger-rest", // [design-choice] semantic signal icon; mid-tone hue

  // D2 — bare tone-danger: chromatic danger signal; gamut ceiling prevents reaching contrast 75
  // The red hue at high intensity clips in sRGB at high tones, reducing the effective OKLab-L
  // below what the contrast floor targets. An independent gamut-mapping derivation path is
  // required to fix this; that is engine-level work deferred to Phase 4.
  "--tug-base-element-tone-fill-normal-danger-rest", // [phase-4-engine] gamut ceiling: vivid red at high tone clips in sRGB, reducing effective OKLab-L; resolving requires gamut-mapping-aware derivation path (Phase 4)

  // E — UI control indicators (form elements / state indicators)
  "--tug-base-element-global-fill-normal-accent-rest", // [design-choice] accent-default is a UI indicator not primary text; mid-tone by design
  "--tug-base-element-toggle-thumb-normal-plain-rest", // [design-choice] toggle thumb is a structural indicator; white thumb on track is evaluated separately
  "--tug-base-element-toggle-icon-normal-plain-mixed", // [design-choice] mixed-state indicator icon; intentionally subdued
  "--tug-base-element-checkmark-icon-normal-plain-rest", // [design-choice] checkmark inside filled checkbox bg; real contrast is checkmark on checkbox bg
  "--tug-base-element-radio-dot-normal-plain-rest", // [design-choice] radio dot inside radio bg; real contrast is dot on radio bg
  "--tug-base-range-thumb", // [design-choice] range thumb indicator; structural component visibility

  // E2 — muted / disabled element tokens below perceptual contrast thresholds
  "--tug-base-element-global-icon-normal-muted-rest", // [design-choice] muted icon: intentionally lower-contrast for visual hierarchy
  "--tug-base-element-global-text-normal-plain-disabled", // [design-choice] disabled state: intentionally low contrast to signal inactive
  "--tug-base-element-global-icon-normal-plain-disabled", // [design-choice] disabled state icon
  "--tug-base-element-field-text-normal-plain-disabled", // [design-choice] disabled field text: intentionally low contrast

  // E3 — semantic signal field tokens below threshold by design
  // These use semantic hue tones for state communication; hue recognition takes precedence over max contrast
  "--tug-base-element-field-text-normal-required-rest", // [design-choice] required field asterisk: semantic signal color; contrast ~54-55 below informational 60
  "--tug-base-element-field-border-normal-danger-rest", // [design-choice] danger field border: semantic red signal; contrast ~57 below control 60 on field bg

  // F — Badge tinted text/icon tokens: composited contrast ~40-55, below informational threshold 60
  // Badge tinted text uses mid-tone hues for semantic signal identity; the tinted bg (alpha 15%)
  // is composited over surface-default. The resulting contrast is ~45-55, below the informational
  // threshold (60). These are informational semantic indicators, not primary readable text.
  // Reclassified from ui-component (30) to informational (60) per D05; the design intent of
  // badge tinted text is colorimetric signal, not WCAG-level contrast for primary prose.
  "--tug-base-element-badge-text-tinted-accent-rest", // [design-choice] badge tinted text: mid-tone signal color; composited contrast ~45, below informational 60
  "--tug-base-element-badge-text-tinted-action-rest", // [design-choice] badge tinted text; same rationale as accent
  "--tug-base-element-badge-text-tinted-agent-rest", // [design-choice] badge tinted text; same rationale
  "--tug-base-element-badge-text-tinted-data-rest", // [design-choice] badge tinted text; same rationale
  "--tug-base-element-badge-text-tinted-danger-rest", // [design-choice] badge tinted text; same rationale
  "--tug-base-element-badge-text-tinted-success-rest", // [design-choice] badge tinted text; same rationale
  "--tug-base-element-badge-text-tinted-caution-rest", // [design-choice] badge tinted text; same rationale
  "--tug-base-element-badge-icon-tinted-accent-rest", // [design-choice] badge tinted icon; same rationale as text
  "--tug-base-element-badge-icon-tinted-action-rest", // [design-choice] badge tinted icon; same rationale
  "--tug-base-element-badge-icon-tinted-agent-rest", // [design-choice] badge tinted icon; same rationale
  "--tug-base-element-badge-icon-tinted-data-rest", // [design-choice] badge tinted icon; same rationale
  "--tug-base-element-badge-icon-tinted-danger-rest", // [design-choice] badge tinted icon; same rationale
  "--tug-base-element-badge-icon-tinted-success-rest", // [design-choice] badge tinted icon; same rationale
  "--tug-base-element-badge-icon-tinted-caution-rest", // [design-choice] badge tinted icon; same rationale

  // F2 — Badge tinted border tokens: alpha 35%; compositing produces contrast ~19-24, below informational 60 threshold
  "--tug-base-element-badge-border-tinted-accent-rest", // [design-choice] tinted badge border: subtle same-hue outline; reinforced by filled bg and text
  "--tug-base-element-badge-border-tinted-action-rest", // [design-choice] tinted badge border; same rationale as accent
  "--tug-base-element-badge-border-tinted-agent-rest", // [design-choice] tinted badge border; same rationale as accent
  "--tug-base-element-badge-border-tinted-data-rest", // [design-choice] tinted badge border; same rationale as accent
  "--tug-base-element-badge-border-tinted-danger-rest", // [design-choice] tinted badge border; same rationale as accent
  "--tug-base-element-badge-border-tinted-success-rest", // [design-choice] tinted badge border; same rationale as accent
  "--tug-base-element-badge-border-tinted-caution-rest", // [design-choice] tinted badge border; same rationale as accent

  // G — Tab chrome
  "--tug-base-element-tab-text-normal-plain-hover", // [design-choice] tab hover state: below contrast 75 content in both dark and light

  // H — Non-text component visibility tokens below contrast 30 by design
  "--tug-base-surface-toggle-track-normal-off-rest", // [design-choice] inactive toggle track: intentionally lower-contrast to signal off state
  "--tug-base-surface-toggle-track-normal-mixed-rest", // [design-choice] mixed-state toggle track: intentionally subdued
  "--tug-base-surface-toggle-track-normal-off-hover", // [design-choice] hover on inactive toggle track
  "--tug-base-surface-toggle-track-normal-mixed-hover", // [design-choice] hover on mixed-state toggle track
  "--tug-base-surface-toggle-track-normal-on-rest", // [design-choice] on-state toggle track: may start below 30 in some configs; auto-adjusted
  "--tug-base-element-field-border-normal-plain-rest", // [design-choice] subtle field boundary in dark mode; active border uses vivid accent and passes
  "--tug-base-element-field-border-normal-plain-hover", // [design-choice] field border hover; same structural constraint as rest
  "--tug-base-element-field-border-normal-plain-disabled", // [design-choice] non-interactive state border; intentionally low-contrast (decorative)
  "--tug-base-element-field-border-normal-plain-readOnly", // [design-choice] read-only state border; intentionally low-contrast (decorative)
  "--tug-base-element-global-border-normal-default-rest", // [design-choice] structural separator; intentionally subtle for visual hierarchy
  "--tug-base-element-global-border-normal-muted-rest", // [design-choice] muted separator; intentionally subtle
]);

// ---------------------------------------------------------------------------
// INTENTIONALLY_BELOW_THRESHOLD
//
// Element tokens intentionally below contrast thresholds used in
// theme-accessibility tests and contrast-dashboard tests (content role scope).
// This is a narrower subset of KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS focused
// on the content role checks in T3.5 and T7.2.
// ---------------------------------------------------------------------------

/**
 * Element tokens intentionally or structurally below contrast 75 in the Brio
 * dark theme content checks.
 */
export const INTENTIONALLY_BELOW_THRESHOLD: ReadonlySet<string> = new Set([
  "--tug-base-element-global-text-normal-link-rest", // [design-choice] link fg: brand hue recognition over max contrast
  "--tug-base-element-control-text-normal-selected-rest", // [design-choice] selected item label on translucent tint
  "--tug-base-element-control-text-normal-highlighted-rest", // [design-choice] highlighted item label on translucent tint
  "--tug-base-element-selection-text-normal-plain-rest", // [design-choice] text-selection overlay fg; composited stack passes
  "--tug-base-element-tab-text-normal-plain-active", // [design-choice] active tab label: deliberately reduced contrast to avoid competing with content
  "--tug-base-element-global-text-normal-subtle-rest", // [design-choice] tertiary text hierarchy
  "--tug-base-element-global-text-normal-placeholder-rest", // [design-choice] placeholder: intentionally subdued input hint
  "--tug-base-element-global-text-normal-link-hover", // [design-choice] link hover: brand hue recognition
  "--tug-base-element-global-text-normal-muted-rest", // [design-choice] muted text hierarchy (contrast ~61, below content 75, passes informational 60)
  "--tug-base-element-field-text-normal-plain-readOnly", // [design-choice] read-only field text (contrast ~61, passes informational 60)
  "--tug-base-element-tab-text-normal-plain-rest", // [design-choice] tab chrome rest state: intentionally low contrast for visual hierarchy
  "--tug-base-element-tab-text-normal-plain-hover", // [design-choice] tab chrome hover state
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
  "--tug-base-element-global-fill-normal-accentCool-rest|--tug-base-element-field-border-normal-plain-rest", // [design-choice] border-vs-border decorative comparison; not element-on-area
  "--tug-base-element-global-fill-normal-accentCool-rest|--tug-base-element-control-border-outlined-action-rest", // [design-choice] border-vs-border decorative comparison; not element-on-area

  // fg-inverse placement issues
  // B06: fg-inverse on tone-danger (dock badge text): both tokens are near-white in dark mode,
  // producing white-on-white contrast ~21. This requires a mode-aware fg-inverse derivation
  // path — engine work deferred to Phase 4. fg-inverse is "on-fill" text; tone-danger is used
  // as a badge bg. The pair structurally cannot pass without mode-aware token selection.
  "--tug-base-element-global-text-normal-inverse-rest|--tug-base-element-tone-fill-normal-danger-rest", // [phase-4-engine] dock badge text: fg-inverse and tone-danger are both near-white in dark mode; resolving requires mode-aware on-fill token selection (Phase 4)
  // B07: fg-inverse on surface-default (ghost/outlined badge in light mode): fg-inverse is
  // near-white (L~0.94) in both modes; light-mode surface-default is also near-white.
  // This is a structural polarity mismatch — the same exception is in RECIPE_PAIR_EXCEPTIONS.harmony.
  // No engine change can make fg-inverse both near-white (for dark fills) and near-black
  // (for light surfaces) without a mode-aware derivation path.
  // Removed from global KNOWN_PAIR_EXCEPTIONS (this only fails in harmony light mode, not brio).
  // RECIPE_PAIR_EXCEPTIONS.harmony carries the [design-choice] entry for the harmony recipe.
  "--tug-base-element-global-text-normal-inverse-rest|--tug-base-surface-global-primary-normal-screen-rest", // [design-choice] fg-inverse is for on-fill text (dark bg fills); structural polarity mismatch on light surface-screen

  // Filled button border-hover/-active on matching hover/active bg: same-hue outline by design
  "--tug-base-element-control-border-filled-accent-hover|--tug-base-surface-control-primary-filled-accent-hover", // [design-choice] same-hue border on hover bg; decorative subtle outline
  "--tug-base-element-control-border-filled-accent-active|--tug-base-surface-control-primary-filled-accent-active", // [design-choice] same-hue border on active bg; decorative subtle outline
  "--tug-base-element-control-border-filled-action-hover|--tug-base-surface-control-primary-filled-action-hover", // [design-choice] same-hue border on hover bg; decorative subtle outline
  "--tug-base-element-control-border-filled-action-active|--tug-base-surface-control-primary-filled-action-active", // [design-choice] same-hue border on active bg; decorative subtle outline
  "--tug-base-element-control-border-filled-danger-hover|--tug-base-surface-control-primary-filled-danger-hover", // [design-choice] same-hue border on hover bg; decorative subtle outline
  "--tug-base-element-control-border-filled-danger-active|--tug-base-surface-control-primary-filled-danger-active", // [design-choice] same-hue border on active bg; decorative subtle outline

  // Ghost/outlined button border-hover/-active: same-hue border on semi-transparent hover tint
  "--tug-base-element-control-border-ghost-danger-hover|--tug-base-surface-control-primary-ghost-danger-hover", // [design-choice] same-hue border on semi-transparent hover tint; decorative
  "--tug-base-element-control-border-ghost-danger-active|--tug-base-surface-control-primary-ghost-danger-active", // [design-choice] same-hue border on semi-transparent active tint; decorative

  // Ghost/outlined button fg-hover/-active on matching semi-transparent hover/active bg
  // The bg is a 10-20% alpha tint of the fg hue; interaction highlight is informational, not contrast-critical
  "--tug-base-element-control-text-ghost-action-hover|--tug-base-surface-control-primary-ghost-action-hover", // [design-choice] interaction highlight on 10-20% alpha tint; informational not contrast-critical
  "--tug-base-element-control-text-ghost-action-active|--tug-base-surface-control-primary-ghost-action-active", // [design-choice] interaction highlight on alpha tint; informational
  "--tug-base-element-control-text-ghost-option-hover|--tug-base-surface-control-primary-ghost-option-hover", // [design-choice] interaction highlight on alpha tint; informational
  "--tug-base-element-control-text-ghost-option-active|--tug-base-surface-control-primary-ghost-option-active", // [design-choice] interaction highlight on alpha tint; informational
  "--tug-base-element-control-text-outlined-option-hover|--tug-base-surface-control-primary-outlined-option-hover", // [design-choice] interaction highlight on alpha tint; informational
  "--tug-base-element-control-text-outlined-option-active|--tug-base-surface-control-primary-outlined-option-active", // [design-choice] interaction highlight on alpha tint; informational
  "--tug-base-element-control-icon-outlined-option-active|--tug-base-surface-control-primary-outlined-option-active", // [design-choice] interaction highlight on alpha tint; informational

  // Toggle-track self-pairings: same token used as both background and border
  "--tug-base-surface-toggle-track-normal-on-hover|--tug-base-surface-toggle-track-normal-on-hover", // [design-choice] same token as element and surface; contrast always 0 by definition; decorative
  "--tug-base-surface-toggle-track-normal-plain-disabled|--tug-base-surface-toggle-track-normal-plain-disabled", // [design-choice] same token as element and surface; contrast always 0 by definition; decorative

  // Outlined button border-hover/-active on semi-transparent hover/active bg
  // The hover/active surface is a 10-20% tinted overlay; border and surface share the same hue.
  // Same pattern as filled/ghost button border pairs above — decorative same-hue outline.
  "--tug-base-element-control-border-outlined-action-hover|--tug-base-surface-control-primary-outlined-action-hover", // [design-choice] same-hue border on 10-20% alpha hover tint; decorative outline
  "--tug-base-element-control-border-outlined-action-active|--tug-base-surface-control-primary-outlined-action-active", // [design-choice] same-hue border on 10-20% alpha active tint; decorative outline
  "--tug-base-element-control-border-outlined-agent-hover|--tug-base-surface-control-primary-outlined-agent-hover", // [design-choice] same-hue border on alpha hover tint; decorative outline
  "--tug-base-element-control-border-outlined-agent-active|--tug-base-surface-control-primary-outlined-agent-active", // [design-choice] same-hue border on alpha active tint; decorative outline

  // Focus ring (accentCool) on overlay and screen surfaces — structural ceiling
  // The cobalt-intense focus ring passes on most surfaces after floor enforcement.
  // On surface-overlay (dark translucent dim) and surface-screen (very light in dark mode),
  // the effective luminance difference is constrained by the hue's color space ceiling.
  // These are documented structural constraints; accentCool meets control 60 on all other surfaces.
  "--tug-base-element-global-fill-normal-accentCool-rest|--tug-base-surface-global-primary-normal-overlay-rest", // [design-choice] focus ring: gamut ceiling on overlay surface; contrast ~59, within 1 unit of 60 threshold
  "--tug-base-element-global-fill-normal-accentCool-rest|--tug-base-surface-global-primary-normal-screen-rest", // [design-choice] focus ring: gamut ceiling on screen surface; contrast ~55-56 below control 60

  // On-fill text for semantic tone backgrounds (onCaution, onSuccess)
  // These use near-white text on vivid mid-tone semantic fill backgrounds.
  // The tone-fill colors are vivid chromatic hues; the contrast ceiling prevents reaching 60.
  // Previously ui-component (30), reclassified to control but cannot meet control threshold due to hue ceiling.
  "--tug-base-element-global-text-normal-onCaution-rest|--tug-base-element-tone-fill-normal-caution-rest", // [design-choice] on-caution-fill text: yellow hue ceiling; contrast ~35 below control 60
  "--tug-base-element-global-text-normal-onSuccess-rest|--tug-base-element-tone-fill-normal-success-rest", // [design-choice] on-success-fill text: green hue ceiling; contrast ~38 below control 60

  // Required field marker on surface-default
  "--tug-base-element-field-text-normal-required-rest|--tug-base-surface-global-primary-normal-default-rest", // [design-choice] required field asterisk: semantic signal color; contrast ~54-55 below informational 60

  // Tab overflow badge: surface-default token used as text color on accent fill
  // The CSS uses var(--tug-base-surface-global-primary-normal-default-rest) as text color directly
  // over the accent-default badge background. In dark mode this passes; in light mode the
  // polarity flips (both tokens become near-white), producing low contrast.
  "--tug-base-surface-global-primary-normal-default-rest|--tug-base-element-global-fill-normal-accent-rest", // [design-choice] tab overflow badge: surface-default as text color on accent fill; structural polarity constraint

  // B08: tone-danger on surface-overlay (danger menu item label text): vivid red clips in sRGB
  // at high tones, reducing effective OKLab-L and preventing contrast 75 in dark mode.
  // The gamut ceiling is the same structural constraint as B01 (tone-danger as element token).
  // Resolving requires gamut-mapping-aware derivation — engine work deferred to Phase 4.
  "--tug-base-element-tone-fill-normal-danger-rest|--tug-base-surface-global-primary-normal-overlay-rest", // [phase-4-engine] danger menu item text: vivid red gamut ceiling prevents reaching contrast 75; resolving requires gamut-mapping-aware derivation (Phase 4)
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
  //     surface-default (L~0.95) in light mode; contrast abs 6.5 (threshold 60, informational)
  //
  // Categorization:
  //   [design-choice]: fg-inverse surface placements are structural; they are on-fill tokens
  //     not designed for use on light surfaces. Phase 3 will introduce a dedicated light-mode
  //     surface token pair that preserves polarity.
  harmony: new Set([
    // --- Harmony-specific structural polarity failures (light mode only) ---

    // fg-inverse is for on-fill text (dark bg fills). In light mode, fg-inverse derives near-white
    // (L~0.94), creating near-zero contrast against near-white surface-screen (L~0.95+).
    // CSS context: .tug-tab-inactive, role: content, contrast abs 8.3, threshold 75.
    "--tug-base-element-global-text-normal-inverse-rest|--tug-base-surface-global-primary-normal-screen-rest", // [design-choice] fg-inverse designed for dark on-fill backgrounds; polarity mismatch on light surface-screen

    // fg-inverse on surface-default: ghost/outlined badge foreground. In dark mode, fg-inverse
    // is near-white (L~0.94) against dark surface-default — high contrast and passes.
    // In light mode, fg-inverse remains near-white while surface-default is also near-white
    // (L~0.95), producing near-zero contrast (abs 6.5). CSS context: .tug-badge-ghost,
    // .tug-badge-outlined. Role: informational, threshold 60.
    // Note: Also in KNOWN_PAIR_EXCEPTIONS for dark-mode ghost badge structural issue.
    "--tug-base-element-global-text-normal-inverse-rest|--tug-base-surface-global-primary-normal-default-rest", // [design-choice] fg-inverse near-white on near-white surface-default in light mode; polarity mismatch; Phase 3 will introduce light-mode fg-inverse token

    // Note: "--tug-base-element-global-fill-normal-accentCool-rest|--tug-base-element-field-border-normal-plain-rest" is already covered by
    // KNOWN_PAIR_EXCEPTIONS (global, applies to all recipes including harmony). It is not repeated here.

    // ghost-danger-hover icon on surface-default (harmony light mode only)
    // In dark mode (brio), ghost-danger-hover icon is in KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS.
    // In light mode (harmony), the danger hue produces contrast 54.8 — below control 60 but
    // closer to the threshold due to light-mode polarity. The structural hue ceiling prevents
    // reaching 60 in either mode; both are design-choice exceptions.
    "--tug-base-element-control-icon-ghost-danger-hover|--tug-base-surface-global-primary-normal-default-rest", // [design-choice] danger hue icon hover: structural hue ceiling; contrast ~54.8 in harmony light mode
  ]),
};

