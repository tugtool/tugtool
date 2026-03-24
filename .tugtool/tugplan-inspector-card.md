## Style Inspector Card Conversion {#inspector-card}

**Purpose:** Convert the style inspector from a floating overlay into a proper card in the card system, with a reticle-based scan mode for element selection, Option-key hover suppression, and a Developer menu item (Opt+Cmd+I) in the Swift app.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | tugtool |
| Status | draft |
| Target branch | inspector-card |
| Last updated | 2026-03-24 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The style inspector is currently a floating overlay (`StyleInspectorOverlay` in `style-inspector-overlay.ts`) activated by holding Shift+Option. This interaction model has several problems: the activation shortcut is undiscoverable and conflicts with other shortcuts; click-to-pin and Escape-to-dismiss are one-off interaction patterns unlike anything else in the app; the inspector is not a card so it cannot be docked, resized, or managed like other panels; and hovering to inspect triggers the content's own hover states, making it impossible to inspect rest-state styling.

Phase 1.5 of the formula provenance roadmap converts the inspector into a proper card with a reticle-based scanning mode that plays nicely with the rest of the UI. The formula provenance display from Phase 1 is already implemented and carries forward unchanged.

#### Strategy {#strategy}

- Register a new `style-inspector` card in the `developer` family, following the same registration pattern as the Component Gallery.
- Rewrite the inspector panel content as a React component (`StyleInspectorContent`) that renders token chains, formula rows, and scale/timing readout as JSX.
- Implement scan mode as an imperative full-viewport overlay element on `document.body`, consistent with the existing highlight rect pattern and L06 (appearance changes go through CSS and DOM, never React state).
- Add Option-key hover suppression during scan mode using `pointer-events: none` on the main content container and `document.elementFromPoint` for hit detection, without React state involvement (L06).
- Wire a `show-style-inspector` action through the existing `sendControl` / action-dispatch / responder-chain pipeline, matching the `show-component-gallery` pattern.
- Add "Show Style Inspector" (Opt+Cmd+I) to the Developer menu in `AppDelegate.swift`.
- Remove the old floating overlay code after the card is working.

#### Success Criteria (Measurable) {#success-criteria}

- Developer menu "Show Style Inspector" (Opt+Cmd+I) opens the inspector card (manual verification in the running app)
- Reticle button in the card toggles scan mode; hovering highlights elements; clicking selects and populates token chains and formula provenance (manual verification)
- Option-key held during scan mode suppresses content hover states; `elementFromPoint` still identifies correct targets (manual verification)
- Closing the card via the card system close button works; no Escape handler needed (manual verification)
- Token chain resolution, formula provenance display, and scale/timing readout match existing overlay output for the same element (manual comparison)
- `bun run check` passes with no new TypeScript errors
- All existing tests pass: `bun run test`
- `bun run audit:tokens` passes with no new violations

#### Scope {#scope}

1. New `StyleInspectorContent` React component rendering inspector panel content
2. Card registration (`style-inspector`, family `developer`)
3. Scan mode overlay with reticle button toggle
4. Option-key hover suppression during scan mode
5. `show-style-inspector` action in action-dispatch, responder chain handler in DeckCanvas
6. Swift Developer menu item with Opt+Cmd+I shortcut
7. Removal of old floating overlay code (panelEl, overlayEl, positionPanel, pin/unpin, Shift+Option activation, Escape handler)

#### Non-goals (Explicitly out of scope) {#non-goals}

- Inline formula editing (Phase 2 of the roadmap)
- Changes to the token chain resolution algorithm, `buildReverseMap`, `fetchFormulasData`, or `createFormulaSection` logic (carried forward verbatim per roadmap)
- Changes to the formula reverse map or formulas cache infrastructure
- Any new token definitions or theme changes

#### Dependencies / Prerequisites {#dependencies}

- Phase 1 formula provenance is implemented and working (already complete)
- Card system (Tugcard, CardFrame, DeckManager, card-registry) is stable
- Responder chain and action-dispatch infrastructure is in place
- `sendControl` bridge from Swift to web content is working

#### Constraints {#constraints}

