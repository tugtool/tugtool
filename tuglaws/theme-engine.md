# Theme Engine

*The theme engine transforms a `ThemeRecipe` into ~373 `--tug-base-*` CSS tokens through a four-step data-driven pipeline. Dark and light are separate recipes — no mode branching in code.*

*Cross-references: `[D##]` → [design-decisions.md](design-decisions.md). `[L##]` → [laws-of-tug.md](laws-of-tug.md).*

---

## Pipeline

```
ThemeRecipe
    │
    ▼
Step 0: compileRecipe()     → DerivationFormulas (interpolate 7 design parameters into ~202 formula fields)
    │
    ▼
Layer 1: resolveHueSlots()  → ResolvedHueSlots   (resolve recipe hue names to angles, apply warmth)
    │
    ▼
Layer 2: computeTones()     → ComputedTones       (derive surface/control tones from formulas + knobs)
    │
    ▼
Layer 3: evaluateRules()    → CSS tokens          (declarative RULES table produces all --tug-base-* tokens)
```

---

## ThemeRecipe

The author-facing interface. Three groups of hue inputs plus three mood knobs.

### Surface Hues

| Field | Purpose |
|-------|---------|
| `surface.canvas` | App and canvas backgrounds |
| `surface.card` | Card surfaces (atmosphere hue) |

### Element Hues

| Field | Purpose | Contrast Role |
|-------|---------|---------------|
| `element.content` | Prose, body text | `content` (75) |
| `element.control` | Interactive labels (buttons, tabs) | `control` (60) |
| `element.display` | Titles, headers, card titles | `display` (60) |
| `element.informational` | Metadata, placeholders, muted text | `informational` (60) |
| `element.border` | Borders, dividers; card frame derived from this | — |
| `element.decorative` | Non-text ornamental marks | `decorative` (15) |

### Role Hues

| Field | Purpose |
|-------|---------|
| `role.accent` | Brand accent (orange) |
| `role.action` | Interactive signals, links, selection (blue) |
| `role.success` | Positive outcomes (green) |
| `role.caution` | Attention needed (yellow) |
| `role.danger` | Errors, destructive actions (red) |
| `role.agent` | AI activity (violet) |
| `role.data` | Measurements, metrics (teal) |

### Mood Knobs

| Knob | Range | Effect |
|------|-------|--------|
| `surfaceContrast` | 0–100 | Scales surface tone layering depth |
| `signalIntensity` | 0–100 | Scales signal role saturation |
| `warmth` | 0–100 | Biases resolved hue angles toward warm tones |

---

## DerivationFormulas

The engine's full parameter set — ~202 fields organized into **23 semantic decision groups**. Each group controls one design concern. `DARK_FORMULAS` and `LIGHT_FORMULAS` are complete, independent instances of this interface — all dark/light differences are expressed as different constant values, never as branching logic.

### Field Naming Convention

Every formula field follows a four-slot pattern:

```
<context><Constituent><State><Parameter>
```

| Slot | Purpose | Examples |
|------|---------|----------|
| **context** | What design concern | `surface`, `filled`, `outlined`, `ghost`, `content`, `badge`, `field`, `toggle` |
| **constituent** | What part | `Surface`, `Text`, `Icon`, `Border`, `Shadow`, `Track`, `Thumb` |
| **state** | What condition | `Rest`, `Hover`, `Active`, `Disabled`, `ReadOnly`; omitted for stateless |
| **parameter** | What property | `Tone`, `Intensity`, `Alpha`, `HueSlot`, `HueExpression` |

Examples: `filledSurfaceHoverTone`, `outlinedTextRestIntensity`, `ghostIconActiveIntensity`, `shadowMdAlpha`, `fieldSurfaceDisabledTone`.

### The 23 Decision Groups

**Surface character** — what the backgrounds look and feel like:

| Group | Controls | Key Fields |
|-------|----------|------------|
| **canvas-darkness** | Base app/canvas lightness | `surfaceAppTone`, `surfaceCanvasTone` |
| **surface-layering** | Relative tone of each surface tier | `surfaceSunkenTone`, `surfaceDefaultTone`, `surfaceRaisedTone`, `surfaceOverlayTone`, `surfaceInsetTone`, `surfaceContentTone`, `surfaceScreenTone` |
| **surface-coloring** | Chroma saturation of surfaces | `atmosphereIntensity`, `surfaceAppIntensity`, `surfaceCanvasIntensity`, `surfaceDefaultIntensity`, `surfaceRaisedIntensity`, and others |

**Text character** — how text reads against surfaces:

| Group | Controls | Key Fields |
|-------|----------|------------|
| **text-brightness** | Primary/inverse text lightness | `contentTextTone`, `inverseTextTone` |
| **text-hierarchy** | Secondary/tertiary/disabled text levels | `mutedTextTone`, `subtleTextTone`, `disabledTextTone`, `placeholderTextTone` |
| **text-coloring** | Text chroma saturation | `contentTextIntensity`, `subtleTextIntensity`, `mutedTextIntensity` |

**Structural elements** — borders, shadows, card frames:

| Group | Controls | Key Fields |
|-------|----------|------------|
| **border-visibility** | Border/divider tone and intensity | `borderBaseIntensity`, `borderStrongIntensity`, `borderMutedTone`, `dividerDefaultIntensity` |
| **card-frame-style** | Active/inactive card frame appearance | `cardFrameActiveIntensity`, `cardFrameActiveTone`, `cardFrameInactiveIntensity`, `cardFrameInactiveTone` |
| **shadow-depth** | Shadow opacity at each size tier | `shadowXsAlpha`, `shadowMdAlpha`, `shadowLgAlpha`, `shadowXlAlpha`, `shadowOverlayAlpha` |

**Interactive controls** — buttons in each emphasis level:

