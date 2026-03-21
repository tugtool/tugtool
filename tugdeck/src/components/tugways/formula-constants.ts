/**
 * Formula Constants — DARK_FORMULAS and LIGHT_FORMULAS
 *
 * Extracted into a standalone module to break the circular dependency between
 * theme-derivation-engine.ts (which imports compileRecipe from
 * recipe-parameters.ts) and recipe-parameters.ts (which needs the formula
 * constants as the source of truth for endpoint reference values).
 *
 * Both DARK_FORMULAS and LIGHT_FORMULAS are pure data literals — they only
 * depend on the DerivationFormulas type, imported here as a type-only import
 * to avoid any runtime dependency cycle.
 *
 * @module components/tugways/formula-constants
 */

import type { DerivationFormulas } from "./theme-derivation-engine";

// ---------------------------------------------------------------------------
// DARK_FORMULAS — Dark recipe formula constants [D01] [D02]
// ---------------------------------------------------------------------------

/**
 * All formula constants for the Dark recipe.
 * Single source of truth for all Dark recipe derivation constants.
 * Exported as the default fallback in `deriveTheme()` via
 * `recipe.formulas ?? DARK_FORMULAS`. [D02]
 *
 * Also referenced by `EXAMPLE_RECIPES.brio.formulas`.
 */
