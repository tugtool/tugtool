# Lifecycle Delegates & Portal Re-architecture — Design Audit

**Date:** 2026-04-21
**Scope:** Holistic assessment of the two projects shipped on 2026-04-20:
  1. App & card lifecycle methods and delegates
  2. Card hosting, portal, and tab re-architecture
**Posture:** Critical audit, not a victory lap. The code works; this document records what is *good*, what is *fragile*, and what should be tightened before the next layer lands on top of it.

---

## Executive summary

Both projects achieved their stated goals. The lifecycle work replaced an ad-hoc four-event pipe with a proper Apple-style delegate protocol, escaped WebKit's gesture focus-lock via a principled MessageChannel drain (researched in a standalone design study), and unified app- and card-lifecycle under one coherent mental model. The portal re-architecture split the data model into Card + CardStack with a portal-backed identity-preserving render pipeline that keeps tide-card WebSocket sessions alive across every movement operation the user can initiate. Tests are green (2292/2292), invariants are enforced in code, and the plan document reads as a record of genuine engineering discipline.

That said, the work is *not* done. The two projects ended up tightly entangled — Step 11.6 onward is effectively a second plan grafted onto the first — and that entanglement left seams that deserve attention before more layers land on top. The composite first-responder bit, the will/did semantics under deferred delivery, the two-helper structure inside DeckManager, and (before the 2026 vocabulary rename) the DOM vocabulary mismatch between frame id and host `cardId` were the specific places the design got harder to reason about. None was a bug at ship time; each was where a future bug was most likely to be introduced. **Update:** DOM/CSS/registry/wire vocabulary for windows vs cards is now aligned — see [`tugplan-vocabulary-rename.md`](tugplan-vocabulary-rename.md) and **§ Vocabulary decisions (2026-04-21)** at the end of this document.

The report is divided by project. A short cross-cutting section at the end collects the issues that straddle both.

---

## Part 1 — App & Card Lifecycle Delegates

### What this project delivered

- `CardLifecycle` and `AppLifecycle` classes, each with `will`/`did` pairs where the protocol benefits from them (activate, deactivate, move, resize) and single events where it does not (construction, destruction). Ten events on the card side, eight on the app side.
- `useCardDelegate(cardId, delegate)` and `useAppDelegate(delegate)` — single-object Apple-style delegates that replace what used to be four parallel `useOnCard*` hooks and a pair of window globals.
- A `lifecycle-cascade.ts` module that couples the two pipes in one readable file, idempotent across the `WillResignActive` + `WillHide` double-fire and across the `DidBecomeActive` + `DidUnhide` symmetric case.
- A MessageChannel-based macrotask drain (researched in `lifecycle-delegate-reliability.md`) that replaces the previous `setState → useEffect` deferral. The rationale is sound, the implementation is small (~30 lines per lifecycle), and the retirement of `lib/defer.ts` closes a tuglaws-non-compliant helper.
- Composite first-responder semantics (`getFirstResponderCardId`) derived from the active stack's active card, with `_setFirstResponder` / `_flipFirstResponder` as the sanctioned transition points. Every flip routes through one of them; unit tests cover all ten transitions enumerated in Step 11.6.1b.
- Structured `[CardLifecycle]` / `[AppLifecycle]` logging gated behind a dev-flag module constant. Toggleable in one line without rebuilding.
- Dev-mode `validateDeckState` assertions on every `notify()` and unconditional validation in `applyLayout`.

### What works well

**1. The API is clean.** `useCardDelegate(cardId, { cardDidActivate, cardWillDeactivate, ... })` reads the way NSWindowDelegate reads — a delegate is a protocol, methods are optional, missing methods are no-ops. Consumers don't need to think about scheduling, subscription hygiene, or ordering. The tide card's focus management is five lines and reads top-to-bottom.

**2. The MessageChannel decision was researched, not chosen.** `lifecycle-delegate-reliability.md` walks through `scheduler.yield` (not in WebKit), `queueMicrotask` (in-gesture, fails), `setTimeout(0)` (4ms clamp, throttled), `rAF` (pauses in background — fatal for app-lifecycle), and `setState → useEffect` (React-coupled, drops events on unmount, H1). The chosen mechanism is what React's own scheduler uses, and the study records each candidate's disqualification. If someone revisits the decision they can follow the reasoning; they don't have to rediscover it.

**3. The cascade module is the smallest it can be.** 146 lines, two local variables, two callbacks, four subscriptions. It imports from `card-lifecycle.ts` and `app-lifecycle.ts` — not the reverse — so there is no circular-import risk. The idempotency guard is one field (`deactivatedByAppCardId`). The `hasConstructed(cardId)` check closes H8 (phantom reactivation of a destroyed card) cheaply.

