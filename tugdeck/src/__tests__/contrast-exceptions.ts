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
  "--tug-base-element-tone-text-normal-accent-rest", // [design-choice] semantic role token; mid-tone hue for visual weight, not primary text contrast
  "--tug-base-element-tone-text-normal-active-rest", // [design-choice] semantic role token; mid-tone hue
  "--tug-base-element-tone-text-normal-agent-rest", // [design-choice] semantic role token; mid-tone hue
  "--tug-base-element-tone-text-normal-data-rest", // [design-choice] semantic role token; mid-tone hue
  "--tug-base-element-tone-text-normal-success-rest", // [design-choice] semantic role token; mid-tone hue
  "--tug-base-element-tone-text-normal-caution-rest", // [design-choice] semantic role token; mid-tone hue
  "--tug-base-element-tone-text-normal-danger-rest", // [design-choice] semantic role token; mid-tone hue
  "--tug-base-element-tone-icon-normal-accent-rest", // [design-choice] semantic role icon; mid-tone hue
  "--tug-base-element-tone-icon-normal-active-rest", // [design-choice] semantic role icon; mid-tone hue
  "--tug-base-element-tone-icon-normal-agent-rest", // [design-choice] semantic role icon; mid-tone hue
  "--tug-base-element-tone-icon-normal-data-rest", // [design-choice] semantic role icon; mid-tone hue
  "--tug-base-element-tone-icon-normal-success-rest", // [design-choice] semantic role icon; mid-tone hue
  "--tug-base-element-tone-icon-normal-caution-rest", // [design-choice] semantic role icon; mid-tone hue
  "--tug-base-element-tone-icon-normal-danger-rest", // [design-choice] semantic role icon; mid-tone hue

  // D2 — bare tone-danger: chromatic danger role color; gamut ceiling prevents reaching contrast 75
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
  "--tug-base-element-global-text-normal-plain-disabled", // [design-choice] disabled state: intentionally low contrast to indicate inactive
  "--tug-base-element-global-icon-normal-plain-disabled", // [design-choice] disabled state icon
  "--tug-base-element-field-text-normal-plain-disabled", // [design-choice] disabled field text: intentionally low contrast

  // E3 — semantic role field tokens below threshold by design
  // These use semantic hue tones for state communication; hue recognition takes precedence over max contrast
  "--tug-base-element-field-text-normal-required-rest", // [design-choice] required field asterisk: semantic role color; contrast ~54-55 below informational 60
  "--tug-base-element-field-border-normal-danger-rest", // [design-choice] danger field border: semantic red role color; contrast ~57 below control 60 on field bg

  // F — Badge tinted text/icon tokens: composited contrast ~40-55, below informational threshold 60
  // Badge tinted text uses mid-tone hues for semantic role identity; the tinted bg (alpha 15%)
  // is composited over surface-default. The resulting contrast is ~45-55, below the informational
  // threshold (60). These are informational semantic indicators, not primary readable text.
  // Reclassified from ui-component (30) to informational (60) per D05; the design intent of
  // badge tinted text is colorimetric role indicator, not WCAG-level contrast for primary prose.
  "--tug-base-element-badge-text-tinted-accent-rest", // [design-choice] badge tinted text: mid-tone role color; composited contrast ~45, below informational 60
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
  "--tug-base-surface-toggle-track-normal-off-rest", // [design-choice] inactive toggle track: intentionally lower-contrast to indicate off state
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
  "--tug-base-element-field-text-normal-required-rest|--tug-base-surface-global-primary-normal-default-rest", // [design-choice] required field asterisk: semantic role color; contrast ~54-55 below informational 60

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

  // B09–B10: text on active tab frame in light mode (harmony recipe).
  // LIGHT_FORMULAS.cardFrameActiveTone = 40 (mid-dark). In light mode the
  // indigo-violet cardFrame hue at tone 40 produces an OKLab-L that conflicts
  // with content-role text tokens. These are structural failures introduced by
  // the cardFrameActiveTone = 40 design value; Plan 2 will recalibrate this field
  // in LIGHT_FORMULAS to achieve adequate contrast with all content text.
  "--tug-base-element-tab-text-normal-plain-active|--tug-base-surface-tab-primary-normal-plain-active", // [baseline-structural] active tab text on light active tab frame: cardFrameActiveTone=40 conflict; contrast 69.0 (content 75); Plan 2 recalibrates
  "--tug-base-element-global-text-normal-default-rest|--tug-base-surface-tab-primary-normal-plain-active", // [baseline-structural] default text on light active tab frame: cardFrameActiveTone=40 conflict; contrast 54.9; Plan 2 recalibrates

  // B11–B24: on-fill text/icon at role.tone=50 (fully-specified-theme-colors plan)
  //
  // With ThemeColorSpec, filledSurfaceRestTone is now set to recipe.role.tone (50 for
  // both brio and harmony). At tone 50, the filled control background is mid-tone, and
  // the on-fill text/icon at tone 100 (near-white) produces negative contrast (text is
  // lighter than surface). The enforceContrastFloor cannot push tone 100 higher.
  // This is a baseline-structural consequence of the new recipe design intent:
  // filled buttons are brighter at mid-tone (50) rather than the old dark anchor (20).
  // The roadmap explicitly expects brighter role fills at this tone level.
  // Step 4 (Theme Generator wiring) and future rule changes will address this structurally.
  "--tug-base-element-control-text-filled-accent-rest|--tug-base-surface-control-primary-filled-accent-rest", // [baseline-structural] on-fill text on mid-tone accent bg: role.tone=50; tone 100 text lighter than surface; fully-specified-theme-colors plan
  "--tug-base-element-control-icon-filled-accent-rest|--tug-base-surface-control-primary-filled-accent-rest", // [baseline-structural] on-fill icon on mid-tone accent bg: role.tone=50; same constraint
  "--tug-base-element-control-text-filled-action-rest|--tug-base-surface-control-primary-filled-action-rest", // [baseline-structural] on-fill text on mid-tone action bg: role.tone=50; fully-specified-theme-colors plan
  "--tug-base-element-control-icon-filled-action-rest|--tug-base-surface-control-primary-filled-action-rest", // [baseline-structural] on-fill icon on mid-tone action bg: role.tone=50; same constraint
  "--tug-base-element-control-text-filled-danger-rest|--tug-base-surface-control-primary-filled-danger-rest", // [baseline-structural] on-fill text on mid-tone danger bg: role.tone=50; fully-specified-theme-colors plan
  "--tug-base-element-control-icon-filled-danger-rest|--tug-base-surface-control-primary-filled-danger-rest", // [baseline-structural] on-fill icon on mid-tone danger bg: role.tone=50; same constraint
  "--tug-base-element-control-text-filled-agent-rest|--tug-base-surface-control-primary-filled-agent-rest", // [baseline-structural] on-fill text on mid-tone agent bg: role.tone=50; fully-specified-theme-colors plan
  "--tug-base-element-control-icon-filled-agent-rest|--tug-base-surface-control-primary-filled-agent-rest", // [baseline-structural] on-fill icon on mid-tone agent bg: role.tone=50; same constraint
  "--tug-base-element-control-text-filled-data-rest|--tug-base-surface-control-primary-filled-data-rest", // [baseline-structural] on-fill text on mid-tone data bg: role.tone=50; fully-specified-theme-colors plan
  "--tug-base-element-control-icon-filled-data-rest|--tug-base-surface-control-primary-filled-data-rest", // [baseline-structural] on-fill icon on mid-tone data bg: role.tone=50; same constraint
  "--tug-base-element-control-text-filled-success-rest|--tug-base-surface-control-primary-filled-success-rest", // [baseline-structural] on-fill text on mid-tone success bg: role.tone=50; fully-specified-theme-colors plan
  "--tug-base-element-control-icon-filled-success-rest|--tug-base-surface-control-primary-filled-success-rest", // [baseline-structural] on-fill icon on mid-tone success bg: role.tone=50; same constraint
  "--tug-base-element-control-text-filled-caution-rest|--tug-base-surface-control-primary-filled-caution-rest", // [baseline-structural] on-fill text on mid-tone caution bg: role.tone=50; fully-specified-theme-colors plan
  "--tug-base-element-control-icon-filled-caution-rest|--tug-base-surface-control-primary-filled-caution-rest", // [baseline-structural] on-fill icon on mid-tone caution bg: role.tone=50; same constraint
]);

