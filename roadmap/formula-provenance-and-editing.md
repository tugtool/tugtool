# Formula Provenance and Inline Editing

Show which DerivationFormulas fields control each CSS token in the style inspector,
then let the user edit them in place.

## Phase 1 — Read-Only Provenance

**Goal:** When the inspector panel is pinned on an element, show a “Formula” section
listing the formula fields that affect that element’s colors and their current values.

```
FORMULA
  contentTextIntensity  intensity  = 4
  contentTextTone       tone       = 8
```

### New files

- `src/components/tugways/formula-reverse-map.ts` — Proxy-based reverse map.
  Calls each rule’s expression functions with a Proxy that intercepts property
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

## Phase 1.5 — Style Inspector as a Card ✓ COMPLETE

**Goal:** Replace the floating overlay inspector with a proper card in the card
system, and replace the awkward Opt+Shift hover / click-to-pin / Escape-to-dismiss
interaction with a reticle-based scanning mode that plays nicely with the rest of
the UI.

### Why

The current interaction model has problems:
- Opt+Shift to activate is undiscoverable and conflicts with other shortcuts.
- Click-to-pin, Escape-to-dismiss is a one-off interaction pattern unlike anything
  else in the app.
- The inspector isn’t a card, so it can’t be docked, resized, or managed like
  other panels.
- Hovering to inspect triggers the content’s own hover states, making it impossible
  to inspect rest-state styling.

### Interaction model

1. **Open:** Developer menu → “Show Style Inspector” (or keyboard shortcut). Opens
   a regular card in the card system with the inspector content.

2. **Scan mode:** The card has a reticle icon button (like Safari/Chrome’s element
   picker). Clicking it enters scan mode — the cursor changes and mousing over
   elements highlights them with the existing overlay rect. Clicking an element
   selects it: the card updates to show that element’s token chains and formula
   provenance, and scan mode turns off.

3. **Option key suppresses hover:** While in scan mode, holding Option prevents
   the content’s CSS hover states from firing. This lets you inspect rest-state
   styling without the element reacting to the pointer. Implementation: while
   Option is held, set `pointer-events: none` on the content area (or use a
   transparent overlay that intercepts events), and use `document.elementFromPoint`
   to determine which element is under the cursor.

4. **Close:** Close the card like any other card. No Escape key handling needed.

5. **Re-scan:** Click the reticle button again to enter scan mode and pick a
   different element. The card stays open between scans.

### Swift app changes

- Add “Show Style Inspector” menu item under the Developer menu, in the same
  section as “Show JavaScript Console”.
- The menu item sends a message to the web content (via the existing bridge)
  to open/focus the style inspector card.

### Tugdeck changes

- **New card component:** `StyleInspectorCard` — a regular card that renders the
  inspector content. Replaces the floating overlay panel.
- **Reticle button:** Icon button in the card’s toolbar/footer. Toggles scan mode.
- **Scan mode overlay:** Transparent full-viewport overlay that intercepts pointer
  events during scanning. Uses `document.elementFromPoint` to identify targets.
  Draws the highlight rect. Clicks through to select, then removes itself.
- **Option-key hover suppression:** During scan mode, listen for `keydown`/`keyup`
  for the Option key. When held, add a class that sets `pointer-events: none` on
  the main content container, forcing all pointer events to the scan overlay.
  `elementFromPoint` still works because it’s a layout query, not an event.
- **Migrate content:** Move the token chain rendering, formula provenance section,
  and all associated CSS from `style-inspector-overlay.ts` into the new card.
  The reverse map, formulas cache fetch, and chain resolution logic stay the same.
- **Remove overlay:** Delete the floating panel code (`panelEl`, `overlayEl`,
  `positionPanel`, pin/unpin logic, Opt+Shift activation, Escape handler).

### What stays the same

- Token chain resolution algorithm
- Formula provenance display (from Phase 1)
- The section layout and information hierarchy (Phase 1.5B updates the
  color scheme to use theme tokens instead of hardcoded oklch)
- `buildReverseMap`, `fetchFormulasData`, `createFormulaSection`
- All the reverse map and formulas cache infrastructure

### Decisions

- **Default size:** Match the current style inspector panel dimensions.
- **Reticle button:** Footer row, with hint text (like the current panel’s
  “Escape to close” line).