**4. Invariants are enforced, not just documented.** `validateDeckState` is called from `applyLayout` unconditionally and from `notify()` in dev builds. The five invariants are encoded in code; `DeckStateInvariantError` names the violated invariant and the offending ids. A future mutator that breaks an invariant fails at the site that produced the break, not downstream where the symptom shows up.

**5. The test suite reaches the real engine.** The 5121 lines of mock-store tests that landed in the delete commit were speculative and mostly redundant; the tests that remain pin real behavior: ordering of transitions, identity preservation across moves, cascade-install/dispose, portal containment. This is a healthier test posture than the one before.

### Weaknesses, pitfalls, and limitations

**L1 — Will-event semantics are inverted under deferred delivery for React delegates.**

`notifyCardWillDeactivate` is documented (and for sync observers, *truly is*) a pre-mutation event: subscribers run before the store commits. But `useCardDelegate` subscribers do not run synchronously — they run on the next MessageChannel drain, which happens *after* the commit. The delegate method named `cardWillDeactivate` runs in a world where the card has already been deactivated.

In practice, the tide card's `cardWillDeactivate: () => entryDelegate.blur()` doesn't care — blur is idempotent and doesn't read state. But the general case ("delegates may want to prepare state before the transition commits") is not what the mechanism actually delivers. Any delegate that reads state in a `will`-method to snapshot pre-mutation data will get post-mutation data.

This is documented in the reliability study (H2, §4.1) and in the `notifyCardWillBeginDestruction` docstring, but not on the will/did methods themselves. The semantic inversion is real and likely to catch the next author out. The mitigation is either (a) a docstring on every `cardWill*` delegate method stating "runs after the transition commits," or (b) giving up on the will-vs-did distinction for React delegates and collapsing them to "did" only.

**L2 — Two drain queues, no cross-module ordering guarantee.**

`useCardDelegate` and `useAppDelegate` each own a `MessageChannel`. Messages posted to different channels drain in their own order; the browser does not guarantee cross-channel sequencing. In the cascade path, the sequence `applicationWillResignActive → cardWillDeactivate → cardDidDeactivate → applicationDidResignActive` fires synchronously at the observer layer — but React delegates on the app and card sides drain via independent channels.

Today the observable effect is small (the tide card only reacts via `cardDidActivate` / `cardWillDeactivate`, and its delegate runs only on the card channel). But a future app delegate that reads deck state and a card delegate that writes deck state could interleave non-deterministically. Two queues are one too many.

Fix: one shared drain queue, either at the module level in a new `lib/delegate-drain.ts` or hosted by `DeckManager`. Same MessageChannel, same `scheduleDelegateCall`, just shared. ~20 lines of work, eliminates a class of race.

**L3 — `getActiveCardId()` and `getFirstResponderCardId()` coexist and do different things.**

- `getActiveCardId()` is a thin pass-through to `store.getFocusedCardId()`, which returns the top-of-z-order stack's `activeCardId`.
- `getFirstResponderCardId()` returns the stack whose id matches `activeStackId`'s `activeCardId`, or null.

These diverge when `activeStackId` does not match the top-of-z-order stack — post-detach, post-move, and other edge cases the composite-bit model was introduced to handle. The cascade uses `getFirstResponderCardId` (correctly); tide-card's move/resize guard uses `getFirstResponderCardId` (correctly); some tests and internal callers still use `getActiveCardId`. Both surfaces are public.

Keeping both invites the wrong one being used. Recommend either deleting `getActiveCardId` (the composite bit is the only one that matters) or renaming it to make the role unambiguous (`getTopOfStackCardId`?). The current name is overloaded.

**L4 — `_setFirstResponder` and `_flipFirstResponder` are two helpers for one job.**

`_setFirstResponder` reads `oldFR` from current state and handles the commit internally. `_flipFirstResponder` takes `oldFR` explicitly and runs a caller-provided `commit` callback. The second exists because some mutators (notably `addCard`, `_addCardToStack`, `_detachCard`, `_moveCardToStack`, `_closeStack`, `_removeCard`) need to mutate state in ways that *would* confuse `getFirstResponderCardId()` if read after partial mutation.

The problem is: `_flipFirstResponder` is called from five places, and each call site has different commit semantics. The tangled-mutation cases are precisely the cases where the chance of getting the flip wrong is highest, and the mechanism that would catch a mistake (read current state) is bypassed. Tests cover the observed transitions, but the surface area for "subtly wrong flip because `oldFR` was computed wrong" is broad.

