## Phase 5d5b: Global Scale and Timing {#phase-scale-timing}

**Purpose:** Ship `--tug-scale`, `--tug-timing`, and `--tug-motion` global CSS multipliers so the entire UI can be resized, sped up/slowed down, or have motion disabled with single-value changes. All existing dimension and duration tokens become `calc()`-based, component-level scale overrides are available, JS helpers provide runtime access, and a gallery demo tab proves it all works.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5d5b-scale-timing |
| Last updated | 2026-03-06 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The tugways design system has a three-tier token architecture (`--tways-*` palette, `--td-*` semantic, component CSS). Dimension tokens (`--td-space-*`, `--td-radius-*`) and duration tokens (`--td-duration-*`) are currently static values. There is no global multiplier for scaling the UI or adjusting animation speed. The existing `--td-duration-scalar` is a partial implementation that only affects a single spinner animation via a division hack. Phase 5d5c (Token Architecture) needs `--tug-scale` and `--tug-timing` in place before it can wire `--tug-base-*` dimension and duration tokens through them. This phase delivers those multipliers and proves they work across all existing components.

#### Strategy {#strategy}

- Add three global multiplier custom properties (`--tug-scale`, `--tug-timing`, `--tug-motion`) in a new `:root {}` block above the existing `body {}` block in `tokens.css`
- Replace the legacy `--td-duration-scalar` system entirely with `--tug-timing` / `--tug-motion` -- clean cutover, no backward compatibility aliases
- Convert all `--td-space-*` and `--td-radius-*` semantic tokens to `calc(<base> * var(--tug-scale))` expressions so every consumer scales automatically
- Convert all `--td-duration-*` tokens to `calc(<base> * var(--tug-timing))` expressions
- Use the final `--tug-base-*` names for new tokens (e.g., `--tug-base-space-md`, `--tug-base-motion-duration-fast`) so Phase 5d5c just wires them up
- Add component-level scale tokens (`--tug-comp-button-scale`, `--tug-comp-tab-scale`, `--tug-comp-dock-scale`) that compose multiplicatively with `--tug-scale`
- Build a tenth gallery tab with scale slider, timing slider, motion toggle, and component-level scale controls

#### Success Criteria (Measurable) {#success-criteria}

- Setting `--tug-scale: 1.25` makes all token-based spacing and radii 25% larger (verify by inspecting computed values in gallery demo). Hardcoded pixel values in component CSS (e.g., `gap: 4px` in tab items, Tailwind utility classes in shadcn) are not affected by `--tug-scale` in this phase; they will be migrated to tokens in Phase 5d5c
- Setting `--tug-timing: 5` makes all transition/animation durations 5x slower (verify by observing button hover, spinner, dropdown blink, tab bar transitions)
- Setting `--tug-motion: 0` via `prefers-reduced-motion` or manually causes `data-tug-motion="off"` on body and zeroes all animation/transition durations (verify: no visible animation anywhere)
- `--tug-comp-button-scale: 1.5` makes buttons 1.5x larger without affecting other components (verify in gallery demo)
- `getTugScale()`, `getTugTiming()`, and `isTugMotionEnabled()` return correct values from computed CSS (verify with gallery demo readout)
- The gallery card opens with ten tabs and the "Scale & Timing" tab renders interactive controls
- `bun run build` succeeds with zero errors and zero warnings

#### Scope {#scope}

1. Three new global CSS custom properties on `:root` in `tokens.css`
2. `prefers-reduced-motion` media query setting `--tug-motion: 0` and JS-managed `data-tug-motion` attribute
3. Global motion-off CSS rule zeroing all animation/transition durations when `data-tug-motion="off"`
4. Scaled `--td-space-*` and `--td-radius-*` tokens via `calc()` with `--tug-scale`
5. Scaled `--td-duration-*` tokens via `calc()` with `--tug-timing`
6. New `--tug-base-*` named tokens for dimensions and durations (forward-compatible with Phase 5d5c)
7. Component-level scale tokens (`--tug-comp-button-scale`, `--tug-comp-tab-scale`, `--tug-comp-dock-scale`)
8. `scale-timing.ts` JS helpers module
9. Gallery "Scale & Timing" tab (tenth tab)
10. Migration of `tug-button-spin` and all other duration consumers from `--td-duration-scalar` to new system

#### Non-goals (Explicitly out of scope) {#non-goals}

- Full `--tug-base-*` semantic taxonomy (that is Phase 5d5c)
- Consumer migration from `--td-*` to `--tug-base-*` (that is Phase 5d5d)
- Per-component timing multipliers (D73 specifies unified timing, no per-component timing)
- Font size scaling (font size tokens will be wired through `--tug-scale` in Phase 5d5c; this phase only scales spacing and radii)
- Stroke width tokens with `max(1px, ...)` floor (deferred to Phase 5d5c when the full `--tug-base-*` taxonomy is defined)

#### Dependencies / Prerequisites {#dependencies}

- Phase 5a2 (DeckManager Store) -- complete; provides the card/gallery infrastructure
- Phase 5d5a (Palette Engine / CITA Runtime) -- complete but independent; no dependency
- Existing `tokens.css` with `--td-space-*`, `--td-radius-*`, `--td-duration-*` tokens
- Existing gallery card with nine tabs and `registerGalleryCards()` pattern

#### Constraints {#constraints}

