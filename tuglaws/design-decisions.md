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

**D96.** **Any code path that lands a `TurnEntry` on `state.transcript` must also seed the per-turn `streamingDocument` paths (`turn.${turnKey}.{assistant,thinking,tools}`) from the entry's payload.** This is the write-side counterpart to [L26]'s post-unification render contract: the assistant row's `CodeRowCell` observes `turn.${turnKey}.${channel}` exclusively (no fallback to `TurnEntry.*` fields), so a turn that exists on the snapshot but whose per-turn paths are empty renders blank — a textbook [L23] violation. Today the only such code path is `code-session-store/reducer.ts`'s `append-transcript` effect, paired with the `write-inflight` effects emitted by `handleTextDelta` / `handleToolUse` / `handleToolResult` / `handleToolUseStructured` for both live and replay events (the live↔replay symmetry restored by Step 18.9). Any future analogue — out-of-band ingestion, server-pushed transcript snapshot, debug-tool import, hot-reload state restore — must replicate the seeding using `serializeToolCalls` (`reducer.ts`) for the tools channel and the raw string for assistant/thinking. The reducer's pattern is the reference implementation; deviating from it without seeding strips the corresponding content from every rendered cell that comes through the alternate path. [L23], [L26]

**D97.** The tide card is partitioned into **six placement zones, `Z0`-`Z5`, numbered spatially top-to-bottom**, with `Z4` subdivided into two prompt-entry toolbar sub-slots, `Z4A` and `Z4B`. Each zone is an addressable region the telemetry renderers and the assistant-rendering registry target by ID. Most are `ReactNode` slot props on a host component; `Z5` is a state-coordinated interactive area rather than a content slot. `Z4A` and `Z4B` are *layout positions* — a leading-fixed slot and a centred-floating slot — whose occupants the toolbar assigns and is free to swap (below). Spatial numbering means any zone is findable by intuition, and a future zone inserts at its position with a clean downstream renumber — `Z0` is unambiguously "what you see first."

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
│   │ [copy]                                    Z1B  indicator ↔ end-state │   │
│   └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Z2   [grip]  STATE · TIME · TOKENS · CONTEXT                      [maximize] │
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
| `Z1` | transcript row · `renderTurnTrailing`, keyed by `half` | user half: —; assistant half: `Z1A` model · timestamp + `Z1B` thinking-indicator ↔ end-state display | user half reserved; assistant half shipped |
| `Z2` | `TideCard` · `statusBarContent` | `TideTelemetryStatusRow` — STATE · TIME · TOKENS · CONTEXT, flanked by the leading sash grip and the trailing maximize toggle | shipped |
| `Z3` | `TugPromptEntry` · `statusContent` + `cautionContent` | — (the tide card no longer fills it) | reserved — collapsed |
| `Z4A` | `TugPromptEntry` toolbar — leading, fixed | route choice-group (`Code` / `Shell`) | shipped |
| `Z4B` | `TugPromptEntry` toolbar — centred, floating | `indicatorsContent` — project-path + Claude Code badges | shipped |
| `Z5` | `TugPromptEntry` submit button (no slot) | lifecycle-driven Submit / Stop / Awaiting / Stopping / Reconnecting | shipped |

The transcript pane (the upper `TugSplitPanel`) is a flex column — `Z0` header, `TugListView` (`flex 1 1 auto`, scrolls), `Z2` status bar — so a telemetry update in `Z2` grows into space the list cedes without repositioning the scroll, and `Z2`, living *outside* `TugListView`, never scrolls with the transcript. `Z1` is per-turn rather than card-level: one trailing slot wired twice per turn (`half: "user" | "assistant"`), spatially inside the transcript pane between `Z0` and `Z2`. `Z5` is the submit button — a single DOM node whose label / `disabled` / `data-mode` are driven by the lifecycle state machine and which is never swapped across mode transitions, per [L26].

The prompt-entry toolbar lays out three zones in one flex row. `Z4A` sits at the leading edge and `Z5` (the submit button) at the trailing edge — both fixed and content-sized; `Z4B` floats centred between them, two equal flex spacers splitting the free width so `Z4B`'s centre lands at the midpoint of the `Z4A`–`Z5` gap. `Z4A` and `Z4B` are *positions*, not component assignments: the toolbar fills them with the route choice-group and the indicator cluster (the `indicatorsContent` slot — the project-path and Claude Code badges, the identity chrome naming the prompt entry's target), and which occupant takes which position is a layout decision free to change. Today the route choice-group sits in `Z4A` and the indicator cluster in `Z4B`. The maximize toggle and the prompt-area sash grip are card chrome, not zone occupants — both sit in the `Z2` status bar (grip on the leading edge, maximize on the trailing edge), which is why the `Z3` prompt-entry status row, once home to the badges and the toggle, is now empty and collapsed.