Simplification opportunity: design a single `_flip(newFR)` that snapshots `oldFR` before the caller runs its commit, then delegates commit to a closure. This is `_flipFirstResponder`'s shape, but the snapshot could move into the helper rather than being the caller's responsibility. One helper, one contract.

**L5 — Module-level lifecycle singletons are registered from the constructor.**

`registerCardLifecycle(this.cardLifecycle)` runs inside `DeckManager`'s constructor. The registration is last-write-wins. In production, one `DeckManager` is constructed per page — fine. Under React StrictMode (which mounts components twice in dev to catch effects) the deck manager is constructed once, but effects that read the singleton via `getCardLifecycle()` are invoked twice. Under HMR, an old `DeckManager`'s `destroy()` runs, then a new one's constructor runs — but the module-level refs are overwritten only on the second construction, so there's a brief window when the old lifecycle is wired to the new cascade.

Today this is invisible because no test exercises the sequence. A smoke test for HMR (construct, destroy, construct again; run cascade; assert no subscriber from generation 1 fires) would catch any drift here. If it passes cleanly, the singletons are safe; if it fails, we have a known place to guard.

**L6 — Observer-vs-delegate split forces a per-subscriber decision.**

`selectionGuard` subscribes synchronously via `observeCardDidDeactivate`. Tide card subscribes deferred via `useCardDelegate`. Both are valid; both are used today. The choice is made per subscriber based on whether the subscriber needs gesture-escape or synchronous state access. There is no explicit guidance in the codebase for which to pick. New subscribers pick by pattern-matching whatever the nearest existing code does.

A short `lib/card-lifecycle-usage.md` — or a section in the module header — stating the decision criteria would remove ambiguity: "Synchronous observer when you need pre-mutation state OR ordering with other synchronous observers. Delegate hook when you need React-context-bound focus/blur/DOM work that must survive component unmount."

**L7 — `applyLayout` is deprecated but still exists.**

It fires no lifecycle events, which is dangerous in a world where every other mutator does. The JSDoc warns; production doesn't call it; tests use it sparingly. The risk is that someone adds a production caller and doesn't read the JSDoc. Deprecating-but-keeping a method that violates the system's own invariants is a smell.

Recommend: delete it. If a production caller ever needs to swap state wholesale, implement a diff-based `replaceLayout` that drives changes through `addCard` / `removeCard` / `_setFirstResponder`. Four lines today; four lines replaced with fifty whenever the need actually lands. The fifty-line version is the right design; the four-line version is a future foot-gun.

**L8 — Startup events (H9) are dropped, and the acceptance is load-bearing.**

App-lifecycle control frames sent by Swift before `DeckManager` registers `AppLifecycle` are lost. Today's consumers (selection guard, save-on-resign) recover state on the first user interaction. Any future consumer that wants a reliable "fire once at app start" signal cannot use this channel. The acceptance is documented in `app-lifecycle.ts`'s banner but there is no enforcement — a future author will register a subscriber, test it manually, observe it work on re-activation (the recovery path), and ship. Then someone's cold-launch telemetry counter comes in short.

Mitigation ideas: (a) have Swift not send startup control frames until the JS side acknowledges readiness via a known RPC; (b) add a test asserting that pre-registration notifications no-op cleanly; (c) surface a dev-mode warning when a subscriber registers and observes no `applicationDidBecomeActive` within N seconds. None of these is urgent; at minimum, reference the startup-drop caveat in any future plan that adds an app-lifecycle subscriber.

**L9 — Each `notify()` runs `validateDeckState` and `pushCardListToHost`.**

Cost in dev is N cards + N stacks per mutation. `arrangeCards` on a 20-card deck fires one notify with all 20 cards × 20 stacks validated inside — which is cheap but O(n²) in theory because `validateDeckState` builds a `Set` and a `Map`. `pushCardListToHost` builds a new list on every notify, including notifies produced by z-order-only bumps. At current deck sizes (handfuls of cards) this is fine. At "Stacks with 50 cards each" it would not be.

Not a bug; a ceiling. Worth measuring once if we ever project deck growth past ~20 stacks.

**L10 — Double-commit mutators: `_detachCard` and `_removeCard` each produce two `notify()` calls.**

`_detachCard` splices the card into a new stack (first notify), then flips the composite bit to the moved card (second notify). `_removeCard` (FR-removal path) flips first-responder to the neighbor (first notify), then destructs the card (second notify). Two React re-renders per user action. In practice undetectable, but it's visible as "two log lines per one detach" when `LIFECYCLE_LOG` is on, and any cost scaling up (subscriber count, ripple effects) doubles.

Single-commit form is possible — the flip and the splice can be done in one deckState assignment — at the cost of a more intricate commit closure. Tradeoff; not urgent.