| Group | Controls | Key Fields |
|-------|----------|------------|
| **filled-control-prominence** | Filled button surface tones per state | `filledSurfaceRestTone`, `filledSurfaceHoverTone`, `filledSurfaceActiveTone` |
| **outlined-control-style** | Outlined button text/icon/border/surface per state | `outlinedTextRestTone`, `outlinedTextHoverTone`, `outlinedIconRestTone`, `outlinedSurfaceHoverIntensity`, `outlinedSurfaceHoverAlpha`, and others |
| **ghost-control-style** | Ghost button text/icon per state | `ghostTextRestTone`, `ghostTextHoverTone`, `ghostIconRestIntensity`, and others |

**Component-specific styling:**

| Group | Controls | Key Fields |
|-------|----------|------------|
| **badge-style** | Tinted badge text/surface/border | `badgeTintedTextIntensity`, `badgeTintedSurfaceTone`, `badgeTintedSurfaceAlpha` |
| **icon-style** | Icon tones for active/muted states | `iconActiveTone`, `iconMutedIntensity`, `iconMutedTone` |
| **tab-style** | Tab text active tone | `tabTextActiveTone` |
| **toggle-style** | Toggle track/thumb appearance | `toggleTrackOnHoverTone`, `toggleThumbDisabledTone`, `toggleTrackDisabledIntensity` |
| **field-style** | Form field surfaces per state | `fieldSurfaceRestTone`, `fieldSurfaceHoverTone`, `fieldSurfaceFocusTone`, `fieldSurfaceDisabledTone` |

**Hue routing** — which resolved hue slot each token group uses:

| Group | Controls | Key Fields |
|-------|----------|------------|
| **hue-slot-dispatch** | Maps surface/element groups to hue slots | `surfaceAppHueSlot`, `surfaceCanvasHueSlot`, `mutedTextHueSlot`, `subtleTextHueSlot`, `fieldSurfaceHoverHueSlot`, and others |
| **sentinel-hue-dispatch** | Hue slots for hover/active highlight surfaces | `outlinedSurfaceHoverHueSlot`, `ghostActionSurfaceHoverHueSlot`, `highlightHoverHueSlot`, and others |
| **hue-name-dispatch** | Direct hue name expressions (bypass slot resolution) | `surfaceScreenHueExpression`, `mutedTextHueExpression`, `selectionInactiveHueExpression` |

**System-level:**

| Group | Controls | Key Fields |
|-------|----------|------------|
| **sentinel-alpha** | Alpha values for translucent highlights | `tabSurfaceHoverAlpha`, `ghostActionSurfaceHoverAlpha`, `highlightHoverAlpha` |
| **computed-tone-override** | Override values for `computeTones()` derived tones | `dividerDefaultToneOverride`, `outlinedSurfaceRestToneOverride`, `surfaceCanvasToneBase`, `surfaceCanvasToneScale` |
| **selection-mode** | Inactive selection appearance | `selectionInactiveSemanticMode`, `selectionSurfaceInactiveTone`, `selectionSurfaceInactiveAlpha` |
| **signal-intensity** | Signal role saturation scaling | `signalIntensityValue` |

---

## ComputedTones

Pre-computed tone values derived from `DerivationFormulas` + `MoodKnobs`. Each surface tone is anchored at its formula value when `surfaceContrast=50`, then scales with the knob.

| Field | Derived From |
|-------|-------------|
| `surfaceApp`, `surfaceCanvas` | Base tone + surfaceContrast scaling |
| `surfaceSunken` through `surfaceScreen` | Each surface tier, independently scaled |
| `dividerDefault`, `dividerMuted`, `dividerTone` | Override field or derived from surfaceOverlay |
| `disabledSurfaceTone`, `disabledTextTone`, `disabledBorderTone` | Override fields or derived from divider tones |
| `outlinedSurfaceRestTone` through `outlinedSurfaceActiveTone` | Override fields or derived from surface tiers |
| `toggleTrackOffTone`, `toggleDisabledTone` | Override fields or derived from divider/overlay tones |
| `signalIntensity` | Direct from `signalIntensityValue` |

---

## Resolved Hue Slots

Layer 1 resolves every hue reference in the recipe to a `ResolvedHueSlot` with four properties:

| Property | Purpose |
|----------|---------|
| `angle` | Warmth-biased hue angle in degrees |
| `name` | Closest hue family name (e.g., `"violet"`) |
| `ref` | Formatted `--tug-color()` reference (e.g., `"indigo-cobalt"`) |
| `primaryName` | Primary color for canonical-L / max-chroma lookup |

**Recipe slots** (8): `atm`, `txt`, `canvas`, `cardFrame`, `borderTint`, `interactive`, `active`, `accent`

**Element slots** (4): `control`, `display`, `informational`, `decorative`

**Semantic slots** (5): `destructive`, `success`, `caution`, `agent`, `data` — these are not biased by warmth

**Derived slots** (10): `surfBareBase`, `surfScreen`, `fgMuted`, `fgSubtle`, `fgDisabled`, `fgInverse`, `fgPlaceholder`, `selectionInactive`, `borderTintBareBase`, `borderStrong`

---

## Dark vs. Light

`DARK_FORMULAS` and `LIGHT_FORMULAS` are complete, independent formula sets. All mode differences are encoded as different constant values:

| Concern | Dark | Light |
|---------|------|-------|
| Canvas tone | 5 (near-black) | 95 (near-white) |
| Content text tone | 94 (off-white) | 8 (near-black) |
| Surface layering direction | Lighter = elevated | Darker = recessed |
| Filled control states | Lighten on hover/active | Lighten on hover/active |

`deriveTheme()` receives a formula set and never branches on mode. A recipe's `mode` field selects which formula set `compileRecipe()` starts from.