- `tokens.css` is shared across all three themes (Brio, Bluenote, Harmony); changes to `:root` and `body` blocks affect all themes
- Border widths (e.g., the 1px borders on `.tug-button-bordered`) are explicitly excluded from scaling per D72
- Shadow offsets/blur, opacity, color, z-index are excluded from scaling per D72
- Easing curves are not affected by timing per D73

#### Assumptions {#assumptions}

- `prefers-reduced-motion` media query sets `--tug-motion: 0` automatically, and JS sets `data-tug-motion='off'` on body in response
- `getTugScale()`, `getTugTiming()`, and `isTugMotionEnabled()` read computed CSS custom property values from `:root` or `body` via `getComputedStyle`
- Component-level scale tokens (`--tug-comp-button-scale`, `--tug-comp-tab-scale`, `--tug-comp-dock-scale`) default to `1` and compose multiplicatively with `--tug-scale`
- Border widths are explicitly excluded from scaling per D72
- Gallery demo scale slider range is 0.85--2.0 and timing slider range is 0.1--10.0 as specified in the roadmap

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All clarifying questions have been resolved via user answers and design decisions D72/D73.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| calc()-based tokens break in older WebKit | med | low | All target environments (macOS WebView) support CSS calc() with custom properties | Discovery of a WebKit version that fails |
| Scaling spacing/radius causes layout overflow at high scale values | med | med | Gallery demo tests at scale 2.0; visual inspection catches overflow | Components overflow at scale > 1.5 |
| Removing --td-duration-scalar breaks unknown consumers | high | low | Grep codebase exhaustively for all references before removal | Build fails or animations break |

