<!-- tugplan-skeleton v2 -->

## Lifecycle Delegates — App and Card {#lifecycle-delegates}

**Purpose:** Replace the current ad-hoc `CardLifecycle` four-event pipe (construction / activation / deactivation / destruction) with a proper Apple-style delegate protocol that covers both the card lifecycle *and* the app lifecycle. Rename the card events to the macOS `will`/`did` convention, expand to include will-variants for activate/deactivate, and add eight new app-level events driven from `NSApplicationDelegate`. Route app events through the existing control-frame plumbing (no new `window.__*` globals). Collapse the four `useOnCard*` hooks into one `useCardDelegate(cardId, delegate)` hook that accepts a protocol-shaped object. Expose app events through a parallel `useAppDelegate(delegate)` hook. Wire the tide card's prompt-editor focus behavior as the canonical test effect. Cascade app background/hide into card deactivation and app foreground/unhide into card reactivation, idempotently. Add structured `[CardLifecycle]` / `[AppLifecycle]` logging throughout. Treat the reliability of delegate-method delivery (currently a setState+useEffect deferral that escapes WebKit's gesture focus-lock) as a *separate design study* that follows the API rename and lands its own mechanism — retiring `lib/defer.ts` once a principled answer exists.

The work is staged rename-first, then API-shape, then app-lifecycle wiring, then cascade, then the reliability study. Every commit keeps the build green.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-04-20 |
| Predecessor | [tugplan-tide-card-polish.md §Step 5.5](./tugplan-tide-card-polish.md) (unified card-activation lifecycle) |
| Related | `tugdeck/src/lib/card-lifecycle.ts`, `tugapp/Sources/AppDelegate.swift`, `tugdeck/src/main.tsx`, `tugdeck/src/components/tugways/selection-guard.ts` |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The [T3.4.d tide-card-polish Step 5.5](./tugplan-tide-card-polish.md) work landed a unified `CardLifecycle` in `tugdeck/src/lib/card-lifecycle.ts` with four events: **Construction**, **Activation**, **Deactivation**, **Destruction**. Subscribers register via `observeCard{Construction,Activation,Deactivation,Destruction}`; React components use four parallel hooks (`useOnCardConstruction`, `useOnCardActivation`, `useOnCardDeactivation`, `useOnCardDestruction`). Notifications fire synchronously at the lifecycle layer; the React hooks defer the user callback via a `setState → useEffect` pipeline so focus-side-effects run post-paint, outside WebKit's pointer-gesture focus-lock.

Parallel to that, the app side of lifecycle exists in `tugapp/Sources/AppDelegate.swift` only for **two** events — `applicationDidResignActive` (lines 181–184) and `applicationDidBecomeActive` (lines 186–189) — each doing exactly one thing: calling a `window.__tugdeckAppDeactivated()` / `__tugdeckAppActivated()` global function defined in `tugdeck/src/main.tsx:172–184`. Those globals directly call `selectionGuard.(de)activateApp()` and, on deactivate, `deck.saveAndFlush()`. There is no general app-delegate surface on the tugdeck side; there are no `will` variants; there is no `applicationDid{Hide,Unhide}` coverage; and card-lifecycle and app-lifecycle are entirely disjoint — app backgrounding does *not* fire `cardDidDeactivate` on the active card, and app foregrounding does *not* re-fire `cardDidActivate`.

Three specific problems motivate this plan:

1. **Naming.** The current method names (`observeCardActivation`, `useOnCardActivation`) read as event stream names, not as delegate-protocol members. Decades of Apple-platform experience say the `will`/`did` pair is the right vocabulary for lifecycle transitions: it makes the *timing* (before vs. after the state change) and the *intent* (prepare vs. react) unambiguous.
2. **Shape.** Registering four hooks per card body to express "I am a delegate of this card's lifecycle" obscures the pattern. A single `useCardDelegate(cardId, delegate)` hook accepting an object with optional methods matches `NSWindowDelegate` / `UIApplicationDelegate` / `UITableViewDelegate` and scales as we add methods (e.g., `cardWillResize`, `cardDidResize` later).
3. **Reliability.** The currently-shipped `setState → useEffect` deferral is a Rube Goldberg machine: it works today because `useEffect` happens to run post-paint outside the gesture, but the mechanism leaks implementation details of React's commit scheduling into a piece of the system that should be bedrock-stable. The user is *greatly dissatisfied* with this. The `lib/defer.ts` helper (`deferToNextMacrotask` via `setTimeout(fn, 0)`) is dead code carrying a tuglaws-non-compliant shape; it must be retired, but only once a principled replacement lands.

Three additional needs fold in:

4. **App lifecycle coverage.** macOS emits eight lifecycle notifications any serious app attends to: `applicationWillBecomeActive` / `applicationDidBecomeActive` / `applicationWillResignActive` / `applicationDidResignActive` / `applicationWillHide` / `applicationDidHide` / `applicationWillUnhide` / `applicationDidUnhide`. Tugdeck needs all eight as first-class delegate methods so downstream surfaces can respond — most immediately, the active card must deactivate on background/hide and reactivate on foreground/unhide, idempotently.
5. **App → card cascade.** When the app resigns active or hides, the active card (if any) should fire `cardWillDeactivate` → `cardDidDeactivate` so its prompt-entry loses focus (and any visible caret blink stops). On `applicationDidBecomeActive` or `applicationDidUnhide`, the previously-active card should re-fire activation so the prompt-entry regains focus. Deactivation is idempotent: it's safe to fire on both `willResignActive` and `willHide` back-to-back without double-side-effects.
6. **Wire format hygiene.** `window.__tugdeckAppActivated` and friends are the last double-underscore global JS functions the Swift side calls. We can fold the eight app-lifecycle events into the existing control-frame plumbing (`processManager.sendControl(action, params)` on the Swift side; `action-dispatch.ts` on the JS side) with a single `app-lifecycle` action and an `event` param. That leaves only the two synchronous Swift-initiated calls (`__tugdeckSaveState`, `__tugdeckReconnect`) as `evaluateJavaScript` entry points, and those should be renamed onto a single `window.tugdeck` namespace object — no double-underscores anywhere.

