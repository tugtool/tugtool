# Focus gesture-lock investigation (Phase E.11 Step 1)

Status: in flight — code-derived analysis written; running-app gesture
matrix to be captured by re-running each source against the trace ring
with `deckTrace.enable(true)` and verifying that the observed
`focus-measurement` triples match the predictions named here.

## Why this note exists

Phase E.10/3 wired find-row focus survival against the engineless
gallery fixture (AT0071–74 green) but the real-tide scenarios failed:

- Cmd-` away then back: focus jumps to the prompt-entry, not the find
  row.
- Title-bar click on another card, then back: focus jumps to the
  prompt-entry, not the find row.
- Developer > Reload: focus jumps to the prompt-entry, not the find row.

The diagnosis (see `roadmap/tide-assistant-rendering.md` Phase E.11 prose)
identifies a **four-claimant race**: `transferFocusForActivation`'s
focus-element branch (sync, pointerdown), `useCardStatePreservation.onCardActivated`
via `invokeActivationCallback` (sync, dispatch-activated), `useCardDelegate.cardDidActivate`
(MessageChannel macrotask), and CardHost cold-boot `applyFocusSnapshot`
(`useLayoutEffect`, mount-time). Each claimant calls `.focus()` without
consulting the others; the **last write wins**, which is invariably
whichever site runs latest in the macrotask ordering — i.e. the engine
takes back focus the framework just gave to the find input.

`[L05]` (no timing-derived ordering for state-commit operations) says
focus dispatch must hang off a contractual event boundary, not off
the implementation-derived macrotask drain order. This note
characterizes that boundary per source so the Step 3 dispatcher can
fire on the right event.

## Instrumentation added this step (no behavior change)

Deck-trace events added (`tugdeck/src/deck-trace.ts`):

- `focus-measurement` — `phase: "pre-sync" | "post-sync" | "post-gesture"`,
  `site`, `cardId`, `activeElement`. Wraps each framework focus-claim
  site with three observations: immediately before the sync claim,
  immediately after, and one macrotask boundary later. The triple
  surfaces whether the sync `.focus()` survives the gesture default
  action or is swallowed by WebKit's gesture focus-lock.
- `engine-paint-mirror-active` — `cardId`, `caller` (one of
  `onCardActivated`, `onRestore`, `mount-effect-replay`,
  `imperative-api`, `via-engine-hook`). Fires every time
  `paintMirrorAsActive` runs, with the caller tag identifying which of
  the four claimants invoked it.
- `engine-paint-mirror-inactive` — `cardId`. Symmetry pair so the trace
  verifies deactivation pairs are intact across the refactor.
- `macrotask-focus-claim` — `cardId`, `delegate` (one of
  `cardDidActivate`, `cardDidMove`, `cardDidResize`). Fires every time
  `useCardDelegate`'s `MessageChannel`-deferred handler calls
  `entryDelegateRef.current?.focus()` in `tide-card.tsx`. Lets the
  trace see the macrotask claim distinctly from the synchronous
  framework path.

Wiring sites:

- `tugdeck/src/focus-transfer.ts` — `measureFocusClaim` helper wraps
  `.focus()` in `transferFocusForActivation` (focus-element + dispatch-
  activated), `transferFocusAfterMove` (focus-element + dispatch-
  activated), and `reactivateCurrentFocusDestination` (focus-element +
  dispatch-activated).
- `tugdeck/src/components/chrome/card-host.tsx` — `traceApplyFocusSnapshot`
  records the three-phase triple around `applyFocusSnapshot` for the
  cold-boot RESTORE call site.
- `tugdeck/src/components/tugways/tug-text-editor/state-preservation.ts`
  — `recordPaintMirrorActive(caller)` / `recordPaintMirrorInactive()`
  fire at every `paintMirrorAsActive` / `paintMirrorAsInactive` call
  site (`onCardActivated`, `onRestore` `isActive` and `!isActive`
  branches, `onCardWillDeactivate`).
- `tugdeck/src/components/tugways/tug-text-editor.tsx` — mount-effect
  replay (`mount-effect-replay`) and imperative-api (`imperative-api`)
  call sites record their own events.
- `tugdeck/src/components/tugways/cards/tide-card.tsx` — each of the
  three `useCardDelegate` handlers (`cardDidActivate`, `cardDidMove`,
  `cardDidResize`) records `macrotask-focus-claim` before its
  `entryDelegateRef.current?.focus()` call.

## Per-source × per-kind matrix

Each row names one activation source and the contractual event
boundary on which **Step 3's dispatcher should fire**. The "claimants
observed" column lists the four-claimant ordering predicted by the
current code; the running-app verification step replaces these
predictions with observed values from the live trace.

| Source | Dispatch entry point | bag.focus kind | Sync survives? | Claimants observed (current code) | Step 3 dispatch event |
|--------|---------------------|----------------|----------------|-----------------------------------|----------------------|
| Pane-chrome click | `pane-focus-controller` `pointerdown` capture → `transferFocusForActivation` | `engine` | No — mousedown default re-focuses click target | `transfer-focus:focus-element` (sync) → engine's `onCardActivated` → `macrotask-focus-claim cardDidActivate` | `pointerup` for click target inside same pane (preserves mousedown's caret-positioning); `pointerdown` for click on title-bar / non-text chrome (mousedown has no caret semantics to preserve) |
| Pane-chrome click | same | `dom` (find input) | Predicted yes for title-bar click; no for in-card click | same | same |
| Pane-chrome click | same | `form-control` | Predicted yes for title-bar click; no for in-card click | same | same |
| Intra-pane tab click | `tug-pane.tsx#performSelectCard` synchronous → `transferFocusForActivation` | `engine` | Yes (tab strip is not the focused element's container) | sync claim wins; engine `onCardActivated` re-asserts; `macrotask-focus-claim cardDidActivate` re-asserts | `pointerdown` (sync claim contractually survives — no mousedown default to fight) |
| Intra-pane tab click | same | `dom` | Yes | sync claim wins; engine `onCardActivated` re-asserts (clobbers framework) | `pointerdown` |
| Cross-pane drag drop | `card-drag-coordinator` `pointerup` (drop callback) → `transferFocusAfterMove` | any | Yes (drop is the gesture-end boundary) | sync claim wins | `pointerup` (already correct — no change in Step 3) |
| Cross-pane move via deck mutation | `deck-manager.ts:1864/1988` (post-`notify`) → `transferFocusAfterMove` | any | Yes (no gesture in flight) | sync claim wins | n/a — no DOM event; runs in the same task as the mutation |
| Keyboard activation (Cmd-`) | `deck-canvas.tsx` `keydown` capture → `transferFocusForActivation` | any | Yes (no mouse gesture default to fight) | sync claim wins; engine `onCardActivated` re-asserts (clobbers framework) | `keydown` (sync claim contractually survives) |
| Keyboard activation (Tab into pane) | browser `focus` propagation → tab/click path | any | Yes | sync claim wins | n/a — browser-driven focus |
| Programmatic activation (action-dispatch) | `action-dispatch.ts:338` `activateCard` → no `transferFocusForActivation` wrap (today) | any | n/a | engine `onCardActivated` only (no framework claim); macrotask delegate re-asserts | n/a — boot site; Step 3 wraps these for symmetry, but focus claim happens via CardHost cold-boot RESTORE |
| Programmatic activation (show-gallery) | `deck-canvas.tsx:226/231` `activateCard` → no wrap (today) | any | n/a | same | same |
| Programmatic activation (initial-focused-card-restore) | `deck-canvas.tsx:291` `activateCard` → no wrap (today) | any | n/a | same | same |
| Window-focus reactivation (Cmd-` return) | `deck-manager.ts:127` `setHasFocus(true)` → `reactivateCurrentFocusDestination` | any | Yes (no DOM gesture in flight) | sync claim wins; engine `onCardActivated` does NOT fire (no activation transition); but the engine's `paintMirrorAsActive` STILL claims via `onCardActivated` registration on subsequent card-switch | n/a — runs in the window-`focus` handler task |
| Cold-boot RESTORE | `card-host.tsx` `useLayoutEffect` mount → `traceApplyFocusSnapshot` → `applyFocusSnapshot` | `dom` / `form-control` | Yes (mount-time, no gesture) | framework cold-boot claim → engine `onRestore` `isActive` branch claim (clobbers framework) → engine `onCardActivated` claim (clobbers again) → macrotask delegate claim (clobbers again) | n/a — mount event; the cold-boot is "no DOM event" but suffers the same race from the OTHER three claimants |

