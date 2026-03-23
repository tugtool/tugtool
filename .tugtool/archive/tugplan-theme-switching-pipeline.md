<!-- tugplan-skeleton v2 -->

## Theme Switching Pipeline {#theme-switching-pipeline}

**Purpose:** Replace the broken runtime CSS injection (`<style>` element with unprocessed `--tug-color()`) with a file-based override that flows through Vite's CSS pipeline, so all theme switches produce correct PostCSS-expanded `oklch()` values from first paint through every runtime switch.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-03-22 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Runtime theme switching is completely broken for non-Brio themes. The current approach fetches theme CSS from a Vite middleware endpoint and injects it into a `<style>` element. That CSS contains `--tug-color()` notation, a custom syntax that only `postcss-tug-color` understands. The browser cannot parse `--tug-color()`, silently ignores every chromatic token declaration, and all chromatic tokens fall back to Brio's base values. The result: switching to Harmony shows Brio's dark surfaces, wrong text colors, broken grid, and unstyled cards.

The root cause is that PostCSS only runs on CSS files in Vite's module graph (imported via the JS import chain). The runtime-injected `<style>` element bypasses the entire pipeline. The fix is to make all theme CSS flow through Vite's CSS pipeline as a real file on disk.

#### Strategy {#strategy}

- Route all theme CSS through a single override file (`tug-theme-override.css`) that is already `@import`'d by `tug-base.css` and in Vite's module graph
- Add a Vite plugin (`themeOverridePlugin`) that writes the correct override at startup from `.tugtool/active-theme`, ensuring zero flash on first paint
- Add a `POST /__themes/activate` endpoint that rewrites the override file on theme switch, letting Vite HMR deliver the change atomically
- Serialize override file writes with a Promise chain mutex to prevent concurrent write corruption
- Handle production via pre-built CSS `<link>` swapping (no Vite dev server) with a static `THEME_CANVAS_PARAMS` map
- Remove all `<style>` injection code, CSS fetching middleware, and themeCSSMap caching
- Keep `liveTokenStyle` inline preview in the generator card unchanged; app-wide preview waits for the debounced POST

#### Success Criteria (Measurable) {#success-criteria}

- Switching to Harmony in dev shows correct Harmony colors (not Brio fallback) within 1 second of click (measured by visual inspection and CSS token value check in devtools)
- Refreshing the page with `.tugtool/active-theme` set to `harmony` shows Harmony from first paint with no flash of Brio (verified by recording startup)
- `document.querySelectorAll('style#tug-theme-override')` returns empty NodeList at all times (no `<style>` injection)
- `bun run build` succeeds and the production bundle includes per-theme CSS assets in the output
- Generator card auto-save updates the app-wide theme after the 500ms debounce completes (no immediate app-wide update from slider moves)

#### Scope {#scope}

1. Vite plugin (`themeOverridePlugin`) for startup override file creation
2. `POST /__themes/activate` endpoint with Promise chain mutex
3. Rewrite of `theme-provider.tsx` to use activate endpoint (dev) / link swap (production)
4. Simplification of `main.tsx` startup (remove CSS pre-fetching)
5. Update `handleThemesSave` to trigger activate after save
6. Update `controlTokenHotReload` to re-derive active override after engine changes
7. Update generator card to use new activate flow, remove direct `injectThemeCSS` calls
8. `.gitignore` entry for `tug-theme-override.css`
9. Remove `handleThemesLoadCss` / `GET /__themes/<name>.css` endpoint
10. Static `THEME_CANVAS_PARAMS` map generation for production
11. Production `<link>` swap mechanism in `theme-provider.tsx`

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing the `--tug-color()` notation or `postcss-tug-color` plugin
- Modifying `generate-tug-tokens.ts` beyond ensuring the override file exists when missing
- Changing the two-directory theme storage model (shipped in repo, authored in home dir)
- Changing `deriveTheme()` or `generateThemeCSS()` internals
- Adding new themes or modifying existing theme recipes
- Changing the Swift bridge `set-theme` / `themeListUpdated` protocol

#### Dependencies / Prerequisites {#dependencies}

- `tug-theme-override.css` already exists on disk and `tug-base.css` already has the `@import` (verified: both are present)
- `postcss-tug-color` correctly expands `--tug-color()` in any CSS file in Vite's module graph (verified: HMR tested both directions Brio to Harmony to Brio)
- `generateThemeCSS()` in `src/theme-css-generator.ts` produces valid CSS with `--tug-color()` notation from a recipe

#### Constraints {#constraints}

- Must not introduce any flash of wrong theme on startup or switch
- Must not break the Swift bridge canvas color protocol
- The override file write + PostCSS + HMR delivery latency is acceptable (sub-second) but must not cause intermediate states
- `bun run build` must produce a working production bundle with all shipped theme CSS assets

#### Assumptions {#assumptions}

- The `themeOverridePlugin` runs in the `configResolved` hook (async-capable) to guarantee the file is correct before Vite processes any CSS
- The `GET /__themes/<name>.css` endpoint is removed from `vite.config.ts` as part of this change
- The `THEME_CANVAS_PARAMS` static map is generated by `generate-tug-tokens.ts` and bundled as a TypeScript constant for production use
- The production `<link>` swap mechanism targets files at `/assets/themes/<name>.css` corresponding to Vite build output of per-theme CSS files in `styles/themes/`
- `tug-theme-override.css` already exists and is `.gitignore`'d (gitignore entry still needs to be added)

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