This plan unifies (1) through (6) into a coherent delegate surface.

#### Strategy {#strategy}

- **Rename first, then reshape.** Step 1 is a pure rename of the existing `CardLifecycle` method and hook names to `will`/`did` form (keeping the four-hook shape). That commit has no behavioral change and can be cherry-picked cleanly. Step 2 then collapses the hooks into one `useCardDelegate`.
- **Expand the card protocol before the app protocol.** Add `cardWillActivate` / `cardWillDeactivate` to the card lifecycle (Step 3) before wiring anything on the app side. That exercises the will/did pattern inside existing code paths first.
- **App lifecycle lands after card lifecycle stabilizes.** Step 4 introduces the `AppLifecycle` class and `useAppDelegate` hook with no wiring to Swift yet — purely the shape. Step 5 replaces the two existing window globals with control-frame dispatch. Step 6 adds the six new NSApplicationDelegate methods on the Swift side (will/did hide + unhide, plus will variants for active/resign). Step 7 cascades app → card.
- **Test effect is the tide card's prompt editor.** Every step that changes lifecycle delivery must be verified by the tide card behavior: opening a card focuses the prompt; switching cards deactivates the leaving card and activates the entering card's prompt; backgrounding the app removes focus; foregrounding restores it; Cmd-H hides and removes focus; app unhide restores it.
- **Reliability is its own step.** Step 10 is a *design study*, not a code step — research on the web (WebKit focus-lock semantics, React scheduler guarantees, MessageChannel microtask ordering, scheduler.yield, modern event-loop primitives), a written analysis in-tree, and a concrete proposal. Step 11 implements the chosen mechanism and retires `lib/defer.ts`.
- **Logging throughout.** Every delegate-method delivery prints a structured line: `[CardLifecycle] cardDidActivate id=abc123` / `[AppLifecycle] applicationWillResignActive`. Cascade events log at both layers (app event first, then the card event triggered by the cascade). This is cheap, greppable, and can be deleted wholesale with one regex once the system is trusted.
- **Idempotent deactivation.** Because both `applicationWillResignActive` and `applicationWillHide` can fire in sequence (app loses focus, then is hidden via Cmd-H), `cardWillDeactivate`/`cardDidDeactivate` must be safe to call twice in a row with no double-side-effect. The cascade layer tracks a "currently deactivated by app" flag; the second fire is a no-op.
- **Tuglaws apply at every step.** Subscriptions install in `useLayoutEffect` (L03). The delegate dispatcher owns direct DOM observation, not React state (L22). Appearance of focus rings / caret blink is CSS-driven (L06). Hooks read current callback via refs (L07).
- **One commit per step.** `bun run check`, `bun test`, `bun run audit:tokens lint`, and `cargo nextest run` pass at every commit. `-D warnings` enforced.

#### Success Criteria (Measurable) {#success-criteria}

**API shape:**
- `CardLifecycle` exposes `notifyCardWillActivate`, `notifyCardDidActivate`, `notifyCardWillDeactivate`, `notifyCardDidDeactivate`, `notifyCardDidFinishConstruction`, `notifyCardWillBeginDestruction`. Matching `observeCard*` methods exist. (verification: `rg "notifyCard(Did|Will)" tugdeck/src/lib/card-lifecycle.ts` lists all six; no `notifyActivation` / `notifyDeactivation` / `notifyConstruction` / `notifyDestruction` remain.)
- `AppLifecycle` exposes eight `notifyApplication*` methods and eight matching `observe*` methods. (verification: `rg "notifyApplication" tugdeck/src/lib/app-lifecycle.ts` lists eight.)
- React integration exposes exactly two delegate hooks: `useCardDelegate(cardId, delegate)` and `useAppDelegate(delegate)`. (verification: `rg "export function useOn(Card|App)" tugdeck/src/lib` returns zero matches; the four `useOnCard*` hooks are gone.)

**Naming:**
- No `window.__tugdeckAppActivated` / `__tugdeckAppDeactivated`. (verification: `rg "__tugdeckApp" tugdeck/src tugapp/Sources` returns zero matches.)
- `window.__tugdeckSaveState` and `window.__tugdeckReconnect` are renamed to `window.tugdeck.saveState` and `window.tugdeck.reconnect`. (verification: `rg "__tugdeck" tugdeck/src tugapp/Sources` returns zero matches.)
- `lib/defer.ts` is deleted. (verification: the file does not exist; `rg "deferToNextMacrotask" tugdeck/src` returns zero matches.)

**Behavior — card transitions:**
- Clicking a card's title bar fires, in order: `cardAWillDeactivate` → `cardBWillActivate` → (store + responder updates) → `cardADidDeactivate` → `cardBDidActivate`. (verification: test in `card-lifecycle.test.tsx` that records a call log and asserts the exact sequence.)
- `cardDidFinishConstruction` fires exactly once per card, after the card is present in the deck store. (verification: existing test, renamed.)
- `cardWillBeginDestruction` fires exactly once per card, while the card is still present in the deck store. (verification: existing test, renamed.)

**Behavior — app transitions:**
- Each of the eight `NSApplicationDelegate` notifications produces the corresponding `[AppLifecycle]` log line. (verification: manual with Tug.app running — trigger Cmd-Tab, Cmd-H, unhide; read console.)
- `applicationWillResignActive` → cascades to `cardWillDeactivate` / `cardDidDeactivate` on the active card, if any. (verification: test against a mock NSApp notification path; manual with tide card.)
- `applicationDidBecomeActive` → cascades to `cardWillActivate` / `cardDidActivate` on the last-active card, if any. (verification: as above.)
- `applicationWillHide` — same deactivation cascade; idempotent with a preceding `applicationWillResignActive`. (verification: a test that fires both in sequence and asserts `cardWillDeactivate` / `cardDidDeactivate` run exactly once.)
- `applicationDidUnhide` — same reactivation cascade. (verification: test.)

