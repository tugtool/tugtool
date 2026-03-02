<!-- tugplan-skeleton v2 -->

## Tugways Phase 1: Theme Foundation {#tugways-phase-1-theme}

**Purpose:** Establish the loadable theme architecture -- rename the token prefix, split themes into separate CSS files with stylesheet injection, add motion tokens, create the `components/tugways/` directory, implement `TugThemeProvider`, and wire the Mac menu Theme submenu -- so that themes load as CSS files and the directory structure is ready for component development.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-1-theme |
| Last updated | 2026-03-02 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Phase 0 (Demolition) is complete. The tugdeck frontend is now a minimal canvas shell: ~300 lines of working code that loads, shows a dark grid, and connects to the backend. The three themes (Brio, Bluenote, Harmony) are still hardcoded in `tokens.css` as `body.td-theme-*` CSS class blocks, with Bluenote and Harmony each redundantly specifying ~80 values that bypass the `var()` derivation chain. Theme switching works via body class toggling in `use-theme.ts`, and `DeckManager.readCurrentThemeFromDOM()` reads the active theme from body classes for layout persistence.

Phase 1 transforms this into a loadable theme architecture per Concepts 1 and 2 of `roadmap/design-system-concepts.md`. The token prefix `--tl-` (from "tuglook") is renamed to `--tways-` (for "tugways"). Bluenote and Harmony are extracted into standalone CSS files that contain only palette values. Theme switching is reimplemented as stylesheet injection: applying a theme injects a `<style>` element whose palette overrides cascade over Brio's defaults in `tokens.css`. The old `use-theme.ts` hook (body-class-based) is deleted and replaced by `TugThemeProvider`, a React context that manages the current theme name, stylesheet injection, Swift bridge sync, and settings persistence. Motion tokens (`--td-duration-*`, `--td-easing-*`, `--td-duration-scalar`) are added to `tokens.css`. The `components/tugways/` directory is created. Finally, the Mac menu gets a Theme submenu under Settings with items for Brio, Bluenote, and Harmony, each sending a `set-theme` control frame through the existing `sendControl` mechanism.

#### Strategy {#strategy}

- **Rename prefix first**: The `--tl-` to `--tways-` rename in `tokens.css` is a mechanical find-and-replace within a single file (only `tokens.css` uses `--tl-`). Do this first so all subsequent work uses the new prefix.
- **Split themes before changing the switching mechanism**: Extract Bluenote and Harmony palette values into separate CSS files (`bluenote.css`, `harmony.css`) and create `brio.css` (empty/minimal, since Brio is the default in `tokens.css`). Strip the `body.td-theme-bluenote` and `body.td-theme-harmony` blocks from `tokens.css`. Semantic tokens in `tokens.css` now derive from `--tways-*` via `var()`.
- **Replace theme switching atomically**: Delete `use-theme.ts` and implement `TugThemeProvider` with stylesheet injection in the same step. Update `main.tsx` to use the new provider and update `DeckManager.readCurrentThemeFromDOM()` to read from the injected stylesheet element instead of body classes.
- **Add motion tokens independently**: Motion tokens are pure additions to `tokens.css` with no dependencies on the theme split work.
- **Create directory early**: The `components/tugways/` directory is a zero-risk step that unblocks Phase 2.
- **Wire Mac menu last**: The Theme submenu depends on the `set-theme` action handler being registered, which depends on `TugThemeProvider` existing.
- **Verify at each step**: Every step has a checkpoint. The final integration checkpoint verifies the full theme lifecycle: startup applies the persisted theme, the Mac menu switches themes, and switching persists across reloads.

#### Success Criteria (Measurable) {#success-criteria}

- No `--tl-` tokens remain anywhere in the codebase (`grep -r -- '--tl-' tugdeck/` returns no matches)
- `tokens.css` contains no `body.td-theme-bluenote` or `body.td-theme-harmony` blocks
- `tugdeck/styles/brio.css`, `tugdeck/styles/bluenote.css`, and `tugdeck/styles/harmony.css` exist as standalone theme files
- Applying Bluenote or Harmony injects a `<style id="tug-theme-override">` element in the document head; reverting to Brio removes it
- `hooks/use-theme.ts` is deleted
- `TugThemeProvider` exists and provides current theme name + setter via React context
- Motion tokens `--td-duration-fast`, `--td-duration-moderate`, `--td-duration-slow`, `--td-duration-glacial`, `--td-easing-standard`, `--td-easing-enter`, `--td-easing-exit`, and `--td-duration-scalar` are defined in `tokens.css`
- `@media (prefers-reduced-motion: reduce)` sets `--td-duration-scalar: 0.001`
- `components/tugways/` directory exists
- Mac Settings menu has a Theme submenu with Brio, Bluenote, Harmony items that switch themes
- All surviving tests pass (`bun test`)
- No TypeScript compilation errors (`bunx tsc --noEmit`)
- App loads, displays correct theme, and connects to backend

#### Scope {#scope}

1. Rename token prefix `--tl-` to `--tways-` in `tokens.css`
2. Extract Bluenote and Harmony into separate CSS theme files; strip theme blocks from `tokens.css`
3. Create `brio.css` as a minimal file (Brio defaults are already in `tokens.css`)
4. Implement stylesheet injection for theme switching (replace body-class mechanism)
5. Delete `use-theme.ts` and implement `TugThemeProvider` with React context
6. Add motion tokens and duration scalar to `tokens.css`
7. Create `components/tugways/` directory
8. Add Theme submenu to Mac Settings menu (Swift) with `set-theme` control frame
9. Register `set-theme` action handler in `action-dispatch.ts`
10. Update `DeckManager.readCurrentThemeFromDOM()` for stylesheet-based theme detection
11. Update `main.tsx` startup theme application to use stylesheet injection

#### Non-goals (Explicitly out of scope) {#non-goals}

- External/user-provided theme loading from filesystem (future capability)
- Removing legacy shadcn bridge aliases from `tokens.css` (deferred to a later cleanup)
- Implementing any tugways components (Phase 2)
- Responder chain integration (Phase 3)
- Any card rebuild work (Phase 9)
- Changing the `--td-*` semantic token prefix (it stays as-is)

#### Dependencies / Prerequisites {#dependencies}

