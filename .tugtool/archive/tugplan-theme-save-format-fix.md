<!-- tugplan-skeleton v2 -->

## Fix Theme Save Format {#theme-save-format-fix}

**Purpose:** Eliminate the crash that occurs when user-authored themes are saved and later loaded — the save endpoint currently writes a malformed JSON file (recipe field is a stringified JSON blob instead of a mode string), which causes `TypeError: Cannot read properties of undefined (reading 'canvas')` in `activateThemeOverride` and the startup plugin.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-23R2 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

When a user creates a new theme from a prototype (brio or harmony), both save call sites in `gallery-theme-generator-content.tsx` send `{ name, recipe: JSON.stringify(recipe) }` to `POST /__themes/save`. The server writes this wrapper object to disk with `recipe` as a stringified JSON blob instead of a short mode string like `"dark"`. Every consumer (`activateThemeOverride`, `themeOverridePlugin`, `generateResolvedCssExport`, `deriveTheme`) expects a valid `ThemeRecipe` with top-level `surface`, `text`, and `role` fields. The malformed file crashes on load.

Additionally, the `description` field exists on `ThemeRecipe` and shipped JSON files but serves no runtime purpose and adds validation burden. The filename strategy uses `safeName` (lowercased/slugified), which loses the user's original display name. Hash-based filenames with name-based directory scanning provide a cleaner design.

#### Strategy {#strategy}

- Fix the client first: send `ThemeRecipe` directly as the request body, not a wrapper with stringified recipe
- Remove `description` from `ThemeRecipe` interface, shipped JSON files, CSS header generation, and `validateRecipeJson`
- Replace `ThemeSaveBody` in `vite.config.ts` to match the actual `ThemeRecipe` shape (minus `description`)
- Add server-side validation rejecting JSON blobs in the `recipe` field and requiring the `surface` object
- Switch to SHA-256 hash-based filenames with name-based lookup by scanning the user themes directory
- Rename `safeName` return field to `themeName` throughout the middleware to reflect it is a display name
- Add migration guards in `activateThemeOverride` and startup plugin for legacy format files
- Close the test gap with round-trip, negative, and legacy migration tests
- Run `bun run generate:tokens` after removing `description` from shipped theme JSON files

#### Success Criteria (Measurable) {#success-criteria}

- Save a new theme from Brio prototype, inspect `~/.tugtool/themes/<hash>.json` — file has `recipe: "dark"` (not a JSON blob), top-level `surface`/`text`/`role`, and the user's original display name in the `name` field
- Activate the saved theme via POST or Swift menu — no crash, correct colors appear
- Restart dev server with a user-authored theme active — correct colors from first paint, no crash
- `bun test theme-export-import theme-middleware vite-config-activate` all pass
- Round-trip test proves save-then-activate works end-to-end
- Negative test proves old broken format (`recipe: JSON.stringify(...)`) returns HTTP 400
- Legacy migration test proves old files are automatically unwrapped and rewritten

#### Scope {#scope}

1. Fix both client save call sites to send `ThemeRecipe` directly
2. Remove `description` from `ThemeRecipe`, shipped JSON, CSS headers (including `brio.css` hardcoded comment), and `validateRecipeJson`
3. Replace `ThemeSaveBody` interface and update `handleThemesSave` validation
4. Switch to hash-based filenames and name-based directory scanning
5. Rename `safeName` to `themeName` in middleware return types and call sites
6. Update `handleThemesLoadJson` to scan directory and match by JSON `name` field
7. Add migration guards in `activateThemeOverride` and startup plugin
8. Update/add tests: round-trip, negative, legacy migration, fix export-import test
9. Run `bun run generate:tokens` after shipped JSON changes

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the theme engine derivation logic (`deriveTheme`, `darkRecipe`, `lightRecipe`)
- Adding new recipe modes beyond `dark`/`light`
- Changing the `ThemeListEntry` interface or list endpoint contract (beyond reading display name from JSON)
- Reworking the theme generator UI or slider controls

#### Dependencies / Prerequisites {#dependencies}

- Existing shipped theme JSON files (`tugdeck/themes/brio.json`, `tugdeck/themes/harmony.json`) are in correct `ThemeRecipe` format (confirmed)
- `activateThemeOverride` and `themeOverridePlugin` already exist and are testable with mocked fs
- Theme middleware tests have `makeMinimalSaveBody` helper already using correct format

