<!-- tugplan-skeleton v2 -->

## Tugways Phase 5d5f: Cascade Inspector {#cascade-inspector}

**Purpose:** Ship a dev-mode `Ctrl+Option + hover` cascade inspector overlay that shows the full token resolution chain (component tokens, base tokens, palette variables, HVV provenance) and scale/timing readout for any inspected element, making the tugways style system navigable instead of opaque.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-5d5f-cascade-inspector |
| Last updated | 2026-03-07 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The tugways design system now has a complete three-layer token architecture: `--tug-comp-*` component tokens resolve to `--tug-base-*` semantic tokens, which in turn resolve through `var(--tug-{hue}[-preset])` palette references down to pure CSS OKLCH formulas in `tug-palette.css`. Global scale (`--tug-zoom`) and timing (`--tug-timing`, `--tug-motion`) multipliers control dimensions and animation durations. This architecture is powerful but invisible -- developers cannot see which tokens are active on a given element, where color values come from in the HVV palette, or how scale/timing affect computed dimensions without manually reading CSS custom property chains in browser devtools.

Phase 5d5f adds a purpose-built cascade inspector that exposes the tugways token contract directly. Unlike browser devtools, this inspector understands the tugways token layers, HVV palette provenance (hue family, preset name, vibrancy/value coordinates), and scale/timing multiplier effects. It builds on the existing `StyleCascadeReader` singleton (Phase 5d3) and `scale-timing.ts` helpers (Phase 5d5b), and follows the pure TypeScript / no React pattern established by other tugways infrastructure modules.

#### Strategy {#strategy}

- Implement the inspector as a pure TypeScript singleton (`StyleInspectorOverlay`) with no React involvement, following the `StyleCascadeReader` and `MutationTransactionManager` pattern -- DOM manipulation only, no `root.render()` calls.
- Gate all inspector code behind `process.env.NODE_ENV !== 'production'` so it is tree-shaken from production builds.
- Use `elementFromPoint` to identify the inspection target directly under the cursor, with no walk-up to parent components.
- Walk `var()` references textually by reading raw CSS variable value strings from computed style and parsing `var(--tug-...)` references to build the resolution chain.
- Use a separate absolutely-positioned DOM element for the target highlight overlay, consistent with the no-injection approach (no inline styles on the target element).
- Append the inspector panel as a single fixed-position div to `document.body`, managed by the singleton lifecycle.
- Add a new gallery tab ("Cascade Inspector") with interactive demo components to exercise the inspector.

#### Success Criteria (Measurable) {#success-criteria}

- Inspector activates only when `Ctrl+Option` are held and deactivates when released (`keydown`/`keyup` event verification).
- Token chain correctly resolves all three layers for components that consume comp tokens: `--tug-comp-*` to `--tug-base-*` to `--tug-{hue}[-preset]` palette variables (verified on TugTabBar or Tugcard, which consume `--tug-comp-tab-*` and `--tug-comp-card-*` respectively). For components like TugButton that reference `--tug-base-*` directly, the chain shows two layers with a "(no comp token)" indicator.
- HVV palette provenance displays hue family name, preset name, and coordinates (vibrancy, value, canonical L) for any palette-derived color.
- Scale/timing readout shows current `--tug-zoom` and `--tug-timing` values.
- Pin/unpin works: clicking pins the overlay in place; `Escape` closes it.
- Inspector is absent from production bundles (verified by searching build output for inspector class names).
- Gallery "Cascade Inspector" tab renders with inspectable sample components.
- All existing tests continue to pass (`bun test`).

#### Scope {#scope}

1. `StyleInspectorOverlay` singleton -- modifier key tracking, overlay lifecycle, target identification, token chain resolution, HVV provenance extraction, scale/timing readout, pin/unpin, Escape to close.
2. `style-inspector-overlay.css` -- overlay panel styles, target highlight styles, section/row layout, color swatch rendering.
3. `gallery-cascade-inspector-content.tsx` -- new gallery tab content component with inspectable sample elements.
4. Gallery card registration updates -- add 11th tab entry to `GALLERY_DEFAULT_TABS` and register `gallery-cascade-inspector` componentId.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Full CSS rule-matching engine (we parse `var()` references, not stylesheets).
- Inspecting pseudo-elements (`::before`, `::after`).
- Walk-up to nearest component root -- we inspect whatever `elementFromPoint` returns directly.
- Editing or mutating token values from the inspector (read-only introspection only).
- Production build inclusion -- inspector is dev-only.

#### Dependencies / Prerequisites {#dependencies}

- Phase 5d5e (Palette Engine Integration) complete -- `tug-palette.css` with pure CSS HVV formulas and `tug-tokens.css` chromatic tokens resolving via `var(--tug-{hue}[-preset])`.
- Phase 5d3 (`StyleCascadeReader` singleton in `style-cascade-reader.ts`) available for import.
- Phase 5d5b (`scale-timing.ts` helpers: `getTugZoom`, `getTugTiming`, `isTugMotionEnabled`) available for import.
- Gallery card infrastructure (Phase 5b3) in place with card registration pattern.

#### Constraints {#constraints}

