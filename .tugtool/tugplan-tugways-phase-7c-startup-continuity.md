## Tugways Phase 7c — Startup Continuity {#phase-7c-startup-continuity}

**Purpose:** Eliminate all visual flash during frontend reload, CSS edits, and backend restart by applying three complementary layers: inline body styles, a startup overlay with TugAnimator fade-out, and a CSS HMR boundary module.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-7c-startup-continuity |
| Last updated | 2026-03-10 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Tugdeck flashes the entire UI during three scenarios: CSS edits in dev mode trigger full page reloads because the CSS import chain propagates invalidation to `main.tsx` (which has no HMR accept handler); browser or dock-menu reloads show a brief white flash because `index.html` has no inline body styles; and the empty `deck-container` is visible during the settings-fetch and React-mount phases before DeckCanvas renders. The goal is seamless visual continuity across all three scenarios.

Phase 7a delivered TugAnimator (WAAPI wrapper with completion promises, cancellation, duration tokens). Phase 7b migrated programmatic animations to TugAnimator and added skeleton loading states. Phase 7c is the final piece: applying these capabilities at the viewport level for startup continuity.

#### Strategy {#strategy}

- Layer A (inline body styles) eliminates the white flash by setting `background-color:#16171a` directly on `<body>` in `index.html`, applied during HTML parse before any CSS loads.
- Layer B (startup overlay) hides the mount transition with a full-viewport overlay div that fades out via TugAnimator, triggered by `useLayoutEffect` in DeckCanvas — the onContentReady pattern (Rules 11-12, D79) at viewport scope.
- Layer C (CSS HMR boundary) prevents CSS changes from triggering full page reloads by isolating all CSS imports into a self-accepting `css-imports.ts` module.
- Each layer is independent and commits separately, allowing isolated verification.
- The overlay fade-out uses `--tug-base-motion-duration-slow` (350ms) matching the `--tug-base-motion-pattern-startup-reveal` token defined in tug-tokens.css.

#### Success Criteria (Measurable) {#success-criteria}

- Editing a color in `tokens.css` updates the UI in-place without a full page reload (verify: browser console shows `[vite] css hot updated` not `[vite] page reload`)
- Full browser refresh (Cmd+R) shows a continuous dark background throughout, with the deck fading in smoothly (no white frame visible)
- "Reload Frontend" from dock menu behaves identically to browser refresh
- Backend restart shows disconnect banner over existing cards, no flash on reconnection

#### Scope {#scope}

1. Layer A: Inline body styles on `<body>` in `tugdeck/index.html`
2. Layer B: Startup overlay div in `tugdeck/index.html` + `useLayoutEffect` in DeckCanvas for TugAnimator fade-out
3. Layer C: New `tugdeck/src/css-imports.ts` HMR boundary module replacing CSS imports in `main.tsx`, including `@xterm/xterm/css/xterm.css`

#### Non-goals (Explicitly out of scope) {#non-goals}

- Theme-aware inline color (reading theme from localStorage/cookie before CSS loads) — the Brio default is the pragmatic choice per the design doc
- Inlining the grid background pattern in the body style — the grid appearing ~20ms after the solid background is imperceptible
- Per-card skeleton loading (already delivered in Phase 7b)
- Making `main.tsx` itself accept HMR (the alternative Layer C approach) — the dedicated boundary module is cleaner

#### Dependencies / Prerequisites {#dependencies}

- Phase 7a (TugAnimator engine) — delivered, provides `animate()` with duration token resolution
- Phase 7b (managed animations) — delivered, established TugAnimator patterns
- `--tug-base-motion-pattern-startup-reveal` token — already defined in `tug-tokens.css` as `opacity var(--tug-base-motion-duration-slow) var(--tug-base-motion-easing-enter)`

#### Constraints {#constraints}

- No `requestAnimationFrame` for operations depending on React state commits (Rule 12, D79)
- Overlay fade-out must use TugAnimator, not CSS keyframes, because code controls the overlay's DOM removal (Rule 14, D76)
- The `import.meta.hot` guard in css-imports.ts is tree-shaken in production builds — no production impact from Layer C

