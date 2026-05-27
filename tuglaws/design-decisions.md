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

**D95.** A content-owning + engine card has exactly one text-entry surface — the engine's editor (`tug-prompt-entry` for a tide card) — and activation focus has exactly one destination: the engine. A content-owning card (`bag.content !== undefined` — every tide card is one) carries no `data-tug-focus-key` / `data-tug-state-key` element of its own, so `captureFocus` only ever classifies its focus as `engine` or `none`; the framework-axis save site leaves `bag.focus` absent in both cases. On restore, the single-channel dispatcher `resolveBagFocus` finds no framework-axis snapshot but an engine-managed `componentId`, and routes to the `engine` resolution — `applyBagFocus` invokes the engine's registered `paintMirrorAsActive` hook (`store.registerEngineHooks` / `store.invokeEnginePaintMirrorAsActive`). The engine is a *callable*, not an autonomous claimant: it no longer claims focus from `onCardActivated`. Focusable-but-not-entry content inside the card (a read-only `TugCodeView` viewport, a block button) carries no focus marker, so `captureFocus` classifies it `none` and activation focus correctly returns to the engine — a viewer is not a text-entry surface, and transient selection-to-copy focus is not preserved across activation. The general framework focus axis (`data-tug-focus-key` / `data-tug-state-key`, the `dom` / `form-control` `FocusSnapshot` kinds) still serves non-engine cards (form-control cards, settings cards); it is simply never populated *inside* a content-owning + engine card. See [state-preservation.md § Focus dispatch model](state-preservation.md#focus-dispatch-model), [component-authoring.md § Focus in content-owning cards](component-authoring.md), `card-host.tsx` (`captureFocus`), and `focus-transfer.ts` (`resolveBagFocus` / `applyBagFocus`). Established by Phase E.11 (single-channel dispatcher) and Phase E.12 (single-text-entry rule; per-block Find removed). Supersedes the pre-E.11 framing of this decision (the engine-vs-framework "two axes" model with `kind: "component-owned"` and `resolveActivationTarget`). Previously documented inline as `[D07]` in `card-host.tsx` comments — that local tag has been normalized to reference this decision (the canonical D07 is the JSX-composition rule above; the focus-boundary rule is D95). [L23]

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

**D97.** The tide card is partitioned into **six placement zones, `Z0`-`Z5`, numbered spatially top-to-bottom**, with `Z1` subdivided into per-turn `Z1A` / `Z1B` and a per-row `Z1C` indicator zone, and `Z4` subdivided into two prompt-entry toolbar sub-slots, `Z4A` and `Z4B`. Each zone is an addressable region the telemetry renderers and the assistant-rendering registry target by ID. Most are `ReactNode` slot props on a host component; `Z5` is a state-coordinated interactive area rather than a content slot. `Z4A` and `Z4B` are *layout positions* — a leading-fixed slot and a centred-floating slot — whose occupants the toolbar assigns and is free to swap (below). Spatial numbering means any zone is findable by intuition, and a future zone inserts at its position with a clean downstream renumber — `Z0` is unambiguously "what you see first."

```
┌─ tide card · transcript pane ────────────────────────────────────────────────┐
│ Z0   top of card — reserved (empty until its slot is filled)                 │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│ TideTranscriptHost  →  TugListView          scrolls · flex 1 1 auto          │
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
│ Z2  [grip] STATE · TIME · TOKENS · TASKS · CONTEXT                [maximize] │
│            (TASKS cell, per [D100], collapses when no active task list)      │
│      flex 0 0 auto · never scrolls · sits outside TugListView                │
└──────────────────────────────────────────────────────────────────────────────┘
             ↑↓  split-pane sash — transcript / prompt-entry resize
┌─ tide card · prompt-entry pane ──────────────────────────────────────────────┐
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
| `Z0` | `TideCard` · `headerContent` | — | reserved — empty |
| `Z1` | transcript row · `renderTurnTrailing`, keyed by `half` | user half: —; assistant half: `Z1A` model · timestamp + `Z1B` end-state aggregate | user half reserved; assistant half shipped |
| `Z1B` | per-turn end-state aggregate in `TugTranscriptEntry`'s `controls` slot — the OK / interrupted / error / transport_lost badge, per-turn token count, per-turn wall-clock, whole-turn COPY. Rendered by `TideZ1B`. The slot collapses to zero height (no `min-height`) when there is no end-state to show (in-flight rows). | rendered when the committed turn has an assistant-side Message (per Step 5.6 [Decision F](../roadmap/tugplan-tide-session-wake.md#step-5-6)). NOT rendered for a turn that committed with only a `user_message` (interrupted-before-response) — the user_message row's own static "OK" footer is the only chrome. NEVER multiplexes the in-flight indicator (Z1C owns that) | shipped under Step 5.6 |
| `Z1C` | per-row in-flight indicator zone in `TugTranscriptEntry`'s new `inflightFooter` slot — sandwiched between the body and the `controls` slot. *Every* `TugTranscriptEntry` carries the slot uniformly; the slot collapses to zero height when `inflightFooter={null}`. NOT a list row; adds nothing to `totalRows`; no scroll-to-row helper needs to skip it; no React key churn. | `TideZ1C` — only the **in-flight-tip row** mounts an active Z1C with a `useSyncExternalStore` subscription to a memoized `{phase, interruptInFlight}` selector; all other rows pass `null` to the slot and stay subscription-free. Indicator content (visible glyph is the three-bar `TugThinkingIndicator` with `labelPosition="hidden"`; phase label rides on `aria-label`) resolves via `tideZ1CContent(phase, interruptInFlight)` — returns the indicator for `submitting` / `awaiting_first_token` / `streaming` / `tool_work` / `waking`; returns `null` (slot collapses) for `awaiting_approval` (the pending dialog *is* the affordance), `interruptInFlight === true` (interrupt is instant from the user's POV — Z1B paints the end-state once the turn commits), and `idle` / `replaying` / `errored`. In Step 5.8 the in-flight tip is the in-flight code row (`!isCommitted`); in Step 5.9 it is the row carrying the Message flagged `isLastInflightMessage`. Position inherits from the row body's indent and footer placement — no absolute positioning. | shipped under Step 5.8 |
| `Z2` | `TideCard` · `statusBarContent` | `TideTelemetryStatusRow` — STATE · TIME · TOKENS · TASKS · CONTEXT cells, flanked by the leading sash grip and the trailing maximize toggle. The `TASKS` cell (per [D100]) renders a `TugProgress` ring + `N/M` label that drives a popover composed of `TugTaskItem` rows; the cell shows `None` when no task list is active. | shipped |
| `Z3` | `TugPromptEntry` · `statusContent` + `cautionContent` | — (the tide card no longer fills it) | reserved — collapsed |
| `Z4A` | `TugPromptEntry` toolbar — leading, fixed | route choice-group (`Code` / `Shell`) | shipped |
| `Z4B` | `TugPromptEntry` toolbar — centred, floating | `indicatorsContent` — project-path + Claude Code badges | shipped |
| `Z5` | `TugPromptEntry` submit button (no slot) | lifecycle-driven Submit / Stop / Awaiting / Stopping / Reconnecting | shipped |

The transcript pane (the upper `TugSplitPanel`) is a flex column — `Z0` header, `TugListView` (`flex 1 1 auto`, scrolls), with `TideJumpToBottomButton` as floating chrome anchored at the list's bottom edge, and `Z2` status bar — so a telemetry update in `Z2` grows into space the list cedes without repositioning the scroll, and `Z2`, living *outside* `TugListView`, never scrolls with the transcript. `Z1` is per-turn rather than card-level: one trailing slot wired twice per turn (`half: "user" | "assistant"`), spatially inside the transcript pane between `Z0` and the `Z2` row. `Z1B` (the per-turn end-state aggregate) and `Z1C` (the per-row in-flight indicator zone) are intentionally separate sub-zones — `Z1B` lives in `TugTranscriptEntry`'s `controls` slot (collapses to zero when empty); `Z1C` lives in `TugTranscriptEntry`'s new `inflightFooter` slot, sandwiched between the body and `controls` (every row carries the slot uniformly; only the in-flight-tip row mounts a Z1C that subscribes to phase and paints the indicator; all other rows pass `null` and the slot collapses). The pre-Step-5.6 `Z1B` multiplexed both responsibilities ("indicator ↔ end-state display") inside one component; under per-Message rows the multiplex is structurally awkward, so the two responsibilities split into two `TugTranscriptEntry` slots with disjoint domains and independent collapse rules. An earlier revision of `Z1C` placed it as transcript-level chrome below `TugListView`; that ended up marooned at the bottom of the pane instead of at the in-flight row's footer, so the design moved to a per-row slot that inherits position from the row body's indent for free. `Z5` is the submit button — a single DOM node whose label / `disabled` / `data-mode` are driven by the lifecycle state machine and which is never swapped across mode transitions, per [L26].

The prompt-entry toolbar lays out three zones in one flex row. `Z4A` sits at the leading edge and `Z5` (the submit button) at the trailing edge — both fixed and content-sized; `Z4B` floats centred between them, two equal flex spacers splitting the free width so `Z4B`'s centre lands at the midpoint of the `Z4A`–`Z5` gap. `Z4A` and `Z4B` are *positions*, not component assignments: the toolbar fills them with the route choice-group and the indicator cluster (the `indicatorsContent` slot — the project-path and Claude Code badges, the identity chrome naming the prompt entry's target), and which occupant takes which position is a layout decision free to change. Today the route choice-group sits in `Z4A` and the indicator cluster in `Z4B`. The maximize toggle and the prompt-area sash grip are card chrome, not zone occupants — both sit in the `Z2` status bar (grip on the leading edge, maximize on the trailing edge), which is why the `Z3` prompt-entry status row, once home to the badges and the toggle, is now empty and collapsed.

A zone's *location* is contract; its *occupant* is not — every zone is a generic addressable slot. `Z0`, the `Z1` user half, and `Z3` are reserved: the slot exists in the API, default content is `null`, and the row collapses to zero height until something fills it (the tide card leaves `Z3` empty today, so its row has no height). `Z1C` is a per-row `inflightFooter` content slot on `TugTranscriptEntry`: every row carries it uniformly and the slot collapses to zero when passed `null`; only the in-flight-tip row passes a live `TideZ1C` instance. Established by the Step 20.x turn-surface work (archived as `roadmap/archive/tide-assistant-turns.md`); `Z3`'s `cautionContent` slot was added by the assistant-rendering drift-detection work; the `Z4A` / `Z4B` split and the `Z2` chrome relocations came from the prompt-entry-zones work (`roadmap/tugplan-tide-prompt-entry-zones.md`); the `Z1B` / `Z1C` split (separating per-turn end-state from per-row in-flight indicator) came from Step 5.6 of the tide-session-wake work (`roadmap/tugplan-tide-session-wake.md`) under the per-Message render-layout refactor and was reshaped in Step 5.8 from "transcript-level chrome below `TugListView`" into the per-row `inflightFooter` slot after the transcript-level placement marooned the indicator at the pane's bottom edge. [L06], [L26]

**D100.** The active task list surfaces as a `TASKS` cell on the [D97] `Z2` status bar — not inline in the assistant turn(s) that issued each call, and not as a separate sub-zone. Anthropic's `claude` ≥ `v2.1.148` replaces the old `TodoWrite` tool (single call carrying the canonical list) with a per-item CRUD family — `TaskCreate` (one call per task; the server assigns a monotonic `taskId`) and `TaskUpdate` (`{ taskId, status }` flips one task's status). A typical session produces ~3× more events than the old `TodoWrite` did (4 × `TaskCreate` up front + 8 × `TaskUpdate` interleaved for a 4-item list is representative), so inline-per-turn rendering would litter the transcript with a status-flip per row; the status-bar cell keeps the live picture one fixed glance away without claiming separate vertical real estate. The cell renders a `TugProgress` ring + `N/M` label (`done` over `total`) inside `TideTelemetryStatusRow` alongside `STATE` / `TIME` / `TOKENS` / `CONTEXT`; clicking it opens a popover whose body is a vertical stack of `TugTaskItem` rows (one per task, status-driven indicator + `subject`, with the optional `description` surfacing in a `TugTooltip` on hover). When no task list is active the cell still occupies its reserved width but reads `None` (dimmed) and the ring is suppressed — the layout stays anchored so the surrounding cells never reflow. When the session is `idle`, the ring renders in its `stopped` state (closed outlined circle, no animation) in both the cell and the popover, so motion implies ongoing work and stillness implies it is over. The cell is fed by a pure reducer — `reduceTaskListState(toolCalls): TaskListState` in `select-task-list.ts` — that folds the event stream by walking `transcript[].toolCalls[]` then the in-flight `toolCallMap`'s values in order, appending one `TaskItem` per `TaskCreate` (with `status: "pending"` and `taskId` parsed from the `tool_result.content` "Task #N created successfully:" echo, falling back to monotonic count) and mutating-by-id for each `TaskUpdate`; only terminal (`status: "done"`) calls fold so an in-flight `TaskCreate` with no assigned id yet is skipped until its `tool_result` lands. The cell renderer reads through `useTaskListState` (a `useSyncExternalStore` hook per [L02]) and the popover composes `TugTaskItem` primitives directly, with role-driven accent colors (in-progress rows use `TugProgress role="action"` + `TugLabel role="action"`; completed rows use `--tugx-task-item-success-color` on the check glyph) so the surface picks up standard tone tokens instead of bespoke aliases. No wire-level clear event exists; the list lives for the session, and the active rule (non-empty list with at least one non-completed item) governs the `N/M` vs `None` reading. Session clear (`/clear`) resets the cell by way of resetting the store. The TASKS cell is the canonical surface for *current state* — the assembled list, one fixed glance away. The transcript carries per-call inline markers via `TaskInlineToolBlock` — a tiny `<ListChecks size=14>` + `<TugLabel size="sm" emphasis="calm">` row for each `TaskCreate` and `TaskUpdate` event (`"Created: <subject>"` / `"Started: <subject>"` / `"Completed: <subject>"`), so a reader scrolling the transcript can see *when in the conversation flow* each task action happened. The two surfaces never duplicate work: the cell answers "what's on the list now?"; the marker answers "when did this happen?". The marker uses the `calm` emphasis (italic + muted gray) so every row reads as ambient annotation subordinate to the TASKS cell — color is reserved for the rare error case (`role="danger"`, `emphasis="normal"`). The marker intentionally carries no `ToolBlockChrome` — no frame, no status stripe, no error band — so it stays inline-flow, not another tool-call card competing with the cell for attention. The dead `registerToolBlock("todowrite", …)` entry is removed; the original Step 24's inline `TodoWriteToolBlock` was already silent on every `v2.1.148+` session — `TodoWrite` is no longer emitted — so the broader rework is also a correctness fix, not just a UX one.

**History.** D100 originally specified a separate pinned sub-zone — `Z2A` (leading-fixed) paired with a renamed `Z2B` (trailing). That iteration shipped briefly (a `TideCardPinnedTodo` renderer + `statusBarLeadingContent` prop), but produced too much vertical-layout shift and broke the cell-row rhythm of `Z2`. The decision was reverted to single `Z2` + the `TASKS` cell described above; the `Z2A` / `Z2B` split is no longer present in the code, and D97's zone table reflects single-`Z2`. The original artifacts (`TideCardPinnedTodo`, `statusBarLeadingContent`, `--tugx-pinned-todo-*` tokens, `:has()`-based collapse) were removed. [D97], [L02], [L06], [L20]

**D101.** Tool visibility in the Tide transcript is classified by a single editable policy table — `TOOL_VISIBILITY_POLICY` in `tugdeck/src/components/tugways/cards/tide-tool-visibility-policy.ts` — with three buckets and one source-of-truth rule per bucket. **Bespoke** is implicit: a tool has a bespoke wrapper iff it is registered in `TOOL_BLOCK_REGISTRY` via the dispatch's bottom-of-file `registerToolBlock(...)` calls (the `BESPOKE_REGISTRATIONS` array exported as `BESPOKE_TOOL_NAMES`). Bespoke names MUST NOT appear in the policy table — that would be a double-classification, caught by the governance test. **Hidden** is explicit: the policy table's `hidden` entries map to a shared exported `NullToolBlock` via two short-circuits — `resolveToolBlock` returns `NullToolBlock` for any hidden name ahead of the registry lookup, and `detectToolCallDrift` exempts hidden names from the `unknown_tool` check. Hidden is for control-channel machinery the user does not need to see (`ToolSearch`, `ScheduleWakeup`, `EnterPlanMode`, `ExitPlanMode`, `PushNotification`) or for tools whose surface lives elsewhere (`TaskCreate` / `TaskUpdate` per [D100] — the TASKS status-bar cell is the sole surface). **Default-intent** is explicit: the policy table's `default-intent` entries become `AUDIT_CONFIRMED_DEFAULT_TOOLS`, routing through `DefaultToolBlock` (the JsonTree fallback) with no `unknown_tool` caution. Every `default-intent` entry's `rationale` MUST cite the follow-on step's `#step-` anchor — the governance test enforces it, so a default-intent entry is always an *explicit TODO* with a planned bespoke wrapper, never a forever-bucket. The governance test (`__tests__/tide-tool-visibility-policy.test.ts`) pins the two invariants that catch real mistakes code review would miss: (c) every `default-intent` entry's rationale contains `"Awaiting"` and `"#step-"` — the only mechanism preventing `default-intent` from becoming a forever-bucket; and (d) the union of bespoke + policy covers the v2.1.148 canonical tool set — so a new Claude Code tool in a future release fails CI until it is explicitly classified. Shape / parse / no-double-classification checks were considered and intentionally not landed: the entry shape is enforced by the `ToolVisibilityEntry` interface, and double-classification is rare-and-obvious enough that code review is the right gate. MCP (`mcp__*`) is intentionally excluded from the policy per the project's MCP non-goal — `mcp__*` names route through `DefaultToolBlock` and produce `unknown_tool` cautions; the caution count is the deferral's signal. Moving a tool between buckets is a one-line policy edit; promoting to bespoke means a new `registerToolBlock` call + removing the policy entry. [D04], [D11], [D100]

---

## Tide Prompt Entry

**D98.** Host facts — the backend's network `hostname` and the basename of its login shell — are resolved by tugcast and served at a read-only `GET /api/host` endpoint, then read into tugdeck's `HostFactsStore` through `useSyncExternalStore`. The browser cannot know the backend's real hostname or `$SHELL` (`window.location.hostname` is only the URL host), and the facts are static for a server's lifetime, so the store fires the fetch exactly once and caches the result. The endpoint is loopback-restricted like the other `/api` handlers; the response shape `{ hostname, shell }` is a cross-stack contract, pinned by a Rust serialization test and a `bun:test` parser test. A failed or pending fetch leaves the store empty, and consumers treat an empty snapshot as "not yet known." [L02]

**D99.** Each Tide prompt entry owns a `RouteLifecycle` — a per-prompt-entry pipe that holds the authoritative command route (`❯` Code / `$` Shell) and announces every change. It offers two surfaces over one fire path: a store surface (`subscribe` + `getRoute`) that renderers read through `useSyncExternalStore` ([L02]), and a synchronous delegate/observer surface (`observeRouteWillChange` / `observeRouteDidChange`, `useRouteDelegate`) for imperative reactors. The route is no longer component `useState`: once it has a consumer outside the component that owns it, it is external state and must enter React through `useSyncExternalStore`. Unlike the deck-level `CardLifecycle`, `RouteLifecycle` is scoped per prompt entry, provided through `RouteLifecycleContext`, surfaces a single `(prev, next)` will/did pair, and dispatches synchronously — route consumers re-render content and have no gesture-focus-lock hazard, so there is no `MessageChannel` drain. See [route-lifecycle.md](route-lifecycle.md). [L02], [L03]