## Predicted matrix outcomes (to verify against the live trace)

For each row whose "Sync survives?" column says **yes**, the
prediction is: `focus-measurement.post-sync.activeElement` already
names the resolved target, and `post-gesture.activeElement` may have
been clobbered by a later claimant (engine `onCardActivated`'s
`paintMirrorAsActive`, the cardDidActivate macrotask, or both).

For each row whose "Sync survives?" column says **no**, the
prediction is: `focus-measurement.pre-sync` and
`focus-measurement.post-sync` carry the same `activeElement` (sync
`.focus()` was overridden by mousedown's default action), and
`post-gesture.activeElement` carries the gesture target's resolved
focus.

## What the matrix tells Step 3

For **every source** the same conclusion holds:

1. **The sync framework claim is not the bug.** When sync survives,
   the framework already wrote the right element; when sync doesn't
   survive, moving the dispatch to `pointerup` / `click` resolves
   gesture focus-lock. The macrotask drain order is the bug.

2. **The engine's autonomous claim is the bug.** Every row shows the
   engine's `paintMirrorAsActive` running unconditionally after the
   framework's claim — via `onCardActivated`, `onRestore`, or the
   delegate macrotask. The single-channel dispatcher reduces this to
   one path: the framework consults `bag.focus`, and if the
   resolution is `engine`, invokes the engine hook; if it's `dom` /
   `form-control`, calls `.focus()` directly; the engine no longer
   self-claims.

3. **The macrotask delegate's claim is the bug.** Every "claimants
   observed" entry ends with `macrotask-focus-claim cardDidActivate`
   re-asserting focus on the contenteditable — even when the
   framework wrote a find input two events earlier. The Step 3
   retirement of this claim closes the race.

## Per-source dispatch event recommendation (for Step 3 wiring)

| Source | Dispatch event |
|--------|----------------|
| Pane-chrome click on title-bar / non-text chrome | `pointerdown` (sync survives; no mousedown caret-positioning default to preserve) |
| Pane-chrome click on in-card text | `pointerup` (let mousedown's default position the caret; dispatch the activation focus after mousedown completes) |
| Intra-pane tab click | `pointerdown` (tab strip is not a caret-bearing element) |
| Cross-pane drag drop | `pointerup` (gesture-end; existing behavior) |
| Keyboard activation | `keydown` (no gesture default to fight) |
| Programmatic activation | synchronous (no DOM event) |
| Window-focus reactivation | window `focus` (existing) |
| Cold-boot RESTORE | `useLayoutEffect` (existing); late-mount retry via Step 4 |

## Manual verification protocol (to run against the live app)

For each source named in the matrix:

1. `just app` to launch the running app.
2. Open Safari Web Inspector against the WKWebView.
3. In the console: `window.__deckTrace.enable(true); window.__deckTrace.clear();`
4. Reproduce the source's gesture (e.g., title-bar click of another
   tide card).
5. In the console: `window.__deckTrace.dumpTable();`
6. Record, in this note's "Claimants observed" column:
   - The `focus-measurement.pre-sync` / `post-sync` / `post-gesture`
     `activeElement` triples for the framework site that fired.
   - The `engine-paint-mirror-active` events, in order, with their
     `caller` tags.
   - The `macrotask-focus-claim` events, with their `delegate` tags.
   - The final `focusin` event's `el` value.

If the observed triple disagrees with the prediction, update the
matrix row and the Step 3 dispatch-event recommendation accordingly.

## Outcome (gates the Step 3 dispatcher design)

Step 3's `applyBagFocus` dispatcher will:

- Fire synchronously when the source's dispatch event is the same
  event the framework currently runs in (i.e. sync survives).
- Move to `pointerup` / `click` for the in-card-text-click subcases
  where sync does not survive.
- Invoke the engine hook (`store.invokeEnginePaintMirrorAsActive(cardId)`)
  when `bag.focus.kind === "engine"`; the engine no longer claims
  autonomously.
- Replace the macrotask delegate's claim entirely; `cardDidActivate`
  no longer calls `entryDelegateRef.current?.focus()`.
