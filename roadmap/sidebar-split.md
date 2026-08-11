<!-- devise-skeleton v4 -->

## Sidebar Split — user-controlled vertical division of shared sidebar rails {#sidebar-split}

**Purpose:** Ship per-side rail splitting: a shared sidebar rail (2+ sidebar cards on one side) can be switched from today's front-to-back stack to a vertical split where every member is visible, with a draggable seam between members, drag-to-reorder within the rail, and controls in the stack badge and the Lens Layout section. Stack remains the default; the imposer's width model, allocator, and horizontal geometry are untouched.

Companion brief: `roadmap/sidebar-split-brief.md` (the decided design this plan implements).

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-08-11 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Same-side sidebar cards (Lens, Jots, Gazette — the three `layoutRole: "sidebar"` registrations) today get byte-identical frames from `imposeSidebarStyle(side, paneWidth)` (`tugdeck/src/lib/layout-imposer.ts`): same pin, same shared width property, same full vertical run (`top: 5px`, `bottom: 32px`). They stand front-to-back in the sidebar z-band (`SIDEBAR_PANE_ZINDEX_BASE = 8990`, `deck-canvas.tsx`), only the topmost visible, reached through the title-bar stack badge picker.

This is the second lived verdict on this surface. An automatic vertical split was tried first and rejected ("a worse Lens" — the doc comment above `imposeSidebarStyle`, and the dropped `order` field in `serialization.ts`'s `parseSidebars` is its fossil). The occlusion stack shipped instead, the user lived on it, and it too has been found wanting: it hides content the user wants visible at once. The synthesis both verdicts point at: splitting must be a **choice the user makes, per side**, with the stack remaining the default. That is this phase.

#### Strategy {#strategy}

- Extend the model additively: a per-side `RailArrangement { mode, order, shares }` on `DeckImposition.rails`, keyed by side, with shares as per-componentId weights so membership churn can never misalign heights.
- Keep the load-bearing invariant: live window resize runs no JavaScript. Split-member vertical geometry is `calc()` over per-side seam custom properties, written by the same `deck-canvas.tsx` layout effect that writes the rail width properties.
- Reuse the gesture precedents verbatim: the seam drag follows `handleSidebarResizeStart`'s live-property-write pattern; the corridor reorder builds on the three-phase drag machine and `pane-flip.ts`.
- Land in dependency order: pure geometry → wire format → manager/actions → canvas threading + frame rendering → controls (badge menu, Layout section) → seam gesture → corridor drag → doctrine → app-test.
- Every mode/order change animates through the existing `arrangementSignature` FLIP settle by adding rail-arrangement terms to the signature — no new animation system.
- Verify at the real-geometry layer: unit tests for the pure math and serialization, one app-test asserting live member rects in the running app, `bunx vite build` before any step is declared done.

#### Success Criteria (Measurable) {#success-criteria}

- With Lens + Jots pinned right and the right rail split, live `getBoundingClientRect()` in the running app shows two non-overlapping frames that tile the rail run: top member's top ≈ canvas top + 5px, bottom member's bottom ≈ canvas bottom − 32px, and the vertical gap between them ≈ `IMPOSITION_GAP_PX` (±1px). Both frames share the rail's one width. (App-test assertion.)
- In stack mode nothing changes: same-side members render byte-identical frames exactly as today. (Existing unit tests, re-scoped to stack mode, still pass; app-test asserts identical rects after re-stacking.)
- A seam drag changes only the two adjacent members' heights, persists `shares` in the layout blob, and survives relaunch. (App-test assertion via `TUG_APPTEST_JSON` + blob read.)
- Reordering members (via `setRailOrder`) flips the members' vertical positions and persists. (App-test assertion.)
- Mode survives membership churn: split right rail → close Jots → Lens takes the full run → reopen Jots → the split (mode, order, shares) re-applies. (App-test assertion.)
- `imposition.rails` round-trips through serialize → deserialize; pre-split v4 blobs (including first-split-era blobs carrying `order` inside `SidebarEntry`) parse to stacks with no error. (Unit tests.)
- No `ResizeObserver` or resize listener is added to the geometry path; the only geometry JS during a window resize remains the existing settled-resize retune. (Checkpoint grep.)
- `cd tugdeck && bun test` and `bunx vite build` pass at every step boundary.

#### Scope {#scope}

1. `RailArrangement` model + pure geometry (seam fractions, split member styles) in `layout-imposer.ts`, unit-tested.
2. Wire format: `imposition.rails` serialization + defensive parse.
3. DeckManager API: `setRailMode`, `setRailOrder`, `setRailShares`, `equalizeRail`; actions `set-rail-mode`, `equalize-rail`.
4. DeckCanvas: seam custom properties, per-member placement threading, arrangement-signature terms.
5. TugPane: split-member frame styles, split-aware stack badge (glyph + menu verbs).
6. Lens Layout section: per-shared-side Stack | Split control with miniature + preview layers.
7. Seam splitter element with drag + double-click equalize.
8. Corridor drag: title-bar drag reorders within the rail, converts one-way to free drag on corridor exit.
9. tuglaws amendments and the app-test.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Auto-split on second card. Stack is and remains the default; revisit only as follow-on work.
- Pairwise sub-groups, stack-within-split, horizontal sub-splits, or splitting content-card slot stacks (the N-up band's own overlap behavior is untouched).
- Any width change: one rail width per side, allocator untouched, the imposer still never sizes.
- New chords. Both new actions are [L30]-clean (no default binding); ⌥⌘]/⌥⌘[ keep working unchanged.
- Per-member collapse or hide affordances inside a split (close/× already exists per card).

#### Dependencies / Prerequisites {#dependencies}

- The sidebar generalization as shipped: `DeckImposition.sidebars`, `sidebarRailsOf`/`slotStackByPaneId` in `deck-canvas.tsx`, `_sidebarRails`/`_commitImposition` in `deck-manager.ts`.
- `lib/pane-flip.ts` (FLIP tween math) and the `arrangementSignature` settle machinery in `deck-canvas.tsx`.
- `TugPopupMenu`, `TugChoiceGroup`, `LayoutMiniature`, and the Layouts section's preview-layer system.

#### Constraints {#constraints}

- Tuglaws: [L02] external state via `useSyncExternalStore`; [L03] registrations in layout effects; [L06] appearance/geometry via CSS+DOM, never React state; [L09] panes own geometry; [L13] motion through TugAnimator. Commits name the laws touched.
- Live resize must stay JS-free: split geometry is fractions of the run in `calc()`, re-resolved by the browser's reflow.
- bun, never npm; `bunx vite build` from `tugdeck/` before declaring any tugdeck step done (the debug app loads the prod rollup bundle).
- App-tests are selective (`@covers` + `just app-test <file>` / `just app-test-changed`); never the full corpus.
- Never hand-roll UI that exists as a Tug* component; the new Layout-section control composes `TugChoiceGroup`, the badge menu extends the existing `TugPopupMenu`.
- No `localStorage`; all persistence rides the v4 layout blob (`dev.tugtool.deck.layout`, `settings-api.ts`).

#### Assumptions {#assumptions}

- All three sidebar registrations carry `sizePolicy.min.height: 240` (verified: `lens-register-card.tsx`, `jots-card-registration.tsx`, `gazette-card-registration.tsx`). The seam clamp reads each member's policy, never a constant.
- `getTugZoom()` handling in gestures carries over unchanged from the sidebar-resize precedent.
- A fourth sidebar card registered later participates in splits with zero model change (order/shares tolerate absentees; the Layout section's rail rows are membership-derived).

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows `tuglaws/devise-skeleton.md` v4: explicit `{#anchor}` headings, kebab-case anchors without phase numbers, two-digit labels (`[P01]`, `[Q01]`, `S01`, `T01`, `R01`), `**Depends on:**` lines citing `#step-N` anchors, `**References:**` lines citing plan artifacts — never line numbers.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Corridor tolerance width (DECIDED — start at 80px, one named constant) {#q01-corridor-tolerance}

**Question:** How far outside the rail's horizontal band may the pointer stray before a reorder drag converts to a free drag?

**Why it matters:** Too tight and a slightly diagonal reorder gesture unpins the card the user meant to shuffle; too loose and a deliberate drag-out feels sticky.

**Resolution:** DECIDED — `RAIL_CORRIDOR_SLOP_PX = 80` as a named exported constant in `layout-imposer.ts` beside the other tuning constants, applied on each side of the rail's live rect. Tuned by feel during #step-7's manual smoke; the constant is the one-line change.

#### [Q02] Keyboard nudge on the seam (DEFERRED) {#q02-seam-keyboard}

**Question:** Should the seam be a focusable stop with arrow-key nudge (the `TugSplitPane` interaction contract includes one)?

**Why it matters:** The Lens is keyboard-first; a pointer-only seam is a gap in that language.

**Resolution:** DEFERRED — ship pointer-first (drag + double-click equalize + the badge menu's Equalize Heights, which is keyboard-reachable). A seam focus stop touches the focus-language surface and the tabled focus-nav subsystem; design it when that reopens. The Equalize menu item means every seam outcome except a custom ratio is keyboard-reachable at ship.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Corridor drag fights the drag machine ([R01]) | high | med | reorder is a distinct latch branch; conversion is one-way and reuses the existing release path | any visual jump at latch or conversion |
| Dragged frame's inline transform fights the settle FLIP ([R02]) | med | med | dragged frame keeps `data-gesture` through the commit and gets its own FLIP; settle skips it | dragged member snaps or double-animates on drop |
| Seam properties go stale as membership shrinks ([R03]) | med | low | the inset effect writes/removes all seam properties for both sides every pass | a member pinned to a phantom seam after closing a card |
| Legacy first-split blobs mis-parse ([R04]) | low | low | `parseSidebars` already drops the old per-entry `order`; new `rails` parse is defensive and separate | any parse error on an old blob |
| Squeeze below member minimums on short windows ([R05]) | low | med | proportional squeeze is the designed behavior; seam drag clamps to minimums in JS | a member unusably short on a normal display |

**Risk R01: Corridor drag vs the three-phase drag machine** {#r01-corridor-vs-drag-machine}

- **Risk:** `handleDragStart`'s move latch (threshold crossing) currently does exactly two things for a derived pane: `paneOcclusionGesture.begin()` and `releaseImposedFrame(...)` — i.e. every past-threshold title-bar drag on a pinned sidebar unpins it. The reorder gesture must intercept that latch without destabilizing the free-drag path every other pane depends on.
- **Mitigation:** the latch grows one branch, taken only when the pane is a split-rail member: enter reorder mode (no release, no occlusion bracket — the rail's footprint doesn't change during a reorder). Conversion out of the corridor runs the *existing* latch body (occlusion begin + `releaseImposedFrame` + re-seed `dragStartPosition` from the released rect) and from then on the gesture *is* a free drag — one-way, no return, no new commit path. The drop branch checks which mode the gesture ended in: reorder → `onSetRailOrder`, free → the existing `onCardMoved(..., { evictSlot: true })`.
- **Residual risk:** the reorder frame path (transform-based, since the frame is pinned by calc styles and `left`/`top` writes would fight the pins) is new per-frame code; kept small and appearance-zone only.

**Risk R02: The dragged member's transform vs the settle FLIP** {#r02-transform-vs-settle}

- **Risk:** on drop, the order commit changes `arrangementSignature`, arming the settle. The settle's First pass is measured in a store subscriber (before re-render) and skips frames carrying `data-gesture`; its Last pass (layout effect) also skips them. The dragged frame still wears the reorder's inline transform at commit time; if the settle tweened it, First/Last would both include the stale transform and the delta would be wrong.
- **Mitigation:** the dragged frame keeps `data-gesture` through the commit (the settle then ignores it entirely, both passes); siblings — whose preview transforms were already cleared, or who carried none — settle normally. The drop handler then runs the dragged frame's own FLIP: measure its transformed rect (First), clear the inline transform, let the commit's layout land (Last), tween with `animate(frame, springKeyframes(...), { key: "imposer-flip", ... })` exactly as `deck-canvas.tsx`'s settle does, and remove `data-gesture` when the tween is registered. `lib/pane-flip.ts` documents the keyframe rules (transform-only, keyword easing).
- **Residual risk:** two FLIP owners (settle for siblings, drop handler for the dragged frame) in one gesture; the shared `key: "imposer-flip"` and `slotCancelMode: "snap-to-end"` keep a mid-gesture second arrangement change from stacking tweens.

**Risk R03: Stale seam custom properties** {#r03-stale-seam-properties}

- **Risk:** seam properties are per-gap (`--tug-rail-right-seam-0`, `-1`, …); a rail going 3 members → 2 leaves `-1` behind, and any expression still reading it pins a frame to a phantom seam.
- **Mitigation:** the inset layout effect in `deck-canvas.tsx` writes both sides' seam properties on every pass and explicitly `removeProperty`s indices beyond the current gap count (sweep up to `SIDEBAR_PANE_ZINDEX_MAX_RANK`, far past any real rail). Frames read only the seams their own placement names, and placements are re-derived on the same commit.
- **Residual risk:** none meaningful — the sweep is cheap and the effect already runs on exactly the right commits.

---

### Design Decisions {#design-decisions}

#### [P01] Split is a property of the side, stored as `RailArrangement` on `imposition.rails` (DECIDED) {#p01-per-side-arrangement}

**Decision:** `DeckImposition` gains an additive `rails?: { left?: RailArrangement; right?: RailArrangement }` where `RailArrangement = { mode?: "stack" | "split"; order?: string[]; shares?: Record<string, number> }`. Absent `mode` reads as `"stack"` — today's behavior, unchanged blobs unchanged.

**Rationale:**
- A side is a stack or a split; all visible members participate. No pairwise sub-groups — that is the complexity cliff, and two-or-three cards don't need it.
- Membership stays in `sidebars[componentId].side` untouched, so `setSidebarSide`, drag-to-unpin, the Left/Right controls, and the allocator all carry over verbatim.
- Follows [D121]'s additive precedent (`kind` widened twice without a version bump).

**Implications:** new accessors in `layout-imposer.ts` (Spec S01); `serialization.ts` gains a defensive `parseRails`; `_commitImposition` needs no structural change (the record rides `imposition` through the existing commit funnel).

#### [P02] Shares are per-componentId weights, never index-positional fractions (DECIDED) {#p02-shares-weights}

**Decision:** `shares` maps componentId → positive weight, default 1 per member. Effective heights renormalize over the members actually present.

**Rationale:**
- Membership churns (cards close, unpin, change sides); weights keyed by componentId can never misalign heights with members the way a positional array can.
- Default-1 gives equal division with an empty record — the absent case is the common case.

**Implications:** seam fractions are computed (`railSeamFractions`, Spec S01), never stored; a seam drag writes the two adjacent members' weights (renormalized so untouched members keep their ratios); "Equalize" deletes the side's `shares`.

#### [P03] Effective order = stored order filtered to present members, absentees appended in registration order (DECIDED) {#p03-effective-order}

**Decision:** `sidebarStackOrder()` is superseded by `effectiveRailOrder(imposition, side, componentIds)`: the side's stored `order` filtered to the ids actually standing there, then any present ids the stored order doesn't name, in registration order.

**Rationale:**
- Order becomes real, user-owned state on a split rail — the current docstring's "there is deliberately no vertical order to record" becomes false and is rewritten.
- Tolerating absentees is what lets mode/order/shares survive membership churn ([P06]).

**Implications:** stack mode also reads this order (it changes nothing visible there — z-order still decides front/back — but rail member enumeration in `sidebarRailsOf` and the badge picker use one function, not two).

#### [P04] Split geometry is CSS-derived seam fractions; live resize stays JS-free (DECIDED) {#p04-css-derived-seams}

**Decision:** Member vertical pins are `calc()` over per-side seam custom properties (`--tug-rail-left-seam-N` / `--tug-rail-right-seam-N`, plain numbers in [0,1]), written by the same `deck-canvas.tsx` layout effect that writes `sidebarWidthProperty(side)` and the insets. The vertical run is `100% − 5px − 32px` (the existing `IMPOSITION_GAP_PX` top / `IMPOSITION_GAP_BOTTOM_PX` bottom); the inter-member gap is `IMPOSITION_GAP_PX`, split half-and-half across each seam.

**Rationale:**
- Exactly the mechanism the horizontal insets use, for exactly the reason: the browser re-resolves fractions of the run on its own reflow, so a window resize costs zero JS ([L06]).
- Properties on the frames' containing block keep a mid-drag seam write one `setProperty` call, like the rail width drag.

**Implications:** Spec S02 gives the exact expressions; the effect-ordering constraint in `deck-canvas.tsx` (inset effect **before** the settle's Last-measure effect — declaration order is load-bearing, the existing comment says so) applies to the seam writes too, so they go in the same effect.

#### [P05] Seam drags are live property writes with JS min-clamping; window squeeze is proportional (DECIDED) {#p05-seam-clamp}

**Decision:** The seam drag clamps at gesture time to each adjacent member's `sizePolicy.min.height` (all three sidebar cards: 240). Window shrink is CSS-only, so fractions squeeze all members proportionally — a member may render below its minimum on a genuinely short window rather than clipping a sibling. No refusal states.

**Rationale:**
- A split is always allowed; pathological windows degrade proportionally and recover on their own.
- Clamping in CSS would need per-member `max()`/`min()` cascades that overflow the run when they bind; the gesture-time clamp is where the user is, and the proportional fallback is honest everywhere else.

**Implications:** the drop commit converts the clamped pixel heights back to weights; the app-test asserts the clamp by dragging a seam past a member's minimum.

#### [P06] Mode, order, and shares survive membership churn (DECIDED) {#p06-survive-churn}

**Decision:** `rails[side]` persists untouched when the side drops to one (or zero) visible members; a side at one member renders identically in both modes. When a member returns, the arrangement re-applies.

**Rationale:** user-resolved in the brief's review; matches how `sidebars` entries already persist for hidden cards.

**Implications:** no cleanup pass anywhere deletes a `RailArrangement`; only explicit "Stack" gestures write `mode: "stack"` (keeping order/shares for a later re-split — they're harmless and preserve intent).

#### [P07] The stack badge is the gateway; its glyph states the mode (DECIDED) {#p07-badge-gateway}

**Decision:** In stack mode the badge menu (Layers glyph + count) gains one item below the member rows: "Split Vertically". In split mode the glyph swaps to Rows2 (Rows3 at 3+ members), count stays, and the menu offers the member rows (select → activate/focus), "Stack", and "Equalize Heights".

**Rationale:** the badge is already the one place a shared rail announces itself; zero new chrome. In split mode nothing is occluded, so member rows become focus verbs rather than reveal verbs — `onRevealPane` → `transferFocusForActivation` + `store.activateCard` already does the right thing unchanged.

**Implications:** menu items need ids distinct from paneIds (prefix `rail:`); the badge's open-state guard (`stackMenuOpen`, force-closed when depth drops to 1) carries over. Cmd-click and ⌘R (`revealStack()`) open the same menu in both modes.

#### [P08] The Layout section gains one row per shared side (DECIDED) {#p08-layout-section-row}

**Decision:** Below the existing per-sidebar Left/Right rows, one `TugChoiceGroup` row per side with 2+ visible pinned members: caption "LEFT RAIL"/"RIGHT RAIL", options Stack | Split, dispatching `set-rail-mode`. `LayoutMiniature` learns to draw a horizontally-divided rail; the preview-layer system gains `railmode:<side>:<mode>` layers.

**Rationale:** same idiom as everything in the panel (sender-routed `selectValue`, hover/keyboard preview before commit); membership-derived rendering means a fourth sidebar card needs no edit.

**Implications:** new sender prefix `RAIL_SENDER_PREFIX = "lens-layouts-rail:"`; rail rows take focus orders after the sidebar groups; `MiniatureRails` grows a per-side mode (or a sibling prop — implementer's choice, keep `LayoutMiniature` purely presentational).

#### [P09] Corridor drag: reorder inside the rail, one-way conversion to free drag outside it (DECIDED) {#p09-corridor-drag}

**Decision:** On a split member, the drag machine's move latch enters *reorder mode*: the frame follows the pointer vertically by inline transform, siblings preview-shuffle, drop commits `order`. The moment the pointer leaves the rail's horizontal band ± `RAIL_CORRIDOR_SLOP_PX`, the gesture converts one-way to the existing free drag (occlusion bracket + `releaseImposedFrame` + today's unpin-on-drop). On a stack-mode rail nothing changes.

**Rationale:** user-resolved: this gesture is the feature's soul and ships first-class. No gesture is lost — drag-away-to-unpin still works from a split rail; the vertical axis gains the reorder meaning only where a reorder is visible.

**Implications:** Risk R01/R02 carry the mechanism; Cmd-drag (move without raising) and no-travel Cmd-click (stack picker) keep their meanings; the reorder never runs the occlusion bracket (rail footprint unchanged).

#### [P10] Rail arrangement terms join the settle signature; commits ride the existing funnel (DECIDED) {#p10-signature-terms}

**Decision:** `arrangementSignature` gains the per-side mode, effective order, and seam fractions (rounded to 3 decimals). All rail-arrangement mutations commit through `_commitImposition` (via `_reimpose`), inheriting notify + `scheduleSave()` + the lifecycle ledger.

**Rationale:** mode flips and menu/section-driven reorders then animate through the existing FLIP settle with no new animation code. A seam-drag commit arms a settle whose First and Last rects are identical (the DOM already sits at final geometry from the live property writes) — a zero-delta no-op, the same coexistence rail-width edge drags already have (the signature's own comment documents that pattern).

**Implications:** the signature's z-blindness is preserved (order terms come from the imposition record, not the panes array); seam fractions are rounded so sub-pixel share arithmetic can't arm spurious settles.

#### [P11] New actions are `set-rail-mode` and `equalize-rail`; reorder and shares commit through manager methods (DECIDED) {#p11-actions}

**Decision:** Registry actions (validated payloads, no chords): `set-rail-mode { side, mode }` and `equalize-rail { side }`. `setRailOrder` / `setRailShares` are DeckManager methods reached through props/gesture commits, not public actions.

**Rationale:** the two actions are user-nameable verbs (menu rows, Layout section); a reorder or a seam ratio is a gesture's commit payload, which nothing else should synthesize.

**Implications:** three registration sites per action, following `set-sidebar-side` exactly: `action-vocabulary.ts` (`SET_RAIL_MODE`, `EQUALIZE_RAIL`), `action-dispatch.ts` handler, `command-registry.ts` entry.

---

### Deep Dives {#deep-dives}

#### Investigation findings a cold reader needs {#investigation-findings}

All paths relative to `tugdeck/src/` unless noted. Line numbers below are approximate anchors verified 2026-08-11, not contracts.

**The imposer module.** `lib/layout-imposer.ts` (~1094 lines) is pure (no DOM/store/React runtime imports). Relevant symbols: `DeckImposition` (~:152), `SidebarEntry { side, pinned? }` (~:126), `sidebarSide()` (~:183), `isSidebarPinned()` (~:192), `withSidebarSide()` (~:200), `withSidebarPinned()` (~:212), `sidebarStackOrder()` (~:233 — registration order; its docstring "there is no vertical order to record" is rewritten by this plan), `IMPOSITION_GAP_PX = 5` (~:277), `IMPOSITION_GAP_BOTTOM_PX = 32` (~:291), `IMPOSITION_SETTLE_MS = 300`, `RESIZE_RETUNE_QUIET_MS = 200`, `sidebarWidthProperty(side)` (~:403 — `--tug-sidebar-width-left/right`, deliberately unregistered so `var()` fallbacks work), `LENS_RAIL_PROPERTY = "--tugx-lens-rail"` (registered `<number>`, 0 = left, 1 = right), and `imposeSidebarStyle(side, paneWidth, options?)` (~:1074) which emits `{ width: var(widthProperty, paneWidthpx), height: "auto", top: 5px, bottom: 32px, [LENS_RAIL_PROPERTY]: 0|1, left: calc(mix of both anchors by the rail number) }`. The long doc comment above it ("A shared rail is a stack, not a split…") is the text this plan supersedes. The allocator (`allocateSidebarWidths` ~:872, `solveSidebarWidths` ~:925) is **untouched** — one width per side is preserved.

**DeckCanvas** (`components/chrome/deck-canvas.tsx`). `SIDEBAR_PANE_ZINDEX_BASE = 8990` / `SIDEBAR_PANE_ZINDEX_MAX_RANK = 9` (~:117); `sidebarRailsOf(state)` (~:163) builds per-side `{ side, width, members }` from `findSidebarPanes` + `isSidebarPinned` + `sidebarStackOrder`, width = widest member's render width (`paneRenderWidthOf` raises stored width to the stack size floor). `arrangementSignature(state)` (~:237) = kind | bullseye | rails (side:width:memberIds) | sorted pane `id:slot:width` terms — deliberately blind to z-order; its comment documents why rail-width terms arm zero-delta settles after live drags. `stackByPaneId` (~:356) maps sidebar paneId → `{ side, count }` and is handed to `TugPane` as `sidebarStack`; `slotStackByPaneId` (~:410) keys stacks by `place` = `rail:${side}` or `slot:${n}` and builds display-resolved `SlotStackEntry[]` (topmost first) for the badge picker; `handleRevealPane` (~:1524) routes selection through `transferFocusForActivation` + `store.activateCard`. The **inset layout effect** (~:1132) writes `sidebarWidthProperty(side)` and `--tug-imposer-inset-left/right` on the frames' containing block (`containerRef`), keyed on a `railWidths` summary string. The **settled-resize observer** (~:1172) debounces `store.retuneSidebarAllocation()` by `RESIZE_RETUNE_QUIET_MS`. The **settle** (~:1237–1457): a store subscriber measures First rects for every `.tug-pane[data-pane-id]` frame *not* carrying `data-gesture`, holds session notifications, stamps `data-imposer-settling`; a layout effect (declared **after** the inset effect — declaration order is load-bearing, its comment says why) measures Last and runs `animate(frame, springKeyframes(dx, dy, sx), { duration, easing: "linear", fill: "none", composite: "replace", key: "imposer-flip", slotCancelMode: "snap-to-end" })`; `clearFlip` removes the inline `transform`/`transform-origin` residue.

**TugPane** (`components/chrome/tug-pane.tsx`). `sidebarStack` prop → `sidebarSide` (~:1316), `pinned` (~:1335), `derivedRef` (~:1345, pinned || imposed || bullseye). The frame's `modeStyle` (~:2746) picks bullseye → sidebar (`imposeSidebarStyle(sidebarSide, renderWidth)`) → imposed → free; the frame carries `data-lens={side}` for sidebar panes (~:2826) and `data-pane-id`. The **stack badge** (~:683): rendered when `slotStack.length > 1`, a `TugPopupMenu` whose trigger is a ghost `TugButton subtype="icon-text"` with `<Layers />` + the count, `className="tug-pane-title-bar-stack-badge"`, testids `tug-pane-title-bar-stack-badge` / `tug-pane-title-bar-stack-menu`; rows are member miniatures with `selected: entry.topmost`; selection calls `onRevealPane(entry)`; open state `stackMenuOpen` is local `useState`, force-closed when depth drops to 1 (~:424); `CardTitleBarHandle.revealStack()` (~:586) opens it (⌘R and the no-travel Cmd-click path both call it, ~:2176). The **drag machine** (~:1956–2254): three phases; `DRAG_MOVE_THRESHOLD_PX = 3`; the move latch (~:2049–2067) is where `paneOcclusionGesture.begin()` and — for derived panes — `releaseImposedFrame(frame, bounds)` + `dragStartPosition` re-seed happen; per-frame writes are `frame.style.left/top`; drop commits `onCardMoved(id, pos, size, derivedRef.current ? { evictSlot: true } : undefined)`; `data-gesture` is set at start and removed at the top of `onPointerUp` (before the commit). The **sidebar width drag** (`handleSidebarResizeStart`, ~:2505–2649) is the seam drag's template: snapshot, rAF apply writing ONE custom property (`container.style.setProperty(widthProperty, px)`), move-threshold latch, occlusion bracket, commit on pointer-up with the property left as the gesture set it so no frame reads a stale value.

**DeckManager** (`deck-manager.ts`). `setSidebarSide` (~:1319) → `_reimpose(withSidebarSide(...))`; `pinLens` (~:1335); `_sidebarRails(panes, imposition)` (~:1351) folds per-side `RailPolicy` (max preferred, max min) + `panesBySide`; `_sidebarPreferredWidth` (~:1396) reads durable stores (lensStore / sidebarWidthStore), never live panes; `_allocatedRailWidths` (~:1417); `_commitImposition(imposition, panes)` (~:1475) runs the allocator, writes rail widths straight into `pane.size.width` (deliberately not through `movePane`), brackets moved/resized cards with the lifecycle ledger, `notify()`, `scheduleSave()`; `retuneSidebarAllocation` (~:1551) is the settled-resize moment; `_reimpose` (~:1574) = `_commitImposition(imposition, this.deckState.panes)`; `_unpinSidebar` (~:1592) is the drag-out path.

**Serialization** (`serialization.ts`). `serialize()` (~:142) emits `imposition` verbatim (so `rails` rides along once the type carries it — but the read side must still be defensive). `parseV4` (~:311) parses three historical imposition shapes; `parseSidebars` (~:280) builds entries **field by field, never by spread**, with a comment recording that "the split build wrote an `order` here (a member's position in a rail that divided vertically)" — the first split attempt's per-entry `order` is dropped on read and must stay dropped. The new `rails` record is a sibling of `sidebars`, parsed by a new defensive `parseRails`.

**Layouts section** (`components/lens/sections/layouts-section.tsx`, ~589 lines). Sender-routed: one `useResponder` (`id: "lens-layouts-section"`) handles `SELECT_VALUE` and routes by `event.sender` (`KIND_SENDER_ID`, `WIDTH_SENDER_ID`, `SIDE_SENDER_PREFIX + componentId`) to `dispatchCommand(...)`. `sidebarEntries()` (~:153) walks `getAllRegistrations()` for `layoutRole === "sidebar"`. Preview: `PlanLayer[]` (~:387) with `previewId` families `kind:`, `width:`, `side:componentId:side`; visibility is DOM attributes toggled by `setPreview` (~:344) from pointer (`previewIdOf`, ~:269) and a `MutationObserver` on `data-key-cursor`/`data-key-view-kbd` (~:362). Focus orders: kind 0, width 1, sidebars from 2 (`LAYOUTS_FIRST_SIDEBAR_FOCUS_ORDER`); rail rows take the orders after the sidebar groups. `LayoutMiniature` (`components/lens/layout-miniature.tsx`) is purely presentational: `{ kind, rails: MiniatureRails, cards?, width?, selected? }`, `Rail` member draws stacked "paper" offsets (`RAIL_DEPTH_PCT = 3`), `RAIL_NOMINAL_PX = 420`.

**Actions plumbing.** `TUG_ACTIONS.SET_SIDEBAR_SIDE` in `components/tugways/action-vocabulary.ts` (~:817) + handler in `action-dispatch.ts` (~:580, payload-validated, `console.warn` on bad input) + entry in `components/tugways/command-registry.ts` (~:1319) is the three-site pattern the new actions copy.

**Persistence.** Blob: tugbank domain `dev.tugtool.deck.layout`, key `layout` (`settings-api.ts`); `DeckManager.saveLayout()` behind debounced `scheduleSave()`.

#### End-to-end flow: user splits the right rail from the badge {#flow-split}

1. Lens + Jots pinned right (a `rail:right` stack of 2). The Jots title bar's badge menu shows two member rows + "Split Vertically".
2. Selecting it dispatches `set-rail-mode { side: "right", mode: "split" }` → `action-dispatch.ts` handler → `deckManager.setRailMode("right", "split")` → `_reimpose(withRailMode(imposition, "right", "split"))`.
3. `_commitImposition` commits; `notify()` re-renders. `deck-canvas` derives the right rail's member placements (effective order: [lens, jots] registration order; shares absent → seam fraction 0.5), writes `--tug-rail-right-seam-0: 0.5` in the inset effect.
4. Each member's `TugPane` renders the split style: Lens `top: calc(5px + 0 * run)`, `bottom: calc(32px + (1 − 0.5) * run + 2.5px)`; Jots `top: calc(5px + 0.5 * run + 2.5px)`, `bottom: 32px` — where `run = (100% − 5px − 32px)`.
5. `arrangementSignature` changed (mode + seam terms), so the settle FLIP carries both frames from full-run overlap to their halves. The seam element appears in the gap.
6. Window resize: fractions re-resolve in reflow; no JS runs.

---

### Specification {#specification}

**Spec S01: Model and pure API additions (`lib/layout-imposer.ts`)** {#s01-model-api}

```ts
export type RailMode = "stack" | "split";

export interface RailArrangement {
  /** Absent reads as "stack" — today's behavior. */
  mode?: RailMode;
  /** componentIds, top-to-bottom. Absent = registration order. */
  order?: string[];
  /** Height weight per componentId; absent member = 1. Positive finite only. */
  shares?: Record<string, number>;
}

export interface DeckImposition {
  kind?: ImpositionKind;
  contentWidth?: ContentWidth;
  sidebars: Record<string, SidebarEntry>;
  rails?: { left?: RailArrangement; right?: RailArrangement };   // NEW
}

export function railModeOf(imposition: DeckImposition, side: SidebarSide): RailMode;
export function isRailMode(value: unknown): value is RailMode;
export function withRailMode(imposition: DeckImposition, side: SidebarSide, mode: RailMode): DeckImposition;
export function withRailOrder(imposition: DeckImposition, side: SidebarSide, order: readonly string[]): DeckImposition;
export function withRailShares(imposition: DeckImposition, side: SidebarSide, shares: Record<string, number>): DeckImposition;
/** Stored order filtered to present ids, absent present ids appended in the
 *  given (registration) order. Supersedes sidebarStackOrder — see [P03]. */
export function effectiveRailOrder(
  imposition: DeckImposition, side: SidebarSide, componentIds: readonly string[],
): readonly string[];
/** Cumulative seam fractions for an ordered member list: N members → N−1
 *  strictly increasing values in (0, 1). Weights renormalized over present
 *  members; non-finite or non-positive weights read as 1. */
export function railSeamFractions(
  order: readonly string[], shares: Readonly<Record<string, number>> | undefined,
): readonly number[];
/** The seam property name: --tug-rail-<side>-seam-<index>. */
export function railSeamProperty(side: SidebarSide, index: number): string;
/** One split member's place: its index, the member count, and the side. */
export interface RailMemberPlacement { side: SidebarSide; index: number; count: number }
/** Corridor half-width for the reorder gesture (see [Q01]). */
export const RAIL_CORRIDOR_SLOP_PX = 80;
```

`imposeSidebarStyle` gains an optional third-ish parameter (folded into `options`): `member?: RailMemberPlacement`. With `member` absent or `count === 1`, output is byte-identical to today. With a member of N > 1:

**Spec S02: Split member geometry** {#s02-split-geometry}

Let `run = (100% − ${IMPOSITION_GAP_PX}px − ${IMPOSITION_GAP_BOTTOM_PX}px)` (a calc subexpression over the containing block height), `half = IMPOSITION_GAP_PX / 2` (2.5px), and `seam(j) = var(--tug-rail-<side>-seam-<j>, <fallback>)` where the fallback is the equal-division fraction `(j+1)/count` so a frame rendering before the property lands gets sane geometry (the same unregistered-property discipline as `sidebarWidthProperty`). For member `i` of `count`:

- `top`: `i === 0` → `${IMPOSITION_GAP_PX}px`; else → `calc(${IMPOSITION_GAP_PX}px + ${seam(i−1)} * ${run} + ${half}px)`
- `bottom`: `i === count−1` → `${IMPOSITION_GAP_BOTTOM_PX}px`; else → `calc(${IMPOSITION_GAP_BOTTOM_PX}px + (1 − ${seam(i)}) * ${run} + ${half}px)`
- `width`, `left`, `height: "auto"`, and the `LENS_RAIL_PROPERTY` term: unchanged from today's sidebar style.

The seam **element**'s vertical center for gap `j` sits at `calc(${IMPOSITION_GAP_PX}px + ${seam(j)} * ${run})` in the same coordinate space — positioned from the same properties as the frames, so it cannot drift from them.

**Spec S03: Seam custom properties (DeckCanvas)** {#s03-seam-properties}

Written in the existing inset layout effect (`deck-canvas.tsx` ~:1132), which already runs on every rail-affecting commit and — critically — is declared before the settle's Last-measure effect. Per side: for a split rail of N members compute `railSeamFractions(effectiveOrder, shares)` and write `railSeamProperty(side, j)` for j in 0..N−2 as plain number strings; then sweep-remove properties for j in N−1..`SIDEBAR_PANE_ZINDEX_MAX_RANK` and, for stack-mode or absent rails, all indices ([R03]). The effect's dependency summary string grows the per-side mode + fraction list.

**Spec S04: Actions and DeckManager surface** {#s04-actions-manager}

| Action | Payload | Handler |
|--------|---------|---------|
| `set-rail-mode` | `{ side: "left"\|"right", mode: "stack"\|"split" }` | `deckManager.setRailMode(side, mode)` |
| `equalize-rail` | `{ side: "left"\|"right" }` | `deckManager.equalizeRail(side)` |

DeckManager additions (all funneling through `_reimpose`, inheriting notify + save + ledger):

- `setRailMode(side, mode): void` — no-op when unchanged; `_reimpose(withRailMode(...))`.
- `setRailOrder(side, order): void` — filters `order` to sidebar componentIds; `_reimpose(withRailOrder(...))`. Gesture commit only ([P11]).
- `setRailShares(side, shares): void` — validates positive finite weights; `_reimpose(withRailShares(...))`. Gesture commit only.
- `equalizeRail(side): void` — `_reimpose` with the side's `shares` removed (order and mode kept).

**Spec S05: Wire format** {#s05-wire-format}

```jsonc
"imposition": {
  "kind": "three-up",
  "contentWidth": "comfy",
  "sidebars": { "lens": { "side": "right" }, "jots": { "side": "right" } },
  "rails": {                                  // additive-optional
    "right": { "mode": "split", "order": ["jots", "lens"], "shares": { "jots": 1.4, "lens": 1 } }
  }
}
```

Read rules (`parseRails` in `serialization.ts`, built field-by-field like `parseSidebars` — never by spread): unknown `mode` → drop the side's arrangement; `order` filtered to string entries (unknown componentIds are *kept* — the registry isn't loaded at parse time and `effectiveRailOrder` filters at use); `shares` entries dropped per-key unless positive finite numbers; an empty surviving record → the side is absent. The legacy per-`SidebarEntry` `order` field from the first split build stays dropped by `parseSidebars` exactly as today ([R04]). `serialize()` needs no change (it emits `deckState.imposition` whole).

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

| State | Zone (appearance / local-data / structure) | Mechanism | Law |
|-------|--------------------------------------------|-----------|-----|
| `imposition.rails` (mode/order/shares) | structure | DeckManager store; React reads via `useSyncExternalStore` | [L02] |
| Seam custom properties on the frames' container | appearance | `useLayoutEffect` DOM write in `DeckCanvas` (existing inset effect) | [L03], [L06] |
| Split member frame pins (`top`/`bottom` calcs) | appearance | inline CSS from `imposeSidebarStyle` at render; browser reflow | [L06], [L09] |
| Seam drag live position | appearance | rAF `setProperty` writes during gesture, commit on release | [L06] |
| Corridor-drag transforms (dragged frame, sibling previews) | appearance | inline transforms + TugAnimator tweens, cleared at gesture end | [L06], [L13] |
| Badge menu open state | local-data | existing `useState stackMenuOpen` | [L24] |
| Layout-section rail rows' selection | derived render | computed from the deck snapshot | [L02] |
| Settle FLIP for mode/order changes | appearance | existing `arrangementSignature` machinery + new terms | [L06], [L13] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tests/app-test/at0401-sidebar-split.test.ts` | App-test (Spec-level geometry, persistence, churn survival) |

(No other new files: the seam element lives in `deck-canvas.tsx` + `deck-canvas.css` or `tug-pane.css` beside the existing canvas-overlay pieces; the model lives in `layout-imposer.ts`.)

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `RailMode`, `RailArrangement`, `railModeOf`, `isRailMode`, `withRailMode`, `withRailOrder`, `withRailShares`, `effectiveRailOrder`, `railSeamFractions`, `railSeamProperty`, `RailMemberPlacement`, `RAIL_CORRIDOR_SLOP_PX` | types/fns/const | `lib/layout-imposer.ts` | Spec S01 |
| `DeckImposition.rails?` | field | `lib/layout-imposer.ts` | [P01] |
| `imposeSidebarStyle` | fn (modify) | `lib/layout-imposer.ts` | `options.member?: RailMemberPlacement`, Spec S02; rewrite the "stack, not a split" doc comment |
| `sidebarStackOrder` | fn (retire/absorb) | `lib/layout-imposer.ts` | superseded by `effectiveRailOrder` ([P03]); rewrite docstring |
| `parseRails` | fn | `serialization.ts` | Spec S05 |
| `setRailMode`, `setRailOrder`, `setRailShares`, `equalizeRail` | methods | `deck-manager.ts` | Spec S04 |
| `SET_RAIL_MODE`, `EQUALIZE_RAIL` | consts | `components/tugways/action-vocabulary.ts` | [P11] |
| `set-rail-mode`, `equalize-rail` | actions | `action-dispatch.ts`, `components/tugways/command-registry.ts` | copy the `set-sidebar-side` pattern |
| seam property writes + sweep | effect (modify) | `components/chrome/deck-canvas.tsx` | Spec S03, [R03] |
| `arrangementSignature` | fn (modify) | `components/chrome/deck-canvas.tsx` | [P10]: per-side mode/order/rounded fractions |
| `sidebarStack` prop shape | type (modify) | `components/chrome/deck-canvas.tsx` → `tug-pane.tsx` | grows `mode`, `memberIndex` (count already present) |
| seam elements + drag + dblclick | element/handlers | `components/chrome/deck-canvas.tsx` (+ CSS) | Spec S02 position, `handleSidebarResizeStart` gesture pattern, [P05] |
| split style branch, `data-rail-split` attr | logic | `components/chrome/tug-pane.tsx` | modeStyle branch passes `member` to `imposeSidebarStyle` |
| stack badge split mode | JSX (modify) | `components/chrome/tug-pane.tsx` | [P07]: Rows2/Rows3 glyph, `rail:`-prefixed menu verbs, new props `onSetRailMode`/`onEqualizeRail` threaded from deck-canvas (or dispatched — match the width popup's prop pattern) |
| corridor drag branch | logic | `components/chrome/tug-pane.tsx` | [P09], Risks R01/R02; new `onSetRailOrder` commit prop |
| rail rows + `RAIL_SENDER_PREFIX` + `railmode:` preview layers | JSX (modify) | `components/lens/sections/layouts-section.tsx` | [P08] |
| divided-rail drawing | props/JSX (modify) | `components/lens/layout-miniature.tsx` | keep purely presentational |

---

### Documentation Plan {#documentation-plan}

- [ ] `tuglaws/pane-model.md`: the pinned-mode row amended — a shared rail is a stack **by default; the user may split it**; split geometry (seam properties, run division) joins the geometry-modes table; badge/picker spec ([D123]/[D129] text) gains the split-mode behavior; Files table entries for the seam.
- [ ] `tuglaws/design-decisions.md`: amend [D121] (rail arrangement state) and add a new [D##] recording the two lived verdicts and the chosen-never-imposed synthesis.
- [ ] Rewrite the `imposeSidebarStyle` doc comment and the `sidebarStackOrder`/`effectiveRailOrder` docstring to the new truth (done inside #step-1, recorded here for the reviewer).

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | `railSeamFractions` math, `effectiveRailOrder` churn tolerance, `imposeSidebarStyle` split branch string-snapshots, `parseRails` defensive reads, round-trips | every pure edge, via `cd tugdeck && bun test` |
| **Integration (app-test)** | real Tug.app: split via real badge-menu click, live rect tiling, seam persistence, churn survival, re-stack | `at0401`, run by name / `just app-test-changed` |
| **Golden / Contract** | v4 blob with/without `rails` (and a first-split-era blob with per-entry `order`) parses per Spec S05 | serialization unit tests |

#### What stays out of tests {#test-non-goals}

- jsdom render tests of `TugPane`/seam/badge — banned pattern; the app-test drives the real DOM.
- Mock-store assertions of DeckManager mutations — the mutations are asserted against real geometry in `at0401` (the imposition-plan precedent: DeckManager's constructor needs a live DOM, and tugdeck has no test DOM substrate by design).
- Mid-drag corridor-exit pointer choreography — the harness's background pointer path cannot honestly express a mid-gesture trajectory exit today. The conversion branch is exercised manually in #step-7's smoke; the *commit surfaces* it lands on (`setRailOrder`, `onCardMoved` + `evictSlot`) are both app-test-asserted through their other callers. Do not fake it with synthetic PointerEvents.
- Asserting computed `flex`/property values that restate the stylesheet — assertions are on resulting rects.

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass.** Only the user commits on main (CLAUDE.md git policy); under explicitly authorized autonomous execution, commit per step reporting hash + message. Commit messages name the tuglaws touched.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Model + pure geometry in layout-imposer | pending | — |
| #step-2 | Wire format: rails serialization | pending | — |
| #step-3 | DeckManager rail API + actions | pending | — |
| #step-4 | DeckCanvas seam properties, threading, signature | pending | — |
| #step-5 | TugPane split rendering + split-aware badge | pending | — |
| #step-6 | Seam element: drag + equalize | pending | — |
| #step-7 | Corridor drag reorder | pending | — |
| #step-8 | Layout section rail rows + miniature | pending | — |
| #step-9 | tuglaws amendments | pending | — |
| #step-10 | App-test + integration checkpoint | pending | — |

#### Step 1: Model + pure geometry in layout-imposer {#step-1}

**Commit:** `tugways(sidebar-split-model): RailArrangement, seam fractions, split member geometry [L06][L09]`

**References:** [P01] per-side arrangement, [P02] shares weights, [P03] effective order, [P04] CSS-derived seams, Spec S01, Spec S02, (#investigation-findings)

**Artifacts:**
- Every Spec S01 symbol in `tugdeck/src/lib/layout-imposer.ts`; `DeckImposition.rails?`; `imposeSidebarStyle` split branch per Spec S02.
- `effectiveRailOrder` replacing `sidebarStackOrder` at both call sites (`deck-canvas.tsx` `sidebarRailsOf`, and any other `sidebarStackOrder` importer — grep before deleting; keep the old name as a thin alias only if a third caller makes the rename noisy, otherwise delete it).
- The "A shared rail is a stack, not a split" doc comment rewritten: stack by default, user may split, citing the two lived verdicts in one sentence each.
- Unit tests in `tugdeck/src/lib/__tests__/layout-imposer.test.ts`: the existing "two members on one side are geometrically identical / no vertical term" describes re-scoped to stack mode; new describes for `railSeamFractions` (equal default, weights, renormalization over absentees, degenerate weights → 1, strict monotonicity), `effectiveRailOrder` (stored order wins, absentees appended in registration order, unknown ids filtered), `railSeamProperty` naming, and `imposeSidebarStyle` split string-snapshots (first/middle/last member of 2 and of 3, var fallbacks = equal division, gap split 2.5/2.5, endpoints at 5px/32px).

**Tasks:**
- [ ] Implement Spec S01 exactly; keep the module pure (no DOM/store/React runtime imports).
- [ ] Split style emits Spec S02's expressions; `member` absent or `count === 1` → byte-identical output to today (assert with a snapshot equality test against the un-membered call).
- [ ] Rewrite the two doc comments named above.

**Tests:**
- [ ] `cd tugdeck && bun test src/lib/__tests__/layout-imposer.test.ts`

**Checkpoint:**
- [ ] `cd tugdeck && bun test` (whole suite — the re-scoped describes must not orphan other tests)
- [ ] `cd tugdeck && bunx vite build`

---

#### Step 2: Wire format: rails serialization {#step-2}

**Depends on:** #step-1

**Commit:** `tugways(sidebar-split-wire): parse imposition.rails defensively, additive v4 [L02]`

**References:** [P01], [P06] survive churn, Spec S05, Risk R04, (#investigation-findings)

**Artifacts:**
- `parseRails` in `tugdeck/src/serialization.ts`, called from `parseV4` beside `parseSidebars`; the parsed record joins the `DeckImposition` literal built there. Field-by-field construction, never spread (the `parseSidebars` discipline and its comment are the model).
- Unit tests beside the existing serialization suite: round-trip with a split right rail (mode+order+shares intact); pre-split blob → `rails` absent; defensive cases (bogus mode drops the side; non-finite/negative shares dropped per-key; non-string order entries dropped; empty record → absent side); a **first-split-era blob** with `order` inside a `SidebarEntry` still parses with that field dropped and no `rails` invented.

**Tasks:**
- [ ] Implement `parseRails` per Spec S05; confirm `serialize()` needs no change (it emits the record whole) and pin the emitted key set in the existing serialize key-set test.

**Tests:**
- [ ] The cases above in `serialization`'s test file.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`

---

#### Step 3: DeckManager rail API + actions {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `tugways(sidebar-split-manager): setRailMode/Order/Shares/equalizeRail + registry actions [L02]`

**References:** [P10] signature/funnel, [P11] actions, Spec S04, (#investigation-findings)

**Artifacts:**
- The four methods on `DeckManager` (`tugdeck/src/deck-manager.ts`), each validating input and funneling through `_reimpose` — which already runs the allocator, ledger, notify, and save; no change to `_commitImposition` itself.
- `SET_RAIL_MODE` / `EQUALIZE_RAIL` in `action-vocabulary.ts` with payload doc comments; handlers in `action-dispatch.ts` (validate `isSidebarSide` + `isRailMode`, warn + no-op on bad payloads — copy `set-sidebar-side`'s shape); command entries in `command-registry.ts` beside `SET_SIDEBAR_SIDE`. No chords ([L30]).

**Tasks:**
- [ ] `setRailOrder` filters to registered sidebar componentIds via the registry; `setRailShares` validates positive finite; `equalizeRail` removes the side's `shares` only.
- [ ] Payload-validation unit tests beside the existing action-dispatch test patterns.

**Tests:**
- [ ] Action payload validation (bad side / bad mode / missing fields warn and no-op).

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`

---

#### Step 4: DeckCanvas seam properties, threading, signature {#step-4}

**Depends on:** #step-3

**Commit:** `tugways(sidebar-split-canvas): seam custom properties, member threading, settle terms [L02][L03][L06]`

**References:** [P04], [P10], Spec S03, Risk R03, (#investigation-findings, #flow-split)

**Artifacts:**
- Seam property writes + stale-index sweep in the **existing** inset layout effect (`deck-canvas.tsx` ~the `railWidths` effect) — not a new effect, preserving the declaration-order constraint against the settle's Last-measure effect. The effect's dependency summary string grows per-side `mode` + fraction terms.
- `sidebarRailsOf` uses `effectiveRailOrder` (done mechanically in #step-1) and its `SidebarRail` gains the side's `mode` and per-member index, so `stackByPaneId` (the `sidebarStack` prop source) grows `{ side, count, mode, memberIndex }`.
- `arrangementSignature` gains per-side `mode:order:fractions(3dp)` terms sourced from the imposition record (never the panes array — z-blindness preserved).
- `slotStackByPaneId` threads the rail's mode into the entries (or a parallel prop) so the badge can render mode-appropriately in #step-5.

**Tasks:**
- [ ] Implement Spec S03 including the removeProperty sweep ([R03]).
- [ ] Verify by hand in the debug app (HMR): with two sidebars right and `mode: "split"` set via console dispatch of `set-rail-mode`, the container carries `--tug-rail-right-seam-0: 0.5` and both member frames tile the run (frames still render full-run until #step-5 — assert the *properties* here, the frames next step).

**Tests:**
- [ ] (Geometry asserted in #step-10's app-test; signature growth is exercised by every later manual smoke — a mode flip must visibly settle, not cut.)

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`
- [ ] `grep -rn "ResizeObserver" tugdeck/src/lib/layout-imposer.ts` → no matches (the pure module stays pure; the only observer remains the existing settled-resize one)

---

#### Step 5: TugPane split rendering + split-aware badge {#step-5}

**Depends on:** #step-4

**Commit:** `tugways(sidebar-split-pane): split member frames, Rows badge, Split/Stack/Equalize verbs [L06][L09]`

**References:** [P07] badge gateway, Spec S02, (#investigation-findings)

**Artifacts:**
- `modeStyle`'s sidebar branch passes `{ member: { side, index, count } }` to `imposeSidebarStyle` when the rail's mode is split and count > 1; the frame gains `data-rail-split` (sibling of `data-lens`) for tests and CSS.
- Stack badge: glyph `Layers` (stack) vs `Rows2`/`Rows3` (split, by count); menu items appended after the member rows — stack mode: `rail:split` → "Split Vertically"; split mode: `rail:stack` → "Stack", `rail:equalize` → "Equalize Heights". Selection routes `rail:`-prefixed ids to new props (`onSetRailMode(side, mode)`, `onEqualizeRail(side)`) threaded from `deck-canvas.tsx` beside `onRevealPane`, whose handlers dispatch the registered actions; member-row selection stays `onRevealPane` unchanged.
- The badge's aria-label reflects the mode ("Stack of N cards" / "Split of N cards").

**Tasks:**
- [ ] Keep the `slotStack.length > 1` render condition and the open-state force-close guard exactly as they are.
- [ ] Manual smoke in the debug app: split via the badge, both members visible and tiling; member row click focuses (no reveal needed); Stack returns to today's overlap with a settle, not a cut; Equalize resets a hand-set ratio (ratio-setting arrives in #step-6 — for now assert it no-ops cleanly on default shares).

**Tests:**
- [ ] (Real-geometry assertions land in #step-10; no jsdom render tests per #test-non-goals.)

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`

---

#### Step 6: Seam element: drag + equalize {#step-6}

**Depends on:** #step-5

**Commit:** `tugways(sidebar-split-seam): draggable seam between split members [L06][L13]`

**References:** [P05] seam clamp, Spec S02 (seam position), Spec S04, (#investigation-findings — the `handleSidebarResizeStart` template)

**Artifacts:**
- One seam element per gap per split rail, rendered by `DeckCanvas` into the frames' container: absolutely positioned, horizontal span = the rail's width expression, vertical center = the Spec S02 seam expression; `cursor: row-resize`; visual hairline within a ~10px hit area (CSS in `deck-canvas.css` or beside the pane chrome — implementer's file call, named in the commit).
- Drag handler following `handleSidebarResizeStart` member-for-member: pointer capture, `DRAG_MOVE_THRESHOLD_PX` latch, rAF apply writing ONE property (`railSeamProperty(side, j)`), zoom-corrected deltas, **no occlusion bracket** (the rail's footprint doesn't change — note this divergence from the template in a comment), JS clamp so both adjacent members hold ≥ their `sizePolicy.min.height` (from `getSizePolicy(componentId)`), commit on pointer-up: convert the final fractions back to weights (untouched members keep their ratios) → `store.setRailShares(side, shares)`; the property stays as the gesture left it so no frame reads a stale value.
- Double-click on a seam → `equalizeRail(side)` (dispatch the registered action).

**Tasks:**
- [ ] Zero-delta settle: confirm the shares commit arms a settle whose tweens are no-ops (the [P10] mechanism) — watch for any visible twitch on release; if one appears, the fractions' 3-decimal rounding in the signature vs the property write is the first suspect.
- [ ] Manual smoke: drag clamps at member minimums; window-shrink squeeze is proportional and recovers; relaunch restores the ratio.

**Tests:**
- [ ] Weight-conversion arithmetic (fractions → weights preserving untouched ratios) as a pure helper unit test in the imposer suite if extracted there (preferred), else covered by #step-10's persistence assertion.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`

---

#### Step 7: Corridor drag reorder {#step-7}

**Depends on:** #step-5

**Commit:** `tugways(sidebar-split-corridor): title-bar drag reorders within a split rail, converts to free drag outside it [L06][L13]`

**References:** [P09] corridor drag, [Q01] tolerance, Risk R01, Risk R02, (#investigation-findings — the drag machine)

**Artifacts:**
- The move-latch branch in `handleDragStart` (`tug-pane.tsx`): when the pane is a split-rail member, latch into **reorder mode** instead of the release path — no `releaseImposedFrame`, no occlusion bracket. Snapshot at latch: the rail's live horizontal band (own frame's rect ± `RAIL_CORRIDOR_SLOP_PX`), each sibling member's rect and paneId (query `[data-rail-split]` frames sharing the side), and the member order.
- Reorder frame path (rAF, appearance-zone): dragged frame follows the pointer's vertical delta via inline `transform: translateY(...)`; crossing a sibling's midpoint shuffles the preview — siblings take short TugAnimator translate tweens to their would-be positions (`key` distinct from `imposer-flip`), the working order updates.
- Corridor exit check per frame: pointer x outside the band → run the existing latch body (occlusion begin, `releaseImposedFrame`, `dragStartPosition` re-seed, clear all reorder transforms/tweens) and set the gesture's mode to free — one-way; the remainder of the gesture is byte-for-byte today's free drag, including the `{ evictSlot: true }` drop.
- Drop in reorder mode: per Risk R02 — keep `data-gesture` through the commit, measure the dragged frame's transformed rect (First), clear sibling preview transforms, call `onSetRailOrder(side, order)` (new prop → `store.setRailOrder`), then FLIP the dragged frame from First to its committed rect via `animate(..., { key: "imposer-flip", slotCancelMode: "snap-to-end", easing: "linear", fill: "none" })` with `springKeyframes` from `lib/pane-flip.ts`, clearing transform + `data-gesture` on finish (both promise arms). No-travel release: unchanged (click / Cmd-click picker).
- Cmd-drag in a split rail: keeps its move-without-raising meaning in free mode; in reorder mode Cmd changes nothing (reorder never raises).

**Tasks:**
- [ ] Manual smoke, thorough — this is the feature's soul: reorder 2- and 3-member rails; diagonal drags stay reorders inside the corridor; deliberate drag-out unpins exactly as today; drop mid-shuffle lands the previewed order; a second arrangement change mid-settle doesn't stack tweens; tune `RAIL_CORRIDOR_SLOP_PX` by feel and record the final value in [Q01] if it moves.

**Tests:**
- [ ] (Gesture choreography is manual + #step-10's `setRailOrder` geometry assertion per #test-non-goals; keyframe math is already unit-tested in `pane-flip`.)

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`

---

#### Step 8: Layout section rail rows + miniature {#step-8}

**Depends on:** #step-3

**Commit:** `tugways(sidebar-split-lens): per-shared-side Stack|Split rows with split previews [L02][L06]`

**References:** [P08] layout-section row, Spec S04, (#investigation-findings — the section's sender/preview anatomy)

**Artifacts:**
- In `layouts-section.tsx`: `RAIL_SENDER_PREFIX = "lens-layouts-rail:"` + caption-id prefix; one row per side with 2+ *visible pinned* members (derive from the deck snapshot the section already subscribes to — `useImposition` grows a sibling read, or the body reads `findSidebarPanes` through the store selector; keep it [L02]); caption `LEFT RAIL` / `RIGHT RAIL`; `TugChoiceGroup` Stack | Split routed in the section's one `SELECT_VALUE` handler to `dispatchCommand(TUG_ACTIONS.SET_RAIL_MODE, { side, mode })`; focus orders after the sidebar groups (extend the `LAYOUTS_FIRST_SIDEBAR_FOCUS_ORDER` arithmetic).
- Preview layers `railmode:<side>:<mode>` added to the `layers` array with `data-preview-axis` stamped on the new rows, so hover/keyboard preview works through the existing `setPreview`/`previewIdOf`/MutationObserver machinery unchanged.
- `LayoutMiniature`: a per-side mode input (extend `MiniatureRails` values or add a `railModes` prop — keep the component presentational, no store reads); a split rail draws its box divided into `count` stacked segments with hairline seams instead of the stacked-paper offset.

**Tasks:**
- [ ] Verify the collapsed summary stays kind-only (the band has room for one fact — unchanged).
- [ ] Manual smoke: rows appear only when a side is shared; hover previews the divided rail before committing; keyboard cursor previews the same way; committing settles the real deck.

**Tests:**
- [ ] (Covered by #step-10's real-click flow; action validation already tested in #step-3.)

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`

---

#### Step 9: tuglaws amendments {#step-9}

**Depends on:** #step-5, #step-7

**Commit:** `tuglaws(pane-model): a shared rail is a stack by default; the user may split it`

**References:** [P01]–[P11] (the decisions this durable record captures), (#documentation-plan)

**Artifacts:**
- `tuglaws/pane-model.md` and `tuglaws/design-decisions.md` amendments per the Documentation Plan, written in the documents' existing voice; the geometry-modes table's pinned row states both rail arrangements and where each lives ([P01]'s record, Spec S02's properties).

**Tasks:**
- [ ] Read the amended sections against the shipped code from #step-5/#step-7 before committing (review pass; the Files-table sync is part of pane-model.md's own contract).

**Tests:**
- [ ] N/A (documentation).

**Checkpoint:**
- [ ] Amended sections cite real symbols that exist in the tree (spot-grep each named symbol).

---

#### Step 10: App-test + integration checkpoint {#step-10}

**Depends on:** #step-6, #step-7, #step-8, #step-9

**Commit:** `tests(sidebar-split): app-test for split geometry, seam persistence, churn survival`

**References:** [P04]–[P07], [P10], Spec S02, Spec S05, (#success-criteria, #test-non-goals)

**Artifacts:**
- `tests/app-test/at0401-sidebar-split.test.ts` with `@covers` for `tugdeck/src/lib/layout-imposer.ts`, `tugdeck/src/deck-manager.ts`, `tugdeck/src/components/chrome/deck-canvas.tsx`, `tugdeck/src/components/chrome/tug-pane.tsx`, `tugdeck/src/components/lens/sections/layouts-section.tsx`. Model fixture/settle discipline on the existing rail suite (`at0230-pinned-lens-geometry`, `at0276-lens-side-persists`).

**Tasks:**
- [ ] Flow: seed Lens + Jots pinned right; open the Jots badge menu (real click on `tug-pane-title-bar-stack-badge`) and select Split Vertically; settle; assert the Success Criteria tiling invariants from live `getBoundingClientRect()` (tops/bottoms/gap/shared width, ±1px); assert `data-rail-split` on both frames.
- [ ] Seam: drive `setRailShares` via a dispatched gesture-equivalent (or the seam's pointer path if the harness's background pointer can express a short vertical drag — try it first; fall back to the store method through `evalJS` action dispatch, which still exercises `_reimpose` → properties → frames in the real app); assert the two members' heights changed and the third-party member (3-member variant) held its ratio; read the persisted blob (`TUG_APPTEST_JSON`-independent — `GET /api/defaults/dev.tugtool.deck.layout/layout` via the harness's tugbank helper) and assert `rails.right.shares`.
- [ ] Reorder: `setRailOrder(["jots","lens"] → flipped)` and assert the members' vertical positions swapped.
- [ ] Churn: close Jots → Lens holds the full run (top ≈ 5px, bottom ≈ canvas − 32px); reopen Jots → split re-applies with prior order/shares.
- [ ] Re-stack: badge menu → Stack; assert both members' rects are identical again (today's behavior restored).
- [ ] Seam-clamp: drag/set shares past a member minimum and assert the member holds ≥ its `sizePolicy.min.height`.
- [ ] `just app-test-covers-check` passes for the new file (bump `ACCEPTED_FANOUT` with a rationale comment only if it trips).
- [ ] Re-run the existing rail suite: `just app-test at0230-pinned-lens-geometry.test.ts at0276-lens-side-persists.test.ts at0299-lens-edge-drag.test.ts at0231-lens-toggle-focus.test.ts`.

**Tests:**
- [ ] The app-test above is the test.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`
- [ ] `just app-test tests/app-test/at0401-sidebar-split.test.ts`
- [ ] `just app-test-changed` over the working diff (the derived selection; use `--allow-large` only if the derived count exceeds the budget, reporting the count)

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** User-controlled vertical splitting of shared sidebar rails — per-side Stack | Split with persistent order and heights, a draggable seam, corridor-drag reorder, badge and Layout-section controls — shipped on main with unit, contract, and app-test coverage plus the tuglaws record, with stack mode byte-identical to today's behavior.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Every (#success-criteria) item verified by its named mechanism.
- [ ] All ten steps' checkpoints green; ledger fully `done` with commit hashes.
- [ ] tuglaws amendments landed ([D121] + pane-model.md + the new decision).
- [ ] Live window resize still runs zero geometry JS (structural: split pins are `calc()` over properties; the only observer remains the settled-resize retune).

**Acceptance tests:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`
- [ ] `just app-test tests/app-test/at0401-sidebar-split.test.ts`

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Auto-split or split-by-default experiments (only if the shipped feature earns them — the brief's decisions log).
- [ ] Seam keyboard nudge / focus stop ([Q02], when the focus-nav subsystem reopens).
- [ ] A fourth sidebar card exercising the N-member generality for real.

| Checkpoint | Verification |
|------------|--------------|
| Pure math correct | `bun test src/lib/__tests__/layout-imposer.test.ts` |
| Wire contract stable | serialization round-trip + defensive-read + legacy-blob unit tests |
| Real-app behavior | `just app-test tests/app-test/at0401-sidebar-split.test.ts` |
| Nothing regressed on the rails | `at0230`, `at0276`, `at0299`, `at0231` green |
| Production bundle intact | `cd tugdeck && bunx vite build` |