- Must comply with all Laws of Tug, especially L01 (one root.render), L02 (useSyncExternalStore for external state), L06 (appearance changes through CSS/DOM, never React state), L09 (Tugcard composes chrome, CardFrame owns geometry), L11 (controls emit actions, responders handle actions)
- The highlight rect must remain a direct DOM element on `document.body`, not React-managed (L06)
- The scan overlay must be imperatively managed on `document.body` (L06)
- The reverse map is built once as a module singleton at startup, reused across card open/close cycles
- React 19.2.4 semantics apply

#### Assumptions {#assumptions}

- The card will use `family: "developer"` and `acceptsFamilies: ["developer"]`, consistent with all other developer-tool cards
- The Swift menu item will use the same `sendControl` pattern as `showComponentGallery`, dispatching a `show-style-inspector` action
- The existing token chain resolution algorithm, `PALETTE_VAR_REGEX`, `buildReverseMap`, `createFormulaSection`, and `fetchFormulasData` will not be changed
- The highlight rect (`tug-inspector-highlight`) will continue to be a direct DOM element appended to `document.body`
- Option-key hover suppression will use `pointer-events: none` on the main content container + `elementFromPoint` for hit detection
- The Opt+Cmd+I keyboard shortcut in `AppDelegate.swift` will be registered as `keyEquivalent: "i"` with `modifierMask: [.command, .option]`, in the same section as "Show JavaScript Console" (Opt+Cmd+C)

---

### Design Decisions {#design-decisions}

#### [D01] Inspector content is a React component (DECIDED) {#d01-react-content}

**Decision:** The inspector panel content (token chains, formula rows, scale/timing readout) is rewritten as a React component (`StyleInspectorContent`) rendered inside a Tugcard.

**Rationale:**
- Card content is React-rendered in the card system; a DOM-only panel cannot participate in card lifecycle
- JSX is more idiomatic for card content than imperative DOM creation
- The user explicitly chose "React component" over "DOM injection into card container"

**Implications:**
- Token chain data and formula rows are passed as props or computed inside the component
- The component receives the inspected element's data and renders it declaratively
- The reverse map and formulas data are fetched outside React (module singletons), then passed in

#### [D02] Scan mode overlay is an imperative DOM element on document.body (DECIDED) {#d02-scan-overlay-dom}

**Decision:** The scan mode overlay is a transparent `<div>` appended to and removed from `document.body` imperatively, not a React-managed element.

**Rationale:**
- Consistent with the existing highlight rect pattern
- L06 compliance: appearance/interaction changes go through CSS and DOM, never React state
- The overlay needs to intercept pointer events across the entire viewport, outside the card's subtree

**Implications:**
- A module-level `ScanModeController` class manages the overlay lifecycle
- The controller is activated/deactivated by the reticle button in the card
- Communication from scan overlay to React content uses a callback pattern (scan controller calls a callback with the selected element)

#### [D03] Reverse map built once as module singleton (DECIDED) {#d03-singleton-reverse-map}

**Decision:** The reverse map is built once at module load time (or on first use) as a module-level singleton, reused across card open/close cycles.

**Rationale:**
- `buildReverseMap(RULES)` is deterministic and does not change during a session
- Building it once avoids redundant Proxy-based interception on every card open
- The user explicitly chose "module singleton at startup" over "per-card-open rebuild"

**Implications:**
- The reverse map variable is a module-level `let` initialized lazily on first access
- No cleanup needed on card close; the map persists for the session

#### [D04] Show-style-inspector follows the show-component-gallery pattern (DECIDED) {#d04-show-action-pattern}

**Decision:** The `show-style-inspector` action follows the exact same pattern as `show-component-gallery`: Swift sends a Control frame, action-dispatch registers a handler that dispatches through the responder chain, DeckCanvas handles the action with find-or-create-and-focus semantics.

**Rationale:**
- Proven pattern already working for the Component Gallery
- Consistent with the responder chain architecture (L11)
- Show-only semantics: the action never closes the card, only opens or focuses it

**Implications:**
- A `styleInspectorCardIdRef` is added to DeckCanvas alongside `galleryCardIdRef`
- The DeckCanvas responder registers a `showStyleInspector` action handler
- action-dispatch registers a `show-style-inspector` handler that dispatches `showStyleInspector` through the responder chain

#### [D05] Option-key hover suppression uses pointer-events toggle (DECIDED) {#d05-option-key-suppression}

**Decision:** While in scan mode and the Option key is held, `pointer-events: none` is set on the main content container via a CSS class toggle, and `document.elementFromPoint` is used for hit detection.

