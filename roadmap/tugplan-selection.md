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
| Last updated | 2026-04-23 |

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
- [SC-10] The set of files that call `setBaseAndExtent`, `setSelectionRange`, or `.focus()` *for persistence purposes* is exactly one (`selection-keeper.ts`). Verified by `grep`.

#### Scope {#scope}

1. A new module `tugdeck/src/components/tugways/selection-keeper.ts` with `capture`, `apply`, and a set of internal helpers.
2. New types in `tugdeck/src/layout-tree.ts`: `SelectionSnapshot`, `FocusSnapshot`, `CardSelectionState`, and an updated `CardStateBag`.
3. Updated save and restore paths in `tugdeck/src/components/chrome/card-host.tsx` that delegate to the keeper.
4. Updated app-lifecycle wiring in `tugdeck/src/action-dispatch.ts`: subscribes `willResignActive`, `willHide` (for save) and `didBecomeActive`, `didUnhide` (for apply).
5. A new element attribute `data-tug-focus-key`, plus a `focusKey?: string` prop on `TugInput` and `TugTextarea`.
6. Deprecation of `selectionGuard.saveSelection` / `restoreSelection` as public API; the logic moves into the keeper, `selectionGuard` retains only drag-clipping and boundary-registration concerns.
7. Best-effort migration of in-flight bags on cold-boot read.
8. Integration tests covering each of the transition × selection-kind combinations.
9. Documentation: module docstring on the keeper, JSDoc on the new props and types, updates to `persistence` / `selection` comments in `CardHost`, and a cross-reference from `tugplan-tide-card-polish.md`. Proposed tuglaws L-SEL-01 / L-SEL-02 / L-SEL-03 are tracked as post-phase follow-ons, not phase-exit criteria.

#### Non-goals (Explicitly out of scope) {#non-goals}

- **Drag-select clipping during live interaction.** `selectionGuard` continues to own this. The keeper reads the resulting DOM selection; it does not police it.
- **Undo/redo of selection history.** Different subsystem with different invariants.
- **Multi-range selections.** Not in the browser's practical API on our platform; the snapshot is one range.
- **Cross-card selections.** A user-made selection spanning two cards is not a concept the UI supports today; the keeper captures only the active card's side if such a selection exists.
- **Browser-tab transitions** (switching to a different browser tab while our webview is open in a browser-dev context). The browser handles its own behavior; we treat it as equivalent to hide/unhide.
- **Restoring focus to a non-keyed element.** An element without `data-tug-persist-value` or `data-tug-focus-key` does not participate. No implicit focus preservation via DOM position or selector heuristics.
- **Elements whose key collides within a card.** Uniqueness is an author responsibility (see [D08] below for the contract).
- **`persistKey` / `focusKey` values requiring CSS-selector escaping.** Keys must be printable ASCII without whitespace or special characters that would require CSS-escaping in `querySelector(...)`. A future enhancement could add a runtime validator; this phase treats CSS-safety as an author-contract responsibility ([D08]).

#### Dependencies / Prerequisites {#dependencies}

- **`AppLifecycle` delegate system** with `observeApplication{Will,Did}{BecomeActive,ResignActive,Hide,Unhide}` — already in place; confirmed at `tugdeck/src/lib/app-lifecycle.ts` (see `observeApplicationWillResignActive` / `observeApplicationWillHide` at `tugdeck/src/lib/app-lifecycle.ts:170,178`).
- **Swift host emission of `willResignActive` / `willHide`** — already present. Verified at `tugapp/Sources/AppDelegate.swift:199-211` (emits both events) and `tugdeck/src/action-dispatch.ts:455,461` (switches on both events and calls `lifecycle.notifyApplicationWillResignActive()` / `notifyApplicationWillHide()`). See [Q03].
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