**Risk R01: calc() token cascading performance** {#r01-calc-performance}

- **Risk:** Replacing ~12 static token values with calc() expressions could theoretically impact CSS recalculation performance when --tug-scale changes
- **Mitigation:** The number of calc() tokens is small (~12); CSS engines optimize calc() with custom properties efficiently; scale changes are infrequent user actions, not per-frame operations
- **Residual risk:** Negligible at this token count; would only matter if hundreds of tokens used calc()

---

### Design Decisions {#design-decisions}

#### [D01] Global multipliers live on :root, not body (DECIDED) {#d01-root-multipliers}

**Decision:** The three global multipliers (`--tug-scale`, `--tug-timing`, `--tug-motion`) are defined in a new `:root {}` block above the existing `body {}` block in `tokens.css`.

**Rationale:**
- User explicitly requested `:root` for these three multipliers only
- `:root` has higher specificity than `body` for custom properties, ensuring multipliers are always available
- Separates scaling/timing infrastructure from theme-specific palette values in `body`

**Implications:**
- Theme override stylesheets (bluenote.css, harmony.css) do not need to redeclare these multipliers
- All `calc()` expressions in `body {}` can reference `var(--tug-scale)` and `var(--tug-timing)` because `:root` is an ancestor

#### [D02] Clean cutover from --td-duration-scalar (DECIDED) {#d02-clean-cutover}

**Decision:** Remove `--td-duration-scalar` entirely and replace all its consumers with the new `--tug-timing` / `--tug-motion` system. No legacy aliases or backward compatibility.

**Rationale:**
- User explicitly chose clean cutover over gradual migration
- `--td-duration-scalar` has exactly one consumer (tug-button-spin animation-duration hack)
- The scalar's division-based pattern (`duration / scalar`) is inverted from the new multiplication-based pattern (`base * timing`)

**Implications:**
- `tug-button.css` spinner animation must be updated to use the new `calc(<base> * var(--tug-timing))` duration token
- The `prefers-reduced-motion` media query changes from setting `--td-duration-scalar: 0.001` to setting `--tug-motion: 0`
- The `tug-dropdown.css` hardcoded `250ms` blink animation must also be converted to use a timing token

#### [D03] Use final --tug-base-* names now (DECIDED) {#d03-final-names}

**Decision:** New dimension and duration tokens use the final `--tug-base-*` naming convention (e.g., `--tug-base-space-md`, `--tug-base-motion-duration-fast`) so Phase 5d5c can wire them directly.

**Rationale:**
- User chose to use final names immediately rather than creating temporary names
- Avoids a rename step in Phase 5d5c
- The `--tug-base-*` names are defined in the D71 token naming decision

**Implications:**
- `--td-space-*` tokens are redefined as `calc(var(--tug-base-space-*))` or the `--tug-base-space-*` tokens are defined alongside and `--td-space-*` tokens point to them
- Existing consumers of `--td-space-*` and `--td-radius-*` continue to work because the `--td-*` tokens still exist and resolve through the new calc() expressions

#### [D04] Semantic token calc() strategy (DECIDED) {#d04-calc-strategy}

**Decision:** The `--tways-space-*` Tier 1 tokens keep their raw pixel values. New `--tug-base-space-*` tokens are defined as `calc(<raw-value> * var(--tug-scale))`. The existing `--td-space-*` Tier 2 tokens are redefined to point to the corresponding `--tug-base-space-*` token. Same pattern for `--td-radius-*` and `--td-duration-*`.

**Rationale:**
- Preserves the three-tier architecture: Tier 1 (raw) -> Tier 2 (semantic, scaled) -> Tier 3 (component)
- All existing consumers of `--td-space-*` automatically get scaling without any code changes
- The `--tug-base-*` tokens are ready for Phase 5d5c to adopt

**Implications:**
- `--td-space-1` through `--td-space-6` change from `var(--tways-space-N)` to `var(--tug-base-space-N)`
- `--td-radius-xs` through `--td-radius-lg` change from `var(--tways-radius-N)` to `var(--tug-base-radius-N)`
- `--td-duration-fast/moderate/slow/glacial` change from static values to `var(--tug-base-motion-duration-*)`

#### [D05] Component-level scale composition (DECIDED) {#d05-comp-scale}

**Decision:** Component-level scale tokens (`--tug-comp-button-scale`, `--tug-comp-tab-scale`) default to `1` and are not wired into the global token calc() expressions. Instead, each component applies its family scale token via a CSS `scale()` transform on its root element. `--tug-comp-dock-scale` is forward-declared (defaults to `1`) for the future dock component but has no consumer in this phase.

**Rationale:**
- D72 specifies multiplicative composition: component scale multiplies on top of global scale
- TugButton uses shadcn Tailwind utility classes (`h-10 px-4 py-2`, `text-sm`) for padding and font-size, and inline `style={{ borderRadius }}` via a JS `ROUNDED_MAP` constant for border-radius. These are not CSS custom property based, so wrapping them in `calc(... * var(--tug-comp-button-scale))` is not possible without rewriting the component
- CSS `transform: scale(var(--tug-comp-button-scale))` on the root element scales the entire rendered output multiplicatively, achieving the same visual result without touching Tailwind classes or inline styles
- TugTabBar similarly uses hardcoded pixel values (`gap: 4px`, `padding: 0 8px`, `height: 28px`, `max-width: 160px`) that are better scaled via transform than individually wrapped in calc()

**Implications:**
- `tug-button.css` adds `transform: scale(var(--tug-comp-button-scale))` and `transform-origin: center center` to the base variant classes
- `tug-tab-bar.css` adds `transform: scale(var(--tug-comp-tab-scale))` and `transform-origin: left center` to `.tug-tab-bar`
- At default value `1`, transform is identity (no visual change); at other values, the entire component scales proportionally
- **Layout box caveat:** CSS `transform: scale()` does not change the element's layout box -- it only changes visual rendering. At non-1.0 scale values, adjacent elements may overlap or leave gaps because the layout box remains at the original size. This is acceptable for this phase because component-level scaling is a developer/debug tool, not an end-user feature. The gallery demo preview area must use generous `gap` and `padding` to accommodate visual overlap at high scale values
- `--tug-comp-dock-scale` is declared in tokens.css but has no CSS consumer until the dock component is built
- Gallery demo provides sliders for button and tab scale; the dock scale slider is present but noted as forward-declared

#### [D06] Motion-off via data attribute and global CSS rule (DECIDED) {#d06-motion-off}

**Decision:** When `--tug-motion` is `0`, JS sets `data-tug-motion="off"` on `<body>`. A global CSS rule `body[data-tug-motion="off"] * { animation-duration: 0s !important; transition-duration: 0s !important; }` zeroes all motion.

**Rationale:**
- CSS cannot conditionally zero durations based on a custom property value without a selector hook
- The `data-tug-motion` attribute provides that selector hook
- `!important` ensures no component-level duration overrides can defeat the motion-off rule
- This is categorically different from slow-motion debugging (`--tug-timing: 5`), which is handled by the calc() multiplication

**Implications:**
- A CSS-only `@media (prefers-reduced-motion: reduce)` rule provides immediate motion suppression from first paint, without waiting for JS (Spec S06)
- JS `initMotionObserver()` observes `prefers-reduced-motion` changes and manages the `data-tug-motion` attribute for programmatic control
- The `scale-timing.ts` module handles this observation and attribute management
- The global `body[data-tug-motion="off"]` CSS rule is placed in `tokens.css` near the `:root` block

---

### Specification {#specification}

#### Token Definitions {#token-definitions}

**Spec S01: Global Multiplier Tokens** {#s01-global-multipliers}

```css
:root {
  --tug-scale: 1;
  --tug-timing: 1;
  --tug-motion: 1;
}
```

All three default to `1`. `--tug-scale` and `--tug-timing` are continuous multipliers. `--tug-motion` is a binary toggle (`1` = motion on, `0` = motion off).

**Spec S02: Scaled Dimension Tokens** {#s02-scaled-dimensions}

Defined in the `body {}` block alongside existing token definitions:

| New Token | Expression | Existing Token Rewired |
|-----------|-----------|----------------------|
| `--tug-base-space-1` | `calc(2px * var(--tug-scale))` | `--td-space-1: var(--tug-base-space-1)` |
| `--tug-base-space-2` | `calc(4px * var(--tug-scale))` | `--td-space-2: var(--tug-base-space-2)` |
| `--tug-base-space-3` | `calc(6px * var(--tug-scale))` | `--td-space-3: var(--tug-base-space-3)` |
| `--tug-base-space-4` | `calc(8px * var(--tug-scale))` | `--td-space-4: var(--tug-base-space-4)` |
| `--tug-base-space-5` | `calc(12px * var(--tug-scale))` | `--td-space-5: var(--tug-base-space-5)` |
| `--tug-base-space-6` | `calc(16px * var(--tug-scale))` | `--td-space-6: var(--tug-base-space-6)` |
| `--tug-base-radius-xs` | `calc(2px * var(--tug-scale))` | `--td-radius-xs: var(--tug-base-radius-xs)` |
| `--tug-base-radius-sm` | `calc(4px * var(--tug-scale))` | `--td-radius-sm: var(--tug-base-radius-sm)` |
| `--tug-base-radius-md` | `calc(6px * var(--tug-scale))` | `--td-radius-md: var(--tug-base-radius-md)` |
| `--tug-base-radius-lg` | `calc(8px * var(--tug-scale))` | `--td-radius-lg: var(--tug-base-radius-lg)` |

**Spec S03: Timed Duration Tokens** {#s03-timed-durations}

Defined in the `body {}` block, replacing the current static `--td-duration-*` definitions:

| New Token | Expression | Existing Token Rewired |
|-----------|-----------|----------------------|
| `--tug-base-motion-duration-fast` | `calc(100ms * var(--tug-timing))` | `--td-duration-fast: var(--tug-base-motion-duration-fast)` |
| `--tug-base-motion-duration-moderate` | `calc(200ms * var(--tug-timing))` | `--td-duration-moderate: var(--tug-base-motion-duration-moderate)` |
| `--tug-base-motion-duration-slow` | `calc(350ms * var(--tug-timing))` | `--td-duration-slow: var(--tug-base-motion-duration-slow)` |
| `--tug-base-motion-duration-glacial` | `calc(500ms * var(--tug-timing))` | `--td-duration-glacial: var(--tug-base-motion-duration-glacial)` |

The existing `--td-easing-*` tokens are unchanged (easing describes shape, not duration).

**Spec S04: Component-Level Scale Tokens** {#s04-comp-scale-tokens}

Defined in the `body {}` block:

```css
--tug-comp-button-scale: 1;
--tug-comp-tab-scale: 1;
--tug-comp-dock-scale: 1;
```

Component CSS applies these via CSS `transform: scale()` on the root element. This approach is used because TugButton's padding comes from shadcn Tailwind utility classes (`h-10 px-4 py-2`), border-radius from an inline `style={{ borderRadius }}` via JS `ROUNDED_MAP`, and font-size from Tailwind `text-sm` -- none of which can be overridden via CSS custom property calc() without rewriting the component.

In `tug-button.css`:

```css
.tug-button-primary,
.tug-button-secondary,
.tug-button-ghost,
.tug-button-destructive {
  transform: scale(var(--tug-comp-button-scale));
  transform-origin: center center;
}
```

In `tug-tab-bar.css`:

```css
.tug-tab-bar {
  transform: scale(var(--tug-comp-tab-scale));
  transform-origin: left center;
}
```

At the default value of `1`, the transform is identity (no visual change). `--tug-comp-dock-scale` is forward-declared for the future dock component and has no CSS consumer in this phase.

**Layout box caveat:** CSS `transform: scale()` does not change the element's layout box. At non-1.0 scale values, the element visually grows or shrinks but its allocated space in flex/grid layout remains unchanged. This means adjacent elements may overlap (scale > 1) or leave gaps (scale < 1). This is acceptable because component-level scaling is a developer/debug tool for fine-tuning proportions, not an end-user layout feature. Gallery demo preview areas use generous gap/padding to accommodate visual overlap at high scale values.

**Spec S05: Motion-Off CSS Rule** {#s05-motion-off-rule}

```css
body[data-tug-motion="off"],
body[data-tug-motion="off"] * {
  animation-duration: 0s !important;
  transition-duration: 0s !important;
}
```

This rule is placed in `tokens.css` after the `:root` block and before the `body` block.

**Spec S06: prefers-reduced-motion Media Query** {#s06-reduced-motion}

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --tug-motion: 0;
  }
  *,
  *::before,
  *::after {
    animation-duration: 0s !important;
    transition-duration: 0s !important;
  }
}
```

Replaces the legacy `@media (prefers-reduced-motion: reduce) { body { --td-duration-scalar: 0.001; } }` rule.

The CSS-only `animation-duration`/`transition-duration` override provides immediate motion suppression for reduced-motion users without depending on JS `initMotionObserver()`. This ensures zero-motion from first paint. The JS observer (Spec S07) later manages the `data-tug-motion` attribute for programmatic motion control (e.g., gallery demo toggle).

#### JS Helpers {#js-helpers}

**Spec S07: scale-timing.ts API** {#s07-scale-timing-api}

```typescript
/** Read the current --tug-scale value from :root computed style. */
export function getTugScale(): number;

/** Read the current --tug-timing value from :root computed style. */
export function getTugTiming(): number;

/** Check whether motion is enabled (--tug-motion is not 0). */
export function isTugMotionEnabled(): boolean;

/**
 * Initialize motion attribute management.
 * - Reads prefers-reduced-motion media query
 * - Sets data-tug-motion="off" on body when motion is disabled
 * - Listens for media query changes and updates attribute
 * - Returns a cleanup function to remove the listener
 */
export function initMotionObserver(): () => void;
```

`initMotionObserver()` must be called during app boot (in `main.tsx`) to wire up the `prefers-reduced-motion` listener and initial attribute setting.

#### Gallery Demo {#gallery-demo}

**Spec S08: Gallery Scale & Timing Tab** {#s08-gallery-tab}

The tenth gallery tab (`componentId: 'gallery-scale-timing'`, title: `'Scale & Timing'`) provides:

1. **Scale slider** -- range 0.85 to 2.0, step 0.05, default 1.0. Sets `--tug-scale` on `:root` via `document.documentElement.style.setProperty()`. Numeric readout shows current value.
2. **Timing slider** -- range 0.1 to 10.0, step 0.1, default 1.0. Sets `--tug-timing` on `:root`. Numeric readout shows current value.
3. **Motion toggle** -- checkbox. When unchecked, sets `--tug-motion` to `0` on `:root` and triggers `data-tug-motion="off"` on body. When checked, restores to `1`.
4. **Component scale controls** -- individual sliders for `--tug-comp-button-scale` and `--tug-comp-tab-scale` (range 0.5 to 2.0, step 0.1, default 1.0). A `--tug-comp-dock-scale` slider is also present but labeled as "forward-declared (no dock component yet)".
5. **Live preview area** -- renders a set of TugButtons and other components that respond to the sliders in real time.
6. **JS helper readout** -- displays `getTugScale()`, `getTugTiming()`, `isTugMotionEnabled()` return values, updated on slider change.
7. **Reset button** -- restores all multipliers to defaults.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/scale-timing.ts` | JS helpers: getTugScale, getTugTiming, isTugMotionEnabled, initMotionObserver |
| `tugdeck/src/components/tugways/cards/gallery-scale-timing-content.tsx` | Gallery Scale & Timing tab content component |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `getTugScale` | fn | `scale-timing.ts` | Reads `--tug-scale` from `:root` computed style |
| `getTugTiming` | fn | `scale-timing.ts` | Reads `--tug-timing` from `:root` computed style |
| `isTugMotionEnabled` | fn | `scale-timing.ts` | Reads `--tug-motion` from `:root` computed style |
| `initMotionObserver` | fn | `scale-timing.ts` | Sets up prefers-reduced-motion listener, manages data-tug-motion attribute |
| `GalleryScaleTimingContent` | component | `gallery-scale-timing-content.tsx` | Gallery tab content with sliders and live preview |
| `GALLERY_DEFAULT_TABS` | const (modify) | `gallery-card.tsx` | Add tenth entry for `gallery-scale-timing` |
| `registerGalleryCards` | fn (modify) | `gallery-card.tsx` | Add `gallery-scale-timing` registration |

---

### Documentation Plan {#documentation-plan}

- [ ] Update `tugways-implementation-strategy.md` to mark Phase 5d5b as complete after implementation
- [ ] Add inline JSDoc to `scale-timing.ts` explaining each helper's purpose and usage

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test scale-timing.ts helper functions in isolation | getTugScale, getTugTiming, isTugMotionEnabled return correct values |
| **Integration** | Test that token calc() expressions resolve correctly at various scale/timing values | Set --tug-scale, read computed --td-space-*, verify math |
| **Visual verification** | Manual gallery demo inspection at scale 0.85, 1.0, 1.25, 1.5, 2.0 | Confirm proportions, no overflow, no visual regression |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add global multiplier tokens and motion-off infrastructure to tokens.css {#step-1}

**Commit:** `feat(tokens): add --tug-scale, --tug-timing, --tug-motion global multipliers`

**References:** [D01] Root multipliers, [D02] Clean cutover, [D06] Motion-off data attribute, Spec S01, Spec S05, Spec S06, (#s01-global-multipliers, #s05-motion-off-rule, #s06-reduced-motion)

**Artifacts:**
- Modified `tugdeck/styles/tokens.css` -- new `:root {}` block, motion-off rule, updated `prefers-reduced-motion` media query
- Modified `tugdeck/src/components/tugways/tug-button.css` -- remove `--td-duration-scalar` spinner hack

**Tasks:**
- [ ] Add new `:root {}` block above the `body {}` block in `tokens.css` with `--tug-scale: 1`, `--tug-timing: 1`, `--tug-motion: 1`
- [ ] Add motion-off CSS rule: `body[data-tug-motion="off"], body[data-tug-motion="off"] * { animation-duration: 0s !important; transition-duration: 0s !important; }`
- [ ] Add CSS-only reduced-motion fallback rule: `@media (prefers-reduced-motion: reduce) { :root { --tug-motion: 0; } *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; } }`. This provides immediate motion suppression for reduced-motion users without waiting for JS `initMotionObserver()` (Step 5). The JS observer later manages the `data-tug-motion` attribute for programmatic control
- [ ] Remove the legacy `@media (prefers-reduced-motion: reduce) { body { --td-duration-scalar: 0.001; } }` rule
- [ ] Remove `--td-duration-scalar: 1` declaration from the `body {}` block
- [ ] In `tug-button.css`, remove both the `animation-duration: calc(var(--td-duration-moderate) / var(--td-duration-scalar, 1))` hack line and the comment above it (`/* Respect reduced-motion preference via the scalar token */`) from `.tug-button-spinner`. The base `animation: tug-button-spin var(--td-duration-moderate) ...` line is sufficient -- once Step 3 rewires `--td-duration-moderate` through `--tug-timing`, timing scaling is automatic. Until then, the spinner uses the static 200ms value, and the CSS-only reduced-motion rule above handles accessibility

**Tests:**
- [ ] Verify `tokens.css` parses without errors (load in browser, check console)
- [ ] Verify spinner animation still plays at normal speed (no regression from removing scalar hack)
- [ ] Verify `prefers-reduced-motion` system setting stops all animations via the CSS-only rule

**Checkpoint:**
- [ ] `bun run build` succeeds with zero errors
- [ ] Grep for `duration-scalar` across `tugdeck/` returns zero matches

---

#### Step 2: Define --tug-base-space-* and --tug-base-radius-* scaled tokens, rewire --td-* tokens {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tokens): add calc()-based --tug-base-space-* and --tug-base-radius-* scaled tokens`

**References:** [D03] Final names, [D04] Calc strategy, Spec S02, (#s02-scaled-dimensions)

**Artifacts:**
- Modified `tugdeck/styles/tokens.css` -- new `--tug-base-space-*` and `--tug-base-radius-*` tokens in `body {}`, rewired `--td-space-*` and `--td-radius-*`

**Tasks:**
- [ ] In the `body {}` block, add `--tug-base-space-1` through `--tug-base-space-6` as `calc(<value>px * var(--tug-scale))` using the raw pixel values from the existing `--tways-space-*` tokens (2, 4, 6, 8, 12, 16)
- [ ] Add `--tug-base-radius-xs` through `--tug-base-radius-lg` as `calc(<value>px * var(--tug-scale))` using the raw pixel values from `--tways-radius-*` (2, 4, 6, 8)
- [ ] Rewire `--td-space-1` through `--td-space-6` from `var(--tways-space-N)` to `var(--tug-base-space-N)`
- [ ] Rewire `--td-radius-xs` through `--td-radius-lg` from `var(--tways-radius-N)` to `var(--tug-base-radius-N)`

**Tests:**
- [ ] At default `--tug-scale: 1`, verify `--td-space-4` computes to `8px` (no visual change)

**Checkpoint:**
- [ ] `bun run build` succeeds with zero errors
- [ ] App loads in browser with no visual regressions at default scale

---

#### Step 3: Define --tug-base-motion-duration-* timed tokens, rewire --td-duration-* tokens, migrate consumers {#step-3}

**Depends on:** #step-1

**Commit:** `feat(tokens): add calc()-based --tug-base-motion-duration-* tokens, remove --td-duration-scalar`

**References:** [D02] Clean cutover, [D03] Final names, [D04] Calc strategy, Spec S03, (#s03-timed-durations)

**Artifacts:**
- Modified `tugdeck/styles/tokens.css` -- new `--tug-base-motion-duration-*` tokens, rewired `--td-duration-*`
- Modified `tugdeck/src/components/tugways/tug-dropdown.css` -- blink animation uses duration token

**Tasks:**
- [ ] In the `body {}` block, add `--tug-base-motion-duration-fast` as `calc(100ms * var(--tug-timing))`, `--tug-base-motion-duration-moderate` as `calc(200ms * var(--tug-timing))`, `--tug-base-motion-duration-slow` as `calc(350ms * var(--tug-timing))`, `--tug-base-motion-duration-glacial` as `calc(500ms * var(--tug-timing))`
- [ ] Replace the static `--td-duration-fast: 100ms` etc. with `--td-duration-fast: var(--tug-base-motion-duration-fast)` etc.
- [ ] Update `tug-dropdown.css`: replace hardcoded `250ms` in the `tug-dropdown-blink` animation with `var(--td-duration-moderate)` (or nearest appropriate token). Note: `tug-button.css` spinner already uses `var(--td-duration-moderate)` and the `--td-duration-scalar` hack was removed in Step 1, so the spinner automatically benefits from the timing multiplier with no further changes
- [ ] Verify that all other transition/animation consumers in component CSS (`tugcard.css` uses `--td-duration-fast`, `tug-tab-bar.css` uses `--td-duration-fast`) automatically benefit from the rewired duration tokens

**Tests:**
- [ ] At `--tug-timing: 1`, spinner and dropdown blink animations play at normal speed
- [ ] At `--tug-timing: 5`, animations are visibly slower (button spinner, dropdown blink, tab bar transitions, tugcard transitions)

**Checkpoint:**
- [ ] `bun run build` succeeds with zero errors
- [ ] Grep for hardcoded duration values (e.g., `250ms` not in a comment) in component CSS files returns no unexpected matches

---

#### Step 4: Add component-level scale tokens {#step-4}

**Depends on:** #step-2

**Commit:** `feat(tokens): add --tug-comp-button-scale, --tug-comp-tab-scale, --tug-comp-dock-scale`

**References:** [D05] Component-level scale composition, Spec S04, (#s04-comp-scale-tokens)

**Artifacts:**
- Modified `tugdeck/styles/tokens.css` -- three new component scale tokens in `body {}`
- Modified `tugdeck/src/components/tugways/tug-button.css` -- CSS transform scale on variant classes
- Modified `tugdeck/src/components/tugways/tug-tab-bar.css` -- CSS transform scale on `.tug-tab-bar`

**Tasks:**
- [ ] Add `--tug-comp-button-scale: 1`, `--tug-comp-tab-scale: 1`, `--tug-comp-dock-scale: 1` to the `body {}` block in `tokens.css`. Note: `--tug-comp-dock-scale` is forward-declared for the future dock component and has no CSS consumer in this phase
- [ ] In `tug-button.css`, add `transform: scale(var(--tug-comp-button-scale))` and `transform-origin: center center` to the combined variant selector (`.tug-button-primary, .tug-button-secondary, .tug-button-ghost, .tug-button-destructive`). This scales the entire button including its Tailwind-set padding (`h-10 px-4 py-2`), inline border-radius (from `ROUNDED_MAP`), and `text-sm` font-size without modifying those values directly
- [ ] In `tug-tab-bar.css`, add `transform: scale(var(--tug-comp-tab-scale))` and `transform-origin: left center` to `.tug-tab-bar`. This scales the entire tab bar including its hardcoded dimensions: container `height: 28px`, tab item `gap: 4px`, `padding: 0 8px`, `max-width: 160px`, icon `width/height: 12px`, close button `width/height: 14px`, add button `width: 28px`, and overflow button `padding: 0 6px`

**Tests:**
- [ ] At `--tug-comp-button-scale: 1`, buttons render identically to before (no visual change; `scale(1)` is identity)
- [ ] At `--tug-comp-button-scale: 1.5`, buttons are visibly larger while tabs remain normal
- [ ] At `--tug-comp-tab-scale: 1`, tab bar renders identically to before
- [ ] At `--tug-comp-tab-scale: 0.85`, tab bar is visibly smaller

**Checkpoint:**
- [ ] `bun run build` succeeds with zero errors
- [ ] App loads with no visual regressions at default component scale values (all tokens are `1`)

---

#### Step 5: Create scale-timing.ts JS helpers {#step-5}

**Depends on:** #step-1

**Commit:** `feat(tugways): add scale-timing.ts JS helpers`

**References:** Spec S07, [D06] Motion-off data attribute, (#s07-scale-timing-api, #js-helpers)

**Artifacts:**
- New `tugdeck/src/components/tugways/scale-timing.ts`
- Modified `tugdeck/src/main.tsx` -- call `initMotionObserver()` during boot

**Tasks:**
- [ ] Create `scale-timing.ts` with `getTugScale()`, `getTugTiming()`, `isTugMotionEnabled()`, and `initMotionObserver()`
- [ ] `getTugScale()`: read `getComputedStyle(document.documentElement).getPropertyValue('--tug-scale')`, parse as float, return 1 if NaN
- [ ] `getTugTiming()`: same pattern for `--tug-timing`
- [ ] `isTugMotionEnabled()`: read `--tug-motion`, return `parseFloat(value) !== 0`
- [ ] `initMotionObserver()`: check `window.matchMedia('(prefers-reduced-motion: reduce)')`, set `data-tug-motion` attribute on body accordingly, add `change` listener, return cleanup function
- [ ] In `main.tsx`, import and call `initMotionObserver()` early in the boot sequence (before DeckManager construction)

**Tests:**
- [ ] Unit test: `getTugScale()` returns `1` when `--tug-scale` is unset or set to `1`
- [ ] Unit test: `isTugMotionEnabled()` returns `true` when `--tug-motion` is `1`, `false` when `0`

**Checkpoint:**
- [ ] `bun run build` succeeds with zero errors
- [ ] `bun run test` passes (if scale-timing tests are added)

---

#### Step 6: Build gallery Scale & Timing tab content component {#step-6}

**Depends on:** #step-2, #step-3, #step-4, #step-5

**Commit:** `feat(gallery): add Scale & Timing demo tab`

**References:** Spec S08, [D05] Component-level scale, (#s08-gallery-tab, #gallery-demo)

**Artifacts:**
- New `tugdeck/src/components/tugways/cards/gallery-scale-timing-content.tsx`
- Modified `tugdeck/src/components/tugways/cards/gallery-card.css` -- styles for scale-timing demo

**Tasks:**
- [ ] Create `GalleryScaleTimingContent` component with scale slider (0.85--2.0, step 0.05), timing slider (0.1--10.0, step 0.1), motion toggle checkbox
- [ ] Add component-level scale sliders for `--tug-comp-button-scale`, `--tug-comp-tab-scale`, `--tug-comp-dock-scale` (0.5--2.0, step 0.1)
- [ ] Add live preview area rendering sample TugButtons in all variants and sizes. Use generous `gap` (at least `24px`) and `padding` in the preview flex container to accommodate visual overlap from CSS `transform: scale()` at high component scale values (see D05 layout box caveat)
- [ ] Add JS helper readout section displaying `getTugScale()`, `getTugTiming()`, `isTugMotionEnabled()` values, updated when sliders change
- [ ] Add reset button that restores all multipliers to `1` and re-checks the motion toggle
- [ ] Slider changes set CSS custom properties on `document.documentElement` (for scale/timing/motion) or `document.body` (for component scale) via `style.setProperty()`
- [ ] Add `useEffect` cleanup that restores all modified CSS custom properties to their defaults on unmount. The cleanup must call `document.documentElement.style.removeProperty()` for `--tug-scale`, `--tug-timing`, `--tug-motion` and `document.body.style.removeProperty()` for `--tug-comp-button-scale`, `--tug-comp-tab-scale`, `--tug-comp-dock-scale`. Also remove `data-tug-motion` attribute from body if it was set by the motion toggle. This prevents the UI from remaining in a non-default state after switching away from the tab or closing the gallery
- [ ] Add CSS styles for the demo layout (slider groups, readout display, preview area) to `gallery-card.css`

**Tests:**
- [ ] Component renders without errors
- [ ] Moving scale slider updates `--tug-scale` on `:root` and visually affects preview buttons

**Checkpoint:**
- [ ] `bun run build` succeeds with zero errors

---

#### Step 7: Register gallery-scale-timing as tenth tab {#step-7}

**Depends on:** #step-6

**Commit:** `feat(gallery): register gallery-scale-timing as tenth tab`

**References:** Spec S08, (#s08-gallery-tab)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/cards/gallery-card.tsx` -- tenth entry in `GALLERY_DEFAULT_TABS`, new `registerCard` call

**Tasks:**
- [ ] Add `{ id: "template", componentId: "gallery-scale-timing", title: "Scale & Timing", closable: true }` as the tenth entry in `GALLERY_DEFAULT_TABS`
- [ ] Add `registerCard()` call for `gallery-scale-timing` in `registerGalleryCards()`, following the pattern of existing registrations (family: "developer", acceptsFamilies: ["developer"], icon: "SlidersHorizontal" or "Scaling")
- [ ] Import `GalleryScaleTimingContent` from `./gallery-scale-timing-content`
- [ ] Update the module docstring to reference ten tabs instead of nine

**Tests:**
- [ ] Gallery card opens with ten tabs
- [ ] Clicking "Scale & Timing" tab shows the demo content

**Checkpoint:**
- [ ] `bun run build` succeeds with zero errors
- [ ] App loads, gallery opens with ten tabs, Scale & Timing tab is functional

---

#### Step 8: Integration Checkpoint {#step-8}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5, #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** [D01] Root multipliers, [D02] Clean cutover, [D03] Final names, [D04] Calc strategy, [D05] Component-level scale, [D06] Motion-off data attribute, Spec S01, Spec S02, Spec S03, Spec S04, Spec S07, Spec S08, (#success-criteria)

**Tasks:**
- [ ] Verify all steps 1--7 work together end-to-end
- [ ] Verify scale 0.85, 1.0, 1.25, 1.5, 2.0 produce correct proportions across all gallery components
- [ ] Verify timing 0.5, 1.0, 5.0 affect all animations (button spinner, dropdown blink, tab bar transitions, tugcard transitions)
- [ ] Verify motion off disables all animation (no visible motion anywhere)
- [ ] Verify component scales compose correctly with global scale (e.g., `--tug-scale: 1.25` + `--tug-comp-button-scale: 1.5` = buttons 1.875x)
- [ ] Verify JS helper readout matches CSS values
- [ ] Verify `data-tug-motion="off"` attribute appears on body when motion is disabled
- [ ] Verify no `--td-duration-scalar` references remain in codebase

**Tests:**
- [ ] `bun run test` passes with all existing and new tests
- [ ] `grep -r "duration-scalar" tugdeck/` returns zero matches

**Checkpoint:**
- [ ] `bun run build` succeeds with zero errors
- [ ] `bun run test` passes
- [ ] Gallery demo exercises all controls without errors

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Global CSS multipliers (`--tug-scale`, `--tug-timing`, `--tug-motion`) that control all UI dimensions and animation durations, with component-level scale overrides, JS runtime helpers, and an interactive gallery demo tab.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `--tug-scale`, `--tug-timing`, `--tug-motion` exist on `:root` in `tokens.css` (inspect CSS)
- [ ] All `--td-space-*` and `--td-radius-*` tokens resolve through `calc(... * var(--tug-scale))` (inspect computed styles)
- [ ] All `--td-duration-*` tokens resolve through `calc(... * var(--tug-timing))` (inspect computed styles)
- [ ] `--td-duration-scalar` is fully removed from codebase (grep returns zero matches)
- [ ] `prefers-reduced-motion: reduce` sets `--tug-motion: 0` and `data-tug-motion="off"` on body (test with system setting)
- [ ] Gallery opens with ten tabs; Scale & Timing tab is interactive and functional
- [ ] `bun run build` succeeds with zero errors and zero warnings
- [ ] `bun run test` passes

**Acceptance tests:**
- [ ] Scale slider at 2.0 makes all spacing/radii 2x larger (visual verification)
- [ ] Timing slider at 5.0 makes animations 5x slower (visual verification)
- [ ] Motion toggle off removes all animation (visual verification)
- [ ] Component scale slider for buttons at 1.5 makes buttons 1.5x larger without affecting tabs (visual verification)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 5d5c: Wire `--tug-base-*` tokens into full semantic taxonomy
- [ ] Phase 5d5d: Migrate all consumers from `--td-*` to `--tug-base-*`
- [ ] Font size scaling through `--tug-scale` (deferred to Phase 5d5c)
- [ ] Stroke width tokens with `max(1px, ...)` floor (deferred to Phase 5d5c)
- [ ] Icon size scaling through `--tug-scale` (deferred to Phase 5d5c)

| Checkpoint | Verification |
|------------|--------------|
| Global multipliers defined | Inspect `:root` in browser DevTools |
| Scaled tokens resolve correctly | Compare computed values at scale 1.0 vs 1.25 |
| Duration scalar removed | `grep -r "duration-scalar" tugdeck/` returns nothing |
| Gallery ten tabs | Open gallery, count tabs |
| Motion off works | Toggle system reduced-motion, verify no animation |