- Phase 0 (Demolition) is complete: the frontend is a minimal canvas shell
- `tokens.css` contains all three theme blocks (pre-split state)
- `use-theme.ts` exists and uses body-class switching
- `action-dispatch.ts` has the `registerAction` infrastructure
- `AppDelegate.swift` has `sendControl` and the existing Settings menu item

#### Constraints {#constraints}

- `--tl-` is used only in `tokens.css` (confirmed by grep); the rename is contained to one file
- The `--td-*` semantic prefix must not change (it is the stable contract consumed by all components and the shadcn bridge)
- Theme CSS files are bundled (imported at build time), not fetched at runtime
- The Swift bridge expects a hex color string from `getComputedStyle(document.body).backgroundColor` -- the stylesheet injection approach must preserve this
- Motion token values must match the design document: fast=100ms, moderate=200ms, slow=350ms, glacial=500ms; easing curves from MD3

#### Assumptions {#assumptions}

- The `--td-*` semantic tokens and the legacy shadcn bridge aliases in `tokens.css` keep their current prefix (`--td-` stays as-is; only `--tl-` is renamed to `--tways-`)
- Brio's palette values remain defined in `tokens.css` as `body { --tways-*: ... }` defaults; `brio.css` exists but is minimal (for symmetry and future override capability)
- `DeckManager.readCurrentThemeFromDOM()` will be updated to read the active theme from the presence and `data-theme` attribute of the injected `<style id="tug-theme-override">` element rather than body classes
- The `set-theme` control frame action will be registered in `action-dispatch.ts` to call `TugThemeProvider`'s setter when the Mac menu theme item is selected

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows the skeleton's anchor and reference conventions. All headings that are referenced use explicit `{#anchor-name}` anchors. Execution steps cite design decisions by `[DNN]` ID and plan sections by `#anchor` reference.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Theme file import mechanism (DECIDED) {#q01-theme-import}

**Question:** Should theme CSS files be bundled via static ES module imports or loaded at runtime via `fetch()`?

**Why it matters:** Static imports are simpler (Vite handles bundling) but cannot support user-provided themes later. Runtime fetch is more flexible but adds async complexity at startup.

**Options (if known):**
- Static import via `import bluenoteCSS from "./bluenote.css?raw"` (Vite raw import)
- Runtime `fetch()` of a CSS file path

**Plan to resolve:** The design document specifies "bundled now, loadable later." Static imports for Phase 1.

**Resolution:** DECIDED -- Use Vite `?raw` imports for bundled theme CSS strings. The theme CSS text is injected as a `<style>` element's `textContent`. This approach works identically for static imports now and for `fetch()` results later, since both produce a CSS string. See [D01], [D03].

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Prefix rename misses a reference | med | low | Only `tokens.css` contains `--tl-` (confirmed by grep); semantic `--td-*` tier is unchanged | If any component renders with broken styles after rename |
| Theme CSS cascade order incorrect | high | low | Injected `<style>` appears after `tokens.css` link in `<head>`, ensuring override | If theme colors don't apply after injection |
| `DeckManager.readCurrentThemeFromDOM` breaks layout persistence | med | med | Update method in same step as theme provider; add test for round-trip | If saved layouts lose theme association |

