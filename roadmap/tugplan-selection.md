<!-- tugplan-skeleton v2 -->

## Selection and Focus Subsystem {#phase-selection-subsystem}

**Purpose:** Replace the scattered handling of DOM selection, form-control selection, and focus with a single authoritative `SelectionKeeper` subsystem that preserves and restores all three across every lifecycle transition a card can experience (reload, relaunch, hide/unhide, resign/activate, pane/tab activation, cross-pane move).

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-04-22 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The `8de575c4` work closed the main card-state persistence regression but left four selection failures visible to users: form-control selection is lost on reload / hide/unhide / Cmd-Tab (Cases α, β, δ in the superseded `persistence-reliability.md` Part 7), and DOM selection in `TugPromptEntry` degrades on the second Cmd-Tab cycle (Case γ). These are four symptoms of one concept gap. The code has been conflating three distinct browser-level states — **DOM selection** (`window.getSelection()`), **form-control selection** (`el.selectionStart`/`selectionEnd`), and **focus** (`document.activeElement`) — under the single word "selection", and handling each through fragmentary subsystems (`selectionGuard.saveSelection`, the `domInputs` walk, an ad-hoc `restoreActiveCardSelection`). No single owner sees the full state; no single trigger saves or restores all of it.

This plan introduces a `SelectionKeeper` singleton that owns the full concept and a unified `CardSelectionState` snapshot shape that is captured and applied at explicit, trigger-driven lifecycle points. It is a replacement, not an addition: the save/restore surface area of `selectionGuard` becomes internal, the `domInputs` slice stops carrying selection fields, and the current ad-hoc restore wires go away.

#### Strategy {#strategy}

- **One owner.** `SelectionKeeper` is the sole read/write path for selection and focus state used in save/restore. Drag-clipping and boundary-registration stay in `selectionGuard` (they are runtime concerns, not persistence).
- **One snapshot shape.** `CardSelectionState = { selection: SelectionSnapshot, focus: FocusSnapshot }`, where `SelectionSnapshot` is a tagged union of `{ kind: "none" | "dom" | "form-control" }`. Because the browser has at most one active selection and one focused element per window, there is at most one snapshot per card.
- **Trigger-driven, not React-dep-driven.** Every capture and apply fires at a deterministic lifecycle hand-off point (lifecycle events, mount, blur, card activation). No React effect dep arrays gate selection or focus application.
- **Capture at will-phase, not did-phase.** Browsers start tearing down selection visibility during the did-phase of resign/hide. Capturing at will-phase reads authoritative state.
- **Skip-if-already-correct before applying.** Programmatic replays of an already-correct selection degrade under WebKit's rules. Apply compares live state to the snapshot and no-ops when they match.
- **Opt-in element participation.** `data-tug-persist-value` (already exists, already carried by `TugInput`/`TugTextarea`) and a new `data-tug-focus-key` attribute are the only ways an element participates in persistence. Authors declare participation; the keeper discovers.
- **Safety nets.** `focusout` blur-time captures, `textContext` fallback for shape-shifted DOM, dev-mode logging of failures. Failures are observable, never silent.

#### Success Criteria (Measurable) {#success-criteria}