No open questions. All clarifying questions have been resolved via user answers.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Override file write race condition | med | low | Promise chain mutex serializes all writes | If theme switch corruption is observed |
| HMR latency on slow machines | low | low | Acceptable trade-off; liveTokenStyle provides instant preview in generator | If user reports perceptible delay on switch |
| Production link swap flash | med | low | Pre-load theme CSS via `<link rel="preload">` if needed | If flash observed in production builds |

**Risk R01: Override file write race** {#r01-write-race}

- **Risk:** Concurrent writes to `tug-theme-override.css` from Swift menu and generator auto-save could produce corrupted CSS
- **Mitigation:** Promise chain mutex — a `pending` variable where each write chains onto the previous promise. No external dependencies needed.
- **Residual risk:** If the process crashes mid-write, the file could be truncated. Startup plugin re-derives from `.tugtool/active-theme` on next launch, so this self-heals.

**Risk R02: Production theme asset paths** {#r02-production-paths}

- **Risk:** Vite's build output may hash theme CSS filenames, breaking the `<link>` swap path
- **Mitigation:** Use Vite's manifest or a known output structure to map theme names to asset paths. Validate during the production step.
- **Residual risk:** If Vite changes asset naming conventions, the mapping code must be updated.

---

### Design Decisions {#design-decisions}

#### [D01] All theme CSS flows through Vite's CSS pipeline via a single override file (DECIDED) {#d01-single-override-file}

**Decision:** Theme switching writes to `styles/tug-theme-override.css`, which is `@import`'d by `tug-base.css`. PostCSS processes it as part of Vite's module graph. No `<style>` element injection.

**Rationale:**
- The `<style>` injection approach bypasses PostCSS, leaving `--tug-color()` unresolved in the browser
- A file in the import chain is processed by PostCSS and delivered via HMR atomically

**Implications:**
- Theme switches have file I/O + PostCSS + HMR latency (sub-second)
- The override file must exist before Vite starts (handled by startup plugin)

#### [D02] Startup plugin writes override in configResolved (DECIDED) {#d02-startup-plugin}

**Decision:** A Vite plugin (`themeOverridePlugin`) writes the correct contents of `tug-theme-override.css` during `configResolved`, before Vite processes any CSS.

**Rationale:**
- Guarantees the override file has the correct theme CSS before any module is resolved
- Handles fresh clones (no `.tugtool/active-theme` → empty override → Brio)
- Handles build mode (always empty override → Brio default)

**Implications:**
- The plugin must load `generateThemeCSS` via lazy `require("./src/theme-css-generator")` inside the function body (not a top-level import) to avoid circular dependency issues at module parse time
- If the active-theme references a deleted theme, the plugin logs a warning to the dev server terminal and falls back to Brio (empty override)

#### [D03] POST /__themes/activate is the single activation path (DECIDED) {#d03-activate-endpoint}

**Decision:** A new `POST /__themes/activate` endpoint rewrites the override file and returns `{ theme, canvasParams }`. All runtime theme switches in dev mode go through this endpoint.

**Rationale:**
- Centralizes file write + theme derivation on the server side
- Returns canvas params in the same response, eliminating the second JSON fetch
- Vite HMR delivers the CSS update automatically after the file write

**Implications:**
- `setTheme` in the browser becomes a single POST + canvas color update
- The endpoint needs a mutex to serialize writes (see [D05])

#### [D04] Keep putTheme alongside activate (DECIDED) {#d04-dual-persistence}

**Decision:** Both `putTheme()` (tugcast/Swift bridge via `/api/settings`) and `POST /__themes/activate` (`.tugtool/active-theme` for Vite startup) are called on theme switch. They serve different purposes.

**Rationale:**
- `.tugtool/active-theme` is read by the Vite plugin at startup — this is the server-side source of truth for dev mode
- `/api/settings` via `putTheme()` persists the theme for the tugcast/Swift bridge and cross-session recall
- Removing either would break a persistence path

**Implications:**
- Two writes on every theme switch (acceptable; both are fast local writes)

#### [D05] Promise chain mutex for write serialization (DECIDED) {#d05-promise-chain-mutex}

**Decision:** A simple Promise chain (`let pending = Promise.resolve()`) serializes all writes to `tug-theme-override.css`. Each write chains via `pending = pending.catch(() => {}).then(fn)` to ensure `fn` executes exactly once regardless of whether the previous write succeeded or failed.

**Rationale:**
- No external dependencies needed
- Works correctly for this sequential use case (Swift menu vs. generator auto-save)
- Simpler than a full async mutex library

**Implications:**
- All activation calls are serialized (no parallel writes)

#### [D06] Generator card preview uses debounced activate (DECIDED) {#d06-debounced-preview}

**Decision:** `liveTokenStyle` (inline `oklch()` on the preview canvas) updates immediately on slider move. App-wide theme update waits for the 500ms debounced `POST /__themes/activate`.

**Rationale:**
- Instant preview feedback in the generator card
- No excessive file writes during rapid slider movement
- App-wide update is delivered by HMR after debounce completes

**Implications:**
- Brief window where generator preview shows new colors but rest of app shows previous save's colors
- CSS HMR catches everything up atomically — no intermediate state

#### [D07] Remove css field from save body (DECIDED) {#d07-no-css-in-save}

**Decision:** The `POST /__themes/save` endpoint no longer accepts or writes a `css` field. The server derives CSS from the JSON recipe via `generateThemeCSS()`.

**Rationale:**
- CSS is a derived artifact of the JSON recipe — storing it separately is redundant
- The server already has `generateThemeCSS()` available
- Eliminates a class of bugs where JSON and CSS get out of sync

**Implications:**
- `handleThemesSave` no longer writes `<name>.css` to `~/.tugtool/themes/`
- Save triggers activate, which writes to the single override file

#### [D08] Production uses link swap with static canvas params (DECIDED) {#d08-production-link-swap}

**Decision:** In production, theme switching swaps a `<link>` element pointing to pre-built theme CSS. Canvas params come from a static `THEME_CANVAS_PARAMS` map generated at build time.

**Rationale:**
- No Vite dev server in production — cannot use file write + HMR
- Pre-built CSS has PostCSS already applied — browser gets correct `oklch()` values
- Static canvas params map eliminates runtime derivation and fetch

**Implications:**
- `generate-tug-tokens.ts` must emit the `THEME_CANVAS_PARAMS` map
- Theme CSS assets must be included in the Vite build output

---

### Specification {#specification}

#### Activate Endpoint {#activate-endpoint}

**Spec S01: POST /__themes/activate** {#s01-activate}

- **Method:** POST
- **Path:** `/__themes/activate`
- **Content-Type:** `application/json`
- **Request body:** `{ "theme": "<name>" }`
- **Response (200):** `{ "theme": "<name>", "canvasParams": { "hue": "<hue>", "tone": <number>, "intensity": <number> } }`
- **Response (404):** `{ "error": "Theme '<name>' not found" }`
- **Side effects:** Writes `styles/tug-theme-override.css`, writes `.tugtool/active-theme`

#### Override File Contract {#override-file-contract}

**Spec S02: tug-theme-override.css** {#s02-override-file}

| State | File contents |
|------|--------------|
| Brio active | Empty (or comment-only `/* empty - brio default */`) |
| Non-Brio active | Full `body {}` block with all token overrides using `--tug-color()` notation |
| Fresh clone (no active-theme) | Empty (Brio default) |
| Build mode | Always empty (Brio default) |

The file is processed by PostCSS as part of Vite's module graph. The browser never sees `--tug-color()`.

#### Production Theme Switching {#production-switching}

**Spec S03: Production link swap** {#s03-production-link}

| Action | Mechanism |
|------|----------|
| Switch to shipped theme | Set `<link id="tug-theme-override" href="/assets/themes/<name>.css">` |
| Switch to Brio | Remove the `<link>` element — Brio base tokens take over |

#### Canvas Params Map {#canvas-params-map}

**Spec S04: THEME_CANVAS_PARAMS** {#s04-canvas-params-map}

Generated by `generate-tug-tokens.ts` at build time. Exported from a generated file for import by `theme-provider.tsx`.

```typescript
export const THEME_CANVAS_PARAMS: Record<string, CanvasColorParams> = {
  brio: { hue: "indigo-violet", tone: 5, intensity: 2 },
  harmony: { hue: "indigo-violet", tone: 95, intensity: 3 },
};
```

#### Save Endpoint Changes {#save-endpoint-changes}

**Spec S05: Updated POST /__themes/save** {#s05-save-changes}

After writing JSON to `~/.tugtool/themes/`, the save handler triggers the activate logic (rewrites `tug-theme-override.css` with the updated theme). No separate `<name>.css` file is written to `~/.tugtool/themes/`.

#### setTheme Unified Flow {#settheme-flow}

**Spec S06: setTheme implementation** {#s06-settheme}

```typescript
async function setTheme(themeName: string): Promise<void> {
  if (import.meta.env.DEV) {
    const res = await fetch("/__themes/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: themeName }),
    });
    const { canvasParams } = await res.json();
    sendCanvasColor(canvasParams);
  } else {
    activateProductionTheme(themeName);
    sendCanvasColor(THEME_CANVAS_PARAMS[themeName]);
  }
  setThemeState(themeName);
  localStorage.setItem("td-theme", themeName);
  putTheme(themeName);
}
```

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/generated/theme-canvas-params.ts` | Build-time generated `THEME_CANVAS_PARAMS` map |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `themeOverridePlugin` | fn (VitePlugin) | `tugdeck/vite.config.ts` | Writes override file in `configResolved` |
| `handleThemesActivate` | fn | `tugdeck/vite.config.ts` | Handler for `POST /__themes/activate` |
| `activateThemeOverride` | fn | `tugdeck/vite.config.ts` | Shared logic: derive CSS, write override, write active-theme, return canvas params |
| `writeMutex` | variable | `tugdeck/vite.config.ts` | Promise chain for serializing writes |
| `activateProductionTheme` | fn | `tugdeck/src/contexts/theme-provider.tsx` | Production `<link>` swap |
| `THEME_CANVAS_PARAMS` | const | `tugdeck/src/generated/theme-canvas-params.ts` | Static canvas params map |
| `handleThemesLoadCss` | fn (REMOVE) | `tugdeck/vite.config.ts` | Remove CSS fetching endpoint |
| `themeCSSMap` | variable (REMOVE) | `tugdeck/src/contexts/theme-provider.tsx` | Remove CSS text cache |
| `registerThemeCSS` | fn (REMOVE) | `tugdeck/src/contexts/theme-provider.tsx` | Remove pre-registration |
| `injectThemeCSS` | fn (REMOVE) | `tugdeck/src/contexts/theme-provider.tsx` | Remove `<style>` injection |
| `removeThemeCSS` | fn (REMOVE) | `tugdeck/src/contexts/theme-provider.tsx` | Remove `<style>` removal |
| `applyInitialTheme` | fn (REMOVE) | `tugdeck/src/contexts/theme-provider.tsx` | Remove startup injection |
| `cachedActiveRecipe` | variable (MODIFY) | `tugdeck/src/main.tsx` | Change from exported to local variable (only used within main.tsx) |
| `injectThemeCSS` imports | import (REMOVE) | `tugdeck/src/__tests__/theme-export-import.test.tsx` | Remove import and 7+ call sites |
| `removeThemeCSS` imports | import (REMOVE) | `tugdeck/src/__tests__/theme-export-import.test.tsx` | Remove import and call sites |
| `removeThemeCSS` imports | import (REMOVE) | `tugdeck/src/__tests__/gallery-theme-generator-content.test.tsx` | Remove import and 8+ afterEach call sites |
| `handleThemesLoadCss` tests | test block (REMOVE) | `tugdeck/src/__tests__/theme-middleware.test.ts` | Remove import and all CSS loading tests |
| `generateResolvedCssExport` import | import (REMOVE) | `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx` | Remove import and all 3 call sites; function remains in `theme-engine.ts` |
| `handleThemesSave` tests | test block (MODIFY) | `tugdeck/src/__tests__/theme-middleware.test.ts` | Update to match new behavior (no CSS file write) |

---

### Documentation Plan {#documentation-plan}

- [ ] Update inline doc comments in `theme-provider.tsx` to describe new file-based mechanism
- [ ] Update inline doc comments in `vite.config.ts` for new plugins and endpoints
- [ ] Update roadmap document status if desired after implementation

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test `handleThemesActivate` with mocked fs | Activate endpoint logic, error handling |
| **Unit** | Test `activateProductionTheme` link swap | Production theme switching DOM manipulation |
| **Integration** | Test full activate flow (write file, verify contents) | End-to-end activation path |
| **Manual** | Verify HMR delivery and zero-flash startup | Visual confirmation of theme switching |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add gitignore entry and active-theme persistence {#step-1}

**Commit:** `chore: add gitignore for tug-theme-override.css and active-theme file`

**References:** [D01] Single override file, [D04] Dual persistence, Spec S02, (#assumptions, #override-file-contract)

**Artifacts:**
- `tugdeck/.gitignore` — add `styles/tug-theme-override.css` entry
- `.tugtool/active-theme` — document that this file is created by the activate endpoint (not checked in)

**Tasks:**
- [ ] Add `styles/tug-theme-override.css` to `tugdeck/.gitignore`
- [ ] Verify `tug-theme-override.css` already exists on disk and already has the `@import` in `tug-base.css` (line 25)

**Tests:**
- [ ] Verify gitignore entry prevents `tug-theme-override.css` from appearing in `git status` output

**Checkpoint:**
- [ ] `grep 'tug-theme-override' tugdeck/.gitignore` shows the entry
- [ ] `ls tugdeck/styles/tug-theme-override.css` confirms the file exists
- [ ] `grep 'tug-theme-override' tugdeck/styles/tug-base.css` shows the `@import`

---

#### Step 2: Add themeOverridePlugin to vite.config.ts {#step-2}

**Depends on:** #step-1

**Commit:** `feat(vite): add themeOverridePlugin for startup theme override`

**References:** [D02] Startup plugin, Spec S02, (#context, #override-file-contract)

**Artifacts:**
- `tugdeck/vite.config.ts` — new `themeOverridePlugin()` function

**Tasks:**
- [ ] Implement `themeOverridePlugin()` as a Vite plugin with `configResolved` hook
- [ ] In `configResolved`: read `.tugtool/active-theme` (default to `"brio"` if missing)
- [ ] If `command === "build"`: always write empty override
- [ ] If Brio: ensure `styles/tug-theme-override.css` exists and is empty (or comment-only)
- [ ] If non-Brio: read theme JSON from shipped or user dir, run `deriveTheme()` + `generateThemeCSS()`, write CSS to `styles/tug-theme-override.css`. Load `generateThemeCSS` via lazy `require("./src/theme-css-generator")` inside the function body (matching the existing `makeRuntimeCssGenerator` pattern in vite.config.ts), not via a top-level import, to avoid circular dependency issues at module parse time
- [ ] If the active-theme file references a theme whose JSON no longer exists on disk (shipped or user dir): log a visible warning to the dev server terminal (e.g., `[themeOverridePlugin] theme "foo" not found, falling back to Brio`), write empty override, and continue with Brio
- [ ] Add `themeOverridePlugin()` to the plugins array in `defineConfig`
- [ ] Handle fresh clone: no `.tugtool/active-theme` file → create empty override → Brio

**Tests:**
- [ ] Manual: delete `tug-theme-override.css`, run `bun run dev`, confirm file is recreated
- [ ] Manual: set `.tugtool/active-theme` to `harmony`, restart dev server, confirm Harmony from first paint

**Checkpoint:**
- [ ] `bun run dev` starts without errors (verify in terminal output)
- [ ] `cat tugdeck/styles/tug-theme-override.css` shows correct content for current active theme
- [ ] `bun run build` succeeds (override is empty for build)

---

#### Step 3: Add POST /__themes/activate endpoint with mutex {#step-3}

**Depends on:** #step-2

**Commit:** `feat(vite): add POST /__themes/activate endpoint with write mutex`

**References:** [D03] Activate endpoint, [D05] Promise chain mutex, Spec S01, Risk R01, (#activate-endpoint, #r01-write-race)

**Artifacts:**
- `tugdeck/vite.config.ts` — new `handleThemesActivate` function, `activateThemeOverride` shared logic, `writeMutex` variable, endpoint registration in middleware

**Tasks:**
- [ ] Implement `activateThemeOverride(themeName)` — shared logic that: finds theme JSON, loads `generateThemeCSS` via lazy `require("./src/theme-css-generator")` inside the function body (not a top-level import, matching the existing pattern), runs `deriveTheme()` + `generateThemeCSS()`, writes override file (empty for Brio), writes `.tugtool/active-theme`, returns `{ theme, canvasParams }`
- [ ] Implement `writeMutex` as a Promise chain: `let pending = Promise.resolve(); function withMutex(fn) { pending = pending.catch(() => {}).then(fn); return pending; }` — note: `.catch(() => {}).then(fn)` swallows the previous rejection and executes `fn` exactly once; the alternative `.then(fn).catch(fn)` would double-execute `fn` if the previous promise rejects
- [ ] Implement `handleThemesActivate` — parse request body, validate `theme` field, call `activateThemeOverride` inside `withMutex`, return response
- [ ] Register `POST /activate` route in `themeSaveLoadPlugin`'s middleware (or create a new plugin)
- [ ] Return `{ theme, canvasParams }` on success, `{ error }` on failure

**Tests:**
- [ ] Unit test: `handleThemesActivate` with mocked fs for Brio → empty override file
- [ ] Unit test: `handleThemesActivate` with mocked fs for non-Brio → CSS content in override file
- [ ] Unit test: `handleThemesActivate` with unknown theme → 404

**Checkpoint:**
- [ ] `curl -X POST http://localhost:5173/__themes/activate -H 'Content-Type: application/json' -d '{"theme":"harmony"}'` returns `{ "theme": "harmony", "canvasParams": {...} }`
- [ ] `cat tugdeck/styles/tug-theme-override.css` contains Harmony CSS after activation
- [ ] `cat .tugtool/active-theme` contains `harmony`
- [ ] `curl -X POST http://localhost:5173/__themes/activate -H 'Content-Type: application/json' -d '{"theme":"brio"}'` returns success and override file is empty

---

#### Step 4: Update controlTokenHotReload to re-derive active override {#step-4}

**Depends on:** #step-3

**Commit:** `feat(vite): extend controlTokenHotReload to re-derive active theme override`

**References:** [D01] Single override file, [D02] Startup plugin, (#context, #d01-single-override-file)

**Artifacts:**
- `tugdeck/vite.config.ts` — updated `controlTokenHotReload` plugin

**Tasks:**
- [ ] After `regenerate()` call in `controlTokenHotReload`, read `.tugtool/active-theme`
- [ ] If non-Brio: re-derive and rewrite `tug-theme-override.css` for the currently active theme using the same `activateThemeOverride` logic (or a subset that just rewrites the file)
- [ ] If Brio: ensure override file is empty (already the case from `regenerate()`)

**Tests:**
- [ ] Manual: activate Harmony, then edit `theme-engine.ts` (add a comment), verify that Harmony override is regenerated with updated engine output

**Checkpoint:**
- [ ] With Harmony active, modify `theme-engine.ts`, observe HMR update reflects engine change in both base tokens and override
- [ ] `bun run build` still succeeds

---

#### Step 5: Update handleThemesSave to trigger activate {#step-5}

**Depends on:** #step-3

**Commit:** `feat(vite): handleThemesSave triggers activate after save`

**References:** [D03] Activate endpoint, [D07] No CSS in save, Spec S05, (#save-endpoint-changes, #s05-save-changes)

**Artifacts:**
- `tugdeck/vite.config.ts` — updated `handleThemesSave` and middleware
- `tugdeck/src/__tests__/theme-middleware.test.ts` — update `handleThemesSave` tests to match new behavior (no CSS file write, activate triggered instead)

**Tasks:**
- [ ] Restructure the save middleware handler to bridge sync-to-async: `handleThemesSave` remains synchronous for the JSON write and returns `{ status, body, safeName }` — the `safeName` field exposes the sanitized theme name so the middleware can pass it to `activateThemeOverride(safeName)`. After `handleThemesSave` returns successfully, the middleware calls `activateThemeOverride(safeName)` via `writeMutex` and defers `res.writeHead`/`res.end` until the returned promise settles. This avoids making `handleThemesSave` itself async while still serializing the override file write.
- [ ] Remove the CSS file write from `handleThemesSave` (no more `<name>.css` in `~/.tugtool/themes/`)
- [ ] Update save response to include `canvasParams` from the activate result (returned by the awaited `activateThemeOverride`)
- [ ] Update `theme-middleware.test.ts`: revise `handleThemesSave` tests to assert no CSS file is written, and that the override file is written instead

**Tests:**
- [ ] Unit test: `handleThemesSave` no longer writes CSS file to user themes dir
- [ ] Unit test: `handleThemesSave` triggers override file write
- [ ] Existing `theme-middleware.test.ts` tests updated and passing

**Checkpoint:**
- [ ] `curl -X POST http://localhost:5173/__themes/save -H 'Content-Type: application/json' -d '{"name":"test-theme","recipe":"dark",...}'` saves JSON and activates
- [ ] No `test-theme.css` in `~/.tugtool/themes/`
- [ ] `cat tugdeck/styles/tug-theme-override.css` shows the saved theme's CSS
- [ ] `bun test theme-middleware` passes

---

#### Step 6: Remove GET /__themes/<name>.css endpoint {#step-6}

**Depends on:** #step-3

**Commit:** `refactor(vite): remove GET /__themes/<name>.css endpoint`

**References:** [D01] Single override file, [D03] Activate endpoint, (#d01-single-override-file, #d03-activate-endpoint)

**Artifacts:**
- `tugdeck/vite.config.ts` — remove `handleThemesLoadCss` and CSS endpoint from middleware
- `tugdeck/src/__tests__/theme-middleware.test.ts` — remove `handleThemesLoadCss` import and tests

**Tasks:**
- [ ] Remove the `handleThemesLoadCss` function
- [ ] Remove the `GET *.css` route handler from the middleware
- [ ] Remove the `makeRuntimeCssGeneratorFromPath` function (no longer needed)
- [ ] Remove the `SHIPPED_THEMES_CSS_DIR` constant (no longer needed for CSS serving)
- [ ] Update `theme-middleware.test.ts`: remove `handleThemesLoadCss` import and all tests exercising the CSS loading endpoint

**Tests:**
- [ ] Verify `GET /__themes/harmony.css` returns 404 (endpoint removed)
- [ ] `theme-middleware.test.ts` compiles with no references to `handleThemesLoadCss`

**Checkpoint:**
- [ ] `curl http://localhost:5173/__themes/harmony.css` returns 404
- [ ] `bun run build` succeeds
- [ ] No TypeScript compilation errors
- [ ] `bun test theme-middleware` passes

---

#### Step 7: Server-side integration checkpoint {#step-7}

**Depends on:** #step-4, #step-5, #step-6

**Commit:** `N/A (verification only)`

**References:** [D01] Single override file, [D02] Startup plugin, [D03] Activate endpoint, [D05] Promise chain mutex, (#success-criteria)

**Tasks:**
- [ ] Verify all server-side changes work together end-to-end
- [ ] Test: startup with Harmony active → correct override → restart → still Harmony
- [ ] Test: activate Brio → override empty → activate Harmony → override has CSS
- [ ] Test: save authored theme → override updated → HMR delivers change
- [ ] Test: edit `theme-engine.ts` with Harmony active → both base and override regenerated

**Tests:**
- [ ] Manual: full round-trip — activate Harmony, verify override CSS, restart dev server, confirm persistence, activate Brio, verify empty override

**Checkpoint:**
- [ ] `bun run dev` starts cleanly with no warnings
- [ ] All four test scenarios above pass via manual verification

---

#### Step 8: Rewrite theme-provider.tsx and simplify main.tsx imports {#step-8}

**Depends on:** #step-7

**Commit:** `refactor(theme): rewrite setTheme to use POST /__themes/activate, remove old imports from main.tsx`

**References:** [D01] Single override file, [D02] Startup plugin, [D03] Activate endpoint, [D04] Dual persistence, [D06] Debounced preview, Spec S01, Spec S06, (#settheme-flow, #d02-startup-plugin, #s02-override-file)

**Artifacts:**
- `tugdeck/src/contexts/theme-provider.tsx` — rewritten `setTheme`, removed injection helpers
- `tugdeck/src/main.tsx` — remove `applyInitialTheme` and `registerThemeCSS` imports and call sites, simplify startup IIFE
- `tugdeck/src/__tests__/theme-export-import.test.tsx` — remove `injectThemeCSS` and `removeThemeCSS` imports and calls; update or remove the "injectThemeCSS + removeThemeCSS DOM contract" test
- `tugdeck/src/__tests__/gallery-theme-generator-content.test.tsx` — remove `removeThemeCSS` import and replace all `removeThemeCSS()` calls in `afterEach` blocks with appropriate cleanup for the new mechanism

**Tasks:**
- [ ] Remove `themeCSSMap`, `registerThemeCSS`, `injectThemeCSS`, `removeThemeCSS`, `applyInitialTheme`, `OVERRIDE_ELEMENT_ID` constant from `theme-provider.tsx`
- [ ] Rewrite `setTheme` to: POST to `/__themes/activate`, extract `canvasParams` from response, call `sendCanvasColor(canvasParams)`, update state, persist to localStorage, call `putTheme()`
- [ ] Keep `deriveCanvasParams`, `sendCanvasColor`, `registerInitialCanvasParams` (still used for startup canvas color)
- [ ] Keep `loadSavedThemes` unchanged
- [ ] Keep `useThemeContext`, `useOptionalThemeContext` unchanged
- [ ] Update imports: remove unused React imports if any
- [ ] In `main.tsx`: remove `registerThemeCSS` import and the CSS pre-fetching loop that iterates over the theme list to call `registerThemeCSS` for each theme. Keep `themeListRes` in the `Promise.all` destructuring -- it is consumed by the `themeListUpdated` Swift bridge `postMessage` call (line 219) and must not be removed
- [ ] In `main.tsx`: remove `applyInitialTheme` import and call (override file is already correct from startup plugin)
- [ ] In `main.tsx`: keep the `fetchThemeWithRetry()` call to determine `initialTheme` for state initialization
- [ ] In `main.tsx`: keep canvas color derivation: fetch theme JSON → `deriveCanvasParams()` → `registerInitialCanvasParams()` → `sendCanvasColor()` for Swift bridge
- [ ] In `main.tsx`: keep the `/__themes/list` fetch for the Swift bridge `themeListUpdated` postMessage — only remove the CSS pre-fetching loop that iterates over the list to call `registerThemeCSS` for each theme. The list fetch itself and `themeListUpdated` call remain intact.
- [ ] In `main.tsx`: change `cachedActiveRecipe` from an exported variable to a local variable (remove the `export` keyword). It is only used within `main.tsx` for canvas param derivation, not for CSS registration.
- [ ] Update `theme-export-import.test.tsx`: remove `injectThemeCSS` and `removeThemeCSS` imports, remove or rewrite the 7+ call sites that use these functions, update or remove the "injectThemeCSS + removeThemeCSS DOM contract" test block
- [ ] Update `theme-export-import.test.tsx`: in the "theme-save - new save model" describe block (lines 187-241), update the three tests to reflect [D07] — the save body sends `{ name, recipe }` only (no `css` field). Remove the `css` variable construction via `generateResolvedCssExport`, remove `css` from the `JSON.stringify` body, remove the `expect(typeof body["css"]).toBe("string")` assertion and the `expect(body["css"]).not.toContain("--tug-color(")` assertion. The second and third tests (`generateResolvedCssExport produces CSS...` and `saved CSS contains body {} block`) should be removed entirely since the client no longer generates resolved CSS for saving — the server derives CSS from the recipe.
- [ ] Update `gallery-theme-generator-content.test.tsx`: remove `removeThemeCSS` import, replace all 8+ `removeThemeCSS()` calls in `afterEach` blocks with no-op or appropriate cleanup (the override file mechanism does not require DOM cleanup in tests)

**Tests:**
- [ ] Manual: click Harmony in Swift Theme menu → correct Harmony colors appear everywhere
- [ ] Manual: click Brio → returns to Brio colors
- [ ] Verify no `<style id="tug-theme-override">` element in DOM at any point
- [ ] Manual: fresh page load with Harmony as active theme → Harmony from first paint, no Brio flash
- [ ] `bun test theme-export-import` passes with updated test file
- [ ] `bun test gallery-theme-generator-content` passes with updated test file

**Checkpoint:**
- [ ] `bun run dev` starts without errors
- [ ] Theme switching works via Swift menu (action-dispatch → setTheme → POST activate)
- [ ] Page load shows correct theme from first paint
- [ ] `document.querySelectorAll('style#tug-theme-override').length === 0` in browser console
- [ ] `bun test theme-export-import` passes
- [ ] `bun test gallery-theme-generator-content` passes
- [ ] No TypeScript compilation errors (`bun run build` succeeds)

---

#### Step 9: Update gallery-theme-generator-content.tsx {#step-9}

**Depends on:** #step-8

**Commit:** `refactor(generator): remove injectThemeCSS, use activate endpoint`

**References:** [D06] Debounced preview, [D07] No CSS in save, Spec S05, (#d06-debounced-preview, #s05-save-changes)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/gallery-theme-generator-content.tsx` — updated auto-save and theme application

**Tasks:**
- [ ] Remove `injectThemeCSS` import
- [ ] In the recipe-change `useEffect` (around line 1972): remove the `injectThemeCSS` call and its surrounding `if`-block, but preserve the `setThemeOutput(output)` call (line 1975) — it drives the local preview state and must remain
- [ ] In the `handleNewCreated` callback (around line 2055): remove the `generateResolvedCssExport` call and `injectThemeCSS(name, css)` call. The subsequent `themeCtx.setTheme(name)` call handles app-wide activation via `POST /__themes/activate` + HMR
- [ ] In `performSave` (around line 1998): remove the `generateResolvedCssExport` call and the `css` field from the save body. The save body should send only `{ name, recipe }` — the server derives CSS from the recipe per [D07]
- [ ] In the "create-new-theme" flow (around line 1489): remove the `generateResolvedCssExport` call and `css` field from the save body, sending only `{ name, recipe }`
- [ ] Remove the `generateResolvedCssExport` import if no call sites remain
- [ ] `liveTokenStyle` inline preview remains unchanged (immediate visual feedback)
- [ ] The auto-save debounce handles app-wide activation: after `POST /__themes/save` returns, the server has already activated the theme (override file rewritten, HMR delivers CSS)

**Tests:**
- [ ] Manual: open generator card, adjust slider → preview updates instantly → after 500ms, app-wide theme updates via HMR

**Checkpoint:**
- [ ] No `injectThemeCSS` references in the file
- [ ] Generator card preview works (instant slider feedback)
- [ ] App-wide theme updates after debounce
- [ ] `bun run build` succeeds

---

#### Step 10: Add production link swap and THEME_CANVAS_PARAMS {#step-10}

**Depends on:** #step-8

**Commit:** `feat(theme): add production link swap and static canvas params map`

**References:** [D08] Production link swap, Spec S03, Spec S04, Risk R02, (#production-switching, #canvas-params-map)

**Artifacts:**
- `tugdeck/src/generated/theme-canvas-params.ts` — generated static map
- `tugdeck/scripts/generate-tug-tokens.ts` — emit canvas params map during generation
- `tugdeck/src/contexts/theme-provider.tsx` — `activateProductionTheme` function, production branch in `setTheme`

**Tasks:**
- [ ] Update `generate-tug-tokens.ts` to emit `THEME_CANVAS_PARAMS` map to `src/generated/theme-canvas-params.ts` after deriving all shipped themes
- [ ] Implement `activateProductionTheme(themeName)` in `theme-provider.tsx`: find or create `<link id="tug-theme-override">`, set `href` to theme CSS asset path (or remove element for Brio)
- [ ] Add production branch to `setTheme`: use `activateProductionTheme` + lookup from `THEME_CANVAS_PARAMS` instead of POST
- [ ] Ensure `src/generated/` directory exists (create if needed)

**Tests:**
- [ ] Verify `THEME_CANVAS_PARAMS` is generated with correct values for all shipped themes
- [ ] `bun run build` succeeds and includes theme CSS assets

**Checkpoint:**
- [ ] `cat tugdeck/src/generated/theme-canvas-params.ts` shows correct map
- [ ] `bun run build` produces theme CSS assets in output
- [ ] `bun run generate:tokens` regenerates the canvas params map

---

#### Step 11: Final integration checkpoint {#step-11}

**Depends on:** #step-8, #step-9, #step-10

**Commit:** `N/A (verification only)`

**References:** [D01] Single override file, [D03] Activate endpoint, [D08] Production link swap, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Full end-to-end verification of all theme switching paths
- [ ] Verify no `<style id="tug-theme-override">` element exists in DOM at any point
- [ ] Verify no references to `injectThemeCSS`, `removeThemeCSS`, `registerThemeCSS`, `themeCSSMap` remain in codebase
- [ ] Verify `GET /__themes/<name>.css` endpoint no longer exists
- [ ] Verify `.tugtool/active-theme` persistence works across dev server restarts

**Tests:**
- [ ] Manual: full end-to-end verification — Swift menu theme cycle, generator card preview, zero-flash startup, production build
- [ ] Verify no dead code remains: `grep -r 'injectThemeCSS\|removeThemeCSS\|registerThemeCSS\|themeCSSMap' tugdeck/src/` returns no matches

**Checkpoint:**
- [ ] `bun run dev` — switch themes via Swift menu: Brio → Harmony → Brio (all correct)
- [ ] `bun run dev` — generator card: sliders update preview instantly, app-wide updates after debounce
- [ ] `bun run dev` — restart with Harmony active: Harmony from first paint
- [ ] `bun run build` succeeds with no warnings
- [ ] `grep -r 'injectThemeCSS\|removeThemeCSS\|registerThemeCSS\|themeCSSMap' tugdeck/src/` returns no matches
- [ ] `bun run audit:tokens` passes (if applicable)

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Theme switching works correctly for all themes (shipped and authored) in both dev and production modes, using Vite's CSS pipeline instead of `<style>` injection.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Switching to any non-Brio theme shows correct colors (no Brio fallback) (`document.documentElement.style` check or devtools token inspection)
- [ ] No `<style id="tug-theme-override">` element exists in the DOM at any time (`document.querySelectorAll` returns empty)
- [ ] Page load with non-Brio active theme shows correct theme from first paint (visual verification)
- [ ] `bun run build` succeeds and production bundle includes theme CSS assets
- [ ] `injectThemeCSS`, `removeThemeCSS`, `registerThemeCSS`, `themeCSSMap` are fully removed from the codebase

**Acceptance tests:**
- [ ] Dev: Swift menu Brio → Harmony → Brio cycle produces correct colors at each step
- [ ] Dev: Generator card slider → instant preview → debounced app-wide update
- [ ] Dev: Server restart with `.tugtool/active-theme` set to harmony → Harmony from first paint
- [ ] Dev: Edit `theme-engine.ts` with Harmony active → both base and override regenerate
- [ ] Build: `bun run build` completes without errors or warnings

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Add `<link rel="preload">` for production theme CSS to reduce swap latency
- [ ] Consider service worker caching for production theme CSS
- [ ] Add automated Playwright test for theme switching (visual regression)

| Checkpoint | Verification |
|------------|--------------|
| Theme switching works in dev | Swift menu cycle + generator card test |
| No style injection | `grep -r 'injectThemeCSS' tugdeck/src/` returns nothing |
| Production build succeeds | `bun run build` exits 0 |
| Zero-flash startup | Visual verification with non-Brio active |