**Risk R01: CSS cascade ordering** {#r01-cascade-ordering}

- **Risk:** The injected `<style>` element might not override `tokens.css` defaults if it appears before the stylesheet link in the document head.
- **Mitigation:** Inject the `<style>` element as the last child of `<head>` so it always wins in cascade order. Document this invariant in the injection function.
- **Residual risk:** If a third-party library injects styles after ours, it could interfere. Unlikely given the controlled WKWebView environment.

**Risk R02: Motion token adoption before consumers exist** {#r02-motion-tokens-early}

- **Risk:** Motion tokens are added in Phase 1 but no components consume them until Phase 7. They could drift from the spec without anyone noticing.
- **Mitigation:** Values are copied verbatim from `design-system-concepts.md`. A test verifies the token names and values exist in `tokens.css`.
- **Residual risk:** The exact easing values could be revised during Phase 7 implementation if they don't feel right in practice.

---

### Design Decisions {#design-decisions}

> These decisions are drawn from `roadmap/design-system-concepts.md` Concepts 1, 2, and 8, scoped to Phase 1 implementation. The `[DNN]` IDs below are plan-local and do not correspond 1:1 to the design document's decision numbering. Each decision notes the design document decision it maps to where applicable (e.g., plan [D01] maps to design doc [D01]; plan [D06] maps to design doc [D23]).

#### [D01] Theme format is CSS, not JSON (DECIDED) {#d01-css-format}

**Decision:** Theme files are CSS files containing `body { --tways-*: ... }` custom property declarations. A structured comment header provides metadata.

**Rationale:**
- CSS custom properties can hold any CSS value natively: colors, shadows, gradients, complex expressions
- No translation layer between theme data and rendering -- the browser applies theme values directly
- Consistent with the existing three-tier token architecture

**Implications:**
- Theme files are `.css` files in `tugdeck/styles/`
- Each theme file contains only Tier 1 palette values (`--tways-*`)
- Semantic tokens (`--td-*`) derive from palette tokens via `var(--tways-*)` in `tokens.css`

#### [D02] Prefix rename `--tl-` to `--tways-` (DECIDED) {#d02-tways-prefix}

**Decision:** All Tier 1 palette token names are renamed from `--tl-` prefix to `--tways-` prefix. The `--td-` semantic prefix is unchanged.

**Rationale:**
- `--tl-` (from "tuglook") is the old name; `--tways-` (for "tugways") is the new design system name
- `--tways-` is distinctive and avoids conflict with Tailwind's `--tw-` internal prefix
- The semantic tier `--td-` stays as-is because it represents the application's purpose-driven mappings

**Implications:**
- Find-and-replace `--tl-` with `--tways-` in `tokens.css` (the only file that contains `--tl-`)
- Tier 2 semantic tokens update their `var()` references: `var(--tl-bg)` becomes `var(--tways-bg)`
- No other files reference `--tl-` directly

#### [D03] Stylesheet injection replaces body classes (DECIDED) {#d03-stylesheet-injection}

**Decision:** Theme switching injects or replaces a `<style id="tug-theme-override">` element in the document head instead of toggling body classes.

**Rationale:**
- Eliminates the `body.td-theme-bluenote` / `body.td-theme-harmony` CSS blocks (~190 lines of duplicated values)
- Eliminates the `td-theme-change` CustomEvent -- CSS cascade handles visual updates automatically
- The injected `<style>` contains only palette overrides; semantic tokens derive via `var()` chain
- Brio is applied by removing the `<style>` element (its defaults in `tokens.css` take over)

**Implications:**
- `tokens.css` shrinks significantly (the two theme blocks are removed)
- `use-theme.ts` (body-class-based) is deleted entirely
- `TugThemeProvider` owns the injection lifecycle
- `DeckManager.readCurrentThemeFromDOM()` reads from the `<style>` element's `data-theme` attribute instead of body classes

#### [D04] Optional palette entries with `var()` fallbacks (DECIDED) {#d04-optional-palette}

**Decision:** Semantic tokens that need per-theme overrides (like `canvas`, `header-active`, `header-inactive`, `icon-active`, `grid-color`) are wired as optional palette entries with CSS fallback.

**Rationale:**
- Tokens like `--td-canvas` currently have hardcoded per-theme values in the theme blocks
- Using `--td-canvas: var(--tways-canvas, var(--tways-bg))` means themes can optionally provide `--tways-canvas` to diverge from the default derivation
- If a theme omits `--tways-canvas`, it falls back to `--tways-bg` automatically

**Implications:**
- `tokens.css` semantic layer gains `var(..., fallback)` expressions for optional tokens
- Theme files (Bluenote, Harmony) include optional palette entries only when they need to diverge from the Brio-based default derivation
- No component changes needed -- components already reference `--td-*` tokens

#### [D05] `components/tugways/` is the public API directory (DECIDED) {#d05-tugways-dir}

**Decision:** `components/tugways/` is the public component directory. App code imports from `components/tugways/`, never from `components/ui/`.

**Rationale:**
- `components/ui/` contains raw shadcn components (private implementation detail)
- `components/tugways/` contains `Tug`-prefixed components (the public API)
- This separation allows shadcn updates without affecting app code

**Implications:**
- Phase 1 creates the empty directory; Phase 2 populates it with `TugButton`
- The directory's existence signals the start of the tugways component system

#### [D06] Motion tokens as CSS custom properties (DECIDED) {#d06-motion-tokens}

**Decision:** Motion tokens (`--td-duration-fast/moderate/slow/glacial` and `--td-easing-standard/enter/exit`) are defined as CSS custom properties in `tokens.css`, following the same `--td-*` convention as theme tokens.

**Rationale:**
- Motion is appearance-zone -- animations and transitions are visual presentation, not React state
- CSS custom properties allow theme-level overrides (a "calm" theme could use longer durations)
- Four durations and three easings are intentionally minimal for a developer tool

**Implications:**
- Tokens are added to `tokens.css` in a `/* Motion */` section
- All future transition/animation CSS uses `calc(var(--td-duration-scalar) * var(--td-duration-*))` pattern
- Components that consume motion tokens (Phases 7, 8) find them already defined

#### [D07] Reduced motion via duration scalar (DECIDED) {#d07-reduced-motion}

**Decision:** A `--td-duration-scalar` variable defaults to `1` and drops to `0.001` under `@media (prefers-reduced-motion: reduce)`. All durations are wrapped in `calc(var(--td-duration-scalar) * ...)`.

**Rationale:**
- Using `0.001` instead of `0` ensures `animationend` and `transitionend` events still fire, which Radix's Presence component depends on for unmount timing
- One variable controls all motion -- no per-component reduced-motion overrides needed
- Spatial animations should be replaced with opacity fades (Apple's "replace, don't remove" principle), handled by individual components in later phases

**Implications:**
- The `@media (prefers-reduced-motion: reduce)` block is defined once in `tokens.css`
- Components wrap durations with the scalar: `transition: opacity calc(var(--td-duration-scalar) * var(--td-duration-moderate)) var(--td-easing-standard)`

#### [D08] TugThemeProvider replaces use-theme.ts (DECIDED) {#d08-theme-provider}

**Decision:** `use-theme.ts` is deleted entirely. `TugThemeProvider` is a new React context provider that manages theme name state, stylesheet injection, localStorage persistence, settings API sync, and Swift bridge color sync.

**Rationale:**
- `use-theme.ts` is tightly coupled to the body-class mechanism being replaced
- A context provider gives any component access to the current theme name and setter
- The provider centralizes all theme side effects (injection, persistence, bridge sync)

**Implications:**
- `TugThemeProvider` wraps the app in `main.tsx`
- Components that need the theme name import `useThemeContext()` from the provider module
- The `set-theme` action handler in `action-dispatch.ts` calls the provider's setter

---

### Specification {#specification}

#### Theme File Format {#theme-file-format}

**Spec S01: Theme CSS file structure** {#s01-theme-css}

Each theme file is a CSS file with this structure:

```css
/**
 * @theme-name <ThemeName>
 * @theme-description <Short description>
 */
body {
  --tways-bg: <value>;
  --tways-bg-soft: <value>;
  /* ... palette-only tokens ... */

  /* Optional palette entries for per-theme semantic overrides */
  --tways-canvas: <value>;
  --tways-header-active: <value>;
  --tways-header-inactive: <value>;
  --tways-icon-active: <value>;
  --tways-grid-color: <value>;
}
```

Rules:
- Contains only `body { --tways-*: ... }` declarations (Tier 1 palette)
- No `--td-*` semantic tokens (those derive via `var()` in `tokens.css`)
- No legacy/shadcn aliases
- Optional palette entries (`--tways-canvas`, `--tways-header-active`, etc.) are included only when the theme diverges from the default derivation

#### Theme Injection API {#theme-injection-api}

**Spec S02: Stylesheet injection contract** {#s02-injection-contract}

```typescript
/** Inject or replace the theme override stylesheet. */
function injectThemeCSS(themeName: string, cssText: string): void;

/** Remove the theme override stylesheet (reverts to Brio defaults). */
function removeThemeCSS(): void;
```

Injection rules:
1. The injected element is `<style id="tug-theme-override" data-theme="<name>">`.
2. It is appended as the last child of `<head>` to win CSS cascade ordering.
3. Calling `injectThemeCSS` when an override already exists replaces its `textContent` and `data-theme`.
4. Calling `removeThemeCSS` removes the element entirely; Brio defaults in `tokens.css` take over.
5. After any injection or removal, read `getComputedStyle(document.body).backgroundColor` and post the hex value to the Swift bridge via `window.webkit.messageHandlers.setTheme.postMessage({ color })`.

#### TugThemeProvider API {#theme-provider-api}

**Spec S03: TugThemeProvider interface** {#s03-theme-provider}

```typescript
type ThemeName = "brio" | "bluenote" | "harmony";

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

/** React context provider. Wraps the app root. */
function TugThemeProvider({ children, initialTheme }: {
  children: React.ReactNode;
  initialTheme?: ThemeName;
}): JSX.Element;

/** Hook to access current theme and setter. */
function useThemeContext(): ThemeContextValue;
```

Provider behavior:
1. On mount, if `initialTheme` is not `"brio"`, inject the corresponding theme CSS.
2. `setTheme` calls `injectThemeCSS` or `removeThemeCSS`, updates React state, persists to localStorage (`td-theme` key), fires `postSettings({ theme })`, and syncs canvas color to Swift bridge.
3. The provider does not dispatch `td-theme-change` CustomEvents -- CSS cascade handles visual updates without explicit notification.

#### Motion Tokens {#motion-tokens}

**Spec S04: Motion token definitions** {#s04-motion-tokens}

**Table T01: Duration tokens** {#t01-duration-tokens}

| Token | Value | Usage |
|-------|-------|-------|
| `--td-duration-fast` | `100ms` | Micro-interactions: hover feedback, toggle state, focus ring |
| `--td-duration-moderate` | `200ms` | Standard transitions: button press, panel expand/collapse |
| `--td-duration-slow` | `350ms` | Major transitions: dialog appear/dismiss, card state change |
| `--td-duration-glacial` | `500ms` | Dramatic transitions: startup overlay fade, first-paint reveal |

**Table T02: Easing tokens** {#t02-easing-tokens}

| Token | Value | Usage |
|-------|-------|-------|
| `--td-easing-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Elements already on screen changing state |
| `--td-easing-enter` | `cubic-bezier(0, 0, 0, 1)` | Elements appearing (decelerate into place) |
| `--td-easing-exit` | `cubic-bezier(0.2, 0, 1, 1)` | Elements leaving (accelerate away) |

**Table T03: Duration scalar** {#t03-duration-scalar}

| Token | Default | Reduced motion | Purpose |
|-------|---------|---------------|---------|
| `--td-duration-scalar` | `1` | `0.001` | Multiplier for all animation/transition durations |

Usage pattern: `calc(var(--td-duration-scalar) * var(--td-duration-moderate))`

The `0.001` value (not `0`) ensures `animationend`/`transitionend` events still fire for Radix Presence unmount timing.

#### Control Frame Format {#control-frame-format}

**Spec S05: set-theme control frame** {#s05-set-theme-frame}

```json
{
  "action": "set-theme",
  "theme": "brio" | "bluenote" | "harmony"
}
```

Sent by the Mac app when a Theme submenu item is selected. The `action-dispatch.ts` handler validates the `theme` field and calls `TugThemeProvider`'s setter.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/styles/brio.css` | Brio theme file (minimal -- Brio defaults are in `tokens.css`) |
| `tugdeck/styles/bluenote.css` | Bluenote theme file (palette-only overrides) |
| `tugdeck/styles/harmony.css` | Harmony theme file (palette-only overrides) |
| `tugdeck/src/components/tugways/.gitkeep` | Placeholder to create the tugways directory |
| `tugdeck/src/vite-env.d.ts` | Vite client type reference for `?raw` import support |
| `tugdeck/src/contexts/theme-provider.tsx` | `TugThemeProvider` React context and `useThemeContext` hook |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TugThemeProvider` | component | `contexts/theme-provider.tsx` | React context provider for theme state and injection |
| `useThemeContext` | hook | `contexts/theme-provider.tsx` | Returns `{ theme, setTheme }` from theme context |
| `ThemeName` | type | `contexts/theme-provider.tsx` | `"brio" \| "bluenote" \| "harmony"` |
| `injectThemeCSS` | fn | `contexts/theme-provider.tsx` | Injects/replaces `<style id="tug-theme-override">` |
| `removeThemeCSS` | fn | `contexts/theme-provider.tsx` | Removes the override element |
| `sendCanvasColor` | fn | `contexts/theme-provider.tsx` | Reads computed bg color, posts to Swift bridge (copied from `use-theme.ts`) |
| `normalizeToHex` | fn | `contexts/theme-provider.tsx` | Converts CSS color to hex string (copied from `use-theme.ts`) |
| `applyInitialTheme` | fn | `contexts/theme-provider.tsx` | Applies theme CSS before React mounts (used by `main.tsx`) |
| `readCurrentThemeFromDOM` | method (modified) | `deck-manager.ts` | Updated to read from `<style>` element's `data-theme` attribute |
| `registerAction("set-theme", ...)` | call | `action-dispatch.ts` | Registers the `set-theme` action handler |

#### Files to delete {#files-to-delete}

| File | Reason |
|------|--------|
| `tugdeck/src/hooks/use-theme.ts` | Replaced entirely by `TugThemeProvider` |

---

### Documentation Plan {#documentation-plan}

- [ ] Update file header comment in `tokens.css` to reference `--tways-*` prefix and tugways
- [ ] Add comment in `theme-provider.tsx` documenting the injection mechanism and cascade ordering invariant
- [ ] Update `roadmap/design-system-concepts.md` "Current State" section to reflect that Phase 1 is complete (after implementation)

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test theme provider state transitions, injection/removal functions | Theme provider logic |
| **Integration** | Test full theme lifecycle: apply, persist, reload | End-to-end theme switching |
| **Drift Prevention** | Verify motion token names and values match spec | Token correctness |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Rename token prefix --tl- to --tways- {#step-1}

**Commit:** `refactor: rename token prefix --tl- to --tways- in tokens.css`

**References:** [D02] Prefix rename, (#context, #strategy)

**Artifacts:**
- Modified `tugdeck/styles/tokens.css` with all `--tl-` occurrences replaced by `--tways-`
- Updated file header comment to reference "tugways" instead of "tuglook"

**Tasks:**
- [ ] Find-and-replace `--tl-` with `--tways-` throughout `tokens.css` (declarations and `var()` references)
- [ ] Update the file header comment: change "Tuglook Design Language" to "Tugways Design System" and "Tier 1: Palette tokens (--tl-*)" to "Tier 1: Palette tokens (--tways-*)"
- [ ] Update the inline comment "Tier 1: Palette (Brio values from tuglook body.tl-theme-brio)" to reference tugways
- [ ] Verify no `--tl-` occurrences remain in tokens.css

**Tests:**
- [ ] `grep -- '--tl-' tugdeck/styles/tokens.css` returns no matches
- [ ] `grep -r -- '--tl-' tugdeck/` returns no matches across the entire tugdeck directory

**Checkpoint:**
- [ ] `bunx tsc --noEmit` passes (TypeScript compiles)
- [ ] `bun run dev` -- app loads, dark grid visible, all three themes render correctly via existing body-class mechanism. The `body.td-theme-*` blocks contain both renamed palette tokens (`--tways-*`) and hardcoded `--td-*` semantic overrides. The `--td-*` overrides use literal hex values (not `var()` references), so they are unaffected by the palette rename and continue to work correctly.

---

#### Step 2: Add motion tokens to tokens.css {#step-2}

**Depends on:** #step-1

**Commit:** `feat: add motion tokens and duration scalar to tokens.css`

**References:** [D06] Motion tokens, [D07] Reduced motion, Spec S04, Tables T01-T03, (#motion-tokens)

**Artifacts:**
- Modified `tugdeck/styles/tokens.css` with new `/* Motion */` section containing duration, easing, and scalar tokens
- New `@media (prefers-reduced-motion: reduce)` block

**Tasks:**
- [ ] Add a `/* Motion Tokens */` section inside the `body { ... }` block in `tokens.css`, after the existing shared tokens and before the Tier 2 semantic tokens
- [ ] Define `--td-duration-fast: 100ms`, `--td-duration-moderate: 200ms`, `--td-duration-slow: 350ms`, `--td-duration-glacial: 500ms`
- [ ] Define `--td-easing-standard: cubic-bezier(0.2, 0, 0, 1)`, `--td-easing-enter: cubic-bezier(0, 0, 0, 1)`, `--td-easing-exit: cubic-bezier(0.2, 0, 1, 1)`
- [ ] Define `--td-duration-scalar: 1` in the `body` block
- [ ] Add a `@media (prefers-reduced-motion: reduce) { body { --td-duration-scalar: 0.001; } }` block after the `body` block (before the theme blocks)

**Tests:**
- [ ] `grep -- '--td-duration-fast' tugdeck/styles/tokens.css` confirms `100ms`
- [ ] `grep -- '--td-duration-scalar' tugdeck/styles/tokens.css` confirms both default `1` and reduced-motion `0.001`
- [ ] `grep -- '--td-easing-standard' tugdeck/styles/tokens.css` confirms `cubic-bezier(0.2, 0, 0, 1)`

**Checkpoint:**
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun run dev` -- app loads normally (motion tokens are defined but not yet consumed)

---

#### Step 3: Create theme CSS files and strip theme blocks from tokens.css {#step-3}

**Depends on:** #step-1

**Commit:** `feat: extract Bluenote and Harmony into separate theme CSS files`

**References:** [D01] CSS format, [D03] Stylesheet injection, [D04] Optional palette entries, Spec S01, (#theme-file-format, #strategy)

**Artifacts:**
- New `tugdeck/styles/brio.css` (minimal file with metadata comment only)
- New `tugdeck/styles/bluenote.css` (Bluenote palette values extracted from `tokens.css`)
- New `tugdeck/styles/harmony.css` (Harmony palette values extracted from `tokens.css`)
- Modified `tugdeck/styles/tokens.css` with `body.td-theme-bluenote` and `body.td-theme-harmony` blocks removed
- Modified `tokens.css` semantic layer to use `var(..., fallback)` for optional tokens

**Tasks:**
- [ ] Create `tugdeck/styles/brio.css` with metadata comment (`@theme-name Brio`, `@theme-description Default dark graphite theme`) and an empty `body {}` block (Brio defaults live in `tokens.css`)
- [ ] Create `tugdeck/styles/bluenote.css` by extracting the Bluenote palette values from `tokens.css`. Include only `--tways-*` tokens (palette tier) plus optional palette entries where the theme diverges from the default derivation (`--tways-canvas`, `--tways-header-active`, `--tways-header-inactive`, `--tways-grid-color`). Omit `--tways-icon-active` because Bluenote's value (`#4bbde8`) matches `--tways-accent-2` which the `var()` chain already resolves correctly. Do NOT include any `--td-*` semantic tokens -- they derive via `var()`.
- [ ] Create `tugdeck/styles/harmony.css` by extracting the Harmony palette values similarly. Note that Harmony requires `--tways-grid-color: rgba(0, 0, 0, 0.06)` (dark grid lines on a light canvas), which differs from Brio's default of `rgba(255, 255, 255, 0.05)`. This must be included as an explicit optional palette entry in `harmony.css` alongside `--tways-canvas`.
- [ ] In `tokens.css`, update the semantic tokens that need per-theme overrides to use optional palette entries with fallbacks:
  - `--td-canvas: var(--tways-canvas, var(--tways-bg));`
  - `--td-header-active: var(--tways-header-active, #44474C);` (Brio's current hardcoded value as fallback)
  - `--td-header-inactive: var(--tways-header-inactive, #34373c);`
  - `--td-icon-active: var(--tways-icon-active, var(--td-accent-2));`
  - `--td-grid-color: var(--tways-grid-color, rgba(255, 255, 255, 0.05));`
- [ ] In `tokens.css`, update the semantic tokens that currently reference hardcoded per-theme values for depth, shadow, and syntax highlighting to derive from `--tways-*` palette via `var()` chain (these already work correctly for Brio; the theme files will override the palette values)
- [ ] Remove the `body.td-theme-bluenote { ... }` block from `tokens.css`
- [ ] Remove the `body.td-theme-harmony { ... }` block from `tokens.css`
- [ ] Verify that every `--td-*` semantic override that was in the Bluenote/Harmony blocks is equivalent to what the `var()` chain in the Brio body block would produce when given the theme's palette values. This confirms that stripping the `--td-*` overrides is safe. Pay particular attention to: `--td-depth-raise` (depends on `--tways-shadow-soft` through the `--tways-depth-raise` `var()` chain) and `--td-syntax-*` tokens (depend on `--tways-accent-N`). For tokens where the `var()` derivation does not produce the same value as the hardcoded override, either (a) add an optional `--tways-*` palette entry to the theme file so the derivation yields the correct result, or (b) document the discrepancy and add an explicit override to the theme file.

**Tests:**
- [ ] `tugdeck/styles/bluenote.css` exists and contains `--tways-bg: #2a3136`
- [ ] `tugdeck/styles/harmony.css` exists and contains `--tways-bg: #3f474c`
- [ ] `tugdeck/styles/brio.css` exists
- [ ] `grep 'td-theme-bluenote' tugdeck/styles/tokens.css` returns no matches
- [ ] `grep 'td-theme-harmony' tugdeck/styles/tokens.css` returns no matches

**Checkpoint:**
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun run dev` -- app loads with Brio theme (default). Note: Bluenote and Harmony are not yet accessible via the UI because the old body-class mechanism has been removed and the new stylesheet injection is not yet wired. This is expected -- the theme blocks that the body-class mechanism depended on have been stripped. If localStorage has `td-theme` set to a non-Brio theme, the startup code in `main.tsx` will add the body class but the CSS rule no longer exists, so Brio will display. Additionally, `DeckManager.readCurrentThemeFromDOM()` still reads from body classes in this intermediate state, so it may report an incorrect theme for layout persistence. Both issues are acceptable because Steps 3 through 6 form a single implementation pass with no deployment between steps; both are resolved in Step 6.

---

#### Step 4: Create components/tugways/ directory {#step-4}

**Depends on:** #step-1

**Commit:** `feat: create components/tugways/ directory for design system`

**References:** [D05] tugways directory, (#scope)

**Artifacts:**
- New `tugdeck/src/components/tugways/.gitkeep`

**Tasks:**
- [ ] Create directory `tugdeck/src/components/tugways/`
- [ ] Add `.gitkeep` file so the empty directory is tracked by git

**Tests:**
- [ ] Directory `tugdeck/src/components/tugways/` exists

**Checkpoint:**
- [ ] `ls tugdeck/src/components/tugways/.gitkeep` succeeds

---

#### Step 5: Implement TugThemeProvider and delete use-theme.ts {#step-5}

**Depends on:** #step-3

**Commit:** `feat: implement TugThemeProvider with stylesheet injection, delete use-theme.ts`

**References:** [D03] Stylesheet injection, [D08] TugThemeProvider, Spec S02, Spec S03, (#theme-injection-api, #theme-provider-api)

**Artifacts:**
- New `tugdeck/src/contexts/theme-provider.tsx`
- Deleted `tugdeck/src/hooks/use-theme.ts`

**Tasks:**
- [ ] Create the `tugdeck/src/contexts/` directory if it does not already exist (Phase 0 deleted `contexts/dev-notification-context.tsx` but may have left the directory; create it if absent)
- [ ] Create `tugdeck/src/contexts/theme-provider.tsx` implementing:
  - `ThemeName` type (`"brio" | "bluenote" | "harmony"`)
  - `injectThemeCSS(themeName: string, cssText: string)` -- creates or updates `<style id="tug-theme-override" data-theme="...">` as last child of `<head>`
  - `removeThemeCSS()` -- removes the `<style id="tug-theme-override">` element
  - `normalizeToHex(css: string): string | null` -- copied from `use-theme.ts` before deletion. Converts a CSS color value (hex or `rgb()`) to a 6-digit hex string. The existing implementation handles both `#rrggbb` and `rgb(r, g, b)` formats correctly.
  - `sendCanvasColor()` -- copied from `use-theme.ts` before deletion. Reads computed `background-color` from `document.body`, normalizes to hex via `normalizeToHex`, posts to `window.webkit.messageHandlers.setTheme.postMessage({ color })`.
  - `ThemeContext` React context
  - `TugThemeProvider` component: manages `theme` state, on mount applies `initialTheme` by importing the corresponding CSS file via Vite `?raw` imports and calling `injectThemeCSS`, `setTheme` function injects/removes CSS, persists to localStorage and settings API, syncs canvas color to Swift bridge. Uses a `useRef` to hold the current `setTheme` function so that `registerThemeSetter` receives a stable wrapper that always calls the latest setter (see Step 7 for the full pattern).
  - `useThemeContext()` hook that returns `{ theme, setTheme }`
  - `applyInitialTheme(themeName: ThemeName): void` -- exported convenience function that calls `injectThemeCSS` with the correct CSS string for the given theme (or does nothing for `"brio"`). This allows `main.tsx` to apply the initial theme before React mounts without importing raw CSS strings separately.
- [ ] Create `tugdeck/src/vite-env.d.ts` containing `/// <reference types="vite/client" />`. This gives TypeScript awareness of Vite-specific import suffixes (`?raw`, `?url`, `?worker`, etc.) and is required for the `?raw` imports below to type-check. This is standard practice for Vite projects.
- [ ] Import Bluenote and Harmony CSS as raw strings: `import bluenoteCSS from "../../styles/bluenote.css?raw"` and `import harmonyCSS from "../../styles/harmony.css?raw"`
- [ ] Create a theme CSS map: `const themeCSSMap: Record<ThemeName, string | null> = { brio: null, bluenote: bluenoteCSS, harmony: harmonyCSS }`
- [ ] In `setTheme`: if `brio`, call `removeThemeCSS()`; otherwise call `injectThemeCSS(name, themeCSSMap[name])`; then update state, persist to `localStorage.setItem("td-theme", name)`, fire `postSettings({ theme: name })`, and call `sendCanvasColor()`
- [ ] Copy `normalizeToHex` and `sendCanvasColor` from `use-theme.ts` into `theme-provider.tsx` before deleting the source file. These are tested, correct implementations; copying avoids subtle bugs in the hex normalization regex.
- [ ] Delete `tugdeck/src/hooks/use-theme.ts`

**Tests:**
- [ ] `tugdeck/src/contexts/theme-provider.tsx` exists and exports `TugThemeProvider`, `useThemeContext`, `ThemeName`
- [ ] `tugdeck/src/hooks/use-theme.ts` does not exist
- [ ] `bunx tsc --noEmit` passes (no imports of `use-theme.ts` remain)

**Checkpoint:**
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun test` -- all surviving tests pass

---

#### Step 6: Wire TugThemeProvider into main.tsx and update DeckManager {#step-6}

**Depends on:** #step-5

**Commit:** `feat: wire TugThemeProvider into app startup, update DeckManager theme detection`

**References:** [D03] Stylesheet injection, [D08] TugThemeProvider, Spec S02, Spec S03, (#theme-provider-api, #context)

**Artifacts:**
- Modified `tugdeck/src/main.tsx` to use `TugThemeProvider` and stylesheet injection at startup
- Modified `tugdeck/src/deck-manager.ts` with updated `readCurrentThemeFromDOM()`

**Tasks:**
- [ ] In `main.tsx`, remove the old body-class theme application code (the `THEME_CLASS_PREFIX` block that toggles body classes based on `serverSettings.theme`)
- [ ] In `main.tsx`, import `TugThemeProvider`, `applyInitialTheme`, and `sendCanvasColor` from `contexts/theme-provider.tsx`. The `applyInitialTheme` function encapsulates the raw CSS imports and injection logic so `main.tsx` does not need to import theme CSS strings directly.
- [ ] In `main.tsx`, apply the initial theme via `applyInitialTheme(serverSettings.theme as ThemeName)` before constructing DeckManager. This injects the stylesheet for non-Brio themes synchronously so the correct colors are visible before React renders.
- [ ] Add an optional `initialTheme` parameter to DeckManager's constructor, passing `serverSettings.theme` from `main.tsx`: `const deck = new DeckManager(container, connection, serverSettings.layout ?? undefined, serverSettings.theme as ThemeName ?? "brio")`
- [ ] In DeckManager's `render()` method, wrap the React tree with `TugThemeProvider`: `React.createElement(TugThemeProvider, { initialTheme: this.initialTheme }, React.createElement(ErrorBoundary, null, React.createElement(DeckCanvas, { ... })))`. Store `initialTheme` as a private field on DeckManager.
- [ ] In `deck-manager.ts`, update `readCurrentThemeFromDOM()` to read from the `<style id="tug-theme-override">` element's `data-theme` attribute instead of body classes:
  ```typescript
  private readCurrentThemeFromDOM(): string {
    const el = document.getElementById("tug-theme-override");
    return el?.getAttribute("data-theme") ?? "brio";
  }
  ```
- [ ] In `main.tsx`, ensure `sendCanvasColor()` is called after initial theme injection so the Swift bridge gets the correct background color on startup

**Tests:**
- [ ] `grep 'THEME_CLASS_PREFIX' tugdeck/src/main.tsx` returns no matches (old body-class code removed)
- [ ] `grep 'TugThemeProvider' tugdeck/src/main.tsx` confirms the provider is used
- [ ] `grep 'tug-theme-override' tugdeck/src/deck-manager.ts` confirms the new detection method

**Checkpoint:**
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun test` -- all surviving tests pass
- [ ] `bun run dev` -- app loads with Brio theme; if `td-theme` localStorage is set to `"bluenote"`, the Bluenote theme is applied via stylesheet injection on startup

---

#### Step 7: Register set-theme action handler {#step-7}

**Depends on:** #step-6

**Commit:** `feat: register set-theme action handler in action-dispatch.ts`

**References:** [D08] TugThemeProvider, Spec S05, (#control-frame-format)

**Artifacts:**
- Modified `tugdeck/src/action-dispatch.ts` with `set-theme` handler registered

**Tasks:**
- [ ] In `action-dispatch.ts`, the `set-theme` handler needs access to `TugThemeProvider`'s setter. Since `action-dispatch.ts` is initialized before React mounts (in `main.tsx`), the handler must use a module-level reference to the theme setter that is populated after React mounts.
- [ ] Add a module-level variable: `let themeSetterRef: ((theme: string) => void) | null = null;`
- [ ] Add a registration function: `export function registerThemeSetter(setter: (theme: string) => void): void { themeSetterRef = setter; }`
- [ ] In `initActionDispatch`, register the `set-theme` action:
  ```typescript
  registerAction("set-theme", (payload) => {
    const theme = payload.theme;
    if (typeof theme !== "string" || !["brio", "bluenote", "harmony"].includes(theme)) {
      console.warn("set-theme: invalid theme", payload);
      return;
    }
    if (themeSetterRef) {
      themeSetterRef(theme);
    } else {
      console.warn("set-theme: theme setter not registered yet");
    }
  });
  ```
- [ ] In `TugThemeProvider`, use a `useRef` to hold the current `setTheme` function and pass a stable wrapper to `registerThemeSetter`. This prevents the setter ref from becoming stale across re-renders. The pattern:
  ```typescript
  const setThemeRef = useRef(setTheme);
  useEffect(() => { setThemeRef.current = setTheme; }); // update ref on every render
  useEffect(() => {
    registerThemeSetter((theme: string) => setThemeRef.current(theme as ThemeName));
  }, []); // register once with stable wrapper that reads from ref
  ```
  The flow is: `main.tsx` calls `initActionDispatch` (registers the `set-theme` handler with a null setter ref) -> `DeckManager.render()` mounts `TugThemeProvider` -> provider's mount effect calls `registerThemeSetter` with the stable wrapper (populates the ref) -> subsequent `set-theme` control frames call the wrapper, which reads the latest `setTheme` from the ref.

**Tests:**
- [ ] `grep 'set-theme' tugdeck/src/action-dispatch.ts` confirms the handler is registered
- [ ] `grep 'registerThemeSetter' tugdeck/src/action-dispatch.ts` confirms the registration function exists
- [ ] Existing `action-dispatch.test.ts` still passes

**Checkpoint:**
- [ ] `bunx tsc --noEmit` passes
- [ ] `bun test` -- all tests pass

---

#### Step 8: Add Theme submenu to Mac Settings menu {#step-8}

**Depends on:** #step-7

**Commit:** `feat: add Theme submenu to Mac Settings menu with Brio/Bluenote/Harmony items`

**References:** [D03] Stylesheet injection, Spec S05, (#control-frame-format, #scope)

**Artifacts:**
- Modified `tugapp/Sources/AppDelegate.swift` with Theme submenu under Settings

**Tasks:**
- [ ] In `AppDelegate.swift`, in the `buildMenuBar()` method, locate the app menu section where the Settings item is added
- [ ] After the Settings menu item, add a Theme submenu:
  ```swift
  // Theme submenu
  let themeMenuItem = NSMenuItem(title: "Theme", action: nil, keyEquivalent: "")
  let themeMenu = NSMenu(title: "Theme")
  themeMenuItem.submenu = themeMenu
  themeMenu.addItem(NSMenuItem(title: "Brio", action: #selector(setThemeBrio(_:)), keyEquivalent: ""))
  themeMenu.addItem(NSMenuItem(title: "Bluenote", action: #selector(setThemeBluenote(_:)), keyEquivalent: ""))
  themeMenu.addItem(NSMenuItem(title: "Harmony", action: #selector(setThemeHarmony(_:)), keyEquivalent: ""))
  appMenu.addItem(themeMenuItem)
  ```
- [ ] Add action methods:
  ```swift
  @objc private func setThemeBrio(_ sender: Any) {
      sendControl("set-theme", params: ["theme": "brio"])
  }
  @objc private func setThemeBluenote(_ sender: Any) {
      sendControl("set-theme", params: ["theme": "bluenote"])
  }
  @objc private func setThemeHarmony(_ sender: Any) {
      sendControl("set-theme", params: ["theme": "harmony"])
  }
  ```
- [ ] The Theme submenu items should be enabled at all times (unlike Settings which waits for `frontendReady`) since the `set-theme` control frame is handled gracefully even before the frontend is ready

**Tests:**
- [ ] `grep 'set-theme' tugapp/Sources/AppDelegate.swift` confirms the control frame is sent
- [ ] `grep 'Theme' tugapp/Sources/AppDelegate.swift` confirms the submenu exists
- [ ] Xcode builds the project without errors

**Checkpoint:**
- [ ] Xcode build succeeds for the tugapp target
- [ ] Mac menu bar shows Tug > Theme > {Brio, Bluenote, Harmony} submenu items

---

#### Step 9: Integration Checkpoint {#step-9}

**Depends on:** #step-2, #step-4, #step-6, #step-7, #step-8

**Commit:** `N/A (verification only)`

**References:** [D01] CSS format, [D02] Prefix rename, [D03] Stylesheet injection, [D06] Motion tokens, [D07] Reduced motion, [D08] TugThemeProvider, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify end-to-end theme lifecycle: app starts with Brio -> select Bluenote from Mac menu -> theme changes -> reload page -> Bluenote persists
- [ ] Verify all three themes render correctly: Brio (no injection, defaults), Bluenote (injected `<style>` override), Harmony (injected `<style>` override)
- [ ] Verify reverting to Brio removes the `<style id="tug-theme-override">` element
- [ ] Verify `DeckManager.readCurrentThemeFromDOM()` returns the correct theme name for layout persistence
- [ ] Verify Swift bridge receives the correct background color hex on theme switch
- [ ] Verify motion tokens are present in the DOM: `getComputedStyle(document.body).getPropertyValue('--td-duration-fast')` returns `100ms`
- [ ] Verify `components/tugways/` directory exists
- [ ] Verify no `--tl-` tokens exist in the codebase

**Tests:**
- [ ] `bun test` -- all surviving tests pass
- [ ] `bunx tsc --noEmit` -- no TypeScript errors
- [ ] `grep -r -- '--tl-' tugdeck/` returns no matches

**Checkpoint:**
- [ ] `bun test` passes
- [ ] `bunx tsc --noEmit` passes
- [ ] Manual verification: theme switching works end-to-end via Mac menu, persists across reload, Swift bridge receives correct colors

---

### Deliverables and Checkpoints {#deliverables}

> This is the single place we define "done" for the phase. Keep it crisp and testable.

**Deliverable:** Loadable theme architecture with stylesheet injection, motion tokens, and the `components/tugways/` directory ready for component development.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Token prefix renamed: no `--tl-` anywhere in codebase (`grep -r -- '--tl-' tugdeck/` returns nothing)
- [ ] Theme files exist: `brio.css`, `bluenote.css`, `harmony.css` in `tugdeck/styles/`
- [ ] Theme blocks removed from `tokens.css`: no `body.td-theme-bluenote` or `body.td-theme-harmony`
- [ ] Theme switching via stylesheet injection works for all three themes
- [ ] `use-theme.ts` is deleted; `TugThemeProvider` provides theme context
- [ ] Motion tokens defined in `tokens.css` with reduced-motion scalar
- [ ] `components/tugways/` directory exists
- [ ] Mac menu Theme submenu works via `set-theme` control frame
- [ ] All tests pass, no TypeScript errors, app loads and connects

**Acceptance tests:**
- [ ] Start app with no stored theme preference -> Brio loads (default)
- [ ] Select Bluenote from Mac menu -> Bluenote theme applies immediately, no page reload
- [ ] Reload page -> Bluenote persists (read from localStorage/settings)
- [ ] Select Brio from Mac menu -> Brio restores, `<style id="tug-theme-override">` is removed
- [ ] Select Harmony -> Harmony theme applies with correct light-theme colors
- [ ] `document.body` computed `background-color` matches the active theme's canvas color

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 2: First tugways component (TugButton) + Component Gallery
- [ ] External theme loading from filesystem via `fetch()`
- [ ] Remove legacy shadcn bridge aliases from `tokens.css`
- [ ] Theme validation and missing-key warnings for external themes

| Checkpoint | Verification |
|------------|--------------|
| Prefix rename complete | `grep -r -- '--tl-' tugdeck/` returns no matches |
| Theme files extracted | `ls tugdeck/styles/{brio,bluenote,harmony}.css` succeeds |
| Stylesheet injection works | Inspector shows `<style id="tug-theme-override">` when non-Brio theme active |
| Motion tokens defined | `getComputedStyle(document.body).getPropertyValue('--td-duration-fast')` returns `100ms` |
| TugThemeProvider functional | `useThemeContext()` returns current theme name and working setter |
| Mac menu wired | Tug > Theme > {Brio, Bluenote, Harmony} submenu items switch themes |
| Tests pass | `bun test` and `bunx tsc --noEmit` both succeed |
