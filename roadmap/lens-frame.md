## The Lens — panel frame, focus integration, and dev-panel retirement {#lens-frame}

**Purpose:** Ship the Lens — a right-side panel that renders one scrolling stack of reorderable, collapsible **sections** in the location the Tug dev panel occupies today — as a real focus-bearing card, plus the two sections (Log, Telemetry) and the Settings move that let the dev panel be deleted entirely. This is **M3a** of the Lens direction; the Changeset section (M3b) and a Git History section (M3c) are later plans that only add section registrants.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-07-14 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The Dev card's transcript established the house display grammar: one scroll of sections whose blocks expand, sticky headers telescoping via a pin stack (`--tugx-pin-stack-top`). The Lens generalizes that grammar to a **panel-level workbench** — co-resident sections (changeset, git history, telemetry, log) visible together, *without tab-switching*. The hallmark that makes a stack of sections beat a tab bar is the **informative collapsed header**: a collapsed section is not a dead title but a one-line live summary that answers the section's question at a glance. This is a hard requirement of the section contract — every section must supply a collapsed-summary.

The Lens takes over the screen real estate and the keybinding budget of the current **Tug dev panel** (`tugdeck/src/components/tug-dev-panel/`), which is a fixed right-side overlay with a three-tab strip (Telemetry / Log / Settings) and *zero* focus-system integration. Once the Lens hosts Log and Telemetry, and the dev panel's one real Setting (focus-ring modality) moves to the Settings card, the dev panel is deleted outright: component, store, actions, and the Swift menu item.

#### Strategy {#strategy}

- Build the Lens as a **real registered card** (`registerCard`) with a new `"anchored"` placement so it renders as a fixed right-edge overlay (like the dev panel — no deck reflow in v1) while still receiving a `FocusContext` natively through `CardIdContext` → `FocusManager`. That is what makes Cmd-L focus-in possible; the dev panel had none of it. See [P01].
- Land the frame in milestone slices, each independently green: **(A)** panel shell + persisted store + keybindings + focus in/out; **(B)** section registry + sticky band + drag reorder + `…` visibility menu; **(C)** the Log + Telemetry sections; **(D)** the Settings "General" tab move; **(E)** dev-panel deletion + test sweep.
- Model the section **band** on `TugTranscriptEntry`'s participant band (a sticky title row that writes `--tugx-pin-stack-top` for its subtree), **not** on `BlockChrome` — a BlockChrome band would nest changeset content three sticky levels deep in M3b. See [P05].
- Keep every section body **host-agnostic** (cardable-in-future): the band descriptor is separate from the body factory, and a body imports no lens-panel internals. Not built as deck cards now, but the contract must not preclude it. See [P04].
- Reuse existing house patterns wholesale: the dev-panel store shape (tugbank-persisted reducer), the dev-panel resize-handle DOM-only drag, `TugPopupMenu` for the `…` menu, and an existing house drag interaction for reorder. No new libraries.

#### Success Criteria (Measurable) {#success-criteria}