**Rationale:**
- `elementFromPoint` is a layout query, not an event — it works regardless of `pointer-events` setting
- Class toggling is L06-compliant (appearance zone, no React state)
- This prevents the content's CSS `:hover` states from firing while the scan overlay is active

**Implications:**
- The scan mode controller listens for `keydown`/`keyup` for the Alt (Option) key
- When Alt is held, a class (e.g., `tug-scan-hover-suppressed`) is toggled on the content container
- The highlight rect changes style (dashed border) to indicate hover suppression is active

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Token chain rendering parity | med | low | Visual comparison test against old overlay for same elements | Token display differs from old overlay |
| Scan overlay z-index conflicts | low | low | Use z-index 999998 (same as current highlight); `CARD_ZINDEX_BASE` is 1, so even with many cards the maximum card z-index is well below 999997 | Overlay appears behind cards |
| elementFromPoint misidentifies during hover suppression | med | low | Manual testing with Option held over various element types | Wrong element shown in inspector |
| pointer-events toggle returns overlay from elementFromPoint | low | low | Identity guard skips overlay; same pattern already proven in existing overlay | elementFromPoint returns overlay div instead of content element |

**Risk R01: Token chain rendering parity** {#r01-rendering-parity}

- **Risk:** The React-rendered token chains might display differently from the old imperative DOM rendering.
- **Mitigation:** Port the rendering logic faithfully; compare output side-by-side on several test elements before removing the old overlay.
- **Residual risk:** Subtle CSS differences in the card context vs. the floating panel context.

---

### Specification {#specification}

#### Card Registration {#card-registration}

**Spec S01: StyleInspector card registration** {#s01-card-registration}

```typescript
registerCard({
  componentId: "style-inspector",
  contentFactory: (cardId) => <StyleInspectorContent cardId={cardId} />,
  defaultMeta: { title: "Style Inspector", icon: "Scan", closable: true },
  family: "developer",
  acceptsFamilies: ["developer"],
});
```

#### Action Flow {#action-flow}

**Spec S02: show-style-inspector action flow** {#s02-action-flow}

1. Swift: `AppDelegate.showStyleInspector(_:)` calls `sendControl("show-style-inspector")`
2. Web: `initActionDispatch` registers `show-style-inspector` handler
3. Handler dispatches `{ action: "showStyleInspector", phase: "discrete" }` through `responderChainManagerRef`
4. DeckCanvas responder handles `showStyleInspector`: find existing card via `styleInspectorCardIdRef`, or create via `store.addCard("style-inspector")`, then focus

#### Scan Mode Controller {#scan-mode-controller}

**Spec S03: ScanModeController interface** {#s03-scan-controller}

```typescript
class ScanModeController {
  /** Whether scan mode is currently active. */
  readonly isActive: boolean;

  /** Start scan mode. Appends overlay to document.body, attaches listeners. */
  activate(onSelect: (el: HTMLElement) => void): void;

  /** Stop scan mode. Removes overlay and listeners. */
  deactivate(): void;
}
```

- The overlay is a transparent `<div>` covering the viewport at `z-index: 999997` (below the highlight rect at 999998).
- `pointermove` on the overlay sets `pointer-events: none` on itself, calls `document.elementFromPoint` to identify the target element, restores `pointer-events`, then positions the highlight rect. (Using `pointer-events` toggle instead of `display` toggle avoids a visual flash.) After `elementFromPoint` returns, the handler must skip the highlight rect element and the scan overlay itself (check element identity against `this.overlayEl` and `this.highlightEl`); this mirrors the existing guard pattern at line 491 of `style-inspector-overlay.ts` where `el === this.highlightEl || el === this.panelEl` is filtered out.
- **Pointer-events toggle reliability note:** The `pointer-events: none` + `elementFromPoint` pattern is the same technique the existing `StyleInspectorOverlay` already uses successfully in WebKit. The toggle is set and restored synchronously within the same microtask (before any repaint), so the overlay never visually disappears. If `elementFromPoint` still returns the overlay element (e.g., due to a WebKit edge case), the identity guard (`el === this.overlayEl`) catches it and the handler returns early — no incorrect selection occurs.
- `click` on the overlay calls the `onSelect` callback with the identified element. Scan mode uses **single-shot** semantics: click selects and deactivates. Rationale: single-shot matches the existing overlay's behavior (click-to-pin then dismiss), keeps the interaction simple, and avoids confusion about whether the reticle button state is "active" or "latched." Users re-enter scan mode via the reticle button. If persistent scan mode proves desirable, it is a straightforward follow-on (change `click` handler to not call `deactivate()`).
- `keydown`/`keyup` for Alt toggles the `tug-scan-hover-suppressed` class on the `#deck-container` element (via `document.getElementById('deck-container')`).

#### Component Data Flow {#component-data-flow}

**Spec S04: StyleInspectorContent data flow** {#s04-data-flow}

1. Module singleton: `reverseMap` built from `buildReverseMap(RULES)` on first use
2. On element selection (from scan mode callback):
   a. Compute token chains for `background-color`, `color`, `border-color` using the existing `resolveTokenChainForProperty` logic (extracted from `StyleInspectorOverlay`)
   b. Fetch formulas data via `fetchFormulasData()`
   c. Read scale/timing via `getTugZoom()`, `getTugTiming()`, `isTugMotionEnabled()`
   d. Store inspection results in an `inspectionDataRef` (`useRef`) and bump a `renderKey` state counter to trigger re-render. Rationale: `useRef` + `renderKey` counter avoids React batching and stale-closure issues with the async `fetchFormulasData` call — the ref always holds the latest data, and the counter forces a synchronous re-render after the ref is updated.
3. Component renders: DOM path, token chain sections, formula provenance, scale/timing readout

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/cards/style-inspector-card.tsx` | StyleInspectorContent component and card registration |
| `tugdeck/src/components/tugways/scan-mode-controller.ts` | ScanModeController class for reticle-based element selection |
| `tugdeck/src/components/tugways/cards/style-inspector-card.css` | Styles for the inspector card content (ported from overlay CSS) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `StyleInspectorContent` | component | `cards/style-inspector-card.tsx` | React component for inspector card content |
| `registerStyleInspectorCard` | fn | `cards/style-inspector-card.tsx` | Registers the card; called from main.tsx |
| `ScanModeController` | class | `scan-mode-controller.ts` | Manages scan overlay lifecycle |
| `resolveTokenChainForProperty` | fn | `style-inspector-overlay.ts` | Extracted as standalone export (was method on class) |
| `resolveTokenChain` | fn | `style-inspector-overlay.ts` | Extracted as standalone export (was method on class) |
| `extractTugColorProvenance` | fn | `style-inspector-overlay.ts` | Extracted as standalone export (was method on class) |
| `buildDomPath` | fn | `style-inspector-overlay.ts` | Extracted as standalone export (was method on class) |
| `tryFormatTugColor` | fn | `style-inspector-overlay.ts` | Extracted from class; filters oklch strings and formats via oklchToTugColor |
| `buildFormulaRows` | fn | `style-inspector-overlay.ts` | Extracted from `buildFormulaSectionForInspection`; returns `FormulaRow[]` data instead of DOM |
| `showStyleInspector` | action handler | `deck-canvas.tsx` | DeckCanvas responder action for find-or-create inspector card |
| `show-style-inspector` | action | `action-dispatch.ts` | Dispatches showStyleInspector through responder chain |
| `showStyleInspector(_:)` | @objc method | `AppDelegate.swift` | Sends show-style-inspector control frame |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test ScanModeController activate/deactivate, Option-key class toggle, extracted token chain functions | Core scan mode logic, function extraction |
| **Integration** | Test show-style-inspector action dispatch through responder chain to DeckCanvas | Action flow end-to-end |
| **Manual** | Verify visual parity of token chains and formula display, reticle scan interaction, Option-key suppression | UI behavior that requires visual inspection |

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
> **References are mandatory:** Every step must cite specific plan artifacts ([D01], Spec S01, Table T01, etc.) and anchors (#section-name). Never cite line numbers -- add an anchor instead.

#### Step 1: Extract reusable functions from StyleInspectorOverlay {#step-1}

**Commit:** `refactor: extract token chain resolution functions from StyleInspectorOverlay`

**References:** [D01] React content, [D03] Singleton reverse map, Spec S04, (#symbol-inventory, #context)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/style-inspector-overlay.ts` with extracted standalone exports

**Tasks:**
- [ ] Extract `resolveTokenChainForProperty` from the `StyleInspectorOverlay` class into a standalone exported function that takes `(el: HTMLElement, property: string, computedValue: string)` and returns `TokenChainResult`
- [ ] Extract `resolveTokenChain` into a standalone exported function
- [ ] Extract `extractTugColorProvenance` into a standalone exported function
- [ ] Extract `buildDomPath` into a standalone exported function
- [ ] Extract helper methods (`detectCompFamily`, `valuesMatch`, `findTokenFromCSSRules`, `findPropertyValueInRules`, `SHORTHAND_MAP`, `walkRulesForToken`) as module-level functions/constants used by the extracted functions. Note: `SHORTHAND_MAP` changes from a `private static readonly` class property to a module-level `const`. `walkRulesForToken` changes from a private instance method to a standalone function; its recursive call site (`this.walkRulesForToken(...)`) becomes a direct function call (`walkRulesForToken(...)`).
- [ ] Extract the row-building and deduplication logic from `buildFormulaSectionForInspection` into a standalone exported function `buildFormulaRows(bgChain: TokenChainResult, fgChain: TokenChainResult, borderChain: TokenChainResult, formulasData: FormulasData, reverseMap: ReverseMap): FormulaRow[]` that returns structured data instead of DOM elements. The new function takes `reverseMap` as a parameter instead of reading `this.reverseMap`. Note: the class method `buildFormulaSectionForInspection` delegates to `buildFormulaRows` by passing `this.reverseMap` after its existing null guard (`if (!this.reverseMap) return null`), so the class continues to work during the transition. `createFormulaSection` remains unchanged — it is called by the old overlay in the transition period and by tests.
- [ ] Create a module-level lazy singleton for the reverse map: `let cachedReverseMap: ReverseMap | null = null; export function getReverseMap(): ReverseMap { ... }`
- [ ] Keep the `StyleInspectorOverlay` class working by having it delegate to the extracted functions (so the old overlay still works during migration)
- [ ] Extract `tryFormatTugColor` from the class into a standalone exported function. This function filters oklch color strings (skipping `calc()`/`var()` values) and formats them via `oklchToTugColor`. The JSX `TugColorLabel` helper in Step 3 will call this function for its filtering/formatting logic rather than reimplementing it.
- [ ] Export `shortenNumbers` (already a module-level function, just needs the `export` keyword)
- [ ] Export `fetchFormulasData` (already a module-level function, just ensure it is exported)
- [ ] Verify that after extraction, all extracted helpers are pure functions of their arguments with no remaining `this` references. `SHORTHAND_MAP` is a module-level `const`, `walkRulesForToken` is a standalone function with direct recursion (not `this.walkRulesForToken`), and all other extracted functions take their dependencies as parameters.

**Tests:**
- [ ] Existing `style-inspector-overlay.test.ts` tests continue to pass (class delegates to extracted functions)
- [ ] Existing `style-inspector-formula.test.ts` tests continue to pass

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run check`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run test`

---

#### Step 2: Create ScanModeController {#step-2}

**Depends on:** #step-1

**Commit:** `feat: add ScanModeController for reticle-based element selection`

**References:** [D02] Scan overlay DOM, [D05] Option-key suppression, Spec S03, (#scan-mode-controller, #constraints)

**Artifacts:**
- New file `tugdeck/src/components/tugways/scan-mode-controller.ts`
- New test file `tugdeck/src/__tests__/scan-mode-controller.test.ts`

**Tasks:**
- [ ] Create `ScanModeController` class with `activate(onSelect)` and `deactivate()` methods
- [ ] In `activate`: create a transparent overlay div, append to `document.body`, set `z-index: 999997`, attach `pointermove`, `click`, `keydown`, `keyup` listeners
- [ ] On `pointermove`: set `pointer-events: none` on the overlay (instead of toggling `display` to avoid visual flash), call `document.elementFromPoint(e.clientX, e.clientY)`, restore `pointer-events`. After `elementFromPoint` returns, skip the element if it is the overlay itself or the highlight rect (identity check: `el === this.overlayEl || el === this.highlightEl`). Then position highlight rect on the identified element.
- [ ] On `click`: call `onSelect` callback with identified element, call `deactivate()`
- [ ] On `keydown`/`keyup` for Alt key: toggle `tug-scan-hover-suppressed` class on `document.getElementById('deck-container')` (the `#deck-container` div that wraps all deck content). Change highlight rect to dashed border style when suppression is active.
- [ ] In `deactivate`: remove overlay from DOM, remove all listeners, remove suppression class if present
- [ ] Export the highlight rect element so the card can reuse the existing `.tug-inspector-highlight` styles

**Tests:**
- [ ] Unit test: `activate()` appends overlay to body, `deactivate()` removes it
- [ ] Unit test: `isActive` reflects current state
- [ ] Unit test: calling `deactivate()` when not active is a no-op
- [ ] Unit test: Alt keydown toggles suppression class on content container

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run check`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run test`

---

#### Step 3: Create StyleInspectorContent component and card registration {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `feat: add StyleInspectorContent card component with scan mode`

**References:** [D01] React content, [D02] Scan overlay DOM, [D03] Singleton reverse map, Spec S01, Spec S04, (#card-registration, #component-data-flow, #new-files)

**Artifacts:**
- New file `tugdeck/src/components/tugways/cards/style-inspector-card.tsx`
- New file `tugdeck/src/components/tugways/cards/style-inspector-card.css`

**Tasks:**
- [ ] Create `StyleInspectorContent` React component that accepts `cardId: string` prop
- [ ] Component renders: reticle button (footer/toolbar area), inspected element info (DOM path, token chains, formula rows, scale/timing readout), and an empty state when no element is selected
- [ ] Reticle button click activates `ScanModeController` with a callback that stores the selected element in a ref and bumps a render counter
- [ ] On element selection: call the extracted `resolveTokenChainForProperty` for bg, fg, border; call `fetchFormulasData`; read scale/timing; store all in a ref
- [ ] Render token chain sections as JSX, porting the DOM structure from `renderChainSection(title, computedValue, chain, cssProperty)` in `StyleInspectorOverlay` — this private method is the source of truth for how each property's chain is displayed (title row, computed value, hop list with swatch/label pairs). The port must reimplement `makeSwatchEl` (a color swatch `<span>` with inline background-color) and `makeTugColorEl` (a TugColor label rendered via `oklchToTugColor`) as small JSX helper components (e.g., `SwatchChip` and `TugColorLabel`) within the card module. The `TugColorLabel` component must call the extracted `tryFormatTugColor` function (from Step 1) for its oklch filtering/formatting logic, rather than reimplementing it.
- [ ] Render formula provenance section as JSX, consuming the `FormulaRow[]` returned by the extracted `buildFormulaRows` function (see Step 1) and porting the DOM structure from `createFormulaSection`
- [ ] Render scale/timing readout as JSX
- [ ] Port relevant styles from `style-inspector-overlay.css` to `style-inspector-card.css`, adapting for card context (no fixed positioning, scroll within card)
- [ ] Create `registerStyleInspectorCard()` function that calls `registerCard()` per Spec S01
- [ ] Card uses `family: "developer"`, `acceptsFamilies: ["developer"]`, `icon: "Scan"`, `closable: true`

**Tests:**
- [ ] Unit test: `registerStyleInspectorCard` registers with componentId `style-inspector`
- [ ] Unit test: component renders empty state when no element is selected
- [ ] Unit test: reticle button is present in rendered output

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run check`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run test`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run audit:tokens`

---

#### Step 4: Wire show-style-inspector action through action-dispatch and DeckCanvas {#step-4}

**Depends on:** #step-3

**Commit:** `feat: add show-style-inspector action dispatch and DeckCanvas handler`

**References:** [D04] Show action pattern, Spec S02, (#action-flow, #strategy)

**Artifacts:**
- Modified `tugdeck/src/action-dispatch.ts` with `show-style-inspector` handler
- Modified `tugdeck/src/components/chrome/deck-canvas.tsx` with `showStyleInspector` responder action
- Modified `tugdeck/src/main.tsx` to call `registerStyleInspectorCard()` and remove `initStyleInspector()`

**Tasks:**
- [ ] In `action-dispatch.ts`: register `show-style-inspector` handler that dispatches `{ action: "showStyleInspector", phase: "discrete" }` through `responderChainManagerRef` (same pattern as `show-component-gallery`)
- [ ] In `deck-canvas.tsx`: add `styleInspectorCardIdRef` ref (same pattern as `galleryCardIdRef`)
- [ ] In `deck-canvas.tsx`: register `showStyleInspector` action handler in the responder with find-or-create-and-focus semantics (same as `showComponentGallery`)
- [ ] In `deck-canvas.tsx`: in the existing `handleClose` wrapper (where `galleryCardIdRef` is already checked), add an additional condition: `if (styleInspectorCardIdRef.current === cardState.id) { styleInspectorCardIdRef.current = null; }` alongside the existing `galleryCardIdRef` check. This ensures the next `showStyleInspector` dispatch creates a fresh card rather than referencing a closed one (defense-in-depth).
- [ ] In `main.tsx`: import and call `registerStyleInspectorCard()` during initialization, unconditionally (no `NODE_ENV` gate). Rationale: card registration is unconditional per the developer family convention — `registerHelloCard()` and `registerGalleryCards()` are also unconditional. The old `initStyleInspector()` was dev-gated because it attached global event listeners at startup; by contrast, `registerStyleInspectorCard()` is inert (it only adds an entry to the card registry map). The card code is only exercised when the user opens it via the Developer menu, which is hidden in production builds. The minor bundle-size cost of including the registration code is accepted as a deliberate tradeoff for consistency with the existing pattern.
- [ ] In `main.tsx`: remove the `initStyleInspector()` call and its `NODE_ENV` guard (the old overlay is no longer needed once the card is wired)

**Tests:**
- [ ] Integration test: dispatch `show-style-inspector` action, verify `store.addCard("style-inspector")` is called
- [ ] Integration test: dispatch `show-style-inspector` twice, verify second dispatch focuses existing card (show-only semantics)
- [ ] Test: DeckCanvas `canHandle("showStyleInspector")` returns true

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run check`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run test`

---

#### Step 5: Add Swift Developer menu item {#step-5}

**Depends on:** #step-4

**Commit:** `feat: add Show Style Inspector menu item to Developer menu (Opt+Cmd+I)`

**References:** [D04] Show action pattern, Spec S02, (#assumptions, #scope)

**Artifacts:**
- Modified `tugapp/Sources/AppDelegate.swift` with new menu item and action method

**Tasks:**
- [ ] Add menu item in `AppDelegate.swift` Developer menu section, after the existing "Show Test Card" item (alongside "Show Component Gallery" and "Show Test Card"): `devMenu.addItem(NSMenuItem(title: "Show Style Inspector", action: #selector(showStyleInspector(_:)), keyEquivalent: "i", modifierMask: [.command, .option]))`
- [ ] Add `@objc private func showStyleInspector(_ sender: Any?)` method that calls `sendControl("show-style-inspector")`

**Tests:**
- [ ] Manual: verify menu item appears in Developer menu with Opt+Cmd+I shortcut
- [ ] Manual: verify pressing Opt+Cmd+I opens the inspector card

**Checkpoint:**
- [ ] Build the Swift app: `cd /Users/kocienda/Mounts/u/src/tugtool/tugapp && swift build`

---

#### Step 6: Remove old floating overlay code {#step-6}

**Depends on:** #step-4

**Commit:** `refactor: remove old StyleInspectorOverlay floating panel code`

**References:** [D01] React content, [D02] Scan overlay DOM, (#scope, #context)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/style-inspector-overlay.ts` — `StyleInspectorOverlay` class removed, `initStyleInspector` removed; only the extracted standalone functions and types remain
- Modified `tugdeck/src/__tests__/style-inspector-overlay.test.ts` — tests updated to test extracted functions instead of the class

**Tasks:**
- [ ] Remove the `StyleInspectorOverlay` class entirely from `style-inspector-overlay.ts`
- [ ] Remove `initStyleInspector` export
- [ ] Remove the `renderPanel`, `positionPanel`, `positionHighlight`, `renderPinBadge` methods and all related private state (these are now replaced by the React component and ScanModeController)
- [ ] Keep all exported types (`TokenChainResult`, `TokenChainHop`, `TugColorProvenance`, `FormulasData`, `FormulaRow`, `PALETTE_VAR_REGEX`)
- [ ] Keep all extracted standalone functions (`resolveTokenChainForProperty`, `resolveTokenChain`, `extractTugColorProvenance`, `buildDomPath`, `buildFormulaRows`, `fetchFormulasData`, `getReverseMap`, `shortenNumbers`, `tryFormatTugColor`, `createFormulaSection`). Note: `createFormulaSection` is now dead production code (only used by tests). Deliberate deferral: migrating formula tests from `createFormulaSection` to `buildFormulaRows` is deferred to a follow-on cleanup task (see #roadmap). `createFormulaSection` is retained until that migration is done, at which point it can be deleted.
- [ ] Update test file to remove class-based tests and add tests for the standalone functions if not already covered
- [ ] Remove overlay-specific CSS from `style-inspector-overlay.css` (panel positioning, pin badge) — keep highlight rect styles that are still used by ScanModeController
- [ ] Update the doc comment and activation instructions in `gallery-cascade-inspector-content.tsx`: replace any Shift+Option overlay references with "Use Opt+Cmd+I to open the Style Inspector card, then click the reticle button to enter scan mode and hover over elements to inspect them"

**Tests:**
- [ ] All updated tests pass
- [ ] No remaining imports of `StyleInspectorOverlay` class or `initStyleInspector`

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run check`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run test`
- [ ] Verify no dead code: grep for `StyleInspectorOverlay` and `initStyleInspector` returns zero hits in `src/`

---

#### Step 7: Integration Checkpoint {#step-7}

**Depends on:** #step-5, #step-6

**Commit:** `N/A (verification only)`

**References:** [D01] React content, [D02] Scan overlay DOM, [D04] Show action pattern, [D05] Option-key suppression, Spec S01, Spec S02, Spec S03, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify all artifacts from Steps 1-6 are complete and work together
- [ ] Manual end-to-end test: Opt+Cmd+I opens inspector card, reticle button enters scan mode, hovering highlights elements, clicking selects element and populates token chains + formula provenance + scale/timing
- [ ] Manual test: Option key during scan mode suppresses hover states, highlight rect shows dashed border
- [ ] Manual test: closing inspector card via close button works; reopening via menu focuses existing card if still open
- [ ] Compare token chain output with a known element against the old overlay output (Risk R01 verification)

**Tests:**
- [ ] All unit and integration tests from Steps 1-6 pass in a single run: `bun run test`
- [ ] TypeScript type-check passes with no errors: `bun run check`
- [ ] Token audit passes with no violations: `bun run audit:tokens`

**Checkpoint:**
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run check`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run test`
- [ ] `cd /Users/kocienda/Mounts/u/src/tugtool/tugdeck && bun run audit:tokens`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** The style inspector is a proper card in the card system, opened via Developer menu (Opt+Cmd+I), with reticle-based scan mode, Option-key hover suppression, and full token chain + formula provenance display.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `style-inspector` card registered in the developer family (`getRegistration("style-inspector")` returns a valid registration)
- [ ] `show-style-inspector` action dispatches through responder chain and opens/focuses the card
- [ ] Scan mode activates from reticle button, highlights elements on hover, selects on click
- [ ] Option-key suppresses content hover states during scan mode
- [ ] Token chains, formula provenance, and scale/timing display match old overlay output
- [ ] Old `StyleInspectorOverlay` class and `initStyleInspector` are removed
- [ ] `bun run check` passes
- [ ] `bun run test` passes
- [ ] `bun run audit:tokens` passes

**Acceptance tests:**
- [ ] T01: `registerStyleInspectorCard()` registers card with componentId `style-inspector`, family `developer`
- [ ] T02: `show-style-inspector` action dispatch creates inspector card via `store.addCard`
- [ ] T03: Second `show-style-inspector` dispatch focuses existing card (show-only semantics)
- [ ] T04: ScanModeController `activate`/`deactivate` correctly manages overlay DOM
- [ ] T05: Alt key toggle adds/removes `tug-scan-hover-suppressed` class

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 2: Inline formula editing (click formula value to edit, POST to server, hot-reload updates)
- [ ] Persist inspector card state across reloads (last inspected element, scan mode preference)
- [ ] Migrate formula tests from `createFormulaSection` to `buildFormulaRows` and remove `createFormulaSection` dead code
- [ ] Persistent scan mode option: scan mode stays active after selection, deactivates only via reticle toggle or Escape
- [ ] Add inspector card to Component Gallery default tabs

| Checkpoint | Verification |
|------------|--------------|
| Card registration | `getRegistration("style-inspector")` returns valid registration |
| Action flow | `show-style-inspector` dispatch opens card |
| Scan mode | Reticle button activates scan overlay |
| Hover suppression | Option key toggles pointer-events class |
| Type check | `bun run check` passes |
| Tests | `bun run test` passes |
| Token audit | `bun run audit:tokens` passes |