**Test effect — tide card prompt focus:**
- Opening a tide card focuses the prompt editor (`cardDidFinishConstruction` → focus). (manual.)
- Clicking another card's title bar blurs the prompt editor of the leaving card and focuses the prompt editor of the entering card. (manual + test.)
- Ctrl-` cycling produces the same focus movement deterministically across 50 cycles. (manual.)
- Cmd-Tabbing away from Tug.app removes the caret blink on the prompt editor; Cmd-Tabbing back restores it without clicking. (manual.)
- Cmd-H hiding Tug.app and unhiding produces the same removal/restoration as Cmd-Tab. (manual.)
- The **random intermittent focus failure** the user reported on card creation does not recur across 50 consecutive new-card opens. (manual stress test.)

**Logging:**
- Every lifecycle-method delivery prints a single structured line prefixed `[CardLifecycle]` or `[AppLifecycle]`, with the method name and card id where applicable. (verification: manual grep of console during a scripted tide-card session.)

**Compliance:**
- `bun run check`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run` all green at every step.
- Tuglaws walkthrough (Step 12) records L02 / L03 / L06 / L07 / L22 conformance.

#### Scope {#scope}

**In scope:**
- Rename of `CardLifecycle` internal methods, observe APIs, and React hooks to `will`/`did` form.
- Collapse of the four `useOnCard*` hooks into `useCardDelegate`.
- Addition of `cardWillActivate` / `cardWillDeactivate` (construction and destruction keep single-phase names per the user's spec).
- New `AppLifecycle` class paralleling `CardLifecycle` with eight events.
- New `useAppDelegate(delegate)` hook.
- Swift `AppDelegate`: wire all eight `NSApplicationDelegate` methods (two exist, six are new).
- Bridge migration: replace `window.__tugdeckApp*` with a single `app-lifecycle` control frame and an action-dispatch handler.
- Rename `window.__tugdeckSaveState` / `__tugdeckReconnect` to `window.tugdeck.saveState` / `reconnect`.
- App → card cascade: resignActive/hide → deactivate; becomeActive/unhide → reactivate. Idempotent.
- Structured `[CardLifecycle]` / `[AppLifecycle]` console logging at every delivery.
- Tide-card integration: migrate `TideCardBody` from the two separate hooks to a single `useCardDelegate` call with `cardDidFinishConstruction` / `cardDidActivate` / `cardWillDeactivate` (to blur the prompt explicitly) implemented.
- Reliability design study (written analysis).
- Reliability mechanism implementation + deletion of `lib/defer.ts`.
- Tuglaws walkthrough.

**Out of scope (deferred):**
- Changing the `NSWindowDelegate` surface (window becomeKey / resignKey / miniaturize / deminiaturize). These are useful but orthogonal; they can land in a follow-up that uses the same delegate-object shape.
- Card *resize* and *move* delegate methods. These exist implicitly today via the deck manager's store; folding them into the delegate protocol is a later unification, not this plan.
- Routing keyboard events through delegate methods. Keybinding stays in the responder chain.
- Removing the synchronous `saveState` / `reconnect` paths themselves. Only their *names* change.
- Multi-window support. Current app has a single `MainWindow`; delegate methods are singular.

#### Resolved Decisions {#resolved-decisions}

- **D1 — Delegate-object form.** `useCardDelegate(cardId, delegate)` with an optional-methods protocol object. Rationale: decades of Apple-platform experience say this scales for sophisticated app development in ways per-event hooks do not. Confirmed by the user in plan-authoring conversation (2026-04-20).
- **D2 — Will/did coverage.** Construction gets one event (`cardDidFinishConstruction`). Destruction gets one event (`cardWillBeginDestruction`). Activation and deactivation get will/did pairs. Rationale: birth/death transitions don't usefully split into "will" and "did" in this system — the store is the single source of truth and the transition to/from existence is atomic. Activate/deactivate benefit from the split because delegates may want to prepare state (will) separately from reacting to the fact (did).
- **D3 — Ordering on card switch.** `cardAWillDeactivate → cardBWillActivate → (state transitions) → cardADidDeactivate → cardBDidActivate`. Rationale: fires all preparation callbacks before *any* state change, then the state change atomically, then all reaction callbacks. Confirmed by the user.
- **D4 — App → card cascade.** `applicationWillResignActive` and `applicationWillHide` each trigger `cardWillDeactivate`/`cardDidDeactivate` on the active card. `applicationDidBecomeActive` and `applicationDidUnhide` each trigger `cardWillActivate`/`cardDidActivate` on the last-active card. The cascade is idempotent — a second trigger (e.g., hide after resign) is a no-op because the active card is already in the deactivated-by-app state. Confirmed by the user.
- **D5 — Wire format.** App lifecycle events ride on the existing control-frame plumbing as `app-lifecycle` with an `event` param. Rationale: no new double-underscore globals, unified logging, reconnect-robust, single handler in `action-dispatch.ts`. `saveState` / `reconnect` stay as `evaluateJavaScript` entry points (they are Swift-initiated synchronous round-trips where the control-frame path is wrong), but rename under a `window.tugdeck` namespace. Proposed by Claude in plan-authoring; the user requested a proposal to evaluate.
- **D6 — Logging format.** `console.log("[CardLifecycle] cardDidActivate id=" + cardId)` / `console.log("[AppLifecycle] applicationWillResignActive")`. No ring buffer, no structured logger, no Swift coupling. Plain console prefix so it's greppable and cheap to delete in bulk. Confirmed by the user.
- **D7 — Reliability mechanism: study first, implement later.** The current `setState → useEffect` deferral pattern is accepted as a *holding* mechanism for Steps 1–9 but is not the final answer. Step 10 researches and proposes a replacement; Step 11 implements it and deletes `lib/defer.ts`. The user is "greatly dissatisfied" with the current options and wants "big-time research on the web to find the best means to achieve the reliability I'm looking for." Confirmed by the user.
- **D8 — Cascade lives in `lib/lifecycle-cascade.ts`.** Rather than nesting cascade logic inside `DeckManager`, a tiny dedicated module imports both `CardLifecycle` and `AppLifecycle` and wires observer callbacks between them. The module is constructed and installed from `DeckManager` once both lifecycles exist. Rationale: one true place to read the cascade rules, no circular-import risk because the cascade module imports both (not the reverse), and room for the logic to grow without reshuffling `DeckManager`. Confirmed by the user.
- **D9 — `selectionGuard` migrates to the delegate protocol; the `deactivateApp` / `activateApp` imperative entry points are retired.** Rationale: the delegate is the one true path for these lifecycle events. No alternative invocation routes. Confirmed by the user.
- **D10 — Trust AppKit's will/did pairing.** `applicationWillResignActive` is always followed by `applicationDidResignActive`; `applicationWillHide` is always followed by `applicationDidHide`; etc. No cancel path, no undo logic in the cascade. Confirmed by the user.

---

### Steps {#steps}

Each step is its own commit. `bun run check`, `bun test`, `bun run audit:tokens lint`, and `cargo nextest run` pass at the end of every step. Step 10 is the deliberate exception — it is a design-study commit that produces an in-tree document, no runtime code changes.

#### Step 1 — Rename `CardLifecycle` methods and hooks to will/did form {#step-1}

**Files:**
- `tugdeck/src/lib/card-lifecycle.ts`
- `tugdeck/src/deck-manager.ts`
- `tugdeck/src/deck-manager-store.ts`
- `tugdeck/src/components/tugways/cards/tide-card.tsx`
- `tugdeck/src/components/tugways/selection-guard.ts`
- `tugdeck/src/components/tugways/responder-chain-provider.tsx`
- `tugdeck/src/components/chrome/deck-canvas.tsx`
- `tugdeck/src/__tests__/card-lifecycle.test.tsx`
- `tugdeck/src/__tests__/mock-deck-manager-store.ts`
- Any other test referring to the old names.

**Work:**
- Rename the `CardLifecycle` class's internal `notify*` methods and public `observeCard*` methods:
  - `notifyConstruction` → `notifyCardDidFinishConstruction`
  - `notifyDestruction` → `notifyCardWillBeginDestruction`
  - `notifyDeactivation` → `notifyCardDidDeactivate`
  - `notifyActivation` → `notifyCardDidActivate`
  - `observeCardConstruction` → `observeCardDidFinishConstruction`
  - `observeCardActivation` → `observeCardDidActivate`
  - `observeCardDeactivation` → `observeCardDidDeactivate`
  - `observeCardDestruction` → `observeCardWillBeginDestruction`
- Rename the four React hooks:
  - `useOnCardConstruction` → `useOnCardDidFinishConstruction`
  - `useOnCardActivation` → `useOnCardDidActivate`
  - `useOnCardDeactivation` → `useOnCardDidDeactivate`
  - `useOnCardDestruction` → `useOnCardWillBeginDestruction`
- Update `DeckManager` pass-throughs and `IDeckManagerStore` interface method names to match.
- Update every call site in production code and tests.
- No behavior changes. No new events. The will/did variants for activate/deactivate come in Step 3.

**Verification:**
- `bun x tsc --noEmit` clean.
- `bun test` green — test names may change but assertions stay equivalent.
- `rg "observeCardActivation|observeCardDeactivation|observeCardConstruction|observeCardDestruction" tugdeck/src` returns zero matches.
- `rg "useOnCardActivation|useOnCardDeactivation|useOnCardConstruction|useOnCardDestruction" tugdeck/src` returns zero matches.
- Manual: tide card still focuses prompt on open; still activates on click; still deactivates on close.

#### Step 2 — Collapse four hooks into one `useCardDelegate` {#step-2}

**Files:**
- `tugdeck/src/lib/card-lifecycle.ts`
- `tugdeck/src/components/tugways/cards/tide-card.tsx`
- Every other card body using a lifecycle hook (currently only tide card, per `rg "useOnCard" tugdeck/src/components`).
- `tugdeck/src/__tests__/card-lifecycle.test.tsx`

**Work:**
- Define and export:
  ```ts
  export interface TugCardDelegate {
    cardDidFinishConstruction?(cardId: string): void;
    cardWillActivate?(cardId: string): void;       // added in Step 3
    cardDidActivate?(cardId: string): void;
    cardWillDeactivate?(cardId: string): void;     // added in Step 3
    cardDidDeactivate?(cardId: string): void;
    cardWillBeginDestruction?(cardId: string): void;
  }
  ```
  The two `will` variants land as fields on the interface now but are not wired to any notify source yet — Step 3 wires them.
- Export a single hook:
  ```ts
  export function useCardDelegate(cardId: string, delegate: TugCardDelegate): void;
  ```
  Implementation: internally, the hook installs one subscription per provided method against the appropriate observer, using the same `setState → useEffect` deferral pattern currently used by the four `useOnCard*` hooks. A `delegateRef` holds the delegate object so inline literals don't re-install subscriptions on every render. Only the methods defined on the delegate subscribe; missing methods are no-ops.
- Delete the four `useOnCard*` hooks. There are no stragglers.
- Migrate `TideCardBody`:
  ```tsx
  useCardDelegate(cardId, {
    cardDidFinishConstruction: () => entryDelegateRef.current?.focus(),
    cardDidActivate: () => entryDelegateRef.current?.focus(),
  });
  ```

**Verification:**
- `rg "export function useOnCard" tugdeck/src` returns zero matches.
- `rg "useCardDelegate" tugdeck/src` shows the new hook and its callers.
- `bun test` green.
- Manual: unchanged tide card behavior.

#### Step 3 — Add `cardWillActivate` and `cardWillDeactivate` and wire the ordered cascade {#step-3}

**Files:**
- `tugdeck/src/lib/card-lifecycle.ts`
- `tugdeck/src/__tests__/card-lifecycle.test.tsx`

**Work:**
- Add two new notify methods on `CardLifecycle`: `notifyCardWillActivate(cardId)` and `notifyCardWillDeactivate(cardId)`, each with a matching `observeCardWillActivate` / `observeCardWillDeactivate` API and a corresponding subscriber set.
- Reshape `activateCard(cardId)` to fire the four methods in D3 order:
  ```
  (a) notifyCardWillDeactivate(wasActive)    // if any
  (b) notifyCardWillActivate(cardId)          // always (no-op if same card)
  (c) store.focusCard(cardId); manager.makeFirstResponder(cardId) if differs
  (d) notifyCardDidDeactivate(wasActive)     // if any
  (e) notifyCardDidActivate(cardId)           // always
  ```
  Same-card re-activation: skip all will/did fires (silent no-op).
- `removeCard` / destruction path: fire `cardWillDeactivate` / `cardDidDeactivate` before `cardWillBeginDestruction` when the card was active. Order on destroy-of-active:
  ```
  notifyCardWillDeactivate(cardId)
  notifyCardDidDeactivate(cardId)
  notifyCardWillBeginDestruction(cardId)
  store removes card
  ```
- Extend the `TugCardDelegate` interface wiring: the two new methods subscribe via `useCardDelegate`.

**Verification:**
- `bun test` includes a new test that records a call log across two cards A, B and asserts the exact sequence on click-switch.
- Manual: tide card still focuses on activate; clicking another card still moves focus; the call log prefixed `[CardLifecycle]` (once Step 9 adds logs) shows the 4-phase sequence.

#### Step 4 — Introduce `AppLifecycle` class and `useAppDelegate` hook (no wiring yet) {#step-4}

**Files (new):**
- `tugdeck/src/lib/app-lifecycle.ts`
- `tugdeck/src/__tests__/app-lifecycle.test.tsx`

**Files (edited):**
- `tugdeck/src/deck-manager.ts` (construct and expose the `AppLifecycle` instance alongside `CardLifecycle`)

**Work:**
- Author `AppLifecycle` in the same shape as `CardLifecycle`: eight `notifyApplication*` methods, eight `observe*` methods, singleton-register pattern (`registerAppLifecycle` / `getAppLifecycle`) paralleling the card counterpart, and a React context (`AppLifecycleContext`).
- Define and export:
  ```ts
  export interface TugAppDelegate {
    applicationWillBecomeActive?(): void;
    applicationDidBecomeActive?(): void;
    applicationWillResignActive?(): void;
    applicationDidResignActive?(): void;
    applicationWillHide?(): void;
    applicationDidHide?(): void;
    applicationWillUnhide?(): void;
    applicationDidUnhide?(): void;
  }

  export function useAppDelegate(delegate: TugAppDelegate): void;
  ```
- `useAppDelegate` uses the same `setState → useEffect` deferral pattern as `useCardDelegate` for consistency (Step 10/11 replaces both mechanisms at once).
- `DeckManager` constructs both lifecycles, wraps the tree with both context providers, and registers both singletons.
- No Swift wiring yet. No cascade yet. This step is pure shape.

**Verification:**
- `bun test` includes a unit test: `notifyApplicationDidBecomeActive()` drives registered observers, `useAppDelegate({ applicationDidBecomeActive })` fires its method.
- `rg "notifyApplication" tugdeck/src/lib/app-lifecycle.ts` lists all eight.
- No behavior change in running app.

#### Step 5 — Replace `window.__tugdeckAppActivated` / `__tugdeckAppDeactivated` with control-frame `app-lifecycle` {#step-5}

**Files:**
- `tugapp/Sources/AppDelegate.swift` (the two existing delegate methods)
- `tugdeck/src/action-dispatch.ts` (add `app-lifecycle` control action)
- `tugdeck/src/main.tsx` (delete the two `window.__tugdeckApp*` globals; leave `__tugdeckSaveState` and `__tugdeckReconnect` alone for now — Step 8 handles them)
- `tugdeck/src/components/tugways/selection-guard.ts` (replace direct calls from window globals with a delegate registration on `AppLifecycle`)

**Work:**
- Swift: change `applicationDidResignActive` to call `processManager.sendControl("app-lifecycle", ["event": "didResignActive"])`. Same for `applicationDidBecomeActive` with `"didBecomeActive"`.
- JS: `action-dispatch.ts` handles `app-lifecycle` frames by reading `params.event` and calling the appropriate `notifyApplication*` method on the registered `AppLifecycle` singleton.
- Delete `(window as ...).__tugdeckAppDeactivated` and `.__tugdeckAppActivated` from `main.tsx`.
- `selectionGuard` migrates fully to the delegate (per D9): remove the imperative `deactivateApp()` / `activateApp()` public methods. The logic that lived in those methods moves inline into `applicationDidResignActive` / `applicationDidBecomeActive` handlers that `selectionGuard.attach(appLifecycle)` registers via `observeApplicationDidResignActive` / `observeApplicationDidBecomeActive` in its setup path. The guard holds its subscription-disposers and releases them on teardown.

**Verification:**
- `rg "__tugdeckApp" tugdeck/src tugapp/Sources` returns zero matches.
- Manual: Cmd-Tab away and back; selection dims and restores (existing behavior unchanged); console logs the control-frame round-trip.
- `bun test` + existing selection-guard tests green.

#### Step 6 — Add the six new `NSApplicationDelegate` methods and wire all eight to control frames {#step-6}

**Files:**
- `tugapp/Sources/AppDelegate.swift`

**Work:**
- Implement:
  ```swift
  func applicationWillBecomeActive(_ notification: Notification)
  func applicationWillResignActive(_ notification: Notification)   // already ? no — only Did today
  func applicationWillHide(_ notification: Notification)
  func applicationDidHide(_ notification: Notification)
  func applicationWillUnhide(_ notification: Notification)
  func applicationDidUnhide(_ notification: Notification)
  ```
  — each sends `processManager.sendControl("app-lifecycle", ["event": "<name>"])` with the appropriate event string.
- Ensure `applicationWillResignActive` is added (AppKit calls it even though we didn't have an impl; we need it to send the will frame before the did frame).
- Keep existing `applicationDidBecomeActive` and `applicationDidResignActive` sending their respective did frames.
- No JS changes — the `action-dispatch.ts` handler from Step 5 already routes by event name; the `AppLifecycle` already exposes all eight notify methods from Step 4.
- Add an NSLog at the top of each delegate method: `NSLog("AppDelegate: <name>")`. Matches the existing NSLog style in that file.

**Verification:**
- Launch Tug.app. Cmd-Tab away; Cmd-H; unhide via menu/Dock; Cmd-Tab back. Console shows eight distinct `[AppLifecycle]` lines (once Step 9 adds JS-side logs) and eight NSLog lines.
- Manual: app still backgrounds/foregrounds/hides/unhides normally; selection still dims and restores (existing behavior preserved via the `didResignActive` / `didBecomeActive` path).

#### Step 7 — App → card cascade, idempotent (new `lib/lifecycle-cascade.ts`) {#step-7}

**Files (new):**
- `tugdeck/src/lib/lifecycle-cascade.ts`
- `tugdeck/src/__tests__/lifecycle-cascade.test.ts`

**Files (edited):**
- `tugdeck/src/deck-manager.ts` (construct and install the cascade once both lifecycles exist)

**Work:**
- New module `lib/lifecycle-cascade.ts`:
  ```ts
  export interface LifecycleCascadeHandle {
    dispose(): void;
  }

  export function installLifecycleCascade(
    cardLifecycle: CardLifecycle,
    appLifecycle: AppLifecycle,
  ): LifecycleCascadeHandle;
  ```
  The module imports both lifecycle classes (one-way; neither lifecycle imports this module — no circular risk).
- Cascade rules the module wires:
  - On `applicationWillResignActive` or `applicationWillHide`: if an active card exists and is not already in the deactivated-by-app state, call `cardLifecycle.notifyCardWillDeactivate(activeId)` followed by `cardLifecycle.notifyCardDidDeactivate(activeId)`. Set an internal `deactivatedByAppCardId` field.
  - On `applicationDidBecomeActive` or `applicationDidUnhide`: if `deactivatedByAppCardId` is set, call `notifyCardWillActivate(id)` then `notifyCardDidActivate(id)`. Clear the field.
- Idempotency: the `deactivatedByAppCardId` field is the guard. `applicationWillResignActive` sets it; a subsequent `applicationWillHide` sees it already set and skips. Restoration on `DidBecomeActive`/`DidUnhide` is symmetric — first restore wins, subsequent is no-op. Per D10, no undo logic is needed on the `will` side — AppKit always pairs will/did.
- `DeckManager` calls `installLifecycleCascade(this.cardLifecycle, this.appLifecycle)` right after constructing both, stores the handle, and calls `handle.dispose()` in its own `destroy()` method.

**Verification:**
- New test: fire `notifyApplicationWillResignActive` then `notifyApplicationWillHide` in sequence; assert `cardWillDeactivate` and `cardDidDeactivate` fired exactly once each on the active card.
- New test: fire deactivate cascade then `notifyApplicationDidBecomeActive`; assert `cardWillActivate` / `cardDidActivate` fired on the right card.
- Manual with tide card: Cmd-Tab away blurs the prompt caret; Cmd-Tab back restores it without a click. Cmd-H hides the app; unhide restores focus. Cmd-H after Cmd-Tab produces no double-fire (verified via log).

#### Step 8 — Rename `window.__tugdeck{SaveState,Reconnect}` onto `window.tugdeck` namespace {#step-8}

**Files:**
- `tugapp/Sources/AppDelegate.swift` (the two `evaluateJavaScript` sites in `applicationShouldTerminate` and the tugcast-restart branch)
- `tugapp/Sources/MainWindow.swift` (any additional call sites — grep)
- `tugdeck/src/main.tsx`
- `tugdeck/src/deck-manager.ts` (comment references)

**Work:**
- Replace the two window-global assignments in `main.tsx`:
  ```ts
  const tugdeckNamespace = { saveState: () => deck.saveAndFlushSync(), reconnect: () => connection.forceReconnect() };
  (window as unknown as Record<string, unknown>).tugdeck = tugdeckNamespace;
  ```
- Delete the two old `__tugdeckSaveState` / `__tugdeckReconnect` assignments.
- Update Swift `evaluateJavaScript` strings: `window.tugdeck?.saveState?.()` / `window.tugdeck?.reconnect?.()`.
- Update docstrings and code comments that reference the old names.

**Verification:**
- `rg "__tugdeck" tugdeck/src tugapp/Sources` returns zero matches.
- Manual: quit the app — state saves cleanly (the existing behavior was visible; no regression). Restart tugcast manually via the dev menu path; reconnect fires.

#### Step 9 — `[CardLifecycle]` / `[AppLifecycle]` structured console logging {#step-9}

**Files:**
- `tugdeck/src/lib/card-lifecycle.ts`
- `tugdeck/src/lib/app-lifecycle.ts`

**Work:**
- At the top of every `notify*` method in both lifecycles, emit one `console.log` line:
  ```ts
  // card side
  console.log(`[CardLifecycle] ${methodName} id=${cardId}`);
  // app side
  console.log(`[AppLifecycle] ${methodName}`);
  ```
- Also log at the cascade layer when a cascade fires: `console.log("[CardLifecycle] cascade from " + appEvent + " → cardWillDeactivate id=" + cardId)` etc.
- No throttling, no gating. Pure greppable console output.

**Verification:**
- Manual: open three cards, switch between them, Cmd-Tab away and back — console shows a full trace:
  ```
  [AppLifecycle] applicationWillResignActive
  [CardLifecycle] cascade → cardWillDeactivate id=abc
  [CardLifecycle] cardWillDeactivate id=abc
  [CardLifecycle] cardDidDeactivate id=abc
  [AppLifecycle] applicationDidResignActive
  ...
  ```
- Deleting the logs is `rg "\[CardLifecycle\]|\[AppLifecycle\]" tugdeck/src/lib` + a one-line regex delete when trust is established.

#### Step 10 — Reliability design study (no runtime code) {#step-10}

**Files (new):**
- `roadmap/lifecycle-delegate-reliability.md` (a standalone study document, paralleling the `transport-exploration.md` pattern)

**Work:**
- Written study investigating how to deliver delegate-method calls reliably and deterministically, escaping WebKit's gesture focus-lock without leaning on React's useEffect timing as a load-bearing mechanism. Topics to cover:
  - **The problem statement in full.** WebKit reverts programmatic focus moved during a pointer gesture if the gesture target used `preventDefault()` on `mousedown`. Microtasks don't help (same gesture context). `setTimeout(fn, 0)` works but is timing-based and non-deterministic. `useEffect` works because it runs post-paint, but that makes our lifecycle dependent on React's commit scheduling.
  - **Candidate mechanisms to investigate.**
    - `scheduler.yield()` (new primitive in Chromium-based browsers; check WebKit status)
    - `MessageChannel` + `postMessage(0)` (historically reliable macrotask boundary)
    - `queueMicrotask` (known to fail here; document why)
    - `requestAnimationFrame` then `queueMicrotask` (double-step)
    - A dedicated microtask-or-macrotask queue that the `CardLifecycle` drains explicitly off a well-defined boundary
    - Not deferring at all: deliver synchronously and have consumers handle the focus-refuse case themselves (shift the burden of gesture-awareness out of the lifecycle)
    - Bypassing `preventDefault` on the title bar so WebKit's focus lock never activates
  - **Web research.** WebKit bug tracker, HTML spec (the "update the rendering" event-loop step), browser-vendor docs on focus handling during pointer events, tuglaws compliance for each candidate.
  - **Tuglaws cross-check** for each candidate: L02 (useSyncExternalStore only for external state), L03 (useLayoutEffect for event-dependent registrations), L06 (appearance via CSS/DOM), L22 (store observers drive DOM).
  - **Known holes in the Step 1–3 `useCardDelegate` deferral** (carried into the study so the replacement mechanism is evaluated against them, not just the focus-lock problem). The study MUST either resolve each or document why each is acceptable under the chosen mechanism:
    - **H1 — Destruction never fires for the dying card's own delegate.** `notifyCardWillBeginDestruction` fires sync, but the React drain path (setState → useEffect) requires the component to remain mounted until the post-paint effect runs. The deck's `removeCard` fires destruction → updates `deckState` → React unmounts the card component → the queued `setSeq` is dropped before `useEffect` drains. Any delegate `cardWillBeginDestruction: () => { save state }` silently never runs on the dying card itself. Non-React wildcard subscribers (e.g., `selectionGuard`) still receive the event synchronously and are unaffected. The Step 1–3 docstring for `notifyCardWillBeginDestruction` says "subscribers can read state" — true for sync subscribers, partial lie for React delegates under the current mechanism.
    - **H2 — "Subscribers can read state" is conditional on the mechanism.** Any deferred delegate callback reads whatever state exists at drain time, not at fire time. For construction this is fine (store already updated). For destruction this fails (store has removed the card). The replacement mechanism should either deliver deferred callbacks while the card is still in the store, or explicitly commit to a semantics where destruction delegates run *synchronously* at fire time (different mechanism per event type, or a uniform sync-with-gesture-escape strategy).
    - **H3 — Delegate-method latency relative to DOM paint and user-visible effects.** Current pattern delays the delegate call until after paint. For focus-on-activate that's required (escape the gesture lock). For other delegate methods, post-paint timing may be unnecessary and may introduce a one-frame delay the user perceives. The study should decide whether the mechanism is uniform across all six events or event-specific.
  - **Adjacent coherence issue (not a reliability problem, but surfaced during the Step 3 audit and worth noting in the study's conclusions so it's not lost).**
    - **H4 — No next-card activation after `removeCard` of the active card.** The deck's `removeCard` fires `will-deactivate` / `did-deactivate` / `will-begin-destruction` for the closing card and filters the deck state, but does not call `activateCard` on whichever card is now top of the stack. The store's `getFocusedCardId()` returns the new top, but no `cardWillActivate` / `cardDidActivate` fires for it, and the responder chain is not promoted. Pre-existing behavior; becomes more visible under the delegate model. The study should note this as a **separate follow-up item** the reliability mechanism does not itself resolve — the fix is a deck-orchestration change (call `activateCard(nextId)` after the filter) rather than a scheduling change. A candidate step: a pre-Step 12 "deck orchestration follow-up" step that closes this.
    - **H5 — No `DeckManager.removeCard` → lifecycle-order test exists.** Step 3 tests the ordering at the `CardLifecycle` unit level; the orchestration at the `DeckManager` layer (will-deactivate → did-deactivate → will-begin-destruction → filter) is not directly pinned. Low priority; the study's verification section should either recommend adding this test or explicitly accept its absence.
  - **Additional holes surfaced during the Steps 4–9 audit** (not reliability problems, but adjacent coherence / hygiene items the study should mention so nothing is lost):
    - **H6 — `initActionDispatch`'s `applicationDidResignActive` subscription has no dispose counterpart.** The `observeApplicationDidResignActive(() => deckManager.saveAndFlush())` wire registered in `action-dispatch.ts` is install-only — no unsubscribe. Fine in production (init runs once per page load; process exit disposes everything), but uneven against the cascade pattern which *does* return a dispose handle. If HMR or tests ever drive init multiple times, the old subscription lives on an orphaned `AppLifecycle` instance. Garbage-collected, not leaked. Hygiene item — the study should either recommend returning a disposer + storing it for teardown, or explicitly accept the install-once model.
    - **H7 — No test for `DeckManager` → `installLifecycleCascade` → `dispose` path.** The cascade module is tested in isolation (10 tests in `lifecycle-cascade.test.ts`); the `DeckManager` install and destroy-time dispose is implicit. Similar class of gap to H5. Low priority; study should recommend a direct test or explicitly accept the gap.
    - **H8 — Reactivation of a card destroyed mid-cycle.** If the user closes the active card while the app is in background, then brings the app back, the cascade fires `notifyCardWillActivate(id)` / `notifyCardDidActivate(id)` for a card that no longer exists. No crash — specific-id subscribers are gone, wildcard subscribers get a dead id — but the `[CardLifecycle]` log shows an activation of a phantom card. A `cardLifecycle.hasConstructed(id)` guard before firing would close this. Study should note the rare path and decide whether to add the guard (cheap) or accept the phantom log lines (simpler).
    - **H9 — `applicationWillBecomeActive` may fire before tugcast/JS is up.** AppKit can dispatch this during initial launch before `applicationDidFinishLaunching` completes, and `sendControl` may drop frames when tugcast isn't listening. The JS never sees the early will-event. The first user-triggered `applicationDidBecomeActive` recovers state, so this is acceptable — but if a downstream use case ever depends on a reliable "fire once at app start" signal, this path isn't the way. Study should document the constraint so future callers don't build assumptions on top of it.
    - **H10 — Step 9 logs are always-on.** Every card switch, every app transition, and every cascade emits a `[CardLifecycle]` / `[AppLifecycle]` line to console. Acceptable during Steps 4–9 (explicit request for extensive logging during wiring). Study should decide: gate behind a dev flag, delete wholesale once trust is established, or leave them. Step 11 is the natural landing point for the decision.
    - **H11 — `window.tugdeck` is a cast, not a typed global.** `(window as unknown as Record<string, unknown>).tugdeck = {...}` works but means TypeScript can't catch typos if JS-side code ever reads from it. Only Swift reads today, so this is invisible. Tighten with a `declare global { interface Window { tugdeck?: {...} } }` block or accept the cast. Study should note the hygiene item.
  - **Proposal.** Pick one mechanism. Justify it in-document. Commit to it in Step 11. For H1–H3, state plainly how the mechanism handles each. For H4–H11, state the follow-up work (if any) plainly so nothing is lost.
- The study document is self-contained and readable without this plan's context — it captures the failure modes, the experiments considered, and the verdict.

**Verification:**
- `roadmap/lifecycle-delegate-reliability.md` exists.
- The proposal at the end of the document names a specific mechanism with a specific implementation sketch.
- Every hole H1–H11 is addressed in-document: either resolved by the chosen mechanism, documented as accepted, or flagged as a follow-up with a named next step.
- No runtime code changes in this step.

#### Step 11 — Adopt chosen reliability mechanism; delete `lib/defer.ts` {#step-11}

**Files:**
- `tugdeck/src/lib/card-lifecycle.ts` (replace the `setState → useEffect` deferral in `useCardDelegate`)
- `tugdeck/src/lib/app-lifecycle.ts` (same replacement in `useAppDelegate`)
- `tugdeck/src/lib/defer.ts` (delete)
- Any test fixture that imports `deferToNextMacrotask`.

**Work:**
- Implement the mechanism chosen in Step 10.
- Replace the internal deferral in `useCardDelegate` and `useAppDelegate` so both delegate hooks use the new mechanism.
- Delete `lib/defer.ts`.
- Re-run the stress tests from Step 3 and Step 7 (card-switch 50×, Cmd-Tab 50×, Cmd-H 10×) and record the observed failure rate (expect 0%).

**Verification:**
- `rg "deferToNextMacrotask|defer\.ts" tugdeck/src` returns zero matches.
- `bun test` green.
- Manual stress test (50 consecutive new-card opens) shows zero focus failures.

#### Step 12 — Tuglaws walkthrough and plan close {#step-12}

**Files:**
- `roadmap/tugplan-lifecycle-delegates.md` (add a Tuglaws Walkthrough section at the end; flip status to `complete`)

**Work:**
- Verify every delegate subscription installs in `useLayoutEffect` (L03).
- Verify no external-state value re-enters React via `useState` + manual sync (L02) — the delegate hooks use `setState` for scheduling, not for state representation.
- Verify focus ring / caret blink is CSS/DOM-driven, not React state (L06).
- Verify delegate callbacks read current state via refs, not closures (L07).
- Verify store observers drive DOM writes directly, not through React's render cycle (L22).
- Record the walkthrough in this plan file.

**Verification:**
- Walkthrough section in the plan file names each law and the code location that satisfies it.
- Full build matrix green: `bun run check`, `bun test`, `bun run audit:tokens lint`, `cargo nextest run`.

---

### Open Questions {#open-questions}

*(All plan-authoring open questions have been resolved — see D1–D10. This section is preserved for questions that surface during implementation.)*

---
