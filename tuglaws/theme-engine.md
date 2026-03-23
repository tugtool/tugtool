# Theme Engine

*The theme engine transforms a `ThemeRecipe` into 373 `--tug-*` CSS tokens through a four-step data-driven pipeline. Dark and light are separate recipes — no mode branching in code.*

*Cross-references: `[D##]` → [design-decisions.md](design-decisions.md). `[L##]` → [laws-of-tug.md](laws-of-tug.md).*

---

## Architecture Overview

Themes are JSON data files, not TypeScript constants. [D01]

| Storage | Location | Use |
|---------|----------|-----|
| **Shipped themes** | `tugdeck/themes/*.json` | Version-controlled, read-only |
| **Authored themes** | `~/.tugtool/themes/*.json` | User data, not in repo |

Theme names are unique across both directories — a theme exists in exactly one location. [D02]

**Brio** is the base theme. Its tokens are the baseline CSS in `styles/tug-base-generated.css`. Switching to Brio removes the override `<style>` element; all other themes work as cascade overrides on top of Brio. [D03]

### Theme Loading Flow

1. `generate-tug-tokens.ts` reads `tugdeck/themes/*.json`, runs `deriveTheme()` on each, and writes CSS output
2. Brio output goes to `styles/tug-base-generated.css` (imported by `tug-base.css`)
3. Other themes write to `styles/themes/<name>.css`
4. Runtime: theme provider fetches CSS via Vite middleware (`GET /__themes/<name>.css`) and injects a `<style>` element [D88]

---

## Pipeline

```
ThemeRecipe (from .json file)
    │
    ▼
Step 0: compileRecipe()     → DerivationFormulas (interpolate design parameters into ~202 formula fields)
    │
    ▼
Layer 1: resolveHueSlots()  → ResolvedHueSlots   (resolve recipe hue names to palette angles)
    │
    ▼
Layer 2: computeTones()     → ComputedTones       (derive surface/control tones from formula fields)
    │
    ▼
Layer 3: evaluateRules()    → CSS tokens          (declarative RULES table produces all --tug-* tokens)
```

`deriveTheme()` returns a `ThemeOutput` containing:

| Field | Contents |
|-------|----------|
| `css` | Full CSS string of all 373 tokens |
| `formulas` | The `DerivationFormulas` used to produce the output |

The `formulas` field enables callers to extract derived values (such as `surfaceCanvasIntensity`) without re-running derivation. This is used for runtime canvas color computation. [D89]

---

## ThemeRecipe

The author-facing interface. Three required groups plus two optional overrides. Theme JSON files (`tugdeck/themes/*.json`) conform to this structure.

### Surface Specs

Each field is a `ThemeColorSpec` with `hue`, `tone`, and `intensity`.

| Field | Purpose |
|-------|---------|
| `surface.canvas` | App and canvas backgrounds |
| `surface.grid` | Canvas grid line texture |
| `surface.frame` | Card title bar and tab frame |
| `surface.card` | Card body surfaces |

### Text Spec

Tone is derived by the engine for legibility; designers specify hue and chroma only.

| Field | Purpose |
|-------|---------|
| `text.hue` | Prose and body text hue |
| `text.intensity` | Text chroma saturation |

### Role Spec

Shared tone and intensity apply to all seven role hues.

| Field | Purpose |
|-------|---------|
| `role.tone` | Shared tone for filled controls and role colors |
| `role.intensity` | Shared intensity for role saturation |
| `role.accent` | Brand accent (orange) |
| `role.action` | Interactive signals, links, selection (blue) |
| `role.success` | Positive outcomes (green) |
| `role.caution` | Attention needed (yellow) |
| `role.danger` | Errors, destructive actions (red) |
| `role.agent` | AI activity (violet) |
| `role.data` | Measurements, metrics (teal) |

### Optional Overrides

| Field | Purpose | Default |
|-------|---------|---------|
| `display?.hue` | Title/header text hue | `text.hue` |
| `display?.intensity` | Display text saturation | — |
| `border?.hue` | Border hue | `surface.canvas.hue` |
| `border?.intensity` | Border saturation | — |

### Recipe Field

The `recipe` field selects the derivation formula set (`"dark"` or `"light"`). It is set once at theme creation time and is immutable. [D90]

---

## RECIPE_REGISTRY

`RECIPE_REGISTRY` maps recipe names to their formula functions. It is exported from `theme-engine.ts`.

```typescript
export const RECIPE_REGISTRY: Record<string, { fn: (recipe: ThemeRecipe) => DerivationFormulas }> = {
  dark: { fn: darkRecipe },
  light: { fn: lightRecipe },
};
```

`compileRecipe()` dispatches through this registry. To add a new recipe variant, register a new entry. The registry is the only derivation path — there is no `formulas` escape hatch. [D04, D86]

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
| **hue-slot-dispatch** | Maps surface/element groups to hue slots | `surfaceAppHueSlot`, `surfaceCanvasHueSlot`, `mutedTextHueSlot`, `subtleTextHueSlot`, `fieldSurfaceHoverHueSlot`, `disabledSurfaceHueSlot`, and others |
| **sentinel-hue-dispatch** | Hue slots for hover/active highlight surfaces | `outlinedSurfaceHoverHueSlot`, `ghostSurfaceHoverHueSlot`, `highlightHoverHueSlot`, `tabSurfaceHoverHueSlot`, and others |
| **hue-name-dispatch** | Direct hue name expressions (bypass slot resolution) | `surfaceScreenHueExpression`, `mutedTextHueExpression`, `subtleTextHueExpression`, `selectionInactiveHueExpression` |

