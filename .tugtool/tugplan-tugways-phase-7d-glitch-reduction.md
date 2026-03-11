## Tugways Phase 7d — Glitch Reduction {#phase-7d-glitch-reduction}

**Purpose:** Eliminate the CSS-edit flash caused by `@tailwindcss/vite`'s forced full-reload behavior by stripping Tailwind from the codebase and adding a reload continuity overlay that makes all full-reload scenarios visually seamless.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-7d-glitch-reduction |
| Last updated | 2026-03-10 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

After completing Phase 7c (Startup Continuity), a CSS-edit flash bug was discovered: editing any CSS file during development causes a visible page flash. The root cause is the `@tailwindcss/vite` plugin, which sends `{ type: "full-reload" }` directly to the browser on every CSS change — bypassing the module graph and ignoring any `import.meta.hot.accept()` boundaries. There is no configuration option to disable this behavior.

Tailwind's footprint in tugdeck is shallow: only 160 out of 529 `className` occurrences use Tailwind utilities (30%), concentrated almost entirely in 13 shadcn/ui components under `components/ui/`. The real styling system consists of 2,335 lines of custom CSS across 9 files. Tailwind is scaffolding from the initial shadcn bootstrap; the design system has outgrown it.

#### Strategy {#strategy}

- Strip Tailwind entirely: remove `@tailwindcss/vite`, `tailwindcss`, `tailwind-merge`, the `@theme` bridge in `globals.css`, and all Tailwind utility classes from shadcn components.
- Replace Tailwind utility classes with semantic CSS classes in a new `shadcn-base.css` stylesheet, using existing `--tug-base-*` and `--tug-comp-*` design tokens.
- Retain `class-variance-authority` (CVA) for variant management in the button component; it works without Tailwind.
- Simplify the `cn()` utility from `clsx + tailwind-merge` to plain `clsx` since tailwind-merge is no longer needed.
- Add reload-overlay logic using `import.meta.hot.on('vite:beforeFullReload', ...)` in a module file, painting a dark overlay before `location.reload()` fires — creating visual continuity for Vite-initiated reloads (CSS edits, JS edits). Browser-initiated reloads (Cmd+R) are already handled by Phase 7c's inline body styles and startup overlay.
- Add a minimal CSS reset in `shadcn-base.css` covering button/input/select/textarea normalization to replace Tailwind's preflight.
- Recreate shadcn animation keyframes (fade-in, zoom-in, slide-in) in CSS targeting Radix `data-[state=open]`/`data-[state=closed]` attributes directly.

#### Success Criteria (Measurable) {#success-criteria}

- No Tailwind packages remain in `package.json` (`tailwindcss`, `@tailwindcss/vite`, `tailwind-merge` all removed)
- `@import "tailwindcss"` and the `@theme` block are absent from `globals.css`
- No Tailwind utility class strings remain in any `components/ui/*.tsx` file (verified by grep)
- Editing any `.css` file in dev mode produces no visible flash (dark-to-dark continuity)
- `bunx tsc --noEmit` passes with zero errors
- The component gallery renders all shadcn-based components with visual parity to current appearance
- `bun run build` succeeds (production build)

#### Scope {#scope}

1. Strip Tailwind: remove plugin, dependencies, `@theme` bridge, all utility classes from 13 shadcn/ui components
2. Create `shadcn-base.css` with semantic class replacements, CSS reset, and animation keyframes
3. Add reload continuity overlay using `import.meta.hot.on()` in a module file
4. Simplify `cn()` utility to plain `clsx`, remove `tailwind-merge` dependency
5. Update `roadmap/tugways-implementation-strategy.md` with Phase 7d notes and future-phase guidance

#### Non-goals (Explicitly out of scope) {#non-goals}

- Removing CVA from the button component (separate future refactor)
- Changing any tugways component APIs (this is an internal refactoring only)
- Refactoring or restyling any component beyond matching current visual appearance
- Addressing React Fast Refresh failures for JS edits (the overlay handles these visually, but the root cause is separate)

#### Dependencies / Prerequisites {#dependencies}

- Phase 7c (Startup Continuity) must be complete — the inline body styles and startup overlay in `index.html` are the base layer of the continuity stack
- All existing `--tug-base-*` and `--tug-comp-*` design tokens must be stable

#### Constraints {#constraints}

- The existing Phase 7c infrastructure (inline body styles on `<body>`, `#deck-startup-overlay` div) must be preserved unchanged
- No changes to tugways component public APIs — consumer code must not need modification
- TypeScript must compile cleanly (`bunx tsc --noEmit`)
- Production build must succeed (`bun run build`)
- Never use npm; always use bun

#### Assumptions {#assumptions}

- CVA will be retained since TugButton's variant mapping pipeline depends on it; removing it is a separate refactor
- `tailwind-merge` can be removed once no Tailwind class strings remain, simplifying `cn()` to plain `clsx`
- The `postcss-tug-color` plugin is independent of `@tailwindcss/vite` and will continue to function after Tailwind removal
- The component gallery serves as the visual regression check for shadcn component styling
- The existing inline body style (`#16171a` background) and startup overlay in `index.html` are preserved unchanged as the base layer of the continuity stack
- Files listed in the idea that do not exist (`separator.tsx`, `label.tsx`, `popover.tsx`) are excluded from scope; the actual shadcn components to modify are the 13 files in `components/ui/`
- Active test files that assert on Tailwind class names (e.g., `tug-button.test.tsx`) must be updated to assert on the new semantic class names
- Archive files (`_archive/`) that reference Tailwind class names are dead code and will be left as-is

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows the conventions defined in the tugplan skeleton v2. All headings that are referenced use explicit `{#anchor-name}` anchors. Steps reference decisions, specs, and anchors using stable IDs.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Visual regression in shadcn components after Tailwind removal | med | med | Component gallery visual comparison before/after | Any component renders differently |
| CVA class strings incompatible without Tailwind's class generation | low | low | CVA works with plain CSS class names; test with button component first | Button variants break |
| Reload overlay timing race with `location.reload()` | low | low | Overlay is painted synchronously before reload; browser keeps old page painted until new page composites | Flash visible during reload |