- **Highlight rect on Option hold:** Change style (e.g., dashed border or
  different color) to indicate hover suppression is active.
- **Open trigger:** Developer menu only + Opt+Cmd+I keyboard shortcut. No
  auto-open.

## Phase 1.5B — Card Polish and Persistent Highlight ✓ COMPLETE

**Goal:** Make the style inspector card theme-aware, rename the interaction
verbs, and keep the highlight rect visible on the inspected element after
selection — setting the stage for Phase 2 inline editing.

### Theme-aware card styling

The card currently uses hardcoded oklch values for all backgrounds, text,
borders, and accents. Replace these with `--tug-*` tokens so the card
adapts to the active theme. This means the inspector card looks correct in
both light and dark themes and responds to live theme changes.

- Audit `style-inspector-card.css` — replace every hardcoded oklch value
  with the appropriate `--tug-*` token (surface, content-text, accent, etc.).
- Update the `@tug-pairings` block to reflect token-based pairings instead
  of hardcoded values.
- Run `bun run audit:tokens` to verify all pairings pass.

### Rename interaction verbs

Replace “Scan” terminology with “Inspect” throughout:

- Button label: “Inspect Element” (rest), “Cancel Inspection” (scanning),
  “Done Inspecting” (element selected).
- `aria-label`, `title`, CSS class names (`si-card-inspect-button` instead
  of `si-card-reticle-button`), and test assertions.
- The ScanModeController class name and file name stay as-is — the class
  manages the scan overlay mechanics, and renaming it would churn every
  import for no functional gain.

### Three-state inspection button

The button currently has two states (rest / scanning). Add a third
“inspecting” state so the user always knows which element is selected.

| State | Button Label | Highlight Rect | Scan Overlay |
|-------|-------------|----------------|--------------|
| **Rest** | “Inspect Element” | None | None |
| **Scanning** | “Cancel Inspection” | Follows cursor | Active |
| **Inspecting** | “Done Inspecting” | Pinned on selected element | Removed |

State transitions:

- **Rest → Scanning:** Click “Inspect Element”. Overlay appears, highlight
  follows pointer.
- **Scanning → Inspecting:** Click an element. Overlay removed, highlight
  stays pinned at the element’s bounding rect, card populates with chain/
  formula data.
- **Scanning → Rest:** Click “Cancel Inspection”. Overlay and highlight
  removed, no data change.
- **Inspecting → Rest:** Click “Done Inspecting”. Highlight removed,
  inspection data cleared, card returns to empty state.
- **Inspecting → Scanning:** Click “Inspect Element” again (button cycles
  back). Current highlight removed, overlay reappears for a new selection.
  Actually — this transition should go Inspecting → Rest first (clear), then
  the user clicks again to scan. Simpler and avoids stale data flash. Or:
  go directly Inspecting → Scanning if we clear the data immediately. Either
  works; decide during implementation.

### Persistent highlight rect

When transitioning from Scanning → Inspecting:

- `ScanModeController.deactivate()` currently removes the highlight rect
  from the DOM. Change this: on element selection, the controller hands
  ownership of the highlight rect to the card (or leaves it in the DOM
  with a “pinned” class). The rect stays positioned over the selected
  element’s bounding box.
- The highlight rect in “inspecting” state should have a distinct visual
  treatment — e.g., solid border with a subtle background tint — so it’s
  clearly pinned rather than hover-tracking.
- Add a `--pinned` CSS modifier class (`.tug-inspector-highlight--pinned`)
  for the inspecting state, distinct from the scanning hover style.
- On window resize or scroll, update the pinned highlight position (the
  element may have moved). A `ResizeObserver` or periodic
  `getBoundingClientRect` check handles this.
- On “Done Inspecting” (Inspecting → Rest), remove the highlight rect.

### Why this matters for Phase 2

Phase 2 adds inline formula editing. The user clicks a formula value in the
inspector, types a new number, and the theme hot-reloads. During this edit
cycle, the persistent highlight rect shows which element is being affected.
Without it, the user loses visual context the moment they start editing.

### Changes summary