// ---------------------------------------------------------------------------
// ENDPOINT_CONSTRAINT_PAIR_EXCEPTIONS
//
// Specific (element, surface) pairs that fail at parameter extremes (value=0
// or value=100) due to placeholder endpoint ranges in the Plan 1 endpoint
// bundles (recipe-parameters.ts). These are distinct from design-choice or
// phase-4-engine exceptions: the pairs CAN pass at reference values (V=50)
// but fall below threshold at the extremes of the ±50% placeholder range.
//
// Visual calibration (Plan 2) will replace placeholder endpoints with
// perceptually tuned ranges that maintain contrast compliance at all values
// 0-100. Until Plan 2, these pairs are documented here so the endpoint-
// contrast test tracks real regressions vs known placeholder constraints.
//
// Keyed as "elementToken|surfaceToken" strings. Some also appear as baseline
// structural failures (present even at V=50); those are annotated with
// [baseline-structural].
//
// Machine query examples:
//   grep '\[endpoint-constraint\]' contrast-exceptions.ts
//   grep '\[baseline-structural\]' contrast-exceptions.ts
// ---------------------------------------------------------------------------

/**
 * Pair-level exceptions for the endpoint-contrast parameterized tests.
 * These pairs fail at parameter extremes (0 or 100) due to placeholder
 * endpoint ranges in Plan 1. Resolved in Plan 2 (visual calibration).
 */
