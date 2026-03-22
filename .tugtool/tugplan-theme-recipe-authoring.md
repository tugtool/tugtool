<!-- tugplan-skeleton v2 -->

## Theme System Recipe Authoring Refactor {#theme-recipe-authoring}

**Purpose:** Transform the theme system so themes are JSON data files (not TypeScript constants), stored in two directories (shipped in repo, authored in user home), with a Mac-style generator card (New/Open/auto-save/Apply) and dynamic app menu population.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | theme-recipe-authoring |
| Last updated | 2026-03-22 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The current theme system conflates three distinct concepts: recipes (code that expands color choices into derivation formulas), themes (color choice data), and theme output (generated CSS tokens). Themes are hardcoded as TypeScript constants in `EXAMPLE_RECIPES`, making them look like sample code rather than shipped product themes. There is no live editing path for shipped themes, default values are duplicated in three places, recipe functions are needlessly in a separate file, the `formulas` escape hatch bypasses the recipe system, and Bluenote is obsolete. The generator card cannot push changes to the running app's actual theme.

This refactor makes themes data (JSON files) instead of code, with a two-directory storage model (shipped in `tugdeck/themes/`, authored in `~/.tugtool/themes/`), the Prototype pattern for creating new themes, a Mac-style document model in the generator card, and dynamic app menu population via a cached theme list pushed from the web view.

#### Strategy {#strategy}

- Establish the data foundation first: create theme JSON files and merge recipe functions into the engine, removing dead code (Changes 1-5 from the roadmap).
- Update the build pipeline next: token generation reads from JSON, Vite middleware serves both directories (Changes 6-7).
- Rewire the frontend: generator card, theme provider, action dispatch, and main.tsx all load themes dynamically through middleware (Changes 8-10).
- Update the Swift app menu to use dynamic theme list with `NSMenuDelegate` (Change 11).
- Update all tests to import shipped JSON directly and remove obsolete test cases (Change 12).
- Update tuglaws documentation to reflect the new architecture (Change 13).
- Each step has a clear commit boundary; integration checkpoints verify groups of related changes work together.

#### Success Criteria (Measurable) {#success-criteria}

- `tugdeck/themes/brio.json` and `tugdeck/themes/harmony.json` exist and `bun run generate:tokens` produces identical CSS output from them as from the old `EXAMPLE_RECIPES` constants (`diff` of generated CSS shows no change)
- `EXAMPLE_RECIPES` is fully removed from the codebase (`grep -r EXAMPLE_RECIPES tugdeck/` returns zero matches)
- `theme-recipes.ts` is deleted and all its exports are available from `theme-engine.ts`
- `formulas` field does not exist on `ThemeRecipe` interface (`grep 'formulas?: DerivationFormulas' tugdeck/src/components/tugways/theme-engine.ts` returns zero matches — the old optional field is gone)
- `GET /__themes/list` returns entries from both `tugdeck/themes/` and `~/.tugtool/themes/` with correct `source` and `recipe` fields
- `POST /__themes/save` rejects names that collide with shipped themes (returns 400)
- Generator card opens the active theme on launch, creates new themes via Prototype pattern, auto-saves authored themes, and applies CSS live
- Swift Theme menu populates dynamically from cached theme list; no hardcoded Brio/Bluenote/Harmony items remain
- `canvasColorHex()` derives canvas color from any loaded theme's derived surface params at runtime (using `deriveTheme()` output, not raw JSON or hardcoded per-theme values)
- All tests pass: `cd tugdeck && bun test`
- `bun run audit:tokens` passes with no regressions

#### Scope {#scope}

1. Extract theme data to JSON files in `tugdeck/themes/` (brio, harmony)
2. Merge `theme-recipes.ts` into `theme-engine.ts`; delete `theme-recipes.ts`
3. Remove `EXAMPLE_RECIPES`, `formulas` escape hatch, and `loadPreset`
4. Update `generate-tug-tokens.ts` to read from JSON files
5. Extend Vite dev middleware for two-directory theme storage (list, load JSON, load CSS, save)
6. Rewrite generator card with Mac-style document model (New/Open/auto-save/Apply, Prototype pattern, shipped themes read-only)
7. Update theme provider, action dispatch, and main.tsx for dynamic theme loading
8. Update `canvas-color.ts` to derive canvas color from loaded theme JSON at runtime
9. Remove Bluenote from Swift app menu and web frontend
10. Implement dynamic Swift Theme menu via `NSMenuDelegate` with cached theme list
11. Update all test files to use JSON imports
12. Update tuglaws documentation

#### Non-goals (Explicitly out of scope) {#non-goals}

- Production persistence for authored themes (deferred to later phase)
- New recipe types beyond dark/light
- Theme import/export UI (the old `ExportImportPanel` is removed; manual JSON copy replaces it)
- Theme deletion UI in the generator card

#### Dependencies / Prerequisites {#dependencies}

- Bun runtime available for JSON imports in tests and token generation
- Vite dev server running for middleware endpoints
- Swift/AppKit build environment for `AppDelegate.swift` changes

#### Constraints {#constraints}

- L06: Appearance changes through CSS and DOM, never React state
- L15: Interactive controls use token-driven control states
- L16: Every color-setting rule declares its rendering surface
- Generated CSS output must be identical before and after the refactor (same 373 tokens, same values)
- Theme names must be unique across both directories
- Shipped themes are read-only through the middleware

#### Assumptions {#assumptions}

- `tugdeck/themes/` directory does not yet exist and must be created
- `tugdeck/styles/themes/bluenote.css` does not exist (confirmed: only `harmony.css` and `.gitkeep` are present), so the delete step for it is a no-op
- `theme-middleware.test.ts` covers the current `handleThemesSave` / `handleThemesList` handlers and will need to be rewritten alongside the `vite.config.ts` middleware changes
- The roadmap's 13 changes have hard dependencies (e.g., Change 1 before Change 3 and Change 6; Change 7 before Change 8 and Change 10)
- Canvas color will be derived from `ThemeOutput.formulas` (returned by `deriveTheme()`) at runtime, NOT directly from raw theme JSON surface params. Recipe functions hardcode `surfaceCanvasIntensity` independently (dark: 2, light: 3) from the theme JSON's `surface.canvas.intensity` (brio: 5, harmony: 6). The `canvasColorHex()` function must receive derived values from `ThemeOutput.formulas` to match the generated CSS. The `formulas` field is added to `ThemeOutput` in Step 3. The `surfaceCanvasHueSlot` in the formulas contains only the slot name (e.g., `"canvas"`), not the resolved hue string; callers must resolve it via `ThemeRecipe.surface.canvas.hue`.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows the skeleton's reference and anchor conventions. All headings that are cited use explicit `{#anchor-name}` anchors. Steps use `**References:**` lines citing decisions, specs, and anchors. Steps use `**Depends on:**` lines citing step anchors.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Generated CSS drift after switching to JSON source | high | med | Diff generated CSS before/after; must be identical | Any token value change in output |
| Middleware filesystem operations fail on missing user themes dir | med | med | Auto-create `~/.tugtool/themes/` on first save; handle ENOENT gracefully | First save attempt fails |
| Swift bridge canvas color breaks for dynamically-loaded themes | high | low | Derive from theme JSON surface params at runtime; test with brio, harmony, and a new authored theme | Canvas color mismatch on theme switch |