| File | Change |
|------|--------|
| `style-inspector-card.css` | Replace hardcoded oklch with `--tug-*` tokens |
| `style-inspector-card.tsx` | Three-state button, rename labels, manage pinned highlight lifecycle |
| `scan-mode-controller.ts` | Option to leave highlight in DOM on deactivate (hand off to caller) |
| `style-inspector-overlay.css` | Add `.tug-inspector-highlight--pinned` style |
| Tests | Update button text assertions, add three-state transition tests, pinned highlight tests |

## Phase 2 — Complete Formula Display and Inline Editing

**Goal:** Show all formula-controlled styles for an inspected element across
all states, then let the user edit values in place.

Phase 1.5 and 1.5B are complete. The current state of the inspector:

- Style inspector is a card in the card system (Opt+Cmd+I opens it)
- Three-state button: Inspect Element → Cancel Inspection → Done Inspecting
- Persistent highlight rect pinned on the selected element
- Scan mode via overlay with Escape to cancel, Opt+Cmd+E web-side keybinding
- Theme-aware card styling using `--tug-*` tokens
- TugButton component for the inspect button
- Self-inspection blocking (can’t inspect the inspector)
- `styleInspectorBus` for cross-component scan toggle
- No Mac menu item for scan (removed — web keybinding only)
- No Option-key hover suppression (removed — overlay already blocks hover)
- No Cmd+Click passthrough (removed — unnecessary with keyboard shortcut)

### Problem: formula display is too narrow

The inspector currently traces token chains for three computed CSS values
(background-color, color, border-color) on the selected element, then looks
up those terminal tokens in the reverse map to find formula fields. This
has two shortcomings:

1. **”(constant)” for elements with rich styling.** A tug-tab shows
   “(constant)” because `buildFormulaRows` follows only the three chains
   it already traced. If those chains don’t resolve to tokens in the reverse
   map (or the tokens resolve to constant values), no formula rows appear —
   even though the element has many formula-driven tokens.

2. **No visibility into other states.** The inspector only shows the
   currently-computed values (rest state). A button has hover, active, and
   disabled states with different formula fields (`filledSurfaceRestTone`
   vs `filledSurfaceHoverTone` vs `filledSurfaceActiveTone`), but none of
   those are visible.

### Step 1: Enumerate all tug properties on the element

Instead of tracing three CSS values and hoping the reverse map connects
them to formulas, scan the element’s matched CSS rules for ALL `--tug-*`
custom properties and resolve each one.

The key insight: component CSS files define aliases like `--tug-tab-bg-rest`,
`--tug-tab-bg-hover`, `--tug-tab-fg-active` on `body`. These aliases
resolve via `var()` indirection to canonical RULES tokens like
`--tug-surface-tab-primary-normal-plain-hover`. The existing
`resolveTokenChain` already walks this chain. The machinery works — we
just need to feed it more properties instead of only bg/fg/border.

1. **Scan the element’s matched CSS rules** for all `--tug-*` custom
   properties. The inspector already does this for three specific
   properties (`background-color`, `color`, `border-color`). Extend the
   scan to collect every `--tug-*` property that appears in rules matching
   the element. This captures rest, hover, active, disabled, and any other
   state variants — no component identification heuristic needed.

2. **Run `resolveTokenChain` on each discovered property.** The chain
   walk handles `var()` indirection to the canonical RULES token, and the
   reverse map connects it to formula fields. All existing infrastructure.

3. **Group results by semantic category and state.** Parse the `-rest`,
   `-hover`, `-active`, `-disabled` suffixes from the alias names. Group
   into sections:
   ```
   BACKGROUND
     rest     oklch(...)  ← --tug-tab-bg-rest → --tug-surface-tab-...-inactive
     hover    oklch(...)  ← --tug-tab-bg-hover → --tug-surface-tab-...-hover
     active   oklch(...)  ← --tug-tab-bg-active → --tug-surface-tab-...-active

   TEXT COLOR
     rest     oklch(...)  ← --tug-tab-fg-rest → --tug-element-tab-...-rest
     hover    oklch(...)  ← --tug-tab-fg-hover → --tug-element-tab-...-hover
   ```

4. **Show formula fields** for each resolved token via the reverse map.
   Formula field name, property type (intensity/tone/alpha/hueSlot), and
   current value.