### Part 1 — recommended follow-up

In rough priority order:

1. **Document the will-event semantic inversion** in `TugCardDelegate` / `TugAppDelegate` interface JSDoc. One sentence per `cardWill*` / `applicationWill*` method: "Delegate runs after the transition commits. Subscribe via `observeCard*` directly for pre-mutation semantics."
2. **Collapse `_setFirstResponder` + `_flipFirstResponder` to one helper** that snapshots `oldFR` and takes a commit closure. Or document explicitly why two exist.
3. **Consolidate `getActiveCardId` and `getFirstResponderCardId`.** Rename or delete one.
4. **Share one drain queue across card + app delegates** so cross-module event order is deterministic.
5. **Delete `applyLayout` or replace with a diff-based implementation.** Deprecated-but-present is a footgun.
6. **Add an HMR/StrictMode smoke test** for lifecycle singleton registration and cascade dispose. Just enough to pin the invariant.
7. **Add a usage-guidance comment** to `card-lifecycle.ts` / `app-lifecycle.ts` saying when to subscribe synchronously vs via the delegate hook.

---

## Part 2 — Card Hosting, Portal, and Tab Re-architecture

### What this project delivered

- Two-table data model: `DeckState.cards` (content identities) + window/stack frames (serialized as `DeckState.windows` in v3; earlier drafts used `stacks`) with documented invariants, a `validateDeckState` helper, and migrations that preserve tab-as-card ids so tugbank's `tabstate/{id}` rows remain addressable without data migration.
- Portal-based content mounting: every card is mounted once at the deck root via `CardHost`; its DOM output is portaled into its host window's content div via `CardPortal` through a stable intermediate "slot" div (`display: contents`) that survives cross-window re-parenting.
- `window-content-registry` / `window-root-registry` — module-level `Map`s that couple chrome (`TugWindow`) to content (`CardHost`, rendered flat at deck root).
- `CardHost` absorbed what used to be inside the old `Tugcard` shell: PropertyStore registration, persistence callbacks, dirty/auto-save, save-callback, scroll/selection listeners, FeedStore management, card-level responder. Per-card content concerns live in `CardHost`; window chrome lives in `TugWindow`.
- Identity preservation: mount probe tests assert `mountCount === 1` and `unmountCount === 0` across `addCardToStack` / `detachCard` / `moveCardToStack` / `setActiveCardInStack`. Tide card's `CodeSessionStore` and WebSocket survive every movement operation.
- DeckManager rewrite to the two-table model: `_addCardToStack`, `_removeCard`, `_detachCard`, `_moveCardToStack`, `_closeStack`, `_setActiveCardInStack`, `_reorderCardInStack`, `_toggleStackCollapse`. Each routes first-responder flips through `_setFirstResponder` or `_flipFirstResponder`. `spliceCardFromStack` extracted to deduplicate the "remove this card, fall active-in-stack to neighbor" pattern.
- Chrome rename: `CardFrame` → `StackFrame`, `TabContentHost` → `CardContentHost`, `handleCardClosed` → `handleStackClosed`, `onCardFocused` → `onStackActivated`, `onCardClosed` → `onStackClosed`. Test helpers renamed accordingly. Piece 2.5 closed out the critical click-to-activate regression that slipped through Piece 2.
- Swift wire contract updated: `pushCardListToHost` emits `cardCount` (not `tabCount`); `focus-window` carries `windowId` (see `tugplan-vocabulary-rename.md` Step 11).

### What works well