#### Constraints {#constraints}

- Must not break existing shipped themes (brio, harmony)
- Must handle legacy user-authored files on disk without requiring manual cleanup
- `bun run generate:tokens` must be run after any change to shipped theme JSON files (per project memory)
- `bun run audit:tokens` must pass in checkpoint verification

#### Assumptions {#assumptions}

- The shipped theme collision check compares the incoming display name (lowercased) against shipped theme filenames — no filesystem hash lookup needed for shipped themes
- The migration guard in `activateThemeOverride` uses the same name-scan pattern as `handleThemesList` to locate legacy files by display name
- The `makeMinimalSaveBody` helper in `theme-middleware.test.ts` only has `canvas` in `surface`; it must be updated in Step 3 to include `grid`, `frame`, and `card` when `ThemeSaveBody` makes those fields required. The same applies to `makeBrioJson`, `makeHarmonyJson`, and `makeAuthoredJson`.
- Token regeneration (`bun run generate:tokens`) is safe after removing `description` because the generation script does not read or use that field

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit named anchors on all headings and labeled artifacts. See the skeleton for full conventions. Anchors are kebab-case, prefixed by type (`dNN-`, `sNN-`, `step-N`).

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Legacy files with unparseable recipe blobs | med | low | Migration guard with try/catch; corrupt files throw clear error | User reports crash loading old theme |
| Hash collision on short SHA-256 prefix | low | low | 8-char hex prefix has 4 billion values; user themes directory is tiny | Two themes produce same hash |