export const DARK_FORMULAS: DerivationFormulas = {
  // ===== Canvas Darkness =====
  // How dark/light the app background is. Dark: tones 5-10. Light: tones 90-95.
  surfaceAppTone: 5, // near-black: deep immersive app background anchors the dark theme
  surfaceCanvasTone: 5, // same as surfaceAppTone: canvas and app share the same base darkness level

  // ===== Surface Layering =====
  // How surfaces stack visually above the canvas. Dark: ascending from ~6. Light: descending from ~95.
  surfaceSunkenTone: 11, // slightly above canvas: just enough lift to distinguish recessed wells
  surfaceDefaultTone: 12, // one step above sunken: the primary card/panel surface
  surfaceRaisedTone: 11, // matches sunken: popovers feel elevated via shadow, not tone contrast
  surfaceOverlayTone: 14, // above default: modals and sheets float clearly above the base layer
  surfaceInsetTone: 6, // near canvas: nested content areas recede toward the background
  surfaceContentTone: 6, // same as inset: text-area-like regions share the deep inset tone
  surfaceScreenTone: 16, // highest tone: full-bleed screen bg pushes cards forward visually

  // ===== Surface Coloring =====
  // How much chroma surfaces carry. Dark: I 2-7. Light: I 3-8.
  atmosphereIntensity: 5, // mid-range chroma: atmosphere hue is present but never saturated on dark bg
  surfaceAppIntensity: 2, // near-neutral: app bg chroma is barely perceptible, preserving the dark anchor
  surfaceCanvasIntensity: 2, // same as surfaceAppIntensity: canvas matches the app-level near-neutral chroma
  surfaceDefaultIntensity: 5, // moderate chroma: cards carry enough hue to feel warm, not sterile
  surfaceRaisedIntensity: 5, // same as default: raised surfaces match default chroma for visual parity
  surfaceOverlayIntensity: 4, // slightly lower: overlays desaturate slightly to recede behind content
  surfaceScreenIntensity: 7, // highest surface chroma: screen bg uses more hue to create depth behind cards
  surfaceInsetIntensity: 5, // matches default: inset wells share the moderate chroma of card surfaces
  surfaceContentIntensity: 5, // same as inset: content areas are consistent with the inset tier
  surfaceAppBaseIntensity: 2, // unified field for bg-app intensity: dark mode uses surfaceAppIntensity (near-neutral)

  // ===== Text Brightness =====
  // How bright primary and inverse text is. Dark: near 100. Light: near 0.
  contentTextTone: 94, // off-white: slightly softened from pure white to reduce eye strain on dark bg
  inverseTextTone: 100, // pure white: inverse text sits on filled controls and must be fully bright

  // ===== Text Hierarchy =====
  // How much secondary/tertiary text dims from primary. Dark: descending from 94. Light: ascending from 8.
  mutedTextTone: 66, // secondary text: large drop from 94 creates clear primary/secondary distinction
  subtleTextTone: 37, // tertiary text: drops deep to signal low-priority labels and captions
  disabledTextTone: 23, // near-invisible: disabled content barely readable, signaling non-interactivity
  placeholderTextTone: 30, // between disabled and subtle: placeholder is inactive but still scannable

  // ===== Text Coloring =====
  // How much chroma text carries. Dark: I 2-7. Light: I 3-8.
  contentTextIntensity: 3, // near-neutral: primary text carries minimal chroma so it reads as near-white, not tinted
  subtleTextIntensity: 7, // higher chroma for subtle tiers: tinted labels use more hue to signal semantic meaning
  mutedTextIntensity: 5, // moderate chroma: muted text picks up more hue than primary to compensate for low tone
  atmosphereBorderIntensity: 6, // atmosphere-hued borders use mid-range chroma to stay visible without overpowering
  inverseTextIntensity: 3, // near-neutral: inverse text on filled controls mirrors primary text's low chroma
  onCautionTextIntensity: 4, // caution surfaces are already vivid; text chroma is moderate to avoid clash
  onSuccessTextIntensity: 4, // same as caution: success surfaces are vivid, text stays moderate

  // ===== Border Visibility =====
  // How visible borders and dividers are. Dark: subtle I 4-7. Light: crisp I 6-10.
  borderBaseIntensity: 6, // mid-range chroma: default borders are present but never stark against dark surfaces
  borderStrongIntensity: 7, // one step higher: strong/emphasis borders need a bit more pop to register
  borderMutedTone: 37, // mid-dark tone: muted borders are dim enough to recede in the hierarchy
  borderMutedIntensity: 7, // higher chroma compensates for low tone so muted borders remain legible
  borderStrongTone: 40, // slightly above muted: strong borders need a touch more lift for contrast
  dividerDefaultIntensity: 6, // matches borderBaseIntensity: dividers use the same baseline chroma as borders
  dividerMutedIntensity: 4, // lowest chroma: muted dividers are the most recessive structural element
  borderSignalTone: 50, // mid-tone: dark backgrounds make mid-tone signals vivid and readable
  semanticSignalTone: 50, // mid-tone: semantic tokens at 50 are bright enough to pop on dark surfaces
  accentSubtleTone: 30, // darker orange: composited over dark surfaces at low alpha, fg-default achieves contrast ≥75 [phase-3-bug B04]
  cautionSurfaceTone: 30, // darker yellow: composited over dark surfaces at low alpha, fg-default achieves contrast ≥75 [phase-3-bug B05]

  // ===== Card Frame Style =====
  // How card title bars and tab bars present. Dark: dim tones 15-18. Light: bright tones 85-92.
  cardFrameActiveIntensity: 12, // elevated chroma: active title bar uses rich hue to signal focus
  cardFrameActiveTone: 16, // above surfaceScreen: active frame floats above the screen background; tone reduced 18→16 to bring fg-default contrast from ~73.6 to ≥75 [phase-3-bug B03]
  cardFrameInactiveIntensity: 4, // near-neutral: inactive frames recede to avoid competing with active card
  cardFrameInactiveTone: 15, // slightly below active: inactive frames are visibly dimmer but still distinct

  // ===== Shadow Depth =====
  // How pronounced shadows and overlay tints are. Dark: 20-80% alpha. Light: 10-40% alpha.
  shadowXsAlpha: 20, // subtle lift: extra-small shadows add just enough depth without visual noise
  shadowMdAlpha: 60, // mid-depth: medium shadows clearly separate floating panels from the surface
  shadowLgAlpha: 70, // deep: large shadows for prominent floats like menus and popovers
  shadowXlAlpha: 80, // heaviest shadow: extra-large conveys maximum elevation for dialogs
  shadowOverlayAlpha: 60, // matches medium: floating overlay panels use the same depth as md shadows
  overlayDimAlpha: 48, // near-half opacity: dim overlay tints content without fully obscuring it
  overlayScrimAlpha: 64, // above dim: modal scrims block the background more assertively
  overlayHighlightAlpha: 6, // near-invisible: highlight tints are barely perceptible, just a suggestion

  // ===== Filled Control Prominence =====
  // How bold filled buttons are. Dark: mid-tone bg. Light: same (filled stays vivid).
  filledSurfaceRestTone: 20, // dark rest state: dim enough to anchor the hue without washing the button
  filledSurfaceHoverTone: 40, // mid-tone hover: lifts dramatically from rest to signal interactivity
  filledSurfaceActiveTone: 50, // mid-tone press: one more step up from hover to confirm the click

  // ===== Outlined Control Style =====
  // How outlined buttons present across states/modes. Dark: white fg. Light: dark fg.
  outlinedTextRestTone: 100, // pure white fg at rest: outlined buttons use full-brightness text on dark bg
  outlinedTextHoverTone: 100, // same across states: fg tone stays constant; state change is bg alpha
  outlinedTextActiveTone: 100, // same across states
  outlinedTextIntensity: 2, // near-neutral chroma: fg text is nearly achromatic so it reads cleanly over any hue
  outlinedIconRestTone: 100, // pure white icons at rest: mirrors fg tone for visual consistency
  outlinedIconHoverTone: 100, // same across states
  outlinedIconActiveTone: 100, // same across states
  outlinedIconIntensity: 2, // same as fg chroma: icons match text neutrality
  outlinedTextRestToneLight: 0, // light-mode counterpart: inverted polarity — pure black fg on light bg
  outlinedTextHoverToneLight: 0, // same across states (light)
  outlinedTextActiveToneLight: 0, // same across states (light)
  outlinedIconRestToneLight: 0, // light-mode counterpart: black icons mirror black text
  outlinedIconHoverToneLight: 0, // same across states (light)
  outlinedIconActiveToneLight: 0, // same across states (light)
  outlinedOptionBorderRestTone: 50, // mid-tone rest border: visible against both dark and light surfaces
  outlinedOptionBorderHoverTone: 55, // slightly higher on hover: border brightens subtly to indicate focus
  outlinedOptionBorderActiveTone: 60, // highest on press: border lifts to confirm the active state
  outlinedSurfaceHoverIntensity: 0, // sentinel value (0): hover bg uses a hue-slot sentinel path, not direct chroma
  outlinedSurfaceHoverAlpha: 10, // low alpha hover tint: 10% opacity wash over the button on hover
  outlinedSurfaceActiveIntensity: 0, // sentinel value (0): press bg also uses sentinel path
  outlinedSurfaceActiveAlpha: 20, // double hover alpha on press: 20% opacity confirms the click

  // ===== Ghost Control Style =====
  // How ghost buttons present across states/modes. Dark: white fg. Light: dark fg.
  ghostTextRestTone: 100, // pure white fg at rest: ghost buttons use full-brightness text on dark bg
  ghostTextHoverTone: 100, // same across states: tone stays constant; state change is bg alpha
  ghostTextActiveTone: 100, // same across states
  ghostTextRestIntensity: 2, // near-neutral chroma: ghost fg text is nearly achromatic, matching outlined style
  ghostTextHoverIntensity: 2, // same across states
  ghostTextActiveIntensity: 2, // same across states
  ghostIconRestTone: 100, // pure white icons at rest: mirrors fg tone for visual consistency
  ghostIconHoverTone: 100, // same across states
  ghostIconActiveTone: 100, // same across states
  ghostIconRestIntensity: 2, // near-neutral chroma: ghost icons match text neutrality
  ghostIconHoverIntensity: 2, // same across states
  ghostIconActiveIntensity: 2, // same across states
  ghostBorderIntensity: 20, // elevated chroma for ghost border: provides hue-tinted ring without filled bg
  ghostBorderTone: 60, // mid-bright tone: border is light enough to be visible on dark surfaces
  ghostTextRestToneLight: 0, // light-mode counterpart: inverted polarity — pure black fg on light bg
  ghostTextHoverToneLight: 0, // same across states (light)
  ghostTextActiveToneLight: 0, // same across states (light)
  ghostTextRestIntensityLight: 0, // light-mode counterpart: zero chroma — black is achromatic by definition
  ghostTextHoverIntensityLight: 0, // same across states (light)
  ghostTextActiveIntensityLight: 0, // same across states (light)
  ghostIconRestToneLight: 0, // light-mode counterpart: black icons mirror black text
  ghostIconHoverToneLight: 0, // same across states (light)
  ghostIconActiveToneLight: 0, // same across states (light)
  ghostIconActiveIntensityLight: 0, // light-mode counterpart: zero chroma for black icons

  // ===== Badge Style =====
  // How tinted badges present. Dark: bright fg on tinted bg. Light: dark fg on tinted bg.
  badgeTintedTextIntensity: 72, // high chroma fg: badge label text is richly tinted to signal semantic category
  badgeTintedTextTone: 85, // bright fg tone: near-white text on dark tinted bg maintains legibility
  badgeTintedSurfaceIntensity: 65, // vivid bg chroma: badge background carries strong hue to identify category at a glance
  badgeTintedSurfaceTone: 60, // mid-bright bg tone: bright enough to carry chroma, dark enough for dark-mode contrast
  badgeTintedSurfaceAlpha: 15, // low alpha: tinted bg is a translucent wash, not a solid fill
  badgeTintedBorderIntensity: 50, // high border chroma: crisp hue ring frames the badge without a hard fill
  badgeTintedBorderTone: 50, // mid-tone border: sits between fg and bg tones for clean delineation
  badgeTintedBorderAlpha: 35, // moderate border alpha: more opaque than bg to give the ring definition

  // ===== Icon Style =====
  // How icons present in non-control contexts. Dark: bright tones. Light: dark tones.
  iconActiveTone: 80, // bright but not pure white: active icons are vivid without blending into fg text
  iconMutedIntensity: 7, // higher chroma for muted icons: compensates for low tone so the hue still reads
  iconMutedTone: 37, // dim tone: muted icons recede to signal non-primary status

  // ===== Tab Style =====
  // How tabs present. Dark: bright active fg. Light: dark active fg.
  tabTextActiveTone: 90, // near-white active tab label: clearly distinguished from muted inactive tabs

  // ===== Toggle Style =====
  // How toggles present. Dark: bright thumb. Light: dark track.
  toggleTrackOnHoverTone: 45, // mid-tone hover track: lifts from rest to signal the toggle is interactive
  toggleThumbDisabledTone: 40, // dim thumb when disabled: thumb recedes to match the disabled state's low contrast
  toggleTrackDisabledIntensity: 5, // low chroma disabled track: near-neutral to clearly communicate non-interactivity

  // ===== Field Style =====
  // How form fields present. Dark: dark bg tones. Light: light bg tones.
  fieldSurfaceRestTone: 8, // slightly above canvas: field bg is distinct from the app bg but not surface-bright
  fieldSurfaceHoverTone: 11, // matches surfaceDefault: hover lifts the field to the standard surface level
  fieldSurfaceFocusTone: 7, // below rest: focus darkens slightly to signal an inset, focused editing area
  fieldSurfaceDisabledTone: 6, // near-canvas: disabled fields recede to near-background to signal inactivity
  fieldSurfaceReadOnlyTone: 11, // same as hover: read-only shares the raised tone to distinguish from editable rest
  fieldSurfaceRestIntensity: 5, // moderate chroma: field bg carries enough hue to look intentional, not just dark
  disabledSurfaceIntensity: 5, // same as rest chroma: disabled bg retains the hue but the low tone signals the state
  disabledBorderIntensity: 6, // slightly higher chroma border: gives disabled fields a visible edge despite dim tone

  // ===== Hue Slot Dispatch =====
  // Which hue slot each surface/fg/icon/border tier reads from. String keys into ResolvedHueSlots.
  surfaceAppHueSlot: "canvas", // app bg uses canvas hue: the app background is the canvas itself
  surfaceCanvasHueSlot: "canvas", // canvas bg uses canvas hue: page-level bg reads from the same root slot
  surfaceSunkenHueSlot: "surfBareBase", // sunken uses bare-base: recessed wells use the neutral surface hue
  surfaceDefaultHueSlot: "surfBareBase", // default surface uses bare-base: standard cards stay close to neutral
  surfaceRaisedHueSlot: "atm", // raised uses atmosphere hue: popovers pick up the atmosphere tint for warmth
  surfaceOverlayHueSlot: "surfBareBase", // overlays use bare-base: modals stay neutral to not distract
  surfaceInsetHueSlot: "atm", // inset uses atmosphere hue: nested content areas warm up with the atm hue
  surfaceContentHueSlot: "atm", // content uses atmosphere hue: text-area regions share the inset warmth
  surfaceScreenHueSlot: "surfScreen", // screen uses its own slot: full-bleed bg uses a dedicated screen hue
  mutedTextHueSlot: "fgMuted", // muted fg uses dedicated slot: secondary text has its own hue resolution path
  subtleTextHueSlot: "fgSubtle", // subtle fg uses dedicated slot: tertiary text gets its own hue tuning
  disabledTextHueSlot: "fgDisabled", // disabled fg uses dedicated slot: disabled text resolves independently
  placeholderTextHueSlot: "fgPlaceholder", // placeholder uses dedicated slot: placeholder has its own hue path
  inverseTextHueSlot: "fgInverse", // inverse fg uses fgInverse slot: on-filled text resolves from its own slot
  onAccentTextHueSlot: "fgInverse", // on-accent fg shares fgInverse: accent surfaces use the same on-filled path
  iconMutedHueSlot: "fgSubtle", // muted icons share fgSubtle: muted icons align with subtle text hue
  iconOnAccentHueSlot: "fgInverse", // on-accent icons share fgInverse: icons on fills use the same slot as text
  dividerMutedHueSlot: "borderTintBareBase", // muted dividers use border tint: dividers pull from the border hue family
  disabledSurfaceHueSlot: "surfBareBase", // disabled bg uses bare-base: disabled surfaces stay neutral
  fieldSurfaceHoverHueSlot: "surfBareBase", // field hover uses bare-base: fields stay neutral on hover
  fieldSurfaceReadOnlyHueSlot: "surfBareBase", // read-only uses bare-base: read-only fields match the neutral surface
  fieldPlaceholderHueSlot: "fgPlaceholder", // field placeholder shares fgPlaceholder: consistent with text placeholder
  fieldBorderRestHueSlot: "fgPlaceholder", // rest border shares fgPlaceholder: border and placeholder are tonally paired
  fieldBorderHoverHueSlot: "fgSubtle", // hover border shifts to fgSubtle: border lifts to a more visible hue slot on focus
  toggleTrackDisabledHueSlot: "surfBareBase", // disabled track uses bare-base: neutral track signals off/disabled
  toggleThumbHueSlot: "fgInverse", // thumb uses fgInverse: thumb sits on the track like text on a filled surface
  checkmarkHueSlot: "fgInverse", // checkmark uses fgInverse: check icon is on a filled bg, same as on-filled text
  radioDotHueSlot: "fgInverse", // radio dot uses fgInverse: same rationale as checkmark — on-filled context
  tabSurfaceActiveHueSlot: "cardFrame", // active tab bg uses cardFrame: active tab shares the card frame hue slot
  tabSurfaceInactiveHueSlot: "cardFrame", // inactive tab bg uses cardFrame: both states read from the same frame slot

  // ===== Sentinel Hue Dispatch =====
  // Which sentinel hue slot hover/active backgrounds use. String keys (__highlight, __verboseHighlight, etc.).
  outlinedSurfaceHoverHueSlot: "__highlight", // outlined hover uses __highlight sentinel: triggers alpha-based hover wash
  outlinedSurfaceActiveHueSlot: "__highlight", // outlined active uses __highlight sentinel: same path, higher alpha
  ghostActionSurfaceHoverHueSlot: "__highlight", // ghost action hover uses __highlight: same sentinel as outlined hover
  ghostActionSurfaceActiveHueSlot: "__highlight", // ghost action active uses __highlight: same sentinel, higher alpha
  ghostOptionSurfaceHoverHueSlot: "__highlight", // ghost option hover uses __highlight: options share action sentinel
  ghostOptionSurfaceActiveHueSlot: "__highlight", // ghost option active uses __highlight: same sentinel path
  tabSurfaceHoverHueSlot: "__highlight", // tab hover uses __highlight: tabs use the same interactive sentinel
  tabCloseSurfaceHoverHueSlot: "__highlight", // tab close hover uses __highlight: close button shares the tab sentinel
  highlightHoverHueSlot: "__verboseHighlight", // highlight hover uses __verboseHighlight: verbose path for selection highlights

  // ===== Sentinel Alpha =====
  // Alpha values for sentinel-dispatched hover/active tokens. Percentage values 5-20.
  tabSurfaceHoverAlpha: 8, // slightly below outlined hover: tabs are less prominent interactive targets
  tabCloseSurfaceHoverAlpha: 12, // above tab hover: close button needs a stronger signal to feel safe to tap
  ghostActionSurfaceHoverAlpha: 10, // same as outlined hover: ghost actions share the baseline hover alpha
  ghostActionSurfaceActiveAlpha: 20, // same as outlined active: ghost actions share the baseline press alpha
  ghostOptionSurfaceHoverAlpha: 10, // same across ghost types: option hover matches action hover
  ghostOptionSurfaceActiveAlpha: 20, // same across ghost types: option press matches action press
  highlightHoverAlpha: 5, // half of standard hover: selection highlights are very subtle by design
  ghostDangerSurfaceHoverAlpha: 10, // same as standard hover: danger ghost uses the baseline hover wash
  ghostDangerSurfaceActiveAlpha: 20, // same as standard active: danger ghost uses the baseline press alpha

  // ===== Computed Tone Override =====
  // Flat-value overrides for computed tones and formula parameters. number or null.
  dividerDefaultToneOverride: 17, // just above surfaceScreen: dividers sit slightly brighter than screen bg
  dividerMutedToneOverride: 15, // below default divider: muted dividers recede further toward the background
  disabledTextToneComputed: 38, // above fgDisabled (23): disabled interactive text is slightly more legible than disabled labels
  disabledBorderToneOverride: 28, // between disabled fg and canvas: disabled borders are dim but still structural
  outlinedSurfaceRestToneOverride: null, // null: let formula derive rest bg from surfaceInset; avoids hardcoding a tone that must stay in sync
  outlinedSurfaceHoverToneOverride: null, // null: hover bg tone is governed by sentinel alpha path, not a fixed tone
  outlinedSurfaceActiveToneOverride: null, // null: press bg tone is governed by sentinel alpha path, not a fixed tone
  toggleTrackOffToneOverride: 28, // dim track when off: off-state track is clearly below the on-state brightness
  toggleDisabledToneOverride: 22, // near-disabled fg tone: disabled toggle is visually equivalent to disabled text
  surfaceCanvasToneBase: 5, // matches surfaceCanvasTone: base canvas tone before surfaceContrast modulation
  surfaceCanvasToneCenter: 50, // center of surfaceContrast range: no shift at knob midpoint
  surfaceCanvasToneScale: 8, // ±8 tone units at extremes: surfaceContrast modulates canvas tone across an 8-step range
  disabledSurfaceToneBase: 22, // above canvas, below active surfaces: disabled bg is distinct but recessive
  disabledSurfaceToneScale: 0, // zero scale: disabled bg does not modulate with surfaceContrast knob
  borderStrongToneComputed: 37, // just below fgSubtle (37): strong borders align with the subtle text tier for visual harmony

  // ===== Hue Name Dispatch =====
  // Named hue values for resolveHueSlots() branch elimination. String hue names.
  surfaceScreenHueExpression: "indigo", // indigo screen bg: cool blue-violet depth behind cards in the dark theme
  mutedTextHueExpression: "__bare_primary", // bare-primary sentinel: muted fg derives hue from the recipe's primary color
  subtleTextHueExpression: "indigo-cobalt", // indigo-cobalt subtle text: cool blue adds depth to tertiary labels
  disabledTextHueExpression: "indigo-cobalt", // same as subtle: disabled text uses the same cool hue family, just dimmer
  inverseTextHueExpression: "sapphire-cobalt", // sapphire-cobalt inverse: on-filled text uses a slightly warmer blue to complement fills
  placeholderTextHueExpression: "fgMuted", // placeholder derives from fgMuted: placeholder hue tracks secondary text rather than a fixed name
  selectionInactiveHueExpression: "yellow", // yellow inactive selection: warm yellow makes inactive selections visible without competing with blue focus

  // ===== Selection Mode =====
  // Selection behavior mode flags and parameters. Mode-specific boolean + numeric.
  selectionInactiveSemanticMode: true, // semantic mode on: inactive selection uses the named hue, not a sentinel path
  selectionSurfaceInactiveIntensity: 0, // zero chroma: inactive selection bg uses alpha alone — the yellow hue provides identity
  selectionSurfaceInactiveTone: 30, // dim tone: inactive selection bg is dark enough to not overpower content
  selectionSurfaceInactiveAlpha: 25, // low-moderate alpha: inactive selection is clearly visible but doesn't obscure text

  // ===== Signal Intensity Value =====
  signalIntensityValue: 50, // reference value: neutral default; compileRecipe() interpolates this from P6; DARK_FORMULAS retains it for backward-compat escape hatch [D06]
};