- WebKit emits `applicationWillResignActive` / `applicationWillHide` before clearing selection visibility. The Swift host emits these events and the JS action-dispatch subscribes to them (see [Q03] for file:line verification). Blur-time capture remains as a secondary defense for window-level transitions where no element blurs.
- WebKit preserves `el.selectionStart` / `selectionEnd` across hide/unhide and resign/activate *when an element still has focus*. If the user Cmd-H's while an input is focused, WebKit keeps the range internally. Empirically needs confirmation on the exact platform version.
- `data-*` attributes survive cross-pane moves because the attribute is on a DOM element, not React state, and the element travels with the card's portal slot.
- The card's `[data-card-host][data-card-id]` div is rendered inside the card's subtree at save and at restore time. (True after `d70ee0d8` and `8de575c4`; any future refactor that breaks this breaks the keeper's boundary scoping.)

---

### Reference and Anchor Conventions {#reference-conventions}

Per `tuglaws/tugplan-skeleton.md`. Anchors follow the prefix convention (`d`NN, `q`NN, `r`NN, `s`NN, `t`NN, `l`NN, `step-N`); every execution step carries a `**References:**` line.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

Every open question below has a concrete question, what breaks if we guess wrong, options with tradeoffs, and a decision plan. Resolve before starting [Step 1](#step-1), or explicitly defer with rationale.

#### [Q01] On `applicationDidBecomeActive` / `applicationDidUnhide`, which cards does the keeper re-apply? (DECIDED) {#q01-restore-scope-on-activate}

**Question.** When the app becomes active again after Cmd-Tab or unhide, the keeper's `apply()` is called via the lifecycle observer. Does it walk **every card** that has a saved selection snapshot and apply each, or **only the active card of the active pane** (i.e., the single card that was "where the user was" when the app went inactive)?

**Why it matters.** The browser has one selection at a time, globally. Only one card can have a visible selection. If we apply snapshots to non-focused cards, we are writing to `el.selectionStart` / `selectionEnd` on elements inside display-none subtrees or inactive tabs, which is harmless but wasted work — and any DOM-selection apply to a non-focused card would instantly move the browser's global selection off the focused card, which is wrong. If we apply to only the focused card, non-focused cards keep their saved snapshots; those get applied at `cardDidActivate` time when the user later switches. That path exists regardless ([Q04]).

**Options considered.**
- **Option A — focused card only.** Keeper iterates the `activePaneId` → `activeCardId` resolution and applies for that one card. Other cards rely on `cardDidActivate` for eventual apply.
- **Option B — every card with a snapshot.** Keeper walks all cards, calls apply for each. For form-control selections on non-focused cards, this is a set-but-invisible state (harmless). For DOM selections on non-focused cards, this *moves the browser's global selection* — certainly wrong.
- **Option C — every card for form-control snapshots, focused card only for DOM snapshots.** Hybrid. Avoids B's DOM-wreckage while pre-warming form-control offsets on inactive cards.

**Resolution: DECIDED — Option A (focused card only).**

Rationale:
1. Option B is eliminated — DOM-selection apply on a non-focused card is unambiguously wrong (moves the browser's global selection off the focused card).
2. Option C's pre-warming has no user-visible payoff. Form-control `selectionStart/End` on an invisible card is not observable; the offsets are re-applied when the user visits that card via `cardDidActivate` (Step 12 / [Q04]).
3. Option A matches the user's mental model: "when I come back, my selection is where I left it, which was the active card." The per-card-activation path covers every other card the user later visits.
4. Option A is the smallest surface that still satisfies SC-1, SC-2, SC-5, SC-6.

Implemented at [Step 9](#step-9). Revisit only if SC-6 fails after [Step 12](#step-12) (card activation wiring) lands.

#### [Q02] On cold-boot reload/relaunch, does the keeper's `apply()` steal focus? (DECIDED) {#q02-focus-steal-on-reload}

**Question.** When a card mounts with a saved `CardSelectionState` where `focus: { kind: "keyed", focusKey: "..." }`, should the keeper call `el.focus()`?

**Why it matters.** Restoring focus is **required** for form-control selection to be *visible* — `setSelectionRange` on an unfocused element paints no highlight ([SC-2]). But stealing focus on cold mount can be surprising, especially on multi-pane layouts where the restored card may not be the pane the user is looking at.

**Options considered.**
- **Option A — always.** If the saved snapshot has a focus key, focus the element on mount. Uniform behavior; fulfills SC-2 without caveats. Downside: on multi-pane layouts, yanks focus away from the active pane's card to a non-active pane's card just because that card mounted with a saved focus key.
- **Option B — only when the card being restored is the active card of the active pane.** If the saved focus belongs to `deckState.panes[activePaneIndex].activeCardId`, focus it. Otherwise leave focus alone; the user's `cardDidActivate` path (Step 12 / [Q04]) focuses the card when they later navigate to it.
- **Option C — never. Rely on the user clicking back in.** Save fidelity drops: the user sees their text but no cursor until they click. SC-2 fails for the common case.

**Resolution: DECIDED — Option B (active card of active pane only).**

Rationale:
1. Option C is eliminated — defeats the purpose of the plan (SC-2 requires visible selection on restore).
2. Option A breaks on multi-pane layouts: if pane 0 has card X focused and pane 1 has card Y with a stored focus key, A would call `.focus()` on Y during mount, stealing focus off X. B defers Y's focus until the user navigates to pane 1; at that moment `cardDidActivate` fires and the per-card-activation path ([Q04]) focuses Y cleanly.
3. B reads naturally as "where the user left off" — the user left off with focus on the active card of the active pane. Non-active panes' cards get their focus back when the user visits them, not speculatively on mount.
4. Implementation is a single guard: `cardId === deckState.panes[activePaneIndex].activeCardId`.

**Cmd-Tab then quit is not a wrinkle.** `applicationWillResignActive` fires before WebKit clears selection visibility ([D04]). If the WebView still owns focus on a keyed input at that moment, the will-phase save captures `focus: { kind: "keyed", focusKey: X }` directly. If WKWebView has transiently moved focus to `document.body` by then, capture emits `{ kind: "body-transient", lastKeyedFocus: X }` ([D03], [R06]), where `X` is the module-level `lastKeyedFocus` ref maintained by [Step 11]'s synchronous blur handler. Either way, Option B on cold boot reads the persisted key and refocuses it. The `{ kind: "none" }` variant is reserved for the genuine case where the user's last intentional focus state really was "not on any keyed input" (clicked card chrome, Tabbed out of all inputs, first launch before any focus) — apply then leaves focus alone.

Implemented at [Step 6](#step-6). Consistent with [Q01]: both describe "apply only for the currently-focused card."

#### [Q03] Does the Swift host emit `applicationWillResignActive` / `applicationWillHide`? (DECIDED) {#q03-will-phase-events}

**Question.** Does the Swift host emit `willResignActive` and `willHide` such that JS can subscribe at will-phase?

**Resolution: DECIDED — already emitted and already subscribed.** Verified in source:
- `tugapp/Sources/AppDelegate.swift:199-211` — AppDelegate emits `applicationWillResignActive` and `applicationWillHide` Control frames.
- `tugdeck/src/action-dispatch.ts:455,461` — the lifecycle switch handles both events and calls `lifecycle.notifyApplicationWillResignActive()` / `notifyApplicationWillHide()`.
- `tugdeck/src/lib/app-lifecycle.ts:170,178` — `observeApplicationWillResignActive` and `observeApplicationWillHide` are exported and wired.

No Swift patch is required. Step 10 (will-phase save) subscribes directly.

#### [Q04] On card/tab activation within the app, is cross-card selection transfer automatic? (DECIDED) {#q04-cross-card-activation-transfer}

**Question.** User clicks from card A's content to card B's chrome (or switches tabs). The browser has at most one selection globally. What exactly happens, and what should we guarantee?

**Why it matters.** Without explicit handling, the user's click on B's chrome cancels A's selection (native browser behavior). A's `willDeactivate` fires, then B's `didActivate`. If we capture A's selection in `willDeactivate` and apply B's saved snapshot in `didActivate`, each card carries its own stable selection across visits — click A, select, click B, click A, the selection is back. Without this, A's selection is gone forever the moment the user clicks B.

**Options considered.**
- **Option A — capture on `willDeactivate`, apply on `didActivate`.** Each card owns its own selection across the user's navigation.
- **Option B — no card-level keeper wiring; rely only on app-lifecycle events.** Users lose per-card selection memory on every card switch. Fails the spirit of SC-6.
- **Option C — capture only; don't apply.** Saves the outgoing card's selection but doesn't resurrect the incoming card's. Users see their old card's selection return only after app resign+activate, not after card switch+back.

**Resolution: DECIDED — Option A (capture on `willDeactivate`, apply on `didActivate`).**

Rationale:
1. Options B and C both fail the spirit of [SC-6] ("selection survives card/tab activation"). The reason the plan takes on card-lifecycle observers at all is that app-lifecycle events alone aren't enough for per-card memory.
2. Option A is symmetric with [Q01] and [Q02] at the app-lifecycle boundary: "capture on the way out, apply on the way in, scoped to the card that's transitioning." Same mental model, different boundary.
3. Both observer hooks already exist (`deckManager.cardLifecycle.observeCardWillDeactivate` and `deckManager.observeCardDidActivate`). No new plumbing.
4. `willDeactivate` is the only moment we can read card A's selection before the native click-into-B cancels it. This is the same will-phase logic that justifies [Q03]'s app-level will-phase capture.

**No-snapshot clause.** On `didActivate` of a card with no saved snapshot (first visit), `apply()` is a no-op. The keeper does not invent a default caret — the browser's native focus behavior from the activating click stands.

Implemented at [Step 12](#step-12). Skip-if-correct ensures a quick tab-return (user clicks B, clicks back to A fast enough that the snapshot still matches the live selection) does not re-apply and cause WebKit programmatic-selection degradation ([R03]).

#### [Q05] When `apply()` is called but the target element is no longer in the DOM, what does it do? (DECIDED) {#q05-stale-snapshot-handling}

**Question.** A saved bag has `selection: { kind: "form-control", persistKey: "email" }` but on restore no element with `data-tug-persist-value="email"` exists in the card's subtree (author removed the input, component was redesigned, older bag shape). What happens?

**Why it matters.** Users will always have bags written by older versions of the app. A crash or visible error would be worse than the missing selection itself — but a clever fallback could land the user's cursor on the *wrong* element, which is worse still, because the next keystroke goes into the wrong input (silent corruption).

**Options considered.**
- **Option A — silent fail in prod, dev-mode warning.** `apply()` returns `"failed"`, the keeper logs in dev, the user sees no selection on that element (the element no longer exists; nothing to select is the truthful answer).
- **Option B — attempt fallback.** Search for a similar key, fall back to the first keyed input in the card, or run a DOM-selection `textContext` search against form-control text. High risk of landing the cursor on the wrong element.
- **Option C — raise an error.** Surface the bag/component mismatch loudly. Too aggressive for user-facing state-restore, and punishes the whole bag for one stale entry — other card states in the same save would be lost.

**Resolution: DECIDED — Option A (silent fail in prod, dev warn).**

Rationale:
1. Option B is actively dangerous. The user's next keystroke goes into the "similar" element — possibly different semantics, a different submit path. Silent corruption. A missing selection is strictly better than a wrong selection.
2. Option C punishes the whole bag for one stale entry. If a card has five keyed inputs and one was renamed, C would throw and lose the other four. A restores the four and drops the one.
3. Option A is the conventional policy for persisted UI state — "best effort, keep going."
4. Dev-mode warning is cheap and surfaces the bug to the author without bothering the user.

**Per-snapshot independence.** `apply()` treats the three concepts — DOM selection, form-control selection, focus — as **independent silent-fail units, not coupled**. A missing focus target does not block applying a still-valid selection. A missing form-control target does not block applying a still-valid DOM selection (or vice versa). Each concept's apply step runs independently; each logs its own dev warning on stale-target. If focus lands nothing and the form-control selection is applied, the selection won't paint (per [SC-2]) — that is the honest visible state and the user can click into the input to re-focus it.

Implemented at [Step 5](#step-5) (DOM apply), [Step 6](#step-6) (form-control + focus apply).

#### [Q06] Is there a blur-time capture safety net, and if so with what debounce? (DECIDED) {#q06-blur-time-capture}

**Question.** Do we add a module-level `focusout` listener that captures form-control selection whenever a keyed element loses focus, and if so with what debounce?

**Why it matters.** The blur-time listener is **not optional** — it is load-bearing for the `body-transient` `FocusSnapshot` variant ([D03], [R06], [S02]). The listener maintains a module-level `lastKeyedFocus` ref that `captureFocus` reads when `document.activeElement === document.body`, so apply can restore the user's last keyed input instead of doing nothing. Without the listener, body-transient focus has no way to carry `lastKeyedFocus` and R06's mitigation collapses. The "no listener" option is therefore eliminated.

Separately, the listener serves a secondary safety-net job: for window-level transitions where no element blurs cleanly, a freshly-debounced capture is already on disk when the lifecycle event fires.

**Options considered** (debounce only; the listener itself is required by [R06]).
- **Option A — debounced 50 ms.** Rapid Tab-traversal (user tabs through a form quickly) collapses into one capture per settled focus. Minimum work, minimum WebKit perturbation.
- **Option B — no debounce.** Every `focusout` fires a capture immediately. Simpler, but a fast 6-input Tab-burst triggers 6 capture → `setCardState` cycles within a few hundred ms, all but the last overwritten before any save trigger reads them.
- **Option C — no listener at all. Eliminated** — body-transient focus ([R06]) depends on the listener's `lastKeyedFocus` ref; without the listener, body-transient snapshots can't carry a key and the whole body-transient mitigation collapses.

**Resolution: DECIDED — Option A (50 ms debounce), with split update policy.**

Rationale:
1. C is eliminated by [R06]'s load-bearing dependency.
2. B is correct but wasteful. 50 ms is long enough to collapse a rapid Tab-burst into one capture, short enough that the last capture before a lifecycle event is fresh (no human perceives 50 ms).
3. Implementation is cheap: one `setTimeout` + clear on each `focusout`.
4. Step 11 already tests this: "blur a keyed element 5 times in 30 ms; assert `capture` is called once."

**Split update policy (required clause).** The `lastKeyedFocus` ref updates **synchronously** on every `focusout` whose target carries `data-tug-persist-value` or `data-tug-focus-key`. Only the **capture-and-store** path (reading element state, building the `SelectionSnapshot`, calling `deckManager.setCardState`) is debounced. Rationale: if a lifecycle event fires during a debounce window, `captureFocus` must read a *current* `lastKeyedFocus` — otherwise a `body-transient` snapshot written during the window would carry the wrong (stale) key or none at all.

Implemented at [Step 11](#step-11). Step 11 must assert both behaviors: the debounced capture path (one capture for 5 rapid blurs), and the synchronous ref update (a lifecycle event fired mid-debounce reads the latest `lastKeyedFocus`, not the previous one).

#### [Q07] What is the `textContext` fallback window size? (DECIDED) {#q07-text-context-window}

**Question.** When DOM selection `pathToNode` fails on restore (the serialized path doesn't resolve — a sibling was inserted, a wrapper was added, a node got split), the keeper falls back to a short text window for re-anchoring. How big is the window, and how does it handle ambiguity (the same short text appearing multiple times in the card's content)?

**Why it matters.** This is purely a DOM-selection concern. Form-control selection uses `persistKey` and does not use textContext. For DOM selections in tide cards and other shape-shifting content:
- Too small → ambiguity (common words like `"the"` match everywhere).
- Too large → any nearby edit invalidates the match (common for tide-card content flow).
- No fallback → shape-shift fragility returns (the exact bug this plan fixes).

**Options considered.**
- **Option A — fixed 20 chars each side.** Small snapshot, high ambiguity risk on common words.
- **Option B — fixed 40 chars each side.** Middle ground. ~80 chars per selection.
- **Option C (full adaptive) — capture 200 chars each side; apply escalates 20→40→80→160→200, fails loudly if still ambiguous.** Adaptive at apply time.
- **Option C1 (simple adaptive) — capture 80 chars each side; apply escalates 20→40→80 using substrings of the stored 80. No escalation beyond 80.** Fixed-size capture, adaptive match.
- **Option C2 (minimum-storage adaptive) — capture and apply both adaptive, store just the resolving window size.** More complex; minimum bag storage.
- **Option D — no textContext; fail if paths don't resolve.** Eliminated — re-introduces shape-shift fragility.

**Resolution: DECIDED — Option C1 (simple adaptive).**

Rationale:
1. D is eliminated by the plan's purpose.
2. A and B are fixed — either too small for common words (A) or too big for unique phrases that would resolve at 20 chars (B).
3. C (full adaptive) stores 200 chars per selection unconditionally, which is wasteful when most resolutions succeed at 20 chars.
4. C2 (minimum-storage adaptive) is the theoretically tidiest, but adds capture-time cost and complexity for marginal bag-size savings over C1.
5. **C1 is the simple-until-proven-insufficient choice.** Capture stores 80 chars each side (fixed, one code path). Apply escalates 20 → 40 → 80 using substrings of the stored window. No escalation beyond 80; if 80 chars on each side still match multiple positions, apply returns `"failed"` and logs in dev (consistent with [Q05]'s silent-fail-with-dev-warn policy). Storage is bounded at ~160 chars per DOM selection — negligible against the full card bag.

Implemented at [Step 3](#step-3) (DOM capture) and [Step 5](#step-5) (DOM apply). If real-world usage proves 80 chars insufficient for tide cards with highly-repetitive content, revisit as a follow-on — C or C2 can be promoted to.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Skip-if-correct false-negative (paths differ but selection is "the same") | med | med | compare resolved node+offset, not raw path array | integration test for Case γ passes first cycle but fails second |
| Focus restoration surprises user (steals keystrokes) | med | low | Option B in [Q02] — only restore focus when card was active at save | user feedback; manual testing with cross-app focus sequences |
| Blur-time capture thrashes on rapid Tab-key focus traversal | low | low | debounce 50 ms per [Q06] | integration test with 5 rapid blurs |
| Migration drops some users' last selection | low | high (on first migration) | migrate best-effort; on next save, correct state is captured fresh | check post-migration dev logs for `migrate: dropped selection` messages |
| IME composition in flight during will-phase capture | med | low | document as known limitation; future `isComposing` defer | user reports of garbled selection on Cmd-Tab during Japanese/Chinese input |
| `activeElement === document.body` disambiguation after transient WKWebView focus loss | med | med | module-level last-focused ref from blur-time listener; prefer last keyed over "none" | integration test where focus transiently lands on body during cold boot |
| `window.beforeunload` unreliability on WKWebView | low | med | belt-and-suspenders: Swift `applicationShouldTerminate` + `visibilitychange(hidden)` + `beforeunload` all trigger save | save missed across reload — telemetry on save-callback counts |
| `selectionGuard` retirement breaks drag-clipping | high | low | retirement is API-only; drag code paths unchanged | existing drag tests must stay green |

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

Note: `persistKey` / `focusKey` attribute values are used in `querySelector(...)` lookups at apply time. They must be CSS-selector-safe (printable ASCII without whitespace, quotes, or other characters requiring CSS-escaping). A future enhancement could add a runtime validator; for this phase it remains an author-contract responsibility ([D08]).

**Risk R05: IME composition in flight during will-phase capture** {#r05-ime-composition}

- **Risk:** If the user is mid-IME composition (e.g., a half-committed Japanese character) when `applicationWillResignActive` fires, capturing `selectionStart` / `selectionEnd` may read composition-buffer offsets that do not map back correctly after activation. The restored selection can be garbled or displaced by the length of the in-flight composition text.
- **Mitigation:** Document as a known limitation for this phase. A future enhancement can detect `isComposing` via the `CompositionEvent` state (`compositionstart` / `compositionend`) and defer capture until the composition commits.
- **Residual risk:** IME users may see garbled or displaced selection on Cmd-Tab or Cmd-H during an active composition. Rare in practice; acceptable for initial rollout.

**Risk R06: `document.activeElement === document.body` disambiguation** {#r06-body-transient-focus}

- **Risk:** WKWebView transiently moves focus to `<body>` during lifecycle transitions (resign/hide). A naive `FocusSnapshot` with only `{ kind: "none" }` and `{ kind: "keyed", focusKey }` cannot distinguish "focus was legitimately on body" from "focus transiently detached during transition." Capturing during this transient window would save `{ kind: "none" }` and the user would see focus lost after return.
- **Mitigation:** [D03] adds a third `FocusSnapshot` variant `{ kind: "body-transient", lastKeyedFocus?: string }`. A module-level last-focused ref is maintained by the blur-time listener (Step 11). At capture time, if `document.activeElement === document.body`, the keeper emits `body-transient` carrying the most recent keyed focus (if any). On apply, `body-transient` with a resolvable `lastKeyedFocus` restores focus to that element; without a ref or element, it no-ops.
- **Residual risk:** On the very first launch, before any blur-time event has fired, no `lastKeyedFocus` ref exists. Apply defaults to "do nothing"; the user sees no focus restored and must click to place focus. Rare and recoverable.

**Risk R07: `window.beforeunload` unreliability on WKWebView** {#r07-beforeunload-unreliable}

- **Risk:** WKWebView has known quirks around `beforeunload` firing on programmatic navigation vs. user-initiated close. Relying on `beforeunload` alone would miss save on some unload paths.
- **Mitigation:** Three redundant save triggers cover the paths: the Swift `applicationShouldTerminate` → `window.tugdeck.saveState()` RPC covers the quit path; `document.visibilitychange(hidden)` covers the tab-background path; `window.beforeunload` is a belt-and-suspenders trigger. All three must fail simultaneously for save to be missed.
- **Residual risk:** A pathological unload (e.g., crash mid-transition) could still miss the last-moment save. Acceptable; the user loses at most the most recent in-flight edit window.

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

**Decision:** `CardSelectionState = { selection, focus }`. Focus is a first-class concept with its own save/restore path, not derived from selection. `FocusSnapshot` is a three-variant tagged union:

```ts
type FocusSnapshot =
  | { kind: "none" }
  | { kind: "keyed"; focusKey: string }
  | { kind: "body-transient"; lastKeyedFocus?: string };
```

**Rationale:** Form-control selection is invisible without focus. DOM selection's visibility is independent of focus. Treating focus as a property of selection (rather than a peer) would require form-control snapshots to carry focus info while DOM snapshots would not — inconsistent. The third `body-transient` variant models WKWebView's transient `document.activeElement === document.body` state during lifecycle transitions ([R06]). Without this variant, capture at that moment would emit `{ kind: "none" }` and the user would lose focus across every Cmd-Tab cycle that landed mid-transition on body.

**Implications:** Keeper captures both in one pass. Apply applies focus first, then selection, skip-if-correct on each. On capture: if `activeElement` is a keyed element inside the boundary, emit `keyed`; if it is `document.body`, emit `body-transient` carrying the module-level last-focused ref (maintained by Step 11's blur-time listener); otherwise emit `none`. On apply: `keyed` focuses the element; `body-transient` with a resolvable `lastKeyedFocus` focuses that element; `body-transient` without a ref (or with a missing element) and `none` are no-ops.

#### [D04] Save triggers are will-phase lifecycle events, not did-phase (DECIDED) {#d04-save-at-will-phase}

**Decision:** Primary save triggers are `applicationWillResignActive`, `applicationWillHide`, `window.beforeunload`, and the Swift `saveState` RPC. Did-phase events (`applicationDidResignActive`, `applicationDidHide`) serve as backstops — they still fire `saveAndFlush` in case will-phase is missed.

**Rationale:** Browsers tear down selection visibility during the did-phase. Reading at that point returns whatever remains, which is sometimes nothing. Will-phase is the last authoritative read. Case γ's degradation on the second Cmd-Tab cycle is directly attributable to this timing.

**Implications:** Swift already emits these events ([Q03]) and the JS side already routes them through `app-lifecycle` observers. No Swift patch is required; the keeper-side work is confined to subscribing.

#### [D05] Apply is skip-if-already-correct (DECIDED) {#d05-skip-if-correct}

**Decision:** Before calling any of `el.focus()`, `el.setSelectionRange(...)`, or `selection.setBaseAndExtent(...)`, the keeper checks whether the live state already matches the snapshot. If it does, the step is a no-op.

**Rationale:** WebKit treats programmatic selections differently from user-made selections on resign (Case γ's root cause). If we never re-apply a matching snapshot, we never programmaticize a user selection, and the cycle doesn't degrade. Also avoids harmless-but-wasteful work.

**Implications:** Equality comparison happens at resolved-DOM-node level, not raw-path level ([R02] mitigation).

#### [D06] `textContext` is an adaptive fallback for DOM selection path resolution failure (DECIDED) {#d06-text-context-fallback}

**Decision:** DOM snapshots optionally carry a `textContext: { text, anchorOffsetInText, focusOffsetInText }` field. Capture records **80 chars each side** of the selection anchor/focus (fixed; one code path). On apply, if `pathToNode(boundary, anchorPath)` fails, the keeper searches the current `boundary.textContent` using **substrings of the stored 80-char window, escalating 20 → 40 → 80 chars** until a unique match is found. If none of the three widths yield a unique match, apply returns `"failed"` and logs in dev (consistent with [Q05] silent-fail policy). No escalation beyond 80 chars — [Q07] adopts Option C1 (simple adaptive) until real-world usage proves it insufficient.

**Rationale:** `pathToNode` is shape-fragile ([superseded Issue C]). Dynamic DOMs (tide-card async message arrivals) are the primary victim. TextContext adds a second anchor that is resilient to DOM tree reshaping as long as the textual content is stable. C1 keeps the capture path simple (one fixed size) while preserving adaptive match behavior on apply.

**Implications:** Snapshot size grows by ~160 bytes per DOM selection (80 chars each side). Migration doesn't need to invent `textContext` for old-shape bags (the field is optional).

#### [D07] `CardStateBag` schema version bumps; read-side migration is best-effort (DECIDED) {#d07-bag-schema-migration}

**Decision:** New bags carry `version: 2`. Old bags lacking `version` are treated as v1 and migrated in place at `readCardStates` time. Migration promotes the first viable per-input selection from `domInputs` (if any) to the top-level `CardSelectionState`, and wraps any top-level `SavedSelection` as `{ selection: { kind: "dom", ... }, focus: { kind: "none" } }`.

**Rationale:** Users have in-flight bags from the `8de575c4` era. Abrupt schema changes would drop their saved state. Migration preserves what we can, acknowledges what we can't (more than one per-input selection in v1 shape cannot all survive), and moves on.

**Implications:** `migrateBag` function in `settings-api.ts` or adjacent, called from `readCardStates`. Strips migrated fields from their old locations so the new code path doesn't double-read.

#### [D08] `data-tug-persist-value` and `data-tug-focus-key` are distinct attributes (DECIDED) {#d08-persist-vs-focus-keys}

**Decision:** Authors opt form-controls into persistence via `data-tug-persist-value="<key>"` (already shipped). Authors opt any focusable element into focus-only persistence via `data-tug-focus-key="<key>"` (new). Uniqueness is scoped per-card-subtree and is an author responsibility.

**Rationale:** Some elements (`<input>`) want both value-and-selection persistence and focus-preservation. Other elements (a `<button>` that was last focused, or a custom keyboard-focusable `<div>`) want only focus-preservation, not value/selection. Unifying the attributes would force every focus-participating element to declare participation in value/selection persistence it doesn't support.

**Implications:** For form controls, `persistKey` implies both — the keeper prefers `data-tug-persist-value` as the element locator because it is present on every participating form control; it falls back to `data-tug-focus-key` only for non-form-control focus-only cases. Attribute values are used in `querySelector(...)` at apply time and therefore must be CSS-selector-safe: printable ASCII without whitespace, quotes, or other characters that would require CSS-escaping. A future enhancement could add a runtime validator; for now this remains an author-contract responsibility (see the note under [R04] and the explicit entry in [Non-goals](#non-goals)).

#### [D09] `SelectionKeeper` is the sole save/restore owner; `selectionGuard` retains drag-clipping (DECIDED) {#d09-keeper-vs-guard}

**Decision:** `selectionGuard.saveSelection` and `selectionGuard.restoreSelection` cease to be the public API for save/restore once [Step 14](#step-14) lands. Their bodies either move into the keeper as helpers or stay in the guard but are marked `@internal`. The guard retains: boundary registration, drag-selection clipping, selection-change observation. The keeper owns: capture at save triggers, apply at restore triggers, focus tracking.

**Rationale:** One concept, one owner (L-SEL-01). Drag-clipping and persistence are different concerns with different invariants — the former is runtime, the latter is transition-boundary. Collapsing them would bloat either module.

**Implications:** `card-host.tsx`, `action-dispatch.ts`, and any other current callers of the guard's save/restore API switch to keeper calls. A grep after [Step 14](#step-14) confirms zero remaining callers of `saveSelection` / `restoreSelection` outside the keeper module.

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
  | { kind: "keyed"; focusKey: string }
  // `body-transient` is a rescue mode for lifecycle-induced focus loss.
  // WKWebView transiently moves focus to <body> during resign/hide; this
  // variant carries the most-recently-keyed focus (from a module-level
  // ref maintained by the blur-time listener) so apply can restore the
  // user's focus intent on activation. See [D03] and [R06].
  | { kind: "body-transient"; lastKeyedFocus?: string };

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
| `applicationWillResignActive` | `action-dispatch.ts` | `deckManager.saveAndFlush()` → `saveCurrentCardState` → `keeper.capture` for each registered card | Primary; Swift emits and JS subscribes (see [Q03]) |
| `applicationWillHide` | `action-dispatch.ts` | same | Primary; Swift emits and JS subscribes (see [Q03]) |
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

**Rollout plan.** Ship commits 1–16 in order; each green on `bun x tsc --noEmit` + `bun test`. The first behavioral change lands at [Step 7](#step-7) (CardHost keeper wires); up to that point the keeper exists but is unused. If a regression surfaces after Step 7, revert Step 7 (and Step 8 if already landed) alone and continue.

**Rollback.** Per-commit revertable. Full rollback: revert the 16-commit series in reverse order; land on pre-selection-plan state (the `8de575c4` partial wire, with the four failure cases visible).

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

- [ ] Module docstring for `selection-keeper.ts` covering the three kinds of state and the skip-if-correct policy.
- [ ] JSDoc for the `SelectionSnapshot`, `FocusSnapshot` (including the `body-transient` rescue variant), and `CardSelectionState` types.
- [ ] JSDoc on `TugInput`/`TugTextarea` `focusKey` prop, and updates to `persistKey` JSDoc explaining the keeper relationship.
- [ ] Update `CardHost` module docstring: replace the "Restoration is trigger-driven" section with a pointer to the keeper.
- [ ] Cross-reference: [`tugplan-tide-card-polish.md`](./tugplan-tide-card-polish.md) §5.5.c Commit 1A points here.

Proposed post-phase tuglaws (tracked in Roadmap / Follow-ons, not a phase-exit criterion):
- **L-SEL-01** Selection and focus are singletons owned by `SelectionKeeper`.
- **L-SEL-02** Selection save runs at the will-phase of every lifecycle-loss event.
- **L-SEL-03** Selection apply is skip-if-correct.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (capture)** | Capture behavior for each snapshot kind against a synthetic boundary | Every capture helper |
| **Unit (apply)** | Apply behavior including skip-if-correct and fallback | Every apply helper |
| **Unit (migration)** | Round-trip v1 → v2 for each bag variant | `migrateBag` |
| **Integration (transition × kind)** | Full save → lifecycle-fire → restore flow for each combination | [Step 15](#step-15) |
| **Regression** | The four failure cases (α/β/γ/δ) each reproduced as a bun test | [Step 15](#step-15) |
| **Contract (grep)** | A compile/grep assertion that no file outside the keeper calls `setSelectionRange` / `setBaseAndExtent` / `.focus()` for persistence purposes | [Step 15](#step-15) |

---

### Execution Steps {#execution-steps}

16 steps. Each step has a commit, `References:`, `Depends on:`, artifacts, tasks, tests, and a checkpoint.

#### Step 1: Add `SelectionSnapshot` / `FocusSnapshot` / `CardSelectionState` types {#step-1}

**Commit:** `feat(layout-tree): add SelectionSnapshot, FocusSnapshot, CardSelectionState`

**References:** [D02] tagged union, [D03] focus separate, Spec S02, (#three-kinds-of-state)

**Artifacts:**
- `tugdeck/src/layout-tree.ts` gains the three new types.
- `CardStateBag` grows `version?: 2`; the old-shape `selection?: SavedSelection` field is replaced by the new-shape `selection?: CardSelectionState`.

**Tasks:**
- [ ] Add types.
- [ ] Keep `SavedSelection` exported (it's now a helper type inside the DOM variant).
- [ ] Update each existing `CardStateBag['selection']` caller to compile against the new shape, emitting `{ selection: { kind: "none" }, focus: { kind: "none" } }` as a stub value until Step 7 wires the keeper. Specific callers to update:
  - `tugdeck/src/components/chrome/card-host.tsx` — `saveCurrentCardStateRef` (write path) and `useCardContentRestore` (read path). Write the stub object; ignore on read.
  - `tugdeck/src/settings-api.ts` (or wherever the on-disk bag is serialized/deserialized) — pass through the new shape; no migration logic yet ([Step 13] owns migration).
  - Any other `bag.selection` consumer surfaced by `grep -R 'bag\.selection\|bag\["selection"\]' tugdeck/src/`.

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
- textContext capture at **80 chars each side** of the anchor/focus (fixed, per [Q07] Option C1).

**Tasks:**
- [ ] Implement path building (reuse `selectionGuard`'s existing logic).
- [ ] Capture anchor/focus paths + offsets.
- [ ] Capture an 80-char textContext window on each side (fixed size; one code path).

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
- [ ] **If `document.activeElement === document.body`, emit `{ kind: "body-transient", lastKeyedFocus: <module-level ref, if any> }` per [D03] / [R06].** The module-level ref is maintained by [Step 11]'s synchronous blur handler; read it at capture time. If the ref is empty (no prior keyed focus observed), emit `{ kind: "body-transient", lastKeyedFocus: undefined }` so apply treats it as a no-op.
- [ ] If `activeElement` is neither a keyed element inside boundary nor `document.body`, emit `{ kind: "none" }`.

**Tests:**
- [ ] Capture with focus inside an `<input>` carrying persistKey.
- [ ] Capture with focus on a contenteditable; DOM path returns.
- [ ] Capture with focus on unkeyed element: focus `kind: "none"`.
- [ ] Capture with `activeElement === document.body` and `lastKeyedFocus` ref populated: emits `{ kind: "body-transient", lastKeyedFocus: "<key>" }`.
- [ ] Capture with `activeElement === document.body` and `lastKeyedFocus` ref empty: emits `{ kind: "body-transient", lastKeyedFocus: undefined }`.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`

#### Step 5: Apply — DOM selection {#step-5}

**Depends on:** #step-4

**Commit:** `feat(selection-keeper): apply DOM selection with skip-if-correct`

**References:** [D05] skip-if-correct, [D06] textContext fallback, Spec S01, (#r02-skip-if-correct-false-negative)

**Artifacts:**
- `applyDomSelection(boundary, snapshot)` with primary path resolution, textContext adaptive fallback using **substrings of the stored 80-char window**, escalating **20 → 40 → 80 chars** (per [Q07] Option C1). No escalation beyond 80.
- Skip-if-correct check comparing resolved node+offset tuples.
- Dev-mode logging of failures per [Q05].

**Tasks:**
- [ ] Primary path resolution via `pathToNode`.
- [ ] TextContext fallback with substring-based adaptive match (20 → 40 → 80).
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

#### Step 7: `CardHost` — keeper wires {#step-7}

**Depends on:** #step-6

**Commit:** `refactor(card-host): route selection save/restore through SelectionKeeper`

**References:** [D09] keeper sole owner, Spec S01, Table T02, Table T03, (#case-delta)

**Artifacts:**
- `card-host.tsx` save path: `saveCurrentCardStateRef` calls `keeper.capture(cardId, cardRoot)` and assigns the result to `bag.selection` (replaces the direct `selectionGuard.saveSelection` call).
- `card-host.tsx` restore path: the `useLayoutEffect` on `[hostContentEl]` calls `keeper.apply(cardId, cardRoot, bag.selection)` instead of `selectionGuard.restoreSelection`.
- `onContentReady` (the post-child-commit restore point) also calls `keeper.apply`.
- `DomInputSnapshot` still carries selection fields at this step. Those fields are written by the existing capture path but *ignored on read* because the read path now flows through `keeper.apply`. The scrub lands in Step 8.

**Tasks:**
- [ ] Wire `keeper.capture` in the save path (replace `selectionGuard.saveSelection`).
- [ ] Wire `keeper.apply` in the `useLayoutEffect` and in `onContentReady` (replace `selectionGuard.restoreSelection`).
- [ ] Do not yet alter `DomInputSnapshot`; the selection fields remain but go unused on read.
- [ ] Update JSDoc on the affected helpers and `useLayoutEffect` to name the keeper.

**Tests:**
- [ ] `card-host-composition.test.tsx` remains green (save/restore observable behavior).
- [ ] Explicit test: reload with DOM selection → `keeper.apply` called with correct args.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`
- [ ] Manual verification: reload an app; prior selection restores. (Per SC-1.)

#### Step 8: `CardHost` — `DomInputSnapshot` scrub {#step-8}

**Depends on:** #step-7

**Commit:** `refactor(card-host): strip selection fields from DomInputSnapshot`

**References:** [D02] tagged union, [D09] keeper sole owner, Spec S02, (#case-delta)

**Artifacts:**
- `DomInputSnapshot` reduced to `{ value; scrollTop?; scrollLeft? }` — `selectionStart`, `selectionEnd`, `selectionDirection` fields removed.
- `captureDomInputs` and `applyDomInputSnapshot` signatures updated accordingly; call sites reviewed to ensure no reader is still expecting selection fields.
- Migration path reads legacy shape but discards extra fields (the migration step will formalize this).

**Tasks:**
- [ ] Remove selection fields from `DomInputSnapshot`.
- [ ] Update `captureDomInputs` / `applyDomInputSnapshot` to value+scroll only.
- [ ] Search for any lingering readers of the stripped fields; update or remove.
- [ ] Update JSDoc on the helpers.

**Tests:**
- [ ] `card-host-composition.test.tsx` remains green.
- [ ] Unit: a bag whose `domInputs` entries lack selection fields round-trips through capture/apply without error.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`

#### Step 9: Lifecycle wiring — did-phase restore {#step-9}

**Depends on:** #step-8

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

#### Step 10: Lifecycle wiring — will-phase save {#step-10}

**Depends on:** #step-9

**Commit:** `feat(action-dispatch): save on willResignActive and willHide via keeper`

**References:** [D04] save at will-phase, [Q03], Table T02, (#case-gamma)

**Artifacts:**
- `action-dispatch.ts` subscribes `observeApplicationWillResignActive` and `observeApplicationWillHide` → `deckManager.saveAndFlush()`. The existing did-phase save remains as a backstop.
- The Swift host already emits both events ([Q03]); no Swift patch is required.

**Tasks:**
- [ ] Add JS-side subscriptions via `lifecycle.observeApplicationWillResignActive` / `observeApplicationWillHide`.
- [ ] Verify that capture at will-phase reads a still-present selection.

**Tests:**
- [ ] Integration: fire `notifyApplicationWillResignActive`; assert save callbacks run.
- [ ] Regression: Case γ second cycle — two Cmd-Tab cycles; selection still present after second (SC-5).

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`
- [ ] Manual verification: Case γ regression (two Cmd-Tab cycles). (Per SC-5.)

#### Step 11: Blur-time capture safety net {#step-11}

**Depends on:** #step-10

**Commit:** `feat(selection-keeper): add debounced blur-time capture on deck root`

**References:** [Q06] debounce interval, [R06] body-transient focus, Table T02

**Artifacts:**
- Module-level `focusout` listener on the deck root inside `selection-keeper.ts` (installed via a `selectionKeeper.attach(deckRootEl)` hook called from the existing deck-manager init path).
- **Split update policy ([Q06]):** `lastKeyedFocus` ref updates **synchronously** on `focusout`; only the capture-and-store path is debounced at 50 ms.
- Scoped: the listener resolves the card owning the blurring element via `findCardRoot`; if found, captures and calls `deckManager.setCardState` (debounced tail).
- Module-level `lastKeyedFocus` ref updated by the listener: on every `focusout` whose target carries `data-tug-persist-value` or `data-tug-focus-key`, record the key **synchronously, before the debounce**. The ref is read by `captureFocus` when `document.activeElement === document.body` to populate `FocusSnapshot.body-transient.lastKeyedFocus` ([D03], [R06]).

**Tasks:**
- [ ] Add `attach` hook.
- [ ] Install `focusout` listener.
- [ ] Update `lastKeyedFocus` ref synchronously on `focusout`.
- [ ] Debounce only the capture-and-store path at 50 ms.

**Tests:**
- [ ] Unit: blur a keyed element 5 times in 30 ms; assert `capture` is called once (debounced path).
- [ ] Unit: after a keyed blur, `captureFocus` with `activeElement === body` emits `{ kind: "body-transient", lastKeyedFocus: "<key>" }`.
- [ ] Unit: spy on `deckManager.setCardState`. Fire a keyed `focusout`, then 10 ms later (inside the 50 ms debounce window) call `captureFocus` with `activeElement === body`. Assert **both**: (a) `setCardState` has **not yet** been called (proving the capture-and-store path is debounced); (b) `captureFocus` emits `{ kind: "body-transient", lastKeyedFocus: <just-blurred key> }` (proving the `lastKeyedFocus` ref was updated synchronously, before the debounce tail). Together these prove "sync ref, debounced store" rather than either alone.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`

#### Step 12: Card activation wiring {#step-12}

**Depends on:** #step-11

**Commit:** `feat(action-dispatch): capture on cardWillDeactivate, apply on cardDidActivate`

**References:** [Q04] cross-card activation, Table T02, Table T03

**Artifacts:**
- `action-dispatch.ts` subscribes `deckManager.cardLifecycle.observeCardWillDeactivate(null, cb)` for capture (the will-deactivate observer lives on the `cardLifecycle` namespace, not on the top-level `deckManager` surface).
- For apply, `action-dispatch.ts` uses the existing `deckManager.observeCardDidActivate(null, cb)` pass-through (`observeCardDidActivate` is exposed both on `deckManager` directly and on `deckManager.cardLifecycle`; the top-level pass-through is fine here).
- On will-deactivate: `keeper.capture` for the deactivating card.
- On did-activate: `keeper.apply` for the activating card.

**Tasks:**
- [ ] Subscribe `deckManager.cardLifecycle.observeCardWillDeactivate(null, ...)` for capture.
- [ ] Subscribe `deckManager.observeCardDidActivate(null, ...)` for apply.
- [ ] Ensure capture runs synchronously before the activation state flip.

**Tests:**
- [ ] Integration: simulate card A active → click card B; `keeper.capture` for A, `keeper.apply` for B.
- [ ] Skip-if-correct no-op on rapid A → B → A.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`
- [ ] Manual verification: selection transfers between cards cleanly. (Per SC-6.)

#### Step 13: Bag migration {#step-13}

**Depends on:** #step-12

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

#### Step 14: `selectionGuard` deprecation of save/restore API {#step-14}

**Depends on:** #step-13

**Commit:** `refactor(selection-guard): mark saveSelection/restoreSelection @internal`

**References:** [D09] keeper sole owner, (#s01-keeper-api, #q05-stale-snapshot-handling)

**Artifacts:**
- `saveSelection` and `restoreSelection` on `selectionGuard` either move their bodies into `selection-keeper.ts` as helpers (preferred) or remain on the guard marked `@internal` and no longer exported.
- `grep` of the codebase confirms no call sites outside the keeper.

Depending on Step 13 (bag migration) ensures no legacy v1 bag flows into `keeper.apply` through the retired guard path: by the time the guard's public API is withdrawn, every bag on read has been normalized to v2.

**Tasks:**
- [ ] Move or mark.
- [ ] Update `selection-guard.ts` module docstring.

**Tests:**
- [ ] Existing `selection-model.test.tsx` tests: ensure the drag-clipping-focused tests still pass; retire any test that targeted the old save/restore API (superseded by keeper tests).

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test`
- [ ] `grep -R 'selectionGuard\.\(saveSelection\|restoreSelection\)' tugdeck/src/ | grep -v selection-keeper.ts` returns empty.

#### Step 15: Integration test harness {#step-15}

**Depends on:** #step-14

**Commit:** `test(selection-keeper): integration tests for every transition × kind`

**References:** Spec S01, Table T01, Table T02, Table T03, (#success-criteria, #per-case-walkthrough)

**Artifacts:**
- `tugdeck/src/__tests__/selection-keeper-integration.test.tsx` covering the cases from `#per-case-walkthrough`.

**Tasks:**
- [ ] Scaffold `selection-keeper-integration.test.tsx` and set up the harness (deckManager, card mounts, lifecycle emitters).
- [ ] Wire a grep-based contract test runner into the suite.

**Tests:**
- [ ] Case α (hide/unhide, form-control): assert form-control selection + focus restored after `notifyApplicationWillHide` → `notifyApplicationDidUnhide`.
- [ ] Case β (Cmd-Tab, form-control): assert form-control selection + focus restored after `notifyApplicationWillResignActive` → `notifyApplicationDidBecomeActive`.
- [ ] Case γ (double Cmd-Tab, DOM): assert DOM selection restored after two consecutive Cmd-Tab cycles.
- [ ] Case δ (reload, form-control with focus): assert form-control selection and focus restored on cold mount per [Q02] Option B.
- [ ] Tab activation: assert each card's selection restored on `cardDidActivate` per [Q04].
- [ ] Cross-pane move: assert selection survives pane-activation transfer.
- [ ] Reload with DOM selection: assert DOM selection restored via `pathToNode` primary or `textContext` fallback.
- [ ] **Case γ five-cycle stress:** five consecutive Cmd-Tab cycles on `TugPromptEntry`; assert selection remains correctly restored through all five. Guards against accumulated WebKit programmatic-selection degradation at N > 2.
- [ ] Grep contract: `grep -R 'setSelectionRange\|setBaseAndExtent\|\.focus()' tugdeck/src/` returns matches only in an allow-listed set: `selection-keeper.ts` (owns all persistence apply), `selection-guard.ts` (drag-clipping only; inspect each match to confirm not a persistence path), and any explicit user-interaction handlers (e.g., a click handler that focuses on tab-switch, documented with a `// persistence-allowlist:` comment). Any match outside the allow-list fails the contract. "For persistence purposes" cannot be enforced by regex alone; manual reviewer confirmation is required for `selection-guard.ts` matches until [Step 14]'s deprecation narrows that module to drag-clipping exclusively.

**Checkpoint:**
- [ ] `bun x tsc --noEmit`
- [ ] `bun test` — all new tests pass.

#### Step 16: Documentation {#step-16}

**Depends on:** #step-15

**Commit:** `docs(selection): keeper module docs + cross-references`

**References:** [D01] singleton, [D04] will-phase, [D05] skip-if-correct, (#documentation-plan)

**Artifacts:**
- Module docstring for `selection-keeper.ts` covering the three kinds of state, skip-if-correct, and the keeper's ownership boundary vs. `selectionGuard`.
- JSDoc on `SelectionSnapshot` / `FocusSnapshot` / `CardSelectionState` types.
- JSDoc on `TugInput` / `TugTextarea` `focusKey` prop; updates to `persistKey` JSDoc noting the keeper relationship.
- `CardHost` module docstring update: replace the "Restoration is trigger-driven" section with a pointer to the keeper.
- Cross-reference back to this plan from [`tugplan-tide-card-polish.md`](./tugplan-tide-card-polish.md) §5.5.c Commit 1A.

**Tasks:**
- [ ] Write the keeper module docstring.
- [ ] Write JSDoc on the new types and props.
- [ ] Update `CardHost` docstring.
- [ ] Add the cross-reference in `tugplan-tide-card-polish.md`.

Note: the proposed tuglaws L-SEL-01 / L-SEL-02 / L-SEL-03 are tracked in the Roadmap / Follow-ons section, not landed in this phase.

**Tests:**
- [ ] Grep: `selection-keeper.ts` contains a module docstring covering the three state kinds (DOM selection, form-control selection, focus), skip-if-correct, and ownership boundary vs. `selectionGuard`.
- [ ] Grep: every exported type (`SelectionSnapshot`, `FocusSnapshot`, `CardSelectionState`) carries a JSDoc block.
- [ ] Grep: `TugInput` and `TugTextarea` JSDoc names both `persistKey` and `focusKey` props.
- [ ] Link check: `tugplan-tide-card-polish.md` §5.5.c Commit 1A points to this plan.

**Checkpoint:**
- [ ] Docs readable; links resolve.
- [ ] No test regressions.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A unified `SelectionKeeper` subsystem, wired into every relevant lifecycle transition, with selection and focus correctness on every row of the superseded `persistence-reliability.md` Part 7 status dashboard.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] All 10 success criteria (SC-1 through SC-10) met and verified.
- [ ] Every open question resolved or explicitly deferred with rationale captured in this doc.
- [ ] `grep` contract test (Step 15) confirms keeper is the sole writer of selection/focus for persistence.
- [ ] Migration log sweep of a dev build with old-shape bags shows no crashes; any "dropped selection" messages are accounted for.
- [ ] Manual verification of every failure case in `#per-case-walkthrough`: α, β, γ, δ all pass; tab activation, cross-pane move, reload all pass.
- [ ] Case γ five-cycle test (Step 15) passes.

**Acceptance tests:**
- [ ] `selection-keeper-integration.test.tsx` passes in full.
- [ ] No regressions in `card-host-composition.test.tsx`, `selection-model.test.tsx`, `pane-focus-controller.test.tsx`.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Propose tuglaws **L-SEL-01** (selection/focus singletons owned by `SelectionKeeper`), **L-SEL-02** (save at will-phase), **L-SEL-03** (apply is skip-if-correct) as additions to `tuglaws/tuglaws.md` in a separate patch after this phase ships.
- [ ] If [Q07]'s Option C1 (80-char fixed capture, 20→40→80 adaptive apply) proves insufficient for tide cards with highly-repetitive content, promote to Option C (200-char capture, 20→40→80→160→200 apply) or Option C2 (capture-time adaptive, minimum-storage).
- [ ] Extend textContext fallback to handle insertion/deletion near the anchor (fuzzy match with edit distance ≤ N).
- [ ] Cross-card selection support (browser one-selection limit still applies, but the keeper could notice cross-card selections at capture time and decide a policy).
- [ ] Port `selectionGuard`'s drag-clipping behavior into an even narrower module if the boundary continues to be useful after the keeper migration settles.
- [ ] Runtime validator for `persistKey` / `focusKey` values (CSS-selector safety, [D08]).
- [ ] IME-aware capture: detect `isComposing` via `CompositionEvent` state and defer will-phase capture until composition commits ([R05]).

| Checkpoint | Verification |
|------------|--------------|
| Step 1 types compile | `bun x tsc --noEmit` |
| Keeper capture/apply unit-tested | `bun test src/__tests__/selection-keeper.test.tsx` |
| CardHost adoption doesn't regress existing tests | `bun test src/__tests__/card-host-composition.test.tsx` |
| Case γ regression passes (single cycle) | `bun test -t 'case gamma'` |
| Case γ five-cycle regression passes | `bun test -t 'case gamma five cycle'` |
| Phase exit | All SC-1..10 verified manually + `bun test` passes |
