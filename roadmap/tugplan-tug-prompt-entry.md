<!-- tugplan-skeleton v2 -->

## T3.4.b — TugPromptEntry (composition component) {#tug-prompt-entry}

**Purpose:** Land `TugPromptEntry` in tugdeck — a compound composition component that stacks an existing `TugPromptInput` over a bottom toolbar (route indicator + submit/stop button), driven entirely by a `CodeSessionStore` snapshot. After this phase, `TugPromptEntry` is the single composition surface the Tide card (T3.4.c) drops into the bottom half of its split pane to turn a raw `CodeSessionStore` into a usable input surface with visible turn-state affordances.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-04-15 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

[T3.4.a](./tugplan-code-session-store.md) landed `CodeSessionStore` as a pure TypeScript L02 store owning Claude Code turn state — `idle → submitting → awaiting_first_token → streaming → tool_work → awaiting_approval → errored → idle` transitions, append-only transcript, in-flight streaming `PropertyStore` at `inflight.assistant` / `inflight.thinking` / `inflight.tools`, and the five-member `lastError.cause` union (closed out by [T3.4.a.1](./tide.md#t3-4-a-code-session-store)). The store exposes `send(text, atoms)`, `interrupt()`, `respondApproval(...)`, `respondQuestion(...)`, `dispose()`, and a `CodeSessionSnapshot` shaped for consumers. It is fully tested (101 store-level tests, 10 CONTROL-error tests) against the `v2.1.105/` golden catalog plus synthetic events. [P13](./tide.md#p13-spawn-cap) landed the supervisor-side spawn cap + rate limit as cheap insurance before real UI load arrives. The store is ready; there is nothing to render it.

What's still missing is the composition surface. Today, `tug-prompt-input` is a raw text editor with route-prefix detection and an imperative handle — it has no notion of turn state, no submit button of its own, no queue indicator, no interrupt affordance. A caller wanting to render "an entry box driven by a `CodeSessionStore`" has to hand-wire those concerns every time. T3.4.b fills that gap by shipping `TugPromptEntry` as a single compound component at `tugdeck/src/components/tugways/tug-prompt-entry.tsx` + `.css`, with its own `@tug-pairings` table, its own token scope `--tug7-*-prompt-entry-*`, and a thin props interface that takes the stores it needs and renders everything else from snapshot data. After this phase, [T3.4.c](./tide.md#t3-4-c-tide-card) can compose `TugPromptEntry` + `TugMarkdownView` inside a `TugSplitPane` and register the result as the Tide card — with no new state management, no new action handlers, and no conditional rendering paths the composition component does not already own.

There is one meaningful deviation from the T3.4.b description in [tide.md §T3.4.b](./tide.md#t3-4-b-prompt-entry). That section — citing [D-T3-04](./tide.md#d-t3-04) — states that the first consumer of `tug-prompt-entry` is the functional Tide card, not a gallery card, and explicitly prohibits adding a gallery card for the component. **D-T3-04 is hereby declared moot for this plan.** The stated rationale ("mock turn-state environment differs from live wire protocol — tests must match user reality") is fair for unit tests, but the mock `TugConnection` infrastructure already exists in `tugdeck/src/lib/code-session-store/testing/mock-feed-store.ts` (battle-tested across 111 T3.4.a tests and used exclusively to drive the store against **real** golden wire frames). Building a gallery card on top of that mock does not introduce a divergent environment — it reuses the same frame shapes the tests use. The absence of a gallery card, on the other hand, makes theme audits, visual regressions, and design iteration impossible without spinning up a full live session against a running tugcast + claude subprocess. The cost of building one card is an afternoon; the cost of *not* building one echoes through every visual tuning cycle from here through T3.4.d. T3.4.b ships **two** gallery cards:

1. **`gallery-prompt-entry.tsx`** — the component in its `idle` state with an empty `MockTugConnection`-backed `CodeSessionStore`. This is the pristine "rest state" card that theme audits (`audit:tokens lint`) and visual reviews compare across themes. No debug chrome.

2. **`gallery-prompt-entry-sandbox.tsx`** — an interactive playground that wraps the same component in a debug panel with buttons to fire mock `CODE_OUTPUT` / `SESSION_STATE` / `CONTROL` frames through the underlying `MockTugConnection`, walking the component through every phase the store can surface (submitting, awaiting_first_token, streaming, tool_work, awaiting_approval, errored, queue non-empty, etc.). This is where a component author verifies that the CSS selectors work for every `data-phase` + `data-empty` + `data-queued` combination before the Tide card lands.

The two-card split is deliberate: card 1 is the measurable artifact for theme audits, card 2 is the developer tool for verifying visual behavior. Conflating them would give the theme audit a card cluttered with debug buttons, and give the developer a view too minimal to diagnose issues. The plan treats card 2 as a dev-only sandbox that imports from `testing/mock-feed-store.ts` — a pragmatic tradeoff given that gallery code is already bundled only through a dev-surfaced card registry.

The forward-looking concern is T3.4.c. This plan deliberately over-specifies the component's props, delegate, and responder surface so T3.4.c is purely "construct the stores, mount the composition, add a split pane." Concretely: every service the component needs is a prop (not a context read, not a module singleton the component reaches for), every imperative method the Tide card will need for keyboard shortcuts goes on the delegate ref now (`focus()`, `setRoute(char)`, not "focus forwarded through the input's ref"), and the responder registration uses a card-supplied `id` prop so the Tide card owns chain identity. T3.4.c's work then reduces to composition, not interface re-discovery.

#### Strategy {#strategy}

- **Component is a compound composition per [L20]; no cross-token reach.** `TugPromptEntry` owns tokens under the `--tug7-*-prompt-entry-*` family for the chrome it renders directly (toolbar row, bottom-border divider, queue badge). The composed children — `TugPromptInput`, `TugChoiceGroup`, `TugPushButton` — keep their own `component` slot tokens. The entry's CSS never uses descendant selectors like `.tug-prompt-entry .tug-push-button::before` to reach into composed children; all visual variation comes from the entry's own root data attributes + `--tugx-prompt-entry-*` aliases defined in the entry's `body {}` block, resolving to base-tier `--tug7-*` tokens in one hop per [L17].
- **Snapshot drives visuals; no React state mirroring turn state.** The component subscribes to `codeSessionStore` via `useSyncExternalStore` exactly once. Every visual variation — submit vs. stop label, button role color, disabled state, queue badge visibility, errored ring — is driven by `data-*` attributes on the entry's root element, mapped to CSS selectors per [L15]. Snapshot `phase` → `data-phase`. Snapshot `canInterrupt` → derived `data-can-interrupt`. Snapshot `queuedSends > 0` → `data-queued` (presence, not numeric value). Snapshot `lastError !== null` → `data-errored`. The sole React state in the component is a single ref for the `TugPromptInput` delegate; there is no `useState` anywhere.
- **`data-empty` is the only DOM-observed derived state.** Input emptiness (`promptInputRef.current.isEmpty()`) is observed via a lightweight polling hook that runs once per input change callback, not via an imperative subscription on the editor. The hook writes `data-empty` to the entry root directly (per [L06]) and never enters React state. This keeps submit-disabled visuals crisp without threading a new editor-level event through the component boundary.
- **Submit label is data, not appearance.** Per [L06]'s "does any non-rendering consumer depend on this state?" test, the button label ("Send" vs. "Stop") is semantic — the user reads it to decide whether clicking will send a message or interrupt an ongoing turn. It is rendered as child content of `TugPushButton` directly from the snapshot: `{snap.canInterrupt ? "Stop" : "Send"}`. Attempts to drive the label from CSS `::before` content via the parent scope would violate [L20]'s no-descendant-restyling rule; the cleaner path is snapshot-driven child content, with CSS owning color, weight, and role styling via `data-can-interrupt`.
- **Route indicator bidirectionality goes through the responder chain.** Per [D-T3-01], the route indicator and the input are bidirectionally synced. Input → indicator fires via `TugPromptInput`'s existing `onRouteChange(route)` prop (callback-based since the input is an editor, not a chain-participant control), which writes the indicator's displayed value via a direct DOM ref (`data-route`) — no React state. Indicator → input goes through the responder chain: `TugChoiceGroup` already dispatches `TUG_ACTIONS.SELECT_VALUE` with a `senderId`; the entry registers as a responder for `select-value`, narrows on the route-indicator's `sender`, and calls a new imperative delegate method `setRoute(char)` on the prompt input. This keeps the control → responder direction chain-native.
- **Submit and interrupt flow through the chain too.** The submit button dispatches `TUG_ACTIONS.SUBMIT` via `useControlDispatch()`. The entry's responder handler inspects `snap.canInterrupt` and either calls `codeSessionStore.send(...)` or `codeSessionStore.interrupt()`. This means the Tide card (T3.4.c) can register a global keyboard shortcut (Cmd-Return) that dispatches `submit` to the first responder — and the same handler runs. No callback props; no parallel "click handler" vs. "keyboard handler" implementations.
- **New imperative method: `TugPromptInput.setRoute(char)`.** The existing input has `clear()`, `insertText(text)`, `focus()`, and `onRouteChange` but no external setter for the route. T3.4.b adds `setRoute(char): void` to `TugPromptInput`'s imperative handle; the implementation is `clear()` + `insertText(char)` so the existing route-detection path fires `onRouteChange(char)` as the side effect. This is a genuinely new input method (one line in `useImperativeHandle`), documented in the input's props JSDoc, unit-tested in its own vitest file before `TugPromptEntry` depends on it. No other changes to `tug-prompt-input`.
- **Two-card gallery + component tests.** The gallery cards establish visual ground truth; the component's own vitest suite (`__tests__/tug-prompt-entry.test.tsx`) asserts behavior — responder registration, action dispatch, snapshot→data-attribute mapping, delegate forwarding, queue badge presence. Visual regression is enforced by the theme audit (`bun run audit:tokens lint`) on the pristine card; behavior regression is enforced by vitest on the component. Tests do not render the sandbox card.
- **`/` dispatch hook is deferred.** [tide.md §T3.4.b](./tide.md#t3-4-b-prompt-entry) mentions a pre-submit interception for local `:`-surface commands (e.g., `:help`). T3.4.b ships the extension point as an optional `localCommandHandler?: (route, atoms) => boolean | Promise<boolean>` prop — when the handler returns `true`, submission is suppressed and the input is cleared. When the prop is absent or the handler returns `false`, submission proceeds normally. The local-command registry itself is T10's problem; this plan only wires the seam so T3.4.c doesn't need to retrofit it.
- **Warnings are errors on every step.** `bun run check` + `bun run test` + `bun run audit:tokens lint` all pass on every commit. No `any`, no `@ts-expect-error`, no descendant-selector reach-ins, no hardcoded colors, no new IndexedDB dependencies, no `react` imports that bypass `useSyncExternalStore` for store state.

#### Success Criteria (Measurable) {#success-criteria}

- `tugdeck/src/components/tugways/tug-prompt-entry.tsx` and `.css` exist and export `TugPromptEntry` + `TugPromptEntryProps` + a `TugPromptEntryDelegate` interface. (verification: files present; `tsc --noEmit` clean)
- Opening `gallery-prompt-entry` in the running tugdeck shows the component mounted with an empty `MockTugConnection`-backed `CodeSessionStore` in its `idle` state. Submit button shows "Send", disabled (input is empty), and no queue badge is visible. (verification: manual in dev build; also asserted in the component's vitest rendering test)
- Opening `gallery-prompt-entry-sandbox` in the running tugdeck shows the component plus a debug panel with buttons for `session_init`, `assistant_text (partial)`, `assistant_text (partial)`, `turn_complete(success)`, `turn_complete(error)`, `control_request_forward(approval)`, `control_request_forward(question)`, `session_state_errored`, `transport_close`. Clicking each button advances the underlying mock and the entry's visual state updates accordingly. (verification: manual in dev build)
- `bun run audit:tokens lint` exits 0. Every CSS rule setting `color` / `border-color` / `fill` without a same-rule `background-color` carries a `@tug-renders-on` annotation. (verification: lint in Step 7)
- `rg '@tug-pairings' tugdeck/src/components/tugways/tug-prompt-entry.css` returns a single match, and the block contains both the compact format and the expanded table per [component-authoring.md §@tug-pairings](../tuglaws/component-authoring.md). (verification: grep in Step 7)
- `rg 'useState\|useReducer' tugdeck/src/components/tugways/tug-prompt-entry.tsx` returns zero matches. (verification: grep in Step 7)
- `rg 'from "react"' tugdeck/src/components/tugways/tug-prompt-entry.tsx` returns a single import that does not include `useState` or `useReducer`. (verification: grep in Step 7)
- `rg '\.tug-prompt-entry \.tug-(prompt-input|choice-group|push-button)' tugdeck/src/components/tugways/tug-prompt-entry.css` returns zero matches — no descendant restyling of composed children per [L20]. (verification: grep in Step 7)
- Vitest `__tests__/tug-prompt-entry.test.tsx` asserts:
  - Renders with a mock `CodeSessionStore`; root element has `data-slot="tug-prompt-entry"` and `data-responder-id="<cardId>"`. (verification: test)
  - Snapshot `phase: "idle"` + empty input → `data-phase="idle"`, `data-empty="true"`, `data-can-interrupt="false"`, no `data-queued`. (verification: test)
  - Typing a character clears `data-empty`; the button's disabled state flips. (verification: test)
  - Typing ">" in an empty input triggers `onRouteChange(">")`; the route indicator's DOM `data-route` attribute reflects ">". (verification: test)
  - Dispatching `TUG_ACTIONS.SELECT_VALUE` with `sender === routeIndicatorSenderId` and `value: "$"` calls `TugPromptInput.setRoute("$")` on the delegate; the input's first character is the `$` route atom. (verification: test)
  - Dispatching `TUG_ACTIONS.SUBMIT` while `snap.canInterrupt === false` calls `codeSessionStore.send(text, atoms)`. (verification: test)
  - Dispatching `TUG_ACTIONS.SUBMIT` while `snap.canInterrupt === true` calls `codeSessionStore.interrupt()`. (verification: test)
  - Advancing the mock store into `phase: "submitting"` flips `data-phase` and `data-can-interrupt` without a React state update inside the component (asserted via a render-counter ref). (verification: test)
  - Advancing the store into `queuedSends: 2` adds `data-queued` to the root; advancing it back to 0 removes the attribute. (verification: test)
  - `localCommandHandler` returning `true` suppresses the `send()` call and clears the input; returning `false` falls through to `codeSessionStore.send(...)`. (verification: test)
- Vitest `__tests__/tug-prompt-input.test.tsx` (existing file, extended) asserts: `setRoute(">")` on an empty input produces a single `>` route atom at position 0; `setRoute("$")` on a non-empty input replaces the content with a single `$` route atom. (verification: test)
- `bun test` is green on every step commit and on the integration checkpoint. (verification: Step 7)

#### Scope {#scope}

**In scope:**
- `tugdeck/src/components/tugways/tug-prompt-entry.tsx` (new).
- `tugdeck/src/components/tugways/tug-prompt-entry.css` (new).
- `tugdeck/src/components/tugways/__tests__/tug-prompt-entry.test.tsx` (new).
- `tugdeck/src/components/tugways/tug-prompt-input.tsx` (edit: add `setRoute(char)` imperative method, one line in `useImperativeHandle` + JSDoc).
- `tugdeck/src/components/tugways/__tests__/tug-prompt-input.test.tsx` (edit: add `setRoute` unit tests).
- `tugdeck/src/components/tugways/cards/gallery-prompt-entry.tsx` (new): pristine showcase card.
- `tugdeck/src/components/tugways/cards/gallery-prompt-entry.css` (new): minimal card layout.
- `tugdeck/src/components/tugways/cards/gallery-prompt-entry-sandbox.tsx` (new): interactive driver card.
- `tugdeck/src/components/tugways/cards/gallery-prompt-entry-sandbox.css` (new): driver panel layout.
- `tugdeck/src/main.tsx` (edit: register both gallery cards alongside `gallery-prompt-input`).
- `tugdeck/src/components/tugways/action-vocabulary.ts` (edit if necessary: ensure `TUG_ACTIONS.SUBMIT` exists; if it does not, add it per [action-naming.md](../tuglaws/action-naming.md) with `phase: "discrete"` semantics).

**Shape:** ~600 lines across the component, CSS, and tests, plus ~400 lines across the two gallery cards (most of it sandbox driver UI).

#### Non-goals (Explicitly out of scope) {#non-goals}

- **Tide card registration.** T3.4.c is a separate phase. T3.4.b does not touch `tide-card.tsx`, `useTideCardServices`, card-service memoization, or split-pane persistence.
- **`SessionMetadataStore` rendering.** The component accepts a `sessionMetadataStore` prop for forward-compatibility with T3.4.c (which will surface model name, version, etc. near the entry), but T3.4.b does not render any of its fields. The prop is typed but unused in this phase; the sandbox card supplies a no-op instance.
- **`PromptHistoryStore` rendering.** Same as above: accepted as a prop, not consumed. T3.4.b's scope ends at "the input accepts text and emits it." History nav (up/down arrow recall) is an input-level concern that lives on `TugPromptInput`.
- **File completion / `@` trigger UI.** `fileCompletionProvider` is accepted as a prop and forwarded to `TugPromptInput`, which already knows what to do with it. No new completion logic lands in the entry.
- **Drop handler for `@`-atom drag and drop.** Same: `dropHandler` is forwarded to the input.
- **Local `:`-surface command registry.** The `localCommandHandler` prop is the seam; populating the registry is T10's work.
- **Approval / question UI.** Per [D-T3-08], approval and question prompts render inside the Tide card's output pane (as block-level content), not inside the entry. The entry's role is to flip its `data-phase` to `awaiting_approval` so the CSS can dim the input / disable the submit button while the user answers upstream.
- **`CodeSessionStore` constructor changes.** No edits to `tugdeck/src/lib/code-session-store.ts` or its sub-modules. The component consumes the existing snapshot surface unchanged.
- **Tide card keyboard shortcut (Cmd-K / Cmd-Return).** T3.4.c wires global shortcuts; T3.4.b only ensures the delegate exposes `focus()` and that submit is a chain action so shortcuts can dispatch it.
- **Multi-session UI.** The component is strictly 1:1 with a single `CodeSessionStore` per [D-T3-09]. Any multi-session concerns (tabs, switching, stacking) are a parent's problem.
- **Persistence.** The input already persists editing state via tugbank per [L23]. The entry adds no new persistence.
- **Theme authoring.** Token additions to `brio.css` / `harmony.css` are separate work. T3.4.b references tokens that must exist; if any `--tug7-*-prompt-entry-*` tokens do not yet resolve, a preparatory token-authoring commit lands ahead of the component commits, outside this plan's step count but inside this phase.

#### Dependencies / Prerequisites {#dependencies}

- [T3.4.a](./tugplan-code-session-store.md) — `CodeSessionStore` with its full snapshot surface. **Landed.**
- [T3.4.a.1](./tide.md#t3-4-a-code-session-store) — CONTROL error routing. **Landed.** (Not structurally required — T3.4.b reads `lastError.cause` for a visual ring but does not branch on the specific cause — but the fuller surface is nicer.)
- [P13](./tide.md#p13-spawn-cap) — Spawn cap + rate limit. **Landed.** (Not structurally required — T3.4.b is tugdeck-only — but cheap insurance before the gallery card makes real spawn requests.)
- `tugdeck/src/components/tugways/tug-prompt-input.tsx` — existing, with `clear()`, `insertText(text)`, `focus()`, `getText()`, `getAtoms()`, `isEmpty()`, and `routePrefixes` / `onRouteChange` props. Adding `setRoute(char)` is part of this plan.
- `tugdeck/src/components/tugways/tug-choice-group.tsx` — existing, already chain-native (`TUG_ACTIONS.SELECT_VALUE` dispatched via `useControlDispatch()` with a `senderId`).
- `tugdeck/src/components/tugways/tug-push-button.tsx` — existing, already chain-native (dispatches a prop-configured `action` via `useControlDispatch()`).
- `tugdeck/src/lib/code-session-store/testing/mock-feed-store.ts` — existing `MockTugConnection` helper. Used in the sandbox gallery card to drive phase transitions. This plan imports it directly from `testing/`; a future cleanup may promote it to a non-test path but that is not T3.4.b's concern.
- Responder chain infrastructure: `useResponder`, `useControlDispatch`, `useResponderForm`, `ResponderChainProvider`, `action-vocabulary.ts`. All existing.
- Token system: `--tug7-*-prompt-entry-*` tokens defined in `tugdeck/styles/themes/brio.css` + `harmony.css`. Authored in a preparatory commit if any are missing.

#### Constraints {#constraints}

- **No new persistence.** Per [D-T3-10] and [D-T3-11].
- **No IndexedDB.** Per [D-T3-10].
- **No React state for appearance.** Per [L06]. The sole React use in the component is `useSyncExternalStore(store.subscribe, store.getSnapshot)` (for data) and `useRef` (for the input delegate + responder id anchor). No `useState`, no `useReducer`, no `useEffect` mirroring store state into state.
- **No callback props for user interactions.** Per [L11] and [component-authoring.md §Emitting an action](../tuglaws/component-authoring.md#emitting-an-action-controls). The component does not expose `onSubmit` or `onInterrupt` — those actions go through the chain. The sole callback-shaped prop (`localCommandHandler`) is not a user interaction; it's a synchronous interception hook the Tide card provides, and its call site is *inside* the entry's `submit` responder handler (not emitted to a parent).
- **Composed children keep their own tokens.** Per [L20]. No descendant selectors reach into `TugPromptInput`, `TugChoiceGroup`, or `TugPushButton` CSS.
- **`data-slot="tug-prompt-entry"` on the root.** Per [component-authoring.md §Component](../tuglaws/component-authoring.md#component).
- **Responder `id` is stable across renders.** The card supplies `id` as a prop (typically `cardId`); the component passes it directly to `useResponder` without mutation.
- **First responder is chain-managed.** The component does not call `manager.makeFirstResponder(id)`. Per [component-authoring.md §No `makeFirstResponder` in component code](../tuglaws/component-authoring.md#no-makefirstresponder-in-component-code).
- **Warnings are errors.** `bun run check`, `bun run test`, and `bun run audit:tokens lint` all exit 0 on every committed step.

#### Assumptions {#assumptions}

- The existing `TugPromptInput` route-detection path is correct. Typing `">"` in an empty input fires `onRouteChange(">")` synchronously from the editor's input event handler. (Verified by reading `tug-prompt-input.tsx` in preparation for this plan.)
- `TugChoiceGroup`'s `useControlDispatch` call site can disambiguate by `senderId` — if two segmented controls coexist on a card, each gets a distinct opaque id. The entry hardcodes a stable id for its route indicator so the responder handler can narrow.
- `TUG_ACTIONS.SELECT_VALUE` and `TUG_ACTIONS.SUBMIT` exist in `action-vocabulary.ts` with `discrete` phase semantics. If `SUBMIT` is missing, it lands in a preparatory sub-step of this plan (Step 1).
- `TugPushButton`'s `action` prop wiring dispatches via `useControlDispatch()` with `sender` set to the button's own id. The entry's responder handler does not narrow on sender for submit — any `submit` dispatch routed to this responder is the submit button or a keyboard shortcut targeting this responder, and both mean the same thing.
- `MockTugConnection` in `testing/mock-feed-store.ts` can be imported from non-test code without breaking the build. (It is plain TypeScript, not test-framework-coupled.) If importing from `testing/` triggers a lint/bundler rule, a Step 5 promotion commit moves it to `tugdeck/src/lib/code-session-store/dev-mock.ts` as pure infrastructure — no test-only behavior.
- Theme tokens under `--tug7-*-prompt-entry-*` either exist or are authored in a preparatory commit (see §Non-goals).

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Where does `setRoute(char)` land in the input's imperative handle? (DECIDED) {#q01-set-route-landing}

**Question:** `TugPromptInput`'s `useImperativeHandle` currently exposes ~25 methods covering text engine operations (delete, undo, selection, paste, typeahead, etc.). Adding `setRoute(char)` introduces a new concept — "set the leading route atom" — that is conceptually above the text-engine layer. Does the method belong on the input's delegate, or on a separate delegate that only the entry owns?

**Resolution:** On the input's delegate. Rationale: route atoms are already a first-class concept inside `TugPromptInput` (see `routePrefixes` and `onRouteChange`), so a `setRoute` setter is a peer to the existing getter path, not a new layer. Landing it as an entry-only delegate method would mean `TugPromptEntry` holds a ref to the input, exposes a wrapper ref, and the Tide card has to thread two refs — double the API surface for zero semantic benefit. One method on one delegate. Implemented as `clear()` + `insertText(char)` so the route-detection path in the editor fires `onRouteChange(char)` as a side effect; no new state, no new branches in the editor's input-event handler.

#### [Q02] Does the submit button dispatch `TUG_ACTIONS.SUBMIT` or a new `TUG_ACTIONS.SUBMIT_PROMPT`? (DECIDED) {#q02-submit-action-name}

**Question:** The action vocabulary has existing conventions. A generic `submit` action could collide with form submissions elsewhere; a domain-specific `submit-prompt` is narrower but pollutes the action table with a special case.

**Resolution:** `TUG_ACTIONS.SUBMIT`. Rationale: the responder chain's walk already scopes handlers — `submit` dispatched while the first responder is a `TugPromptEntry` only ever lands on this entry's handler, regardless of other submit-shaped actions elsewhere in the app. Adding a domain-specific name would set a precedent for "dispatches named after the component that emits them," and the action vocabulary deliberately avoids that (see [action-naming.md §Action Names vs. Browser Command Names](../tuglaws/action-naming.md)). If `TUG_ACTIONS.SUBMIT` does not exist yet, it is added as part of Step 1 with the standard `phase: "discrete"` payload (no `value` required — the responder reads current state from the store snapshot).

#### [Q03] How does the sandbox card get frames into `MockTugConnection` reliably? (DECIDED) {#q03-sandbox-mock-driver}

**Question:** `MockTugConnection.dispatchDecoded(feedId, payload)` is the direct injection path used in tests. In a gallery card, we need a small driver surface with buttons like "advance to streaming" that synthesize the *sequence* of frames a real turn would produce. Do we re-implement per-step fixtures in the card, or reuse the golden fixtures?

**Resolution:** Re-implement a minimal synthetic-fixture helper inline in the sandbox card. Rationale: the golden fixtures under `tugrust/.../v2.1.105/` are static JSONL files loaded via a test helper (`loadGoldenProbe`) that is tests-only. Reaching for them from a gallery card would require bundling jsonl parsing and fixture loading into the production dev build, which is more machinery than the sandbox card justifies. Instead, the sandbox card defines ~10 small synthetic frame factories (e.g., `makeAssistantPartial(text, rev, seq)`, `makeTurnCompleteSuccess()`, `makeControlRequestForwardApproval(requestId, toolName)`) and the driver buttons call them in sequence. The reducer work already validates the fixture-backed reality in the test suite; the sandbox card's job is to exercise the *visual* contract against the *reducer*, not to re-validate the reducer.

#### [Q04] Does the responder handler read store state through a ref or directly off the snapshot closure? (DECIDED) {#q04-handler-state-access}

**Question:** Per [L07], action handlers registered via `useResponder` must read current state through refs, not stale closures — the hook registers once at mount. But `useSyncExternalStore` produces a `snap` variable that updates on every store change. If the handler closes over `snap`, it captures a stale value; if it reads through a ref, it captures the live value.

**Resolution:** Read through a ref. A `snapRef = useRef(snap)` is kept in sync via a `useLayoutEffect` that writes `snapRef.current = snap` on every render. The `submit` handler reads `snapRef.current.canInterrupt` at dispatch time. This matches the pattern documented in [component-authoring.md §Handlers read current state through refs](../tuglaws/component-authoring.md#handling-actions-responders) and in the `useResponder` JSDoc. No `useCallback` dance needed — the hook's proxy layer picks up identity changes, but closures over snapshot values don't work without the ref.

#### [Q05] What's the split between the pristine gallery card and the sandbox card? (DECIDED — captured in §Context) {#q05-gallery-split}

**Question:** One card or two? A single card with a collapsible debug panel would reduce file count; two cards would give the theme audit a clean target.

**Resolution:** Two cards, split in §Context above. Card 1 (`gallery-prompt-entry.tsx`) is the pristine showcase used by `audit:tokens lint` and visual regression. Card 2 (`gallery-prompt-entry-sandbox.tsx`) is the interactive driver with debug chrome. The separation is cheap — the sandbox card imports the pristine card's `buildMockServices()` helper and wraps it — and the benefit is that theme-level changes can be visually reviewed against a reproducible `idle`-state rendering without fighting debug-panel chrome.

---

### Risks and Mitigations {#risks}

- **Risk: descendant restyling creeps in during iteration.** The entry's CSS grows, and under deadline pressure someone writes `.tug-prompt-entry .tug-push-button { gap: 4px; }` to tune the internal layout of a composed child. This is an [L20] violation that audits may not catch until much later.

  **Mitigation:** The Step 7 lint check greps `.tug-prompt-entry .tug-(prompt-input|choice-group|push-button)` and fails the build on any match. The same grep goes into `#success-criteria` so regressions are caught at test time. Layout adjustments between composed children go on wrapper elements the entry owns (e.g., `.tug-prompt-entry-toolbar`), not on the children themselves.

- **Risk: `data-empty` polling is too aggressive and causes input-event thrash.** The component needs to know when the input is empty vs. non-empty to disable/enable the submit button, but the input's imperative handle exposes `isEmpty()` as a method, not an observable. Reading it on every keystroke in a React event handler is fine; reading it on a timer or on every React render is not.

  **Mitigation:** The entry passes a single `onInputChange` callback prop down to the input (added to `TugPromptInputProps` if not present — verify in Step 1). The callback fires once per user-driven input event; inside it, the entry reads `isEmpty()` from the delegate and writes the result to the root element's `data-empty` attribute via a direct DOM ref (per [L06]). No React state, no timers, no polling. If `TugPromptInput` does not already expose an `onInputChange` hook, Step 1 adds one with the same narrow contract — a single-argument callback invoked once per input event.

- **Risk: `setRoute(char)` on `TugPromptInput` duplicates existing internal state.** The imperative handle's `clear()` + `insertText(char)` path works, but if the editor's text-engine has separate internal state tracking "what the current route is" versus "what's in the text," the `clear()` half may not reset the internal tracker, leading to a stale `currentRoute` state on the next input event.

  **Mitigation:** Step 1 lands the `setRoute` method and unit tests it against the exact sequence the integration path will use: `clear()` + `insertText("$")` + subsequent `onRouteChange` invocation. If the editor's internal route state is stale after this sequence, the unit test fails and Step 1's scope expands to fix the editor before `TugPromptEntry` depends on it. No integration work happens on top of an unverified foundation.

- **Risk: responder id collisions between the component-hosted `TugPromptEntry` responder and the Tide card responder.** T3.4.c plans to register the Tide card itself as a responder (for `close`, `previous-tab`, `next-tab`). If both the card and the entry register under the same id — or if the entry's responder parents the card's — actions walk in the wrong direction.

  **Mitigation:** The entry takes `id` as a required prop. The Tide card supplies an id derived from its `cardId` with a `-entry` suffix (`tide-card-<uuid>-entry`). The Tide card's own responder uses the bare `cardId`. The entry's `parentId` comes from `ResponderParentContext`, which resolves to the Tide card's responder id, so the walk goes entry → card → canvas, matching the visual hierarchy. Step 6's integration test in the sandbox card verifies the walk order by dispatching `close` from inside the entry and asserting the card's handler runs, not the entry's.

- **Risk: the sandbox card's import from `testing/` breaks a bundler rule.** If `tsconfig.json` or an ESLint rule forbids non-test imports from `**/testing/**`, the sandbox card fails to build.

  **Mitigation:** Step 5 verifies the import works before writing driver code. If it is blocked, Step 5 promotes `MockTugConnection` from `testing/mock-feed-store.ts` to `tugdeck/src/lib/code-session-store/dev-mock.ts` as a one-line re-export. No behavioral change; the promotion is mechanical.

- **Risk: the `@tug-pairings` table is incomplete because the entry's chrome is minimal.** A compound composition with mostly borrowed visuals may register only one or two pairings of its own, and `audit:tokens lint` could flag the file as under-annotated.

  **Mitigation:** The entry will have at least three pairings: the toolbar row background against the queue badge foreground, the separator divider against its surface, and the "errored" ring color against the entry's own surface. If fewer pairings land, the `@tug-pairings: none — compositional, children own pairings` annotation is used per the component authoring guide. Either is valid; the CSS-file-opens-with-a-`@tug-pairings`-block invariant is what the audit enforces.

---

### Design Decisions {#design-decisions}

#### [D01] `TugPromptEntry` is a compound composition, not a cosmetic wrapper (DECIDED) {#d01-compound-composition}

**Decision:** The component is a full compound composition per [component-authoring.md §Compound Composition](../tuglaws/component-authoring.md#compound-composition), with its own visual identity (toolbar chrome, queue badge, layout tokens) and composed children (`TugPromptInput`, `TugChoiceGroup`, `TugPushButton`). It is not a compositional wrapper (no-CSS convenience like `TugPopupButton`).

**Rationale:** The entry renders a toolbar row with its own spacing, divider, and badge — visual elements not owned by any of the three composed children. It needs its own `.css` file, its own `@tug-pairings` table, and its own token scope under `--tug7-*-prompt-entry-*`. Treating it as a no-CSS wrapper would push toolbar styling into the children (violating [L20]) or into the Tide card's CSS (violating layer separation). Compound composition is the correct pattern.

#### [D02] Snapshot drives `data-*` attributes; no prop mirror (DECIDED) {#d02-data-attributes-from-snapshot}

**Decision:** The component reads `codeSessionStore` via one `useSyncExternalStore` call and writes every derived visual state to `data-*` attributes on the root element in-render. No `useEffect` mirroring snapshot values into `data-*` after commit. No React state tracking a "displayed phase" separate from the snapshot's phase.

**Rationale:** The simpler path is the correct path. React sees the snapshot through the external store hook; the attributes are part of the JSX render; the renderer sets them on commit. An `useEffect` mirror would double the update paths (render-time attribute set vs. effect-time attribute set), add a frame of lag, and break the single-source-of-truth invariant. The external store hook already provides the synchronization guarantee `useSyncExternalStore` was designed for.

#### [D03] Submit label is child content, not `::before` (DECIDED) {#d03-submit-label-as-children}

**Decision:** The submit button's label ("Send" vs. "Stop") is rendered as child content: `<TugPushButton ...>{snap.canInterrupt ? "Stop" : "Send"}</TugPushButton>`. Not as CSS `::before` content pulled from a token.

**Rationale:** [tide.md §T3.4.b](./tide.md#t3-4-b-prompt-entry) originally suggested token-driven labels via `::before` content. Implementing that requires the entry's CSS to reach into `TugPushButton` with a descendant selector (`.tug-prompt-entry .tug-push-button::before { content: var(...) }`), which is exactly the [L20] violation this plan is most concerned with. Meanwhile, per [L06]'s "does any non-rendering consumer depend on this state?" test, the label *is* semantic data — the user reads "Send" to know clicking will submit and "Stop" to know clicking will interrupt. Data belongs in React's render cycle. Rendering the label as child content is cleaner, [L20]-compliant, and semantically honest.

#### [D04] Route indicator control → entry responder via chain dispatch (DECIDED) {#d04-route-via-chain}

**Decision:** `TugChoiceGroup` dispatches `TUG_ACTIONS.SELECT_VALUE` through the responder chain (as it already does). `TugPromptEntry` registers a `select-value` handler that narrows on the route indicator's `senderId` and calls `TugPromptInput.setRoute(char)` on the delegate.

**Rationale:** The alternative — a callback prop on `TugChoiceGroup` — would be a direct [L11] violation. The route indicator is a control; its state (the currently-selected route) lives in `TugPromptInput`, not in the indicator itself. The indicator's job is to emit the intent; the entry's job is to translate that intent into a delegate call on the state owner. The chain is the correct translation layer.

#### [D05] Submit/interrupt unified under `TUG_ACTIONS.SUBMIT` with snapshot-driven dispatch (DECIDED) {#d05-submit-interrupt-unified}

**Decision:** The submit button dispatches `TUG_ACTIONS.SUBMIT` regardless of turn phase. The entry's `submit` handler inspects `snapRef.current.canInterrupt` and either calls `codeSessionStore.send(...)` or `codeSessionStore.interrupt()` based on the snapshot. There is no separate `TUG_ACTIONS.INTERRUPT` emitted from the button.

**Rationale:** Per [D-T3-06], "submit IS the interrupt button." A user pressing the same key or clicking the same location always does the same *action* ("submit my intent"); what that intent means depends on whether a turn is active. The chain should see one action. Splitting it into two action names would force the button to read `snap.canInterrupt` before dispatch (button → store coupling) or force callers to register two handlers (handler fragmentation). One action name, one handler, one snapshot read at dispatch time — consistent with the chain's "handlers read state through refs" pattern.

#### [D06] `localCommandHandler` is an optional synchronous interceptor (DECIDED) {#d06-local-command-hook}

**Decision:** The entry's submit handler, before calling `codeSessionStore.send(...)`, invokes `localCommandHandler?.(route, atoms)` (synchronous signature: `boolean`). Returning `true` means "handled locally, do not send." Returning `false` (or undefined because the prop was omitted) means "send normally." The entry clears the input on either path.

**Rationale:** [tide.md §T3.4.b](./tide.md#t3-4-b-prompt-entry) anticipates a surface built-in registry (`:help`, etc.) that will live in T10. T3.4.b does not build the registry but must leave a seam so T3.4.c does not need to retrofit one later. A single optional prop satisfies that requirement; the prop is synchronous (not async) because local commands are local — any async work they dispatch is their own problem, not the entry's. The default behavior with the prop absent is "send every submission," which is the only defensible pre-T10 semantics.

#### [D07] Two gallery cards, not one (DECIDED — see §Context and [Q05]) {#d07-two-gallery-cards}

#### [D08] `MockTugConnection` imported directly from `testing/` (DECIDED) {#d08-mock-from-testing}

**Decision:** The sandbox gallery card imports `MockTugConnection` directly from `tugdeck/src/lib/code-session-store/testing/mock-feed-store.ts`. No promotion, no re-export, no wrapper.

**Rationale:** `MockTugConnection` is pure TypeScript with no test-framework coupling (it does not import `bun:test`, `jest`, or `vitest`). Importing it from gallery code works as a TypeScript import unless a bundler or lint rule forbids `testing/` paths — in which case Step 5 has a documented mitigation (promotion to `dev-mock.ts`). The cost of pre-promoting is a second file + a commit; the cost of not pre-promoting is zero unless the rule bites. Defer the work until needed. The same tradeoff shows up in `#risks`.

#### [D09] Responder id comes from the parent card, passed as a prop (DECIDED) {#d09-responder-id-from-parent}

**Decision:** `TugPromptEntryProps.id` is required. The entry passes it directly to `useResponder({ id: props.id, actions: { ... } })`. Gallery cards synthesize a stable id at module load time (e.g., `gallery-prompt-entry-main`); the Tide card will supply `${cardId}-entry`.

**Rationale:** Chain-participant components need a stable id across renders. The only sources for a stable id are (a) a domain identifier from above (card id, session id) or (b) a `useId()` call. Using `useId()` here would mean the id changes if the component is remounted, which breaks observer-dispatch patterns where external code references the id. Requiring the id as a prop pushes identity management to the caller, which is where it belongs — the component should not invent an identity for itself.

#### [D10] The entry does NOT register `cut` / `copy` / `paste` / `select-all` (DECIDED) {#d10-entry-no-editing-actions}

**Decision:** Standard editing actions live on `TugPromptInput`'s responder registration (inherited from its existing chain integration as a text-engine component). The entry does not re-register them. The walk routes editing actions past the entry because the entry's `actions` map does not contain those keys.

**Rationale:** Per the responder chain's innermost-first walk, the first responder (the text editor, inside `TugPromptInput`) is the deepest node with a `cut` handler. The walk finds it and stops. The entry does not need to forward editing actions to the input; the chain does that for free. Adding them to the entry's `actions` map would either shadow the input's handlers (breaking clipboard semantics) or be a dead-code dead-weight duplication. The minimum action set for the entry is exactly what it owns: `select-value` (for the route indicator) and `submit` (for the submit/interrupt button).

---

### Deep Dives {#deep-dives}

#### Responder wiring walkthrough {#responder-wiring}

The entry participates in the responder chain as a **responder** (for `select-value` from its route indicator and `submit` from its submit button) and **not as a control** — the entry itself does not emit actions; its children do. The walk for the three action categories the entry cares about goes like this:

**1. Route selection via click on the indicator.**

```
user clicks "$" segment in TugChoiceGroup
      ↓
TugChoiceGroup.useControlDispatch({
  action: SELECT_VALUE, sender: "route-indicator-...", value: "$", phase: "discrete"
})
      ↓
Chain targets the parent responder (TugPromptEntry) directly (not a first-responder walk)
      ↓
TugPromptEntry.actions[SELECT_VALUE] runs
      ↓
Handler narrows: event.sender === routeIndicatorSenderId ? handle : noop
      ↓
promptInputRef.current.setRoute("$")
      ↓
TugPromptInput's imperative handle calls clear() + insertText("$")
      ↓
Editor's input-event handler detects "$" as a route prefix, fires onRouteChange("$")
      ↓
Entry's onRouteChange writes data-route="$" to the indicator's DOM element (direct ref, no React state)
```

Note the critical point: the indicator's displayed state updates via DOM, not via React state. The `useControlDispatch` call does a *targeted dispatch* to the parent responder, bypassing the first-responder walk entirely — that is the contract of `useControlDispatch` per [responder-chain.md § Dispatching from a control](../tuglaws/responder-chain.md#dispatching-from-a-control).

**2. Text-prefix route detection.**

```
user types ">" in an empty input
      ↓
TugPromptInput's input-event handler fires
      ↓
Editor detects ">" is a route prefix (routePrefixes={[">", "$", ":"]})
      ↓
Editor converts the character to a route atom, emits onRouteChange(">")
      ↓
Entry's onRouteChange(">") callback (passed as a prop) writes data-route=">" to the indicator's DOM element
```

This path is callback-driven because the *input* is not emitting an action at the user gesture — it is reacting to its own internal state change. The input is not a chain-participant for route changes; it is a state owner that publishes a derived event. The entry subscribes and forwards to the DOM.

**3. Submit / interrupt via button click.**

```
user clicks submit button
      ↓
TugPushButton.useControlDispatch({ action: SUBMIT, phase: "discrete" })
      ↓
Chain targets the parent responder (TugPromptEntry) directly
      ↓
TugPromptEntry.actions[SUBMIT] runs
      ↓
Handler reads snapRef.current.canInterrupt (live value via ref per L07)
      ↓
  canInterrupt === false:
    atoms = promptInputRef.current.getAtoms()
    text = promptInputRef.current.getText()
    handled = localCommandHandler?.(route, atoms) ?? false
    if (!handled) codeSessionStore.send(text, atoms)
    promptInputRef.current.clear()
  canInterrupt === true:
    codeSessionStore.interrupt()
```

Note: the submit button lives *below* the input in the tree, not above it. It is not the first responder; the input is. A keyboard shortcut bound to `submit` (Cmd-Return at the Tide-card level, in T3.4.c) would use a nil-targeted `sendToFirstResponder` — which walks from the input, not from the button. The input does not handle `submit` (it is not in the input's `actions` map), so the walk proceeds up to the entry, which handles it. The same entry handler runs whether the dispatch came from the button (targeted) or the keyboard shortcut (walked).

**4. Editing actions (cut / copy / paste / select-all / undo / redo).**

```
user presses Cmd-X
      ↓
Chain-level keyboard dispatcher fires sendToFirstResponder({ action: CUT })
      ↓
Walk starts at TugPromptInput (which is the first responder because the user's caret is in it)
      ↓
TugPromptInput.actions[CUT] exists → handler runs, editor cuts selection
      ↓
Walk stops; entry's handler is never reached (entry has no CUT handler)
```

The entry does **not** register for editing actions — it is the explicit non-goal [D10]. The chain handles routing for free because the input is the deepest registered node under the caret.

---

#### Phase → visual binding table {#phase-visual-binding}

This is the core contract between the store and the CSS. Every visual variation the component surfaces maps to a named `data-*` attribute on the root element. The CSS selectors are one-to-one with these attributes — no compound CSS expressions beyond a single selector join.

| Source | Root attribute | Values | CSS hook |
|---|---|---|---|
| `snap.phase` | `data-phase` | `idle`, `submitting`, `awaiting_first_token`, `streaming`, `tool_work`, `awaiting_approval`, `errored` | `.tug-prompt-entry[data-phase="idle"]` etc. |
| `snap.canInterrupt` | `data-can-interrupt` | `true` / `false` | `.tug-prompt-entry[data-can-interrupt="true"]` |
| `snap.canSubmit` | `data-can-submit` | `true` / `false` | `.tug-prompt-entry[data-can-submit="false"]` |
| `snap.queuedSends > 0` | `data-queued` | presence-only (attr set or absent) | `.tug-prompt-entry[data-queued]` |
| `snap.lastError !== null` | `data-errored` | presence-only | `.tug-prompt-entry[data-errored]` |
| `snap.pendingApproval !== null` | `data-pending-approval` | presence-only | `.tug-prompt-entry[data-pending-approval]` |
| `snap.pendingQuestion !== null` | `data-pending-question` | presence-only | `.tug-prompt-entry[data-pending-question]` |
| `promptInputRef.current.isEmpty()` | `data-empty` | `true` / `false` (DOM-managed, not via React render) | `.tug-prompt-entry[data-empty="true"]` |

**Visual meaning** (for CSS authors):

- `data-phase="idle"` + `data-empty="true"` + `data-can-interrupt="false"`: submit button at rest, slightly dimmed, not clickable.
- `data-phase="idle"` + `data-empty="false"` + `data-can-interrupt="false"`: submit button at rest, active role color, clickable.
- `data-phase="submitting"` + `data-can-interrupt="true"`: submit button flips to interrupt role color (typically `danger`), label reads "Stop", the input area gains a subtle "in-flight" treatment (opacity shift, or border tint).
- `data-phase="streaming"` + `data-can-interrupt="true"`: same button treatment; the input's pulse animation (if any) stays on.
- `data-phase="tool_work"`: button stays "Stop"; no new visual for tool work at the entry level (tool output is rendered upstream in the card's markdown pane).
- `data-phase="awaiting_approval"` + `data-pending-approval` or `data-pending-question`: the input visually dims (approval UI lives upstream in the card body, not inside the entry) and the submit button goes disabled.
- `data-phase="errored"` + `data-errored`: the entry gains a subtle error-ring; the submit button returns to "Send" (you can retry) with the input enabled.
- `data-queued` with any phase: a small badge with the queue count renders in the toolbar, adjacent to the submit button.

**How the CSS consumer finds these:** every attribute is documented in the props interface with a `@selector` annotation per the authoring guide. A theming agent scanning for `[data-phase]` sees every phase-sensitive rule; scanning for `[data-queued]` finds the badge.

---

### Specification {#specification}

#### Spec S01: `TugPromptEntry` props interface {#s01-props}

```typescript
/**
 * TugPromptEntry — Compound composition: TugPromptInput + route indicator +
 * submit/stop button, driven by a CodeSessionStore snapshot.
 *
 * Composes TugPromptInput (editor + route detection), TugChoiceGroup (route
 * indicator), TugPushButton (submit/stop). Each composed child keeps its own
 * tokens [L20]. The entry's own chrome uses `--tug7-*-prompt-entry-*`.
 *
 * Laws: [L02] useSyncExternalStore for store state, [L06] appearance via
 *       CSS/DOM, [L07] handlers read state via refs, [L11] controls emit
 *       actions, [L15] token-driven states, [L16] pairings declared,
 *       [L19] component authoring guide, [L20] token sovereignty
 * Decisions: [D-T3-01] route selection, [D-T3-06] submit is interrupt,
 *            [D-T3-07] queue during turn, [D-T3-09] 1:1 card↔store
 */
export interface TugPromptEntryProps {
  /** Stable responder id. Typically `${cardId}-entry`. @selector [data-responder-id] */
  id: string;
  /** Store owning Claude Code turn state for this card. */
  codeSessionStore: CodeSessionStore;
  /** Session metadata (model name, version). Accepted for T3.4.c; unused in T3.4.b. */
  sessionMetadataStore: SessionMetadataStore;
  /** Prompt history (recall on arrow up/down). Forwarded to TugPromptInput. */
  historyStore: PromptHistoryStore;
  /** File completion for `@` trigger. Forwarded to TugPromptInput. */
  fileCompletionProvider: CompletionProvider;
  /** Drop handler for dragging files from Finder. Forwarded to TugPromptInput. */
  dropHandler?: DropHandler;
  /**
   * Optional synchronous interceptor for local `:`-surface commands. Called
   * before `codeSessionStore.send(...)` on every submission. Returning `true`
   * suppresses the store send; returning `false` or omitting the prop falls
   * through. The input is cleared on either path. [D06]
   */
  localCommandHandler?: (
    route: string | null,
    atoms: ReadonlyArray<AtomSegment>,
  ) => boolean;
  /** Caller-supplied className merged with the root. @selector standard */
  className?: string;
}

/**
 * Imperative handle exposed via forwardRef. Used by the Tide card (T3.4.c)
 * to drive focus from global keyboard shortcuts.
 */
export interface TugPromptEntryDelegate {
  /** Focus the input. */
  focus(): void;
  /**
   * Clear the input contents. Does not dispatch anything — purely visual.
   * Provided so T3.4.c's reset flows can wipe a card's entry.
   */
  clear(): void;
}
```

Data attributes written on the root — all documented in JSDoc with `@selector`:

```typescript
/** @selector [data-phase="idle" | "submitting" | ...] — from snap.phase */
/** @selector [data-can-interrupt="true" | "false"] — from snap.canInterrupt */
/** @selector [data-can-submit="true" | "false"] — from snap.canSubmit */
/** @selector [data-queued] — presence when snap.queuedSends > 0 */
/** @selector [data-errored] — presence when snap.lastError !== null */
/** @selector [data-pending-approval] — presence when snap.pendingApproval !== null */
/** @selector [data-pending-question] — presence when snap.pendingQuestion !== null */
/** @selector [data-empty="true" | "false"] — DOM-managed from input's isEmpty() */
```

#### Spec S02: Responder registration {#s02-responder}

```typescript
const routeIndicatorSenderId = `${props.id}-route-indicator`;

const snapRef = useRef(snap);
useLayoutEffect(() => { snapRef.current = snap; }, [snap]);

const { ResponderScope, responderRef } = useResponder({
  id: props.id,
  actions: {
    [TUG_ACTIONS.SELECT_VALUE]: (event: ActionEvent) => {
      if (event.sender !== routeIndicatorSenderId) return;
      if (typeof event.value !== "string") return;
      promptInputRef.current?.setRoute(event.value);
    },
    [TUG_ACTIONS.SUBMIT]: (_event: ActionEvent) => {
      const snap = snapRef.current;
      const input = promptInputRef.current;
      if (!input) return;
      if (snap.canInterrupt) {
        props.codeSessionStore.interrupt();
        return;
      }
      if (!snap.canSubmit) return; // e.g., awaiting_approval
      const atoms = input.getAtoms();
      const text = input.getText();
      const route = deriveRouteFromAtoms(atoms);
      const handled = props.localCommandHandler?.(route, atoms) ?? false;
      if (!handled) {
        props.codeSessionStore.send(text, atoms);
      }
      input.clear();
    },
  },
});
```

The handler **reads `snapRef.current`**, not the `snap` closure variable. This is the [L07] pattern documented in [component-authoring.md](../tuglaws/component-authoring.md) — without it, the handler would close over a stale snapshot from the render that registered the action.

#### Spec S03: Layout structure {#s03-layout}

```tsx
<ResponderScope>
  <div
    data-slot="tug-prompt-entry"
    ref={responderRef as (el: HTMLDivElement | null) => void}
    data-phase={snap.phase}
    data-can-interrupt={String(snap.canInterrupt)}
    data-can-submit={String(snap.canSubmit)}
    data-errored={snap.lastError ? "" : undefined}
    data-pending-approval={snap.pendingApproval ? "" : undefined}
    data-pending-question={snap.pendingQuestion ? "" : undefined}
    data-queued={snap.queuedSends > 0 ? "" : undefined}
    data-empty="true"  // initial; updated imperatively on input change
    className={cn("tug-prompt-entry", props.className)}
    {...rest}
  >
    <TugPromptInput
      ref={promptInputRef}
      historyStore={props.historyStore}
      fileCompletionProvider={props.fileCompletionProvider}
      dropHandler={props.dropHandler}
      routePrefixes={[">", "$", ":"]}
      onRouteChange={handleRouteChange}
      onInputChange={handleInputChange}
    />
    <div className="tug-prompt-entry-toolbar">
      <TugChoiceGroup
        items={ROUTE_ITEMS}
        value={currentRouteFromDom()}  // initial read; DOM owns subsequent values
        senderId={routeIndicatorSenderId}
        size="sm"
        aria-label="Command route"
        ref={routeIndicatorRef}
      />
      {snap.queuedSends > 0 && (
        <span className="tug-prompt-entry-queue-badge" aria-live="polite">
          {snap.queuedSends}
        </span>
      )}
      <TugPushButton
        action={TUG_ACTIONS.SUBMIT}
        role={snap.canInterrupt ? "danger" : "action"}
        disabled={!snap.canSubmit && !snap.canInterrupt}
        aria-label={snap.canInterrupt ? "Stop turn" : "Send prompt"}
      >
        {snap.canInterrupt ? "Stop" : "Send"}
      </TugPushButton>
    </div>
  </div>
</ResponderScope>
```

Where:
- `ROUTE_ITEMS` is a module-level constant: `[{value: ">", label: ">"}, {value: "$", label: "$"}, {value: ":", label: ":"}]`.
- `handleRouteChange(route)` writes `data-route` to the indicator's root DOM element via `routeIndicatorRef`.
- `handleInputChange(...)` reads `promptInputRef.current.isEmpty()` and writes `data-empty` to the entry's root element directly.
- `currentRouteFromDom()` returns the initial route value, typically `">"` for a fresh entry.
- `cn()` is the standard class-merging helper from `lib/utils.ts`.

#### Spec S04: `TugPromptInput.setRoute(char)` addition {#s04-set-route}

```typescript
// Inside TugPromptInput's useImperativeHandle block, alongside clear(), insertText(), etc.

/**
 * Set the leading route atom to `char`. Clears the input and inserts a
 * single route-prefix character, triggering the existing route-detection
 * path (which fires `onRouteChange(char)` as a side effect). Used by
 * TugPromptEntry when the user clicks a segment in the route indicator.
 *
 * @param char — one of the configured route prefix characters (e.g., `">"`, `"$"`, `":"`)
 */
setRoute(char: string): void {
  this.clear();
  this.insertText(char);
},
```

Unit tests in `__tests__/tug-prompt-input.test.tsx` cover:
- `setRoute(">")` on an empty input produces exactly one route atom at position 0.
- `setRoute("$")` on a non-empty input wipes the prior content and leaves exactly one `$` route atom.
- `setRoute(">")` fires `onRouteChange(">")` once via the existing detection path.
- `setRoute("not-a-prefix")` is a no-op for route detection (it inserts the character but does not fire `onRouteChange`) — the entry is responsible for not passing garbage.

#### Spec S05: Action vocabulary preconditions {#s05-action-vocab}

Verify in Step 1:

- `TUG_ACTIONS.SELECT_VALUE` exists. (**Confirmed.** Used by existing choice groups and tab bars.)
- `TUG_ACTIONS.SUBMIT` exists. **Unverified** — may need to be added. If added, the constant is `"submit"` with JSDoc noting: "Dispatched by a form or submission-shaped control to mean 'commit the current draft intent.' The responder handler reads the live state from the store or delegate at dispatch time (per [L07]) to decide what 'commit' means — send, interrupt, save, etc. Phase is always `discrete`."

#### Spec S06: Mock driver API for sandbox card {#s06-mock-driver}

```typescript
// Inside gallery-prompt-entry-sandbox.tsx, as a local module-scope helper.

/**
 * A tiny set of synthetic frame factories that cover every phase transition
 * TugPromptEntry surfaces. Each returns a decoded payload matching the
 * v2.1.105 wire shape for the named event.
 */
const SYNTHETIC = {
  sessionInit: (tsid: string, sessionId: string) => ({ type: "session_init", session_id: sessionId, tug_session_id: tsid }),
  assistantPartial: (tsid: string, msgId: string, text: string, rev: number, seq: number) => ({
    type: "assistant_text", tug_session_id: tsid, msg_id: msgId, text, is_partial: true, rev, seq,
  }),
  assistantFinal: (tsid: string, msgId: string, text: string, rev: number) => ({
    type: "assistant_text", tug_session_id: tsid, msg_id: msgId, text, is_partial: false, rev,
  }),
  toolUse: (tsid: string, toolUseId: string, toolName: string, input: unknown) => ({
    type: "tool_use", tug_session_id: tsid, tool_use_id: toolUseId, tool_name: toolName, input,
  }),
  toolResult: (tsid: string, toolUseId: string, output: unknown) => ({
    type: "tool_result", tug_session_id: tsid, tool_use_id: toolUseId, output, is_error: false,
  }),
  turnCompleteSuccess: (tsid: string, msgId: string) => ({
    type: "turn_complete", tug_session_id: tsid, msg_id: msgId, result: "success",
  }),
  turnCompleteError: (tsid: string, msgId: string) => ({
    type: "turn_complete", tug_session_id: tsid, msg_id: msgId, result: "error",
  }),
  controlRequestApproval: (tsid: string, requestId: string, toolName: string) => ({
    type: "control_request_forward", tug_session_id: tsid, request_id: requestId,
    is_question: false, tool_name: toolName, input: {},
  }),
  controlRequestQuestion: (tsid: string, requestId: string, question: string) => ({
    type: "control_request_forward", tug_session_id: tsid, request_id: requestId,
    is_question: true, question, options: [],
  }),
  sessionStateErrored: (tsid: string, detail: string) => ({
    tug_session_id: tsid, state: "errored", detail,
  }),
  controlSessionUnknown: (tsid: string) => ({
    type: "error", detail: "session_unknown", tug_session_id: tsid,
  }),
} as const;
```

The sandbox card's driver panel exposes buttons labeled after each factory; clicking a button calls `mockConnection.dispatchDecoded(feedId, payload)` with the corresponding frame. A small "run sequence" button at the bottom plays a canned happy-path turn (session_init → user sends → submitting → awaiting_first_token → streaming → turn_complete_success → idle).

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| Path | Purpose |
|---|---|
| `tugdeck/src/components/tugways/tug-prompt-entry.tsx` | Component implementation + props + delegate |
| `tugdeck/src/components/tugways/tug-prompt-entry.css` | Component styles, `@tug-pairings`, token scope |
| `tugdeck/src/components/tugways/__tests__/tug-prompt-entry.test.tsx` | Vitest suite |
| `tugdeck/src/components/tugways/cards/gallery-prompt-entry.tsx` | Pristine showcase gallery card |
| `tugdeck/src/components/tugways/cards/gallery-prompt-entry.css` | Minimal card layout |
| `tugdeck/src/components/tugways/cards/gallery-prompt-entry-sandbox.tsx` | Interactive driver card |
| `tugdeck/src/components/tugways/cards/gallery-prompt-entry-sandbox.css` | Driver panel layout |

#### Edited files {#edited-files}

| Path | Change |
|---|---|
| `tugdeck/src/components/tugways/tug-prompt-input.tsx` | Add `setRoute(char)` to imperative handle; JSDoc |
| `tugdeck/src/components/tugways/__tests__/tug-prompt-input.test.tsx` | Add `setRoute` unit tests |
| `tugdeck/src/components/tugways/action-vocabulary.ts` | Add `TUG_ACTIONS.SUBMIT` if missing |
| `tugdeck/src/main.tsx` | Register both new gallery cards |

#### New exported symbols {#symbols-new}

- `TugPromptEntry` (React component, `forwardRef` with `TugPromptEntryDelegate`)
- `TugPromptEntryProps` (interface)
- `TugPromptEntryDelegate` (interface)

#### Modified exported symbols {#symbols-modified}

- `TugPromptInput` delegate gains `setRoute(char: string): void`
- `TUG_ACTIONS.SUBMIT` (if added) — string constant

---

### Documentation Plan {#documentation-plan}

- **Module docstring** on `tug-prompt-entry.tsx` cites the minimum law set plus composition-specific laws: `[L02], [L06], [L07], [L11], [L15], [L16], [L19], [L20]`. Decisions: `[D-T3-01], [D-T3-06], [D-T3-07], [D-T3-09]`.
- **Props JSDoc** on every CSS-targetable prop and every `data-*` attribute written to the root — `@selector` annotations point at the exact attribute selectors.
- **CSS file opens with `@tug-pairings`** in both compact and expanded formats. Every rule that sets `color` without `background-color` in the same rule carries `@tug-renders-on`. Any component-tier aliases live in `body {}` and resolve to base `--tug7-*` tokens in one hop per [L17].
- **Gallery cards**: each card's module docstring names the component it previews and lists the mocks it constructs. The sandbox card's docstring explicitly calls out "uses MockTugConnection for dev-only state-machine exploration — not a test harness."
- **`roadmap/tide.md` update**: mark T3.4.b as `✓ LANDED` in `#execution-order-table` after Step 7, and append a brief status line to §T3.4.b pointing at this plan.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test categories {#test-categories}

1. **Imperative-method tests** (`tug-prompt-input.test.tsx` extension): `setRoute(">")`, `setRoute("$")` on empty + non-empty; `onRouteChange` side-effect firing; position invariants.
2. **Rendering tests** (`tug-prompt-entry.test.tsx`): root `data-slot`, root `data-responder-id`, initial `data-phase="idle"`, initial `data-empty="true"`, `data-can-interrupt="false"`, queue badge absent.
3. **Snapshot-binding tests**: advance the mock store through each phase; assert the root's `data-phase` changes; assert no React state updates inside the entry via a render-counter ref.
4. **Responder handler tests**: dispatch `TUG_ACTIONS.SELECT_VALUE` with correct sender → delegate called; with wrong sender → delegate not called; dispatch `TUG_ACTIONS.SUBMIT` while `canInterrupt: false` → `codeSessionStore.send` called with current text + atoms; dispatch `TUG_ACTIONS.SUBMIT` while `canInterrupt: true` → `codeSessionStore.interrupt` called.
5. **Delegate tests**: `delegate.focus()` forwards to input's `focus()`; `delegate.clear()` forwards to input's `clear()`.
6. **`localCommandHandler` tests**: returning `true` suppresses send but still clears input; returning `false` allows send; omitting the prop is equivalent to `false`.
7. **Queue-badge tests**: `snap.queuedSends: 0` → badge absent; `snap.queuedSends: 1` → badge present with text `"1"`; transition back to `0` → badge removed. No React state updates inside the entry for this transition.
8. **Error-ring test**: dispatching a `SESSION_STATE errored` frame through the mock sets `data-errored` on the root.

#### What the tests do NOT cover {#test-categories-excluded}

- Exact token values or CSS output (enforced by `audit:tokens lint`, not unit tests)
- Exact class names beyond `tug-prompt-entry` and `tug-prompt-entry-toolbar`
- Snapshot tests of the rendered DOM
- Pixel layout
- Theme variation (gallery + `audit:tokens lint` own theming)
- Full turn flow against a golden fixture (the store's own tests cover that)

---

### Execution Steps {#execution-steps}

#### Step 1: Preconditions + `TugPromptInput.setRoute` {#step-1}

**Goal:** Verify all prerequisites exist; land the `setRoute(char)` addition to `TugPromptInput` with its unit test. Verify `TUG_ACTIONS.SUBMIT` / add it if missing. Verify `TugPromptInput` exposes an `onInputChange` callback prop — add one if not.

**Deliverables:**
- `tug-prompt-input.tsx`: new `setRoute(char: string): void` in `useImperativeHandle`, one line + JSDoc.
- `tug-prompt-input.tsx`: if missing, new `onInputChange?: () => void` prop, fired from the input-event handler.
- `__tests__/tug-prompt-input.test.tsx`: new unit tests for `setRoute`.
- `action-vocabulary.ts`: if missing, new `TUG_ACTIONS.SUBMIT = "submit"`.

**Exit:** `bun run check` + `bun run test` green; the new test file passes in isolation.

#### Step 2: Component scaffold + token wiring {#step-2}

**Goal:** Land `tug-prompt-entry.tsx` + `.css` scaffold — props interface, component body with `useSyncExternalStore`, layout skeleton (input + toolbar + button), responder registration with empty action handlers, `data-slot` on root, `data-responder-id` via `responderRef`. CSS with `@tug-pairings`, token scope, no behavior yet.

**Deliverables:**
- `tug-prompt-entry.tsx` renders the compositional shell with correct data attributes wired to snapshot but no action handling.
- `tug-prompt-entry.css` has `@tug-pairings` (compact + expanded), at least one pairing entry, base block styles, and the three-attribute selector chain (`[data-phase]`, `[data-can-interrupt]`, `[data-empty]`) stubbed.
- `__tests__/tug-prompt-entry.test.tsx` starts with a single rendering test.

**Exit:** Component renders without throwing against a `MockTugConnection`-backed store; `data-phase="idle"` is present; theme lint is clean.

#### Step 3: Input delegate wiring + `data-empty` {#step-3}

**Goal:** Thread the input ref through `forwardRef` + `useImperativeHandle`. Implement `handleInputChange` to write `data-empty` to the root element. Implement the `delegate.focus()` / `delegate.clear()` pass-throughs.

**Deliverables:**
- `tug-prompt-entry.tsx` exposes `TugPromptEntryDelegate` via `forwardRef`.
- Input changes update `data-empty` in the DOM without React state.
- Test: typing a character clears `data-empty`; backspacing back to empty re-sets it.

**Exit:** `bun run test` green; the delegate test covers both methods.

#### Step 4: Route indicator bidirectional sync {#step-4}

**Goal:** Implement `handleRouteChange` (input → indicator via DOM ref) and the `TUG_ACTIONS.SELECT_VALUE` responder handler (indicator → input via delegate). Wire `senderId` disambiguation.

**Deliverables:**
- `tug-prompt-entry.tsx` fully wires bidirectional route sync.
- Test: typing `">"` fires `onRouteChange(">")` and updates the indicator's DOM.
- Test: dispatching `SELECT_VALUE` with the correct sender calls `setRoute` on the input.
- Test: dispatching `SELECT_VALUE` with the wrong sender is a no-op.

**Exit:** Three new tests pass; the responder-wiring deep dive in this plan matches the implementation.

#### Step 5: Submit / interrupt wiring + queue badge + error ring {#step-5}

**Goal:** Implement the `TUG_ACTIONS.SUBMIT` responder handler; wire `localCommandHandler`; render the queue badge conditionally; write `data-errored`.

**Deliverables:**
- Full submit flow: `canInterrupt` false → `send()`; true → `interrupt()`.
- `localCommandHandler` interception, input cleared on both paths.
- Queue badge: renders when `snap.queuedSends > 0`, disappears on 0.
- `data-errored` written when `snap.lastError !== null`.
- Test: all of the above.

**Exit:** Every snapshot-binding + responder-handler test from §Test Plan passes.

#### Step 6: Gallery cards {#step-6}

**Goal:** Ship both gallery cards.

**Deliverables:**
- `gallery-prompt-entry.tsx` + `.css`: pristine card with a minimal `MockTugConnection`-backed store in `idle`. No driver buttons.
- `gallery-prompt-entry-sandbox.tsx` + `.css`: full driver panel with ~10 buttons corresponding to the `SYNTHETIC` frame factories; a "run happy path" button; a mock store that is reset via a "reset store" button.
- `main.tsx`: registers both cards with the gallery card registry.
- Manual verification: open both cards in a running dev build; click through the sandbox and observe phase transitions on the embedded component.

**Exit:** Both cards render; manual click-through verifies every phase + queue + errored visual.

#### Step 7: Integration checkpoint {#step-7}

**Goal:** Full-suite verification; lint passes; grep-based invariants hold; the integration contract for T3.4.c is documented.

**Deliverables:**
- `bun run check` + `bun run test` + `bun run audit:tokens lint` all exit 0.
- `rg 'useState|useReducer' tugdeck/src/components/tugways/tug-prompt-entry.tsx` returns zero matches.
- `rg '\.tug-prompt-entry \.tug-' tugdeck/src/components/tugways/tug-prompt-entry.css` returns zero matches.
- `roadmap/tide.md` updated: T3.4.b marked `✓ LANDED` in `#execution-order-table` + brief status block under §T3.4.b pointing at this plan.
- This plan's §Roadmap is populated with a "handover to T3.4.c" summary (what exists, what T3.4.c does with it).

**Exit:** Phase closed; ready for `/commit`.

---

### Deliverables and Checkpoints {#deliverables}

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- `tug-prompt-entry.tsx` + `.css` exist, export the component + props + delegate, and conform to the component authoring guide checklist.
- Both gallery cards render in a running dev build and demonstrate every phase transition the component surfaces.
- Vitest suite passes; `audit:tokens lint` passes; no grep-based regressions.
- `roadmap/tide.md` marks T3.4.b landed.
- T3.4.c can begin without touching this component's TSX or CSS — purely composition.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- **Local command registry** (T10). The `localCommandHandler` prop is a seam; populating `:help`, `:settings`, etc. is T10's work.
- **`SessionMetadataStore` rendering** (T3.4.c). Model name + version display near the entry's toolbar. The prop is in place.
- **`PromptHistoryStore` integration beyond forwarding** (post-T3.4.c). Up/down arrow recall on an empty input lives in `TugPromptInput` today; any "history peek" UI inside the entry is future work.
- **`MockTugConnection` promotion** (if the `testing/` import path proves awkward). Pure mechanical move to `dev-mock.ts`; not required unless a bundler rule bites.
- **Token authoring under `--tug7-*-prompt-entry-*`** (preparatory if any are missing). Lands in `brio.css` + `harmony.css` before or alongside Step 2 as a separate commit — outside the step count, inside the phase scope.

---