// ---------------------------------------------------------------------------
// LIGHT_FORMULAS — light theme formula values [D04]
// ---------------------------------------------------------------------------

/**
 * Complete formula bundle for a light-polarity recipe.
 * Standalone 202-field literal — no object spread, no inheritance from DARK_FORMULAS. [D01]
 *
 * All semantic groups are explicitly set with design-rationale annotations:
 *   - Canvas Darkness
 *   - Surface Layering
 *   - Surface Coloring
 *   - Text Brightness
 *   - Text Hierarchy
 *   - Text Coloring
 *   - Border Visibility
 *   - Card Frame Style
 *   - Shadow Depth
 *   - Filled Control Prominence
 *   - Outlined Control Style
 *   - Ghost Control Style
 *   - Badge Style
 *   - Icon Style
 *   - Tab Style
 *   - Toggle Style
 *   - Field Style
 *   - Hue Slot Dispatch
 *   - Sentinel Hue Dispatch
 *   - Sentinel Alpha
 *   - Computed Tone Override
 *   - Hue Name Dispatch
 *   - Selection Mode
 *   - Signal Intensity Value
 */
export const LIGHT_FORMULAS: DerivationFormulas = {
  // ===== Canvas Darkness =====
  // Light mode: near-white canvas. Inverse of dark's near-black tones 5.
  surfaceAppTone: 95, // near-white: light app background anchors the open, airy theme
  surfaceCanvasTone: 95, // same as surfaceAppTone: canvas and app share the same near-white base

  // ===== Surface Layering =====
  // Light mode: surfaces descend from near-white. Visual stacking is inverted —
  // lower tone = visually "deeper" (darker). At surfaceContrast=50, surfaces
  // step down from 95 toward 85 as they layer higher.
  surfaceSunkenTone: 88, // below canvas: recessed wells are visibly darker to show depth
  surfaceDefaultTone: 90, // standard card surface: slightly below canvas for clear definition
  surfaceRaisedTone: 92, // above default: popovers lift slightly (shadow adds more distinction)
  surfaceOverlayTone: 93, // near-white overlay: modals are light but slightly brighter than default
  surfaceInsetTone: 86, // below default: nested content areas recede visibly into the card
  surfaceContentTone: 86, // same as inset: text-area regions share the deep inset tone
  surfaceScreenTone: 85, // lowest tone: full-bleed screen bg is the darkest surface, pushing cards forward

  // ===== Surface Coloring =====
  // Light mode: slightly more chroma than dark to avoid washed-out appearance.
  atmosphereIntensity: 6, // moderate chroma: atmosphere hue is present and readable on light surfaces
  surfaceAppIntensity: 3, // near-neutral app bg: barely tinted to preserve the clean light anchor
  surfaceCanvasIntensity: 3, // same as surfaceAppIntensity: canvas matches app-level near-neutral chroma
  surfaceDefaultIntensity: 6, // moderate chroma: cards carry enough hue to feel warm, not clinical
  surfaceRaisedIntensity: 6, // same as default: raised surfaces match default chroma for visual parity
  surfaceOverlayIntensity: 5, // slightly lower: overlays desaturate slightly to recede behind content
  surfaceScreenIntensity: 8, // highest surface chroma: screen bg uses more hue to create depth behind cards
  surfaceInsetIntensity: 6, // matches default: inset wells share the moderate chroma of card surfaces
  surfaceContentIntensity: 6, // same as inset: content areas are consistent with the inset tier
  surfaceAppBaseIntensity: 3, // unified field for bg-app intensity: light mode uses near-neutral surfaceAppIntensity

  // ===== Text Brightness =====
  // Light mode: near-black text on light surfaces. Inverse of dark's near-white.
  contentTextTone: 8, // near-black: primary text is deeply dark to contrast against light surfaces
  inverseTextTone: 94, // near-white: inverse text sits on filled controls — stays near-white for legibility

  // ===== Text Hierarchy =====
  // Light mode: ascending from 8 (darker = more primary, lighter = less prominent).
  // Polarity is inverted from dark mode's descending-from-94 scale.
  mutedTextTone: 34, // secondary text: mid-dark tone clearly distinguishable from primary near-black
  subtleTextTone: 52, // tertiary text: lighter mid-tone signals low priority labels and captions
  disabledTextTone: 68, // near-mid: disabled content is clearly de-emphasized against light bg
  placeholderTextTone: 60, // between disabled and subtle: placeholder is inactive but still scannable

  // ===== Text Coloring =====
  // Light mode: slightly more chroma to compensate for high-tone text being less saturated.
  contentTextIntensity: 4, // near-neutral with slight lift: primary text carries a hint of hue for warmth
  subtleTextIntensity: 8, // higher chroma for subtle tiers: tinted labels use more hue to signal semantic meaning
  mutedTextIntensity: 6, // moderate chroma: muted text picks up more hue to stay warm and readable
  atmosphereBorderIntensity: 7, // atmosphere-hued borders use higher chroma on light bg to stay visible
  inverseTextIntensity: 3, // near-neutral: inverse text on filled controls mirrors primary text's low chroma
  onCautionTextIntensity: 5, // caution surfaces are vivid; text chroma is moderate on light to avoid wash
  onSuccessTextIntensity: 5, // same as caution: success surfaces are vivid, text stays moderate

  // ===== Border Visibility =====
  // Light mode: crisp borders need higher intensity to be visible against light surfaces.
  borderBaseIntensity: 8, // crisp chroma: default borders need more saturation to register on light bg
  borderStrongIntensity: 10, // highest chroma: strong borders are clearly visible and assertive
  borderMutedTone: 62, // mid-light tone: muted borders are visible but recessive on light surfaces
  borderMutedIntensity: 8, // higher chroma: compensates for light-tone dilution to keep muted borders legible
  borderStrongTone: 52, // mid-tone: strong borders are darker than muted for clear emphasis
  dividerDefaultIntensity: 7, // matches borderBaseIntensity: dividers use the same crisp baseline as borders
  dividerMutedIntensity: 5, // lower than default: muted dividers are the most recessive structural element
  borderSignalTone: 40, // below mid-tone: light backgrounds require darker signal borders to avoid neon glow
  semanticSignalTone: 35, // darker than border: semantic tokens need more contrast against bright light surfaces
  accentSubtleTone: 50, // standard mid-tone: on bright light surfaces at low alpha, fg-default easily achieves contrast ≥75; no calibration needed
  cautionSurfaceTone: 35, // matches semanticSignalTone: caution bg uses same tone as other semantic tones in light mode; composited over bright surfaces fg-default passes contrast ≥75

  // ===== Card Frame Style =====
  // Light mode: bright tones (vs dark's dim tones 15-18). Frames sit just below canvas.
  cardFrameActiveIntensity: 35, // strong chroma: active title bar shows vivid hue to clearly signal focus
  cardFrameActiveTone: 85, // mid-light tone: darker than surface-default (90) so the header reads as a distinct active band, not just bright
  cardFrameInactiveIntensity: 5, // near-neutral: inactive frames recede without competing with active card
  cardFrameInactiveTone: 90, // matches surface-default: inactive frame blends with content, active frame pops by contrast

  // ===== Shadow Depth =====
  // Light mode: lighter shadow alphas — shadows on light bg are less dramatic.
  shadowXsAlpha: 10, // subtle: extra-small shadows add depth without visual weight
  shadowMdAlpha: 25, // light-moderate: medium shadows separate floating panels clearly
  shadowLgAlpha: 35, // moderate: large shadows for prominent floats like menus
  shadowXlAlpha: 40, // heaviest light-mode shadow: conveys maximum elevation for dialogs
  shadowOverlayAlpha: 30, // slightly above medium: floating overlay panels need clear separation
  overlayDimAlpha: 32, // ~one-third opacity: dim overlay tints without fully obscuring content
  overlayScrimAlpha: 48, // above dim: modal scrims block the background more assertively
  overlayHighlightAlpha: 4, // barely visible: highlight tints are very subtle on light surfaces

  // ===== Filled Control Prominence =====
  // Light mode: filled controls stay vivid — same tone approach as dark (mid-tone vivid fill).
  filledSurfaceRestTone: 20, // dark rest state: same as dark — filled buttons stay bold and vivid
  filledSurfaceHoverTone: 40, // same as dark: hover lifts dramatically to signal interactivity
  filledSurfaceActiveTone: 50, // same as dark: press confirms with one more step up

  // ===== Outlined Control Style =====
  // Light mode: fg/icon use near-dark tones (8) to contrast against light surfaces.
  // The derivation rules use outlinedTextRestTone (not outlinedTextRestToneLight), so we
  // override the primary tone fields here for the light recipe.
  outlinedTextRestTone: 8, // near-black fg at rest: dark text on light outlined button bg
  outlinedTextHoverTone: 8, // same across states: tone stays constant; state change is bg
  outlinedTextActiveTone: 8, // same across states
  outlinedTextIntensity: 4, // slight chroma: fg text carries a hint of hue for warmth on light bg
  outlinedIconRestTone: 8, // near-black icons at rest: mirrors fg tone for visual consistency
  outlinedIconHoverTone: 8, // same across states
  outlinedIconActiveTone: 8, // same across states
  outlinedIconIntensity: 4, // same as fg chroma: icons match text warmth
  outlinedTextRestToneLight: 0, // legacy light-mode counterpart field: derivation uses outlinedTextRestTone (set to 8 above) for both modes; this field is pure black (tone 0) and is mode-independent — value matches DARK_FORMULAS
  outlinedTextHoverToneLight: 0, // same across states: legacy counterpart, derivation dispatches via primary tone field
  outlinedTextActiveToneLight: 0, // same across states: legacy counterpart, derivation dispatches via primary tone field
  outlinedIconRestToneLight: 0, // legacy light-mode counterpart for icons: derivation uses outlinedIconRestTone (set to 8 above); this value is pure black — mode-independent
  outlinedIconHoverToneLight: 0, // same across states: legacy counterpart, derivation dispatches via primary icon tone field
  outlinedIconActiveToneLight: 0, // same across states: legacy counterpart, derivation dispatches via primary icon tone field
  outlinedOptionBorderRestTone: 50, // mid-dark rest border: tone 50 is mid-dark against near-white light surfaces — clearly visible without being harsh; aligns with borderStrongTone (52)
  outlinedOptionBorderHoverTone: 55, // slightly lower on hover: border shifts toward mid-tone to acknowledge the hover bg change
  outlinedOptionBorderActiveTone: 60, // mid-tone on press: border lifts further toward mid-range to confirm active state — consistent with dark mode's directional signal
  // outlinedSurfaceHoverIntensity / outlinedSurfaceActiveIntensity: light mode uses direct chroma, not sentinel.
  outlinedSurfaceHoverIntensity: 4, // direct chroma: light-mode hover bg is a solid tinted surface, not alpha sentinel
  outlinedSurfaceHoverAlpha: 100, // fully opaque: light-mode hover bg is a solid surface (no alpha wash)
  outlinedSurfaceActiveIntensity: 6, // higher chroma: press bg is more saturated than hover for clear click feedback
  outlinedSurfaceActiveAlpha: 100, // fully opaque: press bg is also solid

  // ===== Ghost Control Style =====
  // Light mode: fg/icon use near-dark tones (8) to contrast against light surfaces.
  // The derivation rules use ghostTextRestTone (not ghostTextRestToneLight), so we
  // override the primary tone fields here for the light recipe.
  ghostTextRestTone: 8, // near-black fg at rest: dark text on light ghost button surfaces
  ghostTextHoverTone: 8, // same across states: tone stays constant; state change is bg alpha
  ghostTextActiveTone: 8, // same across states
  ghostTextRestIntensity: 4, // slight chroma: near-neutral for clean readability
  ghostTextHoverIntensity: 4, // same across states
  ghostTextActiveIntensity: 4, // same across states
  ghostIconRestTone: 8, // near-black icons at rest: mirrors fg tone for visual consistency
  ghostIconHoverTone: 8, // same across states
  ghostIconActiveTone: 8, // same across states
  ghostIconRestIntensity: 4, // same as fg chroma: icons match text warmth
  ghostIconHoverIntensity: 4, // same across states
  ghostIconActiveIntensity: 4, // same across states
  ghostBorderIntensity: 20, // elevated chroma: visible hue-tinted ring without filled bg
  ghostBorderTone: 35, // darker tone: border must be dark enough to show against light surfaces
  ghostTextRestToneLight: 0, // legacy light-mode counterpart field: derivation uses ghostTextRestTone (set to 8 above) for both modes; this field is pure black (tone 0) and is mode-independent — value matches DARK_FORMULAS
  ghostTextHoverToneLight: 0, // same across states: legacy counterpart, derivation dispatches via primary tone field
  ghostTextActiveToneLight: 0, // same across states: legacy counterpart, derivation dispatches via primary tone field
  ghostTextRestIntensityLight: 0, // legacy light-mode chroma counterpart: derivation uses ghostTextRestIntensity (set to 4 above); pure black is achromatic (I=0) — mode-independent
  ghostTextHoverIntensityLight: 0, // same across states: legacy counterpart, derivation dispatches via primary chroma field
  ghostTextActiveIntensityLight: 0, // same across states: legacy counterpart, derivation dispatches via primary chroma field
  ghostIconRestToneLight: 0, // legacy light-mode icon counterpart: derivation uses ghostIconRestTone (set to 8 above); pure black mirrors pure-black fg — mode-independent
  ghostIconHoverToneLight: 0, // same across states: legacy counterpart, derivation dispatches via primary icon tone field
  ghostIconActiveToneLight: 0, // same across states: legacy counterpart, derivation dispatches via primary icon tone field
  ghostIconActiveIntensityLight: 0, // legacy light-mode icon chroma counterpart: pure black is achromatic (I=0) — mode-independent

  // ===== Badge Style =====
  // Light mode: dark fg on tinted bg (inverse of dark's bright fg on dark bg).
  badgeTintedTextIntensity: 72, // high chroma fg: badge label text is richly tinted
  badgeTintedTextTone: 15, // near-black fg: dark text on light tinted bg for maximum legibility
  badgeTintedSurfaceIntensity: 65, // vivid bg chroma: badge background carries strong hue to identify category
  badgeTintedSurfaceTone: 80, // light bg tone: bright tinted wash on light surface
  badgeTintedSurfaceAlpha: 20, // slightly higher alpha than dark: light tinted bg needs more opacity to show
  badgeTintedBorderIntensity: 50, // high border chroma: crisp hue ring frames the badge
  badgeTintedBorderTone: 40, // mid-dark border: darker than bg to give the ring clear definition on light bg
  badgeTintedBorderAlpha: 40, // slightly more opaque than bg: border ring stands out from the tinted wash

  // ===== Icon Style =====
  // Light mode: dark tones for icons on light backgrounds (inverse of dark's bright tones).
  iconActiveTone: 20, // near-dark: active icons are vivid and dark without blending into text
  iconMutedIntensity: 7, // same chroma: compensates for mid-tone to keep hue readable
  iconMutedTone: 52, // mid-tone: muted icons recede on light bg without disappearing

  // ===== Tab Style =====
  // Light mode: dark active fg on light tab bar.
  tabTextActiveTone: 10, // near-black: clearly distinguished from muted inactive tabs on light frame

  // ===== Toggle Style =====
  // Light mode: dark track on light bg.
  toggleTrackOnHoverTone: 35, // darker than dark-mode hover: track must be darker to show on light bg
  toggleThumbDisabledTone: 65, // mid-light thumb when disabled: recedes on light surface
  toggleTrackDisabledIntensity: 5, // same low chroma: neutral to clearly communicate non-interactivity

  // ===== Field Style =====
  // Light mode: light bg tones (near-white, stepping from canvas tone).
  fieldSurfaceRestTone: 91, // just below canvas: field bg is distinct from app bg but stays light
  fieldSurfaceHoverTone: 88, // matches surfaceDefault: hover steps down for clear hover feedback
  fieldSurfaceFocusTone: 92, // slightly above rest: focus brightens slightly to signal an active editing area
  fieldSurfaceDisabledTone: 94, // near-canvas: disabled fields recede toward bg to signal inactivity
  fieldSurfaceReadOnlyTone: 88, // same as hover: read-only shares raised distinction from editable rest
  fieldSurfaceRestIntensity: 5, // moderate chroma: field carries enough hue to look intentional
  disabledSurfaceIntensity: 4, // slightly lower: disabled bg retains the hue softly
  disabledBorderIntensity: 6, // same: gives disabled fields a visible edge despite light-mode tone

  // ===== Hue Slot Dispatch =====
  // Hue-slot routing is mode-independent: these fields select which palette slot drives a
  // token's hue angle, not its lightness. Surface polarity (dark vs light) is handled by
  // the tone fields above. Same slot assignments as DARK_FORMULAS.
  surfaceAppHueSlot: "canvas", // mode-independent: app bg uses canvas hue slot in both modes — palette identity is the same
  surfaceCanvasHueSlot: "canvas", // mode-independent: canvas bg uses canvas slot in both modes
  surfaceSunkenHueSlot: "surfBareBase", // mode-independent: sunken surfaces route through bare-base slot in both modes
  surfaceDefaultHueSlot: "surfBareBase", // mode-independent: default card surfaces use bare-base slot in both modes
  surfaceRaisedHueSlot: "atm", // mode-independent: raised surfaces (popovers) use atm hue in both modes — warmth consistency
  surfaceOverlayHueSlot: "surfBareBase", // mode-independent: overlays use bare-base slot in both modes
  surfaceInsetHueSlot: "atm", // mode-independent: inset wells use atm hue in both modes — matches raised context
  surfaceContentHueSlot: "atm", // mode-independent: content areas use atm hue in both modes — consistency with inset
  surfaceScreenHueSlot: "surfScreen", // mode-independent: screen surfaces use surfScreen slot in both modes
  mutedTextHueSlot: "fgMuted", // mode-independent: muted fg routes through its dedicated slot in both modes
  subtleTextHueSlot: "fgSubtle", // mode-independent: subtle fg routes through its dedicated slot in both modes
  disabledTextHueSlot: "fgDisabled", // mode-independent: disabled fg routes through its dedicated slot in both modes
  placeholderTextHueSlot: "fgPlaceholder", // mode-independent: placeholder text routes through its dedicated slot in both modes
  inverseTextHueSlot: "fgInverse", // mode-independent: inverse fg routes through fgInverse slot in both modes
  onAccentTextHueSlot: "fgInverse", // mode-independent: on-accent fg shares fgInverse slot in both modes — same palette identity
  iconMutedHueSlot: "fgSubtle", // mode-independent: muted icons share fgSubtle slot in both modes — icons echo text hue
  iconOnAccentHueSlot: "fgInverse", // mode-independent: on-accent icons share fgInverse slot in both modes
  dividerMutedHueSlot: "borderTintBareBase", // mode-independent: muted dividers route through border tint slot in both modes
  disabledSurfaceHueSlot: "surfBareBase", // mode-independent: disabled bg uses bare-base slot in both modes — neutral recessive
  fieldSurfaceHoverHueSlot: "surfBareBase", // mode-independent: field hover bg routes through bare-base slot in both modes
  fieldSurfaceReadOnlyHueSlot: "surfBareBase", // mode-independent: read-only field bg routes through bare-base slot in both modes
  fieldPlaceholderHueSlot: "fgPlaceholder", // mode-independent: placeholder text shares fgPlaceholder slot in both modes
  fieldBorderRestHueSlot: "fgPlaceholder", // mode-independent: rest border shares fgPlaceholder slot in both modes — recessive default
  fieldBorderHoverHueSlot: "fgSubtle", // mode-independent: hover border shifts to fgSubtle slot in both modes — signals interactivity
  toggleTrackDisabledHueSlot: "surfBareBase", // mode-independent: disabled track uses bare-base slot in both modes — neutral signal
  toggleThumbHueSlot: "fgInverse", // mode-independent: toggle thumb routes through fgInverse slot in both modes — high-contrast knob
  checkmarkHueSlot: "fgInverse", // mode-independent: checkmark routes through fgInverse slot in both modes — on-filled-control glyph
  radioDotHueSlot: "fgInverse", // mode-independent: radio dot routes through fgInverse slot in both modes — same as checkmark
  tabSurfaceActiveHueSlot: "cardFrame", // mode-independent: active tab bg routes through cardFrame slot in both modes — matches title bar
  tabSurfaceInactiveHueSlot: "cardFrame", // mode-independent: inactive tab bg shares cardFrame slot in both modes — same hue, lower tone

  // ===== Sentinel Hue Dispatch =====
  // Sentinel slots (__highlight, __verboseHighlight) are mode-independent: they bypass the
  // hue/tone/alpha chromatic path and use a fixed white-alpha tint. Same sentinel routing
  // as DARK_FORMULAS — the tint behavior works on both dark and light surfaces.
  outlinedSurfaceHoverHueSlot: "__highlight", // mode-independent: outlined hover uses white-alpha __highlight sentinel in both modes
  outlinedSurfaceActiveHueSlot: "__highlight", // mode-independent: outlined active uses __highlight sentinel in both modes
  ghostActionSurfaceHoverHueSlot: "__highlight", // mode-independent: ghost action hover uses __highlight sentinel in both modes
  ghostActionSurfaceActiveHueSlot: "__highlight", // mode-independent: ghost action active uses __highlight sentinel in both modes
  ghostOptionSurfaceHoverHueSlot: "__highlight", // mode-independent: ghost option hover uses __highlight sentinel in both modes
  ghostOptionSurfaceActiveHueSlot: "__highlight", // mode-independent: ghost option active uses __highlight sentinel in both modes
  tabSurfaceHoverHueSlot: "__highlight", // mode-independent: tab hover uses __highlight sentinel in both modes
  tabCloseSurfaceHoverHueSlot: "__highlight", // mode-independent: tab close hover uses __highlight sentinel in both modes
  highlightHoverHueSlot: "__verboseHighlight", // mode-independent: highlight hover uses __verboseHighlight sentinel in both modes

  // ===== Sentinel Alpha =====
  // Sentinel alpha values control the opacity of white-tint hover/active overlays. These
  // are mode-independent: the same percentage wash reads consistently on both dark and
  // light surfaces because the tint color (white) adapts visually with the surface tone.
  // Same alpha values as DARK_FORMULAS.
  tabSurfaceHoverAlpha: 8, // mode-independent: 8% white wash on tab hover — subtle state change in both modes
  tabCloseSurfaceHoverAlpha: 12, // mode-independent: 12% white wash on close button hover — slightly stronger than tab hover
  ghostActionSurfaceHoverAlpha: 10, // mode-independent: 10% white wash on ghost action hover — same as outlined
  ghostActionSurfaceActiveAlpha: 20, // mode-independent: 20% white wash on ghost action press — same as outlined
  ghostOptionSurfaceHoverAlpha: 10, // mode-independent: 10% white wash on ghost option hover — consistent with action hover
  ghostOptionSurfaceActiveAlpha: 20, // mode-independent: 20% white wash on ghost option press
  highlightHoverAlpha: 5, // mode-independent: 5% white wash on selection highlight hover — very subtle
  ghostDangerSurfaceHoverAlpha: 10, // mode-independent: 10% white wash on danger ghost hover — same ratio as standard ghost
  ghostDangerSurfaceActiveAlpha: 20, // mode-independent: 20% white wash on danger ghost press

  // ===== Computed Tone Override =====
  // Light mode: dividers and disabled controls are recalibrated for light surfaces.
  dividerDefaultToneOverride: 78, // mid-light tone: dividers are visible on light surfaces without being harsh
  dividerMutedToneOverride: 82, // lighter than default divider: muted dividers recede further
  disabledTextToneComputed: 62, // above fgDisabled (68): slightly more legible than fully disabled labels
  disabledBorderToneOverride: 72, // lighter than dark: disabled borders are visible but clearly passive
  outlinedSurfaceRestToneOverride: null, // null: let formula derive rest bg from surfaceInset
  outlinedSurfaceHoverToneOverride: null, // null: hover bg governed by direct I/alpha path in light mode
  outlinedSurfaceActiveToneOverride: null, // null: press bg governed by direct I/alpha path in light mode
  toggleTrackOffToneOverride: 72, // lighter off-track: clearly below on-state brightness on light bg
  toggleDisabledToneOverride: 80, // near-light: disabled toggle is visually equivalent to disabled state
  surfaceCanvasToneBase: 95, // matches surfaceCanvasTone: base canvas tone before surfaceContrast modulation
  surfaceCanvasToneCenter: 50, // center of surfaceContrast range: no shift at knob midpoint
  surfaceCanvasToneScale: 8, // same ±8 range: surfaceContrast modulates canvas across an 8-step range
  disabledSurfaceToneBase: 78, // lighter than dark's 22: disabled bg is distinct but recessive on light bg
  disabledSurfaceToneScale: 0, // zero scale: disabled bg does not modulate with surfaceContrast knob
  borderStrongToneComputed: 40, // mid-dark: strong borders align with the subtle text tier for visual harmony

  // ===== Hue Name Dispatch =====
  // Light mode overrides for derived hue slots that differ from dark.
  surfaceScreenHueExpression: "cobalt", // cobalt screen bg: light surface screen uses text hue for continuity
  mutedTextHueExpression: "__bare_primary", // mode-independent: bare-primary sentinel derives muted fg from the primary hue in both modes — palette identity is the same
  subtleTextHueExpression: "indigo-cobalt", // mode-independent: indigo-cobalt is the palette hue for subtle fg text in both modes
  disabledTextHueExpression: "indigo-cobalt", // mode-independent: indigo-cobalt is the palette hue for disabled fg text in both modes
  inverseTextHueExpression: "sapphire-cobalt", // mode-independent: sapphire-cobalt drives inverse fg in both modes — same palette identity
  placeholderTextHueExpression: "atm", // placeholder derives from atm: light-mode placeholder uses surface hue for softness
  selectionInactiveHueExpression: "yellow", // mode-independent: yellow is the inactive selection hue in both modes — warm highlight identity

  // ===== Selection Mode =====
  // Light mode: atm-offset path for inactive selection (more natural on light canvas).
  selectionInactiveSemanticMode: false, // atm-offset mode: inactive selection uses warmth-biased atm hue - 20°
  selectionSurfaceInactiveIntensity: 8, // moderate chroma: selection tint is visibly colored on light surfaces
  selectionSurfaceInactiveTone: 80, // light-mode tone: selection bg is mid-light to show through without obscuring
  selectionSurfaceInactiveAlpha: 30, // slightly higher alpha: selection is clearly visible on light canvas

  // ===== Signal Intensity Value =====
  signalIntensityValue: 50, // reference value: neutral default; compileRecipe() interpolates this from P6; LIGHT_FORMULAS retains it for backward-compat escape hatch [D06]
};