5. **Keep the existing chain display** for the three currently-computed
   values (bg, fg, border). It shows the live resolution path, which is
   useful. Add the expanded all-properties table below it as a new section.

### Step 2: Inline editing

Click a formula value in the inspector → type a new number → press Enter →
value is written to the recipe file → hot-reload delivers the update.

#### New endpoint

- `POST /__themes/formula` — accepts `{ field, value }`. Reads the active
  recipe file (dark.ts or light.ts based on cached mode). Regex-replaces the
  field’s RHS with the new literal value. Writes the file. Returns 200.
  That’s it. No regeneration, no cache update, no subprocess calls in the
  handler. The file write triggers the existing `handleHotUpdate` recipe
  handler which runs `regenerate()` + `reactivateActiveTheme()`.

#### Editable formula rows

- Make formula values clickable. On click, replace the value `<span>` with
  an `<input type=”text”>` (or `type=”number”` for numeric fields).
- On Enter or blur: POST the value, revert the input back to a span.
- The hot-reload pipeline delivers the CSS update (~500ms round-trip).
- After hot-reload completes: re-fetch `GET /__themes/formulas` to show
  updated values. The persistent highlight rect shows which element is
  being affected during the edit cycle.
- Hue slot fields: use a `<select>` dropdown with the ResolvedHueSlots keys.
- Boolean fields: read-only (no edit control).

#### Knowing when hot-reload is done

After an inline edit POSTs the new value, the inspector needs to know when
the hot-reload cycle completes so it can re-fetch `GET /__themes/formulas`
and update the displayed values. Options:
- Listen for a Vite HMR event via `import.meta.hot.on('vite:afterUpdate')`
  or a custom event emitted by the theme regeneration pipeline.
- Poll `GET /__themes/formulas` with a short delay (~500ms) after the POST.
- Have the `reactivateActiveTheme` pipeline emit a CustomEvent on `document`
  when the new CSS is applied.
The HMR event listener is cleanest — no polling, no arbitrary delays.

### What this intentionally does NOT include

- No sliders. No drag preview. No two-phase commit.
- No client-side oklch parsing or CSS custom property manipulation.
- No pointer capture or pointermove handlers.
- No separate refresh mechanism — hot-reload handles everything.

### Decisions

- **No component identification heuristic.** Enumerate `--tug-*` properties
  from matched CSS rules instead. This is our style system — every property
  we place on an element is discoverable from the CSS rules that apply to
  it. No lookup tables, no class-to-prefix mapping.
- **Display density:** Lightweight formatting to keep it readable (e.g.,
  collapsible sections per state or property group). No TugAccordion yet —
  that’s future work. Do just enough to hold us over until we can adopt it.
- **Hover state inspection:** Not needed. The component-aware lookup shows
  all states from RULES regardless of current computed style. No “force
  state” toggles.

## Lessons Learned

These are hard-won from the failed first attempt. Do not ignore them.

### Vite config dependency tracking

**Any file reachable via `require()` from vite.config.ts is a config dep.**
When a config dep changes, Vite restarts the dev server — killing all WebSocket
connections and showing the SharedWorker CSP error. This includes transitive
deps: `require(“theme-engine”)` → `import(“recipes/dark”)` makes recipe files
config deps.

**Vite statically scans `require(“...”)` string literals in the config file.**
Even `require()` calls inside function bodies that never execute during startup
are detected. The workaround: construct the path dynamically so the scanner
can’t trace it: `require([“.”, “src”, “theme-engine”].join(“/”))`.

**The safest approach: use subprocesses.** Both `configResolved` and
`reactivateActiveTheme` now use `execSync(“bun run script.ts ...”)` instead
of in-process `require()`. The subprocess loads theme-engine in its own
process, so the Vite process never touches the recipe dependency chain.

### Token name formats

RULES keys already include the `--tug-` prefix (e.g.,
`”--tug-surface-global-primary-normal-app-rest”`). The reverse map stores
them as-is. **Never add another `--tug-` prefix** when looking up CSS
properties from the reverse map. The original implementation had a double-prefix
bug that silently broke all drag preview snapshots.

### require() caching

Node’s `require()` caches modules forever. If the Vite process loads
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
round-trip that the hot-reload pipeline now handles correctly. Don’t rebuild it.