- Opt-Cmd-L shows/hides the Lens; the panel's open state and width persist across reload (tugbank `dev.tugtool.lens`). Verified by an app-test that toggles via the control action and re-reads the store. ([#step-2], [#step-3])
- Cmd-L moves keyboard focus **into** the Lens (opening it if hidden), Tab walks section-to-section, and Escape (or Cmd-L again) restores the previously focused card. Verified by an app-test asserting `focusManager.keyCard()` before/inside/after. ([#step-3], [#step-6])
- Sections render in a persisted order that survives reload; dragging a section to a new position rewrites both the persisted order and the FocusManager group-walk order. Verified by an app-test. ([#step-6])
- The title-bar `…` menu lists every registered section with a checkmark reflecting visibility; toggling a row shows/hides that section and persists. Verified by an app-test. ([#step-7])
- The Log section renders real `tugDevLogStore` entries with its filters, and its collapsed summary shows live counts (e.g. `124 · 3 warn · 1 error`). The Telemetry section renders the active dev card's real telemetry and names that card. Verified by app-tests driving a real session. ([#step-8], [#step-9])
- The dev panel is gone: `tugdeck/src/components/tug-dev-panel/` and `tugdeck/src/lib/tug-dev-panel-store/` are deleted, `Opt-Cmd-/` is unbound, and `bunx tsc --noEmit && bunx vite build && bun test && cargo` are all green. Verified by [#step-11]'s checkpoint.

#### Scope {#scope}

1. A persisted Lens store (`dev.tugtool.lens`) and the panel shell (fixed right-edge overlay, resizable, with a title bar).
2. The Lens as an anchored registered card with a native FocusContext; keybindings (retire `Opt-Cmd-/`; add `Opt-Cmd-L` toggle, `Cmd-L` focus) and focus in / between / out.
3. A section registry + host-agnostic section contract (required collapsed-summary), the sticky section band, drag reorder, and the `…` visibility menu.
4. Two sections: Log (re-host `tugDevLogStore` + `LogInspector`) and Telemetry (re-host `TelemetryInspector`, following the active dev card).
5. Move the dev panel's focus-ring-modality setting to a new "General" tab on the Settings card.
6. Delete the dev panel entirely and sweep the app-test suite.

#### Non-goals (Explicitly out of scope) {#non-goals}

- The **Changeset** section (M3b) and the **Git History** section (M3c). The frame must be section-agnostic enough that those plans only add registrants.
- Showing a Lens section as its own deck card (future; the contract merely must not preclude it).
- Deck reflow. v1 is a fixed overlay like the dev panel — cards do not shrink to make room.
- Any change to the changeset card itself (it is retired in M3b, not here).

#### Dependencies / Prerequisites {#dependencies}

- The block grammar re-home to `tugdeck/src/components/tugways/blocks/` (already landed, commit `f6904982b`).
- The FocusManager per-card context model (`focus-manager.ts`) and `CardIdContext` (`@/lib/card-id-context`), both present today.
- tugbank defaults persistence (`/api/defaults/<domain>/<key>`, `getTugbankClient()`), the mechanism the dev-panel store already uses.

#### Constraints {#constraints}

- **Tuglaws.** Read `tuglaws/tuglaws.md`, `tuglaws/focus-language.md`, `tuglaws/responder-chain.md`, `tuglaws/pane-model.md`, `tuglaws/component-authoring.md` before touching tugways code. Fill the [State Zone Mapping](#state-zone-mapping). Name touched laws in each commit.
- **Real Tug components only.** Compose `TugPopupMenu` / `TugIconButton` / `TugLabel` / `TugRadioGroup` etc. Never hand-roll a menu, button, or radio. No borrowing of a component's CSS classes in lieu of composing it.
- **No localStorage.** All persistence goes through tugbank (`dev.tugtool.lens`).
- **No height estimates / no windowing.** The panel scroller is a plain `overflow-y:auto` div (like the changeset card's `.changeset-scroll`), rendering sections inline at their real measured heights.
- **Appearance is CSS/DOM ([L06]); external state enters React via `useSyncExternalStore` ([L02]); FocusManager state is structure ([L22]) — never mirrored in `useState`.**
- **Tooling.** bun, never npm. tugdeck HMR is live, but every step must pass `bunx tsc --noEmit && bunx vite build && bun test`. Steps that touch Swift/menus additionally require `just app-test-build` (rebuild + resign). App-tests are real (`tests/app-test/`, `just app-test`) — no jsdom, no mocks.
- **Artifact hygiene.** No plan-step numbers in code. No rationale/backstory comments — comments state what the code does.

#### Assumptions {#assumptions}

- `Cmd-L` is currently unbound in both tracks. **Verified:** `grep "KeyL" keybinding-map.ts` → no match; no Swift menu item uses `keyEquivalent: "l"` with `.command` alone (only `"/"` + `[.command,.option]` for the dev panel). Re-verify at implementation time.
- The Lens can drive the FocusManager directly (`adoptKeyCard` / `setKeyCard` / `focusKeyView`) for an overlay card that is **not** in the deck layout tree, because `contextFor(cardId)` lazily creates a context for any id and `focusKeyView()` delegates to the active context. See [R01] for the risk this raises.
- The log store's persisted filter prefs (under `dev.tugtool.dev-panel`) may keep that domain string for data continuity even after the dev panel is deleted, as long as the constant is re-homed off the deleted store. See [P08].

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit `{#anchor}` headings and rich `**References:**` lines. Design decisions are `[P01]`… (plan-local; never `[D01]`, which is reserved for `tuglaws/design-decisions.md`). Steps cite decisions, specs, and anchors — never line numbers.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Does the key-card swap exit the Lens on re-activation of the originally-active card? (DECIDED — verified in [#step-3]) {#q01-keycard-steal}

**Question:** With the [P03] key-card swap in place, does focus leave the Lens when the user re-activates *the same* deck card that was active before Cmd-L? (Passive deck churn is already handled — the `syncKeyCard` `next === lastKeyCard` change-gate early-returns, so it does not clobber the Lens.)

**Why it matters:** After Cmd-L, `focusManager.keyCard()` is `LENS` but the provider's `lastKeyCard` still names the pre-Cmd-L card. Re-activating that same card leaves `deckStore.getFirstResponderCardId()` unchanged, so `syncKeyCard` early-returns and never calls `setKeyCard`. Focus-out on that path must therefore ride the activation channel (`adoptKeyCard` via `applyBagFocus`), not `syncKeyCard`. If neither fires, focus is stuck in the Lens.

**Plan to resolve:** Spike in [#step-3] — drive Cmd-L, then (a) push a background deck store change and assert `keyCardId` stays `LENS` (change-gate holds), and (b) re-activate the pre-Cmd-L card via a real activation and assert `keyCardId` leaves `LENS`. If (b) fails, add an explicit focus-out on deck-activation (e.g. the Lens ResponderScope observes activation and restores the stashed card, or clear the stash so the next `adoptKeyCard` wins).

**Resolution:** DECIDED — swap model ([P03]); the two-part behavior above is verified by an app-test in [#step-3].

#### [Q02] Match a prior "…" overflow affordance? (DEFERRED — [#step-7]) {#q02-overflow-affordance}

**Question:** The direction note asks to "bring back" a prior `…` overflow affordance and match its visual treatment. Does one exist to match?

**Why it matters:** Visual consistency; avoids inventing a treatment that diverges from an established one.

**Plan to resolve:** `git log -S MoreHorizontal -- tugdeck/src` returned **nothing**, and no `MoreHorizontal`/`MoreVertical`/`Ellipsis` menu-trigger exists in the current tree (only text ellipsis in `tug-label`, `middle-ellipsis-path`). Absent a prior treatment, default to the house pattern: a `TugIconButton` with a lucide `MoreHorizontal` glyph as the trigger for a `TugPopupMenu`. Re-run the search at implementation time in case history surfaces one.

**Resolution:** DEFERRED to [#step-7] with the documented default (MoreHorizontal + `TugPopupMenu`).

#### [Q03] Persist collapse state, or keep it session-local? (DECIDED — persist, see [P02]) {#q03-collapse-persistence}

**Question:** Is per-section collapse persisted (`collapsedSections` store key) or component-local ([L24] `useState`)?

**Why it matters:** The direction lists `collapsedSections` as a store key **and** calls collapse "local-data [L24]" — a tension. Persisting it survives reload (matches the dev-panel-store precedent for `activeTab`); keeping it local is simpler but forgets the user's arrangement.

**Resolution:** DECIDED — persist it. Collapse is a user arrangement of the same class as section order and visibility, all of which persist. The store is the source of truth ([L02]); the expand/collapse *appearance* is driven by a `data-collapsed` attribute + CSS ([L06]). See [P02] and the [State Zone Mapping](#state-zone-mapping).

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| `syncKeyCard`/`lastKeyCard` desync leaves focus stuck in the Lens | med | med | Swap model relies on the `next === lastKeyCard` change-gate; [Q01] spike verifies re-activation of the originally-active card exits the Lens ([#step-3]) | Focus won't leave the Lens when clicking back into the pre-Cmd-L card |
| Deleting `tug-dev-panel-store` breaks the log store's domain import | med | high | Re-home the domain constant off the store before deletion ([P08], [#step-8]) | tsc error on `DEV_PANEL_DOMAIN` import |
| Three-deep sticky nesting when M3b lands changeset in a section | med | med | Band models `TugTranscriptEntry`, not `BlockChrome` ([P05]); the pin-clearance pattern is proven in `changeset-card.css` | M3b changeset headers overlap the section band |

**Risk R01: Anchored key card vs. deck activation authority** {#r01-keycard}

- **Risk:** The Lens is a key card that is not in the deck layout tree. The deck's `syncKeyCard` is the structural authority for `keyCardId`, and after Cmd-L the provider's `lastKeyCard` and `focusManager.keyCard()` desync (see [P03]) — the concrete failure is that re-activating the *originally-active* deck card early-returns in `syncKeyCard` and never fires `setKeyCard`, so focus may not leave the Lens on that path.
- **Mitigation:** The swap model's `next === lastKeyCard` change-gate already prevents passive churn from clobbering the Lens ([P03]). In [#step-3], the [Q01] spike drives Cmd-L then re-activates the pre-Cmd-L card and asserts focus leaves the Lens (relying on the activation channel `adoptKeyCard`, not `syncKeyCard`); an app-test pins it.
- **Residual risk:** Edge orderings at cold boot (focus claim racing the store notify) may still need a targeted fix; the `adoptKeyCard` docstring already warns about this ordering.

**Risk R02: Log store persistence coupling** {#r02-log-domain}

- **Risk:** `tug-dev-log-store.ts` imports `DEV_PANEL_DOMAIN` from `tug-dev-panel-store/types`; deleting the store breaks the build, and a test (`tug-dev-log-store/__tests__/persistence.test.ts`) imports the same symbol.
- **Mitigation:** [#step-8] re-homes the domain constant into the log store (same string `dev.tugtool.dev-panel` for data continuity) and repoints the test import, **before** [#step-11] deletes the dev-panel store.
- **Residual risk:** None once the import is severed.

---

### Design Decisions {#design-decisions}

#### [P01] The Lens is a real card with a new `"anchored"` placement (DECIDED) {#p01-anchored-card}

**Decision:** Register the Lens via `registerCard({ componentId: "lens", placement: "anchored", hidden: true, … })`. Add `"anchored"` to `CardRegistration.placement`. An anchored card is **not** hosted through `CardHost`/`TugPane` and is **not** in the deck layout tree; instead `deck-manager.ts` renders a bespoke `LensPanel` shell at the same overlay-sibling composition point where `TugDevPanel` mounts today (`React.createElement(TugDevPanel, {})` in the fragment near the end of the deck render). `LensPanel` wraps its content in `<CardIdContext value={LENS_CARD_ID}>` + a top-level `ResponderScope`, so the section stack participates in focus and the responder chain.

**Rationale:**
- Being a real card id gives the Lens a `FocusContext` via `focusManager.contextFor(LENS_CARD_ID)` (lazily created), which is exactly what Cmd-L needs and what the dev panel — with zero focus integration — never had.
- Bypassing `CardHost`/`TugPane` avoids dragging in per-card feeds, `useCardStatePreservation`, and pane geometry the fixed overlay does not want. `CardHost` is deeply coupled to pane chrome (`CardPortal` with `hostStackId`, `TugPaneFrameContext`); the Lens needs only `CardIdContext` + `ResponderScope`.
- The registration keeps the id discoverable (`getRegistration("lens")`) and preserves the M3-future path where a section becomes its own deck card.

**Implications:**
- `CardRegistration.placement` union gains `"anchored"`; `hidden: true` keeps it out of the type-picker `[+]`.
- deck-manager composes `LensPanel` directly; DeckCanvas never maps it to a pane.
- The Lens seeds its own key view (title bar / first section) so `focusKeyView()` has a landing spot.

#### [P02] Lens state is one tugbank-persisted store mirroring the dev-panel-store shape (DECIDED) {#p02-lens-store}

**Decision:** A new store `tugdeck/src/lib/lens-store/` under domain `dev.tugtool.lens`, built exactly like `tug-dev-panel-store/` (pure `reducer.ts`, `types.ts`, class wrapper with lazy init, tugbank hydrate + `onDomainChanged` live push + PUT-on-diff). Keys: `open` (bool), `widthPx` (i64), `sectionOrder` (json string[]), `hiddenSections` (json string[]), `collapsedSections` (json string[]).

**Rationale:** The dev-panel-store is a proven, law-conformant ([L02], ref-stable snapshots, no localStorage) template. Mirroring it keeps review surface small and behavior predictable.

**Implications:** `open`, `widthPx`, `sectionOrder`, `hiddenSections`, `collapsedSections` are all data ([L02]); the live drag and the collapse/visibility *appearance* are CSS/DOM ([L06]). Unknown/`hidden` sections in a persisted list are tolerated (a future-shape entry must not crash), exactly as the dev-panel reducer rejects unknown tab ids.

#### [P03] Focus model for the Lens (DECIDED — key-card swap) {#p03-focus-model}

**Decision:** Cmd-L (`FOCUS_LENS`) uses the **key-card swap** model: ensure open → stash `focusManager.keyCard()` → `focusManager.setKeyCard(LENS_CARD_ID)` → land DOM focus (see the open-then-focus rule below). Focus-out (Escape inside the Lens, or Cmd-L while already inside): `setKeyCard(stashedPriorCardId)` and re-focus. Tab walks sections via `FocusContext.setGroupOrder` (rewritten on reorder).

The swap model is viable because `syncKeyCard` (`responder-chain-provider.tsx`, the deck's structural authority for `keyCardId`) **gates on `next === lastKeyCard` before calling `setKeyCard`**, and computes `next` from `deckStore.getFirstResponderCardId()` — which never names the Lens. So passive deck-store churn early-returns and does **not** clobber the Lens's key-card claim; only a genuine activation of a *different* deck card changes `next` and naturally pulls focus back out (the desired focus-out).

**Open-then-focus ordering (mandatory).** When Cmd-L opens a *closed* Lens, `open` flows through the store → React re-render → the panel transitions `display:none`→visible on a later tick, so the seeded focusable is not yet mounted when the handler runs. A synchronous `focusManager.focusKeyView()` would no-op. Route the first-open focus-in through **`focusManager.armKeyboardRestore(\`${group}:${order}\`)`** (`focus-manager.ts` — "restored a keyboard key view whose element had not yet mounted; the ring re-lights when that focusable registers"). Call the synchronous `focusKeyView()` only when the panel is already open.

**Rationale:** Mirrors the focus-mode restore fields (`restoreKeyView` / `restoreFirstResponder`) and the late-mount ring-resume (`armKeyboardRestore`) the engine already uses; keeps the Lens's focus lifecycle inside the FocusManager (structure, [L22]) rather than React state.

**Implications:**
- A `FOCUS_LENS` handler lives on the deck/canvas-level responder — **confirmed** `SHOW_SETTINGS` is handled there (`deck-canvas.tsx`), reached by the default first-responder walk — because the keybinding dispatches through the chain and the Lens overlay may be closed (absent from the chain) when Cmd-L fires.
- The swap leaves a **desync** to verify in [#step-3]: after Cmd-L, `focusManager.keyCard()` is `LENS` but the provider's `lastKeyCard` still names the previously-active deck card. Re-activating *that same* card won't fire `syncKeyCard` (early return), so focus-out on that specific path leans on the activation channel (`adoptKeyCard` via `applyBagFocus`), not `syncKeyCard`. The [Q01] spike must confirm focus leaves the Lens when the originally-active card is re-activated.

#### [P04] Section bodies are host-agnostic; band descriptor is separate from body factory (DECIDED) {#p04-cardable}

**Decision:** `LensSectionDefinition` separates a **band descriptor** (`kind`, `title`, `glyph`, the required `collapsedSummary` factory) from a **body factory** (`(host: LensSectionHost) => React.ReactNode`). A body imports nothing from `lens-panel/`; anything it needs from the panel arrives via the `host` argument. Reserved capability hooks (`findSegments?`, `followBottom?`, `responderNeeds?`) are declared in the type but unimplemented.

**Rationale:** M3-future may render a section as its own deck card; a body that reaches into panel internals would preclude that. Keeping the collapsed-summary factory in the *descriptor* (not the body) is what lets the band render a live summary while the body is unmounted/collapsed.

**Implications:** The Log/Telemetry bodies are plain components taking their data from their own global/per-card stores, not from the panel. The `collapsedSummary` factory subscribes to the same store and returns a one-line node.

#### [P05] The section band models `TugTranscriptEntry`, not `BlockChrome` (DECIDED) {#p05-band-model}

**Decision:** The section band is a sticky title row (glyph + title + collapsed-summary + drag grip + chevron) that writes `--tugx-pin-stack-top` for its subtree via the `TugTranscriptEntry` pattern: a `useLayoutEffect` + `ResizeObserver` measuring the band header height onto the section root as `--tugx-pin-stack-top` (`Math.ceil(px) + TIER_GAP_PX`), so nested block headers telescope beneath it. The nested-clearance pattern is the `.changeset-entry-block` pair in `changeset-card.css` (`--…-pin-clearance = calc(var(--tugx-pin-stack-top,0px) + var(--tugx-block-header-height,0px))`, re-published as the child subtree's `--tugx-pin-stack-top`).

**Rationale:** A `BlockChrome`-based band would make M3b's changeset content nest three sticky levels deep (panel band → block chrome → block header). Modeling the participant band keeps it two levels and reuses a proven, non-cyclic clearance-capture.

**Implications:** Copy the `ResizeObserver` measurement discipline verbatim (do **not** seed synchronously with `getBoundingClientRect` — the `TugTranscriptEntry` docstring documents the O(n²) reflow that causes). A static `--tugx-pin-stack-top` CSS fallback covers the first frame.

#### [P06] Reorder rewrites both persisted order and the FocusManager group order (DECIDED) {#p06-reorder}

**Decision:** Drag-and-drop reorder (grounded in an existing house drag pattern, not a new DnD library) commits the new order to `lensStore.setSectionOrder(...)`; the panel renders in `sectionOrder` and, in a `useLayoutEffect`, calls `focusManager.contextFor(LENS_CARD_ID).setGroupOrder([...visible section groups])` so the Tab walk tracks the visual order.

**Rationale:** [L22] — the group order is structure owned by the FocusManager, driven off the store, never a parallel `useState`. Persisted order + synchronized keyboard walk is the whole point of "reorderable sections."

**Implications:** Live drag preview is DOM-only ([L06] / [L08] mutation-transaction); only the commit writes the store.

#### [P07] Telemetry follows the active dev card; no manual picker (DECIDED) {#p07-telemetry-follows}

**Decision:** The Telemetry section reads `focusManager.keyCard()` to pick the card whose `cardServicesStore.getServices(cardId)` it inspects, names that card in its band, and degrades gracefully (empty state) when the key card is not a dev card or none exists. It drops the dev panel's manual `selectedCardId` picker (`CardPicker`).

**Rationale:** The Lens is always-present chrome; "the card I'm working in" is the natural subject, and the FocusManager already tracks it. A manual picker in an always-open panel is friction.

**Implications:** `TelemetryInspector`'s current `{ selectedCardId }` prop becomes an internal read of `focusManager.keyCard()` via `useSyncExternalStore(focusManager.subscribe, () => focusManager.keyCard())` — **confirmed** the manager exposes a public `subscribe(callback)` (`focus-manager.ts`) and `setKeyCard` fires `touch()→notify()` only on a real change, so the section re-renders exactly when the key card changes. `notifyCardGone` wiring (`main.tsx` `knownCardIdsForDevPanel`) is not needed by the Lens and is removed with the dev panel.

#### [P08] Re-home the log store's persistence domain off the deleted store (DECIDED) {#p08-log-domain}

**Decision:** Before deleting `tug-dev-panel-store/`, move the `DEV_PANEL_DOMAIN = "dev.tugtool.dev-panel"` constant the log store depends on into the log store's own module (keep the **same string** so existing persisted filter prefs survive). Repoint `tug-dev-log-store/__tests__/persistence.test.ts` to the new home.

**Rationale:** `tug-dev-log-store.ts` currently imports `DEV_PANEL_DOMAIN` from `tug-dev-panel-store/types`; the store is panel-independent, so the coupling is incidental. Keeping the string avoids orphaning users' persisted log filters.

**Implications:** The log store gains a local `LOG_STORE_DOMAIN` constant; no data migration.

#### [P09] The dev panel's Settings tab becomes a new "General" tab on the Settings card (DECIDED) {#p09-settings-move}

**Decision:** Move the focus-ring-modality control (`SettingsInspector` content) to a **new** user-facing "General" tab on the Settings card (`settings-card.tsx`). The existing `SettingsTabId` value `"general"` — currently mislabeled "Dev Card" and rendering `SettingsGeneralBody` — is renamed to `"devCard"` (grep consumers first), freeing `"general"` for the real General tab.

**Rationale:** Focus-ring modality is a genuine app setting that has outgrown the dev surface. The id/label mismatch (`"general"` labeled "Dev Card") is a latent trap; fix it while adding the new tab.

**Implications:** New `settings-general-body.tsx`-style body composing `TugRadioGroup` via `useResponderForm` (the `settings-app-body.tsx` shape); `focusRingModalityStore` and its `dev.tugtool.app/focusRingModality` persistence are unchanged.

#### [P10] Relocate the shared inspector helpers out of `tug-dev-panel/` before deletion (DECIDED) {#p10-relocate-helpers}

**Decision:** The section bodies re-use five helpers that today live **under** `tugdeck/src/components/tug-dev-panel/` and would be destroyed by [#step-11]'s directory deletion. They are **moved** (not re-imported from their old path) into a Lens-owned shared home — `tugdeck/src/components/lens-panel/internal/` — as part of the steps that consume them, and their tests move with them:

| Helper (current path) | Consumed by | Moves in |
|---|---|---|
| `tug-dev-panel/copy-as-json.ts` | Log + Telemetry bodies | [#step-8] |
| `tug-dev-panel/inspectors/log-row.tsx` | Log body | [#step-8] |
| `tug-dev-panel/field-row.tsx` | Telemetry body | [#step-9] |
| `tug-dev-panel/field-section.tsx` | Telemetry + Settings bodies | [#step-9] (Settings re-points in [#step-10]) |
| `tug-dev-panel/inspectors/telemetry-projection.ts` | Telemetry body | [#step-9] |

`copy-as-json` is needed by the Log body in [#step-8] and re-used by Telemetry in [#step-9]; move it in [#step-8] and import from the new home thereafter. `field-section` is also used by the Settings move ([#step-10]) — [#step-10] imports it from the relocated home, not the old one.

**Rationale:** [#step-11] deletes `tug-dev-panel/` **entirely**. Any section body that imports a helper from the old path would break the build at deletion. Moving the helpers as they are consumed keeps every step green and leaves [#files-deleted] listing only files that are genuinely gone (not files that merely moved).

**Implications:** [#files-deleted] must **not** list the five helpers (they moved). Update the `New files` inventory to include their new `lens-panel/internal/` homes. `settings-inspector.tsx`'s own logic folds into the new Settings General body ([#step-10]); only its `field-section` import is repointed.

---

### Specification {#specification}

#### Terminology {#terminology}

- **Lens** — the right-side panel. **Section** — one reorderable/collapsible unit in the Lens stack. **Band** — a section's sticky title row. **Collapsed-summary** — the one-line live node a band shows when the section is collapsed (required). **Anchored placement** — the fixed right-edge overlay treatment for the Lens card.

**Spec S01: `LensSectionDefinition`** {#s01-section-def}

```ts
export interface LensSectionDefinition {
  kind: string;                       // stable id, e.g. "log", "telemetry"
  title: string;                      // band title
  glyph: React.ReactNode;             // band glyph (lucide icon)
  collapsedSummary: (host: LensSectionHost) => React.ReactNode; // REQUIRED — the hallmark
  body: (host: LensSectionHost) => React.ReactNode;             // host-agnostic body
  // Reserved capability hooks — declared, NOT implemented in this plan:
  findSegments?: unknown;
  followBottom?: unknown;
  responderNeeds?: unknown;
}
export function registerLensSection(def: LensSectionDefinition): void;
export function getRegisteredLensSections(): ReadonlyMap<string, LensSectionDefinition>;
```

`LensSectionHost` carries only what a body legitimately needs from the panel (e.g. the Lens card id for focus registration, a `focusGroup` string for the section). It must **not** expose panel internals; [P04].

**Spec S02: Lens title-bar anatomy** {#s02-title-bar}

Left-to-right: **title** ("Lens") · flexible spacer · **`…` menu button** (`TugIconButton` + `MoreHorizontal`, opens the section-visibility `TugPopupMenu`) · **chevron** (collapse/expand the whole panel body — optional in v1; the `…` sits to its *left* per the direction) · **close affordance** (`TugIconButton` + `X`, the dev panel's close idiom, calls `lensStore.setOpen(false)`). The title bar is always present while the panel is open, so the `…` menu is always reachable even when every section is hidden. It is also the initial key-view seed home when no section holds focus.

**Spec S03: Lens store keys** {#s03-store-keys}

| Key | tugbank kind | Meaning |
|-----|-------------|---------|
| `open` | bool | panel visibility |
| `widthPx` | i64 | panel width (min 320, max `innerWidth − 80`) |
| `sectionOrder` | json | `string[]` of section kinds, top-to-bottom |
| `hiddenSections` | json | `string[]` of hidden section kinds |
| `collapsedSections` | json | `string[]` of collapsed section kinds |

Width floor/ceiling reuse the dev-panel constants' values (min 320, left gutter 80).

#### State Zone Mapping (tugdeck/tugways) {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| Lens `open` | structure/data | `lensStore` + `useSyncExternalStore`; visibility via `data-open` + CSS `display:none` | [L02], [L06] |
| Lens `widthPx` (committed) | data | `lensStore` + `useSyncExternalStore` | [L02] |
| Lens width (live drag) | appearance | DOM `style.setProperty("--tugx-lens-width", …)`, commit on pointerup | [L06], [L08] |
| `sectionOrder` | data | `lensStore` | [L02] |
| section Tab-walk order | structure | `FocusContext.setGroupOrder`, driven off `sectionOrder` in `useLayoutEffect` | [L22], [L03] |
| `hiddenSections` | data | `lensStore` | [L02] |
| `collapsedSections` | data | `lensStore`; expand/collapse visual via `data-collapsed` + CSS | [L02], [L06] |
| section band sticky offset | appearance | `--tugx-pin-stack-top` written via `useLayoutEffect` + `ResizeObserver` | [L06], [L03] |
| Lens key card / focus-in-out | structure | `focusManager.setKeyCard` / `focusKeyView` / stashed prior | [L22] |
| Telemetry "active card" | structure (read) | `focusManager.keyCard()` read live, subscribed | [L07], [L02] |
| drag-reorder live preview | appearance | DOM-only until commit | [L06], [L08] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/lib/lens-store/types.ts` | domain `dev.tugtool.lens`, snapshot shape, constants |
| `tugdeck/src/lib/lens-store/reducer.ts` | pure reducer (mirrors dev-panel reducer) |
| `tugdeck/src/lib/lens-store/lens-store.ts` | class wrapper: hydrate/subscribe/persist |
| `tugdeck/src/components/lens-panel/lens-panel.tsx` | the panel shell (overlay, title bar, section stack) |
| `tugdeck/src/components/lens-panel/lens-panel.css` | `--tugx-lens-*` chrome |
| `tugdeck/src/components/lens-panel/lens-resize-handle.tsx` | left-edge drag (mirrors dev-panel `resize-handle`) |
| `tugdeck/src/components/lens-panel/lens-section-band.tsx` | sticky band (models `TugTranscriptEntry`) |
| `tugdeck/src/components/lens-panel/lens-section-band.css` | band + pin-clearance CSS |
| `tugdeck/src/components/lens-panel/lens-section-registry.ts` | `registerLensSection` + `LensSectionDefinition` |
| `tugdeck/src/components/lens-panel/lens-register-card.ts` | `registerLensCard()` (anchored placement) |
| `tugdeck/src/components/lens-panel/sections/log-section.tsx` | Log section (descriptor + body + collapsed summary) |
| `tugdeck/src/components/lens-panel/sections/telemetry-section.tsx` | Telemetry section |
| `tugdeck/src/components/tugways/cards/settings-general-body.tsx` (new "General") | focus-ring modality body (or a new file; see [#step-10]) |

**Relocated (moved, not new — see [P10]).** These are *moved* out of `tug-dev-panel/` (deleted in [#step-11]) into `tugdeck/src/components/lens-panel/internal/`, tests included:

| Moves from | Moves to | In step |
|------------|----------|---------|
| `tug-dev-panel/copy-as-json.ts` | `lens-panel/internal/copy-as-json.ts` | [#step-8] |
| `tug-dev-panel/inspectors/log-row.tsx` | `lens-panel/internal/log-row.tsx` | [#step-8] |
| `tug-dev-panel/field-row.tsx` | `lens-panel/internal/field-row.tsx` | [#step-9] |
| `tug-dev-panel/field-section.tsx` | `lens-panel/internal/field-section.tsx` | [#step-9] |
| `tug-dev-panel/inspectors/telemetry-projection.ts` | `lens-panel/internal/telemetry-projection.ts` | [#step-9] |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `placement: "anchored"` | union member | `card-registry.ts` `CardRegistration.placement` | new |
| `FOCUS_LENS`, `TOGGLE_LENS` | action consts | `action-vocabulary.ts` `TUG_ACTIONS` | new |
| Cmd-L / Opt-Cmd-L bindings | entries | `keybinding-map.ts` `KEYBINDINGS` | new |
| `"toggle-lens"`, `FOCUS_LENS` handlers | `registerAction` / chain handler | `action-dispatch.ts` (+ deck/canvas responder) | new |
| `LENS_CARD_ID` | const | `lens-store/types.ts` or `lens-register-card.ts` | e.g. `"lens"` |
| "Show Lens" menu item | Swift | `AppDelegate.swift` (replaces `maker.devPanel`) | `Opt-Cmd-L` |
| `LOG_STORE_DOMAIN` | const | `tug-dev-log-store.ts` | re-home off `tug-dev-panel-store` |
| `SettingsTabId` `"general"`→ new; `"general"`→`"devCard"` | union edit | `settings-card.tsx` | [P09] |

#### Files deleted (in [#step-11]) {#files-deleted}

`tugdeck/src/components/tug-dev-panel/` (all) — **except** the five helpers already relocated by [P10] in [#step-8]/[#step-9] (`copy-as-json`, `log-row`, `field-row`, `field-section`, `telemetry-projection`), which have moved to `lens-panel/internal/` and must be gone from `tug-dev-panel/` before this deletion; `tugdeck/src/lib/tug-dev-panel-store/` (all); the three `registerAction` dev-panel entries in `action-dispatch.ts`; the `maker.devPanel` menu item + `showDevPanel(_:)` handler in `AppDelegate.swift`; the `registerDevPanelInspectorTabs()` call + `knownCardIdsForDevPanel` block in `main.tsx`.

---

### Test Plan Concepts {#test-plan-concepts}

Real app-tests only (`tests/app-test/`, `just app-test`), driving the actual Tug.app. New at-numbers: **at0230–at0235** are genuinely free (max used is `at0229`, which has a two-file collision; `at0227` is a gap best left alone). Claim sequentially from at0230.

| Category | Purpose |
|----------|---------|
| Integration (app-test) | Lens toggle persistence; Cmd-L focus in/out; reorder persistence; `…` visibility toggle; Log + Telemetry render real data |
| Unit (`bun test`) | `lens-store` reducer purity + hydrate + persist-diff; section registry register/get |

#### What stays out of tests {#test-non-goals}

- No jsdom render tests, no mock-store assertions, no synthetic fixtures — banned patterns; drive the real app.
- No pixel-snapshot of the band; assert structure/attributes and store/focus state instead.

---

### Execution Steps {#execution-steps}

> Commit after all checkpoints pass. Every step runs `bunx tsc --noEmit && bunx vite build && bun test`; Swift/menu steps additionally run `just app-test-build`. Name touched laws in each commit message.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Lens store (`dev.tugtool.lens`) | pending | — |
| #step-2 | Anchored placement + panel shell + mount | pending | — |
| #step-3 | Keybindings + control actions + Swift menu + focus in/out | pending | — |
| #step-4 | Section registry + contract + stack render | pending | — |
| #step-5 | Sticky section band + collapse | pending | — |
| #step-6 | Drag reorder + group-order sync | pending | — |
| #step-7 | Title-bar `…` visibility menu | pending | — |
| #step-8 | Log section | pending | — |
| #step-9 | Telemetry section | pending | — |
| #step-10 | Settings "General" tab move | pending | — |
| #step-11 | Delete dev panel + test sweep | pending | — |

---

#### Step 1: Lens store (`dev.tugtool.lens`) {#step-1}

**Commit:** `tugdeck(lens-store): tugbank-persisted Lens store (open/width/order/hidden/collapsed) [L02]`

**References:** [P02] Lens store, Spec S03, (#state-zone-mapping)

**Artifacts:**
- `tugdeck/src/lib/lens-store/{types.ts,reducer.ts,lens-store.ts}` + `__tests__/`.

**Tasks:**
- [ ] Mirror `tugdeck/src/lib/tug-dev-panel-store/` structure: pure `reducer.ts` (ref-stable — return same reference on no-op), `types.ts` (domain `dev.tugtool.lens`, `LENS_KEYS`, snapshot shape, width constants reusing values 320 / 80), class wrapper with lazy `_ensureInitialized`, tugbank hydrate, `onDomainChanged` live push, PUT-on-diff.
- [ ] Keys: `open` (bool), `widthPx` (i64), `sectionOrder`/`hiddenSections`/`collapsedSections` (json `string[]`). Tolerate missing/unknown values on hydrate (reject, keep existing) — mirror the dev-panel reducer's `hydrate` handling.
- [ ] Public API: `subscribe`, `getSnapshot`, `toggle`, `setOpen`, `setWidth`, `setSectionOrder`, `setHidden(kind, hidden)`, `setCollapsed(kind, collapsed)`.

**Tests:**
- [ ] `bun test` unit: reducer no-op reference stability; each setter transition; hydrate rejects a malformed `sectionOrder`.

**Checkpoint:**
- [ ] `bunx tsc --noEmit && bunx vite build && bun test`

---

#### Step 2: Anchored placement + panel shell + mount {#step-2}

**Depends on:** #step-1

**Commit:** `tugdeck(lens): anchored card placement + LensPanel overlay shell [L06][L20]`

**References:** [P01] anchored card, Spec S02 title bar, (#p01-anchored-card, #files-deleted)

**Artifacts:**
- `card-registry.ts` `placement` gains `"anchored"`.
- `tugdeck/src/components/lens-panel/{lens-panel.tsx,lens-panel.css,lens-resize-handle.tsx,lens-register-card.ts}`.
- deck-manager composes `LensPanel` at the current `TugDevPanel` sibling point.

**Tasks:**
- [ ] Add `"anchored"` to `CardRegistration.placement`.
- [ ] `lens-register-card.ts`: `LENS_CARD_ID = "lens"`; `registerLensCard()` → `registerCard({ componentId: LENS_CARD_ID, placement: "anchored", hidden: true, contentFactory: () => null /* rendered by LensPanel shell */, defaultMeta: { title: "Lens", closable: true } })`. Call it from `main.tsx` alongside the other `register*Card()` calls.
- [ ] `LensPanel`: fixed right-edge overlay (copy the dev-panel CSS positioning: `position:fixed; top/right/bottom:0; width: var(--tugx-lens-width); z-index: calc(var(--tug-z-overlay-base) - 1)` — the 8999 tier documented in `tug-dev-panel.css`, so popups still paint above it). `data-open` toggles `display:none` ([L06]). Own `--tugx-lens-*` slots ([L20]); one-hop to `--tug7-*` ([L17]).
- [ ] Wrap content in `<CardIdContext value={LENS_CARD_ID}>` + a top-level `ResponderScope` ([P01]). Read the store via `useSyncExternalStore` for `open`/`widthPx`.
- [ ] Title bar per Spec S02 (title, `…` placeholder button, close `X` → `lensStore.setOpen(false)`). Section stack is a plain `overflow-y:auto` div (no windowing).
- [ ] `lens-resize-handle.tsx`: copy `resize-handle.tsx` — left-edge drag writes `--tugx-lens-width` live ([L06]), commits `lensStore.setWidth` on pointerup, clears the inline override.
- [ ] In `deck-manager.ts`, replace the `React.createElement(TugDevPanel, {})` sibling with `React.createElement(LensPanel, {})` **only after** the dev panel is deleted — for THIS step, add `LensPanel` as an additional sibling next to `TugDevPanel` so both coexist until [#step-11]. Update imports (`deck-manager.ts` currently imports `TugDevPanel` at the top).
- **Transitional overlap note:** through [#step-10], `LensPanel` and `TugDevPanel` are both right-edge fixed overlays at the same z-tier (8999). This is harmless — the dev panel defaults closed and tests drive one at a time — but if both are opened at once they visually stack. Fully resolved when [#step-11] removes the dev panel.

**Tests:**
- [ ] app-test **at0230**: seed `dev.tugtool.lens/open=true`, assert the `.lens-panel[data-open="true"]` overlay is present at the right edge; toggle `setOpen(false)` and assert `display:none`.

**Checkpoint:**
- [ ] `bunx tsc --noEmit && bunx vite build && bun test`
- [ ] `just app-test` (at0230 green)

---

#### Step 3: Keybindings + control actions + Swift menu + focus in/out {#step-3}

**Depends on:** #step-2

**Commit:** `tugdeck+tugapp(lens): retire ⌥⌘/, add ⌥⌘L toggle + ⌘L focus-in/out [L22]`

**References:** [P03] focus model, [Q01] key-card steal, [R01], (#p03-focus-model, #r01-keycard)

**Artifacts:**
- `action-vocabulary.ts` `TUG_ACTIONS.FOCUS_LENS` + `TOGGLE_LENS`.
- `keybinding-map.ts` Cmd-L (`FOCUS_LENS`) + Opt-Cmd-L (`TOGGLE_LENS`, browser-dev parity).
- `action-dispatch.ts` `registerAction("toggle-lens", …)` + a deck/canvas-level `FOCUS_LENS` chain handler.
- `AppDelegate.swift` "Show Lens" menu item (replaces `maker.devPanel`) → `sendControl("toggle-lens")`.

**Tasks:**
- [ ] Add `FOCUS_LENS: "focus-lens"` and `TOGGLE_LENS: "toggle-lens"` to `TUG_ACTIONS`.
- [ ] Keybindings (exact-modifier match keeps Cmd-L and Opt-Cmd-L distinct): `{ key:"KeyL", meta:true, action: FOCUS_LENS, preventDefaultOnMatch:true }` and `{ key:"KeyL", meta:true, alt:true, action: TOGGLE_LENS, preventDefaultOnMatch:true }`. Verify Cmd-L is unbound first (grep).
- [ ] `registerAction("toggle-lens", () => lensStore.toggle())` in `action-dispatch.ts` (mirrors the existing `show-dev-panel-toggle`).
- [ ] `FOCUS_LENS` handler on the deck/canvas-level responder (the layer that owns `SHOW_SETTINGS`, i.e. `deck-canvas.tsx`): stash `focusManager.keyCard()` → `focusManager.setKeyCard(LENS_CARD_ID)`. **Open-then-focus ([P03]):** if the panel was already open, call `focusManager.focusKeyView()` synchronously; if Cmd-L is *opening* a closed Lens, the seeded focusable is not mounted yet — call `focusManager.armKeyboardRestore(\`${group}:${order}\`)` instead (the engine's late-mount ring-resume; a bare synchronous `focusKeyView()` would no-op). Toggle semantics: if the Lens is already the key card, restore the stashed prior card instead. Wire Escape-inside-Lens to the same restore via a `CANCEL_DIALOG` handler on the Lens's ResponderScope.
- [ ] Seed the Lens key view: title bar (or first visible section) calls `useSeedKeyView` with a stable `group:order` (the same `group:order` `armKeyboardRestore` targets) so the focus lands ([tuglaws/focus-language.md]).
- [ ] **[Q01] spike (two parts):** drive Cmd-L, then (a) push a background deck store change and assert `focusManager.keyCard()` stays `LENS_CARD_ID` (the `syncKeyCard` `next === lastKeyCard` change-gate holds — passive churn does not clobber); and (b) re-activate the pre-Cmd-L card via a real activation and assert `keyCard()` leaves `LENS`. If (b) fails (the `lastKeyCard` desync from [P03]), add an explicit focus-out on deck activation (the Lens ResponderScope observes activation → restores the stashed card, or clears the stash so the next `adoptKeyCard` wins). Record the outcome in [P03].
- [ ] `AppDelegate.swift`: replace the `maker.devPanel` item (`"Show Dev Panel"`, keyEquivalent `"/"`, `[.command,.option]`, `showDevPanel(_:)` → `sendControl("show-dev-panel-toggle")`) with `"Show Lens"`, keyEquivalent `"l"`, `[.command,.option]`, a `showLens(_:)` handler → `sendControl("toggle-lens")`, identifier `maker.lens`. (`showDevPanel`/`show-dev-panel-toggle` are removed in [#step-11]; leaving the old handler dead for one step is fine, but prefer renaming now.)

**Tests:**
- [ ] app-test **at0231**: dispatch the `toggle-lens` control action; assert `open` flips and persists. Dispatch `FOCUS_LENS` on a *closed* Lens; assert it opens **and** `focusManager.keyCard() === LENS_CARD_ID` with the ring landed (exercises the `armKeyboardRestore` open-then-focus path). Push a background deck-store change; assert `keyCard()` stays `LENS`. Re-activate the pre-Cmd-L card; assert `keyCard()` leaves `LENS` ([Q01] part b). Dispatch Escape inside the Lens; assert the prior key card is restored.

**Checkpoint:**
- [ ] `bunx tsc --noEmit && bunx vite build && bun test`
- [ ] `just app-test-build && just app-test` (at0231 green; Swift changed)

---

#### Step 4: Section registry + contract + stack render {#step-4}

**Depends on:** #step-2

**Commit:** `tugdeck(lens): section registry + host-agnostic LensSectionDefinition [L02]`

**References:** [P04] host-agnostic bodies, Spec S01, (#p04-cardable, #s01-section-def)

**Artifacts:**
- `lens-section-registry.ts` (`registerLensSection`, `getRegisteredLensSections`, `LensSectionDefinition`, `LensSectionHost`).
- `LensPanel` renders sections in `sectionOrder`, filtering `hiddenSections`.

**Tasks:**
- [ ] Define `LensSectionDefinition` (Spec S01) with the **required** `collapsedSummary` factory and the separate host-agnostic `body` factory; declare (do not implement) `findSegments?`/`followBottom?`/`responderNeeds?`.
- [ ] `LensSectionHost`: expose only `{ lensCardId, focusGroup }` (or minimal) — no panel internals.
- [ ] `LensPanel` computes the render list: start from `sectionOrder`, append any registered-but-unordered kinds (stable), drop `hiddenSections`. Render each via a `LensSection` wrapper (band + body). Unknown kinds in a persisted list are ignored.

**Tests:**
- [ ] `bun test`: register two stub sections; assert order + hidden filtering; assert a definition missing `collapsedSummary` is a type error (compile-time — covered by tsc).

**Checkpoint:**
- [ ] `bunx tsc --noEmit && bunx vite build && bun test`

---

#### Step 5: Sticky section band + collapse {#step-5}

**Depends on:** #step-4

**Commit:** `tugdeck(lens): sticky section band (models TugTranscriptEntry) + collapse [L06][L03]`

**References:** [P05] band model, [P02] collapse persisted, [Q03], (#p05-band-model, #q03-collapse-persistence)

**Artifacts:**
- `lens-section-band.tsx` + `lens-section-band.css`.

**Tasks:**
- [ ] Band = sticky title row: glyph + title + `collapsedSummary` (shown when collapsed) + drag grip (placeholder until [#step-6]) + chevron. Chevron toggles `lensStore.setCollapsed(kind, …)`.
- [ ] Write `--tugx-pin-stack-top` onto the section root via `useLayoutEffect` + `ResizeObserver` measuring the band header (`Math.ceil(px) + TIER_GAP_PX`), copying the discipline in `tug-transcript-entry.tsx` — **do not** seed synchronously with `getBoundingClientRect` (documented O(n²) reflow). Provide a static CSS fallback for the first frame.
- [ ] Nested clearance: replicate the `.changeset-entry-block` pin-clearance pair from `changeset-card.css` so a section body's nested block headers telescope beneath the band.
- [ ] Collapse appearance: `data-collapsed` attribute + CSS ([L06]); the body unmounts (or `display:none`) when collapsed, but the band's `collapsedSummary` keeps rendering live from the section's store.

**Tests:**
- [ ] app-test **at0232**: collapse a section; assert `data-collapsed="true"`, the body is hidden, the collapsed summary is present, and `collapsedSections` persisted.

**Checkpoint:**
- [ ] `bunx tsc --noEmit && bunx vite build && bun test`
- [ ] `just app-test`

---

#### Step 6: Drag reorder + group-order sync {#step-6}

**Depends on:** #step-5

**Commit:** `tugdeck(lens): drag-reorder sections; setGroupOrder tracks visual order [L22][L08]`

**References:** [P06] reorder, (#p06-reorder, #state-zone-mapping)

**Artifacts:**
- Reorder interaction in `lens-section-band.tsx`/`lens-panel.tsx`; `setGroupOrder` sync.

**Tasks:**
- [ ] Ground the drag in an existing house drag pattern (deck pane drag coordinator, or `TugTabBar` tab drag if present) — no new DnD library. Live preview is DOM-only ([L06]/[L08]); commit writes `lensStore.setSectionOrder(...)` on drop.
- [ ] In a `useLayoutEffect` keyed on the rendered order, call `focusManager.contextFor(LENS_CARD_ID).setGroupOrder([...visible section focus groups])` so Tab tracks the visual order ([L22]).

**Tests:**
- [ ] app-test **at0233**: drag section B above section A; assert `sectionOrder` persisted in the new order and the DOM order matches; assert Tab from the title bar reaches the sections in the new order.

**Checkpoint:**
- [ ] `bunx tsc --noEmit && bunx vite build && bun test`
- [ ] `just app-test`

---

#### Step 7: Title-bar `…` visibility menu {#step-7}

**Depends on:** #step-2, #step-4

**Commit:** `tugdeck(lens): title-bar … menu toggles section visibility (TugPopupMenu) [L11]`

**References:** [Q02] overflow affordance, Spec S02, (#q02-overflow-affordance, #s02-title-bar)

**Artifacts:**
- `…` menu wired into the `LensPanel` title bar.

**Tasks:**
- [ ] Re-run `git log -S MoreHorizontal -- tugdeck/src`; if nothing surfaces, use the [Q02] default: `TugIconButton` (`MoreHorizontal`) as the trigger for a `TugPopupMenu` (the headless menu with a custom trigger — see `gallery-popup-button.tsx` for the pattern). Never hand-roll the menu.
- [ ] Populate items from `getRegisteredLensSections()`; each row shows a checkmark reflecting `!hiddenSections.includes(kind)`; selecting toggles `lensStore.setHidden(kind, …)`. The `…` button sits to the **left** of the chevron (Spec S02) and is always present while the panel is open.

**Tests:**
- [ ] app-test **at0234**: open the `…` menu, toggle a section off; assert it disappears from the stack and `hiddenSections` persisted; toggle back on and assert it returns.

**Checkpoint:**
- [ ] `bunx tsc --noEmit && bunx vite build && bun test`
- [ ] `just app-test`

---

#### Step 8: Log section {#step-8}

**Depends on:** #step-4, #step-5

**Commit:** `tugdeck(lens): Log section re-hosts tugDevLogStore + LogInspector; re-home log domain [L02]`

**References:** [P04] host-agnostic, [P08] log domain, [P10] helper relocation, [R02], (#p08-log-domain, #p10-relocate-helpers, #r02-log-domain)

**Artifacts:**
- `sections/log-section.tsx`; `LOG_STORE_DOMAIN` moved into `tug-dev-log-store.ts`; `lens-panel/internal/{copy-as-json.ts,log-row.tsx}` relocated ([P10]).

**Tasks:**
- [ ] **Relocate helpers ([P10]) first:** `git mv` `tug-dev-panel/copy-as-json.ts` → `lens-panel/internal/copy-as-json.ts` and `tug-dev-panel/inspectors/log-row.tsx` → `lens-panel/internal/log-row.tsx` (move their tests too); update every importer (the dev panel's own inspectors still import them for the one-step coexistence window, so repoint those imports to the new path — they are deleted in [#step-11] regardless).
- [ ] Re-home the domain: add `LOG_STORE_DOMAIN = "dev.tugtool.dev-panel"` (same string, data continuity — [P08]) inside `tug-dev-log-store.ts`; replace the import from `tug-dev-panel-store/types` with the local constant. Repoint `tug-dev-log-store/__tests__/persistence.test.ts` to the new constant.
- [ ] Log section descriptor: title "Log", a log glyph, and `collapsedSummary` = live counts from `tugDevLogStore.getSnapshot()` (e.g. `124 · 3 warn · 1 error`) via `useSyncExternalStore`.
- [ ] Body: lift the `LogInspector` rendering (filters toolbar + `LogRow` list, from `tug-dev-panel/inspectors/log-inspector.tsx`) into the section, importing `copy-as-json` / `log-row` from their new `lens-panel/internal/` home. Behavior is unchanged — it already reads `tugDevLogStore` via `useSyncExternalStore` and owns its own scroll ([L06] auto-scroll). Register via `registerLensSection` (call it from `main.tsx`).
- [ ] `window.tugDevLog` wiring in `main.tsx` stays untouched.

**Tests:**
- [ ] app-test **at0235**: emit log entries via `window.tugDevLog`; assert the Log section renders them and the collapsed summary counts match; assert a level filter narrows the list.

**Checkpoint:**
- [ ] `bunx tsc --noEmit && bunx vite build && bun test`
- [ ] `just app-test`

---

#### Step 9: Telemetry section {#step-9}

**Depends on:** #step-4, #step-5

**Commit:** `tugdeck(lens): Telemetry section follows the active dev card [L07][L02]`

**References:** [P07] telemetry follows active card, [P10] helper relocation, (#p07-telemetry-follows, #p10-relocate-helpers)

**Artifacts:**
- `sections/telemetry-section.tsx`; `lens-panel/internal/{field-row.tsx,field-section.tsx,telemetry-projection.ts}` relocated ([P10]).

**Tasks:**
- [ ] **Relocate helpers ([P10]) first:** `git mv` `tug-dev-panel/field-row.tsx`, `tug-dev-panel/field-section.tsx`, and `tug-dev-panel/inspectors/telemetry-projection.ts` → `lens-panel/internal/` (move `telemetry-projection`'s test too); repoint every importer, including the dev panel's own inspectors during the coexistence window.
- [ ] Body: lift `TelemetryInspector` but drop the `selectedCardId` prop; instead read `focusManager.keyCard()` via `useSyncExternalStore(focusManager.subscribe, () => focusManager.keyCard())` (re-renders on key-card change — [P07]), resolve `cardServicesStore.getServices(keyCardId)`, subscribe to that card's `codeSessionStore`, and use `projectTelemetryInspector` + `_getInternalStateForDevPanel` + `useLifecycleTick` exactly as today, importing `field-row`/`field-section`/`telemetry-projection` from `lens-panel/internal/`. Name the followed card in the band; empty-state when the key card is not a dev card / none exists.
- [ ] `collapsedSummary`: a key live stat (e.g. current turn phase or elapsed) from the followed card's snapshot.
- [ ] Register via `registerLensSection` from `main.tsx`.

**Tests:**
- [ ] app-test extends **at0235** (or a new sibling): open a real dev card, run a turn; assert the Telemetry section names that card and shows non-empty telemetry; assert the collapsed summary reflects a live stat.

**Checkpoint:**
- [ ] `bunx tsc --noEmit && bunx vite build && bun test`
- [ ] `just app-test`

---

#### Step 10: Settings "General" tab move {#step-10}

**Depends on:** #step-9

**Commit:** `tugdeck(settings): move focus-ring modality to a new General tab; rename mislabeled id [L11]`

**References:** [P09] settings move, [P10] helper relocation, (#p09-settings-move, #p10-relocate-helpers)

**Artifacts:**
- `settings-card.tsx` tab set; a new General body composing the focus-ring radio.

**Tasks:**
- [ ] In `settings-card.tsx`, rename the existing `SettingsTabId` value `"general"` (labeled "Dev Card", body `SettingsGeneralBody`) to `"devCard"`; grep all consumers of the `"general"` id and the `TAB_CARDS`/body switch and update them.
- [ ] Add a **new** `"general"` tab (label "General") whose body hosts the focus-ring modality control — lift `SettingsInspector`'s content into a new body component following the `settings-app-body.tsx` shape (`useResponderForm` + `TugRadioGroup`, backed by `focusRingModalityStore`, persistence `dev.tugtool.app/focusRingModality` unchanged). Import `field-section` from its relocated `lens-panel/internal/` home ([P10]), not from `tug-dev-panel/`.
- [ ] Order the tabs so "General" reads first.

**Tests:**
- [ ] app-test: open the Settings card, select the General tab, flip focus-ring modality; assert `dev.tugtool.app/focusRingModality` persisted. (Extend an existing settings app-test rather than a new at-number if one covers the Settings card.)

**Checkpoint:**
- [ ] `bunx tsc --noEmit && bunx vite build && bun test`
- [ ] `just app-test`

---

#### Step 11: Delete dev panel + test sweep {#step-11}

**Depends on:** #step-3, #step-8, #step-9, #step-10

**Commit:** `tugdeck+tugapp(dev-panel): delete the dev panel; the Lens supersedes it [L02][L06]`

**References:** [P01], [P07], [P08], (#files-deleted, #symbol-inventory)

**Artifacts:**
- Deletions listed in [#files-deleted].

**Tasks:**
- [ ] Confirm the five [P10] helpers (`copy-as-json`, `log-row`, `field-row`, `field-section`, `telemetry-projection`) are already gone from `tug-dev-panel/` (relocated in [#step-8]/[#step-9]); if any remain, this deletion would take a still-referenced file — stop and relocate it first.
- [ ] Delete `tugdeck/src/components/tug-dev-panel/` and `tugdeck/src/lib/tug-dev-panel-store/` (both entire).
- [ ] Remove the `TugDevPanel` import + sibling `React.createElement(TugDevPanel, {})` in `deck-manager.ts`, leaving only `LensPanel`.
- [ ] Remove the three `registerAction` entries in `action-dispatch.ts` (`show-dev-panel-toggle`, `dev-panel-select-telemetry-tab`, `dev-panel-select-log-tab`) and the `tugDevPanelStore` import.
- [ ] Remove `registerDevPanelInspectorTabs()` + the `knownCardIdsForDevPanel` `notifyCardGone` block in `main.tsx` (the Lens telemetry follows the key card; no card-gone bookkeeping needed).
- [ ] Remove the now-dead `showDevPanel(_:)` handler in `AppDelegate.swift` if it wasn't already replaced in [#step-3].
- [ ] Sweep `tests/app-test/` for dev-panel references (the `dev-panel-select-*-tab` actions existed "for tests"); adapt each to its Lens equivalent (section visibility / focus, not tab selection). Confirm no test still drives `show-dev-panel-toggle`.
- [ ] Confirm `Opt-Cmd-/` is unbound everywhere (grep both tracks).

**Tests:**
- [ ] Full `bun test` + `just app-test` green with zero dev-panel references remaining (grep).

**Checkpoint:**
- [ ] `bunx tsc --noEmit && bunx vite build && bun test`
- [ ] `just app-test-build && just app-test`
- [ ] `grep -rn "tug-dev-panel\|TugDevPanel\|show-dev-panel\|maker.devPanel" tugdeck/src tugapp/Sources tests/app-test` → no matches

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** The Lens — an anchored, focus-bearing, reorderable/collapsible section panel with informative collapsed headers, hosting Log and Telemetry — replaces the Tug dev panel, which is deleted.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] `Opt-Cmd-L` shows/hides the Lens; `Cmd-L` focuses in; Escape / Cmd-L focuses out (restores prior card). (at0231)
- [ ] Section order, visibility, collapse, panel width, and open state all persist across reload under `dev.tugtool.lens`. (at0230/at0232/at0233/at0234)
- [ ] Every registered section supplies a live collapsed-summary; Log shows level counts, Telemetry shows a key stat. (at0235)
- [ ] The dev panel is deleted; `bunx tsc --noEmit && bunx vite build && bun test && (cd tugrust && cargo nextest run)` green; grep finds no dev-panel references. ([#step-11])
- [ ] `Opt-Cmd-/` is unbound in both the web and Swift tracks.

**Acceptance tests:**
- [ ] at0230 (toggle/persist), at0231 (focus in/out), at0232 (collapse), at0233 (reorder), at0234 (`…` visibility), at0235 (Log + Telemetry real data).

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] **M3b** — Changeset section (lift `changeset-card.tsx` guts, on-demand draft generation); retire the changeset card.
- [ ] **M3c** — Git History section (new `GIT_LOG` feed + `git-log-store` + read-only `TugCodeView`).
- [ ] Cardable-in-future — render a Lens section as its own deck card (contract already permits it).
- [ ] Deck reflow — cards shrink to make room instead of the overlay covering them.

| Checkpoint | Verification |
|------------|--------------|
| Frame + focus | at0230, at0231 |
| Sections (band/reorder/menu) | at0232, at0233, at0234 |
| Log + Telemetry | at0235 |
| Dev-panel gone | [#step-11] grep + full green |
