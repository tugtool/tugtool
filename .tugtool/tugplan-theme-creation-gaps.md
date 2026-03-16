<!-- tugplan-skeleton v2 -->

## Theme Creation Practical Gaps {#theme-creation-gaps}

**Purpose:** Close five practical gaps identified in the theme-generator-audit: rename signalVividity to signalIntensity, make theme name a first-class UI element, implement dynamic theme loading from disk, compact the role hue pickers, and harden auto-fix validation with convergence stress tests.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | theme-creation-gaps |
| Last updated | 2026-03-15 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The theme-generator-audit identified five practical gaps that block theme creation from being a usable end-to-end workflow. The generator can derive tokens and preview them, but: (1) the `signalVividity` recipe knob has a confusing name that does not match its function (it controls signal intensity), (2) theme naming is buried and not required for export, (3) generated themes cannot persist or load at app startup — they download as files but never wire into the running app, (4) the Role Hues section occupies excessive vertical space with seven full-width TugHueStrip instances, and (5) auto-fix validation coverage is limited to Brio dark and Brio light, with no convergence stress testing across diverse recipes.

#### Strategy {#strategy}

- **Gap 1 first** — pure rename, no behavioral change, zero risk. Gets the codebase consistent before any feature work touches the same files.
- **Gap 2 next** — small UI addition (prominent name field), low risk, establishes the name as required before export depends on it.
- **Gap 3 (dynamic loading)** — the largest feature: a new `generateResolvedCssExport()` function that emits resolved `oklch()` values, a `tugdeck/styles/themes/` directory, a "Save Theme" action that writes to disk via a Vite dev-mode middleware endpoint (using `/__themes/` prefix to avoid the existing `/api` proxy to tugcast), and `theme-provider.tsx` extended to discover and load saved themes via a separate dynamic-theme code path that does not widen the `ThemeName` literal union.
- **Gap 4 (compact pickers)** — replace full-width HueSelector strips in the Role Hues section with compact rows (role name + color chip); click opens a TugHueStrip in a popover/flyout for hue-only selection.
- **Gap 5 (auto-fix validation)** — investigate-first approach: run existing integration tests (the "T4.1" Brio dark and "T4.2" Brio light tests in `theme-derivation-engine.test.ts`), add convergence stress tests for multiple recipes, fix any issues found.
- Light theme hand-tuning is explicitly excluded from this phase.

#### Success Criteria (Measurable) {#success-criteria}

- Zero occurrences of `signalVividity` in the codebase; all references use `signalIntensity` (`grep -r signalVividity tugdeck/ --exclude-dir=node_modules` returns 0 results)
- Theme name text field is visible at the top of the generator card and export buttons are disabled when the name is empty
- A "Save Theme" button writes resolved oklch() CSS to `tugdeck/styles/themes/<name>.css`; a saved-theme selector dropdown in the generator card lists all saved themes and allows applying any of them
- Role Hues section renders 7 compact rows, each with a color chip; clicking a row opens a popover containing a TugHueStrip
- Convergence stress tests pass for at least 5 diverse recipes (varying mode, atmosphere, role hue combinations) with 0 unexpected failures after auto-fix

#### Scope {#scope}

1. Rename `signalVividity` to `signalIntensity` in ThemeRecipe type, engine, generator UI, and all tests
2. Prominent theme name text field at top of generator, required for export
3. Resolved oklch() CSS export function + disk persistence via Vite middleware + theme-provider discovery + minimal saved-theme selector dropdown
4. Compact role hue picker rows with popover-based TugHueStrip selection
5. Convergence stress tests for auto-fix across multiple recipes

#### Non-goals (Explicitly out of scope) {#non-goals}

- Light theme hand-tuning (deferred per audit)
- Full TugColorPicker with intensity/tone controls (deferred; compact pickers are hue-only)
- Theme deletion, rename, or full management UI (beyond save/load/select)
- Theme switching via Mac menu integration (existing brio-only path is not disrupted)

#### Dependencies / Prerequisites {#dependencies}

- Existing `deriveTheme()` engine and `ThemeRecipe` interface in `theme-derivation-engine.ts`
- Existing `TugHueStrip` component in `tug-hue-strip.tsx`
- Existing `injectThemeCSS()` / `removeThemeCSS()` in `theme-provider.tsx`
- Existing `TugPopupMenu` component for popover pattern reference
- Bun dev server (`vite.config.ts`) for API endpoint

#### Constraints {#constraints}

- Rules of Tugways: no `root.render()` after initial mount; appearance through CSS/DOM; `useSyncExternalStore` for external state [D40, D42]
- React 19.2.4 semantics
- `--tug-color()` notation requires PostCSS resolution at build time; saved theme files must use resolved `oklch()` values that work at runtime without PostCSS
- Bun runtime for server-side file I/O (not Node)

#### Assumptions {#assumptions}