**Risk R01: Visual Regression in shadcn Components** {#r01-visual-regression}

- **Risk:** Converting Tailwind utility classes to plain CSS may introduce subtle visual differences (spacing, borders, colors).
- **Mitigation:**
  - Convert one component at a time with visual verification in the component gallery
  - Map each Tailwind utility to its exact CSS equivalent using known Tailwind value mappings
  - Keep Tailwind color aliases mapped to the same `--tug-base-*` tokens they currently resolve to via the `@theme` bridge
- **Residual risk:** Some Tailwind utilities have micro-behaviors (e.g., `ring-offset`) that may need iterative CSS adjustment.

**Risk R02: Animation Parity with Tailwind Keyframes** {#r02-animation-parity}

- **Risk:** shadcn components use Tailwind's `animate-in`/`animate-out` system with composable modifiers (`fade-in-0`, `zoom-in-95`, `slide-in-from-top-2`). Recreating these in plain CSS requires understanding Tailwind's keyframe composition model.
- **Mitigation:**
  - Define explicit `@keyframes` for each animation pattern used (fade, zoom, slide from each direction)
  - Target Radix `data-[state=open]`/`data-[state=closed]` attributes directly in CSS selectors
  - Test each animated component (dialog, dropdown, tooltip, select) individually
- **Residual risk:** Animation timing may need fine-tuning to match the exact Tailwind output.

---

### Design Decisions {#design-decisions}

#### [D01] Retain CVA for Variant Management (DECIDED) {#d01-retain-cva}

**Decision:** Keep `class-variance-authority` for the button component's variant/size mapping pipeline.

**Rationale:**
- CVA is independent of Tailwind — it simply maps variant props to class name strings
- TugButton's variant architecture depends on CVA's `VariantProps` type inference
- Removing CVA is a separate refactor with its own scope

**Implications:**
- CVA `cva()` calls in `button.tsx` will reference semantic CSS class names instead of Tailwind utilities
- The `class-variance-authority` package remains in `package.json`

#### [D02] Simplify cn() to Plain clsx (DECIDED) {#d02-simplify-cn}

**Decision:** Replace the `cn()` implementation from `clsx + tailwind-merge` to plain `clsx`, and remove the `tailwind-merge` dependency.

**Rationale:**
- `tailwind-merge` exists solely to resolve Tailwind utility class conflicts (e.g., `bg-red bg-blue` -> `bg-blue`)
- With no Tailwind utility classes in the codebase, tailwind-merge serves no purpose
- `clsx` alone handles conditional class joining correctly

**Implications:**
- `lib/utils.ts` changes from `twMerge(clsx(inputs))` to `clsx(inputs)`
- `tailwind-merge` removed from `package.json` dependencies
- All existing `cn()` call sites continue to work unchanged

#### [D03] Semantic CSS Class Names for shadcn Components (DECIDED) {#d03-semantic-classes}

**Decision:** Replace Tailwind utility class strings in shadcn component TSX files with semantic class names (e.g., `.shadcn-dialog-content`, `.shadcn-button`) and define those classes in a new `shadcn-base.css` stylesheet.

**Rationale:**
- Keeps TSX files readable — a single semantic class name instead of a wall of Tailwind utilities
- CSS is auditable in one place — all shadcn styling lives in `shadcn-base.css`
- Semantic classes use the same `--tug-base-*` tokens that the `@theme` bridge currently maps Tailwind theme colors to

**Implications:**
- Every shadcn component's `className` props change from Tailwind strings to semantic class references
- A new `shadcn-base.css` file is created in `tugdeck/styles/`
- The file is imported in `css-imports.ts` to participate in the CSS HMR boundary

#### [D04] CSS-Only Animations for Radix State Transitions (DECIDED) {#d04-css-animations}

**Decision:** Recreate Tailwind's `animate-in`/`animate-out` system as plain CSS `@keyframes` targeting Radix `data-[state=open]`/`data-[state=closed]` attributes directly.

**Rationale:**
- Tailwind's animation utilities (`fade-in-0`, `zoom-in-95`, `slide-in-from-top-2`) are generated CSS — the equivalent CSS is straightforward to write by hand
- Targeting Radix data attributes directly is cleaner than the Tailwind utility composition model
- No runtime JS needed; CSS handles all open/close transitions

**Implications:**
- `shadcn-base.css` includes `@keyframes` for fade, zoom, and directional slide animations
- Component class names reference these keyframes via semantic animation classes
- Animation durations match current Tailwind output (200ms default)
- Animated component classes must include `transform-origin` set to the Radix-injected custom property (e.g., `transform-origin: var(--radix-dropdown-menu-content-transform-origin)` for dropdown, `var(--radix-tooltip-content-transform-origin)` for tooltip, `var(--radix-select-content-transform-origin)` for select) — without this, zoom/slide animations pivot from the wrong point

#### [D05] Minimal Custom CSS Reset (DECIDED) {#d05-minimal-reset}

**Decision:** Add a minimal CSS reset in `shadcn-base.css` covering `box-sizing`, `border-color` default, button/input/select/textarea `appearance` normalization, and margin clearing — only what shadcn components actually need.

**Rationale:**
- Tailwind's preflight provides a comprehensive CSS reset, but most of it is irrelevant to the shadcn components used here
- The existing `globals.css` already handles `html`/`body` resets
- A targeted reset avoids introducing unintended style changes elsewhere

**Implications:**
- The reset section in `shadcn-base.css` is small (~20 lines) and scoped to form elements and common HTML elements used by shadcn
- It must be loaded before component-specific styles (natural if it appears first in the file)

#### [D06] Reload Overlay via import.meta.hot.on() (DECIDED) {#d06-reload-overlay}

**Decision:** Implement the reload continuity overlay by registering an `import.meta.hot.on('vite:beforeFullReload', ...)` callback in a module file (`css-imports.ts`), which synchronously paints a full-screen dark overlay before `location.reload()` fires.

**Rationale:**
- `vite:beforeFullReload` is dispatched via Vite's HMR client (`import.meta.hot`), not as a DOM CustomEvent — only code with access to `import.meta.hot` can listen for it
- An inline `<script>` injected via `transformIndexHtml` cannot access `import.meta.hot` because it runs outside the ES module system
- `css-imports.ts` already has an `import.meta.hot` block for CSS HMR acceptance, making it the natural home for reload overlay logic
- CSS-only approaches cannot react to HMR events
- The overlay does not need TugAnimator — it must appear instantly (synchronous DOM manipulation)

**Implications:**
- The reload overlay logic is added to the existing `import.meta.hot` block in `css-imports.ts` — no new file needed for a Vite plugin
- The callback creates a `<div>` overlay matching the body background color (`#16171a`) and appends it to `document.body` synchronously before the reload
- For Vite-initiated reloads, the visual sequence is: dark overlay (old page) -> dark body + startup overlay (new page) -> content fade-in
- Browser-initiated reloads (Cmd+R) bypass `vite:beforeFullReload` but are already handled by Phase 7c's inline body styles and startup overlay
- Dev-only: `import.meta.hot` is only available in dev mode; no production impact

---

### Specification {#specification}

#### shadcn Component Class Mapping {#component-class-mapping}

**Table T01: Component-to-Class Mapping** {#t01-component-class-mapping}

Each shadcn component's Tailwind utility strings are replaced with semantic CSS classes. The class naming convention is `.shadcn-{component}-{element}`.

| Component File | Elements | Semantic Classes |
|---------------|----------|-----------------|
| `button.tsx` | root | `.shadcn-button`, `.shadcn-button--{variant}`, `.shadcn-button--size-{size}` |
| `dialog.tsx` | overlay, content, close, header, footer, title, description | `.shadcn-dialog-overlay`, `.shadcn-dialog-content`, `.shadcn-dialog-close`, `.shadcn-dialog-header`, `.shadcn-dialog-footer`, `.shadcn-dialog-title`, `.shadcn-dialog-description` |
| `checkbox.tsx` | root, indicator | `.shadcn-checkbox`, `.shadcn-checkbox-indicator` |
| `scroll-area.tsx` | root, viewport, scrollbar, thumb | `.shadcn-scroll-area`, `.shadcn-scroll-area-viewport`, `.shadcn-scrollbar`, `.shadcn-scrollbar--horizontal`, `.shadcn-scroll-thumb` |
| `dropdown-menu.tsx` | content, item, checkbox-item, radio-item, label, separator, shortcut, sub-trigger, sub-content | `.shadcn-dropdown-content`, `.shadcn-dropdown-item`, `.shadcn-dropdown-item--inset` (conditional when `inset` prop is true; adds `padding-left: 2rem`), `.shadcn-dropdown-checkbox-item`, `.shadcn-dropdown-radio-item`, `.shadcn-dropdown-label`, `.shadcn-dropdown-label--inset` (conditional when `inset` prop is true), `.shadcn-dropdown-separator`, `.shadcn-dropdown-shortcut`, `.shadcn-dropdown-sub-trigger`, `.shadcn-dropdown-sub-trigger--inset` (conditional when `inset` prop is true), `.shadcn-dropdown-sub-content` |
| `tooltip.tsx` | content | `.shadcn-tooltip-content` |
| `select.tsx` | trigger, content, viewport, item, label, separator, scroll-button | `.shadcn-select-trigger`, `.shadcn-select-content`, `.shadcn-select-content--popper` (conditional when `position === "popper"`; uses `margin` for directional offset per Spec S04), `.shadcn-select-viewport`, `.shadcn-select-viewport--popper` (conditional when `position === "popper"`), `.shadcn-select-item`, `.shadcn-select-label`, `.shadcn-select-separator`, `.shadcn-select-scroll-button` |
| `input.tsx` | root | `.shadcn-input` |
| `textarea.tsx` | root | `.shadcn-textarea` |
| `switch.tsx` | root, thumb | `.shadcn-switch`, `.shadcn-switch-thumb` |
| `card.tsx` | root, header, title, description, content, footer | `.shadcn-card`, `.shadcn-card-header`, `.shadcn-card-title`, `.shadcn-card-description`, `.shadcn-card-content`, `.shadcn-card-footer` |
| `radio-group.tsx` | root, item, indicator | `.shadcn-radio-group`, `.shadcn-radio-group-item`, `.shadcn-radio-group-indicator` |
| `tabs.tsx` | list, trigger, content | `.shadcn-tabs-list`, `.shadcn-tabs-trigger`, `.shadcn-tabs-content` |

In addition, `shadcn-base.css` must include:
- **`.sr-only`** — screen-reader-only utility (replaces Tailwind's `sr-only`; used in `dialog.tsx` close button)

#### Tailwind Modifier Translation Rules {#modifier-translation}

**Table T03: Responsive Breakpoints** {#t03-responsive-breakpoints}

Tailwind responsive modifiers used in shadcn components must be translated to `@media` queries:

| Tailwind Prefix | CSS Equivalent | Used In |
|----------------|---------------|---------|
| `sm:` | `@media (min-width: 640px)` | `dialog.tsx` (`sm:text-left`, `sm:flex-row`, `sm:justify-end`, `sm:space-x-2`, `sm:rounded-lg`) |
| `md:` | `@media (min-width: 768px)` | `input.tsx` (`md:text-sm`), `textarea.tsx` (`md:text-sm`) |

Pseudo-class modifiers (`hover:`, `focus-visible:`, `disabled:`, `data-[state=...]:`, `file:`, `placeholder:`, `[&_svg]:`) translate directly to standard CSS pseudo-class selectors, attribute selectors, and nested selectors. The `peer` class on `checkbox.tsx` and `switch.tsx` can be safely dropped — no `peer-*` selectors exist elsewhere in the codebase.

**Spacing utilities:** Tailwind's `space-y-*` and `space-x-*` utilities (e.g., `space-y-1.5` in dialog header, `sm:space-x-2` in dialog footer) apply margin to child elements via the `> :not(:first-child)` selector pattern. The CSS equivalent is `gap` on flex containers where flex layout is already used, or `> * + * { margin-left/margin-top: ... }` for non-flex contexts. Since dialog header uses `flex-col` and dialog footer uses `flex-row`, these should use `gap` directly in their semantic CSS classes.

**Icon sizing utilities:** Components pass Tailwind sizing classes (`h-4 w-4`, `h-2 w-2`, `h-3.5 w-3.5`) to Lucide icon components via `className`. These must be handled by adding small utility classes in `shadcn-base.css` (e.g., `.icon-4 { width: 1rem; height: 1rem; }`, `.icon-2 { width: 0.5rem; height: 0.5rem; }`, `.icon-3\.5 { width: 0.875rem; height: 0.875rem; }`) or by using nested selectors on the parent semantic class (e.g., `.shadcn-checkbox-indicator svg { width: 1rem; height: 1rem; }`).

#### Tailwind Theme Color Resolution {#theme-color-resolution}

**Table T02: Tailwind Color to Token Mapping** {#t02-color-token-mapping}

These are the color mappings currently defined in the `@theme` block of `globals.css`. The CSS replacements in `shadcn-base.css` reference the `--tug-base-*` tokens directly.

| Tailwind Color | CSS Custom Property | Resolution |
|---------------|--------------------|----|
| `bg-background` | `background-color` | `var(--tug-base-bg-app)` |
| `text-foreground` | `color` | `var(--tug-base-fg-default)` |
| `bg-card` | `background-color` | `var(--tug-base-card-bg)` |
| `text-card-foreground` | `color` | `var(--tug-base-fg-default)` |
| `bg-popover` | `background-color` | `var(--tug-base-surface-control)` |
| `text-popover-foreground` | `color` | `var(--tug-base-fg-default)` |
| `bg-primary` | `background-color` | `var(--tug-base-accent-default)` |
| `text-primary-foreground` | `color` | `var(--tug-base-fg-inverse)` |
| `bg-secondary` | `background-color` | `var(--tug-base-surface-control)` |
| `text-secondary-foreground` | `color` | `var(--tug-base-fg-default)` |
| `bg-muted` | `background-color` | `var(--tug-base-surface-control)` |
| `text-muted-foreground` | `color` | `var(--tug-base-fg-muted)` |
| `bg-accent` | `background-color` | `var(--tug-base-accent-cool-default)` |
| `text-accent-foreground` | `color` | `var(--tug-base-bg-app)` |
| `bg-destructive` | `background-color` | `var(--tug-base-accent-danger)` |
| `text-destructive-foreground` | `color` | `var(--tug-base-fg-inverse)` |
| `border-border` / `border-input` | `border-color` | `var(--tug-base-border-default)` |
| `bg-border` | `background-color` | `var(--tug-base-border-default)` (used by scroll-area thumb) |
| `bg-black/80` | `background-color` | `rgba(0, 0, 0, 0.8)` (used by dialog overlay; not a theme color) |
| `ring-ring` | focus ring color | `var(--tug-base-accent-cool-default)` |
| `ring-offset-background` | focus ring offset color | `var(--tug-base-bg-app)` |
| `rounded-sm` | `border-radius` | `var(--tug-base-radius-sm)` |
| `rounded-md` | `border-radius` | `var(--tug-base-radius-md)` |
| `rounded-lg` | `border-radius` | `var(--tug-base-radius-lg)` |

#### Focus Ring Translation {#focus-ring-translation}

**Spec S02: Focus Ring System** {#s02-focus-ring}

Tailwind's focus ring system uses a coordinated four-part pattern that appears in 9 of the 13 shadcn components:

```
focus-visible:ring-2 ring-ring ring-offset-2 ring-offset-background
```

This generates layered `box-shadow` values internally. The plain CSS equivalent uses `outline` instead:

```css
.component:focus-visible {
  outline: 2px solid var(--tug-base-accent-cool-default);
  outline-offset: 2px;
}
```

This produces a visually equivalent focus indicator: a 2px ring in the accent color with a 2px gap (offset). The `ring-offset-background` color (which fills the gap between the element and the ring) is not needed with `outline-offset` because the gap naturally shows the underlying background.

All semantic classes that include `focus-visible:ring-*` Tailwind utilities must use this `outline` + `outline-offset` pattern in their CSS definitions.

**Exception — bare `:focus` ring:** Two elements use `focus:` instead of `focus-visible:` in their Tailwind classes: the dialog close button (`DialogPrimitive.Close`) and the select trigger (`SelectPrimitive.Trigger`). Their CSS must use `:focus` to preserve the current behavior:

```css
.shadcn-dialog-close:focus {
  outline: 2px solid var(--tug-base-accent-cool-default);
  outline-offset: 2px;
}
.shadcn-select-trigger:focus {
  outline: 2px solid var(--tug-base-accent-cool-default);
  outline-offset: 2px;
}
```

This distinction is preserved intentionally — modernizing these to `:focus-visible` would be a behavioral change outside this plan's scope.

#### Animation Composition Strategy {#animation-composition}

**Spec S03: Animation Composition** {#s03-animation-composition}

Animations are composed using multiple `animation-name` values on a single element. Each `@keyframes` block animates exactly one CSS property, and no two simultaneously-running keyframes may target the same property.

The keyframes are:

- `shadcn-fade-in` / `shadcn-fade-out` — animates `opacity`
- `shadcn-zoom-in` / `shadcn-zoom-out` — animates `scale`
- `shadcn-slide-in` / `shadcn-slide-out` — animates `translate` (both X and Y axes in a single keyframe)

**Animation fill-mode rules:**

- **Open animations** use `animation-fill-mode: none` (the default). After the animation completes, the element's static CSS properties take effect. This is critical for dialog, which has `translate: -50% -50%` as a static property — after the open animation ends, the static centering rule takes over.
- **Close animations** use `animation-fill-mode: forwards`. The animation holds its final state (e.g., `opacity: 0`, `scale: 0.95`) until Radix unmounts the element. Without `forwards`, the element would snap back to its static appearance for a frame before unmount.

**Example composition:**

```css
/* Static centering — always present, takes effect when no animation is running */
.shadcn-dialog-content {
  translate: -50% -50%;
}

/* Open: fill-mode none — static translate takes over after animation ends */
.shadcn-dialog-content[data-state="open"] {
  animation: shadcn-fade-in 200ms ease-out,
             shadcn-zoom-in 200ms ease-out,
             shadcn-slide-in 200ms ease-out;
  /* animation-fill-mode: none (default) */
}

/* Close: fill-mode forwards — holds final state until Radix unmounts */
.shadcn-dialog-content[data-state="closed"] {
  animation: shadcn-fade-out 200ms ease-out forwards,
             shadcn-zoom-out 200ms ease-out forwards,
             shadcn-slide-out 200ms ease-out forwards;
}

/* Dropdown: no static translate needed — resting position is translate: 0 0 */
.shadcn-dropdown-content[data-state="open"] {
  animation: shadcn-fade-in 200ms ease-out,
             shadcn-zoom-in 200ms ease-out,
             shadcn-slide-in 200ms ease-out;
}

/* Tooltip: open animation is UNCONDITIONAL (no data-state selector) —
   matches current Tailwind behavior where animate-in/fade-in/zoom-in
   are applied without a data-[state=open]: prefix.
   Only close animation is gated on data-state=closed. */
.shadcn-tooltip-content {
  animation: shadcn-fade-in 200ms ease-out,
             shadcn-zoom-in 200ms ease-out,
             shadcn-slide-in 200ms ease-out;
}
.shadcn-tooltip-content[data-state="closed"] {
  animation: shadcn-fade-out 200ms ease-out forwards,
             shadcn-zoom-out 200ms ease-out forwards,
             shadcn-slide-out 200ms ease-out forwards;
}
```

**Slide keyframes use CSS custom properties for both `from` and `to` values** on both axes, allowing each component to control both the starting position and the resting position:

```css
@keyframes shadcn-slide-in {
  from { translate: var(--shadcn-slide-from-x, 0) var(--shadcn-slide-from-y, 0.5rem); }
  to   { translate: var(--shadcn-slide-to-x, 0) var(--shadcn-slide-to-y, 0); }
}
@keyframes shadcn-slide-out {
  from { translate: var(--shadcn-slide-to-x, 0) var(--shadcn-slide-to-y, 0); }
  to   { translate: var(--shadcn-slide-from-x, 0) var(--shadcn-slide-from-y, 0.5rem); }
}
```

Note: `translate` is the CSS individual transform property (supported in all modern browsers). It takes `x y` as a single value, which is why X and Y must be combined in one keyframe rather than split across two.

**Per-component custom property values:**

| Component | `--shadcn-slide-from-x` | `--shadcn-slide-from-y` | `--shadcn-slide-to-x` | `--shadcn-slide-to-y` | Notes |
|-----------|------------------------|------------------------|----------------------|---------------------|-------|
| **Dialog content** | `-50%` | `-48%` | `-50%` | `-50%` | `.shadcn-dialog-content` must include static `translate: -50% -50%` for centering; open animation uses fill-mode `none` so static translate takes over after animation ends; close animation uses fill-mode `forwards` |
| **Dropdown** (per side) | varies | varies | `0` | `0` | See directional table below |
| **Tooltip** (per side) | varies | varies | `0` | `0` | Same directional pattern as dropdown |
| **Select** (per side) | varies | varies | `0` | `0` | Same directional pattern as dropdown |

**Directional slides** for dropdown, tooltip, and select — the `data-[side]` attribute determines direction:

```css
.shadcn-dropdown-content[data-side="bottom"] { --shadcn-slide-from-y: -0.5rem; }
.shadcn-dropdown-content[data-side="top"]    { --shadcn-slide-from-y: 0.5rem; }
.shadcn-dropdown-content[data-side="left"]   { --shadcn-slide-from-x: 0.5rem; }
.shadcn-dropdown-content[data-side="right"]  { --shadcn-slide-from-x: -0.5rem; }
```

The same pattern applies to `.shadcn-tooltip-content`, `.shadcn-select-content`, and `.shadcn-dropdown-sub-content` with their respective `data-[side]` selectors.

#### Select Popper Offset Strategy {#popper-offset}

**Spec S04: Popper Offset via Margin** {#s04-popper-offset}

The select component with `position === "popper"` applies static directional translate offsets (Tailwind: `data-[side=bottom]:translate-y-1`, `data-[side=top]:-translate-y-1`, etc.). These offsets conflict with the slide animation system, which uses the `translate` CSS property for keyframe animation. Two properties cannot independently control `translate`.

**Resolution:** Replace the popper translate offsets with `margin` in `.shadcn-select-content--popper`, keeping `translate` free for animations:

```css
.shadcn-select-content--popper[data-side="bottom"] { margin-top: 0.25rem; }
.shadcn-select-content--popper[data-side="top"]    { margin-bottom: 0.25rem; }
.shadcn-select-content--popper[data-side="left"]   { margin-right: 0.25rem; }
.shadcn-select-content--popper[data-side="right"]  { margin-left: 0.25rem; }
```

This produces the same visual spacing (`0.25rem` = Tailwind's `1` unit) without interfering with the animation system. Margin does not participate in transform animations, so both systems work independently.

#### Reload Overlay Spec {#reload-overlay-spec}

**Spec S01: Reload Overlay** {#s01-reload-overlay}

The reload overlay is implemented as an `import.meta.hot.on()` callback in `css-imports.ts`:

- **Location:** `tugdeck/src/css-imports.ts`, inside the existing `if (import.meta.hot)` block
- **Event:** `import.meta.hot.on('vite:beforeFullReload', callback)` — this is the only way to listen for Vite's pre-reload notification; it is dispatched via the HMR client, not as a DOM event
- **Callback behavior:**
  1. Create a `<div>` with `position: fixed; inset: 0; background: #16171a; z-index: 99998` (below the startup overlay's 99999)
  2. Append the div to `document.body` synchronously
  3. Vite then executes `location.reload()` — the old page (now showing the dark overlay) stays painted until the new page composites
  4. The new page starts dark (Phase 7c inline body style + startup overlay), so the transition is seamless
- **Scope:** This overlay handles Vite-initiated reloads only (`vite:beforeFullReload` is dispatched by Vite's HMR client, not by browser navigation). Browser-initiated reloads (Cmd+R, dock menu) are handled by Phase 7c's existing inline body styles and startup overlay
- **Dev-only:** `import.meta.hot` is only defined in dev mode; the callback is never registered in production builds
- **No TugAnimator dependency:** The overlay must appear instantly with no animation delay

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/styles/shadcn-base.css` | Plain CSS replacements for all Tailwind utilities used in shadcn components, including CSS reset and animation keyframes |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `cn()` | fn (modified) | `tugdeck/src/lib/utils.ts` | Simplified from `twMerge(clsx(...))` to `clsx(...)` |
| HMR reload overlay | callback | `tugdeck/src/css-imports.ts` | `import.meta.hot.on('vite:beforeFullReload', ...)` callback added to existing HMR block |

---

### Documentation Plan {#documentation-plan}

- [ ] Update `roadmap/tugways-implementation-strategy.md` to add Phase 7d and note future phases should wrap Radix primitives directly
- [ ] Update the "What To Keep" table in implementation strategy to remove Tailwind references from `globals.css` and `lib/utils.ts` entries

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Build verification** | Confirm TypeScript compilation and production build succeed | After every step |
| **Visual regression** | Compare component gallery rendering before and after changes | After Tailwind stripping steps |
| **Dev reload verification** | Confirm CSS edits produce no visible flash in dev mode | After reload overlay step |
| **Grep audit** | Verify no Tailwind utility patterns remain in source | Final checkpoint |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Create shadcn-base.css with Reset and Animation Keyframes {#step-1}

**Commit:** `feat(tugdeck): add shadcn-base.css with CSS reset and animation keyframes`

**References:** [D03] Semantic CSS class names, [D04] CSS-only animations, [D05] Minimal custom reset, Table T01, Table T02, (#component-class-mapping, #theme-color-resolution)

**Artifacts:**
- New file: `tugdeck/styles/shadcn-base.css`
- Modified: `tugdeck/src/css-imports.ts` (add import for `shadcn-base.css`)

**Tasks:**
- [ ] Create `tugdeck/styles/shadcn-base.css` with three sections:
  1. **Minimal CSS reset** (~25 lines): `box-sizing: border-box` on `*`, `border-color: var(--tug-base-border-default)` on `*, *::before, *::after` (replaces Tailwind preflight's default border-color — several shadcn components use bare `border` without explicit `border-color`, relying on this default), button/input/select/textarea appearance normalization (font-family inherit, margin clearing)
  2. **Animation keyframes** per Spec S03: `@keyframes shadcn-fade-in`, `@keyframes shadcn-fade-out`, `@keyframes shadcn-zoom-in`, `@keyframes shadcn-zoom-out`, `@keyframes shadcn-slide-in`, `@keyframes shadcn-slide-out`. Slide keyframes animate the `translate` CSS property (both X and Y in a single keyframe) using custom properties (`--shadcn-slide-from-x`, `--shadcn-slide-from-y`, `--shadcn-slide-to-x`, `--shadcn-slide-to-y`) so dialog can use percentage values while dropdown/tooltip/select use rem values
  3. **Stub sections** for each component's semantic classes (populated in subsequent steps)
- [ ] Add `import "../styles/shadcn-base.css";` to `css-imports.ts` (before the HMR accept block)
- [ ] Verify the CSS file loads without errors in dev mode
- [ ] Include `.sr-only` utility class in the reset section (replaces Tailwind's `sr-only`, used by `dialog.tsx` close button)

**Tests:**
- [ ] T1.1: `bun run build` succeeds with new CSS file imported
- [ ] T1.2: Dev server starts without CSS parse errors

**Checkpoint:**
- [ ] `bun run build` succeeds
- [ ] `bunx tsc --noEmit` passes
- [ ] Dev server starts and component gallery renders unchanged (new CSS is additive only at this point)

---

#### Step 2: Simplify cn() and Remove tailwind-merge {#step-2}

**Depends on:** #step-1

**Commit:** `refactor(tugdeck): simplify cn() to plain clsx, remove tailwind-merge`

**References:** [D02] Simplify cn() to plain clsx, (#assumptions)

**Artifacts:**
- Modified: `tugdeck/src/lib/utils.ts`
- Modified: `tugdeck/package.json` (remove `tailwind-merge`)

**Tasks:**
- [ ] Change `lib/utils.ts` to:
  ```typescript
  import { clsx, type ClassValue } from "clsx";
  export function cn(...inputs: ClassValue[]): string {
    return clsx(inputs);
  }
  ```
- [ ] Remove `tailwind-merge` from `package.json` dependencies
- [ ] Run `cd tugdeck && bun install` to update lockfile

**Tests:**
- [ ] T2.1: `bunx tsc --noEmit` passes (cn() type signature unchanged)
- [ ] T2.2: `bun run build` succeeds without tailwind-merge

**Checkpoint:**
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun run build` succeeds
- [ ] Component gallery renders unchanged — tailwind-merge is safe to remove at this point because no consumer code passes conflicting Tailwind utilities via `className` props; the Tailwind strings in shadcn components are static and non-conflicting

---

#### Step 3: Strip Tailwind from Simple Components (input, textarea, card, tabs, radio-group) {#step-3}

**Depends on:** #step-2

**Commit:** `refactor(tugdeck): strip Tailwind from input, textarea, card, tabs, radio-group`

**References:** [D03] Semantic CSS class names, Table T01, Table T02, Spec S02, (#component-class-mapping, #theme-color-resolution, #focus-ring-translation)

**Artifacts:**
- Modified: `tugdeck/src/components/ui/input.tsx`
- Modified: `tugdeck/src/components/ui/textarea.tsx`
- Modified: `tugdeck/src/components/ui/card.tsx`
- Modified: `tugdeck/src/components/ui/tabs.tsx`
- Modified: `tugdeck/src/components/ui/radio-group.tsx`
- Modified: `tugdeck/styles/shadcn-base.css` (add semantic class definitions)

**Tasks:**
- [ ] For each component: replace Tailwind utility class strings in `className` props with the corresponding semantic class name from Table T01
- [ ] Add CSS rules in `shadcn-base.css` for each semantic class, translating Tailwind utilities to plain CSS properties using Table T02 for color/token resolution
- [ ] Translate focus ring utilities (`focus-visible:ring-2 ring-ring ring-offset-2 ring-offset-background`) to `outline: 2px solid var(--tug-base-accent-cool-default); outline-offset: 2px` per Spec S02
- [ ] Ensure each component still accepts and merges a `className` prop via `cn()`
- [ ] Translate responsive modifiers (`md:text-sm` in input/textarea) to `@media (min-width: 768px)` queries per Table T03
- [ ] Verify visual appearance in component gallery matches current rendering

**Tests:**
- [ ] T3.1: `bunx tsc --noEmit` passes after className changes
- [ ] T3.2: Component gallery visual parity check for input, textarea, card, tabs, radio-group

**Checkpoint:**
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun run build` succeeds
- [ ] Component gallery: input, textarea, card, tabs, radio-group render with visual parity

---

#### Step 4: Strip Tailwind from Interactive Components (checkbox, switch, scroll-area) {#step-4}

**Depends on:** #step-2

**Commit:** `refactor(tugdeck): strip Tailwind from checkbox, switch, scroll-area`

**References:** [D03] Semantic CSS class names, Table T01, Table T02, Spec S02, (#component-class-mapping, #theme-color-resolution, #focus-ring-translation)

**Artifacts:**
- Modified: `tugdeck/src/components/ui/checkbox.tsx`
- Modified: `tugdeck/src/components/ui/switch.tsx`
- Modified: `tugdeck/src/components/ui/scroll-area.tsx`
- Modified: `tugdeck/styles/shadcn-base.css` (add semantic class definitions)

**Tasks:**
- [ ] Replace Tailwind utility strings with semantic class names per Table T01
- [ ] Add CSS rules in `shadcn-base.css` for checkbox (including `data-[state=checked]` variants), switch (including thumb translate and checked state), and scroll-area (including orientation variants)
- [ ] Drop the `peer` class from checkbox and switch (no `peer-*` selectors exist elsewhere in the codebase)
- [ ] Verify visual appearance and interactive behavior in component gallery

**Tests:**
- [ ] T4.1: `bunx tsc --noEmit` passes after className changes
- [ ] T4.2: Component gallery visual parity and interaction check for checkbox, switch, scroll-area

**Checkpoint:**
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun run build` succeeds
- [ ] Component gallery: checkbox, switch, scroll-area render and interact correctly

---

#### Step 5: Strip Tailwind from Animated Components (dialog, dropdown-menu, tooltip, select) {#step-5}

**Depends on:** #step-1, #step-2

**Commit:** `refactor(tugdeck): strip Tailwind from dialog, dropdown-menu, tooltip, select`

**References:** [D03] Semantic CSS class names, [D04] CSS-only animations, Table T01, Table T02, Spec S02, Spec S03, Spec S04, Risk R02, (#component-class-mapping, #theme-color-resolution, #focus-ring-translation, #animation-composition, #popper-offset)

**Artifacts:**
- Modified: `tugdeck/src/components/ui/dialog.tsx`
- Modified: `tugdeck/src/components/ui/dropdown-menu.tsx`
- Modified: `tugdeck/src/components/ui/tooltip.tsx`
- Modified: `tugdeck/src/components/ui/select.tsx`
- Modified: `tugdeck/styles/shadcn-base.css` (add semantic class definitions and animation bindings)

**Tasks:**
- [ ] Replace Tailwind utility strings with semantic class names per Table T01
- [ ] Add CSS rules in `shadcn-base.css` that bind the keyframes from Step 1 to Radix `data-[state=open]`/`data-[state=closed]` attribute selectors on the appropriate semantic classes
- [ ] Apply animation-fill-mode per Spec S03: open animations use `fill-mode: none` (default, so static CSS takes over after animation ends), close animations use `fill-mode: forwards` (holds final state until Radix unmounts)
- [ ] Map animation compositions per Spec S03 (multiple animation names with a single combined `shadcn-slide-in`/`shadcn-slide-out` keyframe that animates the `translate` property on both axes):
  - **Dialog:** `.shadcn-dialog-content` must include static `translate: -50% -50%` for centering (this takes effect after the open animation ends with fill-mode `none`). Slide custom properties: `--shadcn-slide-from-x: -50%; --shadcn-slide-from-y: -48%; --shadcn-slide-to-x: -50%; --shadcn-slide-to-y: -50%`. Close animation uses `forwards` to hold final state until Radix unmounts.
  - **Dropdown/tooltip/select:** No static translate needed (resting position is `translate: 0 0`). Directional slide with rem distances (default `0.5rem`, `to` values `0`), direction determined by `data-[side]` attribute variants per Spec S03. Close animation uses `forwards`.
- [ ] Note tooltip animation gating difference: the tooltip's open animation (`animate-in`, `fade-in-0`, `zoom-in-95`, directional slides) is applied unconditionally on `.shadcn-tooltip-content` — NOT gated on `[data-state=open]`. Only the close animation is gated on `[data-state=closed]`. This matches the current Tailwind behavior where these classes are applied without a `data-[state=open]:` prefix
- [ ] Set `transform-origin` on each animated semantic class to the Radix-injected custom property: `var(--radix-dropdown-menu-content-transform-origin)` for dropdown content/sub-content, `var(--radix-tooltip-content-transform-origin)` for tooltip, `var(--radix-select-content-transform-origin)` for select — these replace Tailwind's `origin-[--radix-*]` arbitrary value utilities
- [ ] Handle `select.tsx` position=popper conditional: use `cn('shadcn-select-content', position === 'popper' && 'shadcn-select-content--popper', className)` for content and `cn('shadcn-select-viewport', position === 'popper' && 'shadcn-select-viewport--popper')` for viewport; define `.shadcn-select-content--popper` with directional margin offsets (not translate) per Spec S04 to avoid conflicting with slide animation keyframes, and `.shadcn-select-viewport--popper` with Radix trigger height/width sizing
- [ ] Translate responsive modifiers (`sm:text-left`, `sm:flex-row`, `sm:justify-end`, `sm:space-x-2`, `sm:rounded-lg` in dialog) to `@media (min-width: 640px)` queries per Table T03
- [ ] Ensure dialog close button uses `.sr-only` class for the "Close" text span
- [ ] Verify open/close animations play correctly for each component in the component gallery

**Tests:**
- [ ] T5.1: `bunx tsc --noEmit` passes after className changes
- [ ] T5.2: Component gallery animation check — dialog, dropdown, tooltip, select open/close smoothly

**Checkpoint:**
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun run build` succeeds
- [ ] Component gallery: dialog, dropdown, tooltip, select animate correctly on open/close

---

#### Step 6: Strip Tailwind from Button Component {#step-6}

**Depends on:** #step-2

**Commit:** `refactor(tugdeck): strip Tailwind from button component, retain CVA`

**References:** [D01] Retain CVA, [D03] Semantic CSS class names, Table T01, Table T02, Spec S02, (#component-class-mapping, #focus-ring-translation)

**Artifacts:**
- Modified: `tugdeck/src/components/ui/button.tsx`
- Modified: `tugdeck/styles/shadcn-base.css` (add button semantic class definitions)
- Modified: `tugdeck/src/__tests__/tug-button.test.tsx` (update className assertions to use new semantic class names)

**Tasks:**
- [ ] Replace Tailwind utility strings in the `cva()` call with semantic CSS class names: base class `.shadcn-button`, variant classes `.shadcn-button--default`, `.shadcn-button--destructive`, `.shadcn-button--outline`, `.shadcn-button--secondary`, `.shadcn-button--ghost`, `.shadcn-button--link`, size classes `.shadcn-button--size-default`, `.shadcn-button--size-sm`, `.shadcn-button--size-lg`, `.shadcn-button--size-icon`
- [ ] Add CSS rules in `shadcn-base.css` for each variant and size class using `--tug-base-*` tokens
- [ ] Update `tug-button.test.tsx` assertions that check Tailwind-originating class names only: change `toContain('bg-primary')` to `toContain('shadcn-button--default')`, `toContain('bg-secondary')` to `toContain('shadcn-button--secondary')`, `toContain('bg-destructive')` to `toContain('shadcn-button--destructive')`, `toContain('h-9')` to `toContain('shadcn-button--size-sm')`, default size `toContain('h-10')` to `toContain('shadcn-button--size-default')`, lg size `toContain('h-10')` to `toContain('shadcn-button--size-lg')`, and icon size similarly to `toContain('shadcn-button--size-icon')`. Note: assertions that check `tug-button-*` class names (e.g., `tug-button-primary`) are from TugButton's own styling layer, not shadcn/Tailwind, and must remain unchanged
- [ ] Note: archive file `_archive/cards/conversation/approval-prompt.test.tsx` also asserts on Tailwind class names — archive files are dead code and will be left as-is (they are not run as part of the test suite)
- [ ] Verify all button variants render correctly in the component gallery

**Tests:**
- [ ] T6.1: `bunx tsc --noEmit` passes (CVA VariantProps still infers correctly with semantic class names)
- [ ] T6.2: `bun test` passes with updated tug-button.test.tsx assertions
- [ ] T6.3: Component gallery visual parity check for all button variants and sizes

**Checkpoint:**
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun run build` succeeds
- [ ] Component gallery: all button variants (default, destructive, outline, secondary, ghost, link) and sizes render correctly

---

#### Step 7: Component Stripping Integration Checkpoint {#step-7}

**Depends on:** #step-3, #step-4, #step-5, #step-6

**Commit:** `N/A (verification only)`

**References:** [D03] Semantic CSS class names, Risk R01, (#success-criteria)

**Tasks:**
- [ ] Verify all 13 shadcn components have been converted to semantic CSS classes
- [ ] Grep for remaining Tailwind utility patterns in `components/ui/` — expect zero matches for Tailwind-specific patterns
- [ ] Visual comparison of component gallery against current rendering for all components
- [ ] Verify no Tailwind color utilities remain in any `components/ui/*.tsx` file
- [ ] Confirm archive files and test files importing from `components/ui/` are unaffected (component public APIs are unchanged — only internal className strings changed)

**Tests:**
- [ ] T7.1: Tailwind utility audit grep returns zero matches (see checkpoint)
- [ ] T7.2: Full component gallery renders all 13 components with visual parity

**Checkpoint:**
- [ ] `grep -rE "bg-(primary|secondary|destructive|muted|accent|popover|card|background|input|black)|text-(foreground|primary-foreground|secondary-foreground|muted-foreground|accent-foreground|destructive-foreground|popover-foreground|card-foreground)|border-input|ring-ring|ring-offset-background|animate-in|animate-out|fade-in-|fade-out-|zoom-in-|zoom-out-|slide-in-|slide-out-|sr-only|\\bpeer\\b" tugdeck/src/components/ui/ --include="*.tsx"` returns zero matches (all Tailwind utilities and helper classes replaced)
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun run build` succeeds

---

#### Step 8: Remove Tailwind Plugin and Dependencies {#step-8}

**Depends on:** #step-7

**Commit:** `refactor(tugdeck): remove @tailwindcss/vite, tailwindcss, and @theme bridge`

**References:** [D02] Simplify cn(), [D05] Minimal custom reset, (#context, #strategy)

**Artifacts:**
- Modified: `tugdeck/vite.config.ts` (remove `@tailwindcss/vite` import and `tailwindcss()` plugin call)
- Modified: `tugdeck/src/globals.css` (remove `@import "tailwindcss"` and `@theme` block)
- Modified: `tugdeck/package.json` (remove `tailwindcss` and `@tailwindcss/vite` from dependencies)

**Tasks:**
- [ ] Remove `import tailwindcss from "@tailwindcss/vite"` from `vite.config.ts`
- [ ] Remove `tailwindcss()` from the `plugins` array in `vite.config.ts`
- [ ] Remove `@import "tailwindcss";` from `globals.css`
- [ ] Remove the entire `@theme { ... }` block from `globals.css`
- [ ] Remove `tailwindcss` from `devDependencies` and `@tailwindcss/vite` from `devDependencies` in `package.json`
- [ ] Run `cd tugdeck && bun install` to update lockfile
- [ ] Verify the dev server starts without errors

**Tests:**
- [ ] T8.1: `bunx tsc --noEmit` passes without Tailwind type references
- [ ] T8.2: `bun run build` produces working production bundle without Tailwind
- [ ] T8.3: Tailwind import audit grep returns zero matches (see checkpoint)

**Checkpoint:**
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun run build` succeeds
- [ ] Dev server starts and component gallery renders all components correctly
- [ ] No Tailwind-related imports remain in the codebase: `grep -r "tailwindcss\|tailwind-merge\|@tailwindcss" tugdeck/src/ tugdeck/vite.config.ts --include="*.ts" --include="*.tsx" --include="*.css"` returns zero matches

---

#### Step 9: Add Reload Continuity Overlay {#step-9}

**Depends on:** #step-8

**Commit:** `feat(tugdeck): add reload continuity overlay via import.meta.hot`

**References:** [D06] Reload overlay via import.meta.hot.on(), Spec S01, (#reload-overlay-spec)

**Artifacts:**
- Modified: `tugdeck/src/css-imports.ts` (add `import.meta.hot.on('vite:beforeFullReload', ...)` callback)

**Tasks:**
- [ ] Add reload overlay callback to the existing `if (import.meta.hot)` block in `css-imports.ts`:
  - Register `import.meta.hot.on('vite:beforeFullReload', callback)`
  - In the callback: create a `<div>` with `position: fixed; inset: 0; background: #16171a; z-index: 99998` and append it to `document.body` synchronously
  - This runs before Vite calls `location.reload()`, so the old page shows the dark overlay while the new page loads
- [ ] Test: start dev server, edit a CSS file, verify no flash occurs (dark-to-dark continuity via reload overlay)
- [ ] Test: manual reload (Cmd+R) produces no visible flash (handled by Phase 7c's startup overlay, not the reload overlay)

**Tests:**
- [ ] T9.1: `bunx tsc --noEmit` passes
- [ ] T9.2: `bun run build` succeeds (import.meta.hot block is tree-shaken in production)
- [ ] T9.3: Dev-mode CSS edit produces no visible flash (reload overlay + startup overlay continuity)
- [ ] T9.4: Dev-mode manual reload (Cmd+R) produces no visible flash (Phase 7c startup overlay)

**Checkpoint:**
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun run build` succeeds
- [ ] Dev server: editing a `.css` file produces no visible flash
- [ ] Dev server: manual reload (Cmd+R) produces no visible flash

---

#### Step 10: Update Implementation Strategy Document {#step-10}

**Depends on:** #step-9

**Commit:** `docs: add Phase 7d to tugways implementation strategy`

**References:** (#scope, #strategy, #non-goals)

**Artifacts:**
- Modified: `roadmap/tugways-implementation-strategy.md`

**Tasks:**
- [ ] Add Phase 7d entry to the phase list with description: "Glitch Reduction — strip Tailwind, add reload continuity overlay"
- [ ] Update the "What To Keep" table: change `globals.css` entry to note Tailwind removal, change `lib/utils.ts` entry to note simplification to plain `clsx`, change `components/ui/*.tsx` entry to note Tailwind-free semantic CSS
- [ ] Add a note to future phases (8b-8e) that new components should wrap Radix primitives directly instead of installing new shadcn components
- [ ] Add Phase 7d to the dependency graph (depends on 7c)

**Tests:**
- [ ] T10.1: Strategy document contains Phase 7d entry
- [ ] T10.2: Future-phase guidance mentions wrapping Radix primitives directly

**Checkpoint:**
- [ ] Strategy document accurately reflects the Phase 7d changes
- [ ] Future-phase guidance is clear about wrapping Radix directly

---

#### Step 11: Final Verification {#step-11}

**Depends on:** #step-9, #step-10

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Run complete build pipeline: `bunx tsc --noEmit && bun run build`
- [ ] Verify no Tailwind packages in `package.json`
- [ ] Verify no Tailwind imports or utility classes in source
- [ ] Verify component gallery renders all components correctly
- [ ] Verify CSS-edit reload produces no flash in dev mode
- [ ] Verify manual reload produces no flash in dev mode

**Tests:**
- [ ] T11.1: Full build pipeline passes (`bunx tsc --noEmit && bun run build`)
- [ ] T11.2: Tailwind removal audit grep returns zero matches (see checkpoint)
- [ ] T11.3: Component gallery renders all 13 components with visual parity
- [ ] T11.4: CSS-edit reload and manual reload produce no visible flash

**Checkpoint:**
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun run build` succeeds
- [ ] `grep -r "tailwindcss\|tailwind-merge\|@tailwindcss\|twMerge" tugdeck/ --include="*.ts" --include="*.tsx" --include="*.css" --include="*.json" | grep -v node_modules | grep -v bun.lock` returns zero matches
- [ ] Component gallery visual verification passes for all 13 components

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Tailwind fully removed from tugdeck; all CSS edits during development produce zero visual flash thanks to the reload continuity overlay working in concert with Phase 7c's startup overlay.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] No Tailwind packages in `package.json` (verified by `grep`)
- [ ] No Tailwind utility classes in any `components/ui/*.tsx` file (verified by `grep`)
- [ ] No `@import "tailwindcss"` or `@theme` block in `globals.css` (verified by inspection)
- [ ] `bunx tsc --noEmit` passes with zero errors
- [ ] `bun run build` succeeds
- [ ] CSS file edits in dev mode produce no visible flash
- [ ] Component gallery renders all 13 shadcn components with visual parity to pre-change appearance

**Acceptance tests:**
- [ ] Edit `tugdeck/styles/shadcn-base.css` in dev mode — no flash
- [ ] Edit `tugdeck/styles/chrome.css` in dev mode — no flash
- [ ] Edit `tugdeck/src/globals.css` in dev mode — no flash
- [ ] Cmd+R manual reload in dev mode — no flash
- [ ] All button variants render correctly in component gallery
- [ ] Dialog open/close animates correctly
- [ ] Dropdown menu open/close animates correctly
- [ ] Tooltip open/close animates correctly

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Remove CVA from button component, replace with simpler variant logic
- [ ] Consider removing `clsx` if `cn()` usage becomes trivial
- [ ] Phase 8b-8e: wrap Radix primitives directly instead of installing new shadcn components

| Checkpoint | Verification |
|------------|--------------|
| No Tailwind in dependencies | `grep "tailwind" tugdeck/package.json` returns zero matches |
| No Tailwind utilities in components | `grep -r "bg-primary\|text-foreground\|ring-offset" tugdeck/src/components/ui/` returns zero |
| TypeScript clean | `bunx tsc --noEmit` exit code 0 |
| Production build | `bun run build` exit code 0 |
| No CSS-edit flash | Manual dev-mode test: edit CSS file, observe seamless dark-to-dark transition |