- [SC-1] After reload / relaunch: DOM selection in `TugPromptEntry` restores to the same character range it occupied at save time. Verified by integration test and by manual repro (type → select → quit → relaunch → selection visible).
- [SC-2] After reload / relaunch: form-control selection in a `TugInput` or `TugTextarea` that carries `persistKey` restores, *and is visible* because focus is restored to the element when focus was on it at save time.
- [SC-3] After `Cmd-H` → unhide: DOM selection and form-control selection restore for the focused card. Verified by manual repro on `TugPromptEntry`, `TugInput`, `TugTextarea`.
- [SC-4] After the first Cmd-Tab away → back: same as SC-3.
- [SC-5] After the **second** Cmd-Tab away → back: same as SC-3 — no degradation from first cycle. (Closes Case γ.)
- [SC-6] After tab/card activation within the app: selection state transfers cleanly — the deactivating card's snapshot is captured, the activating card's is applied.
- [SC-7] After cross-pane card move: selection survives without explicit re-application (the keeper's apply is a no-op because nothing was actually lost).
- [SC-8] No regression in `selectionGuard`'s drag-clipping behavior. The existing interaction tests pass unchanged.
- [SC-9] All bag writes and reads are JSON-serializable. Old-shape bags migrate on read without dropping the user's last selection (best effort — see [D10]).
- [SC-10] The set of files that write to `window.getSelection()` / `setSelectionRange` / `.focus()` for persistence purposes is exactly one (`selection-keeper.ts`). Verified by `grep`.

#### Scope {#scope}

1. A new module `tugdeck/src/components/tugways/selection-keeper.ts` with `capture`, `apply`, and a set of internal helpers.
2. New types in `tugdeck/src/layout-tree.ts`: `SelectionSnapshot`, `FocusSnapshot`, `CardSelectionState`, and an updated `CardStateBag`.
3. Updated save and restore paths in `tugdeck/src/components/chrome/card-host.tsx` that delegate to the keeper.
4. Updated app-lifecycle wiring in `tugdeck/src/action-dispatch.ts`: subscribes `willResignActive`, `willHide` (for save) and `didBecomeActive`, `didUnhide` (for apply).
5. A new element attribute `data-tug-focus-key`, plus a `focusKey?: string` prop on `TugInput` and `TugTextarea`.
6. Deprecation of `selectionGuard.saveSelection` / `restoreSelection` as public API; the logic moves into the keeper, `selectionGuard` retains only drag-clipping and boundary-registration concerns.
7. Best-effort migration of in-flight bags on cold-boot read.
8. Integration tests covering each of the transition × selection-kind combinations.
9. Documentation: module docstring on the keeper, JSDoc on the new props, updates to `persistence` / `selection` comments in `CardHost`, and candidate tuglaws additions L-SEL-01 / L-SEL-02 / L-SEL-03.

#### Non-goals (Explicitly out of scope) {#non-goals}

- **Drag-select clipping during live interaction.** `selectionGuard` continues to own this. The keeper reads the resulting DOM selection; it does not police it.
- **Undo/redo of selection history.** Different subsystem with different invariants.
- **Multi-range selections.** Not in the browser's practical API on our platform; the snapshot is one range.
- **Cross-card selections.** A user-made selection spanning two cards is not a concept the UI supports today; the keeper captures only the active card's side if such a selection exists.
- **Browser-tab transitions** (switching to a different browser tab while our webview is open in a browser-dev context). The browser handles its own behavior; we treat it as equivalent to hide/unhide.
- **Restoring focus to a non-keyed element.** An element without `data-tug-persist-value` or `data-tug-focus-key` does not participate. No implicit focus preservation via DOM position or selector heuristics.
- **Elements whose key collides within a card.** Uniqueness is an author responsibility (see [D08] below for the contract).

#### Dependencies / Prerequisites {#dependencies}

- **`AppLifecycle` delegate system** with `observeApplication{Will,Did}{BecomeActive,ResignActive,Hide,Unhide}` — already in place; confirmed at `tugdeck/src/lib/app-lifecycle.ts`.
- **Swift host emission of `willResignActive` / `willHide`** — verification required; see [Q03]. If missing, a small patch in `tugapp/` is a prerequisite, scoped as Step 8a below.
- **`CardHost.findCardRoot` helper** — shipped `8de575c4`; already scopes DOM queries to the card's own subtree.
- **`data-tug-persist-value` attribute and `persistKey` prop on `TugInput` / `TugTextarea`** — shipped `8de575c4`; reused for selection-capture element identification.
- **`TugbankClient` card-state storage** — shipped; writes `CardStateBag` via `putCardState`.

#### Constraints {#constraints}

- **Must work under WKWebView on macOS.** The lifecycle events are the macOS-native ones bridged through `applicationWill*` / `applicationDid*` Swift-side observers.
- **No React dep-array gating on selection application.** [L-SEL-02].
- **JSON-serializable snapshots.** The bag persists to tugbank as JSON.
- **No regression in active drag-clip behavior.** `selectionGuard`'s click/drag tracking must continue to work while the keeper is being introduced.
- **Dev-mode observability, prod silence.** Failures log in dev (via `isDevEnv()`) and silently fail in prod to avoid console spam in shipped builds.

#### Assumptions {#assumptions}

- WebKit emits `applicationWillResignActive` / `applicationWillHide` before clearing selection visibility. (See [Q03] — verify, else we defend via blur-time capture.)
- WebKit preserves `el.selectionStart` / `selectionEnd` across hide/unhide and resign/activate *when an element still has focus*. If the user Cmd-H's while an input is focused, WebKit keeps the range internally. Empirically needs confirmation on the exact platform version.
- `data-*` attributes survive cross-pane moves because the attribute is on a DOM element, not React state, and the element travels with the card's portal slot.
- The card's `[data-card-host][data-card-id]` div is rendered inside the card's subtree at save and at restore time. (True after `d70ee0d8` and `8de575c4`; any future refactor that breaks this breaks the keeper's boundary scoping.)

---

### Reference and Anchor Conventions {#reference-conventions}

Per `tuglaws/tugplan-skeleton.md`. Anchors follow the prefix convention (`d`NN, `q`NN, `r`NN, `s`NN, `t`NN, `l`NN, `step-N`); every execution step carries a `**References:**` line.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

Every open question below has a concrete question, what breaks if we guess wrong, options with tradeoffs, and a decision plan. Resolve before starting [Step 1](#step-1), or explicitly defer with rationale.

#### [Q01] On `applicationDidBecomeActive` / `applicationDidUnhide`, which cards does the keeper re-apply? {#q01-restore-scope-on-activate}

**Question.** When the app becomes active again after Cmd-Tab or unhide, the keeper's `apply()` is called via the lifecycle observer. Does it walk **every card** that has a saved selection snapshot and apply each, or **only the card whose active card is the focused card of the deck** (i.e., the single card that was "where the user was" when the app went inactive)?

**Why it matters.** The browser has one selection at a time, globally. Only one card can have a visible selection. If we apply snapshots to non-focused cards, we are writing to `el.selectionStart` / `selectionEnd` on elements inside display-none subtrees or inactive tabs, which is harmless but wasted work — and any DOM-selection apply to a non-focused card would instantly move the browser's global selection off the focused card, which is wrong. If we apply to only the focused card, non-focused cards keep their saved snapshots; those get applied at `cardDidActivate` time when the user later switches. That path exists regardless.

**Options.**
- **Option A — focused card only.** Keeper iterates the `activePaneId` → `activeCardId` resolution and applies for that one card. Other cards rely on `cardDidActivate` for eventual apply.
- **Option B — every card with a snapshot.** Keeper walks all cards, calls apply for each. For form-control selections on non-focused cards, this is a set-but-invisible state (harmless). For DOM selections on non-focused cards, this *moves the browser's global selection* — certainly wrong.
- **Option C — every card for form-control snapshots, focused card only for DOM snapshots.** Hybrid. Avoids B's DOM-wreckage while pre-warming form-control offsets on inactive cards.

**Plan to resolve.** Ship with **Option A**. It matches the user's mental model ("when I come back, my selection is where I left it, which was the active card"). If a case surfaces where a user switches cards after become-active and sees a stale selection, promote to Option C (Option B is eliminated).

**Resolution:** OPEN. Recommendation to adopt Option A at [Step 8](#step-8). Revisit if SC-6 fails after commit 10.

#### [Q02] On cold-boot reload/relaunch, does the keeper's `apply()` steal focus? {#q02-focus-steal-on-reload}

**Question.** When a card mounts with a saved `CardSelectionState` where `focus: { kind: "keyed", focusKey: "..." }`, should the keeper call `el.focus()`?

**Why it matters.** Restoring focus is **required** for form-control selection to be *visible* — `setSelectionRange` on an unfocused element paints no highlight ([SC-2]). But stealing focus on cold mount can be surprising: on mobile this pops the virtual keyboard; on desktop it grabs keystrokes away from wherever the OS has directed them.

**Options.**
- **Option A — always.** If the saved snapshot has a focus key, focus the element on mount. Uniform behavior; fulfills SC-2 without caveats.
- **Option B — only when the focused card at save time is still the focused card on boot.** If the deck's active card is the same as the one whose snapshot has focus, focus. Otherwise the user's focus context shifted (they closed the window while focused on a different app's element, perhaps); don't grab focus.
- **Option C — never. Rely on the user clicking back in.** Save fidelity drops: the user sees their text but no cursor until they click. SC-2 fails for the common case.

**Plan to resolve.** Ship with **Option B**. It preserves the common case (user closed the app with focus on input X, reopens to see cursor back in X) while not stealing focus when the context has changed (user never had our app's card focused; we shouldn't grab it now). Implementation: check whether the target card's `cardId` matches `deckState.panes[last].activeCardId` on mount.

**Resolution:** OPEN. Recommendation to adopt Option B at [Step 6](#step-6). [Q01] and [Q02] together describe "apply only for the currently focused card" — they are consistent.

#### [Q03] Does the Swift host emit `applicationWillResignActive` / `applicationWillHide`? {#q03-will-phase-events}

**Question.** `action-dispatch.ts:440–475` handles a switch over the lifecycle event name received from Swift. Does Swift actually send `willResignActive` and `willHide`? If not, capturing at will-phase is impossible from JS.

**Why it matters.** Saving at `didResignActive` may read a browser state that has already started tearing down selection visibility. Will-phase is the authoritative moment. Blur-time capture ([Q06]) is a partial fallback but doesn't fire for window-level resign events where no element blurs (Cmd-Tab with focus staying on the same input just grays the highlight — no blur event).

**Options.**
- **Option A — verify and adopt.** Search `tugapp/` for the emission, check it fires on every transition, wire the JS observer.
- **Option B — add if missing.** If Swift doesn't emit, patch the AppDelegate to hook `applicationWillResignActiveNotification` and `applicationWillHideNotification`, route through `sendControl("app-lifecycle", { event: "willResignActive" })`. Small Swift change; probably < 20 lines. Scoped as [Step 8a](#step-8a) below.
- **Option C — defer.** Rely on did-phase only plus blur-time capture. Accept that Case γ's root cause (programmatic selection torn down before did-phase save) may remain partially unresolved.

**Plan to resolve.** **[Verify before Step 8.](#step-8)** Grep `tugapp/` for `notifyApplicationWillResignActive` / `notifyApplicationWillHide` and check the AppDelegate emission path. If missing, scope and execute Step 8a. If present, proceed directly to Step 8.

**Resolution:** OPEN, to be resolved at Step 8 kickoff.

#### [Q04] On card/tab activation within the app, is cross-card selection transfer automatic? {#q04-cross-card-activation-transfer}

**Question.** User clicks from card A's content to card B's chrome (or switches tabs). The browser has at most one selection globally. What exactly happens, and what should we guarantee?

**Why it matters.** Without explicit handling, the user's click on B's chrome cancels A's selection (native browser behavior). A's `willDeactivate` fires, then B's `didActivate`. If we capture A's selection in `willDeactivate` and apply B's saved snapshot in `didActivate`, each card carries its own stable selection across visits — click A, select, click B, click A, the selection is back. Without this, A's selection is gone forever the moment the user clicks B.

**Options.**
- **Option A — capture on `willDeactivate`, apply on `didActivate`.** Each card owns its own selection across the user's navigation.
- **Option B — no card-level keeper wiring; rely only on app-lifecycle events.** Users lose per-card selection memory on every card switch. Fails the spirit of SC-6.
- **Option C — capture only; don't apply.** Saves the outgoing card's selection but doesn't resurrect the incoming card's. Users see their old card's selection return only after app resign+activate, not after card switch+back.

**Plan to resolve.** **Ship Option A.** It's a clean match for `observeCardWillDeactivate` / `observeCardDidActivate` (both exist, both are called today for other reasons). Skip-if-correct ensures that on a quick tab-return the existing selection is left alone.

**Resolution:** OPEN. Recommendation to adopt Option A at [Step 10](#step-10).

#### [Q05] When `apply()` is called but the target element is no longer in the DOM, what does it do? {#q05-stale-snapshot-handling}

**Question.** A saved bag has `selection: { kind: "form-control", persistKey: "email" }` but on restore no element with `data-tug-persist-value="email"` exists in the card's subtree (author removed the input, component was redesigned, older bag shape). What happens?

**Why it matters.** Users will have bags from older app versions. A crash, silent corruption, or visible error would be worse than a graceful "best effort; nothing to restore".

**Options.**
- **Option A — silent fail in prod, dev-mode warning.** Apply returns `"failed"`, the keeper logs in dev-mode, user sees no selection (which matches "the element no longer exists, nothing to select").
- **Option B — attempt fallback.** Search for an input with a similar name, or the first input in the card, or apply the range to a DOM-selection textContext search. High risk of attaching the selection to the wrong element.
- **Option C — raise an error.** Surfaces the bag/component mismatch loudly. Probably too aggressive for a user-facing state-restore concern.

**Plan to resolve.** **Ship Option A.** Fallbacks are not worth the risk of landing selection on the wrong element.

**Resolution:** OPEN. Recommendation to adopt Option A at [Step 5](#step-5).

#### [Q06] Is there a blur-time capture safety net, and if so with what debounce? {#q06-blur-time-capture}

**Question.** Do we add a module-level `focusout` listener that captures form-control selection whenever a keyed element loses focus?

**Why it matters.** Some transitions don't fire `willResignActive` cleanly — or fire it too late. A blur-time capture gives every save trigger a freshly-captured snapshot to read. Without it, the last save of a keyed element could be several seconds (or transitions) old.

**Options.**
- **Option A — yes, debounced at 50 ms.** Short enough that the last capture before a lifecycle transition is fresh, long enough to collapse rapid Tab-key focus traversals into one capture.
- **Option B — yes, no debounce.** Every blur captures immediately. Simple, slightly more work but probably not measurable.
- **Option C — no safety net.** Rely on explicit save triggers only. Higher risk of stale snapshots under rapid focus churn.

**Plan to resolve.** **Ship Option A.** Debounced 50 ms is the sweet spot. The listener lives on the deck root (captures bubble up from every card's content), scoped to the current card via `findCardRoot(event.target)`.

**Resolution:** OPEN. Recommendation to adopt Option A at [Step 9](#step-9).

#### [Q07] What is the `textContext` fallback window size? {#q07-text-context-window}

**Question.** When DOM selection `pathToNode` fails, the keeper searches for a short text window to re-anchor. How big is the window, and how does it handle ambiguity (same text appearing multiple times in the card)?

**Why it matters.** Smaller windows risk ambiguity (common substrings like `"the"` match everywhere). Larger windows risk non-existence (any nearby text change invalidates the match). The keeper needs a policy.

**Options.**
- **Option A — fixed 20 chars each side.** Small snapshot, high ambiguity risk.
- **Option B — fixed 40 chars each side.** Mid-tier. Balances storage vs. specificity.
- **Option C — adaptive: start at 20 chars, double on ambiguity (up to 200 each side), fail if still ambiguous at the cap.** Minimal snapshot for distinctive text, adaptive for repetitive text. Capped so we don't end up storing half the card's text in the bag.
- **Option D — no textContext; fail if paths don't resolve.** Simplest, but re-opens the tide-card shape-shift fragility that was [Issue C] in the superseded `persistence-reliability.md`.

**Plan to resolve.** **Ship Option C.** The adaptive behavior means authors with highly-repetitive content (e.g., logs) still get specificity, while common cases stay small.

**Resolution:** OPEN. Recommendation to adopt Option C at [Step 4](#step-4).

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Swift host doesn't emit will-phase events | high | med | verify [Q03]; add AppDelegate patch as Step 8a if needed | grep fails to find emission |
| Skip-if-correct false-negative (paths differ but selection is "the same") | med | med | compare resolved node+offset, not raw path array | integration test for Case γ passes first cycle but fails second |
| Focus restoration surprises user (steals keystrokes) | med | low | Option B in [Q02] — only restore focus when card was active at save | user feedback; manual testing with cross-app focus sequences |
| Blur-time capture thrashes on rapid Tab-key focus traversal | low | low | debounce 50 ms per [Q06] | integration test with 5 rapid blurs |
| Migration drops some users' last selection | low | high (on first migration) | migrate best-effort; on next save, correct state is captured fresh | check post-migration dev logs for `migrate: dropped selection` messages |
| `selectionGuard` retirement breaks drag-clipping | high | low | retirement is API-only; drag code paths unchanged | existing drag tests must stay green |

**Risk R01: Swift will-phase emission missing** {#r01-swift-will-phase}

- **Risk:** If `applicationWillResignActive` / `applicationWillHide` are not emitted by Swift, the keeper cannot capture before WebKit tears down selection. Save is forced to did-phase and may read a cleared state. Case γ's root cause is not fully addressed.
- **Mitigation:** [Q03] resolution; add a small AppDelegate emission if missing ([Step 8a](#step-8a)).
- **Residual risk:** If Apple changes WKWebView timing in a future OS version, the will-phase read could become unauthoritative. Blur-time capture ([Q06]) is the partial backstop.

**Risk R02: Skip-if-correct false-negative** {#r02-skip-if-correct-false-negative}

- **Risk:** Our equality check misses cases where the live selection is equivalent to the snapshot but differs in path representation (e.g., a stray `<br>` inserted mid-text shifts child indices but not selection semantics).
- **Mitigation:** Compare by resolved `(anchorNode, anchorOffset, focusNode, focusOffset)` after `pathToNode`, not by raw path equality.
- **Residual risk:** If path resolution itself is ambiguous, skip-if-correct could spuriously re-apply. Caught by textContext fallback.

**Risk R03: Focus restoration UX** {#r03-focus-restore-ux}

- **Risk:** Restoring focus on reload or unhide steals keystrokes the user intended elsewhere, pops mobile virtual keyboards unexpectedly, or grabs focus away from another app.
- **Mitigation:** [Q02] Option B — restore focus only when the snapshotted element was in the currently-focused card at save time.
- **Residual risk:** Users may expect more aggressive restoration (their text is there, but cursor isn't) and request Option A. Revisit after user testing of the final rollout.

**Risk R04: Migration data loss** {#r04-migration-data-loss}

- **Risk:** On cold-boot read, old-shape bags with multiple per-input selections cannot all be migrated (only one selection per card in the new shape). We pick the first and drop the rest.
- **Mitigation:** Migration is one-shot — on the next save, the correct current state is captured fresh. Document the migration semantics.
- **Residual risk:** Very short reload cycles (reload before the user interacts) where the user's prior multi-input selection is lost. Acceptable given the browser's one-selection-at-a-time reality.

---

### Design Decisions {#design-decisions}

#### [D01] `SelectionKeeper` is a module-level singleton, not a per-card instance (DECIDED) {#d01-keeper-singleton}

**Decision:** The keeper is a singleton exported from `selection-keeper.ts`. It is stateless across calls in the steady state — any per-card state lives in the card's bag, not in the keeper.

**Rationale:** There is exactly one browser selection and one focused element at any moment, globally. A keeper-per-card would introduce coordination between instances (who owns the browser's selection right now?) that mirrors the fragmentation this plan is removing.

**Implications:** API is pure functions: `capture(cardId, boundary) → CardSelectionState` and `apply(cardId, boundary, state) → "applied" | "already-correct" | "failed"`. Testability: no setup state; fake browser state via happy-dom.

#### [D02] `SelectionSnapshot` is a tagged union with `kind: "none" | "dom" | "form-control"` (DECIDED) {#d02-snapshot-tagged-union}

**Decision:** Selection is modeled as an exhaustive tagged union with three variants. DOM and form-control are structurally different and must not be conflated.

**Rationale:** The root cause of Cases α, β, γ, δ is a conflation of three browser concepts. The type system enforces the distinction by making kind-switching explicit at every use site.

**Implications:** `capture` and `apply` branch on `kind`. Serialization is straightforward JSON. Migration code translates between old-shape (flat `SavedSelection`) and new-shape (`{ kind: "dom", ... }`) deterministically.

#### [D03] Focus is captured as a separate `FocusSnapshot` alongside selection (DECIDED) {#d03-focus-separate-from-selection}

**Decision:** `CardSelectionState = { selection, focus }`. Focus is a first-class concept with its own save/restore path, not derived from selection.

**Rationale:** Form-control selection is invisible without focus. DOM selection's visibility is independent of focus. Treating focus as a property of selection (rather than a peer) would require form-control snapshots to carry focus info while DOM snapshots would not — inconsistent.

**Implications:** Keeper captures both in one pass. Apply applies focus first, then selection, skip-if-correct on each. `FocusSnapshot` is `{ kind: "none" } | { kind: "keyed", focusKey: string }`.

#### [D04] Save triggers are will-phase lifecycle events, not did-phase (DECIDED, contingent on [Q03]) {#d04-save-at-will-phase}

**Decision:** Primary save triggers are `applicationWillResignActive`, `applicationWillHide`, `window.beforeunload`, and the Swift `saveState` RPC. Did-phase events (`applicationDidResignActive`, `applicationDidHide`) serve as backstops — they still fire `saveAndFlush` in case will-phase is missed.

**Rationale:** Browsers tear down selection visibility during the did-phase. Reading at that point returns whatever remains, which is sometimes nothing. Will-phase is the last authoritative read. Case γ's degradation on the second Cmd-Tab cycle is directly attributable to this timing.

**Implications:** Contingent on [Q03] — Swift must emit will-phase events. If it doesn't, Step 8a adds that emission.

#### [D05] Apply is skip-if-already-correct (DECIDED) {#d05-skip-if-correct}

**Decision:** Before calling any of `el.focus()`, `el.setSelectionRange(...)`, or `selection.setBaseAndExtent(...)`, the keeper checks whether the live state already matches the snapshot. If it does, the step is a no-op.

**Rationale:** WebKit treats programmatic selections differently from user-made selections on resign (Case γ's root cause). If we never re-apply a matching snapshot, we never programmaticize a user selection, and the cycle doesn't degrade. Also avoids harmless-but-wasteful work.

**Implications:** Equality comparison happens at resolved-DOM-node level, not raw-path level ([R02] mitigation).

#### [D06] `textContext` is an adaptive fallback for DOM selection path resolution failure (DECIDED) {#d06-text-context-fallback}

**Decision:** DOM snapshots optionally carry a `textContext: { text, anchorOffsetInText, focusOffsetInText }` field. On apply, if `pathToNode(boundary, anchorPath)` fails, the keeper searches the current `boundary.textContent` for `textContext.text`. If found exactly once, it re-anchors against that match. If found zero times or multiple times, apply widens the context adaptively up to 200 chars each side; at the cap, apply returns `"failed"`.

**Rationale:** `pathToNode` is shape-fragile ([superseded Issue C]). Dynamic DOMs (tide-card async message arrivals) are the primary victim. TextContext adds a second anchor that is resilient to DOM tree reshaping as long as the textual content is stable.

**Implications:** Snapshot size grows slightly (typically < 100 bytes per DOM selection). Migration doesn't need to invent `textContext` for old-shape bags (the field is optional).

#### [D07] `CardStateBag` schema version bumps; read-side migration is best-effort (DECIDED) {#d07-bag-schema-migration}

**Decision:** New bags carry `version: 2`. Old bags lacking `version` are treated as v1 and migrated in place at `readCardStates` time. Migration promotes the first viable per-input selection from `domInputs` (if any) to the top-level `CardSelectionState`, and wraps any top-level `SavedSelection` as `{ selection: { kind: "dom", ... }, focus: { kind: "none" } }`.

**Rationale:** Users have in-flight bags from the `8de575c4` era. Abrupt schema changes would drop their saved state. Migration preserves what we can, acknowledges what we can't (more than one per-input selection in v1 shape cannot all survive), and moves on.

**Implications:** `migrateBag` function in `settings-api.ts` or adjacent, called from `readCardStates`. Strips migrated fields from their old locations so the new code path doesn't double-read.

#### [D08] `data-tug-persist-value` and `data-tug-focus-key` are distinct attributes (DECIDED) {#d08-persist-vs-focus-keys}

**Decision:** Authors opt form-controls into persistence via `data-tug-persist-value="<key>"` (already shipped). Authors opt any focusable element into focus-only persistence via `data-tug-focus-key="<key>"` (new). Uniqueness is scoped per-card-subtree and is an author responsibility.

**Rationale:** Some elements (`<input>`) want both value-and-selection persistence and focus-preservation. Other elements (a `<button>` that was last focused, or a custom keyboard-focusable `<div>`) want only focus-preservation, not value/selection. Unifying the attributes would force every focus-participating element to declare participation in value/selection persistence it doesn't support.

**Implications:** For form controls, `persistKey` implies both — the keeper prefers `data-tug-persist-value` as the element locator because it is present on every participating form control; it falls back to `data-tug-focus-key` only for non-form-control focus-only cases.

#### [D09] `SelectionKeeper` is the sole save/restore owner; `selectionGuard` retains drag-clipping (DECIDED) {#d09-keeper-vs-guard}

**Decision:** `selectionGuard.saveSelection` and `selectionGuard.restoreSelection` cease to be the public API for save/restore once [Step 12](#step-12) lands. Their bodies either move into the keeper as helpers or stay in the guard but are marked `@internal`. The guard retains: boundary registration, drag-selection clipping, selection-change observation. The keeper owns: capture at save triggers, apply at restore triggers, focus tracking.

**Rationale:** One concept, one owner (L-SEL-01). Drag-clipping and persistence are different concerns with different invariants — the former is runtime, the latter is transition-boundary. Collapsing them would bloat either module.

**Implications:** `card-host.tsx`, `action-dispatch.ts`, and any other current callers of the guard's save/restore API switch to keeper calls. A grep after [Step 12](#step-12) confirms zero remaining callers of `saveSelection` / `restoreSelection` outside the keeper module.

#### [D10] Migration drops non-primary per-input selections without user notification (DECIDED) {#d10-migration-drop-policy}

**Decision:** When migrating a v1 bag with multiple `domInputs` entries carrying selection fields, the keeper promotes the first entry whose selection is non-empty. Other entries' selection fields are dropped silently.

**Rationale:** The browser has one selection at a time; the v1 shape that stored selection per-input was architecturally over-broad. The correct state is "which input was focused and had a selection", not "all inputs' selections". Dropping is honest — those extra selections were never simultaneously observable.

**Implications:** Best-effort migration. Users who reload immediately after the update may see slightly different selection behavior than their pre-update session; on the next save, correct state is captured fresh.

---

### Deep Dives (Optional) {#deep-dives}

#### Three kinds of state {#three-kinds-of-state}

1. **DOM selection.** `window.getSelection()` returns a `Selection` with zero or more `Range`s. In our usage, at most one range. Its anchor and focus point at DOM nodes in the document tree; in our scoping, the nodes are inside a card's boundary element. Visible when (a) its nodes are rendered and un-hidden, and (b) the window has key status.

2. **Form-control selection.** Each `<input>` / `<textarea>` owns `selectionStart`, `selectionEnd`, `selectionDirection`. Invisible to `window.getSelection()`. Visible only when the element has focus. `setSelectionRange` on an unfocused element persists the range properties but does not paint.

3. **Focus.** `document.activeElement`. One element at a time (or `<body>` / `null`). Essential for form-control selection visibility; independent of DOM selection visibility.

The insight the plan rests on: *these are three things, not one thing*. Every save and restore path must explicitly handle all three.

#### Lifecycle transition classes {#transition-classes}

**Table T01: What each transition destroys or obscures** {#t01-transition-classes}

| Transition | DOM tree | focused element | DOM selection | form-control selection |
|---|---|---|---|---|
| Reload (in-process) | destroyed | destroyed | destroyed | destroyed |
| Relaunch (process restart) | destroyed | destroyed | destroyed | destroyed |
| Hide → Unhide | preserved | preserved (usually) | grayed/cleared | preserved internally, highlight cleared |
| Resign → Become Active | preserved | preserved | grayed, then cleared after 1st cycle for programmatic | preserved internally, highlight cleared |
| Tab/card activation within app | preserved | preserved | preserved | preserved |
| Cross-pane card move | reparented (portal slot) | preserved | *possibly* invalidated if anchor nodes reparent | preserved |

Legend: "preserved" = state is still valid, no restore needed (visibility may need a nudge). "destroyed" = full re-application required. "grayed/cleared" = state may be there or gone; system can't tell without checking.

The keeper handles all of them uniformly through `apply` + skip-if-correct: if the state is already right, no-op; if it's wrong, restore. The restore logic itself is the same across transitions — the difference between "reload" and "Cmd-Tab" is only which trigger fires apply.

#### Per-case correctness walkthrough {#per-case-walkthrough}

##### Case δ: reload, `TugInput`/`TugTextarea`, text restored, selection lost {#case-delta}

**Root cause:** `setSelectionRange` on unfocused element stores range but paints no highlight.

**Resolution:** On reload, `CardHost` mount-time `useLayoutEffect` (already the Path-B scroll/selection restore trigger) calls `keeper.apply(cardId, cardRoot, bag.selection)`. Apply sees `focus: { kind: "keyed", focusKey: "my-input" }`; locates the element via the card-scoped `querySelector`; checks [Q02] condition ("was this card the active card at save time?"); if yes, calls `el.focus()`. Then sees `selection: { kind: "form-control", persistKey: "my-input", start, end, direction }`, calls `el.setSelectionRange(start, end, direction)`. Focus + range = visible highlight.

##### Case α, β: hide/unhide or Cmd-Tab, form controls {#case-alpha-beta}

**Root cause:** Save reads `window.getSelection()` (empty for form controls); restore reads `bag.selection` which was never populated.

**Resolution:** Keeper's `capture` checks `document.activeElement`: if it's a form control with `data-tug-persist-value`, emits `kind: "form-control"` snapshot. On `willResignActive` or `willHide`, keeper.capture runs via the save-callback path. On `didBecomeActive` or `didUnhide`, keeper.apply runs via the lifecycle observer. Focus + range = visible.

##### Case γ: repeat Cmd-Tab on `TugPromptEntry`, second cycle degrades {#case-gamma}

**Root cause:** Our first-cycle restore uses `setBaseAndExtent`, producing a programmatic selection. WebKit tears down programmatic selections at did-phase before our save reads. Save captures null. Second-cycle restore has nothing to apply.

**Resolution:** Two compounding fixes.
1. **Save at will-phase** ([D04]). WebKit has not yet touched the selection; capture reads the (programmatic, but present) range truthfully.
2. **Skip-if-correct** ([D05]). If the first-cycle restore's range is still intact on the second willResign, `capture` still succeeds. On the second `didBecomeActive`, `apply` sees the live state matches the snapshot (because the browser either preserved it or had it restored by us previously), and no-ops. The selection is never re-programmaticized.

##### Tab/card activation {#case-tab-activation}

`observeCardWillDeactivate` → `keeper.capture` → persist in bag. `observeCardDidActivate` → `keeper.apply`. Skip-if-correct no-ops when nothing needs doing. See [Q04].

##### Cross-pane move {#case-cross-pane-move}

Portal slot reparents the card's DOM; element identities survive (L23). The `useLayoutEffect` keyed on `[hostContentEl]` re-fires with the new host; `keeper.apply` runs; skip-if-correct no-ops in the common case. TextContext fallback handles any reshaping-induced path invalidation.

##### Reload / relaunch {#case-reload}

Full loss-and-recover. Save on `beforeunload` or `saveAndFlushSync`; restore on cold-boot mount.

---

### Specification {#specification}

#### Public API — `SelectionKeeper` {#s01-keeper-api}

**Spec S01: `SelectionKeeper` public API** {#s01-keeper-api-spec}

```ts
export interface SelectionKeeper {
  /**
   * Capture current selection + focus state for `cardId`, scoped to
   * `boundary` (typically the card's `[data-card-host][data-card-id]` div).
   * Pure read; no DOM mutation. Returns a JSON-serializable snapshot.
   */
  capture(cardId: string, boundary: HTMLElement): CardSelectionState;

  /**
   * Apply a snapshot to `cardId` rooted at `boundary`.
   *   1. If `state.focus` is keyed and the live `document.activeElement`
   *      is not the target, call `el.focus()`. Skip if target not found
   *      or not focusable.
   *   2. If `state.selection` is `form-control`, find the element and
   *      call `setSelectionRange(start, end, direction)`. Skip if found
   *      element already matches.
   *   3. If `state.selection` is `dom`, resolve paths (with textContext
   *      fallback), call `selection.setBaseAndExtent(...)`. Skip if the
   *      current selection already matches the resolved endpoints.
   * Returns:
   *   - `"applied"` when at least one step changed state.
   *   - `"already-correct"` when every step was a no-op.
   *   - `"failed"` when the target is missing and no fallback succeeded;
   *     logs the failure in dev mode via `isDevEnv()`.
   */
  apply(
    cardId: string,
    boundary: HTMLElement,
    state: CardSelectionState,
  ): "applied" | "already-correct" | "failed";

  /**
   * Test helper. No-op in production; reserved for future instrumentation.
   */
  reset(): void;
}
```

#### Types {#s02-types}

**Spec S02: Snapshot types** {#s02-types-spec}

```ts
// In layout-tree.ts

export type SelectionSnapshot =
  | { kind: "none" }
  | {
      kind: "dom";
      anchorPath: number[];
      anchorOffset: number;
      focusPath: number[];
      focusOffset: number;
      textContext?: {
        text: string;
        anchorOffsetInText: number;
        focusOffsetInText: number;
      };
    }
  | {
      kind: "form-control";
      persistKey: string;
      start: number;
      end: number;
      direction: "forward" | "backward" | "none";
    };

export type FocusSnapshot =
  | { kind: "none" }
  | { kind: "keyed"; focusKey: string };

export interface CardSelectionState {
  selection: SelectionSnapshot;
  focus: FocusSnapshot;
}

export interface CardStateBag {
  version?: 2;           // present on new-shape bags; absent on v1
  scroll?: { x: number; y: number };
  content?: unknown;
  selection?: CardSelectionState;   // replaces v1's flat SavedSelection
  domInputs?: Record<string, {       // no longer carries selection fields
    value: string;
    scrollTop?: number;
    scrollLeft?: number;
  }>;
}
```

#### Element attributes {#s03-element-attributes}

**Spec S03: Element opt-in attributes** {#s03-element-attributes-spec}

- **`data-tug-persist-value="<key>"`** (existing, unchanged) — opts a form control into value-and-selection persistence. Carried by `TugInput` and `TugTextarea` when `persistKey` is set.
- **`data-tug-focus-key="<key>"`** (new) — opts any focusable element into focus-only persistence. Used by elements that want their focus state preserved but have no value/selection to persist.

Uniqueness scope: per card subtree. Collisions within a card are author error ([D08] spells out the behavior: querySelectorAll returns in document order; the later-rendered value wins at save, the first-matching wins at apply).

#### Save-trigger table {#s04-save-triggers}

**Table T02: Save triggers** {#t02-save-triggers}

| Trigger | Owner | Calls | Notes |
|---|---|---|---|
| `applicationWillResignActive` | `action-dispatch.ts` | `deckManager.saveAndFlush()` → `saveCurrentCardState` → `keeper.capture` for each registered card | Primary; contingent on [Q03] |
| `applicationWillHide` | `action-dispatch.ts` | same | Primary; contingent on [Q03] |
| `applicationDidResignActive` | `action-dispatch.ts` (existing) | same | Backstop; fires if will-phase missed |
| `applicationDidHide` | `action-dispatch.ts` | same | Backstop |
| `window.beforeunload` | `DeckManager.handleBeforeUnload` (existing) | save callbacks + sync flush | Reload boundary |
| `document.visibilitychange(hidden)` | `DeckManager.handleVisibilityChange` (existing) | save callbacks + flush | Tab backgrounded |
| Swift `applicationShouldTerminate` → `window.tugdeck.saveState()` | `DeckManager.saveAndFlushSync` (existing) | save callbacks + sync flush | Process exit |
| `focusout` on keyed element (debounced 50 ms) | `selection-keeper.ts` module-level listener | `keeper.capture` for the card owning the blurring element | [Q06] safety net |
| `observeCardWillDeactivate` | `action-dispatch.ts` | `keeper.capture` for the deactivating card | [Q04] cross-card transfer |
| `_detachCard` / `_moveCardToPane` | `DeckManager` (existing) | `invokeSaveCallback(cardId)` | Fresh-bag invariant |

#### Restore-trigger table {#s05-restore-triggers}

**Table T03: Restore triggers** {#t03-restore-triggers}

| Trigger | Owner | Calls | Notes |
|---|---|---|---|
| `CardHost` mount-time `useLayoutEffect` on `[hostContentEl]` | `card-host.tsx` | `keeper.apply` for this card | Reload/relaunch/cross-pane |
| `applicationDidBecomeActive` | `action-dispatch.ts` | `keeper.apply` for the **focused card only** (per [Q01]) | Cmd-Tab return |
| `applicationDidUnhide` | `action-dispatch.ts` | same as didBecomeActive | Unhide |
| `observeCardDidActivate` | `action-dispatch.ts` | `keeper.apply` for the activating card | Tab/pane switch |
| `onContentReady` (child re-render with restored content) | `card-host.tsx` (existing) | `keeper.apply` | Post-child-commit coordination |

#### Ordering invariants {#s06-ordering-invariants}

**Spec S06: Ordering** {#s06-ordering-invariants-spec}

1. Apply always applies focus before selection. A form-control selection would be invisible without focus.
2. Skip-if-correct runs on each of the three steps independently. A snapshot can be "apply focus, skip selection" or "skip focus, apply selection" depending on live state.
3. `capture` is always synchronous, never async. Waiting for a microtask risks WebKit having cleared selection.
4. `apply` is idempotent. Applying the same snapshot twice has the effect of one application at most.

---

### Compatibility / Migration / Rollout {#rollout}

**Compatibility policy.** `CardStateBag` gains an optional `version` field. Old bags (no `version`) are migrated on read to v2 shape. The migrated in-memory representation is the new shape; writes always produce v2.

**Migration plan.**

- *What changes.* `bag.selection` shape flips from `SavedSelection` (flat) to `CardSelectionState` (tagged). Selection fields (`selectionStart`/`End`/`Direction`) leave `domInputs` entries; the per-input remainder (`value`/`scrollTop`/`scrollLeft`) stays.
- *Who is impacted.* Every user with saved card state (in-flight bags) at the time this plan ships.
- *How to migrate.* `migrateBag(oldBag)` in `settings-api.ts`:
    1. If `bag.selection` has shape `SavedSelection`, wrap it as `{ selection: { kind: "dom", ...fields }, focus: { kind: "none" } }`.
    2. For each `domInputs` entry with selection fields, pick the first non-empty range; promote to a top-level form-control `CardSelectionState`. Strip selection fields from all entries.
    3. Set `version: 2`.
- *How to detect breakage.* Dev-mode log on `migrateBag` calls; count in telemetry for one release cycle. A spike in "migration dropped selection" logs would indicate poorly-ordered `domInputs` migration; unlikely given the one-selection-at-a-time invariant.

**Rollout plan.** Ship commits 1–14 in order; each green on `bun x tsc --noEmit` + `bun test`. The first behavioral change lands at [Step 7](#step-7) (CardHost adoption); up to that point the keeper exists but is unused. If a regression surfaces after Step 7, revert Step 7 alone and continue.

**Rollback.** Per-commit revertable. Full rollback: revert the 14-commit series in reverse order; land on pre-selection-plan state (the `8de575c4` partial wire, with the four failure cases visible).

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/selection-keeper.ts` | `SelectionKeeper` module with `capture`/`apply` |
| `tugdeck/src/__tests__/selection-keeper.test.tsx` | Unit tests for capture + apply |
| `tugdeck/src/__tests__/selection-keeper-integration.test.tsx` | Integration tests per transition class |

#### Modified files {#modified-files}

| File | Modification |
|------|--------------|
| `tugdeck/src/layout-tree.ts` | Add `SelectionSnapshot`, `FocusSnapshot`, `CardSelectionState`; update `CardStateBag` |
| `tugdeck/src/settings-api.ts` | Add `migrateBag`; call from `readCardStates` |
| `tugdeck/src/components/chrome/card-host.tsx` | Replace direct `selectionGuard` calls with `keeper.capture`/`apply`; scrub selection fields from `captureDomInputs`/`applyDomInputSnapshot` |
| `tugdeck/src/action-dispatch.ts` | Subscribe `willResignActive`/`willHide` (save) and `didBecomeActive`/`didUnhide` (apply); subscribe `cardWillDeactivate`/`cardDidActivate` |
| `tugdeck/src/components/tugways/tug-input.tsx` | Add `focusKey?: string` prop; render `data-tug-focus-key` when set |
| `tugdeck/src/components/tugways/tug-textarea.tsx` | same |
| `tugdeck/src/components/tugways/selection-guard.ts` | Mark `saveSelection` / `restoreSelection` `@internal`; retain drag-clipping exports |
| `tugdeck/src/components/tugways/hooks/index.ts` | Barrel for keeper if imported as a hook surface (likely just a module import) |
| `tugapp/AppDelegate.swift` | [Contingent on [Q03]] Emit `willResignActive` / `willHide` via `sendControl("app-lifecycle", ...)` |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `SelectionKeeper` | interface + singleton | `selection-keeper.ts` | public |
| `SelectionSnapshot` | tagged union | `layout-tree.ts` | public |
| `FocusSnapshot` | tagged union | `layout-tree.ts` | public |
| `CardSelectionState` | interface | `layout-tree.ts` | public |
| `migrateBag` | function | `settings-api.ts` | module-private |
| `captureDomSelection` | helper | `selection-keeper.ts` | module-private |
| `captureFormControlSelection` | helper | `selection-keeper.ts` | module-private |
| `captureFocus` | helper | `selection-keeper.ts` | module-private |
| `applyDomSelection` | helper | `selection-keeper.ts` | module-private |
| `applyFormControlSelection` | helper | `selection-keeper.ts` | module-private |
| `applyFocus` | helper | `selection-keeper.ts` | module-private |
| `data-tug-focus-key` | HTML attribute | emitted by `TugInput`/`TugTextarea` (when `focusKey` is set), authors can place anywhere | reserved |
| `persistKey` | prop | existing | unchanged |
| `focusKey` | prop | new on `TugInput`/`TugTextarea` | optional |

---

### Documentation Plan {#documentation-plan}

- [ ] Module docstring for `selection-keeper.ts` covering the three kinds of state, the skip-if-correct policy, and the L-SEL-* tuglaws.
- [ ] JSDoc for the `SelectionSnapshot`, `FocusSnapshot`, `CardSelectionState` types.
- [ ] JSDoc on `TugInput`/`TugTextarea` `focusKey` prop, and updates to `persistKey` JSDoc explaining the keeper relationship.
- [ ] Update `CardHost` module docstring: replace the "Restoration is trigger-driven" section with a pointer to the keeper.
- [ ] Candidate tuglaws additions — submit as a separate small patch to `tuglaws/tuglaws.md`:
  - **L-SEL-01** Selection and focus are singletons owned by `SelectionKeeper`.
  - **L-SEL-02** Selection save runs at the will-phase of every lifecycle-loss event.
  - **L-SEL-03** Selection apply is skip-if-correct.
- [ ] Cross-reference: [`tugplan-tide-card-polish.md`](./tugplan-tide-card-polish.md) §5.5.c Commit 1A points here.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (capture)** | Capture behavior for each snapshot kind against a synthetic boundary | Every capture helper |
| **Unit (apply)** | Apply behavior including skip-if-correct and fallback | Every apply helper |
| **Unit (migration)** | Round-trip v1 → v2 for each bag variant | `migrateBag` |
| **Integration (transition × kind)** | Full save → lifecycle-fire → restore flow for each combination | [Step 13](#step-13) |
| **Regression** | The four failure cases (α/β/γ/δ) each reproduced as a bun test | [Step 13](#step-13) |
| **Contract (grep)** | A compile/grep assertion that no file outside the keeper calls `setSelectionRange` / `setBaseAndExtent` / `.focus()` for persistence purposes | [Step 13](#step-13) |

---

### Execution Steps {#execution-steps}

14 steps. Each step has a commit, `References:`, `Depends on:`, artifacts, tasks, tests, and a checkpoint.

#### Step 1: Add `SelectionSnapshot` / `FocusSnapshot` / `CardSelectionState` types {#step-1}

**Commit:** `feat(layout-tree): add SelectionSnapshot, FocusSnapshot, CardSelectionState`

**References:** [D02] tagged union, [D03] focus separate, Spec S02, (#three-kinds-of-state)

**Artifacts:**
- `tugdeck/src/layout-tree.ts` gains the three new types.
- `CardStateBag` grows `version?: 2`; the old-shape `selection?: SavedSelection` field is replaced by the new-shape `selection?: CardSelectionState`.

**Tasks:**
- [ ] Add types.
- [ ] Keep `SavedSelection` exported (it's now a helper type inside the DOM variant).
- [ ] Update callers of `CardStateBag['selection']` in the codebase to compile against the new shape — behaviorally, calls remain no-ops while Step 7 has not landed.

**Tests:**
- [ ] Unit test exercising `JSON.stringify(snapshot)` round-trip for each variant.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`

#### Step 2: `SelectionKeeper` skeleton {#step-2}

**Depends on:** #step-1

**Commit:** `feat(selection-keeper): add module skeleton with placeholder capture/apply`

**References:** [D01] singleton, Spec S01, (#three-kinds-of-state)

**Artifacts:**
- `tugdeck/src/components/tugways/selection-keeper.ts` with `capture` returning `{ selection: { kind: "none" }, focus: { kind: "none" } }` and `apply` returning `"already-correct"`.
- Unit-test file skeleton.

**Tasks:**
- [ ] Module docstring.
- [ ] Public API per Spec S01.
- [ ] Internal helpers declared but not implemented.

**Tests:**
- [ ] Keeper module imports cleanly.
- [ ] Placeholder `capture` + `apply` are callable.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`

#### Step 3: Capture — DOM selection {#step-3}

**Depends on:** #step-2

**Commit:** `feat(selection-keeper): capture DOM selection with textContext`

**References:** [D02] tagged union, [D06] textContext fallback, Spec S02, (#case-gamma)

**Artifacts:**
- `captureDomSelection(boundary): SelectionSnapshot` implementing the `kind: "dom"` branch.
- Path-building helper (ported from `selectionGuard`).
- textContext capture (adaptive per [Q07] Option C) *with* small default; grow on demand during apply.

**Tasks:**
- [ ] Implement path building (reuse `selectionGuard`'s existing logic).
- [ ] Capture anchor/focus paths + offsets.
- [ ] Capture a 40-char textContext window by default.

**Tests:**
- [ ] Capture with a selection inside a known boundary. Assert path + offset match.
- [ ] Capture with no selection: returns `kind: "none"`.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`

#### Step 4: Capture — form-control selection + focus {#step-4}

**Depends on:** #step-3

**Commit:** `feat(selection-keeper): capture form-control selection and focus`

**References:** [D02] tagged union, [D03] focus separate, [D08] persist/focus keys, Spec S02, Spec S03, (#case-alpha-beta)

**Artifacts:**
- `captureFormControlSelection(boundary): SelectionSnapshot | null` for the form-control branch.
- `captureFocus(boundary): FocusSnapshot` reading `document.activeElement`.
- Aggregation: `capture(cardId, boundary)` dispatches between DOM and form-control based on active element type.

**Tasks:**
- [ ] Detect active element inside boundary.
- [ ] If form control with `data-tug-persist-value`: emit `form-control` snapshot.
- [ ] Else: fall through to DOM capture.
- [ ] Focus capture reads `data-tug-focus-key` preferentially, else `data-tug-persist-value`.

**Tests:**
- [ ] Capture with focus inside an `<input>` carrying persistKey.
- [ ] Capture with focus on a contenteditable; DOM path returns.
- [ ] Capture with focus on unkeyed element: focus `kind: "none"`.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`

#### Step 5: Apply — DOM selection {#step-5}

**Depends on:** #step-4

**Commit:** `feat(selection-keeper): apply DOM selection with skip-if-correct`

**References:** [D05] skip-if-correct, [D06] textContext fallback, Spec S01, (#r02-skip-if-correct-false-negative)

**Artifacts:**
- `applyDomSelection(boundary, snapshot)` with primary path resolution, textContext adaptive fallback (20 → 40 → 80 → 160 chars, per [Q07]).
- Skip-if-correct check comparing resolved node+offset tuples.
- Dev-mode logging of failures per [Q05].

**Tasks:**
- [ ] Primary path resolution via `pathToNode`.
- [ ] TextContext fallback with adaptive window.
- [ ] Skip-if-correct check.
- [ ] Return `"applied" | "already-correct" | "failed"`.

**Tests:**
- [ ] Apply into an unchanged DOM: `"applied"` on empty → populated, `"already-correct"` on repeat.
- [ ] Apply with DOM reshaped but textContext still resolvable: `"applied"`.
- [ ] Apply with DOM reshaped and textContext unresolvable: `"failed"`.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`

#### Step 6: Apply — form-control selection + focus {#step-6}

**Depends on:** #step-5

**Commit:** `feat(selection-keeper): apply form-control selection and focus with skip-if-correct`

**References:** [D03] focus separate, [D05] skip-if-correct, Spec S01, Spec S06, (#case-delta, #q02-focus-steal-on-reload)

**Artifacts:**
- `applyFormControlSelection(boundary, snapshot)` with element lookup, setSelectionRange, skip-if-correct.
- `applyFocus(boundary, snapshot)` with element lookup, `.focus()`, skip-if-correct, [Q02] Option B guard.
- Aggregation: `apply(cardId, boundary, state)` runs focus then selection, skip-if-correct on each.

**Tasks:**
- [ ] Element lookup by `data-tug-persist-value` → `data-tug-focus-key`.
- [ ] Focus application with [Q02] guard (focus was in focused card at save time).
- [ ] setSelectionRange with skip-if-correct.

**Tests:**
- [ ] Apply form-control snapshot: focus + selectionRange applied.
- [ ] Apply with element missing: `"failed"` + dev-mode log.
- [ ] Apply with live state matching: `"already-correct"`, no setSelectionRange call (verify via spy).

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`

#### Step 7: `CardHost` adoption {#step-7}

**Depends on:** #step-6

**Commit:** `refactor(card-host): delegate selection save/restore to SelectionKeeper`

**References:** [D09] keeper sole owner, Spec S01, Table T02, Table T03, (#case-delta)

**Artifacts:**
- `card-host.tsx` save path: `saveCurrentCardStateRef` calls `keeper.capture(cardId, cardRoot)`; assigns the result to `bag.selection`.
- `card-host.tsx` restore path: the `useLayoutEffect` on `[hostContentEl]` calls `keeper.apply(cardId, cardRoot, bag.selection)` instead of `selectionGuard.restoreSelection`.
- `onContentReady` (the post-child-commit restore point) also calls `keeper.apply`.
- `captureDomInputs` and `applyDomInputSnapshot` are reduced to value + scroll only; selection fields go away.
- Bag-side: legacy `bag.selection` as `SavedSelection` migrated into `CardSelectionState` on write by `keeper.capture` emitting the new shape.

**Tasks:**
- [ ] Wire `keeper.capture` in save path.
- [ ] Wire `keeper.apply` in `useLayoutEffect` and `onContentReady`.
- [ ] Strip selection fields from `DomInputSnapshot`.
- [ ] Update `captureDomInputs` / `applyDomInputSnapshot` signatures.
- [ ] Update JSDoc on the two helpers and the `useLayoutEffect`.

**Tests:**
- [ ] `card-host-composition.test.tsx` remains green (save/restore observable behavior).
- [ ] Explicit test: reload with DOM selection → `keeper.apply` called with correct args.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`
- [ ] Manual verification: reload an app; prior selection restores. (Per SC-1.)

#### Step 8: Lifecycle wiring — did-phase restore {#step-8}

**Depends on:** #step-7

**Commit:** `feat(action-dispatch): apply keeper on didBecomeActive and didUnhide`

**References:** [Q01], [D05] skip-if-correct, Table T03, (#case-alpha-beta)

**Artifacts:**
- `action-dispatch.ts` adds an observer for `observeApplicationDidBecomeActive` and `observeApplicationDidUnhide` that:
    1. Reads `deckManager.getFocusedCardId()`.
    2. Resolves the card's host pane and `cardId`.
    3. Looks up `cardRoot` via `findCardRoot`.
    4. Calls `keeper.apply(cardId, cardRoot, bag.selection)` (state from `deckManager.getCardState`).
- The existing ad-hoc `restoreActiveCardSelection` block is *replaced* by this wire.

**Tasks:**
- [ ] Implement the resolve + apply sequence.
- [ ] Remove the old `restoreActiveCardSelection` + `selectionGuard.restoreSelection` call.
- [ ] Guard: if no snapshot, no-op silently.

**Tests:**
- [ ] Integration: fire `notifyApplicationDidBecomeActive` via `appLifecycle`; assert `keeper.apply` is called with the focused card's snapshot.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`
- [ ] Manual verification: Cmd-Tab cycle (first); selection restores. (Per SC-4.)

#### Step 8a: [Conditional] Swift emission of will-phase events {#step-8a}

**Depends on:** #step-8

**Commit:** `feat(tugapp): emit applicationWillResignActive/WillHide to webview`

**References:** [Q03], [D04] save at will-phase, [R01] Swift will-phase

**Trigger:** this step runs only if the [Q03] resolution is "missing — need to add".

**Artifacts:**
- `tugapp/.../AppDelegate.swift` gains observers on `applicationWillResignActiveNotification` and `applicationWillHideNotification` that send Control frames `app-lifecycle/willResignActive` and `app-lifecycle/willHide`.

**Tasks:**
- [ ] Add the Swift observers.
- [ ] Send Control frame with `{ event: "willResignActive" }` (matching the switch at `action-dispatch.ts:440–475`).
- [ ] Verify emission in Xcode runtime log.

**Tests:**
- [ ] Integration from JS side: observe that the JS-side `observeApplicationWillResignActive` subscription fires on Cmd-Tab.

**Checkpoint:**
- [ ] Build tugapp; manual verification in dev.

#### Step 8b: Lifecycle wiring — will-phase save {#step-8b}

**Depends on:** #step-8a (or directly on #step-8 if 8a is skipped)

**Commit:** `feat(action-dispatch): save on willResignActive and willHide via keeper`

**References:** [D04] save at will-phase, Table T02, (#case-gamma, #r01-swift-will-phase)

**Artifacts:**
- `action-dispatch.ts` subscribes `observeApplicationWillResignActive` and `observeApplicationWillHide` → `deckManager.saveAndFlush()`. The existing did-phase save remains as a backstop.

**Tasks:**
- [ ] Add subscriptions.
- [ ] Verify that capture at will-phase reads a still-present selection.

**Tests:**
- [ ] Integration: fire `notifyApplicationWillResignActive`; assert save callbacks run.
- [ ] Regression: Case γ second cycle — two Cmd-Tab cycles; selection still present after second (SC-5).

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`
- [ ] Manual verification: Case γ regression (two Cmd-Tab cycles). (Per SC-5.)

#### Step 9: Blur-time capture safety net {#step-9}

**Depends on:** #step-8b

**Commit:** `feat(selection-keeper): add debounced blur-time capture on deck root`

**References:** [Q06] debounce interval, Table T02

**Artifacts:**
- Module-level `focusout` listener on the deck root inside `selection-keeper.ts` (installed via a `selectionKeeper.attach(deckRootEl)` hook called from the existing deck-manager init path).
- 50 ms debounce.
- Scoped: the listener resolves the card owning the blurring element via `findCardRoot`; if found, captures and calls `deckManager.setCardState`.

**Tasks:**
- [ ] Add `attach` hook.
- [ ] Install `focusout` listener.
- [ ] Debounce.

**Tests:**
- [ ] Unit: blur a keyed element 5 times in 30 ms; assert `capture` is called once.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`

#### Step 10: Card activation wiring {#step-10}

**Depends on:** #step-9

**Commit:** `feat(action-dispatch): capture on cardWillDeactivate, apply on cardDidActivate`

**References:** [Q04] cross-card activation, Table T02, Table T03

**Artifacts:**
- `action-dispatch.ts` subscribes `observeCardWillDeactivate` (capture via save path) and `observeCardDidActivate` (keeper.apply for the activating card).

**Tasks:**
- [ ] Add subscriptions.
- [ ] Ensure capture runs synchronously before state flip.

**Tests:**
- [ ] Integration: simulate card A active → click card B; `keeper.capture` for A, `keeper.apply` for B.
- [ ] Skip-if-correct no-op on rapid A → B → A.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`
- [ ] Manual verification: selection transfers between cards cleanly. (Per SC-6.)

#### Step 11: `selectionGuard` deprecation of save/restore API {#step-11}

**Depends on:** #step-10

**Commit:** `refactor(selection-guard): mark saveSelection/restoreSelection @internal`

**References:** [D09] keeper sole owner, (#s01-keeper-api, #q05-stale-snapshot-handling)

**Artifacts:**
- `saveSelection` and `restoreSelection` on `selectionGuard` either move their bodies into `selection-keeper.ts` as helpers (preferred) or remain on the guard marked `@internal` and no longer exported.
- `grep` of the codebase confirms no call sites outside the keeper.

**Tasks:**
- [ ] Move or mark.
- [ ] Update `selection-guard.ts` module docstring.

**Tests:**
- [ ] Existing `selection-model.test.tsx` tests: ensure the drag-clipping-focused tests still pass; retire any test that targeted the old save/restore API (superseded by keeper tests).

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`
- [ ] `grep -R 'selectionGuard\.\(saveSelection\|restoreSelection\)' tugdeck/src/ | grep -v selection-keeper.ts` returns empty.

#### Step 12: Bag migration {#step-12}

**Depends on:** #step-11

**Commit:** `feat(settings-api): migrate v1 CardStateBag to v2 shape on read`

**References:** [D07] bag schema versioning, [D10] migration drop policy, (#rollout)

**Artifacts:**
- `settings-api.ts` gains `migrateBag(bag): CardStateBag` (see [D07] body for algorithm).
- `readCardStates` calls `migrateBag` on each entry.

**Tasks:**
- [ ] Implement `migrateBag`.
- [ ] Call from `readCardStates`.
- [ ] Log when migration dropped a selection (dev-mode, per [Q05]).

**Tests:**
- [ ] Unit: v1 `{selection: SavedSelection}` → v2 `{selection: {selection: {kind:"dom",...}, focus:{kind:"none"}}}`.
- [ ] Unit: v1 `{domInputs: {a: {value, selectionStart, selectionEnd}, b: {value, selectionStart, selectionEnd}}}` → v2 with one promoted top-level form-control selection, `domInputs` stripped of selection fields.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`

#### Step 13: Integration test harness {#step-13}

**Depends on:** #step-12

**Commit:** `test(selection-keeper): integration tests for every transition × kind`

**References:** Spec S01, Table T01, Table T02, Table T03, (#success-criteria, #per-case-walkthrough)

**Artifacts:**
- `tugdeck/src/__tests__/selection-keeper-integration.test.tsx` covering the cases from `#per-case-walkthrough`.

**Tasks:**
- [ ] Write tests for α (hide/unhide, form-control), β (Cmd-Tab, form-control), γ (double Cmd-Tab, DOM), δ (reload, form-control with focus).
- [ ] Write tests for tab activation, cross-pane move, reload with DOM selection.
- [ ] Write a grep-based contract test: no `setSelectionRange` / `setBaseAndExtent` / `.focus()` usage in `tugdeck/src` outside `selection-keeper.ts`.

**Tests:** (the whole commit is tests)

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test` — all new tests pass.

#### Step 14: Documentation {#step-14}

**Depends on:** #step-13

**Commit:** `docs(selection): tuglaws L-SEL-01/02/03 + cross-references`

**References:** [D01] singleton, [D04] will-phase, [D05] skip-if-correct, (#documentation-plan)

**Artifacts:**
- Propose L-SEL-01, L-SEL-02, L-SEL-03 as additions to `tuglaws/tuglaws.md` (separate patch if preferred).
- Update `CardHost` module docstring with the restoration-is-keeper-owned rewrite.
- Update [`tugplan-tide-card-polish.md`](./tugplan-tide-card-polish.md) §5.5.c Commit 1A section to mark the selection follow-on shipped.

**Tasks:**
- [ ] Write the tuglaws entries.
- [ ] Update docstrings.
- [ ] Cross-reference back to the original plan.

**Tests:** N/A (documentation)

**Checkpoint:**
- [ ] Docs readable; links resolve.
- [ ] No test regressions.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A unified `SelectionKeeper` subsystem, wired into every relevant lifecycle transition, with selection and focus correctness on every row of the superseded `persistence-reliability.md` Part 7 status dashboard.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] All 10 success criteria (SC-1 through SC-10) met and verified.
- [ ] Every open question resolved or explicitly deferred with rationale captured in this doc.
- [ ] `grep` contract test (Step 13) confirms keeper is the sole writer of selection/focus for persistence.
- [ ] Migration log sweep of a dev build with old-shape bags shows no crashes; any "dropped selection" messages are accounted for.
- [ ] Manual verification of every failure case in `#per-case-walkthrough`: α, β, γ, δ all pass; tab activation, cross-pane move, reload all pass.

**Acceptance tests:**
- [ ] `selection-keeper-integration.test.tsx` passes in full.
- [ ] No regressions in `card-host-composition.test.tsx`, `selection-model.test.tsx`, `pane-focus-controller.test.tsx`.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Extend textContext fallback to handle insertion/deletion near the anchor (fuzzy match with edit distance ≤ N).
- [ ] Cross-card selection support (browser one-selection limit still applies, but the keeper could notice cross-card selections at capture time and decide a policy).
- [ ] Port `selectionGuard`'s drag-clipping behavior into an even narrower module if the boundary continues to be useful after the keeper migration settles.

| Checkpoint | Verification |
|------------|--------------|
| Step 1 types compile | `bun x tsc --noEmit` |
| Keeper capture/apply unit-tested | `bun test src/__tests__/selection-keeper.test.tsx` |
| CardHost adoption doesn't regress existing tests | `bun test src/__tests__/card-host-composition.test.tsx` |
| Case γ regression passes | `bun test -t 'case gamma'` |
| Phase exit | All SC-1..10 verified manually + `bun test` passes |