#### Assumptions {#assumptions}

- The Brio theme's `--tug-base-bg-canvas` token (computed from `--tug-color(violet-6, i: 2, t: 5)`) resolves to `#16171a` as specified in the design docs; this will be verified at implementation time via `canvasColorHex('brio')` in `canvas-color.ts`
- Vite's CSS module replacement (re-injecting `<style>` tags on HMR) does not leak duplicate style elements
- The startup `useLayoutEffect` in DeckCanvas will be the first `useLayoutEffect` in the hook order, added before the existing selection highlight sync and initial clip-path effects
- `anim.finished.then(() => overlay.remove())` is safe for cleanup — TugAnimation.finished resolves after the animation completes visually

---

### Design Decisions {#design-decisions}

#### [D01] Inline body styles use Brio default color (DECIDED) {#d01-inline-brio-default}

**Decision:** The inline `style` attribute on `<body>` uses `background-color:#16171a` (Brio's canvas color) as a hardcoded value.

**Rationale:**
- Inline styles are applied during HTML parse, before any CSS or JS executes — this is the only way to eliminate the white flash completely
- Brio is the default theme; non-Brio users see a brief dark-to-theme-color shift which is far less jarring than white-to-dark
- Reading the theme from settings requires JS execution, defeating the purpose of inline styles

**Implications:**
- If the Brio canvas color changes, the inline value must be updated manually
- Non-Brio users accept a brief color transition as a tradeoff

#### [D02] Overlay fade-out via useLayoutEffect in DeckCanvas (DECIDED) {#d02-overlay-uselayouteffect}

**Decision:** The startup overlay is removed by a `useLayoutEffect` with empty deps in DeckCanvas that triggers a TugAnimator fade-out. This is the onContentReady pattern (Rules 11-12, D78, D79) applied at viewport scope.

**Rationale:**
- `useLayoutEffect` fires after React commits DOM mutations but before the browser paints — the browser composites both the React content and the first frame of the fade in a single paint
- This is deterministic (a React contract), unlike `requestAnimationFrame` which is a timing bet relative to React's commit cycle
- The same mechanism as card-level onContentReady, just at a different scope — viewport-level readiness in the root component

**Implications:**
- The overlay `useLayoutEffect` must be added as the first `useLayoutEffect` in DeckCanvas's hook order, and the hook order comment updated accordingly
- DeckCanvas imports `animate` from `tug-animator.ts`

#### [D03] CSS HMR boundary as dedicated module (DECIDED) {#d03-css-hmr-boundary}

**Decision:** All CSS side-effect imports are consolidated into `tugdeck/src/css-imports.ts` with `import.meta.hot.accept()` (self-accepting, no callback). `main.tsx` imports this module instead of individual CSS files.

**Rationale:**
- CSS invalidations from `@tailwindcss/vite` recompilation propagate up the module graph; without an HMR boundary, they reach `main.tsx` and trigger full page reloads
- A self-accepting module stops the propagation — `css-imports.ts` re-executes on CSS change, re-injecting updated `<style>` tags without touching `main.tsx`
- Cleaner than making `main.tsx` accept specific CSS dependencies (the alternative approach)

**Implications:**
- `css-imports.ts` re-executing on HMR is safe because Vite replaces (not duplicates) `<style>` tags
- The `@xterm/xterm/css/xterm.css` import is included in `css-imports.ts` per user specification
- `import.meta.hot` is tree-shaken in production — zero production overhead

#### [D04] Overlay uses fixed positioning and high z-index (DECIDED) {#d04-overlay-positioning}

**Decision:** The startup overlay div uses `position:fixed;inset:0;z-index:99999;pointer-events:none` to cover the entire viewport above all content.

**Rationale:**
- Fixed positioning ensures coverage regardless of scroll state or container positioning
- z-index 99999 ensures the overlay is above all cards (which use z-index from CARD_ZINDEX_BASE upward)
- `pointer-events:none` prevents the overlay from intercepting clicks during the fade-out transition

**Implications:**
- The overlay is removed from the DOM after the fade completes, so the high z-index is temporary

---

### Specification {#specification}

#### Layer A: Inline Body Styles {#spec-layer-a}

**Spec S01: index.html body tag** {#s01-body-tag}

The `<body>` tag in `tugdeck/index.html` must have the following inline style:

```html
<body style="margin:0;padding:0;overflow:hidden;background-color:#16171a">
```

- `margin:0;padding:0` — eliminates default browser margin/padding
- `overflow:hidden` — prevents scrollbars during mount
- `background-color:#16171a` — Brio default canvas color (`--tug-base-bg-canvas`), applied during HTML parse before any CSS loads

Note: `margin:0`, `padding:0`, and `overflow:hidden` intentionally duplicate rules in `globals.css`. The inline versions cover the window during the ~20-50ms before CSS loads; once `globals.css` is parsed, the CSS rules take over with identical values.

#### Layer B: Startup Overlay {#spec-layer-b}

**Spec S02: Startup overlay div** {#s02-overlay-div}

A div with id `deck-startup-overlay` is added to `index.html` as the first child of `<body>`, before the diagnostic script:

```html
<div id="deck-startup-overlay"
     style="position:fixed;inset:0;background:#16171a;z-index:99999;
            pointer-events:none"></div>
```

**Spec S03: Overlay fade-out in DeckCanvas** {#s03-overlay-fadeout}

DeckCanvas adds a `useLayoutEffect` (empty deps) as the first layout effect in hook order:

```tsx
useLayoutEffect(() => {
  const overlay = document.getElementById("deck-startup-overlay");
  if (!overlay) return;
  const anim = animate(overlay, { opacity: [1, 0] }, {
    duration: "--tug-base-motion-duration-slow",
    easing: "cubic-bezier(0, 0, 0, 1)",
  });
  anim.finished.then(() => overlay.remove());
}, []);
```

- Duration: `--tug-base-motion-duration-slow` (350ms base, scaled by `getTugTiming()`)
- Easing: `cubic-bezier(0, 0, 0, 1)` — matches `--tug-base-motion-easing-enter` from tug-tokens.css, consistent with the `--tug-base-motion-pattern-startup-reveal` token definition
- Cleanup: `overlay.remove()` after animation completes via `TugAnimation.finished` promise
- The `animate` import comes from `@/components/tugways/tug-animator`

#### Layer C: CSS HMR Boundary {#spec-layer-c}

**Spec S04: css-imports.ts** {#s04-css-imports}

New file `tugdeck/src/css-imports.ts`:

```ts
/**
 * CSS import module — isolates CSS from the main entry point.
 *
 * All CSS side-effect imports live here. This module explicitly accepts
 * HMR updates so CSS changes never propagate to main.tsx (which would
 * trigger a full page reload since main.tsx has no HMR accept handler).
 */
import "./globals.css";
import "../styles/chrome.css";
import "@xterm/xterm/css/xterm.css";

if (import.meta.hot) {
  import.meta.hot.accept();
}
```

Note: `@xterm/xterm/css/xterm.css` is a new import added per user specification, not moved from `main.tsx` (which did not previously import xterm CSS).

**Spec S05: main.tsx CSS import replacement** {#s05-main-css-replacement}

Replace the two CSS imports at the top of `main.tsx`:

```ts
// Before:
import "./globals.css";
import "../styles/chrome.css";

// After:
import "./css-imports";
```

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/css-imports.ts` | CSS HMR boundary module — consolidates CSS imports with `import.meta.hot.accept()` |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `deck-startup-overlay` | HTML div id | `tugdeck/index.html` | Full-viewport overlay for startup continuity |
| `animate` | import | `tugdeck/src/components/chrome/deck-canvas.tsx` | TugAnimator import for overlay fade-out |

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Vite duplicates `<style>` tags on HMR re-execution | med | low | Verify with manual testing; Vite's CSS pipeline replaces tags | Style tag count increases after CSS edit |
| Tailwind v4 plugin invalidates at a level that bypasses css-imports.ts | high | low | Fall back to self-accepting main.tsx approach (Layer C alternative in design doc) | `[vite] page reload` still appears after CSS edit |
| Overlay removal race with React unmount on rapid reload | low | low | The `if (!overlay) return` guard handles missing overlay; `pointer-events:none` prevents interaction issues | N/A |

**Risk R01: Tailwind HMR bypass** {#r01-tailwind-hmr-bypass}

- **Risk:** The `@tailwindcss/vite` plugin may invalidate CSS at a module graph level that bypasses the `css-imports.ts` HMR boundary.
- **Mitigation:** Test against the currently pinned Tailwind v4 version. If bypass occurs, fall back to the alternative approach of adding `import.meta.hot.accept()` handlers directly in `main.tsx` for specific CSS dependencies.
- **Residual risk:** Future Tailwind plugin updates may change HMR behavior; re-verify after upgrades.

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Layer A — Inline Body Styles {#step-1}

**Commit:** `feat(tugdeck): inline body styles to eliminate white flash on reload`

**References:** [D01] Inline Brio default color, Spec S01 (#s01-body-tag), (#context, #strategy)

**Artifacts:**
- Modified `tugdeck/index.html` — body tag gains inline style attribute

**Tasks:**
- [ ] Verify `#16171a` matches Brio's `--tug-base-bg-canvas` by checking that `canvasColorHex('brio')` in `tugdeck/src/canvas-color.ts` computes to `#16171a` (run in browser console or write a quick test). If the computed value differs, update all occurrences of `#16171a` in this plan and in `index.html` to match.
- [ ] Edit `tugdeck/index.html`: add `style="margin:0;padding:0;overflow:hidden;background-color:#16171a"` to the `<body>` tag

**Tests:**
- [ ] Visual verification: full page reload no longer shows a white flash (body is dark from first paint)

**Checkpoint:**
- [ ] `grep -q 'background-color:#16171a' tugdeck/index.html` confirms inline style is present

---

#### Step 2: Layer B — Startup Overlay {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugdeck): startup overlay with TugAnimator fade-out`

**References:** [D02] Overlay useLayoutEffect, [D04] Overlay positioning, Spec S02 (#s02-overlay-div), Spec S03 (#s03-overlay-fadeout), (#spec-layer-b)

**Artifacts:**
- Modified `tugdeck/index.html` — add `deck-startup-overlay` div as first child of `<body>`
- Modified `tugdeck/src/components/chrome/deck-canvas.tsx` — add `useLayoutEffect` for overlay fade-out, add `animate` import from tug-animator

**Tasks:**
- [ ] Add `<div id="deck-startup-overlay" style="position:fixed;inset:0;background:#16171a;z-index:99999;pointer-events:none"></div>` as first child of `<body>` in `index.html`, before the diagnostic script
- [ ] Add `import { animate } from "@/components/tugways/tug-animator"` to deck-canvas.tsx
- [ ] Add startup overlay `useLayoutEffect` as the first `useLayoutEffect` in DeckCanvas, before the selection highlight sync effect, per Spec S03
- [ ] Update both hook order comments in DeckCanvas. The inline comment (line 214) is stale — it says "initial shadows" instead of the current hook names. First, bring the inline comment into full sync with the top-of-file JSDoc comment (line 44), then add the new `useLayoutEffect (startup overlay fade-out)` entry as the first layout effect in both comments

**Tests:**
- [ ] Visual verification: full page reload shows continuous dark background, then deck fades in smoothly
- [ ] Verify overlay div is removed from DOM after fade completes (inspect Elements panel)

**Checkpoint:**
- [ ] `grep -q 'deck-startup-overlay' tugdeck/index.html` confirms overlay div exists
- [ ] `grep -q 'deck-startup-overlay' tugdeck/src/components/chrome/deck-canvas.tsx` confirms useLayoutEffect references overlay
- [ ] `cd tugdeck && bunx tsc --noEmit` passes with no type errors

---

#### Step 3: Layer C — CSS HMR Boundary {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugdeck): css-imports.ts HMR boundary prevents full reload on CSS edit`

**References:** [D03] CSS HMR boundary, Spec S04 (#s04-css-imports), Spec S05 (#s05-main-css-replacement), Risk R01 (#r01-tailwind-hmr-bypass), (#spec-layer-c)

**Artifacts:**
- New file `tugdeck/src/css-imports.ts` — CSS imports with HMR self-accept
- Modified `tugdeck/src/main.tsx` — replace individual CSS imports with single `import "./css-imports"`

**Tasks:**
- [ ] Create `tugdeck/src/css-imports.ts` per Spec S04: import `./globals.css`, `../styles/chrome.css`, `@xterm/xterm/css/xterm.css`, and add `import.meta.hot.accept()`
- [ ] In `main.tsx`, replace the two CSS import lines (`import "./globals.css"` and `import "../styles/chrome.css"`) and the comment above them with a single `import "./css-imports"` with an explanatory comment

**Tests:**
- [ ] Visual verification: editing a color in `tokens.css` updates the UI without full page reload
- [ ] Browser console shows `[vite] css hot updated` (not `[vite] page reload`) after CSS edit

**Checkpoint:**
- [ ] `test -f tugdeck/src/css-imports.ts` confirms new file exists
- [ ] `grep -q 'import.meta.hot.accept' tugdeck/src/css-imports.ts` confirms HMR boundary
- [ ] `grep -q 'import "./css-imports"' tugdeck/src/main.tsx` confirms main.tsx uses the boundary module
- [ ] `cd tugdeck && bunx tsc --noEmit` passes with no type errors

---

#### Step 4: Integration Checkpoint {#step-4}

**Depends on:** #step-1, #step-2, #step-3

**Commit:** `N/A (verification only)`

**References:** [D01] Inline Brio default, [D02] Overlay useLayoutEffect, [D03] CSS HMR boundary, (#success-criteria)

**Tasks:**
- [ ] Verify all three layers work together end-to-end
- [ ] Run through all four verification scenarios from the success criteria

**Tests:**
- [ ] Edit a CSS color in `tokens.css` — no flash, color updates in-place
- [ ] Click "Reload Frontend" in dock menu — dark background throughout, smooth fade-in
- [ ] Restart the backend — disconnect banner appears, cards stay visible, no flash on reconnection
- [ ] Full browser refresh (Cmd+R) — same as "Reload Frontend" behavior
- [ ] Verify no duplicate `<style>` tags after multiple CSS edits (inspect Elements panel)

**Checkpoint:**
- [ ] All four scenarios pass without visual flash
- [ ] `cd tugdeck && bunx tsc --noEmit` passes with no type errors

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Zero-flash startup continuity across CSS edits, browser reloads, dock-menu reloads, and backend restarts.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tugdeck/index.html` has inline body styles with `background-color:#16171a` (grep verification)
- [ ] `tugdeck/index.html` has `deck-startup-overlay` div (grep verification)
- [ ] `tugdeck/src/css-imports.ts` exists with HMR self-accept (file exists + grep verification)
- [ ] `tugdeck/src/main.tsx` imports `./css-imports` instead of individual CSS files (grep verification)
- [ ] `tugdeck/src/components/chrome/deck-canvas.tsx` has startup overlay `useLayoutEffect` (grep verification)
- [ ] `cd tugdeck && bunx tsc --noEmit` passes with no type errors

**Acceptance tests:**
- [ ] CSS edit in dev mode: no full page reload, color updates in-place
- [ ] Browser refresh: continuous dark background, smooth deck fade-in
- [ ] Backend restart: no flash on reconnection

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Theme-aware inline color via inline script reading localStorage (if settings model adds client-side caching)
- [ ] Inline grid background pattern in body style for pixel-perfect first paint
- [ ] Per-card skeleton loading refinements (Phase 7b follow-on)

| Checkpoint | Verification |
|------------|--------------|
| No white flash on reload | Browser refresh shows dark background from first paint |
| Overlay fades smoothly | Overlay div removed from DOM after TugAnimator fade completes |
| CSS HMR works | `tokens.css` edit produces `[vite] css hot updated` in console |
| TypeScript compiles | `cd tugdeck && bunx tsc --noEmit` exits 0 |