- No React involvement for the inspector module itself -- pure TypeScript with direct DOM manipulation, per Rules of Tugways #1 and #4.
- No injection of inline styles onto inspected target elements -- use a separate overlay element for the highlight.
- Must be tree-shakeable from production builds via `process.env.NODE_ENV` gating.
- Gallery content component follows existing gallery card patterns (React component using existing tugways primitives).

#### Assumptions {#assumptions}

- Phase 5d5e is complete: `tug-palette.css` exists with pure CSS HVV formulas and `tug-tokens.css` chromatic tokens already resolve via `var(--tug-{hue}[-preset])` references.
- The scale-timing helpers (`getTugZoom`, `getTugTiming`, `isTugMotionEnabled`) will be imported directly rather than reimplemented. The `StyleCascadeReader` singleton will NOT be used for token source detection because its `getDeclared()` method compares against `document.documentElement`, which returns empty strings for body-scoped tokens. The inspector implements its own body-aware token matching.
- The overlay highlight uses a separate absolutely-positioned DOM element, consistent with the no-injection approach.
- The overlay panel is a single fixed-position div appended to `document.body`, managed by the singleton lifecycle.
- The inspector is implemented as a pure TypeScript module with no React involvement.
- `getComputedStyle(document.body).getPropertyValue('--tug-base-accent-default')` returns the raw string `var(--tug-orange)` (not the resolved color value) because CSS custom properties preserve their declared value strings in computed style when the value is another `var()` reference. This is the mechanism that enables textual chain walking. Note: token custom properties are scoped to `body` (not `:root`), so chain walking must read from `document.body`. The scale/timing globals (`--tug-zoom`, `--tug-timing`, `--tug-motion`) ARE on `:root` and are read via the existing `getTugZoom()`/`getTugTiming()` helpers which already use `document.documentElement`.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit anchors per the skeleton contract. All anchors are kebab-case, stable, and referenced via `#anchor-name` tokens.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| var() chain walking fails for some tokens | med | med | Graceful fallback: show "unresolved" for tokens that don't contain var() | If more than 2 token types fail resolution in testing |
| Computed style returns resolved color instead of var() string | high | med | Test with actual browser early in Step 2; if var() is resolved, fall back to pattern-matching token names from element class/attribute context | If chain always shows single-hop resolution |
| Performance impact of getComputedStyle on every pointer move | med | low | Throttle pointer move handler to 60fps via requestAnimationFrame; skip if target unchanged | If inspector causes visible jank during hover |

