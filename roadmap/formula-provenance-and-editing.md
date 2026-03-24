# Formula Provenance and Inline Editing

Show which DerivationFormulas fields control each CSS token in the style inspector,
then let the user edit them in place.

## Phase 1 — Read-Only Provenance

**Goal:** When the inspector panel is pinned on an element, show a "Formula" section
listing the formula fields that affect that element's colors and their current values.

```
FORMULA
  contentTextIntensity  intensity  = 4
  contentTextTone       tone       = 8
```

### New files

- `src/components/tugways/formula-reverse-map.ts` — Proxy-based reverse map.
  Calls each rule's expression functions with a Proxy that intercepts property
  accesses. Produces a bidirectional map: `fieldToTokens` (formula field → which
  tokens it affects) and `tokenToFields` (token → which formula fields control it).
  Dispatches on rule type (chromatic, shadow, highlight, structural; skips
  white/invariant). Handles hue slot mediation for formulas-dispatched slots.

- `src/__tests__/formula-reverse-map.test.ts` — Unit tests with mock rules plus
  integration test against the real RULES table.

- `src/__tests__/formulas-cache.test.ts` — Tests for the GET endpoint.

### Changes to vite.config.ts

- Add `FormulasCache` interface and `formulasCache` module-level variable.
- Populate the cache from `ActivateResult` at three call sites:
  `configResolved` (via subprocess — already returns formulas in its output),
  `reactivateActiveTheme` (same), and `handleThemesActivate` (POST handler).
- Add `ActivateResult.formulas` and `ActivateResult.mode` fields.
- Add `handleFormulasGet` function and register `GET /__themes/formulas` route.
- Update `generate-theme-override.ts` to output formulas JSON alongside the CSS
  (or add a second subprocess that extracts formulas from the theme output).

### Changes to style-inspector-overlay.ts

- Import `buildReverseMap`, `ReverseMap`, `RULES`.
- Add `reverseMap` and `formulasData` instance fields.
- On `activate()`: build the reverse map (cached for session).
- On `activate()` and `inspectElement()`: fetch `GET /__themes/formulas`.
- In `renderPanel()`: after token chain sections, if `formulasData` is available,
  call `buildFormulaSectionForInspection` which looks up `tokenToFields` for the
  terminal token in each chain and renders `createFormulaSection` (read-only DOM).
- Add CSS for formula rows in `style-inspector-overlay.css`.

### Changes to generate-theme-override.ts

- Extend the subprocess script to also write formulas JSON to stdout or a
  sidecar file, so the Vite process can populate `formulasCache` without
  requiring theme-engine in-process.

## Phase 2 — Inline Editing

**Goal:** Click a formula value in the inspector → type a new number → press
Enter → value is written to the recipe file → hot-reload delivers the update.

### New endpoint

- `POST /__themes/formula` — accepts `{ field, value }`. Reads the active
  recipe file (dark.ts or light.ts based on cached mode). Regex-replaces the
  field's RHS with the new literal value. Writes the file. Returns 200.
  That's it. No regeneration, no cache update, no subprocess calls in the
  handler. The file write triggers the existing `handleHotUpdate` recipe
  handler which runs `regenerate()` + `reactivateActiveTheme()`.

### Inspector changes

- Make formula values clickable. On click, replace the value `<span>` with
  an `<input type="text">` (or `type="number"` for numeric fields).
- On Enter or blur: POST the value, revert the input back to a span.
- The hot-reload pipeline delivers the CSS update (~500ms round-trip).
- On next `inspectElement` call: re-fetch `GET /__themes/formulas` to show
  updated values.
- Hue slot fields: use a `<select>` dropdown with the ResolvedHueSlots keys.
- Boolean fields: read-only (no edit control).

### What this intentionally does NOT include

- No sliders. No drag preview. No two-phase commit.
- No client-side oklch parsing or CSS custom property manipulation.
- No pointer capture or pointermove handlers.
- No separate refresh mechanism — hot-reload handles everything.

## Lessons Learned

These are hard-won from the failed first attempt. Do not ignore them.

### Vite config dependency tracking

**Any file reachable via `require()` from vite.config.ts is a config dep.**
When a config dep changes, Vite restarts the dev server — killing all WebSocket
connections and showing the SharedWorker CSP error. This includes transitive
deps: `require("theme-engine")` → `import("recipes/dark")` makes recipe files
config deps.

**Vite statically scans `require("...")` string literals in the config file.**
Even `require()` calls inside function bodies that never execute during startup
are detected. The workaround: construct the path dynamically so the scanner
can't trace it: `require([".", "src", "theme-engine"].join("/"))`.

**The safest approach: use subprocesses.** Both `configResolved` and
`reactivateActiveTheme` now use `execSync("bun run script.ts ...")` instead
of in-process `require()`. The subprocess loads theme-engine in its own
process, so the Vite process never touches the recipe dependency chain.

### Token name formats

RULES keys already include the `--tug-` prefix (e.g.,
`"--tug-surface-global-primary-normal-app-rest"`). The reverse map stores
them as-is. **Never add another `--tug-` prefix** when looking up CSS
properties from the reverse map. The original implementation had a double-prefix
bug that silently broke all drag preview snapshots.

### require() caching

Node's `require()` caches modules forever. If the Vite process loads
theme-engine at any point, subsequent `require()` calls return the stale
cached version — even after the recipe file has been edited. The subprocess
approach avoids this entirely (each subprocess gets fresh module state).
Do not add `require()` calls for theme-engine or recipe files to vite.config.ts
without understanding this consequence.

### handleHotUpdate return values

- `return;` (undefined) — Vite proceeds with default module-graph HMR, which
  can cascade to a full page reload for .ts files.
- `return [];` (empty array) — Vite skips default HMR. Use this for all
  handlers that do their own regeneration.
- `regenerate()` writes to `src/generated/*.ts` files which are in the module
  graph. Without a handler that returns `[]` for those files, they trigger
  their own HMR cascade.

### Keep it simple

The two-phase drag preview (snapshot oklch → delta on pointermove → remove
overrides on pointerup → POST → refresh) had six interacting async mechanisms.
It required pointer capture (which broke native range input behavior),
`setProperty`/`removeProperty` on the body, oklch parsing, and a 150ms delay
hack for the refresh race condition. All of this existed to avoid a ~500ms
round-trip that the hot-reload pipeline now handles correctly. Don't rebuild it.