- The Vite dev server can be extended with a middleware plugin for file writes using the `/__themes/` prefix (avoids the existing `/api` proxy to tugcast)
- The `tugdeck/styles/themes/` directory can be created and served as static assets
- `@radix-ui/react-popover` will be added as a new dependency for the compact hue picker flyout (consistent with the existing 11-package Radix footprint per [Q01])
- Existing auto-fix convergence loop (SAFETY_CAP=20) is sufficient for diverse recipes
- Dynamic themes use a separate code path in theme-provider; the `ThemeName` literal union type remains `"brio"` to preserve `Record<ThemeName,...>` safety in `themeCSSMap`, `CANVAS_COLORS`, and `canvasColorHex()`

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit anchors per skeleton v2 conventions. Decisions use d-prefixed anchors (e.g., d01-rename-signal), steps use step-N anchors, and specs use s-prefixed anchors. All anchors are kebab-case lowercase.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Popover component for compact hue picker (DECIDED) {#q01-popover-component}

**Question:** Should the compact hue picker flyout use TugPopupMenu's dropdown-menu infrastructure, a new `@radix-ui/react-popover` dependency, or a lightweight custom popover?

**Why it matters:** The project already has 11 `@radix-ui` packages installed (`react-checkbox`, `react-dialog`, `react-dropdown-menu`, `react-label`, `react-radio-group`, `react-scroll-area`, `react-select`, `react-slot`, `react-switch`, `react-tabs`, `react-tooltip`). Adding `@radix-ui/react-popover` is consistent with the existing dependency pattern.

**Options (if known):**
- (a) Adapt `@radix-ui/react-dropdown-menu` (via TugPopupMenu) to accept arbitrary children — reuses existing dependency but dropdown-menu semantics (menu items, keyboard nav) may fight the hue-strip content
- (b) Add `@radix-ui/react-popover` as a new dependency — clean popover semantics, small bundle addition, straightforward portal+positioning, consistent with existing 11-package Radix dependency pattern
- (c) Build a lightweight custom popover using portal + absolute positioning — no new dependencies, but must handle click-outside, focus management, and z-index manually

**Resolution:** DECIDED — Option (b): add `@radix-ui/react-popover`. The dropdown-menu semantics (menu items, keyboard navigation for lists of actions) are a poor fit for a hue-strip selector. Adding react-popover is consistent with the existing 11-package Radix footprint and provides clean popover semantics (portal, positioning, click-outside dismiss) out of the box.

#### [Q02] Bun API endpoint mechanism (DECIDED) {#q02-bun-api-endpoint}

**Question:** Should the save-to-disk endpoint be a Vite plugin middleware, a separate Bun server endpoint, or a fetch-based write through the existing control socket?

**Why it matters:** The approach determines how the theme generator communicates with the filesystem. The `/api` prefix is already proxied to tugcast in `vite.config.ts`, so using `/api/themes` would be intercepted by the tugcast backend.

**Options (if known):**
- Vite dev server middleware plugin (intercepts `/__themes/`)
- Standalone Bun HTTP handler alongside Vite
- WebSocket message through existing control socket

**Resolution:** DECIDED — Use Vite dev server middleware plugin with `/__themes/` prefix. This is dev-mode-only, requires no tugcast/Rust changes, and avoids the `/api` proxy conflict. Theme files are written to `tugdeck/styles/themes/` and served as static assets. See [D04].

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Rename breaks import/export compatibility | med | low | Validate JSON importer accepts both old and new field names | Import test fails |
| Resolved oklch() CSS differs from --tug-color() pipeline | med | med | Diff resolved values against build-time tokens for Brio; delta-E check | Visual drift reported |
| Popover z-index/positioning conflicts in card context | low | med | Use portal-based popover (Radix or custom), matching TugPopupMenu z-index pattern | Popover renders behind card frame |
| Auto-fix convergence fails for extreme recipes | med | med | Document known-unfixable combinations; add to exception list | Stress test failures |
| `/api` proxy intercepts theme requests | high | high | Use `/__themes/` prefix; resolved in [D04] | N/A (mitigated) |

**Risk R01: Backward compatibility of signalVividity rename** {#r01-rename-compat}

- **Risk:** Existing exported recipe JSON files use `signalVividity`; renaming to `signalIntensity` breaks import of old files.
- **Mitigation:** Add a migration shim in `validateRecipeJson()` that maps `signalVividity` to `signalIntensity` during import. Keep the shim for at least one release cycle.
- **Residual risk:** Users who have saved recipe files must re-export to get the new field name, but import works seamlessly.

**Risk R02: Resolved oklch() visual fidelity** {#r02-resolved-fidelity}

- **Risk:** The resolved oklch() values may render slightly differently than --tug-color() values processed through PostCSS, causing visual inconsistency between build-time and runtime themes.
- **Mitigation:** Add a delta-E comparison test that verifies resolved output matches Brio ground truth within acceptable tolerance (delta-E < 0.02, matching existing T-BRIO-MATCH threshold).
- **Residual risk:** Browser oklch() rendering may vary slightly across engines; this is acceptable for user-generated themes.

---

### Design Decisions {#design-decisions}

#### [D01] Rename signalVividity to signalIntensity (DECIDED) {#d01-rename-signal}

**Decision:** Rename the `signalVividity` field to `signalIntensity` across all TypeScript source, tests, and UI labels.

**Rationale:**
- The knob controls signal color intensity, not "vividness" — the name should match the function
- The engine comment already says "signalVividity=50 -> intensity=50 (canonical)" confirming the semantic mismatch

**Implications:**
- Pure text rename in 5 source/test files: `src/components/tugways/theme-derivation-engine.ts`, `src/components/tugways/cards/gallery-theme-generator-content.tsx`, `src/__tests__/theme-derivation-engine.test.ts`, `src/__tests__/gallery-theme-generator-content.test.tsx`, `src/__tests__/theme-export-import.test.tsx`
- Also rename `data-testid="gtg-slider-signal-vividity"` to `data-testid="gtg-slider-signal-intensity"` in the generator component and its test selectors
- Recipe JSON import validator must accept both `signalVividity` (legacy) and `signalIntensity` (current) per Risk R01

#### [D02] Theme name as required first-class UI element (DECIDED) {#d02-theme-name-ui}

**Decision:** Add a prominent text input for theme name at the top of the generator card, above all other controls. Export buttons are disabled when the name field is empty.

**Rationale:**
- The `recipeName` state already exists but has no visible, prominent input field
- A theme name is required for meaningful file export (filename derives from it) and for display in theme-provider's theme list

**Implications:**
- New `TugInput` text field at top of generator card (reuse existing `tug-input.tsx` component)
- Export CSS and Export Recipe JSON buttons get `disabled` prop tied to `recipeName.trim() === ""`
- The name field syncs with `recipeName` state that already feeds into `generateCssExport()`

#### [D03] Resolved oklch() CSS for saved themes (DECIDED) {#d03-resolved-css}

**Decision:** Saved theme CSS files use resolved `oklch()` values from `ThemeOutput.resolved`, not `--tug-color()` notation. A new `generateResolvedCssExport()` function produces this format.

**Rationale:**
- `--tug-color()` is a custom PostCSS function resolved at build time; runtime-injected CSS cannot use it
- `ThemeOutput.resolved` already contains the OKLCH values needed for direct CSS output
- The existing `injectThemeCSS()` infrastructure can inject any valid CSS string

**Implications:**
- New `generateResolvedCssExport()` function placed in `src/components/tugways/theme-derivation-engine.ts` alongside `ThemeOutput` (not in the 1460-line UI component file — it is a pure data function with no UI coupling). The existing `generateCssExport()` in the UI file continues to exist for the download-as-file use case.
- Saved files contain `body { --tug-base-...: oklch(L C h / alpha); }` declarations
- Token names remain `--tug-base-*` so they override the same custom properties as build-time themes

#### [D04] Disk persistence via Vite dev middleware (DECIDED) {#d04-disk-persistence}

**Decision:** Add a Vite dev server middleware plugin that handles `/__themes/` routes for saving and listing theme CSS files in `tugdeck/styles/themes/`. Theme-provider discovers saved themes by fetching from this endpoint. The `/__themes/` prefix avoids the existing `/api` proxy to tugcast in `vite.config.ts`.

**Rationale:**
- Browser cannot write to filesystem directly; a server endpoint is required
- The `/api` prefix is already proxied to tugcast (`vite.config.ts` line 80: `"/api": { target: ... }`); using it would route theme requests to the Rust backend
- Vite middleware is dev-mode-only and requires no tugcast/Rust changes
- Saving to a known directory allows themes to persist across dev server restarts

**Implications:**
- New `tugdeck/styles/themes/` directory (gitignored for user-generated themes)
- Vite plugin middleware: `POST /__themes/save` with `{ name, css, recipe }` body writes both `<name>.css` and `<name>-recipe.json`; `GET /__themes/list` returns available theme names
- Theme CSS and recipe JSON files served directly as `/styles/themes/<name>.css` and `/styles/themes/<name>-recipe.json` via Vite's static asset serving
- Theme-provider extended with `loadSavedThemes()` that fetches theme list from `/__themes/list`

#### [D05] Compact role hue picker with popover (DECIDED) {#d05-compact-role-picker}

**Decision:** Replace the 7 full-width `HueSelector` components in the Role Hues section with compact rows showing role name + current color chip. Clicking a row opens a popover containing a `TugHueStrip` for hue-only selection.

**Rationale:**
- Seven full-width hue strips dominate the generator card, pushing other controls far down
- Users typically set role hues once; compact rows with on-demand expansion are more efficient
- Hue-only selection is sufficient for now; full intensity/tone picker is deferred

**Implications:**
- New `CompactHuePicker` sub-component within gallery-theme-generator-content.tsx
- Flyout container uses `@radix-ui/react-popover` (new dependency, per [Q01] resolution). This is the 12th Radix package, consistent with the existing pattern.
- Color chip renders the current hue at canonical L/C values using `tugColor()`
- The popover closes on hue selection (click-to-select, auto-dismiss)

#### [D07] Keep ThemeName as literal union; separate dynamic theme code path (DECIDED) {#d07-themename-safety}

**Decision:** Keep `ThemeName` as the literal union type `"brio"` (and future built-in themes). Dynamic/user-generated themes are handled through a separate code path in `setTheme()` that bypasses `themeCSSMap`, `CANVAS_COLORS`, and `sendCanvasColor()` lookups.

**Rationale:**
- Widening `ThemeName` from `"brio"` to `"brio" | string` collapses to `string`, breaking `Record<ThemeName, ...>` patterns in `themeCSSMap` (theme-provider.tsx), `CANVAS_COLORS` (canvas-color.ts), and `canvasColorHex()` (canvas-color.ts)
- `deck-manager.ts` and `main.tsx` also import `ThemeName` and would lose type safety
- A separate code path for dynamic themes is cleaner: `setTheme()` checks if the name is a built-in `ThemeName`; if not, it fetches the CSS from `/__themes/` and injects it directly

**Implications:**
- New `useState<string | null>(null)` for `dynamicThemeName` alongside the existing `useState<ThemeName>` for built-in themes. This tracks the active dynamic theme name without widening `ThemeName`.
- Extend `ThemeContextValue` interface to include `dynamicThemeName: string | null`, `setDynamicTheme: (name: string) => void`, and `revertToBuiltIn: () => void`. Consumers can read `dynamicThemeName` to know if a dynamic theme is active.
- `setDynamicTheme(name: string)` fetches CSS from `/styles/themes/<name>.css`, calls `injectThemeCSS(name, css)` directly (CSS injection is not React state — it is DOM manipulation per Rules of Tugways [D08, D09]), then sets `dynamicThemeName` state and persists to `localStorage` under the key `td-dynamic-theme`. It skips `themeCSSMap` lookup, `sendCanvasColor()`, and `putTheme()`.
- `revertToBuiltIn()` calls `removeThemeCSS()`, sets `dynamicThemeName` to `null`, clears `td-dynamic-theme` from localStorage.
- On init, theme-provider checks `td-dynamic-theme` first; if present, fetches and injects that theme's CSS. This ensures dynamic themes survive page reloads.
- `canvas-color.ts` and `deck-manager.ts` remain unchanged (no `ThemeName` type modifications needed)

#### [D08] Minimal saved-theme selector in generator card (DECIDED) {#d08-theme-selector}

**Decision:** Add a minimal dropdown in the generator card that lists saved themes from `loadSavedThemes()` and allows selecting one to apply. Selecting a saved theme loads both the CSS (applied via `setDynamicTheme()`) and the recipe JSON (loaded into generator state so the user can inspect and modify the recipe parameters). Without this selector, the `loadSavedThemes()` function and `GET /__themes/list` endpoint would be dead code.

**Rationale:**
- The save infrastructure (Step 6) builds `loadSavedThemes()` and `GET /__themes/list`, but without a UI to select among saved themes, users can only auto-load the last-saved theme via `td-dynamic-theme` localStorage
- Loading both CSS and recipe provides a complete round-trip: save a theme, select it later, see its recipe parameters, modify and re-save
- A minimal dropdown completes the save/load/select cycle without requiring a full theme management UI

**Implications:**
- New dropdown in or near the ExportImportPanel section of the generator card
- Populated via `loadSavedThemes()` on mount and refreshed after each save
- Selecting a theme: (1) calls `setDynamicTheme(name)` to inject CSS, (2) fetches `/styles/themes/<name>-recipe.json`, parses it, and calls `onRecipeImported()` to load the recipe into generator state
- Selecting "Brio (default)" reverts to built-in theme (`revertToBuiltIn()`) and resets generator to default recipe
- Uses existing `@radix-ui/react-select` (already installed) or a simple native `<select>`

#### [D06] Investigate-first approach for auto-fix validation (DECIDED) {#d06-autofix-investigation}

**Decision:** Run existing T4.1/T4.2 tests, add convergence stress tests for at least 5 diverse recipes, and fix any issues found. Do not pre-assume what is broken.

**Rationale:**
- The audit flagged auto-fix as a gap but did not identify specific failures
- Adding stress tests across diverse recipes will surface real issues (if any) rather than guessing
- Existing T4.1 (Brio dark) and T4.2 (Brio light) already have exception lists for known structural constraints

**Implications:**
- New test cases in `theme-derivation-engine.test.ts` covering at least 5 recipe variations
- Exception lists may need expansion for recipes with extreme parameters
- Any engine fixes discovered are addressed within this phase

---

### Specification {#specification}

#### Inputs and Outputs {#inputs-outputs}

**Spec S01: ThemeRecipe field rename** {#s01-recipe-rename}

The `ThemeRecipe` interface field `signalVividity` is renamed to `signalIntensity`. The type, range (0-100), and default (50) remain unchanged.

```typescript
// Before
signalVividity?: number; // 0-100, default 50

// After
signalIntensity?: number; // 0-100, default 50
```

**Spec S02: Resolved CSS export format** {#s02-resolved-css-format}

The `generateResolvedCssExport()` function produces CSS using resolved `oklch()` values:

```css
/**
 * @theme-name <name>
 * @theme-description Generated theme (dark mode, atmosphere: slate, text: warm-gray)
 * @generated 2026-03-15
 * @recipe-hash <hash>
 *
 * Generated by Theme Generator. Contains resolved oklch() overrides for --tug-base-* tokens.
 */
body {
  --tug-base-canvas: oklch(0.180 0.010 260.0);
  --tug-base-surface-default: oklch(0.220 0.012 260.0);
  /* ... all chromatic tokens ... */
}
```

Only tokens present in `ThemeOutput.resolved` are included (structural/invariant tokens like spacing are omitted).

**Spec S03: Theme save/list API (Vite middleware, /__themes/ prefix)** {#s03-theme-save-api}

The `/__themes/` prefix is used to avoid the existing `/api` proxy to tugcast in `vite.config.ts`. Each saved theme consists of two files: `<name>.css` (resolved oklch() overrides) and `<name>-recipe.json` (ThemeRecipe for reloading into generator state).

```
POST /__themes/save
Content-Type: application/json

{ "name": "my-theme", "css": "<resolved CSS string>", "recipe": "<JSON string>" }

Response 200: { "path": "styles/themes/my-theme.css" }
Response 400: { "error": "..." }
```

The middleware writes two files: `styles/themes/my-theme.css` and `styles/themes/my-theme-recipe.json`.

```
GET /__themes/list
Response 200: { "themes": ["my-theme", "another-theme"] }
```

Theme names are derived from `.css` filenames (ignoring `-recipe.json` files).

Theme CSS and recipe files are served as static assets via Vite's built-in static serving:

```
GET /styles/themes/my-theme.css
Response 200: <CSS file contents>

GET /styles/themes/my-theme-recipe.json
Response 200: <ThemeRecipe JSON>
```

**Spec S05: Theme name UI requirements** {#s05-theme-name-ui}

- A `TugInput` text field labeled "Theme Name" renders at the very top of the generator card, above the Atmosphere Hue section
- The field is bound to the existing `recipeName` state
- Export CSS and Export Recipe JSON buttons are `disabled` when `recipeName.trim() === ""`
- The Save Theme button (Step 6) is also disabled when the name is empty
- Importing a recipe JSON updates the name field to the imported recipe's `name` value

**Spec S06: Saved-theme selector** {#s06-saved-theme-selector}

A minimal dropdown in the generator card (in or near the ExportImportPanel section) shows available saved themes fetched via `loadSavedThemes()`. Selecting a theme from the dropdown:
1. Calls `setDynamicTheme(name)` to inject the saved CSS
2. Fetches `/styles/themes/<name>-recipe.json`, parses it as `ThemeRecipe`, and calls `onRecipeImported()` to load the recipe parameters into the generator state

The dropdown includes a "Brio (default)" entry that reverts to the built-in theme and resets generator state to the default recipe. The dropdown is populated on mount and refreshed after each successful save. If no saved themes exist, the dropdown shows only "Brio (default)".

**Spec S04: Compact role hue picker layout** {#s04-compact-picker-layout}

Each compact role row renders:
- Role label (e.g., "Accent") — left-aligned, fixed width
- Color chip — 20x20px square showing the current hue at canonical L/C, rounded corners
- Current hue name — text label showing selected hue family name

Clicking the row opens a Radix Popover below/beside the chip containing a `TugHueStrip`. The TugHueStrip inside the popover needs width constraining: the strip renders 48 swatches at 18px + 2px gap each (~960px unconstrained). The popover should be constrained to the card width (or a reasonable max-width such as 360px) with `flex-wrap: wrap` on the strip so swatches flow into multiple rows. Add the following CSS to the popover's strip container:

```css
.compact-hue-popover .tug-hue-strip {
  max-width: 360px;
  flex-wrap: wrap;
  padding-bottom: 8px; /* reduced from 64px since rotated labels are omitted in compact mode */
}
```

Consider hiding the rotated hue name labels inside the popover (they add 64px of bottom padding and overlap in a wrapped layout). The selected hue name is already shown in the compact row itself.

Selecting a hue in the strip updates the chip, fires the `onSelect` callback, and closes the popover.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/styles/themes/` | Directory for saved theme CSS files (gitignored) |
| `tugdeck/styles/themes/.gitkeep` | Placeholder to create the directory in git |
| `src/__tests__/theme-middleware.test.ts` | Unit tests for Vite theme middleware (mocked fs) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `signalIntensity` | field | `src/components/tugways/theme-derivation-engine.ts` | Replaces `signalVividity` in ThemeRecipe |
| `generateResolvedCssExport()` | fn | `src/components/tugways/theme-derivation-engine.ts` | Pure data fn: resolved oklch() CSS from ThemeOutput |
| `CompactHuePicker` | component | `src/components/tugways/cards/gallery-theme-generator-content.tsx` | Compact row + popover for role hue selection |
| `loadSavedThemes()` | fn | `src/contexts/theme-provider.tsx` | Discovers and returns saved theme names from `/__themes/list` |
| `dynamicThemeName` | state | `src/contexts/theme-provider.tsx` | `useState<string \| null>(null)` tracking active dynamic theme |
| `setDynamicTheme()` | fn | `src/contexts/theme-provider.tsx` | Fetches CSS, injects it, updates dynamicThemeName state, persists to localStorage |
| `revertToBuiltIn()` | fn | `src/contexts/theme-provider.tsx` | Removes override CSS, clears dynamicThemeName state and localStorage |
| `themeMiddleware()` | fn | `vite.config.ts` (plugin) | Vite dev middleware handling `/__themes/save` and `/__themes/list` |
| `SavedThemeSelector` | component | `src/components/tugways/cards/gallery-theme-generator-content.tsx` | Dropdown listing saved themes; calls `setDynamicTheme()` on selection |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Verify rename completeness, resolved CSS format, recipe validation shim | Steps 1-3 |
| **Integration** | End-to-end theme save/load cycle, compact picker interaction | Steps 5-7 |
| **Convergence stress** | Auto-fix pipeline across diverse recipes | Step 8 |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Rename signalVividity to signalIntensity in engine and type {#step-1}

**Commit:** `refactor: rename signalVividity to signalIntensity in ThemeRecipe and engine`

**References:** [D01] Rename signalVividity to signalIntensity, Spec S01, (#s01-recipe-rename, #d01-rename-signal)

**Artifacts:**
- Modified `src/components/tugways/theme-derivation-engine.ts`: ThemeRecipe interface field, all internal references, EXAMPLE_RECIPES, deriveTheme() body
- Modified `src/__tests__/theme-derivation-engine.test.ts`: all test references to the field

**Tasks:**
- [ ] Rename `signalVividity` to `signalIntensity` in the `ThemeRecipe` interface in `src/components/tugways/theme-derivation-engine.ts`
- [ ] Update the module doc comment from `signalVividity` to `signalIntensity`
- [ ] Rename all internal references in `deriveTheme()` body
- [ ] Update `EXAMPLE_RECIPES` if any recipe sets `signalVividity` explicitly
- [ ] Update all test references in `src/__tests__/theme-derivation-engine.test.ts`

**Tests:**
- [ ] All existing tests in `theme-derivation-engine.test.ts` pass with the renamed field
- [ ] TypeScript compilation succeeds with zero errors

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/theme-derivation-engine.test.ts`

---

#### Step 2: Rename signalVividity in generator UI and remaining tests {#step-2}

**Depends on:** #step-1

**Commit:** `refactor: rename signalVividity to signalIntensity in generator UI and tests`

**References:** [D01] Rename signalVividity to signalIntensity, Spec S01, Risk R01, (#s01-recipe-rename, #d01-rename-signal, #r01-rename-compat)

**Artifacts:**
- Modified `src/components/tugways/cards/gallery-theme-generator-content.tsx`: state variable, slider label, data-testid, all `signalVividity` references
- Modified `src/__tests__/gallery-theme-generator-content.test.tsx`: all test references and testid selectors
- Modified `src/__tests__/theme-export-import.test.tsx`: any recipe fixtures using the old name

**Tasks:**
- [ ] Rename `signalVividity` state variable and setter in the generator component (`src/components/tugways/cards/gallery-theme-generator-content.tsx`)
- [ ] Update slider label from "Signal Vividity" to "Signal Intensity" (or whatever the current label is)
- [ ] Rename `data-testid="gtg-slider-signal-vividity"` to `data-testid="gtg-slider-signal-intensity"` in the MoodSlider instance
- [ ] Update the matching test selector `[data-testid='gtg-slider-signal-vividity']` in `src/__tests__/gallery-theme-generator-content.test.tsx`
- [ ] Update all other `signalVividity` references in `src/__tests__/gallery-theme-generator-content.test.tsx`
- [ ] Update `src/__tests__/theme-export-import.test.tsx` references
- [ ] Update the `validateRecipeJson()` optional numeric field validation loop: change `["surfaceContrast", "signalVividity", "warmth"]` to `["surfaceContrast", "signalIntensity", "warmth"]` so the validator checks the renamed field
- [ ] Add legacy migration shim to `validateRecipeJson()` BEFORE the validation loop: check if the parsed object has `signalVividity` but not `signalIntensity`; if so, copy the value: `obj.signalIntensity = obj.signalVividity; delete obj.signalVividity;` — this allows old recipe JSON files to import seamlessly per Risk R01. The migration must run before the field validation loop so the renamed field is present for validation.
- [ ] Add a dedicated test for the migration shim: import a recipe JSON containing `signalVividity: 75` and verify it is accepted and the resulting recipe has `signalIntensity: 75`

**Tests:**
- [ ] All generator tests pass with renamed state, label, and testid
- [ ] Import a JSON recipe with legacy `signalVividity` field — imports successfully with value mapped to `signalIntensity`
- [ ] TypeScript compilation succeeds

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/gallery-theme-generator-content.test.tsx`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/theme-export-import.test.tsx`

---

#### Step 3: Rename integration checkpoint {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `N/A (verification only)`

**References:** [D01] Rename signalVividity to signalIntensity, (#success-criteria)

**Tasks:**
- [ ] Verify zero occurrences of `signalVividity` in the entire `tugdeck/` directory (excluding `node_modules/`) — covers `src/`, `scripts/`, `styles/`, and any other subdirectories
- [ ] Run full test suite to confirm no regressions

**Tests:**
- [ ] Full test suite passes (all existing tests, including renamed fields and migration shim)

**Checkpoint:**
- [ ] `grep -r signalVividity /Users/kocienda/Mounts/u/src/tugtool/tugdeck/ --exclude-dir=node_modules` returns 0 results
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test` (full suite)

---

#### Step 4: Theme name as first-class UI element {#step-4}

**Depends on:** #step-3

**Commit:** `feat: add prominent theme name text field to generator, required for export`

**References:** [D02] Theme name as required first-class UI element, Spec S05, (#d02-theme-name-ui, #s05-theme-name-ui, #success-criteria)

**Artifacts:**
- Modified `src/components/tugways/cards/gallery-theme-generator-content.tsx`: new TugInput at top of generator, export button disabled logic
- Modified `src/components/tugways/cards/gallery-theme-generator-content.css`: styles for prominent name field

**Tasks:**
- [ ] Add a `TugInput` text field at the very top of the generator card (above Atmosphere Hue), bound to `recipeName` / `setRecipeName` state
- [ ] Style the input prominently: full width, larger font or distinct section header "Theme Name"
- [ ] Add `disabled={recipeName.trim() === ""}` to the Export CSS and Export Recipe JSON buttons
- [ ] Ensure the name field value is preserved when importing a recipe (existing `setRecipeName` from import flow)

**Tests:**
- [ ] Generator renders with a visible text input for theme name
- [ ] Export CSS button is disabled when name is empty
- [ ] Export CSS button is enabled when name has content
- [ ] Importing a recipe updates the name field

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/gallery-theme-generator-content.test.tsx`

---

#### Step 5: Resolved oklch() CSS export function {#step-5}

**Depends on:** #step-3

**Commit:** `feat: add generateResolvedCssExport() for runtime theme CSS`

**References:** [D03] Resolved oklch() CSS for saved themes, Spec S02, Risk R02, (#s02-resolved-css-format, #d03-resolved-css, #r02-resolved-fidelity)

**Artifacts:**
- Modified `src/components/tugways/theme-derivation-engine.ts`: new `generateResolvedCssExport()` function (pure data function, no UI coupling — placed alongside `ThemeOutput` and `ThemeRecipe`)
- Modified `src/__tests__/theme-derivation-engine.test.ts`: unit test for resolved export format

**Tasks:**
- [ ] Implement `generateResolvedCssExport(output: ThemeOutput, recipe: ThemeRecipe): string` in `src/components/tugways/theme-derivation-engine.ts` — iterates `output.resolved`, converts each entry to `oklch(L C h / alpha)` CSS, and wraps in `body { ... }`
- [ ] Include the same header comment structure as `generateCssExport()` but noting "resolved oklch() overrides"
- [ ] Export the function from `theme-derivation-engine.ts`
- [ ] Add unit test in `src/__tests__/theme-derivation-engine.test.ts` verifying the output format: correct CSS structure, oklch() values, token names match resolved map keys

**Tests:**
- [ ] `generateResolvedCssExport()` produces valid CSS with `oklch()` values for all resolved tokens
- [ ] Output token names match `--tug-base-*` pattern
- [ ] Delta-E comparison: for Brio recipe, resolved CSS values match build-time Brio tokens within delta-E < 0.02

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/theme-derivation-engine.test.ts`

---

#### Step 6: Theme save/load API endpoint and theme-provider integration {#step-6}

**Depends on:** #step-5

**Commit:** `feat: add theme save/load via Vite middleware and extend theme-provider for dynamic themes`

**References:** [D04] Disk persistence via Vite dev middleware, [D07] Keep ThemeName as literal union, Spec S03, [Q02] Bun API endpoint mechanism, (#s03-theme-save-api, #d04-disk-persistence, #d07-themename-safety, #q02-bun-api-endpoint)

**Artifacts:**
- New `tugdeck/styles/themes/` directory with `.gitkeep`
- Modified `vite.config.ts`: new Vite plugin middleware handling `/__themes/save` (POST) and `/__themes/list` (GET)
- Modified `src/contexts/theme-provider.tsx`: new `loadSavedThemes()` and `setDynamicTheme()` functions; `ThemeName` type remains `"brio"` unchanged
- `src/canvas-color.ts` — no changes needed (dynamic themes bypass `canvasColorHex()`)
- `src/deck-manager.ts` — no changes needed (dynamic themes bypass built-in theme path)
- `src/main.tsx` — no changes needed (initial theme is always a built-in `ThemeName`)
- Modified `src/components/tugways/cards/gallery-theme-generator-content.tsx`: "Save Theme" button added to ExportImportPanel
- New `src/__tests__/theme-middleware.test.ts`: unit tests for middleware handler with mocked fs

**Tasks:**
- [ ] Create `tugdeck/styles/themes/` directory with `.gitkeep`
- [ ] Implement Vite dev middleware plugin in `vite.config.ts`: `POST /__themes/save` writes both CSS and recipe JSON to `styles/themes/<name>.css` and `styles/themes/<name>-recipe.json`; `GET /__themes/list` reads the directory and returns theme names (derived from `.css` files)
- [ ] Keep `ThemeName` type as `"brio"` — do NOT widen to `string` (per [D07])
- [ ] Add `useState<string | null>(null)` for `dynamicThemeName` in TugThemeProvider alongside the existing `useState<ThemeName>` — this tracks the active dynamic theme name without widening `ThemeName`
- [ ] Extend `ThemeContextValue` interface to include `dynamicThemeName: string | null`, `setDynamicTheme: (name: string) => void`, and `revertToBuiltIn: () => void`
- [ ] Add `loadSavedThemes()` function in `src/contexts/theme-provider.tsx` that calls `GET /__themes/list` and returns available dynamic theme names as `string[]`
- [ ] Implement `setDynamicTheme(name: string)`: fetch CSS from `/styles/themes/<name>.css`, call `injectThemeCSS(name, css)` (DOM manipulation, not React state per Rules of Tugways [D08, D09]), then call `setDynamicThemeName(name)` to update React state, persist to `localStorage` under `td-dynamic-theme` key, and skip `themeCSSMap`/`sendCanvasColor()`/`putTheme()` lookups
- [ ] Implement `revertToBuiltIn()`: call `removeThemeCSS()`, set `dynamicThemeName` to `null`, clear `td-dynamic-theme` from localStorage
- [ ] On TugThemeProvider init, check `localStorage.getItem("td-dynamic-theme")`; if present, call `setDynamicTheme()` to re-apply the saved dynamic theme (this runs before checking `td-theme` for built-in themes)
- [ ] Add "Save Theme" button to ExportImportPanel that calls `POST /__themes/save` with `{ name: recipeName, css: generateResolvedCssExport(output, recipe), recipe: JSON.stringify(recipe) }`; button is disabled when `recipeName.trim() === ""`

**Tests:**

Middleware tests use a separate test file `src/__tests__/theme-middleware.test.ts` with unit tests against the middleware handler function directly (mocked `fs.writeFileSync`/`fs.readdirSync`, no running Vite server needed). Theme-provider tests are integration tests in `src/__tests__/theme-export-import.test.tsx` with mocked `fetch`.

- [ ] Middleware unit: `POST /__themes/save` with valid `{ name, css, recipe }` writes both `<name>.css` and `<name>-recipe.json` via `fs.writeFileSync`
- [ ] Middleware unit: `POST /__themes/save` with empty name returns 400
- [ ] Middleware unit: `GET /__themes/list` reads directory and returns theme name array
- [ ] Provider integration: `setDynamicTheme()` fetches CSS and calls `injectThemeCSS()` without touching `themeCSSMap` or `sendCanvasColor()`
- [ ] Provider integration: `setDynamicTheme()` persists dynamic theme name to `localStorage` under `td-dynamic-theme` key
- [ ] Provider integration: on init, theme-provider checks `td-dynamic-theme` localStorage and re-applies saved dynamic theme
- [ ] TypeScript compilation succeeds with `ThemeName` still as literal `"brio"`

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/theme-middleware.test.ts`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/theme-export-import.test.tsx`

---

#### Step 7: Compact role hue pickers with popover {#step-7}

**Depends on:** #step-3

**Commit:** `feat: replace full-width role hue selectors with compact picker rows`

**References:** [D05] Compact role hue picker with popover, Spec S04, [Q01] Popover component, (#s04-compact-picker-layout, #d05-compact-role-picker, #q01-popover-component)

**Artifacts:**
- Modified `src/components/tugways/cards/gallery-theme-generator-content.tsx`: new `CompactHuePicker` component replacing `HueSelector` usage in Role Hues section
- Modified `src/components/tugways/cards/gallery-theme-generator-content.css`: styles for compact row layout and popover

**Tasks:**
- [ ] Create `CompactHuePicker` component: renders a row with role label, color chip (20x20px swatch using `tugColor()` at canonical L/C), and current hue name text
- [ ] Add `@radix-ui/react-popover` dependency: `bun add @radix-ui/react-popover` (per [Q01] resolution)
- [ ] Wire click handler on the row to open the popover containing `TugHueStrip`
- [ ] On hue selection in the strip, update the parent state via `onSelect` callback and close the popover
- [ ] Replace the 7 `HueSelector` instances in the `gtg-role-hues` container with 7 `CompactHuePicker` instances
- [ ] Add CSS for the compact row layout: `display: flex; align-items: center; gap: 8px;` per row
- [ ] Constrain the popover's TugHueStrip width: add `max-width: 360px; flex-wrap: wrap;` so the 48 swatches flow into multiple rows within the popover. Reduce bottom padding (the default 64px accommodates rotated labels which should be hidden in the popover context).
- [ ] Preserve existing `data-testid` attributes for each role hue picker

**Tests:**
- [ ] Each compact row renders with the correct role label and color chip
- [ ] Clicking a row opens the popover with a TugHueStrip
- [ ] Selecting a hue updates the chip color and closes the popover
- [ ] Existing role hue test selectors (`gtg-role-hue-accent`, etc.) still work

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/gallery-theme-generator-content.test.tsx`

---

#### Step 8: Auto-fix convergence stress tests {#step-8}

**Depends on:** #step-3

**Commit:** `test: add convergence stress tests for auto-fix across diverse recipes`

**References:** [D06] Investigate-first approach for auto-fix validation, (#d06-autofix-investigation, #success-criteria)

**Artifacts:**
- Modified `src/__tests__/theme-derivation-engine.test.ts`: new convergence stress test suite

**Tasks:**
- [ ] Run existing baseline tests to confirm they pass: the test labeled "T4.1: deriveTheme(brio) -> validateThemeContrast -> 0 unexpected body-text failures after autoAdjustContrast" and "T4.2: deriveTheme(brio-light) -> 0 unexpected body-text failures after autoAdjustContrast" in `src/__tests__/theme-derivation-engine.test.ts` (these are the integration tests in the `describe("derivation-engine integration")` block)
- [ ] Define at least 5 diverse test recipes: vary mode (dark/light), atmosphere hue (warm/cool/neutral), role hues (complementary/analogous/clashing), surfaceContrast (20/50/80), signalIntensity (20/50/80)
- [ ] For each recipe: run `deriveTheme()` -> `validateThemeContrast()` -> `autoAdjustContrast()` pipeline
- [ ] Assert 0 unexpected body-text failures after auto-fix (allow documented exceptions)
- [ ] If any recipe reveals new failures, document them and fix the engine or add to exception list

**Tests:**
- [ ] T4.3-stress: Warm atmosphere, cool roles, dark mode, high contrast — 0 unexpected failures
- [ ] T4.4-stress: Cool atmosphere, warm roles, light mode, low contrast — 0 unexpected failures
- [ ] T4.5-stress: Neutral atmosphere, complementary roles, dark mode, default settings — 0 unexpected failures
- [ ] T4.6-stress: Extreme signalIntensity (90), dark mode — 0 unexpected failures
- [ ] T4.7-stress: Extreme low signalIntensity (10), light mode — 0 unexpected failures

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/theme-derivation-engine.test.ts`

---

#### Step 9: Saved-theme selector dropdown {#step-9}

**Depends on:** #step-6

**Commit:** `feat: add saved-theme selector dropdown in generator card`

**References:** [D08] Minimal saved-theme selector, [D07] Keep ThemeName as literal union, Spec S06, (#s06-saved-theme-selector, #d08-theme-selector, #d07-themename-safety)

**Artifacts:**
- Modified `src/components/tugways/cards/gallery-theme-generator-content.tsx`: new saved-theme dropdown in or near ExportImportPanel
- Modified `src/components/tugways/cards/gallery-theme-generator-content.css`: styles for the dropdown

**Tasks:**
- [ ] Add a dropdown (using `@radix-ui/react-select` or native `<select>`) in the ExportImportPanel section that lists available saved themes
- [ ] Populate the dropdown via `loadSavedThemes()` on component mount; refresh the list after each successful save
- [ ] Include a "Brio (default)" entry that reverts to the built-in theme (calls `revertToBuiltIn()` from theme-provider context and resets generator to default recipe)
- [ ] Selecting a saved theme: (1) calls `setDynamicTheme(name)` to inject CSS, (2) fetches `/styles/themes/<name>-recipe.json`, parses it as `ThemeRecipe`, and calls `onRecipeImported()` to load the recipe parameters into generator state
- [ ] If no saved themes exist, the dropdown shows only "Brio (default)"

**Tests:**
- [ ] Dropdown renders with "Brio (default)" when no saved themes exist
- [ ] After saving a theme, the dropdown includes the newly saved theme name
- [ ] Selecting a saved theme applies CSS and loads recipe into generator state
- [ ] Selecting "Brio (default)" reverts to Brio, clears dynamic theme localStorage, and resets recipe

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test src/__tests__/gallery-theme-generator-content.test.tsx`

---

#### Step 10: Final integration checkpoint {#step-10}

**Depends on:** #step-4, #step-6, #step-7, #step-8, #step-9

**Commit:** `N/A (verification only)`

**References:** [D01] Rename, [D02] Theme name UI, [D03] Resolved CSS, [D04] Disk persistence via Vite dev middleware, [D05] Compact pickers, [D06] Auto-fix validation, [D07] ThemeName type safety, [D08] Saved-theme selector, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all five gaps are addressed end-to-end
- [ ] Run full test suite
- [ ] Verify the generator card UI: name field at top, compact role pickers, save button works
- [ ] Verify `ThemeName` type is still the literal `"brio"` (not widened to `string`)

**Tests:**
- [ ] Full test suite passes (all unit, integration, and convergence stress tests)

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test` (full suite passes)
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bunx tsc --noEmit` (zero type errors)
- [ ] `grep -r signalVividity /Users/kocienda/Mounts/u/src/tugtool/tugdeck/ --exclude-dir=node_modules` returns 0 results

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Theme generator closes five practical gaps: consistent naming (signalIntensity), required theme name, persistent theme save/load, compact role pickers, and validated auto-fix convergence.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Zero `signalVividity` occurrences in `tugdeck/` excluding `node_modules/` (verified by grep)
- [ ] Theme name text field visible at top of generator; export disabled when empty
- [ ] "Save Theme" writes resolved oklch() CSS to `styles/themes/`; saved-theme selector dropdown lists saved themes and applies them on selection
- [ ] Role Hues section uses compact rows with popover-based hue selection
- [ ] Convergence stress tests pass for 5+ diverse recipes
- [ ] Full test suite passes: `bun test`
- [ ] TypeScript clean: `bunx tsc --noEmit` returns 0 errors

**Acceptance tests:**
- [ ] Rename: grep confirms zero `signalVividity` references
- [ ] Theme name: export button disabled with empty name, enabled with non-empty name
- [ ] Save/load/select: save a theme, it appears in the saved-theme selector dropdown; select it to apply; reload page and dynamic theme is re-applied from `td-dynamic-theme` localStorage; select "Brio (default)" to revert
- [ ] Compact pickers: clicking a role row opens hue strip popover, selection updates chip
- [ ] Stress tests: 5 diverse recipes pass auto-fix pipeline with 0 unexpected failures

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Light theme hand-tuning and light-mode engine calibration
- [ ] Full TugColorPicker with intensity/tone controls for role hues
- [ ] Full theme management UI (rename, delete, duplicate saved themes)
- [ ] Theme switching via Mac menu integration for dynamic themes
- [ ] Theme gallery/preview card showing multiple themes side-by-side

| Checkpoint | Verification |
|------------|--------------|
| Rename complete | `grep -r signalVividity tugdeck/ --exclude-dir=node_modules` returns 0 |
| Full suite green | `bun test` exits 0 |
| Type-safe | `bunx tsc --noEmit` exits 0 |