**System-level:**

| Group | Controls | Key Fields |
|-------|----------|------------|
| **sentinel-alpha** | Alpha values for translucent highlights | `tabSurfaceHoverAlpha`, `ghostSurfaceHoverAlpha`, `highlightHoverAlpha` |
| **computed-tone-override** | Override values for `computeTones()` derived tones | `dividerDefaultToneOverride`, `outlinedSurfaceRestToneOverride`, `disabledTextToneComputed`, `borderStrongToneComputed` |
| **selection-mode** | Inactive selection appearance | `selectionInactiveSemanticMode`, `selectionSurfaceInactiveTone`, `selectionSurfaceInactiveAlpha` |
| **role-intensity** | Role color saturation scaling | `roleIntensityValue` |

---

## ComputedTones

Pre-computed tone values derived from `DerivationFormulas`. Each tone is anchored at its formula value and may be clamped or overridden by computed-tone-override fields.

| Field | Derived From |
|-------|-------------|
| `surfaceApp`, `surfaceCanvas` | Formula tone values |
| `surfaceSunken` through `surfaceScreen` | Each surface tier from formula fields |
| `dividerDefault`, `dividerMuted` | Override field or derived from surfaceOverlay |
| `disabledSurfaceTone`, `disabledTextTone`, `disabledBorderTone` | Override fields or derived from divider tones |
| `outlinedSurfaceRestTone` through `outlinedSurfaceActiveTone` | Override fields or derived from surface tiers |
| `toggleTrackOffTone`, `toggleDisabledTone` | Override fields or derived from divider/overlay tones |
| `roleIntensity` | Direct from `roleIntensityValue` |

---

## Resolved Hue Slots

Layer 1 resolves every hue reference in the recipe to a `ResolvedHueSlot` with four properties:

| Property | Purpose |
|----------|---------|
| `angle` | Raw palette hue angle in degrees (no warmth bias) |
| `name` | Closest hue family name (e.g., `"violet"`) |
| `ref` | Formatted hue ref for `--tug-color()` (e.g., `"indigo-cobalt"`) |
| `primaryName` | Primary color for canonical-L / max-chroma lookup |

**Recipe slots** (7): `text`, `canvas`, `frame`, `card`, `borderTint`, `action`, `accent`

**Element slots** (4): `control`, `display`, `informational`, `decorative`

**Semantic slots** (5): `destructive`, `success`, `caution`, `agent`, `data`

**Derived slots** (10): `canvasBase`, `canvasScreen`, `textMuted`, `textSubtle`, `textDisabled`, `textInverse`, `textPlaceholder`, `selectionInactive`, `borderBase`, `borderStrong`

---

## Dark vs. Light

`DARK_FORMULAS` and `LIGHT_FORMULAS` are complete, independent formula sets. All mode differences are encoded as different constant values:

| Concern | Dark | Light |
|---------|------|-------|
| Canvas tone | 5 (near-black) | 95 (near-white) |
| Content text tone | 94 (off-white) | 8 (near-black) |
| Surface layering direction | Lighter = elevated | Darker = recessed |
| Filled control states | Lighten on hover/active | Lighten on hover/active |

`deriveTheme()` receives a formula set and never branches on mode. A recipe's `recipe` field (`"dark"` or `"light"`) selects which formula set `compileRecipe()` starts from.

---

## Canvas Color

Canvas color (sent to the Swift host via bridge) is derived at runtime from the `DerivationFormulas` output. [D89]

The caller runs `deriveTheme()` on the loaded theme JSON and extracts `surfaceCanvasIntensity`, `surfaceCanvasTone`, and the resolved canvas hue slot from `ThemeOutput.formulas`. These derived values are passed to `canvasColorHex()` in `canvas-color.ts`.

**Important:** The raw theme JSON `surface.canvas.intensity` differs from the derived `surfaceCanvasIntensity`. The recipe functions adjust canvas surface intensity independently from the input. Always use the derived values from `ThemeOutput.formulas`, not the raw JSON.

---

## Generator Card — Mac-Style Document Model

The theme generator card follows Mac document conventions. [D87]

| Operation | Behavior |
|-----------|----------|
| **New** | Prototype pattern: copies an existing theme JSON to `~/.tugtool/themes/` |
| **Open** | Loads a theme from either directory; shipped themes open read-only |
| **Auto-save** | 500ms debounce writes JSON + regenerated CSS to `~/.tugtool/themes/` |
| **Apply** | Injects the theme CSS app-wide via the theme provider |

Shipped themes (`tugdeck/themes/`) are read-only. The generator card tracks whether the current theme is authored or shipped and disables editing for shipped themes.

The recipe field is immutable after creation. Dark and light are chosen at New time by selecting the prototype. [D90]
