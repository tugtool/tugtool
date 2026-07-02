# Design Decisions

*Each decision records a non-obvious choice and its rationale. Decisions are referenced from [tuglaws.md](tuglaws.md) as `[D##]` and laws are referenced here as `[L##]`.*

---

## Theme & Token Architecture

**D01.** Theme definitions (color choices + recipe reference) are stored as `.json` files in `tugdeck/themes/` (shipped) and `~/.tugtool/themes/` (authored), not as TypeScript constants. Enables runtime loading without rebuilding and the Prototype pattern for new theme authoring. [L06]

**D02.** Two-directory storage with unique names. Shipped themes in `tugdeck/themes/` (version-controlled, read-only). Authored themes in `~/.tugtool/themes/` (user data, not in repo). Names are unique across both directories — middleware checks authored first, then shipped, but uniqueness means no shadowing.

**D03.** Every theme is a peer — no base layer, no override cascade. Switching themes copies the selected theme's complete CSS file into `styles/tug-active-theme.css`. For brio, the source is `styles/themes/brio.css`. For harmony, the source is `styles/themes/harmony.css`. The active theme file is always complete; it is never empty. [L06]

**D04.** `contrastSearch()`, `darkRecipe()`, `lightRecipe()`, and `RECIPE_REGISTRY` are defined in `theme-engine.ts`. `RECIPE_REGISTRY` is the only derivation dispatch path — all `deriveTheme()` calls route through it.

**D86.** The `formulas?: DerivationFormulas` escape hatch is removed from `ThemeRecipe`. The recipe function is the only derivation path. `RECIPE_REGISTRY` is the extension point for new recipe variants.

**D87.** The theme generator card follows Mac document conventions: New (Prototype pattern, copy existing theme), Open (load from available themes), auto-save (500ms debounce to disk), Apply (inject CSS app-wide). Shipped themes open read-only. No explicit Save button.

**D88.** All theme loading goes through the Vite dev middleware. `ThemeName` is a plain `string` (not a hardcoded union). `themeCSSMap` is populated dynamically at startup via `GET /__themes/list`. Supports arbitrary authored themes without code changes.

**D89.** `canvasColorHex()` accepts derived canvas surface params (`hue`, `tone`, `intensity`) extracted from `ThemeOutput.formulas` after running `deriveTheme()`. The raw JSON `surface.canvas.intensity` differs from the derived `surfaceCanvasIntensity`; callers must use the derived value. The `CANVAS_COLORS` lookup table is removed.

**D90.** A theme's `recipe` field (`"dark"` or `"light"`) is set once at theme creation (copied from the prototype) and is immutable. The generator card displays recipe as a read-only label, not a toggle.

**D91.** The Swift Theme submenu uses `NSMenuDelegate.menuNeedsUpdate(_:)` to populate items dynamically from a cached theme list. The web view pushes updated theme lists to Swift via the `themeListUpdated` bridge message. Eliminates hardcoded menu items and per-theme `@objc` handlers.

**D92.** Bluenote is removed from the entire codebase — Swift menu, action dispatch, theme provider, and any CSS files.

**D70.** Color palette is OKLCH-based. 24 hue families with intensity/tone axes, 5 convenience presets per hue, neutral ramp, P3 gamut support, pure CSS formulas. [L15]

**D71.** Four-prefix token naming: `--tugc-{hue}[-preset]` (palette), `--tug7-*` (seven-slot semantic surface and element tokens), `--tugx-<component>-*` (component alias), `--tug-*` (scale/dimension). [L17, L18]

**D72.** Global dimension scale via `--tug-zoom` multiplier on `:root`.

**D73.** Global timing via `--tug-timing` (duration multiplier) and `--tug-motion` (binary on/off toggle) on `:root`.

**D75.** Achromatic neutral ramp (`--tug-neutral-*`). Alpha via CSS relative color syntax, not separate opacity tokens.

**D80.** `--tug-color()` notation expands to `oklch()` at build time via PostCSS plugin (`postcss-tug-color.ts`). Theme files use the notation; browsers never see it.

**D81.** Token pairings are machine-auditable. Every foreground-on-background relationship is extractable from CSS — either via same-rule `background-color` or via `@tug-renders-on` annotation. `audit-tokens lint` enforces zero violations. [L16]

**D82.** Four semantic contrast roles govern text legibility: `content` (75), `control` (60), `display` (60), `informational` (60). Each role maps to a hue slot derived from the recipe's text and display specs. The pairing map assigns every foreground token a contrast role for threshold enforcement. [L15, L18]

**D83.** Five contrast roles with minimum thresholds: `content` (75), `control` (60), `display` (60), `informational` (60), `decorative` (15). All readable text >= 60. [L16]

**D84.** Theme application uses stylesheet injection (`<style id="tug-theme-override">`), not body class toggling. [L06]

**D85.** Optional palette entries use `var()` fallbacks so themes can omit slots gracefully. [L15]

---

## Component Model

**D05.** Three component kinds: *wrappers* (thin Radix adapters), *compositions* (assemble multiple primitives), *originals* (built from scratch).

**D06.** `components/tugways/` is the public component API surface.

**D07.** Components are module-scope functions composed via JSX nesting, not class hierarchies or render props.

**D08.** TugButton has two modes: *direct-action* (`onClick` prop) and *chain-action* (`action` prop dispatches into responder chain). [L11]

**D15.** TugPane is composition, not inheritance. It assembles chrome (title bar, tab strip, accessory, content region) around the active Card's content, rendered via `CardHost`. [L09]

**D16.** Card data access via `useCardData()` hook, not render props.

**D17.** Cards compute dynamic min-size from content and report via `onMinSizeChange`.

**D22.** Component Gallery card serves as living inventory — 21 tabbed demos covering all tugways components. [L10]

**D39.** Default button: responder chain designates one button per scope. Enter key routes to it. [L11]

**D43.** Component Gallery is a proper card with tabs, not a floating panel. [L10]