**Risk R01: Generated CSS regression** {#r01-css-regression}

- **Risk:** Switching from `EXAMPLE_RECIPES` constants to JSON file loading could introduce subtle differences in generated CSS if JSON serialization/deserialization loses precision or field ordering changes.
- **Mitigation:**
  - Capture current generated CSS output before any changes as a golden reference
  - After switching to JSON source, diff against the golden reference
  - Integration checkpoint verifies identical output
- **Residual risk:** Future theme JSON edits could introduce regressions without a diff baseline; `bun run audit:tokens` provides ongoing protection.

**Risk R02: Auto-save data loss** {#r02-autosave-data-loss}

- **Risk:** The 500ms debounced auto-save could lose edits if the browser tab closes before the debounce fires.
- **Mitigation:**
  - Debounce writes to disk, but update in-memory state immediately
  - The debounce window is short (500ms) so the window for data loss is minimal
- **Residual risk:** At most 500ms of edits could be lost on abrupt tab close. Acceptable for a dev-only tool.

---

### Design Decisions {#design-decisions}

#### [D01] Themes are JSON data files, not TypeScript constants (DECIDED) {#d01-themes-as-json}

**Decision:** Theme definitions (color choices + recipe reference) are stored as `.json` files in `tugdeck/themes/` (shipped) and `~/.tugtool/themes/` (authored), not as TypeScript constants.

**Rationale:**
- Separates data from code — themes are authoring artifacts, not implementation details
- Enables loading themes at runtime without rebuilding
- Enables the Prototype pattern (copy a JSON file to create a new theme)

**Implications:**
- `EXAMPLE_RECIPES` is deleted; all code that referenced it must load from JSON
- `generate-tug-tokens.ts` reads from `tugdeck/themes/*.json` instead of importing TypeScript constants
- Tests import shipped JSON files directly via Bun's JSON import support

#### [D02] Two-directory storage with unique names (DECIDED) {#d02-two-directory-storage}

**Decision:** Shipped themes live in `tugdeck/themes/` (checked into repo). Authored themes live in `~/.tugtool/themes/` (user data, not in repo). Theme names are unique across both directories.

**Rationale:**
- Clear separation: shipped themes are version-controlled, authored themes are user data
- Unique names eliminate ambiguity — a theme exists in exactly one location
- The middleware checks authored directory first, then shipped, but uniqueness means no shadowing

**Implications:**
- `POST /__themes/save` rejects names that already exist in `tugdeck/themes/`
- `GET /__themes/list` concatenates both directories with a `source` field
- To promote an authored theme to shipped, manually copy the JSON file and commit

#### [D03] Brio is the base theme (DECIDED) {#d03-brio-base-theme}

**Decision:** Brio's tokens are the baseline CSS in `styles/tug-base-generated.css`. Switching to Brio means removing the override stylesheet. All other themes work as cascade overrides on top of Brio.

**Rationale:**
- Eliminates the need to inject CSS for the default theme
- Provides a reliable fallback — if override injection fails, Brio is still visible
- Matches the current architecture (no behavioral change)

**Implications:**
- `generate-tug-tokens.ts` treats `brio` specially: its output goes to `tug-base-generated.css`, not `styles/themes/brio.css`
- The theme provider's `setTheme("brio")` removes the override `<style>` element
- There is no `styles/themes/brio.css` file

#### [D04] Recipe functions merged into theme-engine.ts (DECIDED) {#d04-merge-recipes}

**Decision:** `contrastSearch()`, `darkRecipe()`, `lightRecipe()`, and `RECIPE_REGISTRY` move from `theme-recipes.ts` into `theme-engine.ts`. `theme-recipes.ts` is deleted.

**Rationale:**
- The separation added no value — recipe functions are only consumed by the engine
- Reduces import chains and makes the engine self-contained

**Implications:**
- All imports of `theme-recipes.ts` must be updated to import from `theme-engine.ts`
- `RECIPE_REGISTRY` is exported from `theme-engine.ts`

#### [D05] Remove formulas escape hatch (DECIDED) {#d05-remove-formulas}

**Decision:** The `formulas?: DerivationFormulas` field is removed from the `ThemeRecipe` interface. All code paths that check for or use `recipe.formulas` are deleted. The recipe function is the only derivation path.

**Rationale:**
- The escape hatch bypasses the recipe system entirely, creating a parallel path
- No shipped or authored theme uses it
- Removing it simplifies the derivation pipeline

**Implications:**
- `ThemeRecipe` interface loses the `formulas` field
- `deriveTheme()` no longer checks for pre-computed formulas
- Tests that exercise the formulas path are removed

#### [D06] Generator card uses Mac-style document model (DECIDED) {#d06-mac-document-model}

**Decision:** The generator card follows Mac document conventions: New (Prototype pattern, copy existing theme), Open (load from available themes), auto-save (500ms debounce to disk), Apply (inject CSS app-wide). Shipped themes open read-only. No explicit Save button.

**Rationale:**
- Familiar mental model for Mac users
- Auto-save eliminates the "forgot to save" problem
- Read-only shipped themes prevent accidental modification of version-controlled files
- Prototype pattern ensures every new theme starts from a known-good state

**Implications:**
- `loadPreset`, `DEFAULT_RECIPE`, `handleSelectBuiltIn`, and `ExportImportPanel` are all deleted
- The generator card must track whether the current theme is shipped (read-only) or authored (editable)
- Auto-save writes both JSON and regenerated CSS to `~/.tugtool/themes/`

#### [D07] Dynamic theme loading through middleware (DECIDED) {#d07-dynamic-theme-loading}

**Decision:** All theme loading goes through the Vite dev middleware. `ThemeName` becomes a plain string (not a hardcoded union). `themeCSSMap` is populated dynamically. The pre-fetch in `main.tsx` fetches all available non-default themes dynamically.

**Rationale:**
- Eliminates hardcoded theme knowledge from the frontend
- Supports arbitrary authored themes without code changes
- Single code path for all theme operations (shipped and authored)

**Implications:**
- `ThemeName` type changes from `"brio" | "harmony"` to `string`
- `themeCSSMap` becomes a `Map<string, string | null>` populated at startup
- `main.tsx` pre-fetches themes via `GET /__themes/list` + `GET /__themes/<name>.css`
- Action dispatch validates themes dynamically against available themes

#### [D08] Canvas color derived from theme derivation output at runtime (DECIDED) {#d08-canvas-color-runtime}

**Decision:** `canvasColorHex()` in `canvas-color.ts` is updated to accept derived canvas surface params (hue, tone, intensity) from the `DerivationFormulas` output of `deriveTheme()`, rather than looking up hardcoded values by theme name. The raw theme JSON `surface.canvas.intensity` differs from the derived `surfaceCanvasIntensity` (e.g., brio JSON has intensity 5 but the recipe derives `surfaceCanvasIntensity: 2`; harmony JSON has intensity 6 but derives `surfaceCanvasIntensity: 3`). The recipe functions hardcode canvas surface intensity independently from the theme's input intensity. Therefore callers must run `deriveTheme()` first and extract `surfaceCanvasIntensity`, `surfaceCanvasTone`, and the canvas hue slot from `ThemeOutput.formulas` (exposed by adding a `formulas: DerivationFormulas` field to `ThemeOutput` in Step 3).

**Rationale:**
- The user chose to derive canvas color from loaded theme data at runtime
- Supports authored themes without hardcoding their canvas colors
- The palette engine already has all the math needed
- Using derived values (not raw JSON) ensures the Swift bridge canvas color matches the generated CSS exactly

**Implications:**
- `canvasColorHex()` signature changes to accept derived `{ hue: string; tone: number; intensity: number }` where intensity is the derived `surfaceCanvasIntensity`, not the raw JSON value
- Callers (`sendCanvasColor` in theme-provider, main.tsx) must run `deriveTheme()` on the loaded theme JSON and extract the derived canvas params from `ThemeOutput.formulas`
- The `CANVAS_COLORS` lookup table is removed

#### [D09] Recipe locked at creation time (DECIDED) {#d09-recipe-locked}

**Decision:** A theme's recipe (`"dark"` or `"light"`) is set when the theme is created (copied from the prototype) and cannot be changed afterward. The generator card displays the recipe as a read-only label, not a toggle.

**Rationale:**
- Dark and light recipes have fundamentally different derivation logic — switching mid-edit would produce incoherent results
- Simplifies the generator card (no Dark/Light toggle)
- Want a dark theme? Base it on Brio. Want a light theme? Base it on Harmony.

**Implications:**
- The generator card removes the Dark/Light mode toggle
- The recipe field in theme JSON is immutable after creation
- The New flow asks which prototype to copy from, which implicitly selects the recipe

#### [D10] Dynamic Swift Theme menu via NSMenuDelegate (DECIDED) {#d10-dynamic-swift-menu}

**Decision:** The Swift Theme submenu uses `NSMenuDelegate.menuNeedsUpdate(_:)` to populate items dynamically from a cached theme list. The web view pushes updated theme lists to Swift via a new `themeListUpdated` bridge message.

**Rationale:**
- Eliminates hardcoded menu items and per-theme `@objc` handlers
- Supports authored themes appearing in the menu without Swift code changes
- Push-based updates keep the cache fresh without polling

**Implications:**
- `AppDelegate.swift` removes `setThemeBrio`, `setThemeBluenote`, `setThemeHarmony` methods
- A single dynamic handler sends `set-theme` with the selected name
- Swift caches the theme list and rebuilds menu items on each `menuNeedsUpdate`

#### [D11] Remove Bluenote completely (DECIDED) {#d11-remove-bluenote}

**Decision:** Bluenote is removed from the entire codebase — Swift menu, action dispatch, theme provider, and any CSS files.

**Rationale:**
- Bluenote is obsolete per the roadmap
- `tugdeck/styles/themes/bluenote.css` does not exist (confirmed), so the CSS delete is a no-op

**Implications:**
- `AppDelegate.swift`: delete `setThemeBluenote` method and menu item (Bluenote only exists in Swift code)
- `theme-provider.tsx`: `ThemeName` becomes `string` per [D07], so no explicit Bluenote removal needed
- Tests: remove Bluenote test cases if any exist

---

### Specification {#specification}

#### Theme JSON Schema {#theme-json-schema}

**Spec S01: Theme JSON file format** {#s01-theme-json-format}

```json
{
  "name": "string (unique across both directories, kebab-case)",
  "description": "string (short prose description)",
  "recipe": "dark | light",
  "surface": {
    "canvas": { "hue": "string", "tone": "number (0-100)", "intensity": "number (0-100)" },
    "grid":   { "hue": "string", "tone": "number (0-100)", "intensity": "number (0-100)" },
    "frame":  { "hue": "string", "tone": "number (0-100)", "intensity": "number (0-100)" },
    "card":   { "hue": "string", "tone": "number (0-100)", "intensity": "number (0-100)" }
  },
  "text": { "hue": "string", "intensity": "number (0-100)" },
  "display": { "hue": "string", "intensity": "number (0-100)" },
  "border": { "hue": "string", "intensity": "number (0-100)" },
  "role": {
    "tone": "number (0-100)", "intensity": "number (0-100)",
    "accent": "string", "action": "string", "agent": "string",
    "data": "string", "success": "string", "caution": "string", "danger": "string"
  }
}
```

Optional fields: `display`, `border`. Included in JSON when present; omitted when not used by the theme.

**Spec S02: Middleware API endpoints** {#s02-middleware-api}

| Endpoint | Method | Request | Response | Notes |
|----------|--------|---------|----------|-------|
| `/__themes/list` | GET | — | `{ themes: [{ name, recipe, source }] }` | `source` is `"shipped"` or `"authored"` |
| `/__themes/<name>.json` | GET | — | Theme JSON | Check authored dir first, then shipped |
| `/__themes/<name>.css` | GET | — | CSS string | For shipped: `styles/themes/`. For authored: `~/.tugtool/themes/` |
| `/__themes/save` | POST | Theme JSON body | `{ ok: true }` or `{ error: string }` | Rejects if name exists in shipped dir. Auto-creates `~/.tugtool/themes/` |

**Spec S03: Recipe registry** {#s03-recipe-registry}

```typescript
export const RECIPE_REGISTRY: Record<string, {
  fn: (recipe: ThemeRecipe) => DerivationFormulas;
}> = {
  dark:  { fn: darkRecipe },
  light: { fn: lightRecipe },
};
```

No `defaults` field. Default color choices are whatever is in `brio.json` and `harmony.json`.

**Spec S04: Canvas color bridge interface** {#s04-canvas-color-bridge}

```typescript
// New signature — accepts DERIVED surface params (from DerivationFormulas output, not raw theme JSON)
export function canvasColorHex(surface: { hue: string; tone: number; intensity: number }): string;
```

Callers must run `deriveTheme()` on the loaded theme JSON and extract from `ThemeOutput.formulas` (added in Step 3). Note that `surfaceCanvasHueSlot` in the formulas contains only the slot name (e.g., `"canvas"`), not the resolved hue string. Callers must resolve the slot to the actual hue by reading `ThemeRecipe.surface.canvas.hue`:
- `hue`: the resolved canvas hue from the formulas hue-slot dispatch (e.g., `surfaceCanvasHueSlot: "canvas"` resolves to the theme's `surface.canvas.hue`)
- `tone`: the derived `surfaceCanvasTone` from `ThemeOutput.formulas` (equals the raw `surface.canvas.tone` since recipes pass it through unchanged)
- `intensity`: the derived `surfaceCanvasIntensity` from `ThemeOutput.formulas` (NOT the raw `surface.canvas.intensity` — recipe functions hardcode this independently, e.g., dark: 2, light: 3)

The `CANVAS_COLORS` lookup table and `ThemeName` import are removed.

**Spec S05: Generator card state machine** {#s05-generator-state-machine}

States:
- **Idle** — generator card closed. No active theme editing.
- **Viewing (read-only)** — a shipped theme is loaded. Controls display values but are disabled. User can New or Open.
- **Editing** — an authored theme is loaded. Controls are enabled. Auto-save fires 500ms after last change. Apply injects CSS after each auto-save.

Transitions:
- Open → Viewing (if shipped) or Editing (if authored)
- New → Editing (always; new themes are authored)
- Close → Idle

---

### Deep Dives (Optional) {#deep-dives}

#### Theme Loading Flow {#theme-loading-flow}

At app startup (`main.tsx`):
1. Fetch `GET /__themes/list` to get all available themes with their `source` and `recipe` fields.
2. Fetch the saved theme preference from settings.
3. If the saved theme is not `"brio"`, fetch `GET /__themes/<name>.css` for that theme.
4. Fetch the active theme's JSON via `GET /__themes/<name>.json` and cache the parsed `ThemeRecipe` in a module-level variable for synchronous access by `sendCanvasColor()`.
5. Register the fetched CSS and call `applyInitialTheme()`.
6. Run `deriveTheme()` on the cached recipe, extract derived canvas params from `themeOutput.formulas`, and send canvas color to Swift bridge via `sendCanvasColor()`.

At theme switch (action dispatch or generator card Apply):
1. If switching to Brio: remove override stylesheet.
2. Otherwise: fetch `GET /__themes/<name>.css`, inject as override stylesheet.
3. Fetch `GET /__themes/<name>.json`, run `deriveTheme()`, extract derived canvas params from `themeOutput.formulas`, and call `sendCanvasColor()` with the derived `{ hue, tone, intensity }`.

#### Generator Card New Flow {#generator-new-flow}

1. User clicks New.
2. Dialog prompts for a theme name. Client validates: non-empty, unique across both directories (checked via `GET /__themes/list`).
3. Dialog shows available themes as prototypes (from `GET /__themes/list`). User picks one.
4. Client fetches prototype's JSON via `GET /__themes/<prototype>.json`.
5. Client copies JSON, replaces `name` with the new name, sends `POST /__themes/save`.
6. Generator card enters Editing state with the new theme loaded.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/themes/brio.json` | Shipped default dark theme data |
| `tugdeck/themes/harmony.json` | Shipped light theme data |
| `tugdeck/src/theme-css-generator.ts` | Shared CSS generation module; exports `generateThemeCSS()` for use by `generate-tug-tokens.ts` and Vite middleware. This is a pure utility with no React dependency, placed at the top level of `src/` to signal it is infrastructure (not a component). |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `generateThemeCSS` | fn | `tugdeck/src/theme-css-generator.ts` | New shared module; generates CSS string from a `ThemeRecipe` |
| `RECIPE_REGISTRY` | const | `tugdeck/src/components/tugways/theme-engine.ts` | Moved from `theme-recipes.ts`; maps recipe names to functions |
| `contrastSearch` | fn | `tugdeck/src/components/tugways/theme-engine.ts` | Moved from `theme-recipes.ts` |
| `darkRecipe` | fn | `tugdeck/src/components/tugways/theme-engine.ts` | Moved from `theme-recipes.ts` |
| `lightRecipe` | fn | `tugdeck/src/components/tugways/theme-engine.ts` | Moved from `theme-recipes.ts` |
| `contrastFromL` | fn (private) | `tugdeck/src/components/tugways/theme-engine.ts` | Moved from `theme-recipes.ts`; private helper used by `contrastSearch` |
| `ThemeName` | type | `tugdeck/src/contexts/theme-provider.tsx` | Changed from `"brio" \| "harmony"` to `string` |
| `themeCSSMap` | const | `tugdeck/src/contexts/theme-provider.tsx` | Changed from `Record<ThemeName, string \| null>` to `Map<string, string \| null>` |
| `canvasColorHex` | fn | `tugdeck/src/canvas-color.ts` | Signature changed to accept `{ hue, tone, intensity }` instead of `ThemeName` |
| `CANVAS_COLORS` | const | `tugdeck/src/canvas-color.ts` | Removed |
| `handleThemesSave` | fn | `tugdeck/vite.config.ts` | Rewritten for two-directory model with shipped-name rejection |
| `handleThemesList` | fn | `tugdeck/vite.config.ts` | Rewritten to concatenate both directories with `source` field |
| `EXAMPLE_RECIPES` | const | `tugdeck/src/components/tugways/theme-engine.ts` | Removed |
| `formulas` | field | `ThemeRecipe` interface | Removed from `ThemeRecipe` |
| `formulas` | field | `ThemeOutput` interface | Added — exposes computed `DerivationFormulas` from `deriveTheme()` |
| `loadPreset` | fn | `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx` | Removed |
| `DEFAULT_RECIPE` | const | `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx` | Removed |
| `ExportImportPanel` | component | `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx` | Removed |
| `loadSavedThemes` | fn | `tugdeck/src/contexts/theme-provider.tsx` | Removed or updated to parse new `/__themes/list` response format (see Step 8) |
| `dynamicThemeName` | field | `ThemeContextValue` | Removed; collapsed into `string`-typed `theme` |
| `setDynamicTheme` | fn | `ThemeContextValue` | Removed; collapsed into `setTheme` |
| `revertToBuiltIn` | fn | `ThemeContextValue` | Removed; no longer needed with unified `setTheme` |
| `DYNAMIC_THEME_KEY` | const | `tugdeck/src/contexts/theme-provider.tsx` | Removed |

---

### Documentation Plan {#documentation-plan}

- [ ] Rewrite `tuglaws/theme-engine.md` for themes-as-JSON architecture
- [ ] Update `tuglaws/design-decisions.md` for new architecture decisions
- [ ] Verify `tuglaws/laws-of-tug.md` — no changes expected
- [ ] Verify and update `tuglaws/token-naming.md` if needed
- [ ] Verify and update `tuglaws/color-palette.md` if needed

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test theme JSON loading, recipe registry lookup, canvas color computation, middleware handlers | Core logic, edge cases, error paths |
| **Integration** | Test generate-tug-tokens with JSON input, middleware endpoint flows, generator card New/Open/Save flows | End-to-end operations |
| **Golden / Contract** | Diff generated CSS against pre-refactor baseline to verify no regression | Token generation, theme derivation |
| **Drift Prevention** | Ensure `bun run audit:tokens` passes after every step | Regression testing |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.
>
> **Patterns:**
> - If a step is large, split the work into multiple **flat steps** (`Step N`, `Step N+1`, ...) with separate commits and checkpoints, each with explicit `**Depends on:**` lines.
> - After completing a group of related flat steps, add a lightweight **Integration Checkpoint step** that depends on all constituent steps and verifies they work together. Integration checkpoint steps use `Commit: N/A (verification only)` to signal no separate commit.
>
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers — add an anchor instead.

#### Step 1: Create theme JSON files and capture golden CSS baseline {#step-1}

**Commit:** `feat(theme): extract brio and harmony theme data to JSON files`

**References:** [D01] Themes are JSON data files, [D02] Two-directory storage, [D03] Brio is the base theme, Spec S01, (#theme-json-schema, #context)

**Artifacts:**
- `tugdeck/themes/brio.json` — extracted from `EXAMPLE_RECIPES.brio`
- `tugdeck/themes/harmony.json` — extracted from `EXAMPLE_RECIPES.harmony`
- Golden CSS baseline captured (saved temporarily for diff verification)

**Tasks:**
- [ ] Create `tugdeck/themes/` directory
- [ ] Extract `EXAMPLE_RECIPES.brio` data into `tugdeck/themes/brio.json` conforming to Spec S01. Use the short description from the roadmap: "Deep, immersive dark theme with industrial warmth."
- [ ] Extract `EXAMPLE_RECIPES.harmony` data into `tugdeck/themes/harmony.json` conforming to Spec S01. Use a short description matching the style.
- [ ] Capture current `bun run generate:tokens` output as golden baseline files for diff comparison in later steps

**Tests:**
- [ ] Validate both JSON files parse correctly and conform to Spec S01 schema
- [ ] Verify JSON field values match the `EXAMPLE_RECIPES` constants exactly (spot-check surface, text, role fields)

**Checkpoint:**
- [ ] `ls tugdeck/themes/brio.json tugdeck/themes/harmony.json` — both files exist
- [ ] `bun run generate:tokens` — still succeeds (JSON files are not yet consumed)
- [ ] `cd tugdeck && bun test` — all existing tests still pass (no behavioral changes yet)

---

#### Step 2: Merge recipe functions into theme-engine.ts {#step-2}

**Depends on:** #step-1

**Commit:** `refactor(theme): merge theme-recipes.ts into theme-engine.ts`

**References:** [D04] Recipe functions merged into theme-engine.ts, Spec S03, (#strategy)

**Artifacts:**
- `theme-engine.ts` — gains `contrastSearch`, `darkRecipe`, `lightRecipe`, `RECIPE_REGISTRY`
- `theme-recipes.ts` — deleted

**Tasks:**
- [ ] Move `contrastFromL()`, `contrastSearch()`, `darkRecipe()`, `lightRecipe()`, and `RECIPE_REGISTRY` from `theme-recipes.ts` into `theme-engine.ts`
- [ ] Export `RECIPE_REGISTRY` from `theme-engine.ts` per Spec S03
- [ ] Update all imports that referenced `theme-recipes.ts` to import from `theme-engine.ts`
- [ ] Delete `theme-recipes.ts`
- [ ] Fix module header: replace "Theme Derivation Engine — Tugways Theme Generator" with "Theme Engine" (roadmap Change 5)

**Tests:**
- [ ] All existing tests pass with updated imports

**Checkpoint:**
- [ ] `ls tugdeck/src/components/tugways/theme-recipes.ts` — file does not exist (deleted)
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `bun run generate:tokens` — still succeeds
- [ ] `bun run audit:tokens` — passes

---

#### Step 3: Remove formulas escape hatch and expose formulas on ThemeOutput {#step-3}

**Depends on:** #step-2

**Commit:** `refactor(theme): remove formulas escape hatch from ThemeRecipe; add formulas to ThemeOutput`

**References:** [D05] Remove formulas escape hatch, (#context)

**Artifacts:**
- `theme-engine.ts` — `formulas` field removed from `ThemeRecipe`, `formulas` field added to `ThemeOutput`, `resolveHueSlots` default updated

**Tasks:**
- [ ] Remove `formulas?: DerivationFormulas` field from `ThemeRecipe` interface in `theme-engine.ts`
- [ ] Add `formulas: DerivationFormulas` field to the `ThemeOutput` interface so that callers (e.g., canvas color derivation in Step 10) can access the computed derivation formulas from `deriveTheme()` output. Update the return statement in `deriveTheme()` to include the local `formulas` variable in the returned object.
- [ ] Remove all code paths in `deriveTheme()` that check for or use `recipe.formulas`
- [ ] Update `resolveHueSlots()` default parameter: change `formulas: DerivationFormulas = recipe.formulas ?? darkRecipe(recipe)` to `formulas: DerivationFormulas = darkRecipe(recipe)` (the `recipe.formulas` path no longer exists). Update the JSDoc `@param formulas` description accordingly. Note: `deriveTheme()` always passes `formulas` explicitly, so the default only matters for direct callers of `resolveHueSlots()`.
- [ ] Remove test cases that exercise the `formulas` escape hatch (note: this may be a no-op — current test files do not appear to contain `formulas`-specific test cases; verify with `grep -r 'formulas' tugdeck/src/__tests__/` before spending time on this)

**Tests:**
- [ ] `deriveTheme()` works correctly without `formulas` field on `ThemeRecipe`
- [ ] `deriveTheme()` output includes `formulas` field on `ThemeOutput`

**Checkpoint:**
- [ ] `grep 'formulas?: DerivationFormulas' tugdeck/src/components/tugways/theme-engine.ts` — zero matches (the old `ThemeRecipe` optional field is gone; `formulas` still appears as a local variable, in JSDoc, and in the new `ThemeOutput.formulas` field)
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `bun run generate:tokens` — still succeeds (EXAMPLE_RECIPES still present; removed in next step)
- [ ] `bun run audit:tokens` — passes

---

#### Step 4: Remove EXAMPLE_RECIPES and update token generation and tests {#step-4}

**Depends on:** #step-3

**Commit:** `refactor(theme): remove EXAMPLE_RECIPES; update generate-tug-tokens and tests to JSON imports`

**References:** [D01] Themes as JSON data files, (#context)

**Artifacts:**
- `theme-engine.ts` — `EXAMPLE_RECIPES` removed
- `generate-tug-tokens.ts` — updated to import theme JSON files directly
- Test files — updated to import shipped JSON directly
- `gallery-theme-generator-content.tsx` — compatibility update for removed symbols

**Tasks:**
- [ ] Remove `EXAMPLE_RECIPES` constant from `theme-engine.ts`
- [ ] Update `generate-tug-tokens.ts` to import brio and harmony theme data from `tugdeck/themes/brio.json` and `tugdeck/themes/harmony.json` via Bun JSON import (e.g., `import brio from "../themes/brio.json"`), replacing the `EXAMPLE_RECIPES` import. Keep the same two-file generation logic (brio to `tug-base-generated.css`, harmony to `styles/themes/harmony.css`); the glob-based multi-theme generation is deferred to Step 6.
- [ ] Update all test files that reference `EXAMPLE_RECIPES` to import shipped JSON directly:
  - `theme-engine.test.ts`
  - `theme-accessibility.test.ts`
  - `contrast-dashboard.test.tsx`
  - `theme-export-import.test.tsx`
  - `gallery-theme-generator-content.test.tsx`
  - `cvd-preview-auto-fix.test.tsx`
  - `tug-color-strip.test.tsx`
  - Note: `theme-middleware.test.ts` is excluded here because it does not import `EXAMPLE_RECIPES` and will be fully rewritten in Step 7 alongside the middleware changes.
- [ ] Update `gallery-theme-generator-content.tsx` to eliminate build-breaking references that would otherwise persist until Step 12. Use `grep EXAMPLE_RECIPES` and `grep formulas` within the file to find all occurrences:
  - Replace the `EXAMPLE_RECIPES` import with a direct JSON import of brio (e.g., `import brio from "../../../../themes/brio.json"`)
  - Replace all `EXAMPLE_RECIPES.brio` and `EXAMPLE_RECIPES.harmony` usages (in `DEFAULT_RECIPE` initialization, `loadPreset` callback, and preset button rendering) with the imported JSON objects
  - Replace the `formulasAndRef` state initialization (which uses `DEFAULT_RECIPE.formulas ?? null`) with `null` directly, since the `formulas` field no longer exists on `ThemeRecipe`
  - Replace the `formulasRef` initialization (which uses `DEFAULT_RECIPE.formulas ?? null`) with `null` directly
  - Replace all `setFormulasAndRef(r.formulas ?? null)` calls (in `loadPreset` and recipe import handlers) with `setFormulasAndRef(null)`, since `r.formulas` no longer exists
  - Note: this is a minimal compatibility update; the full generator card rewrite happens in Step 12

**Tests:**
- [ ] All updated tests pass with JSON imports

**Checkpoint:**
- [ ] `grep -r 'EXAMPLE_RECIPES' tugdeck/` — zero matches
- [ ] `bun run generate:tokens` — succeeds and output is identical to golden baseline from Step 1
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `bun run audit:tokens` — passes

---

#### Step 5: Data Foundation Integration Checkpoint {#step-5}

**Depends on:** #step-1, #step-2, #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] Themes are JSON data files, [D04] Recipe functions merged, [D05] Remove formulas escape hatch, Risk R01, (#success-criteria)

**Tasks:**
- [ ] Verify theme JSON files are the sole source of theme data (no `EXAMPLE_RECIPES` anywhere)
- [ ] Verify `theme-recipes.ts` is deleted and `theme-engine.ts` is self-contained
- [ ] Verify generated CSS is identical to pre-refactor baseline (diff golden files)
- [ ] Verify all tests pass end-to-end

**Tests:**
- [ ] `cd tugdeck && bun test` — full test suite passes
- [ ] Diff generated `styles/tug-base-generated.css` and `styles/themes/harmony.css` against golden baseline — no differences

**Checkpoint:**
- [ ] `bun run generate:tokens && diff <golden-tug-base-generated.css> tugdeck/styles/tug-base-generated.css` — identical
- [ ] `bun run generate:tokens && diff <golden-harmony.css> tugdeck/styles/themes/harmony.css` — identical
- [ ] `bun run audit:tokens` — passes

---

#### Step 6: Create shared CSS generation module and update token generation {#step-6}

**Depends on:** #step-4

**Commit:** `feat(theme): extract shared CSS generation module; generate-tug-tokens reads from JSON glob`

**References:** [D01] Themes are JSON data files, [D03] Brio is the base theme, (#strategy)

**Artifacts:**
- `tugdeck/src/theme-css-generator.ts` — new shared module exporting `generateThemeCSS()` for use by both `generate-tug-tokens.ts` and Vite middleware. This is a pure utility with no React dependency, placed at the top level of `src/` to signal it is infrastructure (not a component).
- `generate-tug-tokens.ts` — reads all `tugdeck/themes/*.json`; uses `generateThemeCSS()` from shared module; brio goes to `tug-base-generated.css`, others to `styles/themes/<name>.css`
- `vite.config.ts` — `controlTokenHotReload` plugin watches `tugdeck/themes/*.json` for changes

**Tasks:**
- [ ] Extract the CSS generation logic (`buildTokenCssLines` + `body {}` wrapping) from `tugdeck/scripts/generate-tug-tokens.ts` into a shared module at `tugdeck/src/theme-css-generator.ts`. Export a function `generateThemeCSS(recipe: ThemeRecipe, mode: "base" | "override"): string` that takes a parsed `ThemeRecipe`, runs `deriveTheme()` + token generation + CSS formatting, and returns a complete CSS string. Both modes wrap tokens in `body {}` to maintain identical CSS output and preserve cascade specificity (the current codebase uses `body {}` for both base and override themes). The `mode` parameter controls only non-wrapping differences (e.g., the base theme omits the `/* Regenerate */` comment header, or future base-only formatting). If during implementation the two modes turn out to have no behavioral difference at all, simplify to a single no-parameter signature and remove the mode distinction. Both `generate-tug-tokens.ts` and the Vite middleware (Step 7) will import from this shared module.
- [ ] Update `generate-tug-tokens.ts` to replace the explicit brio/harmony JSON imports (from Step 4) with a glob of `tugdeck/themes/*.json`, generating CSS for each discovered theme file. Replace inline `buildTokenCssLines` + wrapping logic with calls to `generateThemeCSS()` from the shared module. Brio produces `styles/tug-base-generated.css`; all others produce `styles/themes/<name>.css`. This makes the script automatically pick up new shipped themes without code changes.
- [ ] Update `controlTokenHotReload` in `vite.config.ts` to also trigger regeneration when `tugdeck/themes/*.json` files change (add glob or explicit watch)

**Tests:**
- [ ] Modify a value in `harmony.json`, run `bun run generate:tokens`, verify `styles/themes/harmony.css` reflects the change, then revert

**Checkpoint:**
- [ ] `bun run generate:tokens` — succeeds; output files match expected locations
- [ ] `bun run audit:tokens` — passes
- [ ] `cd tugdeck && bun test` — all tests pass

---

#### Step 7: Extend Vite dev middleware for two-directory theme storage {#step-7}

**Depends on:** #step-4

**Commit:** `feat(theme): extend vite middleware for two-directory theme storage`

**References:** [D02] Two-directory storage, [D03] Brio is the base theme, Spec S02, (#theme-loading-flow)

**Artifacts:**
- `vite.config.ts` — rewritten middleware with all four endpoints per Spec S02
- `handleThemesSave` and `handleThemesList` — rewritten for two-directory model

**Tasks:**
- [ ] Rewrite `handleThemesList` to concatenate `tugdeck/themes/` and `~/.tugtool/themes/`, reading each JSON file to extract `name`, `recipe`, and computing `source` (`"shipped"` or `"authored"`). Return `{ themes: [...] }` sorted: brio first, other shipped, then authored.
- [ ] Implement `GET /__themes/<name>.json` handler: check `~/.tugtool/themes/<name>.json` first, then `tugdeck/themes/<name>.json`. Return 404 if neither exists.
- [ ] Implement `GET /__themes/<name>.css` handler: for brio, return 404 — brio's CSS lives in `styles/tug-base-generated.css` (the base stylesheet), not as an override file; callers know brio uses the base stylesheet and never request its override CSS. For other shipped themes, serve the pre-generated file from `styles/themes/<name>.css`. For authored themes, serve from `~/.tugtool/themes/<name>.css`; if the CSS file is missing but the JSON exists, generate CSS on-the-fly by reading the JSON and calling `generateThemeCSS(recipe, "override")` from the shared module (`tugdeck/src/theme-css-generator.ts`, created in Step 6), writing the CSS to disk, and serving it. This on-the-fly generation is a fallback for authored themes whose CSS was not yet written by `POST /__themes/save`; the primary CSS write path is the save endpoint (see next task). Return 404 if neither JSON nor CSS exists.
- [ ] Rewrite `handleThemesSave` for `POST /__themes/save`: accept full theme JSON body, reject if name exists in `tugdeck/themes/` (shipped), auto-create `~/.tugtool/themes/` if missing, write `<name>.json` and generate + write `<name>.css` (via `generateThemeCSS()` from the shared module) to `~/.tugtool/themes/`. This is the primary CSS generation path for authored themes; the GET handler's on-the-fly generation is a fallback only.
- [ ] Update `ThemeSaveBody` interface to match the new theme JSON structure (full `ThemeRecipe` minus `formulas`)

**Tests:**
- [ ] Rewrite `theme-middleware.test.ts` for the new handler signatures and two-directory behavior
- [ ] Test `handleThemesList` returns entries from both directories with correct `source` fields
- [ ] Test `handleThemesSave` rejects names that collide with shipped themes
- [ ] Test `handleThemesSave` auto-creates the user themes directory
- [ ] Test `GET /__themes/brio.css` returns 404 (brio uses the base stylesheet, not an override)

**Checkpoint:**
- [ ] `cd tugdeck && bun test` — all tests pass (including rewritten middleware tests)
- [ ] Manual: start dev server, `curl http://localhost:5173/__themes/list` returns brio and harmony with `source: "shipped"`

---

#### Step 8: Build Pipeline Integration Checkpoint {#step-8}

**Depends on:** #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** [D01] Themes as JSON, [D02] Two-directory storage, Spec S02, (#success-criteria)

**Tasks:**
- [ ] Verify `bun run generate:tokens` produces correct output from JSON source
- [ ] Verify all middleware endpoints work end-to-end
- [ ] Verify the Vite dev server watches theme JSON files for hot reload

**Tests:**
- [ ] `cd tugdeck && bun test` — full test suite passes

**Checkpoint:**
- [ ] `bun run generate:tokens` — succeeds
- [ ] `bun run audit:tokens` — passes
- [ ] Manual: `curl http://localhost:5173/__themes/list` returns correct theme list

---

#### Step 9: Update theme provider and action dispatch for dynamic themes {#step-9}

**Depends on:** #step-7

**Commit:** `feat(theme): dynamic theme loading in theme-provider and action-dispatch`

**References:** [D07] Dynamic theme loading through middleware, [D11] Remove Bluenote, [D03] Brio is the base theme, (#theme-loading-flow)

**Artifacts:**
- `theme-provider.tsx` — `ThemeName` becomes `string`, `themeCSSMap` becomes dynamic, all CSS fetched via middleware
- `action-dispatch.ts` — theme validation dynamic
- `main.tsx` — pre-fetches themes dynamically via `GET /__themes/list`
- `deck-manager.ts` — imports `ThemeName` from `theme-provider.tsx`; the widening from `"brio" | "harmony"` to `string` is backward-compatible and requires no code changes, but verify it compiles

**Tasks:**
- [ ] Change `ThemeName` from `"brio" | "harmony"` to `string` in `theme-provider.tsx`
- [ ] Replace the static `themeCSSMap` record with a `Map<string, string | null>` populated dynamically
- [ ] Update `registerThemeCSS` to work with the new Map
- [ ] Update `setTheme` logic: Brio removes override stylesheet; all others fetch CSS via `GET /__themes/<name>.css` and inject
- [ ] Remove `dynamicThemeName`, `setDynamicTheme`, and `revertToBuiltIn` from `ThemeContextValue` and `TugThemeProvider` — the `ThemeName`-to-`string` change collapses the built-in vs dynamic distinction, making these redundant. Simplify `ThemeContextValue` to `{ theme: string, setTheme: (theme: string) => void }`
- [ ] Remove the `DYNAMIC_THEME_KEY` localStorage handling and the `dynamicThemeName` React state
- [ ] Remove or update `loadSavedThemes()`: this function calls `GET /__themes/list` and filters out built-in names. With the new middleware response format (which returns `{ themes: [{ name, recipe, source }] }` instead of `{ themes: string[] }`), either remove `loadSavedThemes()` entirely (if the generator card will use the middleware directly) or update it to parse the new response shape
- [ ] Update `components/tugways/cards/gallery-theme-generator-content.tsx` consumers of `dynamicThemeName`/`setDynamicTheme`/`revertToBuiltIn`/`loadSavedThemes` to use the simplified context
- [ ] Update `main.tsx`: fetch `GET /__themes/list` at startup, pre-fetch CSS for the saved theme (and optionally other non-brio themes), then call `applyInitialTheme`. Additionally, fetch the active theme's JSON via `GET /__themes/<name>.json` and cache the parsed `ThemeRecipe` in a module-level variable (e.g., `let cachedActiveRecipe: ThemeRecipe | null`). This cached recipe is needed by `sendCanvasColor()` in Step 10 to derive canvas params synchronously at startup.
- [ ] Update `action-dispatch.ts` to accept any string as a theme name and delegate validation to the theme provider (which fetches CSS via middleware and handles 404s gracefully). Remove the hardcoded `ThemeName` union check. Action dispatch does not maintain a cached set of valid names — it passes the string through and lets the theme provider determine whether the theme exists. If the CSS fetch returns 404 (theme does not exist), log a warning and do not change the active theme.
- [ ] Verify `deck-manager.ts` compiles with the widened `ThemeName` type (it imports `ThemeName` from `theme-provider.tsx`; the change from union to `string` is backward-compatible but must be confirmed)
- [ ] Add a guard in `sendCanvasColor()` (or in `canvasColorHex()`) so that if the theme name is not present in `CANVAS_COLORS`, the function logs a warning and skips the bridge call rather than crashing. This is a temporary safety net: after Step 9 `ThemeName` is `string` and dynamically-loaded themes may not be in `CANVAS_COLORS`. Step 10 replaces the entire `CANVAS_COLORS` lookup with runtime derivation, removing this guard.
- [ ] Clean up the `as ThemeName` cast in `registerThemeSetter` — with `ThemeName` widened to `string`, this cast is a no-op and should be removed for clarity.

**Tests:**
- [ ] Update `action-dispatch.test.ts`: replace the hardcoded `ThemeName` union test (if any) with a test verifying that arbitrary theme name strings (e.g., `"my-custom-theme"`) are accepted and delegated to the theme provider. There are no Bluenote-specific test cases to remove.
- [ ] Update `theme-export-import.test.tsx`: remove or rewrite the T6 test group that exercises `dynamicThemeName`, `setDynamicTheme`, and `revertToBuiltIn` — these symbols no longer exist on `ThemeContextValue`. Replace with tests that exercise the simplified `{ theme, setTheme }` context interface for save/load flows.
- [ ] Verify theme switching works for brio (remove override), harmony (inject override), and dynamically-loaded themes

**Checkpoint:**
- [ ] `cd tugdeck && bun test` — all tests pass (confirms deck-manager.ts and all other consumers compile with widened ThemeName)
- [ ] `bun run audit:tokens` — passes

---

#### Step 10: Update canvas-color.ts for runtime derivation {#step-10}

**Depends on:** #step-9

**Commit:** `feat(theme): derive canvas color from theme JSON surface params at runtime`

**References:** [D08] Canvas color derived from theme JSON at runtime, Spec S04, (#theme-loading-flow)

**Artifacts:**
- `canvas-color.ts` — `canvasColorHex()` accepts surface params; `CANVAS_COLORS` removed
- `theme-provider.tsx` — `sendCanvasColor` passes surface params
- `main.tsx` — `sendCanvasColor` passes surface params

**Tasks:**
- [ ] Change `canvasColorHex()` signature to accept `{ hue: string; tone: number; intensity: number }` per Spec S04, where intensity is the DERIVED `surfaceCanvasIntensity` from `DerivationFormulas` (not the raw JSON `surface.canvas.intensity`)
- [ ] Remove the `CANVAS_COLORS` lookup table and the `ThemeName` import
- [ ] Update `sendCanvasColor()` in `theme-provider.tsx` to accept pre-derived canvas params `{ hue: string; tone: number; intensity: number }` (from `ThemeOutput.formulas`) and pass them to `canvasColorHex()`. The caller (the `setTheme` callback) is responsible for having already fetched the theme JSON and run `deriveTheme()`. In the `setTheme` callback, fetch `GET /__themes/<name>.json`, run `deriveTheme()`, and extract the canvas hue, tone, and intensity as follows:
  - **hue:** Read the `surfaceCanvasHueSlot` from `themeOutput.formulas` (e.g., `"canvas"`), then resolve it to the actual hue string from the `ThemeRecipe`'s `surface.canvas.hue` field (e.g., `"indigo-violet"`). The `DerivationFormulas` contains only the slot name, not the resolved hue string.
  - **tone:** Read `surfaceCanvasTone` from `themeOutput.formulas`
  - **intensity:** Read `surfaceCanvasIntensity` from `themeOutput.formulas` (this is the DERIVED value, not the raw JSON value)
  - Pass `{ hue, tone, intensity }` to `sendCanvasColor()`.
- [ ] Update `main.tsx` to use the pre-cached `ThemeRecipe` (fetched and cached in Step 9's startup IIFE) to derive canvas params synchronously: run `deriveTheme()` on the cached recipe, extract canvas params from `themeOutput.formulas` using the same hue resolution pattern described above (read the hue slot name from formulas, then look up the actual hue string from the recipe's `surface.canvas.hue` field), and pass to `sendCanvasColor()`. For brio (the default), the recipe is always available because brio.json is fetched during the startup sequence.

**Tests:**
- [ ] Test `canvasColorHex({ hue: "indigo-violet", tone: 5, intensity: 2 })` produces the same hex as the old `canvasColorHex("brio")` (derived intensity is 2, not 5)
- [ ] Test `canvasColorHex({ hue: "indigo-violet", tone: 95, intensity: 3 })` produces the same hex as the old `canvasColorHex("harmony")` (derived intensity is 3, matching the recipe output)
- [ ] Test with an arbitrary authored theme: run `deriveTheme()` on its JSON, extract derived canvas params, verify `canvasColorHex()` returns a valid hex

**Checkpoint:**
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `bun run audit:tokens` — passes

---

#### Step 11: Frontend Integration Checkpoint {#step-11}

**Depends on:** #step-9, #step-10

**Commit:** `N/A (verification only)`

**References:** [D07] Dynamic theme loading, [D08] Canvas color runtime, [D11] Remove Bluenote, (#success-criteria)

**Tasks:**
- [ ] Verify theme switching works end-to-end: brio (remove override), harmony (inject override from middleware)
- [ ] Verify canvas color updates correctly on theme switch
- [ ] Verify Bluenote is completely gone from the web frontend

**Tests:**
- [ ] `cd tugdeck && bun test` — full test suite passes

**Checkpoint:**
- [ ] `grep -r 'bluenote\|Bluenote' tugdeck/` — zero matches
- [ ] `bun run audit:tokens` — passes
- [ ] Manual: switch between brio and harmony in the running app; verify correct CSS and canvas color

---

#### Step 12: Rewrite generator card with Mac-style document model {#step-12}

**Depends on:** #step-9

**Commit:** `feat(theme): rewrite generator card with Mac-style document model`

**References:** [D06] Generator card uses Mac-style document model, [D09] Recipe locked at creation time, Spec S05, (#generator-new-flow, #s05-generator-state-machine)

**Artifacts:**
- `components/tugways/cards/gallery-theme-generator-content.tsx` — complete rewrite of theme management UI

**Tasks:**
- [ ] Delete `loadPreset`, `DEFAULT_RECIPE`, `handleSelectBuiltIn`, `ExportImportPanel`, and all `formulas` / `setFormulasAndRef` state
- [ ] Implement initial state: on open, load the currently active app theme via `GET /__themes/<name>.json`. If shipped, open read-only. If authored, open for editing.
- [ ] Implement New flow per (#generator-new-flow): prompt for name (unique check via `GET /__themes/list`), select prototype, copy via `POST /__themes/save`, enter Editing state
- [ ] Implement Open flow: list available themes via `GET /__themes/list`, load selected via `GET /__themes/<name>.json`. Shipped themes read-only, authored themes editable.
- [ ] Implement auto-save: debounce at 500ms after last change, write JSON + CSS to `~/.tugtool/themes/` via `POST /__themes/save`. Only active for authored themes.
- [ ] Implement Apply: inject regenerated CSS app-wide via stylesheet injection after each auto-save. Use `deriveTheme()` in-browser for immediate preview; disk write is debounced. [L06]
- [ ] Display recipe as read-only label (no Dark/Light toggle) per [D09]
- [ ] Remove the old Dark/Light mode toggle
- [ ] After save, push updated theme list to Swift for menu cache refresh via `window.webkit.messageHandlers.themeListUpdated.postMessage({ themes: [...] })` bridge message
- [ ] Preview section is the only content that updates on color changes [L06]

**Tests:**
- [ ] Rewrite `gallery-theme-generator-content.test.tsx` for New/Open/auto-save model; remove preset and formulas tests
- [ ] Rewrite `theme-export-import.test.tsx` for the new save model

**Checkpoint:**
- [ ] `cd tugdeck && bun test` — all tests pass
- [ ] `bun run audit:tokens` — passes

---

#### Step 13: Remove Bluenote from Swift and implement dynamic Theme menu {#step-13}

**Depends on:** #step-9

**Commit:** `feat(theme): dynamic Swift Theme menu via NSMenuDelegate; remove Bluenote`

**References:** [D10] Dynamic Swift Theme menu, [D11] Remove Bluenote, (#scope)

**Artifacts:**
- `AppDelegate.swift` — dynamic Theme menu, Bluenote removed, `themeListUpdated` bridge handler

**Tasks:**
- [ ] Delete `setThemeBluenote(_:)` method and its "Bluenote" menu item from `AppDelegate.swift`
- [ ] Delete `setThemeBrio(_:)` and `setThemeHarmony(_:)` hardcoded handler methods
- [ ] Remove hardcoded Brio/Harmony menu items from the Theme submenu construction
- [ ] Implement `NSMenuDelegate` conformance on the class managing the Theme submenu; implement `menuNeedsUpdate(_:)` to rebuild menu items dynamically from the cached theme list
- [ ] Add a `themeListUpdated` bridge message handler: receive `{ themes: [{ name, recipe, source }] }` from the web view and cache the list
- [ ] Build menu items dynamically: Brio first, other shipped themes, then authored themes. Checkmark on the active theme.
- [ ] Implement a single dynamic `@objc` handler that sends `set-theme` with the selected theme name
- [ ] Push theme list from web view to Swift on app launch and after each theme save

**Tests:**
- [ ] Verify `AppDelegate.swift` compiles without errors
- [ ] Verify no hardcoded Brio/Bluenote/Harmony menu item references remain

**Checkpoint:**
- [ ] `grep -r 'Bluenote\|bluenote' tugapp/` — zero matches
- [ ] `grep -r 'setThemeBrio\|setThemeHarmony\|setThemeBluenote' tugapp/` — zero matches
- [ ] Xcode build succeeds for the tugapp target

---

#### Step 14: Generator Card and Swift Integration Checkpoint {#step-14}

**Depends on:** #step-12, #step-13

**Commit:** `N/A (verification only)`

**References:** [D06] Mac-style document model, [D10] Dynamic Swift menu, (#success-criteria)

**Tasks:**
- [ ] Verify the generator card New flow creates a theme that appears in the Swift Theme menu
- [ ] Verify switching themes via the Swift menu updates the app and generator card
- [ ] Verify shipped themes open read-only in the generator card

**Tests:**
- [ ] `cd tugdeck && bun test` — full test suite passes

**Checkpoint:**
- [ ] `bun run audit:tokens` — passes
- [ ] Manual: create a new theme via generator card New, verify it appears in Swift Theme menu, switch to it, verify CSS applies

---

#### Step 15: Update tuglaws documentation {#step-15}

**Depends on:** #step-11

**Commit:** `docs(tuglaws): update theme documentation for JSON-based architecture`

**References:** [D01] Themes as JSON, [D02] Two-directory storage, [D03] Brio base theme, (#documentation-plan)

**Artifacts:**
- `tuglaws/theme-engine.md` — rewritten
- `tuglaws/design-decisions.md` — updated
- `tuglaws/laws-of-tug.md` — verified (no changes expected)
- `tuglaws/token-naming.md` — verified and updated if needed
- `tuglaws/color-palette.md` — verified and updated if needed

**Tasks:**
- [ ] Rewrite `tuglaws/theme-engine.md` to reflect themes-as-JSON architecture: document recipe vs theme vs theme output, two-directory storage with unique names, Brio as the base theme, `RECIPE_REGISTRY`, Prototype pattern, Mac-style document model. Remove references to `EXAMPLE_RECIPES`, `formulas` escape hatch, "derivation" language, Bluenote.
- [ ] Update `tuglaws/design-decisions.md`: update `[D##]` entries referencing old naming or architecture
- [ ] Verify `tuglaws/laws-of-tug.md` — confirm no changes needed
- [ ] Verify and update `tuglaws/token-naming.md` if any naming conventions changed
- [ ] Verify and update `tuglaws/color-palette.md` if any palette references changed

**Tests:**
- [ ] Documentation is internally consistent and references correct file paths

**Checkpoint:**
- [ ] All tuglaws documents reference `tugdeck/themes/` (not `EXAMPLE_RECIPES`) for theme definitions
- [ ] No references to Bluenote, `formulas` escape hatch, or `loadPreset` in tuglaws docs

---

#### Step 16: Final Integration Checkpoint {#step-16}

**Depends on:** #step-5, #step-8, #step-11, #step-14, #step-15

**Commit:** `N/A (verification only)`

**References:** [D01] Themes as JSON, [D02] Two-directory storage, [D03] Brio base theme, [D06] Mac-style document model, [D07] Dynamic theme loading, [D08] Canvas color runtime, [D10] Dynamic Swift menu, [D11] Remove Bluenote, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all success criteria are met
- [ ] Verify complete removal of obsolete code: `EXAMPLE_RECIPES`, `formulas`, `loadPreset`, `DEFAULT_RECIPE`, `ExportImportPanel`, Bluenote, `theme-recipes.ts`
- [ ] Verify two-directory theme storage works end-to-end
- [ ] Verify generator card New/Open/auto-save/Apply flow
- [ ] Verify Swift Theme menu populates dynamically
- [ ] Verify canvas color works for brio, harmony, and authored themes

**Tests:**
- [ ] `cd tugdeck && bun test` — full test suite passes
- [ ] `bun run generate:tokens` — succeeds
- [ ] `bun run audit:tokens` — passes

**Checkpoint:**
- [ ] `grep -r 'EXAMPLE_RECIPES' tugdeck/` — zero matches
- [ ] `grep 'formulas?: DerivationFormulas' tugdeck/src/components/tugways/theme-engine.ts` — zero matches (the old `ThemeRecipe` optional field is gone)
- [ ] `grep -r 'theme-recipes' tugdeck/` — zero matches
- [ ] `grep -r 'bluenote\|Bluenote' tugdeck/ tugapp/` — zero matches
- [ ] `grep -r 'loadPreset\|DEFAULT_RECIPE\|ExportImportPanel' tugdeck/src/` — zero matches
- [ ] All tests pass, all audits pass, generated CSS matches expected output

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A fully refactored theme system where themes are JSON data files with two-directory storage, a Mac-style generator card with Prototype pattern, dynamic app menu population, and runtime canvas color derivation — with identical generated CSS output and all tests passing.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tugdeck/themes/brio.json` and `tugdeck/themes/harmony.json` exist and are the sole source of theme data (`grep -r EXAMPLE_RECIPES tugdeck/` returns zero)
- [ ] `theme-recipes.ts` deleted; recipe functions live in `theme-engine.ts`
- [ ] `formulas` field removed from `ThemeRecipe`; no escape hatch code remains
- [ ] Generated CSS from JSON source is identical to pre-refactor baseline
- [ ] Vite middleware serves themes from both directories per Spec S02
- [ ] Generator card implements New/Open/auto-save/Apply per Spec S05
- [ ] Swift Theme menu populates dynamically via `NSMenuDelegate`
- [ ] `canvasColorHex()` derives from theme JSON surface params (works for any theme)
- [ ] Bluenote fully removed from codebase
- [ ] All tests pass: `cd tugdeck && bun test`
- [ ] `bun run audit:tokens` passes

**Acceptance tests:**
- [ ] `bun run generate:tokens` produces correct CSS from JSON source
- [ ] `curl /__themes/list` returns shipped and authored themes with correct `source` fields
- [ ] `POST /__themes/save` with a shipped theme name returns 400
- [ ] Theme switching works: brio (remove override), harmony (inject override), authored (inject override)
- [ ] Canvas color hex is correct for brio, harmony, and a test authored theme

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Production persistence for authored themes
- [ ] Theme deletion UI in generator card
- [ ] Additional recipe types beyond dark/light
- [ ] Theme import/export UI replacement
- [ ] Theme preview thumbnails in the Open dialog

| Checkpoint | Verification |
|------------|--------------|
| Data foundation | Steps 1-5: JSON files are sole theme source; generated CSS identical to baseline |
| Build pipeline | Steps 6-8: Token generation reads JSON; middleware serves both directories |
| Frontend | Steps 9-11: Dynamic theme loading; canvas color runtime; Bluenote removed |
| Generator + Swift | Steps 12-14: Mac-style document model; dynamic Swift menu |
| Documentation | Step 15: Tuglaws updated for new architecture |
| Final | Step 16: All success criteria met; full test suite passes |