**Risk R01: Legacy file corruption** {#r01-legacy-corruption}

- **Risk:** Some legacy files may have doubly-stringified or truncated recipe blobs that fail `JSON.parse`.
- **Mitigation:** The migration guard wraps `JSON.parse(parsed.recipe)` in try/catch and throws a clear error message (`"Theme '<name>' has corrupt recipe data"`). The theme falls back to Brio on startup.
- **Residual risk:** User loses their custom theme if the file is truly corrupt. They can recreate it.

---

### Design Decisions {#design-decisions}

#### [D01] Send ThemeRecipe directly as request body (DECIDED) {#d01-send-recipe-directly}

**Decision:** Both client save call sites send `JSON.stringify(recipe)` as the request body — the full `ThemeRecipe` object, not a wrapper with a stringified blob.

**Rationale:**
- The on-disk format must match what consumers expect: a valid `ThemeRecipe` with top-level `surface`, `text`, `role`
- Eliminates the double-serialization bug at its source

**Implications:**
- `handleThemesSave` receives a proper `ThemeRecipe` and writes it to disk as-is
- `ThemeSaveBody` interface must match `ThemeRecipe` shape

#### [D02] Remove description field from ThemeRecipe (DECIDED) {#d02-remove-description}

**Decision:** Drop the `description` field from `ThemeRecipe` interface and all references — minimal targeted change, just remove the description check from `validateRecipeJson` and the field from the interface, shipped JSON files, and CSS header generation.

**Rationale:**
- `description` is unused at runtime — it only appears in CSS comment headers and validation
- Removing it simplifies the interface and avoids requiring users to provide a description when creating themes

**Implications:**
- Remove from `ThemeRecipe` interface in `theme-engine.ts`
- Remove from shipped JSON files (`brio.json`, `harmony.json`)
- Remove `@theme-description` line from CSS header generation in `generateResolvedCssExport` (`theme-engine.ts`) and `generateCssExport` (`cards/gallery-theme-generator-content.tsx`)
- Remove `@theme-description` line from hardcoded comment header in `tugdeck/styles/brio.css`
- Remove description check from `validateRecipeJson`
- Run `bun run generate:tokens` after shipped JSON changes

#### [D03] Hash-based filenames with name-based lookup (DECIDED) {#d03-hash-filenames}

**Decision:** User-authored theme filenames use an 8-character SHA-256 hex prefix of the theme name. Lookup is by scanning the directory and matching the JSON `name` field.

**Rationale:**
- Decouples the filename from the display name — no lossy slugification
- The `name` field in JSON is the canonical identifier; the filename is an opaque storage detail
- Directory scanning is trivial for a directory with a handful of files

**Implications:**
- `handleThemesSave` computes `createHash("sha256").update(name.trim()).digest("hex").slice(0, 8)` for the filename
- `activateThemeOverride`, `handleThemesLoadJson`, and `handleThemesList` scan the user directory and match by JSON `name` field
- Shipped themes keep direct filename lookup (`${themeName}.json`) since their filenames match their names

#### [D04] Rename safeName to themeName (DECIDED) {#d04-rename-themename}

**Decision:** Rename the `safeName` return field in `handleThemesSave` to `themeName` to reflect it is now the user's display name, not a slugified safe name.

**Rationale:**
- With hash-based filenames, the returned name is the user's original display name
- `safeName` is misleading when the value is no longer sanitized for filesystem use

**Implications:**
- Update the `handleThemesSave` return type and all references in middleware
- Update the save middleware in `themeSaveLoadPlugin` that reads `saveResult.safeName`

#### [D05] Server-side validation rejects JSON blobs in recipe field (DECIDED) {#d05-server-validation}

**Decision:** `handleThemesSave` validates that `recipe` is a non-empty string that does not start with `{`, and that `surface` is a non-null object.

**Rationale:**
- Catches the old broken client format at the API boundary
- Does not hardcode `"dark" | "light"` — lets `deriveTheme` be the source of truth for valid modes
- The `startsWith("{")` check is unambiguous: valid mode strings never start with `{`

**Implications:**
- Old clients sending the wrapped format get HTTP 400 with a clear error message
- Future recipe modes are automatically supported without updating validation

#### [D06] Migration guard for legacy format files (DECIDED) {#d06-migration-guard}

**Decision:** `activateThemeOverride` and `themeOverridePlugin` detect legacy format (`typeof parsed.recipe === "string" && parsed.recipe.startsWith("{")`) and unwrap the stringified recipe. The file is rewritten in canonical format on successful migration.

**Rationale:**
- Users who created themes before the fix have malformed files on disk
- Auto-migration avoids requiring manual cleanup
- Rewriting the file means migration runs once

**Implications:**
- Migration guard in `activateThemeOverride` after `JSON.parse(raw)`
- Same guard in `themeOverridePlugin` `configResolved` hook
- Best-effort rewrite: if write fails, the parsed recipe is still usable for the session

#### [D07] Update handleThemesLoadJson to scan directory (DECIDED) {#d07-scan-load-json}

**Decision:** Update `handleThemesLoadJson` to scan the user themes directory and match by JSON `name` field, same pattern as `handleThemesList`.

**Rationale:**
- With hash-based filenames, the URL parameter is the theme display name, not the filename
- Shipped themes keep direct filename lookup since their filenames match their names

**Implications:**
- `handleThemesLoadJson` tries shipped dir by direct filename first, then scans user dir by JSON name field
- The middleware extracts the theme name from the URL path; since the client uses `encodeURIComponent`, the server must call `decodeURIComponent()` on the extracted name before lookup
- Consistent with `handleThemesList` scanning pattern

---

### Specification {#specification}

**Spec S01: ThemeSaveBody replacement** {#s01-save-body}

The `ThemeSaveBody` interface in `vite.config.ts` is replaced with a shape matching `ThemeRecipe` minus `description`:

```typescript
interface ThemeSaveBody {
  name: string;
  recipe: string;  // "dark", "light", or future modes — NOT a JSON blob
  surface: {
    canvas: { hue: string; tone: number; intensity: number };
    grid: { hue: string; tone: number; intensity: number };
    frame: { hue: string; tone: number; intensity: number };
    card: { hue: string; tone: number; intensity: number };
  };
  text: { hue: string; intensity: number };
  display?: { hue: string; intensity: number };
  border?: { hue: string; intensity: number };
  role: {
    tone: number;
    intensity: number;
    accent: string;
    action: string;
    agent: string;
    data: string;
    success: string;
    caution: string;
    danger: string;
  };
}
```

Note: `grid`, `frame`, and `card` are required (not optional) to match `ThemeRecipe`. Both `deriveTheme` and `activateThemeOverride` read these fields unconditionally, so accepting optional values would defer failures to activation time.

**Spec S02: Save endpoint validation** {#s02-save-validation}

`handleThemesSave` validates:
1. `name` is a non-empty string (existing check)
2. `recipe` is a non-empty string that does NOT start with `{`
3. `surface` is a non-null object
4. Shipped theme collision check compares `name.trim().toLowerCase()` against shipped theme names

**Spec S03: Hash-based filename** {#s03-hash-filename}

```typescript
import { createHash } from "node:crypto";
const hash = createHash("sha256").update(name.trim()).digest("hex").slice(0, 8);
const jsonPath = path.join(userDir, `${hash}.json`);
```

**Spec S04: Name-based directory scan** {#s04-name-scan}

For user themes, scan the directory reading each `.json` file and matching the JSON `name` field:

```typescript
function findUserThemeByName(name: string, fsImpl: FsReadImpl, userDir: string): string | null {
  let files: string[];
  try { files = fsImpl.readdirSync(userDir).filter(f => f.endsWith(".json")); }
  catch { return null; }
  for (const file of files) {
    try {
      const raw = fsImpl.readFileSync(path.join(userDir, file), "utf-8");
      const parsed = JSON.parse(raw) as { name?: string };
      if (parsed.name === name) return path.join(userDir, file);
    } catch { /* skip */ }
  }
  return null;
}
```

**Spec S05: Legacy format detection and migration** {#s05-legacy-migration}

Detection: `typeof parsed.recipe === "string" && parsed.recipe.startsWith("{")`

Migration: `JSON.parse(parsed.recipe)` to unwrap, then rewrite file in canonical format (best-effort).

**Note:** Existing legacy files have a slugified `name` field (e.g., `"my-cool-theme"` instead of `"My Cool Theme"`) because the old `handleThemesSave` wrote `name: safeName`. The migration guard does not attempt to recover the original display name — it preserves whatever `name` value exists in the file. This is acceptable because the slug-based name is still usable as a display name and uniquely identifies the theme.

---

### Compatibility / Migration / Rollout (Optional) {#rollout}

- **Compatibility policy**: No versioning needed. The fix is backward-compatible via the migration guard.
- **Migration plan**:
  - Legacy user-authored files with stringified recipe blobs are auto-migrated on first load
  - Migration rewrites the file in canonical format so it only runs once
  - If rewrite fails, the theme still works for the current session
  - Legacy files retain their slugified `name` field (e.g., `"my-cool-theme"`); the migration guard does not attempt to recover the original display name
  - When a user re-saves a theme, `handleThemesSave` scans for and deletes any existing file with the same JSON `name` field before writing the new hash-named file, preventing orphaned legacy files from creating duplicate entries
- **Rollout plan**:
  - Ship all changes in a single branch; no feature gate needed
  - Old clients sending the broken format get HTTP 400 — the fix is on the client side too

---

### Definitive Symbol Inventory {#symbol-inventory}

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ThemeRecipe.description` | field | `theme-engine.ts` | REMOVE |
| `ThemeSaveBody` | interface | `vite.config.ts` | Replace to match ThemeRecipe shape minus description |
| `findUserThemeByName` | fn | `vite.config.ts` | New helper: scan user dir, match by JSON name field |
| `handleThemesSave` | fn | `vite.config.ts` | Update validation, hash filenames, rename safeName to themeName |
| `handleThemesLoadJson` | fn | `vite.config.ts` | Update to scan user dir by name |
| `handleThemesList` | fn | `vite.config.ts` | Update to read display name from JSON name field |
| `activateThemeOverride` | fn | `vite.config.ts` | Add migration guard, use name-scan for user themes |
| `themeOverridePlugin` | fn | `vite.config.ts` | Update file lookup to name-scan for user themes (Step 4), add migration guard (Step 5) |
| `handleThemesActivate` | fn | `vite.config.ts` | Passes theme name to `activateThemeOverride`; covered transitively by name-scan changes |
| `controlTokenHotReload` | fn | `vite.config.ts` | Calls `activateThemeOverride` with active-theme value; covered transitively by name-scan changes |
| `validateRecipeJson` | fn | `cards/gallery-theme-generator-content.tsx` | Remove description check |
| `generateCssExport` | fn | `cards/gallery-theme-generator-content.tsx` | Remove `@theme-description` line |
| `generateResolvedCssExport` | fn | `theme-engine.ts` (line 2977) | Remove `@theme-description` line from CSS header |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Validate individual functions: `validateRecipeJson`, `handleThemesSave` validation, `findUserThemeByName` | Each function in isolation |
| **Integration** | Round-trip save-then-activate, legacy migration end-to-end | Prove the data path works from client format through disk to activation |
| **Negative** | Old broken format rejected by save endpoint | Regression prevention |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Remove description field from ThemeRecipe and shipped JSON {#step-1}

**Commit:** `fix(theme): remove description field from ThemeRecipe and shipped JSON`

**References:** [D02] Remove description field, (#context, #strategy)

**Artifacts:**
- Modified `ThemeRecipe` interface in `theme-engine.ts`
- Modified `brio.json` and `harmony.json` (description key removed)
- Modified CSS header generation in `generateResolvedCssExport` (`theme-engine.ts`) and `generateCssExport` (`cards/gallery-theme-generator-content.tsx`) (`@theme-description` line removed)
- Modified `@theme-description` line in `tugdeck/styles/brio.css` (hardcoded comment header)
- Modified `validateRecipeJson` in `cards/gallery-theme-generator-content.tsx` (description check removed)
- Regenerated tokens

**Tasks:**
- [ ] Remove `description` field from `ThemeRecipe` interface in `tugdeck/src/components/tugways/theme-engine.ts` (line 282)
- [ ] Remove `"description"` key from `tugdeck/themes/brio.json`
- [ ] Remove `"description"` key from `tugdeck/themes/harmony.json`
- [ ] Remove the `@theme-description` line from `generateResolvedCssExport` header in `theme-engine.ts` (line 2988)
- [ ] Remove the `@theme-description` line from `generateCssExport` header in `cards/gallery-theme-generator-content.tsx` (line 900)
- [ ] Remove the description validation check from `validateRecipeJson` in `cards/gallery-theme-generator-content.tsx` (lines 941-943)
- [ ] Remove the `@theme-description` line from the hardcoded comment header in `tugdeck/styles/brio.css` (line 3)
- [ ] Fix any TypeScript errors caused by removing `description` (search for `recipe.description` and `.description` references)
- [ ] Run `bun run generate:tokens` to regenerate tokens after shipped JSON changes
- [ ] Run `bun run audit:tokens` to verify token integrity

**Tests:**
- [ ] Existing `validateRecipeJson` tests pass (the ones checking valid recipes no longer need description)
- [ ] Update test fixtures that include `description` field — remove it from:
  - `theme-middleware.test.ts`: `makeBrioJson` (line 44), `makeHarmonyJson` (line 55), `makeAuthoredJson` (line 66)
  - `theme-export-import.test.tsx`: test recipe objects at lines 97, 107, 112, 118, 123, 128, 129, 137 (approximately 8 test objects)

**Checkpoint:**
- [ ] `cd tugdeck && npx tsc --noEmit` exits 0
- [ ] `cd tugdeck && bun test theme-export-import` passes
- [ ] `cd tugdeck && bun run generate:tokens` succeeds
- [ ] `cd tugdeck && bun run audit:tokens` passes

---

#### Step 2: Fix client save call sites to send ThemeRecipe directly {#step-2}

**Depends on:** #step-1

**Commit:** `fix(theme): send ThemeRecipe directly in save requests`

**References:** [D01] Send ThemeRecipe directly, (#context)

**Artifacts:**
- Modified `cards/gallery-theme-generator-content.tsx` — both save call sites

**Tasks:**
- [ ] In `NewThemeDialog.handleCreate` (around line 1428-1431), change `body: JSON.stringify({ name: newRecipe.name, recipe: JSON.stringify(newRecipe) })` to `body: JSON.stringify(newRecipe)`
- [ ] In `performSave` (around line 1936-1939), change `body: JSON.stringify({ name: recipe.name, recipe: JSON.stringify(recipe) })` to `body: JSON.stringify(recipe)`

**Tests:**
- [ ] Update `theme-export-import.test.tsx` save model test: change expected request body from `{ name, recipe: JSON.stringify(recipe) }` to the full recipe object. Update assertions to verify `body.recipe` is a mode string and `body.surface` is an object.

**Checkpoint:**
- [ ] `cd tugdeck && npx tsc --noEmit` exits 0
- [ ] `cd tugdeck && bun test theme-export-import` passes

---

#### Step 3: Replace ThemeSaveBody and add server-side validation {#step-3}

**Depends on:** #step-2

**Commit:** `fix(theme): replace ThemeSaveBody, add recipe/surface validation`

**References:** [D05] Server-side validation, Spec S01, Spec S02, (#strategy)

**Artifacts:**
- Modified `ThemeSaveBody` interface in `vite.config.ts`
- Modified `handleThemesSave` validation logic

**Tasks:**
- [ ] Replace `ThemeSaveBody` interface in `vite.config.ts` (lines 220-243) with the shape from Spec S01 (no `description` field)
- [ ] Update validation in `handleThemesSave` (around line 397-401):
  - Keep existing `recipe` non-empty string check
  - Add check: if `recipe.startsWith("{")`, return 400 with `"recipe must be a mode string (e.g. 'dark'), not a JSON object"`
  - Add check: if `!b.surface || typeof b.surface !== "object"`, return 400 with `"surface field is required"`
- [ ] Ensure the `normalizedRecipe` spread at line 406 still works (it will, since the body now has the correct shape)

**Tests:**
- [ ] Update `makeMinimalSaveBody` in `theme-middleware.test.ts` to include `grid`, `frame`, and `card` in the `surface` object, matching the new required fields in `ThemeSaveBody` (Spec S01)
- [ ] Update `makeBrioJson`, `makeHarmonyJson`, and `makeAuthoredJson` in `theme-middleware.test.ts` to include `grid`, `frame`, and `card` in the `surface` object, matching the new required fields
- [ ] Add negative test in `theme-middleware.test.ts`: calling `handleThemesSave` with old broken format (`recipe: JSON.stringify(fullRecipe)`) returns status 400
- [ ] Add negative test: body with missing `surface` returns 400

**Checkpoint:**
- [ ] `cd tugdeck && npx tsc --noEmit` exits 0
- [ ] `cd tugdeck && bun test theme-middleware` passes

---

#### Step 4: Switch to hash-based filenames and name-scan lookup {#step-4}

**Depends on:** #step-3

**Commit:** `fix(theme): hash-based filenames, name-scan lookup, rename safeName to themeName`

**References:** [D03] Hash-based filenames, [D04] Rename safeName to themeName, [D07] Update handleThemesLoadJson, Spec S03, Spec S04, (#strategy)

**Artifacts:**
- Modified `handleThemesSave` — hash filename, rename `safeName` to `themeName`
- New `findUserThemeByName` helper in `vite.config.ts`
- Modified `activateThemeOverride` — use name-scan for user themes
- Modified `handleThemesLoadJson` — scan user dir by name, add `decodeURIComponent` to name extraction
- Modified `handleThemesList` — read display name from JSON `name` field for authored themes
- Modified `themeSaveLoadPlugin` middleware — use `themeName` instead of `safeName`
- Modified `themeOverridePlugin` — update user-theme file lookup to use name-scan (hash filenames require it)

**Tasks:**
- [ ] Add `import { createHash } from "node:crypto"` at top of `vite.config.ts`
- [ ] Add `findUserThemeByName(name, fsImpl, userDir)` helper function per Spec S04
- [ ] In `handleThemesSave`:
  - Replace `safeName` derivation with hash: `createHash("sha256").update(name.trim()).digest("hex").slice(0, 8)`
  - Use `path.join(userDir, \`${hash}.json\`)` for the file path
  - Store `name.trim()` as the display name in the JSON (not the hash)
  - Update shipped theme collision check to compare `name.trim().toLowerCase()` against shipped theme filenames
  - Before writing the new hash-named file, scan the user directory for any existing file with the same JSON `name` field (including legacy slug-named files) and delete it to prevent duplicate theme entries
  - Rename return field from `safeName` to `themeName`, returning the user's display name
- [ ] In `activateThemeOverride`:
  - For non-brio/non-shipped themes, use `findUserThemeByName` instead of direct `${themeName}.json` path
  - Keep shipped theme lookup by direct filename
- [ ] In `handleThemesLoadJson`:
  - Keep shipped dir lookup by direct filename
  - For user dir, use `findUserThemeByName` instead of direct `${name}.json` path
- [ ] In the `themeSaveLoadPlugin` middleware that extracts the theme name from the URL (line 610 of `vite.config.ts`), add `decodeURIComponent()` to the name extraction: change `const name = url.replace(/^\//, "").slice(0, -5)` to `const name = decodeURIComponent(url.replace(/^\//, "").slice(0, -5))` — without this, theme names containing spaces (sent as `%20` by the client's `encodeURIComponent`) will fail the name-scan lookup
- [ ] In `themeOverridePlugin` `configResolved` hook (lines 89-97), update the user-theme file lookup to use name-scan instead of direct `${activeTheme}.json` path:
  - Keep shipped dir lookup by direct filename: `path.join(SHIPPED_THEMES_DIR, \`${activeTheme}.json\`)`
  - Replace user dir lookup: call `findUserThemeByName(activeTheme, fs as unknown as FsReadImpl, USER_THEMES_DIR)` to reuse the shared helper instead of duplicating scan logic
  - This is required because after the plan changes `active-theme` to store the display name and filenames become hashes, the old `${activeTheme}.json` lookup will fail for user themes
- [ ] In `handleThemesList`:
  - For authored themes, read the JSON `name` field and use it as the display name (instead of deriving name from filename)
- [ ] In `themeSaveLoadPlugin` middleware:
  - Update the save handler to use `saveResult.themeName` instead of `saveResult.safeName`
  - Update the response body and `activateThemeOverride` call accordingly
- [ ] Update the `handleThemesSave` return type from `{ status, body, safeName }` to `{ status, body, themeName }`

**Tests:**
- [ ] Update `theme-middleware.test.ts` tests that reference `safeName` to use `themeName`
- [ ] Fully rewrite the `"sanitizes name to safe kebab-case filename"` test (line 335 of `theme-middleware.test.ts`) — after hash-based filenames, assertions must verify hash-named file creation rather than kebab-case naming
- [ ] Add test verifying that saving a theme with display name "My Cool Theme" creates a hash-named file, and the JSON inside has `name: "My Cool Theme"`
- [ ] Add test verifying `findUserThemeByName` returns the correct path
- [ ] Add test verifying that re-saving an existing theme deletes the old file (including legacy slug-named files) and writes only the new hash-named file, preventing duplicate entries
- [ ] Add test verifying `handleThemesLoadJson` works with a URL-encoded theme name containing spaces (e.g., name `"My Cool Theme"` extracted from URL as `"My%20Cool%20Theme"` must be decoded before name-scan lookup)
- [ ] Update `handleThemesLoadJson` tests to work with hash-based filenames

**Checkpoint:**
- [ ] `cd tugdeck && npx tsc --noEmit` exits 0
- [ ] `cd tugdeck && bun test theme-middleware` passes
- [ ] `cd tugdeck && bun test vite-config-activate` passes

---

#### Step 5: Add migration guards for legacy format files {#step-5}

**Depends on:** #step-4

**Commit:** `fix(theme): add migration guard for legacy stringified-recipe files`

**References:** [D06] Migration guard for legacy format, Spec S05, Risk R01, (#rollout)

**Artifacts:**
- Modified `activateThemeOverride` in `vite.config.ts` — legacy detection and unwrap
- Modified `themeOverridePlugin` in `vite.config.ts` — legacy migration guard (file lookup already updated to name-scan in Step 4)

**Tasks:**
- [ ] In `activateThemeOverride`, after `JSON.parse(raw)` (line 496), add legacy detection:
  - If `typeof parsed.recipe === "string" && parsed.recipe.startsWith("{")`: parse the nested recipe, use it as the recipe object, and rewrite the file in canonical format (best-effort)
  - Wrap the inner `JSON.parse` in try/catch; on failure throw `"Theme '<name>' has corrupt recipe data"`
- [ ] In `themeOverridePlugin`, after `JSON.parse(raw)` (line 107), add legacy detection and migration guard
  - For migration file rewrites, use `fs.writeFileSync` directly (the plugin uses real fs, not injected `fsImpl`)
  - **Note:** `themeOverridePlugin` uses the CJS wrapper `require('./src/theme-css-generator').generateThemeCSS`, not the ESM `generateResolvedCssExport` directly. Ensure migration changes are compatible with this CJS entry point.
- [ ] Ensure both migration paths use the canonical format: full `ThemeRecipe` with top-level fields

**Tests:**
- [ ] Add test in `vite-config-activate.test.ts`: write a legacy-format file (with stringified recipe blob), call `activateThemeOverride`, verify it succeeds and returns correct `canvasParams`
- [ ] Verify the legacy file is rewritten in canonical format after migration
- [ ] Add test for corrupt legacy file (invalid JSON inside recipe string) — verify clear error message

**Checkpoint:**
- [ ] `cd tugdeck && npx tsc --noEmit` exits 0
- [ ] `cd tugdeck && bun test vite-config-activate` passes

---

#### Step 6: Round-trip integration test {#step-6}

**Depends on:** #step-4, #step-5

**Commit:** `test(theme): add round-trip save-activate integration test`

**References:** [D01] Send ThemeRecipe directly, [D03] Hash-based filenames, [D06] Migration guard, (#success-criteria)

**Artifacts:**
- New or extended test in `vite-config-activate.test.ts`

**Tasks:**
- [ ] Add round-trip test: call `handleThemesSave` with a valid `ThemeRecipe` body, then call `activateThemeOverride` with the theme name — verify it succeeds, returns correct `canvasParams`, and the saved JSON on disk is a valid `ThemeRecipe`
- [ ] Verify the saved file's `recipe` field is a short mode string (not a JSON blob)
- [ ] Verify `surface.canvas` has `hue`, `tone`, `intensity` fields

**Tests:**
- [ ] Round-trip save-then-activate test passes end-to-end

**Checkpoint:**
- [ ] `cd tugdeck && bun test vite-config-activate` passes
- [ ] `cd tugdeck && bun test theme-middleware` passes
- [ ] `cd tugdeck && bun test theme-export-import` passes

---

#### Step 7: Final verification checkpoint {#step-7}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5, #step-6

**Commit:** `N/A (verification only)`

**References:** [D01] Send ThemeRecipe directly, [D02] Remove description, [D03] Hash-based filenames, [D05] Server-side validation, [D06] Migration guard, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all TypeScript compilation passes with no errors
- [ ] Verify all theme-related tests pass
- [ ] Verify `bun run generate:tokens` produces clean output
- [ ] Verify `bun run audit:tokens` passes
- [ ] Verify `bun run build` exits 0

**Tests:**
- [ ] `cd tugdeck && bun test theme-export-import theme-middleware vite-config-activate` — all theme-related test suites pass with no failures

**Checkpoint:**
- [ ] `cd tugdeck && npx tsc --noEmit`
- [ ] `cd tugdeck && bun test theme-export-import theme-middleware vite-config-activate`
- [ ] `cd tugdeck && bun run generate:tokens`
- [ ] `cd tugdeck && bun run audit:tokens`
- [ ] `cd tugdeck && bun run build`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** User-authored themes save in canonical `ThemeRecipe` format and load without crashes in `activateThemeOverride` and the startup plugin. Legacy files are auto-migrated.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Both client save call sites send `ThemeRecipe` directly (no wrapper, no stringified blob)
- [ ] `handleThemesSave` rejects old broken format with HTTP 400
- [ ] Saved JSON files have `recipe: "dark"` (mode string), top-level `surface`/`text`/`role`, and display name in `name` field
- [ ] `activateThemeOverride` loads user-authored themes without crash
- [ ] `themeOverridePlugin` loads user-authored themes on server restart without crash
- [ ] Legacy format files are auto-migrated and rewritten
- [ ] All tests pass: `bun test theme-export-import theme-middleware vite-config-activate`
- [ ] `bun run build` exits 0

**Acceptance tests:**
- [ ] Round-trip save-activate test passes
- [ ] Negative test for old broken format returns 400
- [ ] Legacy migration test passes
- [ ] Token generation and audit pass after description removal

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add `bun test gallery-theme-generator-content` component-level tests for the save flow (currently covered indirectly)
- [ ] Consider adding a schema version field to theme JSON for future format evolution

| Checkpoint | Verification |
|------------|--------------|
| TypeScript compiles | `npx tsc --noEmit` exits 0 |
| All theme tests pass | `bun test theme-export-import theme-middleware vite-config-activate` |
| Token generation clean | `bun run generate:tokens && bun run audit:tokens` |
| Production build | `bun run build` exits 0 |