**D105.** "Collapse long content" splits into two primitives along one axis: *does the hidden content stay mounted?* **Logical fold** (`BlockFoldCue` + `useBlockFoldState`) is for known-list bodies — file lines, terminal output, diff hunks — where collapsing must *unmount* the hidden portion for performance (don't mount a CM6 editor for a folded file) and coordinate with the transcript scroller (don't slam the viewport when a huge body folds mid-scroll). It thresholds by item count and is coupled, deliberately, to the tool-block chrome and scroller contexts. **Visual clamp** (`TugClamp`) is for arbitrary content that is cheap to render in full but visually too tall — a wrapped command, an error message, a markdown blurb — where there is no perf reason to unmount and no scroller to coordinate with. It *measures* the rendered height (the visual line count isn't known ahead of wrapping), caps it behind a `data-expanded` + CSS window with a Show more/less reveal, and keeps everything mounted. The two share only the `ChevronsDown/Up` vocabulary, never the machinery — so neither is forced to straddle both jobs. Reach for `TugClamp` in dialogs and inline surfaces; reach for the fold system inside a tool-block body. Tree-shaped per-node collapses (JSON nodes, diff hunks, search-result files) are a third, separate thing and belong to neither. [L06]

---

## Responder Chain & Actions

**D09.** Responder chain operates entirely outside React state. `ResponderChainManager` is a plain TypeScript class. [L01, L02, L07]

**D10.** Four-stage key processing pipeline: keybinding resolution, responder dispatch, default handling, browser passthrough.

**D11.** Two-level action validation: `canHandle` (fast routing check) + `validateAction` (semantic validation with current state). [L07]

**D61.** `ActionEvent` carries typed payload, sender identity, and phase. [L11]

**D62.** Two dispatch modes: *nil-target* (chain walks until a responder handles it) and *explicit-target* (dispatched to a specific responder). [L11]

**D63.** Controls (buttons, sliders, pickers) dispatch ActionEvents into the chain but never register as responder nodes. [L11]

---

## State & Mutation Zones

**D13.** DOM utility hooks for appearance zone: `useCSSVar`, `useDOMClass`, `useDOMStyle`. All bypass React state. [L06]

**D40.** DeckManager is a subscribable store. Implements `subscribe()`/`getSnapshot()` for `useSyncExternalStore`. Exactly one `root.render()` call, at construction. [L01, L02]

**D41.** `useResponder` uses `useLayoutEffect` for registration so responder nodes are wired before any events fire. [L03]

**D42.** No repeated `root.render()` from external code. All state changes flow through `notify()` and `useSyncExternalStore`. [L01]

**D64.** Mutation transactions: `begin` (snapshot CSS inline styles) → `preview` (live CSS mutations) → `commit`/`cancel`. [L08]

**D65.** Transaction previews operate in appearance zone only. Commit handler may cross into store/React state. [L06, L08]

**D66.** Style cascade reader (`StyleCascadeReader`) provides `getDeclared()` with four source layers: `token`, `class`, `inline`, `preview`.

---

## Cards & Layout

**D27.** Window-shade collapse: double-click title bar toggles card between full and title-bar-only. State stored in `CardState.collapsed`.

**D30.** Tab bar visible only when card has multiple tabs.

**D31.** Tabs are a TugPane chrome feature — a UI affordance that appears when a Pane holds more than one Card. Not a data concept. [L09, L10, L25]

**D44.** Progressive tab overflow: three stages — all visible, inactive tabs collapse to icon-only, overflow into dropdown.

**D45.** Card-as-tab merge: dropping a card onto another card's tab bar merges it as a new tab. `detachTab()` reverses.

**D49.** Per-tab state bag preserves `scroll`, `selection`, and `content` across tab switches and reloads.

**D50.** `useCardStatePreservation` hook: card content registers `onSave`/`onRestore` callbacks. Uses `useLayoutEffect` for registration. [L03]

**D95.** A content-owning + engine card has exactly one text-entry surface — the engine's editor (`tug-prompt-entry` for a dev card) — and activation focus has exactly one destination: the engine. A content-owning card (`bag.content !== undefined` — every dev card is one) carries no `data-tug-focus-key` / `data-tug-state-key` element of its own, so `captureFocus` only ever classifies its focus as `engine` or `none`; the framework-axis save site leaves `bag.focus` absent in both cases. On restore, the single-channel dispatcher `resolveBagFocus` finds no framework-axis snapshot but an engine-managed `componentId`, and routes to the `engine` resolution — `applyBagFocus` invokes the engine's registered `paintMirrorAsActive` hook (`store.registerEngineHooks` / `store.invokeEnginePaintMirrorAsActive`). The engine is a *callable*, not an autonomous claimant: it no longer claims focus from `onCardActivated`. Focusable-but-not-entry content inside the card (a read-only `TugCodeView` viewport, a block button) carries no focus marker, so `captureFocus` classifies it `none` and activation focus correctly returns to the engine — a viewer is not a text-entry surface, and transient selection-to-copy focus is not preserved across activation. The general framework focus axis (`data-tug-focus-key` / `data-tug-state-key`, the `dom` / `form-control` `FocusSnapshot` kinds) still serves non-engine cards (form-control cards, settings cards); it is simply never populated *inside* a content-owning + engine card. See [state-preservation.md § Focus dispatch model](state-preservation.md#focus-dispatch-model), [component-authoring.md § Focus in content-owning cards](component-authoring.md), `card-host.tsx` (`captureFocus`), and `focus-transfer.ts` (`resolveBagFocus` / `applyBagFocus`). Established by Phase E.11 (single-channel dispatcher) and Phase E.12 (single-text-entry rule; per-block Find removed). Supersedes the pre-E.11 framing of this decision (the engine-vs-framework "two axes" model with `kind: "component-owned"` and `resolveActivationTarget`). Previously documented inline as `[D07]` in `card-host.tsx` comments — that local tag has been normalized to reference this decision (the canonical D07 is the JSX-composition rule above; the focus-boundary rule is D95). [L23]

**D51.** Focused card ID persisted in `DeckState.focusedCardId` for reload restoration.

**D52.** Collapsed state persisted in `CardState.collapsed`.

---

## Snap Sets

**D32.** Snap requires Option/Alt modifier during drag (`altKey`).

**D33.** Set-move is always active once a snap set is formed — dragging one member moves all.

**D53.** Set members get squared corners via CSS `data-in-set` attribute.

**D54.** Set perimeter flash via SVG hull polygon (`computeSetHullPolygon()`).

**D55.** Break-out restores rounded corners (CSS-driven) and flashes individual card perimeter.

**D56.** Border collapse: snap positions offset by border width so adjacent cards share a single visual line.

**D57.** Interior set shadows hidden via `clip-path: inset()` on `.tug-pane-chrome`. Exterior edges extend by `SHADOW_EXTEND_PX`.

**D58.** Active/inactive shadow tokens: `--tug-card-shadow-active` (focused) and `--tug-card-shadow-inactive` (unfocused).

**D59.** Command-key (`metaKey`) suppresses card activation on click, allowing multi-card operations.

**D60.** Resize click activates the card (brings to front).

---

## Selection

**D34.** Three-layer selection containment: CSS `user-select: none` baseline, `SelectionGuard` runtime clipping, `data-tug-select` developer API. [L12]

**D35.** `SelectionGuard` is a module-level singleton, not React state. [L01, L12]

**D36.** Pointer-clamped selection uses `caretPositionFromPoint` (with `caretRangeFromPoint` fallback). [L12]

**D37.** Four select modes via `data-tug-select` attribute: `default`, `none`, `all`, `custom`. [L12]

**D38.** Cmd+A scoped to focused card via responder chain `selectAll` action. [L12]

---

## Motion & Animation

**D23.** Motion tokens are CSS custom properties: `--tug-timing` (duration scalar), `--tug-motion` (binary toggle).

**D24.** Reduced motion via `--tug-motion: 0` and `data-tug-motion` attribute. Durations scale; motion doesn't simply disappear. [L13]

**D76.** TugAnimator wraps WAAPI. Named animation slots (WeakMap-based), three cancellation modes (snap-to-end, hold-at-current, reverse), animation groups, reduced-motion awareness. [L13, L14]

**D77.** Inactive selection uses CSS Custom Highlight API for dimmed highlight in unfocused cards.

**D78.** Child-driven ready callback: parent triggers child `setState`, child signals DOM commit via its own `useLayoutEffect`. No inline measurement of child DOM from parent. [L04]

**D79.** `requestAnimationFrame` is never used for operations depending on React state commits. RAF timing relative to React's commit cycle is not a contract. [L05]

---

## Scroll Behavior

**D93.** Smart auto-scroll for dynamic content uses a six-phase state machine — not scroll-event guessing. `SmartScroll` (a standalone class, not a React hook) owns a scroll container element and tracks six mutually exclusive phases: `idle`, `tracking`, `dragging`, `settling`, `decelerating`, and `programmatic`. The phase is the guard: if the phase is `dragging`, `settling`, or `decelerating` and scroll direction is up, a user is scrolling — disengage follow-bottom. If the phase is `idle` or `programmatic` and scroll changes, we caused it — ignore.

Phase transitions are driven by six DOM listeners: (1) **`scroll`** on container — fires callbacks and drives re-engagement check; (2) **`scrollend`** on container — terminal signal for deceleration and programmatic animation, with 150ms timer fallback for browsers without native support; (3) **`pointerdown`** on container — enters `tracking`; (4) **`pointerup`/`pointercancel`** on document — exits `dragging` into `settling` (a 50ms window to detect momentum); if scrolls arrive within 50ms, transitions to `decelerating`; if not, transitions to `idle`; (5) **`wheel`** on container — skips `tracking`, enters `dragging` immediately, starts scrollend fallback timer, disengages follow-bottom on `deltaY < 0`; (6) **`keydown`** on container — all scroll keys (PageUp, PageDown, Home, End, ArrowUp, ArrowDown, Space) enter `dragging` immediately and start the scrollend fallback timer; only scroll-up keys (PageUp, Home, ArrowUp, Shift+Space) disengage follow-bottom.

The `settling` phase is explicit state: `isUserScrolling` returns true during `settling` (pointer released, momentum outcome pending). The `_scrolledAfterPointerUp` flag pattern is replaced by an actual phase.

Content auto-scroll is **controller-driven**: `TugMarkdownView.doSetRegion` checks `isFollowingBottom` and calls `scrollToBottom()` after content updates. `SmartScroll` has no `ResizeObserver` — it does not observe content changes. `overflow-anchor` is not used (Safari doesn't support it). Architecture studied from `use-stick-to-bottom` (StackBlitz Labs, MIT — see THIRD_PARTY_NOTICES.md). [L03, L06, L07]

**D94.** **Cmd/Ctrl-wheel bypasses inner block scrollers and routes the wheel delta to the outer scrollport.** Inner block scrollers (FileBlock's CM6 scrollport, DiffBlock's hunks region, TerminalBlock's virtualized scroller, future code-fence viewers, future JSON-tree blocks, future structured-result panels) capture wheel events while the cursor sits over them, which stutters the outer card-scrollport skim across long transcripts. The escape hatch is surface-wide: **holding Cmd (macOS) or Ctrl (Win/Linux) while wheeling routes the delta straight to the outer scrollport, regardless of cursor position.** Plain wheel (no modifier) preserves current behavior — inner captures until exhausted, then bubbles to outer.

Mechanism: `useOuterScrollOnModifierWheel({ innerRef, outerScrollportRef })` (and its imperative twin `attachOuterScrollOnModifierWheel(inner, getOuter)`) attaches a capture-phase, non-passive `wheel` listener on the inner scrollport. On a Cmd/Ctrl-modifier hit, the handler calls `preventDefault` + `stopPropagation` and forwards `event.deltaY` to the outer scrollport via `scrollBy({ top, behavior: "auto" })`. Outer scrollport is read on every event so context-driven node swaps land without re-attaching. The hook is registered in `useLayoutEffect` so wheel routing is live before the first paint a user could plausibly wheel against.

The contract is surface-wide, not body-kind-specific: any new inner scroller a body kind introduces opts in by calling the hook with its inner-scroller ref. The same mechanism applies to pane-scoped scrollers and modal scrollers when those grow into the pattern. Cmd-click (new-tab), Cmd-+/- (browser zoom), Shift-wheel (browser-native horizontal pan), and Alt-wheel are unaffected — the listener is wheel-modifier-specific and intercepts only the Cmd/Ctrl axis.

**Bash render-on-scroll-into-view recovery.** TerminalBlock's virtualized scroller occasionally paints empty when the outer card scrolls it into view — a WebKit layer-invalidation hiccup or an IntersectionObserver-style virtualizer missing the first paint while the outer's clip rect is settling. The fix is a symptom-targeted refit: TerminalBlock subscribes to its outer scrollport via `IntersectionObserver` (root = outer scrollport, threshold 0) and re-runs the virtualizer's `applyUpdate(scrollTop)` on every entering-view transition. A `scroll` listener on the outer (gated on `inView`) covers sub-IO-threshold deltas. Refit is idempotent when no enter/exit ranges change, so spurious fires are free. [L03, L05, L06, L22]

---

## Feed & Transport

**D19.** Transport is tugcast binary frame protocol, not a separate HTTP server. `FeedId` enum routes frames.

**D21.** Interface-first development: define TypeScript interfaces, mock backend, then implement frontend.

---

## Tugbank

**D46.** Tugbank is a SQLite-backed typed defaults store. `DefaultsStore` wraps `rusqlite::Connection`. Typed `Value` enum: `Null`, `Bool`, `I64`, `F64`, `String`, `Bytes`, `Json`.

**D47.** Per-domain key-value storage with CAS (compare-and-swap) concurrency via monotonic generation counters. `set_if_generation()` returns `Written` or `Conflict`.

**D48.** Frontend reads/writes tugbank via HTTP bridge endpoints.

---

## Observable Properties & Inspector

**D67.** `PropertyStore`: typed key-path property store per card. Schema defined via `PropertyDescriptor[]`.

**D68.** `PropertyStore.observe()` is directly compatible with `useSyncExternalStore`'s subscribe contract. [L02]

**D69.** Inspector panels participate in the responder chain.

**D74.** Dev cascade inspector: `Ctrl+Option + hover` shows token resolution chain for any element.

---

## Code Session & Transcript

**D96.** **Any code path that lands a `TurnEntry` on `state.transcript` must also seed the per-turn `streamingDocument` paths (`turn.${turnKey}.{assistant,thinking,tools}`) from the entry's payload.** This is the write-side counterpart to [L26]'s post-unification render contract: the assistant row's `AssistantTurnCell` observes `turn.${turnKey}.${channel}` exclusively (no fallback to `TurnEntry.*` fields), so a turn that exists on the snapshot but whose per-turn paths are empty renders blank — a textbook [L23] violation. Today the only such code path is `code-session-store/reducer.ts`'s `append-transcript` effect, paired with the `write-inflight` effects emitted by `handleTextDelta` / `handleToolUse` / `handleToolResult` / `handleToolUseStructured` for both live and replay events (the live↔replay symmetry restored by Step 18.9). Any future analogue — out-of-band ingestion, server-pushed transcript snapshot, debug-tool import, hot-reload state restore — must replicate the seeding using `serializeToolCalls` (`reducer.ts`) for the tools channel and the raw string for assistant/thinking. The reducer's pattern is the reference implementation; deviating from it without seeding strips the corresponding content from every rendered cell that comes through the alternate path. [L23], [L26]

**D97.** The dev card is partitioned into **six placement zones, `Z0`-`Z5`, numbered spatially top-to-bottom**, with `Z1` subdivided into per-turn `Z1A` / `Z1B` and a per-row `Z1C` indicator zone, and `Z4` subdivided into two prompt-entry toolbar sub-slots, `Z4A` and `Z4B`. Each zone is an addressable region the telemetry renderers and the assistant-rendering registry target by ID. Most are `ReactNode` slot props on a host component; `Z5` is a state-coordinated interactive area rather than a content slot. `Z4A` and `Z4B` are *layout positions* — a leading-fixed slot and a centred-floating slot — whose occupants the toolbar assigns and is free to swap (below). Spatial numbering means any zone is findable by intuition, and a future zone inserts at its position with a clean downstream renumber — `Z0` is unambiguously "what you see first."

```
┌─ dev card · transcript pane ────────────────────────────────────────────────┐
│ Z0   top of card — reserved (empty until its slot is filled)                 │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│ DevTranscriptHost  →  TugListView          scrolls · flex 1 1 auto          │
│                                                                              │
│   ┌─ user row ───────────────────────────────────────────────────────────┐   │
│   │ "count lines of code..."                                Z1 user half │   │
│   │                                                           (reserved) │   │
│   └──────────────────────────────────────────────────────────────────────┘   │
│   ┌─ assistant row ──────────────────────────────────────────────────────┐   │
│   │ [ markdown body · tool-call blocks · thinking ]                      │   │
│   │                                               Z1A  model · timestamp │   │
│   │ ◌◌◌                                          Z1C  in-flight          │   │
│   │                                                    indicator         │   │
│   │                                                    (in-flight-tip    │   │
│   │                                                    row only;         │   │
│   │                                                    collapsed         │   │
│   │                                                    otherwise)        │   │
│   │ [copy]                                       Z1B  end-state (when    │   │
│   │                                                    a committed turn  │   │
│   │                                                    has assistant-    │   │
│   │                                                    side content;     │   │
│   │                                                    collapsed         │   │
│   │                                                    otherwise)        │   │
│   └──────────────────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────────────────┤
│ Z2  [grip] STATE · TIME · TOKENS · CONTEXT · TASKS · JOBS         [maximize] │
│            (TASKS cell per [D100]; JOBS cell per [D102]; each reads a        │
│             dimmed None when its feed is empty)                              │
│      flex 0 0 auto · never scrolls · sits outside TugListView                │
└──────────────────────────────────────────────────────────────────────────────┘
             ↑↓  split-pane sash — transcript / prompt-entry resize
┌─ dev card · prompt-entry pane ──────────────────────────────────────────────┐
│ Z3   prompt-entry status row — reserved (collapses to zero height)           │
│                                                                              │
│   Ask Claude to build, fix, or explain                                       │
│                                                                              │
│ [Code][Shell]          [Project: /path] [Claude Code 2.1.148]          [ ↑ ] │
│ Z4A leading-fixed · Z4B centred-floating · Z5 trailing-fixed                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Zone | Host · slot prop | Current occupant | Status |
|------|------------------|------------------|--------|
| `Z0` | `DevCard` · `headerContent` | — | reserved — empty |
| `Z1` | transcript row · `renderTurnTrailing`, keyed by `half` | user half: —; assistant half: `Z1A` model · timestamp + `Z1B` end-state aggregate | user half reserved; assistant half shipped |
| `Z1B` | per-turn end-state aggregate in `TugTranscriptEntry`'s `controls` slot — the OK / interrupted / error / transport_lost badge, per-turn token count, per-turn wall-clock, whole-turn COPY. Rendered by `DevZ1B`. The slot collapses to zero height (no `min-height`) when there is no end-state to show (in-flight rows). | rendered when the committed turn has an assistant-side Message (per Step 5.6 [Decision F](../roadmap/tugplan-tide-session-wake.md#step-5-6)). NOT rendered for a turn that committed with only a `user_message` (interrupted-before-response) — the user_message row's own static "OK" footer is the only chrome. NEVER multiplexes the in-flight indicator (Z1C owns that) | shipped under Step 5.6 |
| `Z1C` | per-row in-flight indicator zone in `TugTranscriptEntry`'s new `inflightFooter` slot — sandwiched between the body and the `controls` slot. *Every* `TugTranscriptEntry` carries the slot uniformly; the slot collapses to zero height when `inflightFooter={null}`. NOT a list row; adds nothing to `totalRows`; no scroll-to-row helper needs to skip it; no React key churn. | `DevZ1C` — only the **in-flight-tip row** mounts an active Z1C with a `useSyncExternalStore` subscription to a memoized `{phase, interruptInFlight}` selector; all other rows pass `null` to the slot and stay subscription-free. Indicator content (visible glyph is the three-bar `TugThinkingIndicator` with `labelPosition="hidden"`; phase label rides on `aria-label`) resolves via `devZ1CContent(phase, interruptInFlight)` — returns the indicator for `submitting` / `awaiting_first_token` / `streaming` / `tool_work` / `waking`; returns `null` (slot collapses) for `awaiting_approval` (the pending dialog *is* the affordance), `interruptInFlight === true` (interrupt is instant from the user's POV — Z1B paints the end-state once the turn commits), and `idle` / `replaying` / `errored`. In Step 5.8 the in-flight tip is the in-flight code row (`!isCommitted`); in Step 5.9 it is the row carrying the Message flagged `isLastInflightMessage`. Position inherits from the row body's indent and footer placement — no absolute positioning. | shipped under Step 5.8 |
| `Z2` | `DevCard` · `statusBarContent` | `DevTelemetryStatusRow` — STATE · TIME · TOKENS · CONTEXT · TASKS · JOBS cells, flanked by the leading sash grip and the trailing maximize toggle. The `TASKS` cell (per [D100]) renders a `TugProgress` ring + `N/M` label that drives a popover composed of `TugTaskItem` rows; the cell shows `None` when no task list is active. The `JOBS` cell (per [D102]) mirrors the same grammar for AI-initiated background jobs — `finished/total` + pose, a popover with per-job stop buttons, and a terminal-rows Clear. Beneath the row sits the one-line `PULSE` strip (per [D103]) — ambient app-wide color commentary at fixed height, hidden when the `pulse/enabled` default is off. | shipped |
| `Z3` | `TugPromptEntry` · `statusContent` + `cautionContent` | — (the dev card no longer fills it) | reserved — collapsed |
| `Z4A` | `TugPromptEntry` toolbar — leading, fixed | route choice-group (`Code` / `Shell`) | shipped |
| `Z4B` | `TugPromptEntry` toolbar — centred, floating | `indicatorsContent` — project-path + Claude Code badges | shipped |
| `Z5` | `TugPromptEntry` submit button (no slot) | lifecycle-driven Submit / Stop / Awaiting / Stopping / Reconnecting | shipped |

The transcript pane (the upper `TugSplitPanel`) is a flex column — `Z0` header, `TugListView` (`flex 1 1 auto`, scrolls), with `DevJumpToBottomButton` as floating chrome anchored at the list's bottom edge, and `Z2` status bar — so a telemetry update in `Z2` grows into space the list cedes without repositioning the scroll, and `Z2`, living *outside* `TugListView`, never scrolls with the transcript. `Z1` is per-turn rather than card-level: one trailing slot wired twice per turn (`half: "user" | "assistant"`), spatially inside the transcript pane between `Z0` and the `Z2` row. `Z1B` (the per-turn end-state aggregate) and `Z1C` (the per-row in-flight indicator zone) are intentionally separate sub-zones — `Z1B` lives in `TugTranscriptEntry`'s `controls` slot (collapses to zero when empty); `Z1C` lives in `TugTranscriptEntry`'s new `inflightFooter` slot, sandwiched between the body and `controls` (every row carries the slot uniformly; only the in-flight-tip row mounts a Z1C that subscribes to phase and paints the indicator; all other rows pass `null` and the slot collapses). The pre-Step-5.6 `Z1B` multiplexed both responsibilities ("indicator ↔ end-state display") inside one component; under per-Message rows the multiplex is structurally awkward, so the two responsibilities split into two `TugTranscriptEntry` slots with disjoint domains and independent collapse rules. An earlier revision of `Z1C` placed it as transcript-level chrome below `TugListView`; that ended up marooned at the bottom of the pane instead of at the in-flight row's footer, so the design moved to a per-row slot that inherits position from the row body's indent for free. `Z5` is the submit button — a single DOM node whose label / `disabled` / `data-mode` are driven by the lifecycle state machine and which is never swapped across mode transitions, per [L26].

The prompt-entry toolbar lays out three zones in one flex row. `Z4A` sits at the leading edge and `Z5` (the submit button) at the trailing edge — both fixed and content-sized; `Z4B` floats centred between them, two equal flex spacers splitting the free width so `Z4B`'s centre lands at the midpoint of the `Z4A`–`Z5` gap. `Z4A` and `Z4B` are *positions*, not component assignments: the toolbar fills them with the route choice-group and the indicator cluster (the `indicatorsContent` slot — the project-path and Claude Code badges, the identity chrome naming the prompt entry's target), and which occupant takes which position is a layout decision free to change. Today the route choice-group sits in `Z4A` and the indicator cluster in `Z4B`. The maximize toggle and the prompt-area sash grip are card chrome, not zone occupants — both sit in the `Z2` status bar (grip on the leading edge, maximize on the trailing edge), which is why the `Z3` prompt-entry status row, once home to the badges and the toggle, is now empty and collapsed.

A zone's *location* is contract; its *occupant* is not — every zone is a generic addressable slot. `Z0`, the `Z1` user half, and `Z3` are reserved: the slot exists in the API, default content is `null`, and the row collapses to zero height until something fills it (the dev card leaves `Z3` empty today, so its row has no height). `Z1C` is a per-row `inflightFooter` content slot on `TugTranscriptEntry`: every row carries it uniformly and the slot collapses to zero when passed `null`; only the in-flight-tip row passes a live `DevZ1C` instance. Established by the Step 20.x turn-surface work (archived as `roadmap/archive/tide-assistant-turns.md`); `Z3`'s `cautionContent` slot was added by the assistant-rendering drift-detection work; the `Z4A` / `Z4B` split and the `Z2` chrome relocations came from the prompt-entry-zones work (`roadmap/tugplan-tide-prompt-entry-zones.md`); the `Z1B` / `Z1C` split (separating per-turn end-state from per-row in-flight indicator) came from Step 5.6 of the tide-session-wake work (`roadmap/tugplan-tide-session-wake.md`) under the per-Message render-layout refactor and was reshaped in Step 5.8 from "transcript-level chrome below `TugListView`" into the per-row `inflightFooter` slot after the transcript-level placement marooned the indicator at the pane's bottom edge. [L06], [L26]

**D100.** The active task list surfaces as a `TASKS` cell on the [D97] `Z2` status bar — not inline in the assistant turn(s) that issued each call, and not as a separate sub-zone. Anthropic's `claude` ≥ `v2.1.148` replaces the old `TodoWrite` tool (single call carrying the canonical list) with a per-item CRUD family — `TaskCreate` (one call per task; the server assigns a monotonic `taskId`) and `TaskUpdate` (`{ taskId, status }` flips one task's status). A typical session produces ~3× more events than the old `TodoWrite` did (4 × `TaskCreate` up front + 8 × `TaskUpdate` interleaved for a 4-item list is representative), so inline-per-turn rendering would litter the transcript with a status-flip per row; the status-bar cell keeps the live picture one fixed glance away without claiming separate vertical real estate. The cell renders a `TugProgress` ring + `N/M` label (`done` over `total`) inside `DevTelemetryStatusRow` alongside `STATE` / `TIME` / `TOKENS` / `CONTEXT`; clicking it opens a popover whose body is a vertical stack of `TugTaskItem` rows (one per task, status-driven indicator + `subject`, with the optional `description` surfacing in a `TugTooltip` on hover). When no task list is active the cell still occupies its reserved width but reads `None` (dimmed) and the ring is suppressed — the layout stays anchored so the surrounding cells never reflow. When the session is `idle`, the ring renders in its `stopped` state (closed outlined circle, no animation) in both the cell and the popover, so motion implies ongoing work and stillness implies it is over. The cell is fed by a pure reducer — `reduceTaskListState(toolCalls): TaskListState` in `select-task-list.ts` — that folds the event stream by walking `transcript[].toolCalls[]` then the in-flight `toolCallMap`'s values in order, appending one `TaskItem` per `TaskCreate` (with `status: "pending"` and `taskId` parsed from the `tool_result.content` "Task #N created successfully:" echo, falling back to monotonic count) and mutating-by-id for each `TaskUpdate`; only terminal (`status: "done"`) calls fold so an in-flight `TaskCreate` with no assigned id yet is skipped until its `tool_result` lands. The cell renderer reads through `useTaskListState` (a `useSyncExternalStore` hook per [L02]) and the popover composes `TugTaskItem` primitives directly, with role-driven accent colors (in-progress rows use `TugProgress role="action"` + `TugLabel role="action"`; completed rows use `--tugx-task-item-success-color` on the check glyph) so the surface picks up standard tone tokens instead of bespoke aliases. No wire-level clear event exists; the list lives for the session, and the active rule (non-empty list with at least one non-completed item) governs the `N/M` vs `None` reading. Session clear (`/clear`) resets the cell by way of resetting the store. The TASKS cell is the canonical surface for *current state* — the assembled list, one fixed glance away. The transcript carries per-call inline markers via `TaskInlineToolBlock` — a tiny `<ListChecks size=14>` + `<TugLabel size="sm" emphasis="calm">` row for each `TaskCreate` and `TaskUpdate` event (`"Created: <subject>"` / `"Started: <subject>"` / `"Completed: <subject>"`), so a reader scrolling the transcript can see *when in the conversation flow* each task action happened. The two surfaces never duplicate work: the cell answers "what's on the list now?"; the marker answers "when did this happen?". The marker uses the `calm` emphasis (italic + muted gray) so every row reads as ambient annotation subordinate to the TASKS cell — color is reserved for the rare error case (`role="danger"`, `emphasis="normal"`). The marker intentionally carries no `BlockChrome` — no frame, no status stripe, no error band — so it stays inline-flow, not another tool-call card competing with the cell for attention. The dead `registerToolBlock("todowrite", …)` entry is removed; the original Step 24's inline `TodoWriteToolBlock` was already silent on every `v2.1.148+` session — `TodoWrite` is no longer emitted — so the broader rework is also a correctness fix, not just a UX one.

**History.** D100 originally specified a separate pinned sub-zone — `Z2A` (leading-fixed) paired with a renamed `Z2B` (trailing). That iteration shipped briefly (a `DevCardPinnedTodo` renderer + `statusBarLeadingContent` prop), but produced too much vertical-layout shift and broke the cell-row rhythm of `Z2`. The decision was reverted to single `Z2` + the `TASKS` cell described above; the `Z2A` / `Z2B` split is no longer present in the code, and D97's zone table reflects single-`Z2`. The original artifacts (`DevCardPinnedTodo`, `statusBarLeadingContent`, `--tugx-pinned-todo-*` tokens, `:has()`-based collapse) were removed. [D97], [L02], [L06], [L20]

**D101.** Tool visibility in the Dev transcript is classified by a single editable policy table — `TOOL_VISIBILITY_POLICY` in `tugdeck/src/components/tugways/cards/dev-tool-visibility-policy.ts` — with three buckets and one source-of-truth rule per bucket. **Bespoke** is implicit: a tool has a bespoke wrapper iff it is registered in `TOOL_BLOCK_REGISTRY` via the dispatch's bottom-of-file `registerToolBlock(...)` calls (the `BESPOKE_REGISTRATIONS` array exported as `BESPOKE_TOOL_NAMES`). Bespoke names MUST NOT appear in the policy table — that would be a double-classification, caught by the governance test. **Hidden** is explicit: the policy table's `hidden` entries map to a shared exported `NullToolBlock` via two short-circuits — `resolveToolBlock` returns `NullToolBlock` for any hidden name ahead of the registry lookup, and `detectToolCallDrift` exempts hidden names from the `unknown_tool` check. Hidden is for control-channel machinery the user does not need to see (`ToolSearch`, `ScheduleWakeup`, `EnterPlanMode`, `ExitPlanMode`, `PushNotification`) or for tools whose surface lives elsewhere (`TaskCreate` / `TaskUpdate` per [D100] — the TASKS status-bar cell is the sole surface). **Default-intent** is explicit: the policy table's `default-intent` entries become `AUDIT_CONFIRMED_DEFAULT_TOOLS`, routing through `DefaultToolBlock` (the JsonTree fallback) with no `unknown_tool` caution. Every `default-intent` entry's `rationale` MUST cite the follow-on step's `#step-` anchor — the governance test enforces it, so a default-intent entry is always an *explicit TODO* with a planned bespoke wrapper, never a forever-bucket. The governance test (`__tests__/dev-tool-visibility-policy.test.ts`) pins the two invariants that catch real mistakes code review would miss: (c) every `default-intent` entry's rationale contains `"Awaiting"` and `"#step-"` — the only mechanism preventing `default-intent` from becoming a forever-bucket; and (d) the union of bespoke + policy covers the v2.1.148 canonical tool set — so a new Claude Code tool in a future release fails CI until it is explicitly classified. Shape / parse / no-double-classification checks were considered and intentionally not landed: the entry shape is enforced by the `ToolVisibilityEntry` interface, and double-classification is rare-and-obvious enough that code review is the right gate. MCP (`mcp__*`) is intentionally excluded from the policy per the project's MCP non-goal — `mcp__*` names route through `DefaultToolBlock` and produce `unknown_tool` cautions; the caution count is the deferral's signal. Moving a tool between buckets is a one-line policy edit; promoting to bespoke means a new `registerToolBlock` call + removing the policy entry. [D04], [D11], [D100]

**D102.** AI-initiated background jobs surface as a `JOBS` cell on the [D97] `Z2` status bar, mirroring the `TASKS` grammar exactly ([D100]) so the row reads as one instrument: a `TugProgressIndicator` pulsing-dot + `finished/total` label (dimmed `None` when empty), a popover behind a click. The cell's pose is a pure function of the ledger only — `jobsCellPose` in `select-jobs.ts`: any running job → `running`; else any failed → `aborted` (the danger pose [D100] reserved gets its first consumer; it holds until the user clears it, a new job starts, or the session clears); else `completed`. **No idle demotion** — the one deliberate semantic divergence from TASKS: a background job genuinely runs *between* turns, so an idle session must not quiet a running dot. The feed is a **session-lifetime jobs ledger** held in `CodeSessionState.jobs` (not a pure fold over `toolCalls` — the lifecycle events are not all tool calls, and Clear must *forget* rows): claude ≥ 2.1.173 emits `system/task_started` / `system/task_updated` frames for background `Bash` / `Agent` (`run_in_background: true`), which tugcode forwards verbatim as `task_started` / `task_updated` IPC frames from **both** routing tiers (the terminal flip arrives mid-turn for a fast failure, inter-turn for an idle completion). Ledger updates are idempotent upserts/flips keyed by claude's `task_id`: inserts from the `task_started` frame AND the launch `tool_result` echo (`backgroundTaskId` / `agentId`), terminal flips from `task_updated.patch.status` (`completed` / `failed` / `killed`→stopped), the `wake_started` trigger fold, and a defensive `TaskStop`-tool fold — first terminal flip wins. **The wire carries no backgrounded discriminant**: a foreground subagent's `task_started` is shape-identical (the empirical contract lives in `stream-json-catalog/v2.1.173-jobs-spike/`), so inserts gate on the launching tool call via `tool_use_id` — `isJobLaunch`: explicitly backgrounded (`input.run_in_background === true`) **or a `Monitor` watcher**, which is background activity by nature (a watcher's `task_type` reads `local_bash`, so its `kind: "monitor"` derives from the tool name). The gate also keeps an async subagent's internal jobs out (their launching calls aren't in the deck's stream). **Monitor rows have their own flip rule**: a watcher reaches terminal only via `task_updated` — the wake-trigger fold exempts `kind: "monitor"`. On the captured wire this is defense in depth (mid-life monitor events wake claude via task-id-less re-inits, and a monitor's only `task_notification` is terminal with a status agreeing with `task_updated`: completed/completed on natural exit, killed/stopped on timeout or kill), but the exemption pins the invariant against future per-event notifications. Replay never populates the ledger (a replayed launch would pulse forever — its lifecycle frames don't replay), and a fresh `session_init` stale-marks `running` rows to `stopped` (a respawned claude cannot carry jobs across). The popover (`JobsPopoverContent`) lists per-job rows — status dot, end-truncated description (tooltip for the full text), elapsed (live 1Hz leaf that mounts only while the popover is open), and a stop button on running rows that fires the pre-existing `stop_task` verb (`CodeSessionStore.stopJob` → tugcode `handleStopTask` → control request); no optimistic flip — the capture confirmed claude answers with `task_updated{killed}` + a `stopped` notification. The footer carries the zero-bucket-drop summary — live watchers split out of the running bucket as "watching" (`1 running, 1 watching, 2 done`), while the cell's `finished/total` and pose treat all rows identically — and a **Clear** button: a deck-local wipe of terminal rows only — running rows always survive — disabled when nothing is clearable. Terminology guard: despite the wire's `task_*` spelling these frames are the *jobs* vocabulary, unrelated to the `TaskCreate`/`TaskUpdate` tool calls behind TASKS; deck-side names use the job vocabulary throughout. Layout: TIME / TOKENS narrowed 16ch→12ch to pay for the 14ch JOBS cell; container-query collapse order TIME → TOKENS → TASKS → JOBS (a running job is live signal; the task list is recoverable from the transcript). Originating plan: `roadmap/jobs-tracking.md`. **History.** As first shipped, the gate was flag-only (`run_in_background === true`) and monitors were invisible — an armed watcher had no surface for its entire lifetime until it fired, and no kill switch. The `Monitor` extension (gate, kind, flip exemption, the "watching" summary bucket) came from `roadmap/monitors-in-jobs.md`, pinned against `test-monitor-lifecycle-raw.jsonl`. [D97], [D100], [L02], [L06], [L26]


**D103.** PULSE — app-wide color commentary — **watches the wire**: the commentator narrates from the same session-tagged frames every deck receives, never from a hand-phrased re-telling, displayed as a one-line strip beneath the [D97] `Z2` status row. (The v1 architecture — a route-agnostic `pulse_fact` note-card bus fed by a tugcode producer observing outbound IPC — was retired by `roadmap/pulse-2.md`: every lossy hand-off was a place truth thinned out, and when the untyped observer silently mismatched the wire shape, the speak-pressured model fabricated. Generality was the *cause*: a narrator kept dumb about every route could only eat pre-chewed prose. A truthful Claude-Code-only PULSE beats a general one that lies; future routes integrate via their own tap + digester.) The architecture: **the tap** — tugcast's app-scoped pulse bridge (`feeds/pulse.rs`) subscribes to the shared `CODE_OUTPUT` broadcast and forwards an allowlisted frame subset (`tool_use`, `tool_result`, `assistant_text`, turn boundaries, task/job transitions, `api_retry`, `error`) verbatim to the daemon's stdin, spliced `tug_session_id` intact; `replay_started`/`replay_complete` are consumed bridge-side as a per-session mute set so reconnect floods never re-narrate history; a lagging broadcast receiver drops frames (commentary never backpressures work). The bridge lazily spawns/supervises the daemon, persists its lines in a capped (~200) `pulse_lines` ledger table, and broadcasts them on the `PULSE` feed (`0x80`). A reconnecting deck fetches the recent tail via the `list_pulse_lines` → `list_pulse_lines_ok` CONTROL pair (the `list_session_state_changes` shape — never feed replay), and the daemon re-seeds its inner session from the same tail at spawn. **The line machine** is `tugpulse`, a tugcode-codebase sibling binary that parses the frames with the REAL `OutboundMessage` types (shape drift is a compile error, not a silent starve) and runs a **deterministic per-scope ticker** (`pulse/ticker.ts`) — no model in the loop. (The model-based commentator was built, walked, and retired across nine prompt versions, all recorded in the spike README: when it spoke often it restated the visible transcript; when it spoke rarely it was unpredictable. Color commentary has no stable niche beside a transcript the reader follows natively.) The ticker makes the strip a live "what's happening now" readout — the gap the STATE cell's bare lifecycle word leaves during long turns: the newest started call as its label ("Bash: cargo nextest run"), elapsed refreshes for slow calls (5s/15s/30s/60s then every 30s), failures immediately and always with a real output excerpt, recoveries when a previously-failed call shape goes green ("ok after 1 failed try"), background-job transitions, API-retry strides, and a per-turn summary ("turn: 14 calls, edited reducer.ts, 1 failed — 2m 04s"; a no-tool turn reads "turn: direct reply"). Routine line changes are throttled (~1.5s) per scope so bursts don't strobe; failures, recoveries, jobs, and turn boundaries bypass the throttle. Every line covers exactly one session — attribution by construction. Behavior is rule-shaped and instantly predictable; there is nothing to fabricate and no per-line latency or cost. **One-way isolation is structural**: commentator output flows only deck-ward; no code path leads from the pulse bridge into any session bridge's stdin. **Default ON**, killed by the `dev.tugtool.pulse/enabled` tugbank default (consulted per spawn opportunity — a flip takes effect without a tugcast restart; absent reads enabled). Deck-side, the app-scoped `pulse-store` ([L02]) folds the tail + live frames (rolling cap 20, line-identity dedupe) and surfaces the toggle on its snapshot; `DevPulseStrip` renders the newest line at fixed height with a fade keyed on line identity ([L06]), a dimmed placeholder before the first line, hidden entirely when disabled. Display is PER-CARD: the strip filters the app-wide log to the card's own session via `latestLineForScope` — a new session must never wear another session's commentary (one narrator, per-card display). Every v2 line carries exactly one scope; `"app"`-scoped (or scope-less) lines remain ambience for all cards (a future explicit feature on the same wire). The Shelf/Rack productionization (`roadmap/z2-status-redesign.md`) consumes this store for its PULSE lane and row item. Originating plans: `roadmap/pulse.md` (v1), `roadmap/pulse-2.md` (the wire-tap rework). [D97], [D102], [L02], [L06], [L19], [L20], [L26]
**D104.** Tool-block renderers share three consistency conventions, upheld by authorship and review rather than enforced as tuglaws (they are implementation facts, not locked-in project law). **(1) Status is the dot's; data is the badge's.** Lifecycle (`completed` / `running` / `failed` / `deleted`) is carried by the header's pulsing dot alone ([D02]); a renderer never paints lifecycle text in the detail column or a body field row. The one trailing `resultSummary` badge slot carries *data* — a compact token (`936 lines`, `19 calls`, `exit 0`, `deleted`) — never a sentence; sentence-shaped domain output stays in the body under an honest label (e.g. `result`, not `status`). **(2) One fold per block.** The chrome's whole-block chevron is the single fold whenever the block is collapsible; a body kind shows its own fold cue only where there is no chrome chevron (a nested tool dispatched at `depth + 1`, with no `ToolBlockHistoryCollapse` wrapper). The signal is `BlockFoldSuppressedContext` — truthy means the chrome owns the fold, so the body suppresses its cue. **(3) Streaming body is empty; the dot is the signal.** Per [D02] a streaming tool passes `body = null`; there is no shared `StreamingPlaceholder` (it was specified but never built, and the docstrings that named it were swept). The lone exception is the Agent block, whose `AgentWorkingBody` fills its uniquely long working window with calm, non-animated content (not a competing status signal). Originating plan: `roadmap/tool-block-renderers.md`. [D02], [D05], [L06], [L20]

---

## Dev Prompt Entry

**D98.** Host facts — the backend's network `hostname` and the basename of its login shell — are resolved by tugcast and served at a read-only `GET /api/host` endpoint, then read into tugdeck's `HostFactsStore` through `useSyncExternalStore`. The browser cannot know the backend's real hostname or `$SHELL` (`window.location.hostname` is only the URL host), and the facts are static for a server's lifetime, so the store fires the fetch exactly once and caches the result. The endpoint is loopback-restricted like the other `/api` handlers; the response shape `{ hostname, shell }` is a cross-stack contract, pinned by a Rust serialization test and a `bun:test` parser test. A failed or pending fetch leaves the store empty, and consumers treat an empty snapshot as "not yet known." [L02]

**D99.** Each Dev prompt entry owns a `RouteLifecycle` — a per-prompt-entry pipe that holds the authoritative command route (`❯` Code / `$` Shell) and announces every change. It offers two surfaces over one fire path: a store surface (`subscribe` + `getRoute`) that renderers read through `useSyncExternalStore` ([L02]), and a synchronous delegate/observer surface (`observeRouteWillChange` / `observeRouteDidChange`, `useRouteDelegate`) for imperative reactors. The route is no longer component `useState`: once it has a consumer outside the component that owns it, it is external state and must enter React through `useSyncExternalStore`. Unlike the deck-level `CardLifecycle`, `RouteLifecycle` is scoped per prompt entry, provided through `RouteLifecycleContext`, surfaces a single `(prev, next)` will/did pair, and dispatches synchronously — route consumers re-render content and have no gesture-focus-lock hazard, so there is no `MessageChannel` drain. See [route-lifecycle.md](route-lifecycle.md). [L02], [L03]

---

## Onboarding & Setup

**D105.** TugSetup — the app-modal onboarding wizard (`tug-setup.tsx`, [#step-9] of `roadmap/onboarding-and-install.md`) — renders as an ordered list of **step rows**, each a **bespoke row** (not a transcript `BlockChrome` [D104]): a left-hand `TugProgressIndicator variant="pulsing-dot"` whose role+state encode the step's lifecycle ([D02]), a requirement/direction **label**, a **detail** line carrying state/progress/completion, and an optional **CTA**. The block shell was evaluated and rejected for this surface — its tool-name/result-summary/copy/chevron affordances are transcript baggage a setup step does not want; the bespoke row keeps the wizard's own rhythm. A step's status is one of `pending | active | busy | error | done`, mapping to the dot as: `pending`→`inherit/stopped` (row dimmed), `active`→`action/running`, `busy`→`agent/running`, `error`→`danger/aborted`, `done`→`success/completed`. The pulsing dot is the *only* role tone on the row; the label/detail inherit panel text ([D104] convention 1 — status is the dot's). The design spike that fixes this surface's copy and rhythm without a clean guest is the **`gallery-tug-setup`** card (`gallery-tug-setup.tsx`), which simulates every state below from local state — it never touches the real `authStore`.

**Flow.** Three steps, each gated on the one before, fed by the app-level `authStore` ([L02]) plus the deck card count:

```
   (first launch) ──▶ PROBING  "Checking your setup…"
                          │
   STEP 1 ── Install Claude Code   (label flips to "Claude Code installed" on done)
     active (Install) ─▶ busy (Installing…) ─▶ done ✓
                    └─▶ error (Retry) ─┘
                          │ done
   STEP 2 ── Log in to Claude
     active (Log In) ─▶ busy (Logging in…) ─▶ done ✓
                    └─▶ error (Try Again) ─┘
                          │ done
   STEP 3 ── Start a Claude Code session   (success/transition button)
     active (Open a Dev Card) ─▶ opens first card ─▶ wizard dismisses

   Transport down (replaces body): a "Reconnecting…" step row
   Sibling app-modal (wins):       VERSION TOO OLD → TugVersionGate ([#step-7])
```

**Per-state copy (what we show & say).** Label is the requirement/direction; detail is the state/progress/completion line. A `busy` step keeps a **disabled** CTA (not hidden) so the row doesn't empty out; a `done` step swaps the CTA for a green success check (✓):

| Step | Status | Dot (role/state) | Label | Detail | CTA |
|---|---|---|---|---|---|
| — | probing | agent / running | Install Claude Code | "Looking for Claude Code…" | — |
| 1 | active | action / running | Install Claude Code | "Tug will install it for you." | **Install** |
| 1 | busy | agent / running | Install Claude Code | "This can take a moment." | *Installing…* (disabled) |
| 1 | error | danger / aborted | Install Claude Code | "Install failed: \<error\>" | **Retry** |
| 1 | done | success / completed | Claude Code installed | "Claude Code is ready." | ✓ |
| 2 | active | action / running | Log in to Claude | "Tug runs sessions with your Claude subscription." | **Log In** |
| 2 | busy | agent / running | Log in to Claude | "Use your browser to log in…" | *Logging in…* (disabled) |
| 2 | error | danger / aborted | Log in to Claude | "Log-in didn't finish. The browser may have been closed." | **Try Again** |
| 2 | done | success / completed | Logged in as \<email\> | "Claude \<Tier\> plan" | ✓ |
| 3 | pending (no cards) | inherit / stopped | Start a Claude Code session | — | — |
| 3 | pending (cards open) | inherit / stopped | Continue working | "You'll return to your \<N\> open cards." | — |
| 3 | active | action / running | Start a Claude Code session | "Open a Dev card to get started" | **Open a Dev Card** |
| 3 | done | success / completed | Start a Claude Code session | "Opening Dev card…" | ✓ |
| — | transport down | agent / running | Reconnecting… | "Lost the connection to Tug. Setup will resume automatically." | — |

The step-3 pending row previews the return to work while the user is still logged out (the "Continue working" case, [P04] of `roadmap/logout-consolidation.md`): with cards open, re-login auto-closes the wizard straight back to them (the `open` derivation is `notReady || needsFirstSession`, which goes false the instant a logged-in deck has cards), so the preview lives in the logged-out window rather than as an active step. The `pendingOpenStepCopy` helper (`tug-setup-copy.ts`, unit-tested) owns the label/detail branch on card count.

**Verbiage.** Tug uses the consistent **"Log in" / "Log out"** pair for the account action (the `claude` CLI itself says "Sign in"/"Log out" — inconsistent; Tug does not follow it). The `subscriptionLabel` helper (`tug-setup-copy.ts`, unit-tested) formalizes the tier as "Claude Max plan" etc. **Logout** reopens this same wizard: an app-level "Log out…" (File menu + `/logout`) confirms via TugAlert, interrupts every in-progress turn **first** (each tagged `interrupt("logout")` so its Z1B end-state reads "Stopped — logged out"), then runs `claude_logout`, and flips `authStore` logged-out so TugSetup returns to the Log-in step (a failed/timed-out logout surfaces a "Couldn't log out" alert and leaves the user logged in). The `TugLogout` orchestrator (deck-root sibling) owns that flow.

**One login surface.** TugSetup is the *only* login UI. There is no per-card in-card sign-in: when a card's session hits the auth gate (`auth_required` / `claude_missing`), the observer re-probes `check_auth` (flipping `authStore` logged-out → TugSetup opens app-modal) and unbinds the card to its picker with a `signed_out` notice, so the user re-logs-in once in the wizard and resumes per card from the picker. See `roadmap/logout-consolidation.md`.

**Resolved design questions.** **(1) "Open your first session" is a success/transition button, not a probed step** — its CTA opens the first Dev card and the wizard dismisses. That first card seeds its **Project Path to the user's home directory** (a sensible from-the-drop default; the user re-points it afterward). **(2) The step row is bespoke** (above) — `BlockChrome` was evaluated and rejected. **(3) Probing / first-launch:** on a user's *first* launch TugSetup shows **up front and immediately** (it does not wait to probe behind a blank deck). This is governed by a persisted **first-launch flag** stored via tugbank defaults (`/api/defaults/…`, never `localStorage`); the flag is set once the user has launched the first time, so subsequent launches fall through to the normal probe-then-decide path. **(4) Transport-down** replaces the wizard body with a calm "Reconnecting…" takeover rather than a dead wizard; **version-too-old** is the sibling app-modal `TugVersionGate` ([#step-7], Spec S02) which takes precedence over TugSetup. The unhappy-path states (install-fail, sign-in cancel/timeout, transport-down) are designed in [#step-10]; this decision fixes their copy and visual grammar. [D02], [D104], [L02], [L06]