export const ENDPOINT_CONSTRAINT_PAIR_EXCEPTIONS: ReadonlySet<string> = new Set([
  // -------------------------------------------------------------------------
  // A — muted text on dual-use divider-as-badge-bg (informational, ~57-58 dark)
  //
  // tug-dialog.css uses the divider token as a neutral badge background.
  // fg-muted (tone 66, intensity 5) on divider-default (tone 17, intensity 6)
  // produces OKLab-L contrast ~57.8 in dark mode, just below the informational
  // threshold (60). This is a [baseline-structural] failure — it exists at the
  // reference value (V=50) and is not introduced by extreme parameter values.
  // The divider token is an element token primarily used as a separator; it was
  // not designed to serve as a high-contrast badge background. Resolving requires
  // either a dedicated badge-neutral-bg token or a contrast-enforced derivation
  // path for dual-use element tokens (Phase 3 / Plan 2).
  // -------------------------------------------------------------------------
  "--tug-base-element-global-text-normal-muted-rest|--tug-base-element-global-divider-normal-default-rest", // [baseline-structural] muted text on dual-use divider-as-badge-bg: structural constraint; resolving requires dedicated badge-neutral-bg token or contrast-enforced dual-use path (Plan 2)

  // -------------------------------------------------------------------------
  // B — field active-focus border on field hover surface (control, ~59.9 light)
  //
  // The cobalt focus-ring border (field-border-plain-active) on the field hover
  // surface (field-surface-hover) produces contrast ~59.9 in light mode — 0.1
  // units below the control threshold (60). This is a [baseline-structural]
  // failure: the reference fieldSurfaceHoverTone (88) and the cobalt focus ring
  // are structurally very close in OKLab-L. The 0.1 gap is within the floating-
  // point precision of the OKLab-L metric. Plan 2 calibration will separate the
  // hover surface tone from the focus ring tone by enough to clear the threshold.
  // -------------------------------------------------------------------------
  "--tug-base-element-field-border-normal-plain-active|--tug-base-surface-field-primary-normal-plain-hover", // [baseline-structural] focus-ring on hover surface: OKLab-L gap 0.1 below control 60; Plan 2 calibration separates tones

  // -------------------------------------------------------------------------
  // C — on-fill text/icon at controlWeight=100 (control threshold; dark + light)
  //
  // At controlWeight=100, filledSurfaceRestTone reaches its high endpoint (30).
  // Some vivid hues (accent, action, data, success, caution) at tone 30 produce
  // OKLab-L values that make white-ish on-fill text/icon fall below control 60.
  // These mirror the documented hover/active state exceptions already in
  // KNOWN_BELOW_THRESHOLD_ELEMENT_TOKENS (groups A/C). Plan 2 will cap the
  // high endpoint for filledSurfaceRestTone to prevent this.
  // -------------------------------------------------------------------------
  "--tug-base-element-control-text-filled-accent-rest|--tug-base-surface-control-primary-filled-accent-rest", // [endpoint-constraint] on-fill text at controlWeight=100: vivid hue at tone 30 ceiling; Plan 2 caps high endpoint
  "--tug-base-element-control-icon-filled-accent-rest|--tug-base-surface-control-primary-filled-accent-rest", // [endpoint-constraint] on-fill icon at controlWeight=100; same constraint
  "--tug-base-element-control-text-filled-action-rest|--tug-base-surface-control-primary-filled-action-rest", // [endpoint-constraint] on-fill text at controlWeight=100; action hue ceiling
  "--tug-base-element-control-icon-filled-action-rest|--tug-base-surface-control-primary-filled-action-rest", // [endpoint-constraint] on-fill icon at controlWeight=100; action hue ceiling
  "--tug-base-element-control-text-filled-data-rest|--tug-base-surface-control-primary-filled-data-rest", // [endpoint-constraint] on-fill text at controlWeight=100; teal hue ceiling
  "--tug-base-element-control-icon-filled-data-rest|--tug-base-surface-control-primary-filled-data-rest", // [endpoint-constraint] on-fill icon at controlWeight=100; teal hue ceiling
  "--tug-base-element-control-text-filled-success-rest|--tug-base-surface-control-primary-filled-success-rest", // [endpoint-constraint] on-fill text at controlWeight=100; green hue ceiling
  "--tug-base-element-control-icon-filled-success-rest|--tug-base-surface-control-primary-filled-success-rest", // [endpoint-constraint] on-fill icon at controlWeight=100; green hue ceiling
  "--tug-base-element-control-text-filled-caution-rest|--tug-base-surface-control-primary-filled-caution-rest", // [endpoint-constraint] on-fill text at controlWeight=100; caution yellow ceiling (structural, similar to hover)
  "--tug-base-element-control-icon-filled-caution-rest|--tug-base-surface-control-primary-filled-caution-rest", // [endpoint-constraint] on-fill icon at controlWeight=100; caution yellow ceiling

  // -------------------------------------------------------------------------
  // D — borderDefinition=100 dark: tab text on tab surfaces
  //
  // At borderDefinition=100, cardFrameActiveTone reaches 24 (high from
  // toneEndpoints(16).high). Tab surfaces use the cardFrame hue slot. The
  // combination of the specific indigo-violet hue at tone 24 and the tab text
  // tokens (default-rest, active, muted) produces sub-75/sub-60 contrast in the
  // OKLab-L metric — the hue's chromatic component reduces the effective L
  // differential. Plan 2 will constrain the cardFrameActiveTone high endpoint.
  // -------------------------------------------------------------------------
  "--tug-base-element-global-text-normal-default-rest|--tug-base-surface-tab-primary-normal-plain-active", // [endpoint-constraint] default text on tab active bg at borderDefinition=100: cardFrame hue at tone 24; Plan 2 constrains high endpoint
  "--tug-base-element-global-text-normal-default-rest|--tug-base-surface-tab-primary-normal-plain-inactive", // [endpoint-constraint] default text on tab inactive bg at borderDefinition=100; same hue constraint
  "--tug-base-element-tab-text-normal-plain-active|--tug-base-surface-tab-primary-normal-plain-active", // [endpoint-constraint] active tab text on active tab bg at borderDefinition=100; same hue constraint
  "--tug-base-element-global-text-normal-muted-rest|--tug-base-surface-tab-primary-normal-plain-inactive", // [endpoint-constraint] muted text on tab inactive bg at borderDefinition=100/textHierarchy=0/surfaceDepth=100: near-threshold informational; Plan 2 constrains
  "--tug-base-element-global-icon-normal-active-rest|--tug-base-surface-tab-primary-normal-plain-active", // [endpoint-constraint] active icon on tab active bg at borderDefinition=100: informational threshold; same constraint

  // -------------------------------------------------------------------------
  // E — borderDefinition=0 dark: tab text on sunken surface
  //
  // At borderDefinition=0, the structural fields shift in a way that causes
  // tab text (rest state) on sunken surface to fall below informational 60.
  // -------------------------------------------------------------------------
  "--tug-base-element-tab-text-normal-plain-rest|--tug-base-surface-global-primary-normal-sunken-rest", // [endpoint-constraint] tab rest text on sunken surface at borderDefinition=0: informational threshold; Plan 2 constrains low endpoint

  // -------------------------------------------------------------------------
  // F — roleIntensity=100 dark: role fills and toggle track
  //
  // At roleIntensity=100, the roleIntensityValue reaches 100, making semantic
  // fills (accent, tone-fill-accent, toggle-track-on-hover) maximally vivid.
  // Some vivid role colors hit OKLab-L values similar to surface-default,
  // reducing the effective contrast below the informational/control thresholds.
  // -------------------------------------------------------------------------
  "--tug-base-element-tone-fill-normal-accent-rest|--tug-base-surface-global-primary-normal-default-rest", // [endpoint-constraint] accent fill at roleIntensity=100: maximal role intensity; OKLab-L approaches surface-default; Plan 2 caps roleIntensityValue high endpoint
  "--tug-base-surface-toggle-track-normal-on-hover|--tug-base-surface-global-primary-normal-default-rest", // [endpoint-constraint] toggle track hover at roleIntensity=100/surfaceDepth=100: vivid track approaches surface-default L; Plan 2 constrains
  "--tug-base-surface-toggle-track-normal-on-hover|--tug-base-surface-global-primary-normal-raised-rest", // [endpoint-constraint] toggle track hover at roleIntensity=100/surfaceDepth=100: vivid track approaches surface-raised L
  "--tug-base-element-global-text-normal-default-rest|--tug-base-element-global-fill-normal-accentSubtle-rest", // [endpoint-constraint] default text on accent-subtle at roleIntensity=100/surfaceDepth=100: accent-subtle L approaches content text L; Plan 2 constrains accentSubtleTone or roleIntensityValue
  "--tug-base-element-global-text-normal-default-rest|--tug-base-surface-tone-primary-normal-caution-rest", // [endpoint-constraint] default text on caution surface at roleIntensity=100/surfaceDepth=100: vivid caution surface approaches content text L
  "--tug-base-element-global-text-normal-default-rest|--tug-base-surface-global-primary-normal-overlay-rest", // [endpoint-constraint] default text on overlay surface at surfaceDepth=100: overlay becomes very dark; Plan 2 constrains surfaceOverlayTone high endpoint
  "--tug-base-element-global-text-normal-default-rest|--tug-base-surface-global-primary-normal-screen-rest", // [endpoint-constraint] default text on screen surface at surfaceDepth=100: screen diverges from content text at extreme depth; Plan 2 constrains

  // -------------------------------------------------------------------------
  // G — roleIntensity=0 dark: active icon on default/tab surfaces
  //
  // At roleIntensity=0, iconActiveTone reaches its low endpoint (40). The
  // active icon hue at tone 40 on dark surfaces approaches the OKLab-L of the
  // surface, reducing contrast below control/informational thresholds.
  // -------------------------------------------------------------------------
  "--tug-base-element-global-icon-normal-active-rest|--tug-base-surface-global-primary-normal-default-rest", // [endpoint-constraint] active icon at roleIntensity=0: low tone endpoint; Plan 2 constrains iconActiveTone low endpoint
  "--tug-base-element-global-icon-normal-active-rest|--tug-base-surface-tab-primary-normal-plain-active", // [endpoint-constraint] active icon at roleIntensity=0/borderDefinition=100: informational threshold
  "--tug-base-element-global-icon-normal-active-rest|--tug-base-surface-global-primary-normal-default-rest", // duplicate guard (same pair listed above for roleIntensity=0 and surfaceDepth=100 separately)

  // -------------------------------------------------------------------------
  // H — surfaceDepth=100 dark: active icon on default surface
  //
  // At surfaceDepth=100, surfaceDefaultTone reaches its high endpoint (18).
  // The active icon at iconActiveTone=80 on surface-default at tone 18 should
  // have good contrast, but the specific chromatic resolution causes it to
  // fall just below the control threshold. Plan 2 constrains surfaceDefaultTone.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // I — roleIntensity=100 light: role fills below informational threshold
  //
  // At roleIntensity=100 in light mode, tone-fill-success and tone-fill-data
  // become vivid enough that their OKLab-L approaches the near-white surface-
  // default, reducing contrast below informational 60.
  // -------------------------------------------------------------------------
  "--tug-base-element-tone-fill-normal-success-rest|--tug-base-surface-global-primary-normal-default-rest", // [endpoint-constraint] success fill at roleIntensity=100 light: vivid role approaches surface-default L; Plan 2 constrains
  "--tug-base-element-tone-fill-normal-data-rest|--tug-base-surface-global-primary-normal-default-rest", // [endpoint-constraint] data fill at roleIntensity=100 light: teal hue at max role intensity; Plan 2 constrains

  // -------------------------------------------------------------------------
  // J — roleIntensity=100 light: field border success on field rest surface
  //
  // At roleIntensity=100, field-border-success becomes maximally vivid. The
  // green hue at high role intensity approaches the light field surface OKLab-L,
  // reducing control contrast below 60.
  // -------------------------------------------------------------------------
  "--tug-base-element-field-border-normal-success-rest|--tug-base-surface-field-primary-normal-plain-rest", // [endpoint-constraint] success field border at roleIntensity=100 light: vivid green approaches field surface L; Plan 2 constrains

  // -------------------------------------------------------------------------
  // K — atmosphere=0 light: field fill caution on field rest surface
  //
  // At atmosphere=0, fieldSurfaceRestTone reaches its low endpoint (45 from
  // toneEndpoints(91).low). The caution semantic fill color on this very light
  // field surface approaches the informational threshold.
  // -------------------------------------------------------------------------
  "--tug-base-element-field-fill-normal-caution-rest|--tug-base-surface-field-primary-normal-plain-rest", // [endpoint-constraint] caution fill on field rest at atmosphere=0: light surface; informational threshold; Plan 2 constrains fieldSurfaceRestTone low endpoint

  // -------------------------------------------------------------------------
  // L — atmosphere=0/surfaceDepth=100 light: accentCool on field rest surface
  //
  // The cobalt focus ring (accentCool) on a very light field rest surface fails
  // control 60 at extremes where the field surface is pushed to very high tones.
  // -------------------------------------------------------------------------
  "--tug-base-element-global-fill-normal-accentCool-rest|--tug-base-surface-field-primary-normal-plain-rest", // [endpoint-constraint] focus ring on very-light field rest at atmosphere=0/surfaceDepth=100: Plan 2 constrains field surface tone range

  // -------------------------------------------------------------------------
  // M — textHierarchy=0/100 dark+light: placeholder text on field rest surface
  //
  // At textHierarchy=0, placeholderTextTone shifts to a very dark value (low
  // endpoint), making placeholder text too similar to the dark field surface in
  // dark mode. At textHierarchy=100, it shifts to a very light value matching
  // the light field surface in light mode. Both are informational-role failures
  // caused by the placeholder tone endpoints being placeholder ±50% ranges.
  // Plan 2 will constrain placeholderTextTone endpoints to maintain informational 60.
  // -------------------------------------------------------------------------
  "--tug-base-element-field-text-normal-placeholder-rest|--tug-base-surface-field-primary-normal-plain-rest", // [endpoint-constraint] placeholder text on field rest at textHierarchy extremes: tone endpoint range causes informational threshold failure; Plan 2 constrains

  // -------------------------------------------------------------------------
  // N — surfaceDepth=100 dark: content text and field-label on surface-default/raised/sunken
  //
  // At surfaceDepth=100, surfaceDefaultTone reaches its high endpoint. The derived
  // surface tones become so dark that content text (L~0.9) produces negative OKLab-L
  // contrast values — polarity inversion where the surface is darker than the fg.
  // This is caused by the unconstrained surfaceDepth high endpoint; Plan 2 will cap
  // surfaceDefaultTone so surfaces never pass the foreground lightness.
  // -------------------------------------------------------------------------
  "--tug-base-element-global-text-normal-default-rest|--tug-base-surface-global-primary-normal-default-rest", // [endpoint-constraint] default text on default surface at surfaceDepth=100: polarity inversion (contrast=-69.1); Plan 2 caps surfaceDefaultTone high endpoint
  "--tug-base-element-global-text-normal-default-rest|--tug-base-surface-global-primary-normal-raised-rest", // [endpoint-constraint] default text on raised surface at surfaceDepth=100: polarity inversion (contrast=-70.8); Plan 2 caps surfaceDefaultTone high endpoint
  "--tug-base-element-global-text-normal-default-rest|--tug-base-surface-global-primary-normal-sunken-rest", // [endpoint-constraint] default text on sunken surface at surfaceDepth=100: polarity inversion (contrast=-72.0); Plan 2 caps surfaceDefaultTone high endpoint
  "--tug-base-element-global-icon-normal-active-rest|--tug-base-surface-global-primary-normal-sunken-rest", // [endpoint-constraint] active icon on sunken surface at surfaceDepth=100: polarity inversion (contrast=-56.1); Plan 2 caps surfaceDefaultTone high endpoint
  "--tug-base-element-field-text-normal-label-rest|--tug-base-surface-global-primary-normal-default-rest", // [endpoint-constraint] field label text on default surface at surfaceDepth=100: polarity inversion (contrast=-69.1); Plan 2 caps surfaceDefaultTone high endpoint

  // -------------------------------------------------------------------------
  // O — controlWeight=100 dark+light: on-fill text/icon for danger and agent filled buttons
  //
  // At controlWeight=100, filledSurfaceRestTone reaches its high endpoint (30).
  // The danger (red) and agent (purple) hues at tone 30 produce very dark filled
  // backgrounds. White-ish on-fill text/icon falls below control 60 because the
  // hue's gamut ceiling prevents adequate contrast at this tone level.
  // Plan 2 will cap the high endpoint for filledSurfaceRestTone.
  // -------------------------------------------------------------------------
  "--tug-base-element-control-text-filled-danger-rest|--tug-base-surface-control-primary-filled-danger-rest", // [endpoint-constraint] on-fill text at controlWeight=100: danger hue at tone 30; Plan 2 caps high endpoint
  "--tug-base-element-control-icon-filled-danger-rest|--tug-base-surface-control-primary-filled-danger-rest", // [endpoint-constraint] on-fill icon at controlWeight=100: danger hue at tone 30; Plan 2 caps high endpoint
  "--tug-base-element-control-text-filled-agent-rest|--tug-base-surface-control-primary-filled-agent-rest", // [endpoint-constraint] on-fill text at controlWeight=100: agent hue at tone 30; Plan 2 caps high endpoint
  "--tug-base-element-control-icon-filled-agent-rest|--tug-base-surface-control-primary-filled-agent-rest", // [endpoint-constraint] on-fill icon at controlWeight=100: agent hue at tone 30; Plan 2 caps high endpoint

  // -------------------------------------------------------------------------
  // P — light mode: cardTitle text on active tab surface (baseline-structural)
  //
  // LIGHT_FORMULAS.cardFrameActiveTone = 40 (mid-dark tone). In light mode the
  // indigo-violet cardFrame hue at tone 40 produces an OKLab-L that is too
  // close to the display-role cardTitle text (near-dark, L~0.3), yielding
  // contrast ~55.4 — below the display threshold. This failure appears both at
  // the reference value (V=50) and at all parameter extremes where cardFrame
  // tone is unchanged. The borderDefinition=0 extreme lowers the low endpoint
  // to tone 20, yielding contrast ~20.9. Plan 2 will recalibrate
  // cardFrameActiveTone in LIGHT_FORMULAS to a value that provides adequate
  // contrast with both display text (cardTitle) and content text.
  // -------------------------------------------------------------------------
  "--tug-base-element-cardTitle-text-normal-plain-rest|--tug-base-surface-tab-primary-normal-plain-active", // [baseline-structural] cardTitle display text on light active tab frame at LIGHT_FORMULAS.cardFrameActiveTone=40: contrast ~55.4; Plan 2 recalibrates cardFrameActiveTone
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

    // LIGHT_FORMULAS.cardFrameActiveTone = 40 produces inadequate contrast with
    // content/display tokens on the active tab surface in light mode. These three
    // pairs fail at the reference value (V=50) and are therefore baseline-structural
    // for the harmony recipe. Plan 2 will recalibrate cardFrameActiveTone in
    // LIGHT_FORMULAS to a value that passes all role thresholds.
    "--tug-base-element-tab-text-normal-plain-active|--tug-base-surface-tab-primary-normal-plain-active", // [baseline-structural] active tab text on active tab frame: cardFrameActiveTone=40 produces OKLab-L conflict with content text; harmony light mode
    "--tug-base-element-global-text-normal-default-rest|--tug-base-surface-tab-primary-normal-plain-active", // [baseline-structural] default text on active tab frame at cardFrameActiveTone=40: contrast 54.9; Plan 2 recalibrates
    "--tug-base-element-global-icon-normal-active-rest|--tug-base-surface-tab-primary-normal-plain-active", // [baseline-structural] active icon on active tab frame at cardFrameActiveTone=40: informational threshold; Plan 2 recalibrates

    // Danger border on danger filled surface in light mode: roleIntensity-driven fill
    // at intensity 60 produces mid-chroma fill that clashes with border at similar chroma.
    "--tug-base-element-control-border-filled-danger-rest|--tug-base-surface-control-primary-filled-danger-rest", // [baseline-structural] danger border on danger fill: intensity-driven fill chroma at roleIntensity=60
  ]),
};