A zone's *location* is contract; its *occupant* is not — every zone is a generic addressable slot. `Z0`, the `Z1` user half, and `Z3` are reserved: the slot exists in the API, default content is `null`, and the row collapses to zero height until something fills it (the tide card leaves `Z3` empty today, so its row has no height). Established by the Step 20.x turn-surface work (archived as `roadmap/archive/tide-assistant-turns.md`); `Z3`'s `cautionContent` slot was added by the assistant-rendering drift-detection work; the `Z4A` / `Z4B` split and the `Z2` chrome relocations came from the prompt-entry-zones work (`roadmap/tugplan-tide-prompt-entry-zones.md`). [L26]

**D100.** The active TodoWrite list lives in a single pinned slot — `Z2A`, the leading sub-slot of the [D97] `Z2` status bar — not inline in the assistant turn that issued each call. TodoWrite calls replace the list whole-cloth, so inline-per-turn rendering reprints the same list once per call and forces the user to scroll past `N-1` stale copies to find the current state; pinning the latest call's list keeps the active todos one fixed glance away. `Z2A` is leading-fixed and `Z2B` is the existing trailing status-row content (`TideTelemetryStatusRow`); the leading sash grip and the trailing maximize toggle remain card chrome and bookend the pair, matching D97's `Z4A` / `Z4B` sub-slot convention. A code-session-store selector walks `transcript[].toolCalls[]` + the in-flight `toolCallMap` and returns the most recent TodoWrite call's `input`; the `Z2A` renderer is a standalone `TodoListBlock` driven by that selector through `useSyncExternalStore` ([L02]). The slot is *active* — and therefore visible — only when the selector returns a non-empty list with at least one non-completed item; otherwise the renderer returns `null` and `Z2A` collapses to zero height via `:empty` ([L06]). Session clear (`/clear`) resets `Z2A` by way of resetting the store; any wire-level clear mechanism (TBD by the Step 24.1 spike) flows through the same selector. The inline-per-turn `TodoWriteToolBlock` shipped in the original Step 24 is removed; the renderer dispatch either unregisters `todowrite` or registers a null renderer so the transcript carries no per-call entries for it. [D97], [L02], [L06]

---

## Tide Prompt Entry

**D98.** Host facts — the backend's network `hostname` and the basename of its login shell — are resolved by tugcast and served at a read-only `GET /api/host` endpoint, then read into tugdeck's `HostFactsStore` through `useSyncExternalStore`. The browser cannot know the backend's real hostname or `$SHELL` (`window.location.hostname` is only the URL host), and the facts are static for a server's lifetime, so the store fires the fetch exactly once and caches the result. The endpoint is loopback-restricted like the other `/api` handlers; the response shape `{ hostname, shell }` is a cross-stack contract, pinned by a Rust serialization test and a `bun:test` parser test. A failed or pending fetch leaves the store empty, and consumers treat an empty snapshot as "not yet known." [L02]

**D99.** Each Tide prompt entry owns a `RouteLifecycle` — a per-prompt-entry pipe that holds the authoritative command route (`❯` Code / `$` Shell) and announces every change. It offers two surfaces over one fire path: a store surface (`subscribe` + `getRoute`) that renderers read through `useSyncExternalStore` ([L02]), and a synchronous delegate/observer surface (`observeRouteWillChange` / `observeRouteDidChange`, `useRouteDelegate`) for imperative reactors. The route is no longer component `useState`: once it has a consumer outside the component that owns it, it is external state and must enter React through `useSyncExternalStore`. Unlike the deck-level `CardLifecycle`, `RouteLifecycle` is scoped per prompt entry, provided through `RouteLifecycleContext`, surfaces a single `(prev, next)` will/did pair, and dispatches synchronously — route consumers re-render content and have no gesture-focus-lock hazard, so there is no `MessageChannel` drain. See [route-lifecycle.md](route-lifecycle.md). [L02], [L03]