**1. The model is right.** Separating content identity from visual framing is the correct decomposition. Detach / merge / tab-switch are all the same operation at the data level (a card's host-stack id changes); the old model conflated them. The two-table shape makes the invariants expressible as well as enforceable.

**2. The portal slot pattern is the right mechanism.** `createPortal(children, container)` unmounts children on container change; wrapping children in a stable slot div and moving the slot with `appendChild` preserves identity without fighting React's reconciler. The `display: contents` on the slot keeps layout transparent. Five lines of cleverness; decades of fewer reconnects.

**3. `CardContentHost` is a clean consolidation.** The per-card concerns that previously spread across Tugcard are now in one place, keyed by cardId (stable across moves) rather than by stackId. The responder scope is re-parented via `parentId: hostStackId` so the chain walk matches the portaled DOM layout. That's exactly the subtlety that breaks when you try to do this naïvely.

**4. Invariants are dev-checked on every notify.** The five invariants named in `layout-tree.ts` JSDoc are enforced in code, not just documented. `DeckStateInvariantError` tells you *which* invariant and *which* ids. A future mutator that introduces a bug fails at the site that produced it.

**5. The v1→v2 migration carried tugbank keys unchanged.** Tabs-become-cards retained their ids. Tugbank's `tabstate/{id}` rows, which store per-content persistence, continue to resolve. No data migration, no user-visible loss of state. This is the right tradeoff — the wire contract stays stable, the vocabulary internally converges on "card."

**6. Piece 2.5's audit caught the click-to-activate regression.** A single-shot Piece 2 would have shipped a broken interaction. The audit post-commit — before declaring Piece 2 done — found the `onCardFocused(stackId) → activateCard(stackId)` bug. Five fixes landed (click-to-activate, spurious destruction event in merge, handleCardClosed→handleStackClosed rename, validateDeckState helper, the P2 nits bundle). The discipline of "audit after each piece" paid off.

### Weaknesses, pitfalls, and limitations

**P1 — DOM vocabulary and source vocabulary diverge.**

`StackFrame` sets `data-card-id={stackId}` on its frame div (stack-frame.tsx:782). `CardContentHost` sets `data-tab-id={cardId}` on its wrapper (card-content-host.tsx:351). `card-drag-coordinator`'s selectors use `data-card-id` to find stacks. `TugTabBar` uses `data-card-id` on the bar element to drive drag-merge hit-testing.

In the new vocabulary, "card" is the content and "stack" is the frame. The DOM still calls the frame `data-card-id` and the content `data-tab-id`. A reader who understands only the source-level vocabulary will parse DOM selectors wrong; a reader who understands only the DOM will parse the data model wrong. Two cognitive overhead layers on every DOM query.

This was flagged in Piece 2's "note it in the commit message" out, but the actual rename was deferred. It should not stay deferred — the longer the mismatch lives, the more call sites assume it. Recommend renaming in a bounded commit:
- `data-card-id` on frames → `data-stack-id`
- `data-tab-id` on content hosts → `data-card-id`
- `data-tab-bar` and `tug-tab-bar` class names → `data-stack-tab-bar`, `tug-stack-tab-bar`

Mechanical; reviewable; the only risk is missed call sites, which `rg` will surface.

**Status — resolved (2026-04-21):** Implemented under [`tugplan-vocabulary-rename.md`](tugplan-vocabulary-rename.md) (Steps 8–9, 11–12). Outer deck chrome uses `data-window-id` on the window frame and tab bar (window identity); `CardHost` uses `data-card-id` (card identity). Class names `.tug-window` / `.tug-window-content` replace the old frame/content drift described above. Wire actions `focus-window` + `windowId` and menu copy ("Add Card to Active Window", "Close Card") match the same vocabulary. The audit's original sketch (`data-stack-id`, `.stack-frame`) was superseded by the **window** naming convention chosen in that plan.

**P2 — The content registry is keyed by `stackId` but named `card-content-registry`.**

The file's header acknowledges this: "The file name carries the historical 'card-content' vocabulary even though the key is now `stackId`." Fine in isolation; but paired with P1, this is another place where the lookup semantics aren't self-documenting. The registry is really a stack-content-div registry. Rename the file; renaming by 80 chars of text now saves an hour of "is this keyed by card or stack?" confusion across six months.

Recommended rename: `card-content-registry.ts` → `stack-content-registry.ts` (or `stack-content-div-registry.ts`). Update import sites. The `register/unregister/getElement/subscribe` API stays.

**Status — resolved (2026-04-21):** Registry modules are `window-content-registry.ts` and `window-root-registry.ts` (Step 4 of [`tugplan-vocabulary-rename.md`](tugplan-vocabulary-rename.md)); keys are host window ids. The audit's `stack-content-registry` name was not used; **window** was chosen as the public term for the deck frame entity.

**P3 — The `card-frame` CSS class name has not been renamed.**

`StackFrame` renders `<div className="card-frame" data-card-id={id} …>`. CSS selectors in `chrome.css` target `.card-frame`. Drag coordinator selectors target `.card-frame[data-card-id]`. Same vocabulary drift as P1/P2. The rename from `CardFrame` component to `StackFrame` landed; the rename of the CSS class and the matching selectors did not. Complete the rename.

**Status — resolved (2026-04-21):** Frame chrome is `.tug-window` with `data-window-id`; content area `.tug-window-content`; resize handles `.tug-window-resize-*` (Step 9, [`tugplan-vocabulary-rename.md`](tugplan-vocabulary-rename.md)). `chrome.css` and `tug-window.css` updated; drag coordinator and tests follow the new selectors.

**P4 — DeckCanvas renders two flat parallel lists that must stay in sync.**

```tsx
{sortedStacks.map(stack => <StackFrame …>)}
{cards.map(card => <CardContentHost …>)}
```

Order of React mount effects within a commit is not guaranteed to be source order. The content registry `register(stackId, el)` runs in `Tugcard`'s `useLayoutEffect`, which is nested inside `StackFrame`, which is nested inside the first `.map`. `CardContentHost`'s `useHostContentElement` reads the registry via `useSyncExternalStore`, which — on first mount — returns `null` if the registry hasn't been populated yet. The portal correctly no-ops until the registry subscriber fires, then re-roots.

This works. But the design depends on "it's fine for the content to render into a null host momentarily." A subtle bug would be: if a consumer reads from the portaled DOM tree in its own mount effect (not after a registry subscription), it may see empty content. Today no consumer does this; that's a load-bearing assumption about every future consumer.

Mitigation: document the ordering dependency in `card-portal.tsx`'s header so future authors don't assume "portal children are in the DOM on mount." They aren't; they are in the DOM on the first registry callback.

**P5 — `CardPortal` cleanup leaves children React-mounted while their host DOM is gone.**

When a stack closes, `Tugcard`'s `useLayoutEffect` cleanup runs `cardContentRegistry.unregister(stackId)`. `CardPortal`'s subscriber fires, `attachToCurrentHost` sees `null`, removes the slot from whatever host it was attached to. Children are still React-mounted — their effects, WebSockets, and timers are all alive — but the DOM they would render into is detached. `_closeStack` then fires `cardWillBeginDestruction` for each card, and React unmounts `CardContentHost` in the next commit.

Between the registry unregister and the React unmount, there is a brief window where effects run against detached DOM. If an effect does `contentEl.addEventListener(…)` and `contentEl` is the unregistered host, the listener is added to a DOM node that is no longer in the tree — usually harmless, occasionally the source of "why is this listener never firing?" bugs.

Today's code is careful: the scroll / selectionchange effect uses `hostContentEl` as a dep and cleans up properly. But the next author is not guaranteed to be as careful. The mechanism would benefit from a clearer teardown contract: when a stack closes, either (a) the cards in it finish destruction *before* the stack's content div unmounts, or (b) effects observe teardown via an explicit `onHostGone` hook rather than a null-check.

Not a bug today; a subtle design pressure.

**P6 — `CardContentHost` is becoming a god-component (385 lines).**

PropertyStore registration, persistence callbacks, saveCurrentCardState, save callback, auto-save timer, scroll/selection listeners, content restore, FeedStore, responder scope, portal mount. Each is reasonable; the accretion is less so.

The natural decomposition — `useCardPropertyStore()`, `useCardPersistence()`, `useCardDirtyState()`, `useCardContentRestore()` — would move each concern into its own hook that the host calls. Each hook would be unit-testable. CardContentHost would be the wiring harness. Today it is the wiring harness *and* each concern's implementation.

Not urgent. The file is still readable. But every new per-card concern will land here, and without decomposition this is the file that becomes 600 lines by the end of the next quarter.

**P7 — `registerSaveCallback(id, callback)` accepts any string key.**

The JSDoc says "any unique key works." Production uses cardId. Tests sometimes use stackId. The map is one flat `Map<string, () => void>`. If a test registers by stackId and a card coexists with the same UUID as a stack (they are all `crypto.randomUUID()`), the second call silently overwrites the first.

UUIDs almost never collide, so this is a theoretical gap, not a real one. But the loose keying is a semantic smell. Split into `saveCallbacksByCardId` and `saveCallbacksByStackId` (and remove the stackId branch if it's no longer used), or document the key as "always cardId."

**P8 — The stable-render-order trick is load-bearing and invisible.**

`sortedStacks` is `stacks.sort((a, b) => a.id.localeCompare(b.id))`. Z-index comes from the store array position. This is done so that `focusCard` reordering the store array changes only z-index (React never calls `insertBefore` to reorder DOM), which preserves the browser's pointerdown → click event sequence when a click lands on an interactive element of a non-focused stack.

This is the right call. But a future author who "optimizes" `sortedStacks` by removing the sort (perceived as an unnecessary copy) would break click-on-non-focused-stack activation in a hard-to-diagnose way. The inline comment exists but may not be enough. Consider encoding the invariant in a test that clicks an interactive element in a non-focused stack and asserts the click fires *after* activation — if someone ever removes the sort, this test would fail.

**P9 — `moveStack` and `arrangeCards` fire move/resize events for the active card only.**

Non-active cards in the same stack see their rendered geometry change (they share the stack's position/size) but receive no `cardDidMove` / `cardDidResize`. Today this is the right tradeoff — tide card cares only when it's first responder. But future card types (charts that re-layout on resize, media players that reposition controls) may want the inactive-card signal.

This is a deferred scope decision, not a bug. When the first card type wants the inactive-card signal, the plan of record should be "add a `cardDidMoveInStack` / `cardDidResizeInStack` event that fires for every card in the moving stack." Don't bolt it onto `cardDidMove` — that would retroactively break the "only when visible and FR" guard in tide's delegate.

**P10 — `setActiveCardInStack` in an inactive stack fires no lifecycle events.**

Transition 5b from the plan. Semantically correct — no first-responder change occurred. But it means the sentence "every state change flows through the lifecycle delegates" has an explicit exception. Observers that care about "what is stack X's active card?" (e.g., a future "inactive stacks show a thumbnail of the active card" feature) need to subscribe directly to the store via `useSyncExternalStore`, not via the lifecycle delegates.

Not a bug; a limitation. Worth documenting in the `CardLifecycle` banner so consumers don't assume the delegate sees every state change.

**P11 — `handleStackClosed` fires destruction for every card in the stack, in `cardIds` order.**

A multi-card stack of cards [A, B, C] with B as active: on close, destruction fires A → B → C. The active card's destruction is in the middle. If a delegate assumes "destruction fires for the currently-active card last" (a reasonable-sounding assumption) it will be wrong. The plan does not pin an order; the implementation uses `stack.cardIds` iteration order.

Low-priority. But pin the order explicitly — either "active card last" or "cardIds order" — in `_closeStack`'s JSDoc, so future changes can be evaluated against a declared contract.

**P12 — `Tugcard`'s content div is empty at render but populated via portal.**

`Tugcard` renders `<div ref={contentRef} className="tugcard-content">{children}</div>` where `children` is `null` (`<Tugcard>{null}</Tugcard>`). The actual content lands via portal asynchronously. A test (or a screenshot, or a dev-tools inspection at the wrong moment) that reads `tugcard-content`'s innerHTML may see empty at frame 0 and populated at frame 1. The gap is one registry callback long.

This is a natural consequence of the portal design and probably unavoidable. But it means any test that introspects the DOM tree must wait for the portal to land — the test helpers should provide a `waitForPortal(stackId)` utility rather than leaving every test author to figure out the timing.

**P13 — `applyLayout` (H-A7) — same issue as Part 1 / L7.**

Listed again here because it sits at the intersection of both projects.

### Part 2 — recommended follow-up

In rough priority order:

1. **~~Rename DOM vocabulary~~ (P1 / P3) — resolved.** Landed as `TugWindow` / `CardHost` with `data-window-id`, `data-card-id`, `.tug-window`, `.tug-window-content`; see [`tugplan-vocabulary-rename.md`](tugplan-vocabulary-rename.md) Steps 8–9.
2. **~~Rename content/root registries~~ (P2) — resolved.** `window-content-registry.ts` / `window-root-registry.ts` (Step 4); same `register` / `unregister` / `getElement` / `subscribe` API.
3. **Decompose `CardHost`** (P6; formerly `CardContentHost`) into per-concern hooks: `useCardPropertyStore`, `useCardPersistence`, `useCardDirtyState`, `useCardContentRestore`, `useCardFeedStore`. Cuts the file roughly in half, makes each concern testable in isolation. Can land incrementally.
4. **Document portal mount-ordering** in `card-portal.tsx` (P4). One paragraph: "children render into a null host until the registry subscriber fires on the next commit; do not assume children are in the DOM on first render."
5. **Pin stable-render-order invariant with a test** (P8) that clicks an interactive element in a non-focused stack and asserts activation fires first.
6. **Document `setActiveCardInWindow`'s silent path** (P10) in the `CardLifecycle` header. The lifecycle is the unified pipe, with *one documented exception*. *(Name at audit time: `setActiveCardInStack`.)*
7. **Split `registerSaveCallback`'s map by key role** or document the single-role semantic (P7).
8. **Pin `_closeWindow`'s destruction order** in JSDoc (P11). *(Name at audit time: `_closeStack`.)*
9. **Delete `applyLayout`** (P13 / L7) or replace with a diff-based form.

---

## Cross-cutting

### Scope entanglement

The two plans are really one. The lifecycle work exposed that the card model conflated identity and framing; the portal work formalized the split; the composite first-responder semantics (Step 11.6.1b) are where the two meet. This is fine as execution, but it means the **"lifecycle-delegates"** plan in `roadmap/` is a 1,351-line document covering two projects. Anyone looking for "the portal design" has to read through "the delegate API" first.

When the next layer lands (probably session restoration, tide session metadata, or multi-window), the equivalent split should be recognized earlier. Write two plans, not one plan that grew.

### The validator is a good pattern; use it elsewhere

`validateDeckState` is the model. It encodes invariants in executable form, runs in dev on every mutation, gives clear errors on violation. The same pattern would benefit:

- `CardLifecycle.constructedCards` vs the set of ids in `deckState.cards` — they should always match. A `validateLifecycleState(cardLifecycle, deckState)` check run in dev on every notify would catch the leak case where a card is destroyed but not un-registered (or vice versa).
- `selectionGuard`'s boundary map vs the live set of stack/card ids.
- `saveCallbacks`'s keys vs the live card ids.

Each would add 10–20 lines of dev-only assertion and catch an entire class of drift bug.

### Logs are great; keep the discipline

`LIFECYCLE_LOG` makes the logging toggleable in one line per file. The pattern is cheap and grep-friendly. Use the same pattern (one `const MY_FLAG = Boolean(import.meta.env?.DEV)` at the top of each new module) for future subsystems that want optional tracing. Don't reach for a structured-logging library until there are at least five such modules that need coordinated filtering — three is below the threshold where the library earns its weight.

### Tests to add before moving on

Not a code fix, but the shortest path to confidence that the foundation is solid:

- **HMR re-registration**: construct DeckManager, destroy, construct again; fire cascade event; assert only gen-2 subscribers fire.
- **Concurrent movement + destruction**: drag card A to stack B while closing stack B. Expected: graceful rejection of one operation, no invariant violation.
- **Portal orphan recovery**: close the host stack while the card's content effects are mid-debounce; assert no exception, no duplicate save.
- **`cardDidFinishConstruction` firing order on loaded layout**: mount with a 5-card saved layout; assert 5 construction events fire in deckState.cards order before the reactRoot commits.

### Priority call

If only three changes from this audit land before the next major project starts:

1. **Delete `applyLayout`** (Part 1 / L7, Part 2 / P13). Deprecated code that violates invariants is strictly worse than either fixing it or removing it.
2. **Document the will-delegate semantic inversion** (Part 1 / L1). Catches the next author before they write a `cardWill*` handler that reads state.
3. **Consolidate `getActiveCardId` and `getFirstResponderCardId`** (Part 1 / L3) — or **share one drain queue** (L2); pick whichever unblocks the next feature first.

**Update:** ~~DOM/CSS/registry vocabulary~~ (Part 2 / P1–P3) is **resolved** — see [`tugplan-vocabulary-rename.md`](tugplan-vocabulary-rename.md) and § Vocabulary decisions below.

Everything else is valuable but survivable.

---

**Bottom line:** the work is real engineering, not just movement. Both projects ship a better foundation than the one they replaced — the lifecycle is properly delegate-shaped, the portal model preserves session identity in ways the old code could not, and the invariants are enforced rather than wished for. The weaknesses are the kind that always accumulate when two projects ship together under pressure: vocabulary drift, near-duplicate helpers, a god-component starting to form, one semantic inversion under deferred delivery. **Deck/window/card vocabulary drift (P1–P3) is now addressed** — see [`tugplan-vocabulary-rename.md`](tugplan-vocabulary-rename.md). Remaining items (L1–L10, P4–P13) still reward attention. None blocks the next layer. Addressing the top three *remaining* recommendations before moving on will make the next project noticeably easier to land.

---

## Vocabulary decisions (2026-04-21)

This audit was written while the codebase still used **stack**-centric names (`StackFrame`, `card-content-registry`, `data-card-id` on frames, `focus-card` / `stackId` on the wire). Those issues are tracked as **P1–P3** above and are **resolved** by the dedicated rename plan:

- **Plan:** [`roadmap/tugplan-vocabulary-rename.md`](tugplan-vocabulary-rename.md) — full step list, grep checkpoints, and commit-style headings.
- **Resolved audit items:**
  - **P1 (DOM vocabulary):** Window frames use `data-window-id` and `.tug-window` / `.tug-window-content`; card hosts use `data-card-id`; tab bar and drag hit-testing use `data-window-id` for window identity; `selection-guard` walks `data-window-id` / `data-card-id` as appropriate.
  - **P2 (registry file names):** `window-content-registry` and `window-root-registry` (keys = host window id).
  - **P3 (CSS):** `.tug-window`, `.tug-window-resize-*`, shared chrome in `chrome.css` / `tug-window.css`.
- **Also in that plan (cross-references for readers of this audit):** `DeckState` v3 (`windows` / `activeWindowId`), store API `*Window` mutators, `ADD_CARD_TO_ACTIVE_PANE`, Swift `focus-pane` + `paneId`, menu text for add/close card actions.

Historical paragraphs elsewhere in this document retain **stack** / **StackFrame** / **`CardContentHost`** names where they describe the code as it existed at audit time; use this section and the rename plan as the source of truth for **current** naming.
