<!-- tugplan-skeleton v2 -->

## Tide Connection Health & Reconnect-Aware Cards {#tide-connection-health}

**Purpose:** Make Tide cards survive a tugcast restart and a half-open WebSocket without leaving stranded bindings or silent submit-spinners. Add a client-side heartbeat watchdog, a transport-state lifecycle on the per-card store, and a reconnect-aware restore path that re-asserts session bindings every time the WebSocket comes back up.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | tugplan-tide-connection-health |
| Last updated | 2026-04-30 |
| Roadmap anchor | [tugplan-tide-card-polish.md §step-7-5](./tugplan-tide-card-polish.md#step-7-5) (replaced by this plan) |
| Predecessor | [tugplan-tide-card.md](./archive/tugplan-tide-card.md) (T3.4.c) — `spawn_session(mode=resume)` plumbing this plan re-asserts on reconnect |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Two coupled defects surfaced in real use of Tide:

1. **Tide cards have trouble reconnecting after a tugcast restart.** When the WebSocket comes back up, tide cards stay unbound. Submitting a command spins forever, with no visible signal that anything is wrong.
2. **Connection failures are not always detected.** `pkill -x tugcast` does not reliably surface the disconnection banner. The app sometimes reconnects on its own, but every existing tide card is broken without showing it.

Tracing these symptoms surfaces three coupled root causes:

- **`restoreTideSessions` runs once at startup, never on reconnect.** `tugdeck/src/main.tsx:228` calls it once after `tugbankClient.ready()`. There is no companion `connection.onOpen(...)` for subsequent opens. After a tugcast restart, the server's `rebind_from_tugbank` rebuilds ledger entries from `dev.tugtool.tide.session-keys`, but the client never re-asserts them with `spawn_session(mode=resume)`. The bindings the client holds in `cardSessionBindingStore` no longer correspond to anything live on the new server's side, and frame routing fails silently.
- **The client has no heartbeat watchdog.** The server has one — `tugcast/src/router.rs` enforces `HEARTBEAT_TIMEOUT = 45 s`. The client only *sends* heartbeats; it never validates that the server's heartbeats are arriving. If TCP goes half-open (process hung, OS sleep, broken proxy), the WebSocket's `onclose` may not fire for hours, until OS-level keepalive expires.
- **The transport-state / per-card lifecycle is incomplete.** `code-session-store.ts:155` already subscribes to `connection.onClose` and dispatches `transport_close`, but the reducer drops it silently for `idle` cards (`reducer.ts:737`). There is no companion `transport_open` event to recover. The banner has its own 2 s show-debounce (`tug-banner-bridge.tsx:22`) that often elapses *after* a quick reconnect, so brief outages flash invisibly.

This plan fixes all three by introducing a client-side watchdog, clearing the `lastPayload` snapshot cache on close, making `restoreTideSessions` reconnect-aware, and adding an orthogonal transport-state axis to the per-card store that the UI gates on.

#### Strategy {#strategy}

- **Land the immediate UX win first.** Step 1 (reconnect-aware `restoreTideSessions`) on its own resolves the "submit spins forever after tugcast restart" symptom. Subsequent steps add defense-in-depth and polish.
- **Transport state is orthogonal to phase.** Phase is *turn lifecycle*; transport is *wire health*. Two independent axes. Conflating them produces bad UX during reconnects ("errored" cards that nothing was submitted on; cards refusing retry when the wire is back) and leaks across tests.
- **Connection layer emits; reducer owns transitions.** `transport_close` and `transport_open` are dispatched events on the per-card store. The connection layer is the emitter. The reducer owns the state. Mirrors [L11].
- **Watchdog mirrors the server's contract.** The 45 s threshold is the same `HEARTBEAT_TIMEOUT` the server already uses to time *us* out. The watchdog is a defensive copy of an existing constraint, not a new one.
- **Build stays green at every commit.** `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, and `cargo nextest run` pass on every step. Warnings are errors.
- **App-test recipes where feasible; manual where not.** Kill+restart and rapid-cycle scenarios become `app-test` recipes. OS sleep / wake stays manual.
- **Tuglaws cross-checked.** Every step that touches the connection layer, the per-card store, or the banner re-checks against [tuglaws.md](../tuglaws/tuglaws.md). The closing step records the walkthrough.

#### Success Criteria (Measurable) {#success-criteria}

- After `pkill -x tugcast` followed by tugcast respawn, every tide card that was bound before the kill rebinds without a page reload, and submitting works again. (Verified by app-test recipe and manual smoke.)
- A half-open WebSocket where no frames arrive for ≥ 45 s causes the client to force-close and reconnect. (Verified by unit test on the watchdog timer; manual smoke via OS sleep / wake.)
- `transportState` transitions are observable in the per-card snapshot: `online → offline` on close, `offline → restoring` on next open, `restoring → online` when the binding lands. (Verified by reducer unit tests.)
- `canSubmit` is gated on `transportState === "online"` in addition to phase. (Verified by snapshot test; manual smoke disables the submit button visibly during a kill+restart cycle.)
- The disconnect banner appears within ≤ 1 s of a connection loss (was: up to 2 s due to debounce). (Verified by app-test recipe.)
- After a visible disconnect, a transient "Reconnected" affordance shows for ≤ 1.5 s on recovery. (Verified by manual smoke.)
- `lastPayload` is empty after `onclose`; a late `onFrame` registration after reconnect does not deliver any pre-close frame. (Verified by unit test.)

#### Scope {#scope}

1. Reconnect-aware `restoreTideSessions` driven by `connection.onOpen` (every open after the first).
2. Client-side heartbeat watchdog inside `TugConnection` that force-closes on `lastFrameAt` staleness.
3. `lastPayload` snapshot-cache clear on `onclose`.
4. New `transportState: "online" | "offline" | "restoring"` field on `CodeSessionState` and on `CodeSessionSnapshot`.
5. New `transport_open` event; rework of `transport_close` so it sets `transportState` for *every* phase (no longer dropped for `idle`).
6. `code-session-store` subscribes to both `connection.onOpen` and `connection.onClose`; the first `onOpen` is the mount path and does not dispatch.
7. UI gating on `transportState`: `canSubmit` becomes `phase ∈ {idle, errored} && transportState === "online"`; `TideCardContent` renders `TideRestoring` while `transportState === "restoring"`.
8. Banner UX tightening: shorter / removed disconnect debounce; transient "Reconnected" affordance; "Restoring sessions…" status while any card is in `restoring`.

#### Non-goals (Explicitly out of scope) {#non-goals}

- A server-pushed `client_recognized { sessions: [...] }` frame so the client doesn't have to ask. See [D03].
- Folding `transportState` into the existing `phase` enum. See [D01].
- Rewriting `TugConnection`'s reconnect/backoff strategy. The watchdog reuses the existing `ws.close()` → `scheduleReconnect()` path.
- Persisting transport state across page reloads. Transport state is in-memory only; on reload, every store starts at `online` and the normal `restoreTideSessions` path runs.
- Adding new wire frames. Every change is internal to `TugConnection`, `CodeSessionStore`, and the UI components that read its snapshot.
- Reworking the picker, the session ledger, or any other Step-10-and-later work in `tugplan-tide-card-polish.md`. Those are independent.

#### Dependencies / Prerequisites {#dependencies}

- Existing `spawn_session(mode=resume)` plumbing from [T3.4.c Step 4i](./archive/tugplan-tide-card.md#step-4i) and the picker work in [Step 4.5](./archive/tugplan-tide-card.md#step-4-5).
- Existing `connection.onOpen` and `connection.onClose` registration APIs in `TugConnection`.
- Existing `cardSessionBindingStore` and `tideRestoreRegistry` modules (`tugdeck/src/lib/card-session-binding-store.ts`, `tugdeck/src/lib/tide-session-restore.ts`).
- Existing `code-session-store` reducer + effect-list architecture ([D11] in T3.4.c).
- Existing `TugBanner` primitive and `tug-banner-bridge.tsx` provider.

#### Constraints {#constraints}

- **Tuglaws** [L02], [L03], [L11], [L23] apply at every step. See [#tuglaws-cross-check].
- **No warnings**: `cargo build` / `cargo nextest run` enforce `-D warnings` (CLAUDE.md build policy).
- **HMR is always running**: never run a manual tugdeck build; HMR picks up changes on save (`feedback_hmr` memory).
- **Use bun, not npm**: every tooling invocation is `bun ...` (`feedback_use_bun` memory).
- **No mock-store assertion tests**: reducer unit tests dispatch through the real store, not via hand-rolled mock interfaces (`feedback_no_mock_store_tests` memory).
- **app-test recipes use `just app-test <file>`**: never hand-rolled `bun test` with `TUGAPP_*` env vars (`feedback_just_app_test` memory).

#### Assumptions {#assumptions}

- The 15 s server-side `HEARTBEAT_INTERVAL` and the 45 s `HEARTBEAT_TIMEOUT` from `tugcast/src/router.rs` are stable and authoritative. If either changes, the watchdog threshold tracks the server's `HEARTBEAT_TIMEOUT`.
- Snapshot frames are server-authoritative and replayed on every reconnect handshake. Clearing `lastPayload` on close cannot lose any client-authoritative state.
- `restoreTideSessions` is idempotent across multiple invocations once Step 1 lands; concurrent restore attempts collapse cleanly because `cardSessionBindingStore.clearAll()` precedes each run.
- A card's transcript (already accumulated `TurnEntry` rows) is preserved across transport flips. Only `transportState`, the inflight buffers, and gating change.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows [tuglaws/tugplan-skeleton.md §reference-conventions](../tuglaws/tugplan-skeleton.md#reference-conventions). Key points:

- All execution-step anchors are kebab-case `step-N`.
- Design decisions use `dNN-...` slugs.
- `**References:**` lines cite specific decisions, specs, lists, and anchors — never line numbers.
- `**Depends on:**` lines cite step anchors, never titles or numbers.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

> The three open questions on the source [step-7-5](./tugplan-tide-card-polish.md#step-7-5) sketch were promoted to design decisions during plan authoring. See [D01], [D02], [D03]. No questions remain open at plan-author time.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Transport-state introduces a new dimension to test | med | high | Default `transportState = "online"`; existing tests stay green; explicit transport tests cover the new dimension | A flaky reducer test correlates with a transport event |
| Watchdog mis-fires under legitimate idle wires | med | low | Threshold mirrors server's `HEARTBEAT_TIMEOUT`; any drift past 45 s is already a real problem | Telemetry shows force-closes without other failure signals |
| Reconnect can stack restores | low | low | `restoreTideSessions` is idempotent; binding-clear before each run; per-card 10 s timeout | Logs show overlapping `restore.fired_resume_spawns` events |
| `lastPayload` cache clear loses a snapshot frame | low | low | Snapshot path is server-authoritative; post-reconnect handshake replays | A late subscriber renders empty after reconnect |
| Banner UX change feels noisy | low | med | Keep "Reconnected" ≤ 1.5 s; only on recovery from a *visible* disconnect | User feedback or design review flags noise |

**Risk R01: Watchdog false-positive force-close** {#r01-watchdog-false-positive}

- **Risk:** A legitimately quiet wire (no traffic for > 45 s) gets force-closed by the watchdog.
- **Mitigation:** The server emits a HEARTBEAT every `HEARTBEAT_INTERVAL = 15 s` (`router.rs:45`). `lastFrameAt` bumps on *any* incoming frame, including HEARTBEAT. The 45 s threshold tolerates two missed heartbeats. If three consecutive heartbeats don't arrive, the wire is genuinely broken — the same conclusion the server would reach about us.
- **Residual risk:** A pathological network path that delivers heartbeats in a 50 s+ burst would cause a force-close. Acceptable; that path is already broken from the server's perspective.

**Risk R02: Reconnect-stack from rapid `onOpen` fires** {#r02-reconnect-stack}

- **Risk:** A flaky network where `onOpen` fires twice within the time it takes a `spawn_session(resume)` round-trip causes two restore runs to interleave.
- **Mitigation:** `restoreTideSessions` is idempotent (it clears in-flight expectations and re-arms via `tideRestoreRegistry._clear` then `_register`); Step 1 inserts `cardSessionBindingStore.clearAll()` before each run; the per-card 10 s timeout in `tideRestoreRegistry` cleans up stuck restores.
- **Residual risk:** Two `spawn_session(resume)` frames could land back-to-back on the server. The server's existing dedupe on `tug_session_id` collapses them to one bind.

**Risk R03: `transport_open` dispatched on initial mount** {#r03-initial-open-dispatch}

- **Risk:** If `code-session-store`'s constructor subscribes to `onOpen` *after* the connection is already open, the late callback fires immediately, dispatching `transport_open` on what is actually the mount path. The card flips through `restoring` for no reason.
- **Mitigation:** The store tracks a `_seenFirstOpen: boolean` that flips on the first `onOpen` callback (or, equivalently, gates the dispatch on whether `transport_close` was ever observed). The first `onOpen` is the mount path and never dispatches; only subsequent opens dispatch `transport_open`.
- **Residual risk:** Edge case where the connection oscillates open → close → open before the store's `useLayoutEffect` runs. The reducer is defensive: `transport_open` from `transportState === "online"` is a no-op.

---

### Design Decisions {#design-decisions}

> Record *decisions* (not options). Each decision includes the "why" so later phases don't reopen it accidentally.

#### [D01] `transportState` is a separate field, orthogonal to `phase` (DECIDED) {#d01-transport-state-separate}

**Decision:** Add `transportState: "online" | "offline" | "restoring"` as a new field on `CodeSessionState` and `CodeSessionSnapshot`, alongside the existing `phase` enum. Do not fold transport health into `phase` (e.g., as `transport_lost` or `restoring` phase values).

**Rationale:**
- Phase is about *turn lifecycle*: interrupting, queuing, errored from the wire's perspective. Transport is about *wire health*: did we lose the connection? Are we mid-handshake on a re-open?
- Conflating them produces bad UX: cards say "errored" when nothing was submitted; cards refuse retry when the wire is back.
- Conflating them leaks across tests: every existing per-phase test would have to re-establish a transport invariant. Separate fields keep each test focused.

**Implications:**
- The reducer handles four `transport_*` events orthogonally to phase events. Most phase-event handlers do not read `transportState`.
- `canSubmit` becomes `(phase ∈ {idle, errored}) && (transportState === "online")` — a conjunction across two axes.
- Existing tests with no transport dispatch keep passing; default value is `"online"`.

#### [D02] Watchdog timeout matches the server's `HEARTBEAT_TIMEOUT` (DECIDED) {#d02-watchdog-mirrors-server}

**Decision:** The client watchdog force-closes the WebSocket if `Date.now() - lastFrameAt > HEARTBEAT_TIMEOUT_MS` where `HEARTBEAT_TIMEOUT_MS = 45_000`. This mirrors `HEARTBEAT_TIMEOUT` in `tugcast/src/router.rs:48`. The watchdog timer ticks every 5 s.

**Rationale:**
- The server already uses 45 s to time *us* out. Any drift past 45 s is already a real problem from the server's perspective; the client adopting the same threshold is a defensive copy of an existing contract, not a new constraint.
- The server emits HEARTBEAT every 15 s. 45 s = three missed heartbeats — clear evidence the wire is broken, not just quiet.
- Picking a slightly longer threshold (e.g., 50 s) to absorb clock skew adds latency to recovery without reducing false-positive rate; the 5 s tick already absorbs most jitter.

**Implications:**
- A `HEARTBEAT_TIMEOUT_MS` constant in `connection.ts` carries an explicit comment that mirrors `router.rs`.
- Tests mock `Date.now` and the watchdog timer; do not depend on real timers.
- If `router.rs` ever changes the timeout, the client constant must change in lockstep. A unit-test assertion on both crates can enforce this if desired (out of scope here).

#### [D03] Defer server-pushed `client_recognized` frame to a follow-up (DECIDED) {#d03-defer-server-push}

**Decision:** Do not introduce a server-pushed `client_recognized { sessions: [...] }` frame as part of this plan. The client-driven re-restore (Step 1) is sufficient on its own. A server-push path can be added as defense-in-depth in a later plan if the client-driven path proves insufficient.

**Rationale:**
- Client-driven re-restore is one frame per card, sent after `connection.onOpen`. The server already handles `spawn_session(mode=resume)` deduping by `tug_session_id`. Round-trip cost is bounded by the number of live tide cards (typically 1–4).
- Server-pushed recognition is a larger architectural change: it requires a new control frame type, server-side tracking of "what does this client know about?", and conflict resolution between server-pushed and client-pulled views.
- Adding it now ties this plan's blast radius across the wire boundary; deferring keeps the plan tugdeck-only.

**Implications:**
- This plan does not touch tugcast.
- A future "server-side session recognition" plan can build on top once we know whether client-driven recovery has gaps in production use.

#### [D04] Reconnect-aware restore clears bindings before re-running (DECIDED) {#d04-clear-then-restore}

**Decision:** On every `connection.onOpen` *after the first*, the reconnect handler calls `cardSessionBindingStore.clearAll()` and *then* calls `restoreTideSessions`. The clear-then-restore order is part of the contract.

**Rationale:**
- Bindings without a live server peer are worse than no bindings: workspace-key filters in `FeedStore` route frames the new server is not actually emitting, and `useCardWorkspaceKey` reads stale data.
- Clearing first guarantees that any UI that observes the binding store sees a clean "no binding yet" state before the next `spawn_session_ok` ack arrives.
- The clear+restore pair is atomic from the React store-subscriber's perspective: a single `clearAll` notify, then per-card `setBinding` notifies as acks arrive.

**Implications:**
- `CardSessionBindingStore` gains a `clearAll()` method that emits a single notify (not N notifies for N entries).
- `restoreTideSessions` accepts a `{ reason: "reconnect" }` flag (or equivalent) so its lifecycle log distinguishes startup from reconnect runs.
- Cards observing the binding store will see at least one render with no binding between `clearAll` and the first `setBinding`. The UI's `transportState === "restoring"` rendering covers this gap (see [D06]).

#### [D05] `lastPayload` snapshot cache clears on `onclose` (DECIDED) {#d05-clear-last-payload-on-close}

**Decision:** `TugConnection.lastPayload.clear()` runs in the `onclose` handler before any reconnect logic. Late `onFrame` subscribers registered after a reconnect do not receive any pre-close frame.

**Rationale:**
- The cache is the "replay snapshot to late subscribers" mechanism. After a close, any cached frame from before the close is no longer authoritative — the server's post-reconnect handshake will replay whatever is current.
- Without this clear, a card mounted post-reconnect (e.g., a deferred `card-host` mount) could observe a stale `SESSION_STATE` frame that no longer reflects the new server's view.
- The snapshot path is server-authoritative; there is no client-authoritative state in the cache that needs preserving across the close.

**Implications:**
- A snapshot frame that arrives in the narrow window between the last `dispatch` and `onclose` is discarded. This is acceptable: the post-reconnect snapshot will replay it.
- Tests assert `lastPayload.size === 0` after `onclose`.

#### [D06] `transport_close` sets `transportState` for every phase (DECIDED) {#d06-transport-close-not-dropped}

**Decision:** The reducer's `transport_close` handler sets `transportState = "offline"` for every phase, including `idle`. The current "drop silently when idle" behavior is removed.

**Rationale:**
- The current drop was correct under the old assumption that `phase` was the only state. Under [D01] there is now an orthogonal axis where transport health matters even when no turn is in flight.
- An `idle` card that loses the wire still needs to show "offline" gating: the user should not be able to submit until the wire is back.
- The phase transition to `errored` is preserved for non-idle phases; transport-state is set in addition to (not instead of) the phase change.

**Implications:**
- Two reducer tests (`reducer.test.ts:588` and `code-session-store.errored.test.ts:124`) need their assertions updated to reflect the new "always sets transportState" behavior.
- The `lastError.cause = "transport_closed"` path stays the same for non-idle phases.

#### [D07] Connection layer emits transport events; reducer owns transitions (DECIDED) {#d07-connection-emits-reducer-owns}

**Decision:** `TugConnection` is the sole emitter of `transport_close` and `transport_open`. `CodeSessionStore` subscribes to both via `connection.onClose` and `connection.onOpen` and dispatches the corresponding event into the reducer. The reducer is the sole owner of the `transportState` value.

**Rationale:**
- This mirrors [L11]: "Controls emit actions; responders own state that actions operate on." The connection layer is the action source; the store reducer is the responder.
- It keeps `TugConnection` free of any per-card store knowledge, and keeps the reducer free of WebSocket lifecycle concerns.
- Symmetrical subscription (`onClose` and `onOpen`) at the store level means any per-card store can be tested in isolation by dispatching events directly, with no fake `TugConnection` required.

**Implications:**
- `code-session-store.ts` adds an `onOpen` subscription alongside the existing `onClose` subscription.
- The first `onOpen` is the mount path: no dispatch. Tracked via `_seenFirstOpen` (see [R03]).
- Future transport-aware stores (e.g., `card-services-store`) follow the same pattern.

#### [D08] First `onOpen` is the mount path, not a reconnect (DECIDED) {#d08-first-open-is-mount}

**Decision:** The first invocation of the `connection.onOpen` callback within a store's lifetime does not dispatch `transport_open`. Subsequent invocations do. The "first open" is tracked per-store, not globally.

**Rationale:**
- A store that mounts after the connection is already open should start in `transportState === "online"`, not `"restoring"`.
- Tracking per-store keeps the policy consistent regardless of when the store mounts in the page lifecycle.
- The connection layer's subscription model already supports this: callbacks registered after open fire immediately, so the per-store guard is the correct place to suppress the spurious initial dispatch.

**Implications:**
- The store reducer treats `transport_open` from `transportState === "online"` as a no-op (defensive double-protection).
- A short comment in the store ties this decision back to [D08].

---

### Deep Dives {#deep-dives}

#### Transport-State Lifecycle {#transport-state-lifecycle}

The state machine for `transportState`:

```
                    transport_close            transport_close
                   ┌──────────────────┐       ┌──────────────────┐
                   ▼                  │       ▼                  │
              ┌─────────┐    transport_open    ┌────────────┐    │
              │ offline │ ─────────────────▶ │ restoring  │ ◀─┐ │
              └─────────┘                    └────────────┘   │ │
                   ▲                                │         │ │
                   │ transport_close                │ binding-arrived
                   │ (from any state)               ▼         │ │
              ┌─────────┐                       ┌────────┐    │ │
              │  online │ ◀───────────────────  │ online │ ───┘ │
              └─────────┘                       └────────┘      │
                                                                │
              (default at construct)                            │
                                                                │
               (transport_close from any state) ────────────────┘
```

Transitions:

| From → To | Event | Notes |
|-|-|-|
| any → `offline` | `transport_close` | Always sets state. [D06] |
| `offline` → `restoring` | `transport_open` | Wire is back; spawn_session(resume) ack pending. |
| `restoring` → `online` | binding-arrived effect | The `cardSessionBindingStore` gained a binding for this card. |
| `online` → `online` | `transport_open` | No-op. [D08] |
| `online` → `restoring` | `transport_open` | Defensive — if a `transport_close` was missed (shouldn't happen in normal flow). |

**Spec S01: transport-state event vocabulary** {#s01-transport-events}

```ts
// events.ts additions
type Event =
  | ...existing
  | { type: "transport_close" }              // existing, behavior changes per [D06]
  | { type: "transport_open" }               // NEW, [D07]
  | { type: "transport_settled" };           // NEW, dispatched on binding-arrived [D04]
```

`transport_settled` is the explicit "the binding for this card landed" event. It's dispatched by the existing `cardSessionBindingStore` subscription path in `tide-session-restore.ts`, which already runs after `spawn_session_ok` populates the binding. The reducer treats `transport_settled` as `transportState = "online"` regardless of prior state.

#### Watchdog Contract {#watchdog-contract}

**Spec S02: client-side heartbeat watchdog** {#s02-watchdog}

```ts
// connection.ts additions
private lastFrameAt: number = Date.now();
private watchdogTimer: number | null = null;

private startWatchdog(): void {
  this.watchdogTimer = window.setInterval(() => {
    if (Date.now() - this.lastFrameAt > HEARTBEAT_TIMEOUT_MS) {
      console.warn("tugdeck: heartbeat watchdog firing — force-closing stale wire");
      this.ws?.close();
    }
  }, WATCHDOG_TICK_MS);
}

// In onmessage (any frame, including HEARTBEAT echo):
this.lastFrameAt = Date.now();
```

Constants:

| Name | Value | Source |
|-|-|-|
| `HEARTBEAT_TIMEOUT_MS` | `45_000` | mirrors `router.rs:48` `HEARTBEAT_TIMEOUT` |
| `WATCHDOG_TICK_MS` | `5_000` | absorbs jitter; small enough to detect within ~5 s of threshold |

Lifecycle:
- `startWatchdog()` runs in the same place as `startHeartbeat()` (after the handshake completes).
- `stopWatchdog()` runs in `stopHeartbeat()` (on close).
- `lastFrameAt` is bumped on every `onmessage` *after the handshake* — including the binary HEARTBEAT echo.

#### Banner UX {#banner-ux}

**Spec S03: banner timing changes** {#s03-banner-timing}

| State | Old timing | New timing |
|-|-|-|
| Disconnect detected | 2 s show-debounce | 0–250 ms show |
| Reconnect | banner hides on `disconnected: false` | banner shows "Reconnected ✓" for ≤ 1.5 s, then hides |
| Restoring sessions | (no equivalent) | banner shows "Restoring sessions…" while any card is in `restoring` |

The "Reconnected" affordance only fires if a banner was actually shown (i.e., on recovery from a *visible* disconnect). The silent-watchdog path — where the wire was broken but the user never saw a banner — does not flash a "Reconnected" message; the user wasn't told there was a problem, so don't tell them it's been fixed.

The "Restoring sessions…" status is a separate transient indicator, driven by the union of all per-card `transportState === "restoring"` states. It clears once every restoring card has flipped to `online` (or the per-card 10 s restore timeout has elapsed).

---

### Specification {#specification}

#### Public API Surface {#public-api}

**`TugConnection` (`tugdeck/src/connection.ts`):**

No new public methods. Internal additions:
- `private lastFrameAt: number`
- `private watchdogTimer: number | null`
- `private startWatchdog()` / `private stopWatchdog()`

`onOpen` and `onClose` registration APIs are unchanged.

**`CardSessionBindingStore` (`tugdeck/src/lib/card-session-binding-store.ts`):**

```ts
// NEW
clearAll = (): void => { ... }
```

Emits a single notify. Replaces the entire `_bindings` map with an empty `Map`.

**`CodeSessionState` and `CodeSessionSnapshot` (`tugdeck/src/lib/code-session-store/types.ts`):**

```ts
// NEW
transportState: "online" | "offline" | "restoring";
```

Default value: `"online"`. Initial state from `createInitialState` includes the field.

**Snapshot:**
```ts
canSubmit: phase ∈ {idle, errored} && transportState === "online";
```

**`Event` (`tugdeck/src/lib/code-session-store/events.ts`):**

```ts
// NEW
| { type: "transport_open" }
| { type: "transport_settled" }
```

Existing `transport_close` keeps its name; reducer behavior changes per [D06].

**`restoreTideSessions` (`tugdeck/src/lib/tide-session-restore.ts`):**

```ts
// signature unchanged but body becomes idempotent
export function restoreTideSessions(
  deck: DeckManager,
  tugbank: TugbankClient,
  connection: TugConnection,
  opts?: { reason?: "startup" | "reconnect" },
): void
```

#### Internal Architecture {#internal-architecture}

```
TugConnection ──onOpen────▶ main.tsx                       (1st: mount path; 2nd+: clearAll + restore)
              ──onOpen────▶ CodeSessionStore               (1st: no dispatch; 2nd+: dispatch transport_open)
              ──onClose───▶ CodeSessionStore               (always dispatch transport_close)
              ──watchdog──▶ ws.close() if stale            (defensive, runs every 5 s)

CardSessionBindingStore ──setBinding──▶ tide-session-restore subscriber
                                          └──▶ CodeSessionStore.dispatch(transport_settled)
                                                            (via existing binding-arrival path)
```

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New crates {#new-crates}

None.

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tests/app-test/at0NNN-tide-reconnect-roundtrip.test.ts` | App-test recipe: kill+restart tugcast, verify cards rebind without reload (Step 8). Number assigned at commit time. |
| `tests/app-test/at0NNN-tide-banner-fast-show.test.ts` | App-test recipe: confirm banner appears within ≤ 1 s of disconnect (Step 7). Number assigned at commit time. |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `lastFrameAt` | private field | `tugdeck/src/connection.ts` | Bumped on every `onmessage` post-handshake |
| `watchdogTimer` | private field | `tugdeck/src/connection.ts` | `setInterval` handle |
| `startWatchdog` / `stopWatchdog` | private method | `tugdeck/src/connection.ts` | Lifecycle parallel to heartbeat |
| `HEARTBEAT_TIMEOUT_MS` | const | `tugdeck/src/connection.ts` | `45_000`, mirrors `router.rs` [D02] |
| `WATCHDOG_TICK_MS` | const | `tugdeck/src/connection.ts` | `5_000` |
| `lastPayload.clear()` | call site | `tugdeck/src/connection.ts` `onclose` | [D05] |
| `clearAll` | method | `tugdeck/src/lib/card-session-binding-store.ts` | Single-notify clear |
| `transportState` | field | `tugdeck/src/lib/code-session-store/types.ts` `CodeSessionState`, `CodeSessionSnapshot` | [D01] |
| `transport_open` | event variant | `tugdeck/src/lib/code-session-store/events.ts` | [D07] |
| `transport_settled` | event variant | `tugdeck/src/lib/code-session-store/events.ts` | [D04] |
| `handleTransportClose` | function (modified) | `tugdeck/src/lib/code-session-store/reducer.ts` | No longer drops for idle [D06] |
| `handleTransportOpen` | function (new) | `tugdeck/src/lib/code-session-store/reducer.ts` | Sets `transportState = "restoring"` |
| `handleTransportSettled` | function (new) | `tugdeck/src/lib/code-session-store/reducer.ts` | Sets `transportState = "online"` |
| `_seenFirstOpen` | private field | `tugdeck/src/lib/code-session-store.ts` | Suppresses initial dispatch [D08] |
| `_openUnsub` | private field | `tugdeck/src/lib/code-session-store.ts` | Symmetric to `_closeUnsub` |
| Reconnect handler | inline | `tugdeck/src/main.tsx` | Calls `clearAll` + `restoreTideSessions(..., { reason: "reconnect" })` on second-and-subsequent opens |
| `SHOW_DELAY_MS` | const (modified) | `tugdeck/src/components/chrome/tug-banner-bridge.tsx` | Reduced from 2000 to ≤ 250 |
| Reconnected affordance | new render branch | `tugdeck/src/components/chrome/tug-banner-bridge.tsx` | ≤ 1.5 s positive-tone banner |
| Restoring-sessions status | new render branch | `tugdeck/src/components/chrome/tug-banner-bridge.tsx` | Driven by the union of per-card `transportState === "restoring"` |
| `transportState` read | new render gate | `tugdeck/src/components/tugways/cards/tide-card-content.tsx` | Renders `TideRestoring` while `restoring`; gates submit button |

---

### Documentation Plan {#documentation-plan}

- [ ] Update [tuglaws/tuglaws.md](../tuglaws/tuglaws.md) reference list in `code-session-store` and `connection` headers if any new law-touching pattern emerges (none expected — this is a pure additive transport axis).
- [ ] Update [tuglaws/card-state-model.md](../tuglaws/card-state-model.md) §"State axes" to mention `transportState` alongside `phase`, with a one-paragraph note on orthogonality (per [D01]).
- [ ] Update [tugplan-tide-card-polish.md §step-7-5](./tugplan-tide-card-polish.md#step-7-5) to a one-line redirect to this plan (lands as part of Step 0).
- [ ] No README changes; this is internal architecture.

---

### Test Plan Concepts {#test-plan-concepts}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Reducer unit** | Direct dispatch into the reducer; assert `transportState` and `lastError` transitions | All transport-event behaviors; `_seenFirstOpen` gating |
| **Connection unit** | Mock `WebSocket` and timers; assert watchdog force-closes; assert `lastPayload` cleared on close | Watchdog timing, snapshot-cache hygiene |
| **Snapshot integration** | Drive a real `CodeSessionStore` instance and a fake `TugConnection`; assert `canSubmit` toggles correctly | Cross-axis gating (phase × transportState) |
| **App-test (`just app-test`)** | Run against the built app; observe DOM after kill+restart of tugcast | End-to-end reconnect round-trip; banner fast-show |
| **Manual smoke** | OS-level scenarios that don't fit harnesses | Laptop-sleep half-open detection; subjective banner-UX review |

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step is one commit. The build stays green at every commit. References are mandatory.

#### Step 0 — Land plan + redirect {#step-0}

<!-- Step 0 has no dependencies (it is the root) -->

**Commit:** `roadmap: add tide connection-health plan; redirect step 7.5`

**References:** [#strategy], [#context], [tugplan-tide-card-polish.md §step-7-5](./tugplan-tide-card-polish.md#step-7-5)

**Artifacts:**
- `roadmap/tugplan-tide-connection-health.md` (this document, new)
- `roadmap/tugplan-tide-card-polish.md` Step 7.5 reduced to a one-line pointer to this plan; the `{#step-7-5}` anchor stays so existing internal references resolve.

**Tasks:**
- [ ] Write this plan into `roadmap/`.
- [ ] Edit `tugplan-tide-card-polish.md` Step 7.5 to a redirect line; preserve the `{#step-7-5}` anchor.
- [ ] Verify all internal references in `tugplan-tide-card-polish.md` to `[Step 7.5](#step-7-5)` still resolve to the redirect.

**Tests:**
- [ ] Manual: open both files in the editor; confirm anchors resolve and the redirect line is unambiguous.

**Checkpoint:**
- [ ] `grep -n "step-7-5" roadmap/tugplan-tide-card-polish.md` shows only the redirect line and the anchor.
- [ ] `git diff --stat` shows two files changed: the new plan and the parent plan's Step 7.5 redirect.

---

#### Step 1 — Reconnect-aware `restoreTideSessions` {#step-1}

**Depends on:** #step-0

**Commit:** `tugdeck: re-restore tide sessions on every websocket re-open`

**References:** [D04], [D07], Spec S01, (#transport-state-lifecycle, #internal-architecture)

**Artifacts:**
- `tugdeck/src/lib/card-session-binding-store.ts` — add `clearAll()` with single notify.
- `tugdeck/src/lib/tide-session-restore.ts` — accept `opts?: { reason?: "startup" | "reconnect" }`; add to `logSessionLifecycle("restore.fired_resume_spawns", { ..., reason })`. Body remains idempotent across calls.
- `tugdeck/src/main.tsx` — install `connection.onOpen(...)` that, on every open *after* the first, calls `cardSessionBindingStore.clearAll()` and then `restoreTideSessions(deck, tugbankClient, connection, { reason: "reconnect" })`. Track `_seenFirstOpen` locally inside the closure.

**Tasks:**
- [ ] Add `clearAll` to `CardSessionBindingStore`.
- [ ] Extend `restoreTideSessions` with the `opts` parameter and pass `reason` into the lifecycle log.
- [ ] In `main.tsx`, register the post-first-open handler that clears bindings then re-runs restore.
- [ ] Confirm the new handler does not interfere with the existing `signalReady` `onOpen` registration (both fire; order doesn't matter).

**Tests:**
- [ ] Reducer-adjacent unit test: `cardSessionBindingStore.clearAll()` after several `setBinding` calls fires exactly one notify and leaves `getSnapshot().size === 0`.
- [ ] Connection-integration unit test: with a fake `TugConnection` that supports replaying `onOpen` callbacks, simulate `connect → open → close → reconnect → open`. Assert `restoreTideSessions` is called exactly twice (once for first open, once for re-open) and that `clearAll` runs between them. Reuse the `tide-session-restore` test helpers if they exist.

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit` green.
- [ ] `cd tugdeck && bun test src/lib/card-session-binding-store src/lib/tide-session-restore` green.
- [ ] `cd tugdeck && bun run audit:tokens lint` green.
- [ ] Manual: in a running tugdeck with HMR, `pkill -x tugcast` then wait for tugcast to respawn; confirm the previously-bound tide card flips its body in without a page reload and submitting `> hi` works.

---

#### Step 2 — Client-side heartbeat watchdog {#step-2}

**Depends on:** #step-1

**Commit:** `tugdeck: client-side heartbeat watchdog mirrors server timeout`

**References:** [D02], Spec S02, Risk R01, (#watchdog-contract)

**Artifacts:**
- `tugdeck/src/connection.ts` — add `lastFrameAt`, `watchdogTimer`, `HEARTBEAT_TIMEOUT_MS = 45_000`, `WATCHDOG_TICK_MS = 5_000`. Add `startWatchdog` / `stopWatchdog`. Bump `lastFrameAt` in `onmessage` post-handshake. Stop watchdog in `onclose`.

**Tasks:**
- [ ] Add the constants with an explicit comment naming `router.rs:48` as the source of truth for the threshold ([D02]).
- [ ] Initialize `lastFrameAt = Date.now()` after handshake completes (in the same block that calls `startHeartbeat`).
- [ ] Bump `lastFrameAt` on every `onmessage` after the handshake-pending branch returns. Include the binary HEARTBEAT echo path.
- [ ] Start the watchdog timer in `startHeartbeat` (or in a parallel `startWatchdog` called from the same site). Stop in `stopHeartbeat`.
- [ ] In the watchdog tick, if `Date.now() - lastFrameAt > HEARTBEAT_TIMEOUT_MS`, call `this.ws?.close()` and log a warn. The existing `onclose` path schedules reconnect.

**Tests:**
- [ ] Connection unit test (with mocked `WebSocket` and fake timers): construct a `TugConnection`, complete the handshake, advance fake time by 50 s without delivering any frame, advance the watchdog tick. Assert `ws.close` was called.
- [ ] Connection unit test: as above, but deliver a frame at t=30 s. Assert no force-close at t=50 s; assert force-close at t=80 s.

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit` green.
- [ ] `cd tugdeck && bun test src/connection` green.
- [ ] `cd tugdeck && bun run audit:tokens lint` green.
- [ ] Manual (qualitative; no recipe): observe console — under normal use the watchdog never fires; force a wire stall (e.g., `kill -STOP <tugcast pid>` then `kill -CONT` after 60 s) and confirm a force-close + reconnect within ~5 s of the threshold.

---

#### Step 3 — Clear `lastPayload` on close {#step-3}

**Depends on:** #step-2

**Commit:** `tugdeck: clear lastPayload snapshot cache on websocket close`

**References:** [D05], (#internal-architecture)

**Artifacts:**
- `tugdeck/src/connection.ts` — `this.lastPayload.clear()` in the `onclose` handler before `notifyDisconnectState` and before reconnect scheduling.

**Tasks:**
- [ ] Add the `lastPayload.clear()` call in `onclose`. Place it after `stopHeartbeat()` but before `notifyDisconnectState(false)` so any subscriber that re-registers in response to the disconnect state does not see stale frames.
- [ ] Add a one-line comment naming [D05].

**Tests:**
- [ ] Connection unit test: register a callback for a feed, deliver a frame to populate the cache, simulate `onclose`, register a *new* callback for the same feed. Assert the new callback receives no replay.

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit` green.
- [ ] `cd tugdeck && bun test src/connection` green.

---

#### Step 4 — Add `transportState` to per-card store {#step-4}

**Depends on:** #step-3

**Commit:** `tugdeck: add transportState to code-session-store`

**References:** [D01], [D06], Spec S01, (#transport-state-lifecycle)

**Artifacts:**
- `tugdeck/src/lib/code-session-store/types.ts` — add `transportState: "online" | "offline" | "restoring"` to `CodeSessionState` and `CodeSessionSnapshot`. Default `"online"` in `createInitialState`.
- `tugdeck/src/lib/code-session-store/events.ts` — add `transport_open` and `transport_settled` event variants.
- `tugdeck/src/lib/code-session-store/reducer.ts` — rework `handleTransportClose` to set `transportState = "offline"` for every phase (no longer dropped for idle). Set `lastError.cause = "transport_closed"` only for non-idle phases (preserve current error semantics for those). Add `handleTransportOpen` and `handleTransportSettled`. Wire them into the dispatch switch.
- `tugdeck/src/lib/code-session-store.ts` — `getSnapshot` includes `transportState`. `canSubmit` becomes `(phase === "idle" || phase === "errored") && transportState === "online"`.

**Tasks:**
- [ ] Extend the type definitions; let TypeScript guide the cascading default-value updates.
- [ ] Update `createInitialState` to include `transportState: "online"`.
- [ ] Rework `handleTransportClose` per [D06]; update existing reducer tests that assert "drops for idle" to the new behavior.
- [ ] Add `handleTransportOpen` (sets `transportState = "restoring"` from any prior state; treat from `online` as a no-op per [D08]).
- [ ] Add `handleTransportSettled` (sets `transportState = "online"`).
- [ ] Update `canSubmit` and the snapshot-equality cache check.

**Tests:**
- [ ] Reducer unit: `transport_close` from each phase → `transportState === "offline"`. Phase preserved for idle (no longer flips to errored); flips to errored for non-idle phases as before.
- [ ] Reducer unit: `transport_open` from `offline` → `restoring`. From `online` → no-op (state reference unchanged).
- [ ] Reducer unit: `transport_settled` from any state → `online`.
- [ ] Snapshot integration: drive a store through `online → offline → restoring → online`; assert `canSubmit` follows.

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit` green.
- [ ] `cd tugdeck && bun test src/lib/code-session-store` green.
- [ ] `cd tugdeck && bun run audit:tokens lint` green.

---

#### Step 5 — Wire `transport_open` from the connection {#step-5}

**Depends on:** #step-4

**Commit:** `tugdeck: code-session-store dispatches transport_open on reconnect`

**References:** [D07], [D08], Risk R03, (#internal-architecture)

**Artifacts:**
- `tugdeck/src/lib/code-session-store.ts` — add `_openUnsub` field; subscribe to `connection.onOpen` in the constructor alongside the existing `onClose` subscription. Track `_seenFirstOpen: boolean` initialized to `false`. The first `onOpen` flips the flag and does not dispatch; subsequent opens dispatch `transport_open`.
- `tugdeck/src/lib/tide-session-restore.ts` — when the `cardSessionBindingStore` subscriber observes a binding for a card, dispatch `transport_settled` into the per-card store (in addition to the existing `tideRestoreRegistry._clear` path). Requires a way to reach the per-card store from `tide-session-restore`; the binding-arrival path already runs in module scope, so this means looking up the store via the existing card→store registry.

**Tasks:**
- [ ] Add `_openUnsub` and `_seenFirstOpen` to `CodeSessionStore`.
- [ ] In the constructor, after subscribing to `onClose`, subscribe to `onOpen`. Inside the callback, if `!this._seenFirstOpen` then set the flag and return without dispatch; else dispatch `transport_open`.
- [ ] In the dispose path, unsubscribe from `onOpen` (if unsub returned).
- [ ] Verify `connection.onOpen` returns an unsub function — if not, extend it to do so (matching the shape of `onClose`).
- [ ] In `tide-session-restore.ts`, in the `cardSessionBindingStore` subscriber, after `tideRestoreRegistry._clear(cardId)`, dispatch `transport_settled` into the corresponding store. Use the existing card-store registry lookup (or thread the dispatch through an effect).

**Tests:**
- [ ] Store unit: with a fake `TugConnection` that supports `triggerOpen()` and `triggerClose()`, construct a store. Trigger one `open` → no dispatch (mount path). Trigger `close` → `transport_close` dispatched. Trigger `open` → `transport_open` dispatched.
- [ ] Store unit: with a fresh store and a connection that is already open (subscriber fires immediately on register), assert no spurious initial dispatch.
- [ ] Integration: drive the store through a full `connect → open → close → reconnect → open → binding-arrived` cycle; assert `transportState` walks `online → offline → restoring → online`.

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit` green.
- [ ] `cd tugdeck && bun test src/lib/code-session-store src/lib/tide-session-restore` green.

---

#### Step 6 — Surface transport state in UI; gate submit {#step-6}

**Depends on:** #step-5

**Commit:** `tugdeck: gate tide submit on transportState; render restoring placeholder`

**References:** [D01], [D04], (#transport-state-lifecycle, #public-api)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/tide-card-content.tsx` (or `tide-card.tsx`, whichever owns the body switch) — read `transportState` from the per-card snapshot. Render `TideRestoring` (the existing placeholder) when `transportState === "restoring"`, in addition to the existing `tideRestoreRegistry`-driven branch. Gate the submit button: `disabled` while `transportState !== "online"`, with a tooltip / status-row note explaining "Reconnecting to tugcast…" or "Restoring session…".

**Tasks:**
- [ ] Read `transportState` from `useSyncExternalStore` (it already lives in the snapshot per Step 4 — no parallel React state, [L02]).
- [ ] Update the body switch: if `transportState === "restoring"`, render `TideRestoring`. Combine with the existing `tideRestoreRegistry` check using OR (both paths can apply during the brief overlap; rendering `TideRestoring` is idempotent).
- [ ] Update the submit button `disabled` prop and add an `aria-disabled` reason or status-row hint.
- [ ] Confirm no React state is added — all data flows from the snapshot ([L02]).

**Tests:**
- [ ] Component test (happy-dom OK per `feedback_no_happy_dom_tests` — pure component markup): render `TideCardContent` with each of the three `transportState` values via a fake snapshot; assert correct body branch and submit-button state.
- [ ] Snapshot integration: dispatch `transport_close → transport_open` into a store mounted in a real `TideCard`; assert the rendered output transitions through the placeholder and back without React re-render flooding (snapshot reference stable per [L02]).

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit` green.
- [ ] `cd tugdeck && bun test src/components/tugways/cards` green.
- [ ] `cd tugdeck && bun run audit:tokens lint` green.
- [ ] Manual (HMR): kill+restart tugcast; confirm the card visibly flips into `TideRestoring` and the submit button disables, then both clear when the binding lands.

---

#### Step 7 — Banner UX tightening {#step-7}

**Depends on:** #step-6

**Commit:** `tugdeck: tighten banner timing; add reconnected and restoring states`

**References:** Spec S03, (#banner-ux)

**Artifacts:**
- `tugdeck/src/components/chrome/tug-banner-bridge.tsx` — reduce `SHOW_DELAY_MS` from `2000` to `≤ 250` (or remove the debounce and rely on the disconnect callback timing). Add a "Reconnected ✓" affordance that shows for ≤ 1.5 s on recovery from a *visible* disconnect (track `wasShown: boolean` to gate). Add a "Restoring sessions…" status driven by the union of per-card `transportState === "restoring"` (subscribe via the existing per-card registry — read-only).
- `tests/app-test/at0NNN-tide-banner-fast-show.test.ts` (new) — kill the tugcast subprocess from the harness, observe the banner DOM appears within ≤ 1 s. Recipe ends with `VERDICT: PASS|FAIL`.

**Tasks:**
- [ ] Lower `SHOW_DELAY_MS` to 250 ms (or zero with a 1-tick guard, whichever the existing test infra accepts cleanly).
- [ ] Add the `wasShown` state machine that flips when the banner becomes visible and gates the "Reconnected" affordance.
- [ ] Add the `restoringCount` subscription; show the status string when `> 0`.
- [ ] Author the app-test recipe per the `feedback_just_app_test` memory: ends with greppable `VERDICT: PASS|FAIL`.

**Tests:**
- [ ] Component test: simulate a `disconnected: true` callback; assert banner is visible at t = 250 ms (was: 2000 ms).
- [ ] Component test: simulate `disconnected: true` then `disconnected: false` while `wasShown === true`; assert "Reconnected" affordance renders, then disappears at t ≤ 1.5 s.
- [ ] Component test: with a fake per-card registry that yields one card in `restoring`, assert "Restoring sessions…" text renders.
- [ ] App-test: `just app-test at0NNN-tide-banner-fast-show.test.ts` exits with `VERDICT: PASS`.

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit` green.
- [ ] `cd tugdeck && bun test src/components/chrome` green.
- [ ] `just app-test at0NNN-tide-banner-fast-show.test.ts` final line is `VERDICT: PASS`.

---

#### Step 8 — Integration Checkpoint {#step-8}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5, #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** [D01], [D02], [D04], [D06], [D07], (#success-criteria)

**Artifacts:**
- `tests/app-test/at0NNN-tide-reconnect-roundtrip.test.ts` (new) — kill+restart tugcast end-to-end; verify card binding flips through `online → offline → restoring → online` without page reload; verify submit works after recovery. Recipe ends with `VERDICT: PASS|FAIL`.

**Tasks:**
- [ ] Author the end-to-end app-test recipe.
- [ ] Walk the [#tuglaws-cross-check] list; record the result in the commit message of Step 7's *previous* commit, or in a `tuglaws-walkthrough` log entry if the project keeps one.
- [ ] Spot-check the [#success-criteria] list against current behavior; flag any criterion that does not hold.

**Tests:**
- [ ] App-test: `just app-test at0NNN-tide-reconnect-roundtrip.test.ts` exits with `VERDICT: PASS`.
- [ ] Manual scenario (no recipe — laptop sleep is awkward to orchestrate): open a tide card, sleep the laptop for ~2 minutes, wake. The watchdog detects the silent half-open within ~45 s of wake, force-reconnects, the card flips through `restoring → online`, submit works. Note observed timing in the commit message.
- [ ] Manual scenario (no recipe): kill+restart tugcast faster than the old 2 s show-debounce. Banner still shows briefly; cards still flip through `restoring`; submit works again.

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit` green.
- [ ] `cd tugdeck && bun test` (full suite) green.
- [ ] `cd tugdeck && bun run audit:tokens lint` green.
- [ ] `cd tugrust && cargo nextest run` green.
- [ ] `just app-test at0NNN-tide-reconnect-roundtrip.test.ts` and the banner recipe both end with `VERDICT: PASS`.
- [ ] All [#success-criteria] entries verifiable.

---

### Tuglaws Cross-Check {#tuglaws-cross-check}

Per the `feedback_tuglaws_cross_check` memory and the constraint in [#constraints], every step that touches the connection layer, the per-card store, or the banner re-checks against [tuglaws.md](../tuglaws/tuglaws.md). The following laws apply:

- **[L02] External state enters React through `useSyncExternalStore` only.** `transportState` is added to the existing `code-session-store` snapshot (Step 4) and read via the existing `useSyncExternalStore` path. No parallel React state. The banner reads its inputs via the same pattern.
- **[L03] Use `useLayoutEffect` for registrations that events depend on.** `connection.onOpen` and `connection.onClose` registrations live at module scope before any React render (existing pattern in `code-session-store.ts:155`); the new `onOpen` subscription added in Step 5 follows the same shape.
- **[L11] Controls emit actions; responders own state.** `transport_close`, `transport_open`, and `transport_settled` are dispatched events on the per-card store. The connection layer is the emitter; the reducer owns the state transitions. See [D07].
- **[L23] Internal implementation operations must never lose, destroy, or cease to apply user-visible state.** Reconnect must not lose the user-visible transcript. The transcript already accumulated in the store is preserved across `transport_close` / `transport_open` / `transport_settled` cycles. Only `transportState`, the inflight buffers, and gating change. The submit-button gating is purely additive — no in-flight content is discarded. The `lastPayload.clear()` discards only server-authoritative cached frames that are about to be replayed by the post-reconnect handshake.

The walkthrough is recorded in Step 8's tuglaws-walkthrough verification.

---

### Compatibility / Migration / Rollout {#rollout}

- **Compatibility policy:** Internal architecture only. No public API or wire-format changes. No tugcast changes. No tugbank schema changes.
- **Migration plan:** None. `transportState` defaults to `"online"`; existing stores work without dispatching transport events.
- **Rollout plan:** Lands on `tugplan-tide-connection-health` branch behind no feature flag. Each step is a green commit; the branch can be merged to `main` once Step 8 passes.
- **Rollback strategy:** Revert the merge commit. No persistent state is introduced; transport state is in-memory only.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Tide cards rebind without a page reload after a tugcast restart, and the client detects half-open WebSocket states within ~45 s.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] All eight execution steps committed; each commit's checkpoint passes.
- [ ] `cd tugdeck && bun x tsc --noEmit` green on `main` after merge.
- [ ] `cd tugdeck && bun test` green on `main` after merge.
- [ ] `cd tugdeck && bun run audit:tokens lint` green on `main` after merge.
- [ ] `cd tugrust && cargo nextest run` green on `main` after merge.
- [ ] `just app-test at0NNN-tide-reconnect-roundtrip.test.ts` and the banner-fast-show recipe both `VERDICT: PASS`.
- [ ] [#success-criteria] all hold under manual smoke.

**Acceptance tests:**
- [ ] App-test: `at0NNN-tide-reconnect-roundtrip.test.ts` `VERDICT: PASS`.
- [ ] App-test: `at0NNN-tide-banner-fast-show.test.ts` `VERDICT: PASS`.
- [ ] Reducer + store unit tests under `tugdeck/src/lib/code-session-store/__tests__/` covering all transport-event transitions.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Server-pushed `client_recognized { sessions: [...] }` frame for defense-in-depth (deferred per [D03]).
- [ ] Telemetry on watchdog firings vs `onclose` arrivals — useful for tuning the threshold if real-world data suggests drift.
- [ ] Apply the same transport-state pattern to `card-services-store` if that store grows wire-dependent state.

| Checkpoint | Verification |
|------------|--------------|
| Step 0 plan landed and Step 7.5 redirect | `grep -n "step-7-5" roadmap/tugplan-tide-card-polish.md` shows the redirect |
| Step 1 reconnect-aware restore | Manual: `pkill -x tugcast`, observe rebind without reload |
| Step 2 watchdog fires on stale wire | Connection unit test green |
| Step 3 `lastPayload` cleared on close | Connection unit test green |
| Step 4 `transportState` field present | Reducer unit tests green |
| Step 5 `transport_open` dispatched on reconnect | Store unit test green |
| Step 6 UI gates on `transportState` | Component test green; manual: card disables submit during reconnect |
| Step 7 banner UX | Component tests green; `just app-test` banner recipe `VERDICT: PASS` |
| Step 8 integration | `just app-test` reconnect recipe `VERDICT: PASS`; manual sleep/wake check noted |