**Risk R01: var() chain resolution fidelity** {#r01-var-chain-fidelity}

- **Risk:** `getComputedStyle` may return the fully resolved OKLCH color value instead of the intermediate `var(--tug-...)` string for some browsers or property types, breaking chain walking. The CSS spec says computed values of custom properties are their specified values, and Chromium preserves raw `var()` strings, but behavior may vary across browser engines. Since tugdeck targets WKWebView, this needs early verification.
- **Mitigation:**
  - **Early verification (first task of Step 2):** Log `getComputedStyle(document.body).getPropertyValue('--tug-base-action-primary-bg-rest')` in the browser console and verify it returns `var(--tug-orange)` (or the expected raw string). If it does not, activate the fallback path before building the full UI.
  - Test chain walking against known token paths during Step 2.
- If computed style resolves through `var()` to a terminal value, implement a fallback: use the token name's naming convention (`--tug-base-*` maps predictably to `--tug-{hue}[-preset]` names) to infer the palette provenance without walking the chain. For example, `--tug-base-accent-default` is known to map to `--tug-{accent-hue}` based on the token architecture.
  - Display a "(heuristic)" indicator when using the fallback path.
- **Residual risk:** Some custom property chains may show incomplete provenance if the browser resolves multiple `var()` levels at once.

---

### Design Decisions {#design-decisions}

#### [D01] Inspector is a pure TypeScript singleton (DECIDED) {#d01-pure-ts-singleton}

**Decision:** The `StyleInspectorOverlay` is implemented as a pure TypeScript class with direct DOM manipulation, not as a React component.

**Rationale:**
- Rules of Tugways #1: never call `root.render()` after initial mount.
- Rules of Tugways #4: appearance changes go through CSS and DOM, never React state.
- Follows the established pattern of `StyleCascadeReader`, `MutationTransactionManager`, and the scale-timing module.
- The inspector is ephemeral dev tooling that does not participate in the React component tree.

**Implications:**
- All overlay DOM elements are created, positioned, and removed via `document.createElement` / `document.body.appendChild` / `element.remove()`.
- No JSX, no hooks, no React imports in `style-inspector-overlay.ts`.
- The gallery demo tab content component (`gallery-cascade-inspector-content.tsx`) IS a React component because it participates in the gallery card system.

#### [D02] Dev-only gating via NODE_ENV (DECIDED) {#d02-dev-only-gating}

**Decision:** All inspector initialization code is gated behind `process.env.NODE_ENV !== 'production'`, following the existing pattern in `tug-button.tsx`.

**Rationale:**
- Vite replaces `process.env.NODE_ENV` at build time, enabling dead-code elimination.
- Zero bytes in production bundles.
- Consistent with existing dev-only code patterns in the codebase.

**Implications:**
- The `initStyleInspector()` call in `main.tsx` must be wrapped in the NODE_ENV check.
- The CSS file (`style-inspector-overlay.css`) will still be included in dev builds but has no effect without the JS activating the overlay.

#### [D03] Direct element inspection via elementFromPoint (DECIDED) {#d03-element-from-point}

**Decision:** The inspector uses `document.elementFromPoint(x, y)` to identify the target and inspects that element directly with no walk-up to a component root.

**Rationale:**
- User answer specified "Direct element -- Use the element directly under the cursor with no walk-up."
- Simpler implementation, more precise targeting.
- Developers can inspect leaf elements (spans, divs) to see exactly which tokens apply at that DOM level.

**Implications:**
- The inspector may show different results depending on whether the cursor is over a button label span vs the button container div.
- The DOM path display helps orient the developer to the element's position in the component hierarchy.

#### [D04] Textual var() reference walking for token chain (DECIDED) {#d04-var-chain-walking}

**Decision:** Token chain resolution works by reading the raw CSS variable value string from computed style and parsing `var(--tug-...)` references textually, walking the chain until a terminal (non-var) value is reached.

**Rationale:**
- User answer specified "Walk var() references -- Read raw CSS variable value strings from computed style and walk the var() references textually."
- `getComputedStyle(document.body).getPropertyValue('--tug-base-accent-default')` returns `var(--tug-orange)`, which can be parsed to extract the next token name. (Token properties are scoped to `body`, not `:root`.)
- This naturally follows the three-layer architecture: `--tug-comp-*` -> `--tug-base-*` -> `--tug-{hue}[-preset]`.

**Implications:**
- Need a regex parser for `var(--tug-...[, fallback])` syntax.
- Chain walking terminates at three points: (1) when the current property matches the PALETTE_VAR_REGEX (one of 24 known hue family names with an optional preset suffix from `accent|muted|light|subtle|dark|deep`) -- these resolve to `oklch()` expressions with nested `var()` calls to internal palette constants, which the HVV provenance display handles; (2) when the value starts with `oklch(` (formula terminal); (3) when the value does not contain a `var()` reference (literal hex, rgb, length, etc.).
- Risk R01 applies if some browsers resolve through var() references in computed style.

#### [D05] Pin/unpin interaction model (DECIDED) {#d05-pin-unpin}

**Decision:** Clicking while the inspector is active pins the overlay. Pinned state keeps the panel visible and the highlight locked even after moving the cursor away. Escape closes the overlay (pinned or not).

**Rationale:**
- Matches the interaction model described in the theme overhaul proposal.
- Pinning lets developers examine long token chains without holding keys and keeping the cursor perfectly still.

**Implications:**
- The singleton tracks a `pinned` boolean state.
- When pinned: pointer move does not update the target; modifier key release does not hide the overlay.
- Escape always hides and unpins.
- Clicking a second time while pinned unpins and returns to live-hover mode.

#### [D06] Gallery tab with inspectable sample components (DECIDED) {#d06-gallery-tab}

**Decision:** Add an 11th gallery tab ("Cascade Inspector") with a new `gallery-cascade-inspector-content.tsx` component containing inspectable sample elements that exercise multiple token layers.

**Rationale:**
- User answer specified "New gallery tab -- Add an 11th gallery tab ('Cascade Inspector') with an interactive demo area containing inspectable sample components."
- Provides a controlled environment for verifying inspector functionality.
- Follows the established gallery card registration pattern.

**Implications:**
- `GALLERY_DEFAULT_TABS` array in `gallery-card.tsx` grows to 11 entries.
- New `registerCard` call for `gallery-cascade-inspector` componentId.
- New file `gallery-cascade-inspector-content.tsx` created.

---

### Specification {#specification}

#### Terminology and Naming {#terminology}

| Term | Definition |
|------|-----------|
| Token chain | The sequence of CSS custom property references from a `--tug-comp-*` or `--tug-base-*` token down to its terminal resolved value |
| HVV provenance | The hue family name, preset name, and vibrancy/value/canonical-L coordinates for a palette-derived color |
| Inspect target | The DOM element returned by `elementFromPoint` at the cursor position |
| Pinned | State where the overlay remains visible and locked to a target after clicking |
| Terminal value | A CSS value that does not contain a `var()` reference (e.g., an OKLCH color, a hex color, a length) |

#### Internal Architecture {#internal-architecture}

**Spec S01: StyleInspectorOverlay Singleton** {#s01-inspector-singleton}

```
StyleInspectorOverlay (singleton)
  ├── State
  │   ├── active: boolean (Ctrl+Option held)
  │   ├── pinned: boolean (clicked to lock)
  │   ├── currentTarget: HTMLElement | null
  │   └── cleanup: (() => void) | null
  ├── DOM Elements (created on init, appended to body)
  │   ├── highlightEl: div.tug-inspector-highlight (absolutely positioned)
  │   └── panelEl: div.tug-inspector-panel (fixed position)
  ├── Event Handlers
  │   ├── onKeyDown: detect Ctrl+Option combo -> activate
  │   ├── onKeyUp: detect modifier release -> deactivate (unless pinned)
  │   ├── onPointerMove: elementFromPoint -> update target (unless pinned)
  │   ├── onClick: toggle pin state
  │   └── onKeyDown(Escape): close and unpin
  └── Methods
      ├── init(): attach event listeners, create DOM
      ├── destroy(): remove listeners, remove DOM
      ├── activate(): show overlay, start tracking
      ├── deactivate(): hide overlay, stop tracking
      ├── inspectElement(el): read tokens, build chain, update panel
      ├── resolveTokenChain(el, property): walk var() references
      ├── extractHvvProvenance(tokenName): parse hue/preset from token name
      └── positionPanel(x, y): place panel near cursor
```

**Spec S02: Token Chain Resolution Algorithm** {#s02-token-chain-algorithm}

```
resolveTokenChain(element, startProperty):
  chain = []
  currentProp = startProperty
  loop:
    rawValue = getComputedStyle(document.body).getPropertyValue(currentProp).trim()
    if rawValue is empty: break
    chain.push({ property: currentProp, value: rawValue })
    if currentProp matches PALETTE_VAR_REGEX (see below)
      break  // palette variable reached -- HVV provenance handles inner constants
    if rawValue starts with "oklch(": break  // formula terminal
    match = rawValue.match(/var\((--tug-[a-z0-9-]+)/)
    if no match: break  // terminal value (hex, rgb, literal)
    currentProp = match[1]
  return chain
```

**Chain termination rules:** The algorithm stops walking at `--tug-{hue}[-preset]` palette variables (e.g., `--tug-orange`, `--tug-cobalt-accent`). These resolve to `oklch()` expressions containing nested `var()` references to internal palette constants (`--tug-{hue}-canonical-l`, `--tug-preset-{name}-c`, etc.), which are implementation details of the palette engine formulas. The HVV provenance display (Spec S04) presents these constants in a structured, readable format instead. Walking into `oklch()` internals would produce a noisy, unhelpful chain of formula fragments.

**PALETTE_VAR_REGEX:** The palette variable detection regex must match only actual hue palette variables, not global constants like `--tug-l-dark`. Use a regex anchored to the 24 known hue family names:

```
/^--tug-(cherry|red|tomato|flame|orange|amber|gold|yellow|lime|green|mint|teal|cyan|sky|blue|cobalt|violet|purple|plum|pink|rose|magenta|berry|coral)(-(accent|muted|light|subtle|dark|deep))?$/
```

The six preset suffixes are: `accent`, `muted`, `light`, `subtle`, `dark`, `deep`. A bare hue name (no suffix) is the canonical preset. The regex explicitly lists all 24 hue family names to avoid false-matching global constants (`--tug-l-dark`, `--tug-l-light`) or per-hue internal constants (`--tug-orange-h`, `--tug-orange-canonical-l`, `--tug-orange-peak-c`).

The algorithm reads from `document.body` (not `document.documentElement`) because all three token CSS files (`tug-palette.css`, `tug-tokens.css`, `tug-comp-tokens.css`) scope their custom properties to the `body` selector. Reading from `document.documentElement` would return empty strings for all `--tug-base-*`, `--tug-comp-*`, and `--tug-{hue}*` properties since CSS custom properties inherit downward only. Note: `--tug-zoom`, `--tug-timing`, and `--tug-motion` ARE defined on `:root` in `tokens.css`, but those are read via the existing `scale-timing.ts` helpers which already use `document.documentElement`.

**Spec S03: Inspected Properties** {#s03-inspected-properties}

The inspector reads and displays chain resolution for these CSS properties when they are set on the target element:

| Category | Properties |
|----------|-----------|
| Background | `background-color`, `background` |
| Foreground | `color` |
| Border | `border-color`, `border-width`, `border-radius` |
| Shadow | `box-shadow` |
| Typography | `font-family`, `font-size`, `font-weight`, `line-height` |
| Spacing | `padding`, `margin`, `gap` |

**Token discovery strategy:** CSS does not provide a way to enumerate which custom properties are set on an element. The inspector uses a class-based heuristic to determine which component token family applies:

1. **Class-to-family mapping:** Inspect the element's `classList` for known tugways class prefixes that consume component tokens. Currently, three component families consume `--tug-comp-*` tokens: `.tug-tab-bar` / `.tug-tab` implies `--tug-comp-tab-*`, `.tugcard` / `.tugcard-header` implies `--tug-comp-card-*`, and `.tug-dropdown` implies `--tug-comp-dropdown-*`. Note: `.tug-button` does NOT consume `--tug-comp-button-*` tokens -- `tug-button.css` references `--tug-base-*` tokens directly (e.g., `var(--tug-base-accent-cool-default)`). The `--tug-comp-button-*` tokens exist in `tug-comp-tokens.css` but are not yet wired to the button CSS. For TugButton elements, the inspector skips to step 4 (base token fallback) and shows a two-layer chain.
2. **Walk-up for class context:** If the direct element has no recognized class, walk up to the nearest ancestor with a recognized `.tug-*` class (limited to 5 levels) to determine the component family context. This does not change the inspection target -- it only provides token family context.
3. **Known token enumeration:** For each identified component family, query a hardcoded list of known token names for that family (derived from `tug-comp-tokens.css`). Read each token from `document.body` and check if its resolved value matches the element's computed value for the relevant CSS property.
4. **Base token fallback:** If no `--tug-comp-*` match is found, try well-known `--tug-base-*` tokens for the property category (e.g., `--tug-base-surface-default` for `background-color`, `--tug-base-fg-default` for `color`).
5. **No match:** If no token origin can be identified, display the raw computed value with a "(no token -- inspector could not determine the originating design token for this property)" indicator. This is expected for elements without `.tug-*` classes whose ancestors are also outside the tugways component tree, and for properties set via non-token CSS rules.

**Spec S04: HVV Provenance Display** {#s04-hvv-provenance}

When a token chain terminates at a `--tug-{hue}` or `--tug-{hue}-{preset}` palette variable, the inspector displays:

| Field | Source | Example |
|-------|--------|---------|
| Hue family | Parse hue name from token (`--tug-orange` -> "orange") | orange |
| Preset | Parse preset from token (`--tug-orange-light` -> "light", `--tug-orange` -> "canonical") | light |
| Canonical L | Read `--tug-{hue}-canonical-l` from `document.body` | 0.780 |
| Peak C | Read `--tug-{hue}-peak-c` from `document.body` | 0.266 |
| Hue angle | Read `--tug-{hue}-h` from `document.body` | 55 |

**Spec S05: Scale/Timing Readout** {#s05-scale-timing-readout}

The inspector always shows the current global multiplier values, read via the existing `scale-timing.ts` helpers:

| Field | Helper | Display |
|-------|--------|---------|
| Zoom | `getTugZoom()` | `zoom: 1.0` |
| Timing | `getTugTiming()` | `timing: 1.0` |
| Motion | `isTugMotionEnabled()` | `motion: on` / `motion: off` |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/style-inspector-overlay.ts` | StyleInspectorOverlay singleton -- modifier key tracking, overlay lifecycle, token chain resolution, HVV provenance, scale/timing readout |
| `tugdeck/src/components/tugways/style-inspector-overlay.css` | Overlay panel styles, highlight element styles, section layout, color swatches |
| `tugdeck/src/components/tugways/cards/gallery-cascade-inspector-content.tsx` | Gallery tab content with inspectable sample components |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `StyleInspectorOverlay` | class | `style-inspector-overlay.ts` | Singleton managing the full inspector lifecycle |
| `initStyleInspector` | fn (exported) | `style-inspector-overlay.ts` | Creates and initializes the singleton; returns cleanup function |
| `resolveTokenChain` | method | `StyleInspectorOverlay` | Walks var() references to build the full token resolution chain |
| `extractHvvProvenance` | method | `StyleInspectorOverlay` | Parses hue/preset from palette token names and reads HVV constants |
| `GalleryCascadeInspectorContent` | React component | `gallery-cascade-inspector-content.tsx` | Gallery tab content with sample inspectable elements |
| `GALLERY_DEFAULT_TABS` | const (modified) | `gallery-card.tsx` | Add 11th entry for `gallery-cascade-inspector` |
| `registerGalleryCards` | fn (modified) | `gallery-card.tsx` | Add `gallery-cascade-inspector` registration block |

---

### Documentation Plan {#documentation-plan}

- [ ] JSDoc on `StyleInspectorOverlay` class and all public methods
- [ ] JSDoc on `initStyleInspector` explaining dev-only gating
- [ ] JSDoc on `GalleryCascadeInspectorContent` with authoritative references
- [ ] Inline comments in `style-inspector-overlay.css` explaining overlay positioning strategy

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test token chain resolution logic, HVV provenance extraction, modifier key state tracking | Core inspector logic in isolation |
| **Integration** | Test overlay lifecycle (init/destroy), DOM element creation/removal, event handler wiring | Singleton behavior end-to-end |
| **Manual verification** | Visual check of overlay positioning, panel content, highlight rendering | Browser-based visual QA |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: StyleInspectorOverlay singleton and CSS {#step-1}

**Commit:** `feat(tugways): add StyleInspectorOverlay singleton and CSS for cascade inspector`

**References:** [D01] Pure TS singleton, [D02] Dev-only gating, [D03] elementFromPoint targeting, [D05] Pin/unpin, Spec S01, Spec S03, Spec S05, (#context, #strategy, #internal-architecture, #s01-inspector-singleton, #s03-inspected-properties, #s05-scale-timing-readout)

**Artifacts:**
- `tugdeck/src/components/tugways/style-inspector-overlay.ts` -- new
- `tugdeck/src/components/tugways/style-inspector-overlay.css` -- new

**Tasks:**
- [ ] Create `StyleInspectorOverlay` class with singleton pattern (private constructor, module-level instance).
- [ ] Implement `init()`: create highlight div and panel div, append to `document.body`, attach `keydown`/`keyup`/`pointermove`/`click` event listeners on `document`.
- [ ] Implement `destroy()`: remove event listeners, remove DOM elements.
- [ ] Implement modifier key tracking: `onKeyDown` activates when both Ctrl and Alt (Option on Mac) are pressed; `onKeyUp` deactivates when either is released (unless pinned).
- [ ] Implement `onPointerMove`: call `document.elementFromPoint(e.clientX, e.clientY)` to get target; skip update if target is the inspector's own DOM; call `inspectElement()` if target changed.
- [ ] Implement `inspectElement(el)`: position highlight overlay over target element's bounding rect; populate panel with element tag, classes, DOM path.
- [ ] Implement pin/unpin: click toggles `pinned` state; when pinned, pointer move and modifier release are no-ops; Escape always closes.
- [ ] Implement scale/timing readout section using `getTugZoom()`, `getTugTiming()`, `isTugMotionEnabled()` from `scale-timing.ts`.
- [ ] Read computed background-color, color, border-color, and other Spec S03 properties for the inspected element and display their resolved values.
- [ ] Implement `positionPanel(x, y)`: place panel near cursor, clamped to viewport edges.
- [ ] Export `initStyleInspector()` function that creates the singleton if `process.env.NODE_ENV !== 'production'` and returns a cleanup function.
- [ ] Create `style-inspector-overlay.css` with styles for `.tug-inspector-highlight` (absolute positioning, border highlight, pointer-events:none) and `.tug-inspector-panel` (fixed position, dark background, monospace font, section layout, color swatches).
- [ ] Import CSS in the TS module.

**Tests:**
- [ ] Unit test: modifier key state transitions (keydown Ctrl+Alt -> active, keyup -> inactive).
- [ ] Unit test: pin/unpin state machine (click while active -> pinned, Escape -> closed, click while pinned -> unpinned).
- [ ] Unit test: `positionPanel` clamps to viewport boundaries.

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`
- [ ] Manual: open dev server, hold Ctrl+Option, hover elements -- highlight appears around hovered element, panel shows element info and scale/timing values.

---

#### Step 2: Token chain resolution and HVV provenance {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugways): add token chain resolution and HVV provenance to cascade inspector`

**References:** [D04] Textual var() chain walking, Spec S02, Spec S04, Risk R01, (#s02-token-chain-algorithm, #s04-hvv-provenance, #r01-var-chain-fidelity)

**Artifacts:**
- `tugdeck/src/components/tugways/style-inspector-overlay.ts` -- modified (add chain resolution methods)

**Tasks:**
- [ ] **Early verification (Risk R01):** Before implementing the full chain walker, log `getComputedStyle(document.body).getPropertyValue('--tug-base-action-primary-bg-rest')` in the target browser (WKWebView / Safari) and verify it returns the raw `var(--tug-orange)` string. If it returns a fully resolved color value instead, activate the heuristic fallback path first.
- [ ] Implement `resolveTokenChain(element, startProperty)` per Spec S02: read `getComputedStyle(document.body).getPropertyValue(prop)`, parse `var(--tug-...)` references with regex, walk until terminal value.
- [ ] Implement `extractHvvProvenance(tokenName)`: parse hue family and preset from `--tug-{hue}[-preset]` pattern; read `--tug-{hue}-canonical-l`, `--tug-{hue}-peak-c`, `--tug-{hue}-h` from `document.body` computed style (palette constants are scoped to `body` in `tug-palette.css`).
- [ ] Integrate chain resolution into `inspectElement()`: for each inspected property (Spec S03), attempt to identify the originating `--tug-comp-*` or `--tug-base-*` token, then walk its chain.
- [ ] Implement token discovery per Spec S03 strategy: use the element's class list (e.g., `.tug-tab-bar` -> `--tug-comp-tab-*`, `.tugcard` -> `--tug-comp-card-*`) to determine the component token family; enumerate known token names for that family; read each from `document.body` and check if its resolved value matches the element's computed value. Fall back to well-known `--tug-base-*` tokens if no component token matches. Note: do NOT use `styleCascadeReader.getDeclared()` for token source detection -- its token layer check compares against `document.documentElement`, which returns empty strings for body-scoped tokens. Instead, implement a body-aware check directly in the inspector: read the token from `document.body` and compare against the element's computed value.
- [ ] Display token chain in the panel. For a three-layer component (e.g., TugTabBar): `--tug-comp-tab-bar-bg -> --tug-base-tab-bar-bg -> #23262d`. For a two-layer component (e.g., TugButton, which references `--tug-base-*` directly): `--tug-base-accent-cool-default -> --tug-cobalt-accent` with a "(no comp token)" indicator (chain terminates at the palette variable; HVV provenance shows cobalt/accent details). Show each hop with an arrow separator.
- [ ] Display HVV provenance when chain terminates at a palette variable: hue family, preset, canonical L, peak C, hue angle per Spec S04.
- [ ] Implement Risk R01 fallback: if `getPropertyValue` returns a fully resolved value (no `var()`), attempt to match the token name pattern against known palette variable naming conventions and display "(heuristic)" indicator.
- [ ] Add color swatch rendering next to resolved color values in the panel.

**Tests:**
- [ ] Unit test: `resolveTokenChain` correctly walks a three-layer chain: `--tug-comp-tab-bar-bg` -> `--tug-base-tab-bar-bg` -> terminal value (mocked computed style).
- [ ] Unit test: `resolveTokenChain` correctly walks a two-layer chromatic chain: `--tug-base-accent-cool-default` -> `--tug-cobalt-accent` -> terminal (stops at palette variable per PALETTE_VAR_REGEX termination rule).
- [ ] Unit test: `resolveTokenChain` terminates on a non-var() value (e.g., hex color).
- [ ] Unit test: `resolveTokenChain` terminates at `--tug-{hue}[-preset]` palette variable (e.g., `--tug-orange-accent`) and does NOT walk into the `oklch()` expression with nested `var()` calls.
- [ ] Unit test: `extractHvvProvenance('--tug-orange-light')` returns `{ hue: 'orange', preset: 'light' }`.
- [ ] Unit test: `extractHvvProvenance('--tug-cyan')` returns `{ hue: 'cyan', preset: 'canonical' }`.
- [ ] Unit test: `extractHvvProvenance('--tug-cobalt-accent')` returns `{ hue: 'cobalt', preset: 'accent' }`.
- [ ] Unit test: fallback path triggers when computed style returns resolved value instead of var() string.

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`
- [ ] Manual: hover a TugTabBar tab in the gallery, verify panel shows full three-layer chain from `--tug-comp-tab-*` through `--tug-base-*` to terminal value. Hover a TugButton (primary variant), verify panel shows two-layer chain `--tug-base-accent-cool-default -> --tug-cobalt-accent` with "(no comp token)" indicator and HVV provenance for cobalt/accent.

---

#### Step 3: Gallery "Cascade Inspector" tab {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tugways): add Cascade Inspector gallery tab with inspectable demo components`

**References:** [D06] Gallery tab, (#scope, #new-files, #symbols)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/gallery-cascade-inspector-content.tsx` -- new
- `tugdeck/src/components/tugways/cards/gallery-card.tsx` -- modified (add 11th tab, registration, update JSDoc)
- `tugdeck/src/__tests__/gallery-card.test.tsx` -- modified (update 10-to-11 count assertions, add componentId assertion)
- `tugdeck/src/__tests__/observable-props-integration.test.tsx` -- modified (update 10-to-11 count assertion)
- `tugdeck/src/__tests__/component-gallery.test.tsx` -- modified (update 10-to-11 count assertion)

**Tasks:**
- [ ] Create `GalleryCascadeInspectorContent` React component in `gallery-cascade-inspector-content.tsx`.
- [ ] Add inspectable sample elements that exercise all token chain depths: (a) a TugDropdown instance (exercises full three-layer chain: `--tug-comp-dropdown-*` -> `--tug-base-*` -> palette), (b) a TugButton (exercises two-layer chain: `--tug-base-*` -> palette, with "(no comp token)" indicator -- tug-button.css references `--tug-base-*` directly), (c) a colored div using `--tug-base-accent-default` (exercises `--tug-base-*` -> palette chain), (d) a div using `--tug-base-surface-raised` (exercises non-chromatic base token, terminal hex value), and (e) a div with explicit inline `background: var(--tug-orange-light)` (exercises direct palette reference with HVV provenance).
- [ ] Add instructional text explaining: "Hold Ctrl+Option and hover the elements below to see the cascade inspector in action."
- [ ] Add `GALLERY_DEFAULT_TABS` 11th entry: `{ id: "template", componentId: "gallery-cascade-inspector", title: "Cascade Inspector", closable: true }`.
- [ ] Add `registerCard` call for `gallery-cascade-inspector` with factory, contentFactory, defaultMeta (`title: "Cascade Inspector"`, `icon: "Search"`, `closable: true`), family `"developer"`, acceptsFamilies `["developer"]`.
- [ ] Import `GalleryCascadeInspectorContent` in `gallery-card.tsx`.
- [ ] Update `registerGalleryCards` JSDoc comment from "nine" (currently inaccurate -- there are ten) to "eleven" gallery card types.
- [ ] Update `gallery-card.test.tsx`: change 4 assertions from `.toBe(10)` to `.toBe(11)` (lines 123, 159, 222, 258); add `expect(componentIds).toContain("gallery-cascade-inspector")` in the two componentId assertion blocks (lines ~164 and ~225); add `"gallery-cascade-inspector"` to the three `ids`/`others` arrays used in registration and family tests (lines ~82, ~103, ~135); add `expect(getRegistration("gallery-cascade-inspector")).toBeDefined()` to the registration check (line ~74).
- [ ] Update `observable-props-integration.test.tsx`: change `.toHaveLength(10)` to `.toHaveLength(11)` (line 504); update test description from "ten" to "eleven".
- [ ] Update `component-gallery.test.tsx`: change `.toBe(10)` to `.toBe(11)` (line 94).

**Tests:**
- [ ] Verify `GalleryCascadeInspectorContent` renders without errors (component render test).
- [ ] Verify `GALLERY_DEFAULT_TABS` has 11 entries.
- [ ] Verify `registerGalleryCards` registers `gallery-cascade-inspector` componentId.
- [ ] Verify all updated test assertions pass in `gallery-card.test.tsx`, `observable-props-integration.test.tsx`, and `component-gallery.test.tsx`.

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`
- [ ] Manual: open Component Gallery, verify 11th tab "Cascade Inspector" appears and renders sample components.

---

#### Step 4: Wire inspector init into main.tsx {#step-4}

**Depends on:** #step-2

**Commit:** `feat(tugways): wire StyleInspectorOverlay init into main.tsx boot sequence`

**References:** [D02] Dev-only gating, Spec S01, (#d02-dev-only-gating, #s01-inspector-singleton)

**Artifacts:**
- `tugdeck/src/main.tsx` -- modified (add `initStyleInspector()` call)

**Tasks:**
- [ ] Import `initStyleInspector` from `style-inspector-overlay.ts` in `main.tsx`.
- [ ] Call `initStyleInspector()` inside a `process.env.NODE_ENV !== 'production'` guard, placed after `initMotionObserver()` and `registerGalleryCards()` but before `new DeckManager(...)`. This ensures tokens and themes are applied, motion observer is running, and card types are registered, but the inspector is ready before the first React render.
- [ ] Store the cleanup function returned by `initStyleInspector()`. The cleanup is intentionally not called during normal app lifetime (same pattern as `initMotionObserver`), but is available for test teardown.

**Tests:**
- [ ] Verify main.tsx compiles without errors.
- [ ] Verify inspector is not initialized when NODE_ENV is 'production' (conditional import check).

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`
- [ ] Manual: open app in dev mode, verify Ctrl+Option+hover activates the cascade inspector.

---

#### Step 5: Integration Checkpoint {#step-5}

**Depends on:** #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D01] Pure TS singleton, [D02] Dev-only gating, [D03] elementFromPoint, [D04] Var chain walking, [D05] Pin/unpin, [D06] Gallery tab, Spec S01, Spec S02, Spec S03, Spec S04, Spec S05, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all three files created: `style-inspector-overlay.ts`, `style-inspector-overlay.css`, `gallery-cascade-inspector-content.tsx`.
- [ ] Verify `gallery-card.tsx` updated with 11th tab and registration.
- [ ] Verify `main.tsx` updated with `initStyleInspector()` call.
- [ ] Verify three-layer chain resolution: hover a TugTabBar element, see `--tug-comp-tab-bar-bg -> --tug-base-tab-bar-bg -> #23262d`.
- [ ] Verify two-layer chain resolution: hover a TugButton, see `--tug-base-accent-cool-default -> --tug-cobalt-accent` with "(no comp token)" indicator and HVV provenance for cobalt/accent (TugButton CSS references `--tug-base-*` directly, not `--tug-comp-button-*`).
- [ ] Verify HVV provenance displays hue, preset, canonical L, peak C, hue angle for palette-derived colors.
- [ ] Verify scale/timing readout shows current `--tug-zoom`, `--tug-timing`, and motion status.
- [ ] Verify pin/unpin: click pins, Escape closes.
- [ ] Verify all existing tests still pass.

**Tests:**
- [ ] Full test suite: `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test`

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test` -- all tests pass
- [ ] Manual: complete walkthrough of inspector functionality in gallery card and on standard app components

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A dev-mode cascade inspector overlay activated by Ctrl+Option+hover that shows full token resolution chains (--tug-comp-* through --tug-base-* to palette variables), HVV palette provenance, and scale/timing readout for any hovered element, with an 11th gallery tab demonstrating the inspector.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] Inspector activates on Ctrl+Option, deactivates on release (verified manually).
- [ ] Token chain displays all three layers for comp-token consumers (verified on TugTabBar or Tugcard hover) and two layers with "(no comp token)" for direct base-token consumers like TugButton.
- [ ] HVV provenance shows hue family, preset, and coordinates (verified on palette-colored element).
- [ ] Scale/timing readout shows current values (verified by changing --tug-zoom and re-inspecting).
- [ ] Pin/unpin and Escape work correctly (verified manually).
- [ ] Inspector absent from production build (verified by searching bundle for `tug-inspector-panel`).
- [ ] Gallery "Cascade Inspector" tab renders with inspectable samples (verified manually).
- [ ] All existing tests pass (`bun test`).

**Acceptance tests:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun test` -- all tests pass
- [ ] Production build succeeds and does not contain inspector code

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Pseudo-element inspection support (::before, ::after)
- [ ] Keyboard-only navigation mode for the inspector (Tab through elements)
- [ ] Inspector history / comparison mode (pin two elements and diff their token chains)
- [ ] Integration with PropertyStore for live mutation tracking in the inspector view
- [ ] Theme-aware indicator: detect when a displayed token value comes from a theme override (e.g., Brio vs Bluenote) rather than the base token definition, and show a "(theme: brio)" annotation in the chain display

| Checkpoint | Verification |
|------------|--------------|
| Inspector activates in dev mode | Ctrl+Option+hover shows overlay |
| Token chain resolution | Three-layer chain on TugTabBar/Tugcard; two-layer on TugButton with "(no comp token)" |
| HVV provenance | Hue, preset, coordinates displayed for palette colors |
| Scale/timing readout | Current multiplier values shown |
| Pin/unpin | Click pins, Escape closes |
| Gallery tab | 11th tab "Cascade Inspector" with demo components |
| Production safety | Inspector code absent from production bundle |
| Test suite | `bun test` all pass |
