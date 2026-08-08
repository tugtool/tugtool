<!-- devise-skeleton v4 -->

## Sparkline Registration and Dormancy Hardening {#sparkline-improvements}

**Purpose:** Make `TugSparkline` draw a correct, continuously-registered tape on every surface it is mounted on — by putting the tape's time axis and its scroll animation on one clock, by never moving the scroll transform before the pixels for that position exist, and by making the visibility gate stop churning inside a scrolling list.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-08-08 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The activity sparkline (`tugdeck/src/components/tugways/tug-sparkline.tsx`) is mounted on four surfaces with the same component and, on two of them, literally the same numbers: the Session card's PULSE strip (`tugdeck/src/components/tugways/cards/session-pulse-strip.tsx`, 64×22), the Lens Cards section's session monitor row (`tugdeck/src/components/lens/sections/cards-session-cell.tsx`, also 64×22 via `TUG_SESSION_ROW_SPARK_WIDTH` / `TUG_SESSION_ROW_SPARK_HEIGHT` in `tugdeck/src/components/tugways/tug-session-row.tsx`), the expanded Pulse card's per-channel rows (`tugdeck/src/components/tugways/cards/pulse-card.tsx`, 248×26), and the Pulse Display gallery card (`tugdeck/src/components/tugways/cards/gallery-pulse-display.tsx`).

In practice the Lens tape **judders** and, less often, renders **blank or truncated** — the staircase jammed into part of the box with the rest empty — while the Session card's tape does neither. Since the two mounts are configuration-identical, the difference is not in the tape's settings; it is in how often each surface makes the tape *rebase*, and the rebase has two latent defects (see [#the-two-defects](#the-two-defects)). The Lens hits them constantly because its tapes live inside a `TugListView` scroll container whose rows change height on every pulse beat, so `TugSparkline`'s `IntersectionObserver` toggles them in and out of dormancy repeatedly; the Session card has one always-visible tape that essentially never rebases outside its 120-second epoch rollover.

Why now: the sparkline is the one piece of live ink on the Lens rail, and the Lens rail is the surface a user watches while *not* looking at a card. A tape that stutters or blanks there is the monitor lying about the thing it exists to report.

#### Strategy {#strategy}

- **Fix the clock first.** The tape positions ink by `Date.now()` and positions the canvas by `document.timeline`. Unify both onto `performance.now()` and make `t0` a *derived* value of the animation's own origin, so the two axes cannot disagree by construction.
- **Never move the transform ahead of the pixels.** Every place `t0` changes today resets the transform synchronously and repaints asynchronously through the render worker. Gate the transform change on a paint acknowledgement, with a free fast path when the visible picture is flat (translation-invariant).
- **Split the two dormancies.** "Every change has scrolled off" (flat, safe to rebase freely) and "the element is off screen" (arbitrary picture, must not rebase) are different states that today share one code path. Separate them; the off-screen one becomes a `pause()`, not a teardown.
- **Stop the visibility gate from flapping.** Observe against the nearest scroll container with a generous `rootMargin` and a hysteresis delay before pausing. Dormancy is an optimisation; entering it eagerly is what creates the churn.
- **Extract the policy so it can be tested without a DOM.** The clock, the tape, the dormancy protocol, and the rebase ordering move to a pure module driven by an injected clock and an output port. The component keeps only the DOM: WAAPI, the worker, the observer, computed style.
- **Sequence so each step is independently shippable.** Refactor (behaviour-preserving) → clock → ack protocol → rebase ordering → dormancy → observer → self-healing → backing store → tests.

#### Success Criteria (Measurable) {#success-criteria}

- `grep -c "Date.now()" tugdeck/src/components/tugways/tug-sparkline.tsx tugdeck/src/lib/sparkline-tape.ts` returns `0` for both files — the tape runs on one monotonic clock.
- For any sequence of clock values, `SparklineTape`'s reported `t0` satisfies `t0 === epochOrigin + n * EPOCH_MS` exactly, and the expected transform equals `-(now - t0) / 1000 * pxPerSec` — asserted by unit test in `tugdeck/src/lib/__tests__/sparkline-tape.test.ts`.
- In the recorded surface trace of the policy module, **every** `setEpochStart` call is immediately preceded by a `paintAcked` for the paint that carries the same `t0`, *or* by a paint whose visible window was flat — no unordered pair exists in any test scenario (unit test).
- A hidden→visible cycle produces zero animation teardowns: the recorded trace contains `pause` / `resume`, and never `cancelAnimation` / `createAnimation`, outside mount and unmount (unit test).
- In the real app, a Lens session row scrolled out of and back into its section body three times still reports exactly one animation: `document.querySelector('.sessions-monitor-spark .tug-sparkline-track').getAnimations().length === 1` and `playState === 'running'` (app-test `at0370`).
- After a devicePixelRatio change, `canvas.width === Math.ceil(svgWidth * devicePixelRatio)` on every mounted tape (app-test `at0370`).
- `bunx vite build` and `cd tugdeck && bun test` both clean; `just app-test at0370-sparkline-registration.test.ts at0282-pulse-two-level.test.ts` green.

#### Scope {#scope}

1. `tugdeck/src/components/tugways/tug-sparkline.tsx` — clock unification, rebase ordering, dormancy split, observer hardening, backing-store correctness.
2. New `tugdeck/src/lib/sparkline-tape.ts` — the extracted, DOM-free tape/clock/dormancy policy.
3. `tugdeck/src/lib/workers/sparkline-render-worker.ts` and its `SparklineWorkerRequest` type — add a paint acknowledgement message.
4. `tugdeck/src/lib/sparkline-geometry.ts` — unchanged geometry, but its `SparklinePoint.t` contract is restated as monotonic-clock ms.
5. `tugdeck/src/test-surface.ts` — a `recordActivity` hook so an app-test can drive the real `SessionActivityStore` deterministically.
6. New `tests/app-test/at0370-sparkline-registration.test.ts`.
7. New `tugdeck/src/lib/__tests__/sparkline-tape.test.ts`.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Changing what the tape *plots*: the rolling-rate window, `sparklineCurves`, `fullScale`, `ACTIVITY_BIN_MS`, the composite/dominant logic in `tugdeck/src/lib/session-activity-store.ts`. This plan is about registration, not response.
- Redesigning the sample-and-hold staircase in `tugdeck/src/lib/sparkline-geometry.ts`.
- Reducing the canvas's surface area (`svgWidth = width + EPOCH_S * pxPerSec + 8`, currently 584 CSS px per Lens row and 2240 per Pulse-card channel row). Recorded as a follow-on in [#roadmap](#roadmap).
- Changing the Lens's list virtualisation or `TugListView`'s `offscreenSkip` (which the Lens does not enable — only the transcript does).
- Any change to `tug-chart-glyph.tsx`, which is a static font-glyph sparkline with no tape at all.

#### Dependencies / Prerequisites {#dependencies}

- None outside the repo. All work is in `tugdeck/` plus one new app-test.
- Requires `bun` (never npm) for the deck; `bunx vite build` before declaring any tugdeck change done, because the debug app loads the prod rollup bundle.

#### Constraints {#constraints}

- **[L13]** motion is a WAAPI transform or TugAnimator — never an rAF/timer frame loop. The sample timer stays a data timer, not an animation loop.
- **[L06]** appearance is CSS + DOM attributes, never React state. The tape, `t0`, dormancy, and the `data-activity-channel` stamp all stay out of React.
- **[L02]** external state enters React only via `useSyncExternalStore` — the sparkline reads `SessionActivityStore` imperatively, which stays legal because nothing it reads is rendered.
- **[L26]** mount identity must be stable across logical transitions. `HTMLCanvasElement.transferControlToOffscreen()` may be called **once per element**, so any geometry or DPR change must arrive as a *new* element (a changed `key`), never a second transfer of a spent one.
- **[L27]** every acquisition returns its release: the worker entry, the observer, the theme subscription, and the animation are all released in the effect's cleanup.
- **[L03]** setup that events depend on goes in `useLayoutEffect`.
- App-tests run in **background windows with no rAF** and a possibly-suspended rendering pipeline (see `tuglaws/app-test-harness.md` and the harness notes). Nothing in the app-test may depend on animation frames advancing; assertions must read state that is correct synchronously.
- Warnings are errors in the Rust workspace; no Rust in this plan, but `tsc`/lint cleanliness is expected, including pre-existing issues surfaced in touched files.

#### Assumptions {#assumptions}

- `document.timeline.currentTime` and `performance.now()` share the document's time origin, so an `Animation.startTime` may be set from `performance.now()` directly. (Verified against the Web Animations spec; pinned by a unit assertion in [#step-2](#step-2) that reads both and asserts agreement within one frame.)
- Setting `Animation.startTime` explicitly on a freshly created animation clears its pending start time, removing the "animation begins at the next rendering update" slop the current code inherits.
- A worker that posts an acknowledgement at the end of its `onmessage` draw handler has already queued the `OffscreenCanvas` commit for that frame; the ack is therefore a sound (if not frame-exact) proxy for "the pixels exist". Residual risk recorded as [Risk R02](#r02-ack-not-frame-exact).
- The Lens does not enable `TugListView`'s `offscreenSkip` (confirmed: the only caller is `session-card-transcript.tsx`), so `content-visibility: auto` is not a factor in the Lens symptoms.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

Standard devise conventions apply: explicit `{#anchor}` headings, kebab-case, plan-local decisions `[P01]`+, open questions `[Q01]`+, risks `R01`+, specs `S01`+. `[D##]` is reserved for `tuglaws/design-decisions.md`.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Does the document timeline stall while the Tug window is occluded? (OPEN) {#q01-timeline-stall}

**Question:** When a Tug window is fully covered by another window, WebKit suspends rendering updates. `performance.now()` keeps advancing. Does `document.timeline.currentTime` — and therefore a running `Animation`'s `currentTime` — advance with it, or does it hold?

**Why it matters:** If the timeline holds, then on un-occlusion the animation is behind wall clock by the occlusion duration, and the tape's ink (positioned by `performance.now()`) is drawn at a position the transform has not reached. The tape would appear shifted until the next rebase. This is a plausible contributor to the reported judder, and it is exactly the class of failure the "registration self-check" in [#step-7](#step-7) exists to absorb.

**Options (if known):**
- Timeline is wall-clock-based and does not stall → the self-check is a cheap no-op safety net.
- Timeline stalls with rendering → the self-check is load-bearing and must also run on `visibilitychange`.

**Plan to resolve:** The design does not branch on the answer. [#step-7](#step-7) implements the self-check unconditionally (compare the animation's implied position against the clock's on every settle-burst append; correct sub-pixel drift in place, escalate a large divergence to an ack-gated rebase) plus a `visibilitychange` resync. A diagnostic assertion in the app-test records the observed divergence after a forced occlusion so the answer gets written down.

**Resolution:** DEFERRED — absorbed by the self-healing design in [P06](#p06-registration-self-check) rather than answered up front. Revisit only if the app-test's recorded divergence is large enough to be visible between two settle-burst ticks (250 ms).

#### [Q02] Should the epoch length shrink now that rollover is cheap? (OPEN) {#q02-epoch-length}

**Question:** `EPOCH_S = 120` forces `svgWidth = width + 120 * pxPerSec + 8` — 584 CSS px (1168 device px at dpr 2) per Lens row, and 2240 CSS px (4480 device px) per Pulse-card channel row, of which seven can be mounted at once in the Pulse popover (≈6.5 MB of backing store). Once rollover is glitch-free and free of animation teardown, epoch length is a pure texture-vs-rebase-frequency trade.

**Why it matters:** Memory cost scales linearly with `EPOCH_S`, and the Lens can hold a dozen rows.

**Plan to resolve:** Not in this phase — changing `EPOCH_S` changes what the rebase machinery is exercised by, and the machinery should land and be proven at the current value first.

**Resolution:** DEFERRED to [#roadmap](#roadmap). Revisit after [#step-10](#step-10) passes.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Extraction refactor changes tape behaviour silently | med | med | [#step-1](#step-1) is behaviour-preserving and lands with unit tests written against *current* behaviour before any semantic change | Any visual difference on the Session card after Step 1 |
| Paint ack is not frame-exact | low | med | Fast path for flat pictures; `requestAnimationFrame` chaser after the ack | A visible one-frame seam at rollover |
| Worker ack reintroduces main-thread cost | low | low | Ack rides only on paints flagged `ackTransform`, which happen at rebases (rare), never on the 4 Hz sample path | Any regression in `at0293-typing-latency` |
| Hysteresis keeps off-screen tapes live too long | low | low | 500 ms delay only; the tape still goes fully inert via flat-dormancy on its own timer | CPU regression with many Lens rows |
| DPR-driven canvas replacement thrashes | low | low | Keyed on the *quantised* dpr value, changed only by a `matchMedia` resolution transition | Repeated remounts observed in the dev log |

**Risk R01: The extraction hides a behaviour change** {#r01-extraction-hides-change}

- **Risk:** Moving the tape/clock/dormancy protocol out of the component's `useLayoutEffect` closure into a class changes an ordering nobody wrote down.
- **Mitigation:**
  - Step 1 is a pure move: same constants, same call order, same `Date.now()` clock, only the seam changes.
  - The unit tests written in Step 1 encode *current* behaviour (born-dormant, settle-burst stop condition, flat-off scheduling, deadband reference advance) and must stay green through every later step except where a decision explicitly changes them.
- **Residual risk:** Behaviour the current code has by accident and no test captures.

**Risk R02: The worker ack is not frame-exact** {#r02-ack-not-frame-exact}

- **Risk:** The worker's ack proves the draw *ran*, not that the compositor *presented* it. The transform could still move one frame early.
- **Mitigation:**
  - The flat-window fast path means the common rebase (idle rollover, flat-dormancy wake) never needs the ack at all.
  - Apply the transform inside a `requestAnimationFrame` scheduled from the ack handler, so at minimum a full frame boundary separates paint and move.
  - Worst case is a one-frame seam every 120 s instead of the current unbounded blank.
- **Residual risk:** A single-frame artefact under extreme worker backpressure.

**Risk R03: Judder has a contributing cause outside this plan** {#r03-other-causes}

- **Risk:** The diagnosis in [#the-two-defects](#the-two-defects) is derived from code reading, not from an instrumented reproduction. Compositing behaviour inside the Lens rail (a composited layer under `overflow: hidden` inside a scroll container, under `.tug-pulse-trailing`'s `translateY(-3px)`) could contribute independently.
- **Mitigation:**
  - [#step-9](#step-9) adds a `recordActivity` test-surface hook, which makes the symptom reproducible on demand for the first time.
  - The success criteria are stated as invariants of the component's own state machine, so they are falsifiable whether or not the compositor also misbehaves.
- **Residual risk:** Residual judder after all steps land, attributable to layer management rather than registration. Escalate by capturing a WebKit layer tree at that point.

---

### Design Decisions {#design-decisions}

#### [P01] The tape and its scroll share one monotonic clock (DECIDED) {#p01-one-clock}

**Decision:** All tape timestamps (`SparklinePoint.t`, `t0`, `lastChangeAt`, `lastEventAt`) use `performance.now()`. The scroll animation's origin is set explicitly with `anim.startTime = <that same clock value>`, and `t0` is **derived** from the animation origin rather than assigned.

**Rationale:**
- Today `t0` is `Date.now()` and the transform runs on `document.timeline`. The two are never reconciled, so the mapping `xOf(t) = width + (t - t0)/1000 * pxPerSec` in `sparkline-geometry.ts` is only as accurate as the accident that produced `t0`.
- `track.animate(...)` returns an animation with a **pending** start time, resolved at the next rendering update. The line above it already ran `Date.now()`. Whatever separates them is a permanent horizontal offset for the whole 120-second epoch, and it varies per instance and per main-thread load — which is why a rail of tapes drifts apart from each other and from the card.
- `Date.now()` is wall clock: an NTP step or a laptop sleep/wake moves the tape's ink relative to its own motion. `performance.now()` is monotonic.
- Deriving `t0` (`t0 = epochOrigin + floor((now - epochOrigin) / EPOCH_MS) * EPOCH_MS`) removes an entire category of assignment bug: there is no `t0 = now` line left to get wrong.

**Implications:**
- `SparklinePoint.t` is documented as monotonic-clock ms, not wall-clock ms. Nothing persists a tape, so there is no migration.
- The animation is created once per mount and never recreated; the rollover is `anim.startTime += EPOCH_MS`, not `cancel()` + `animate()`.
- The reduced-motion path (`isTugMotionEnabled() === false`) has no animation and therefore no derived origin; it keeps a synthetic origin equal to the newest sample, exactly as today.

#### [P02] A `t0` rebase is applied only when the pixels for that `t0` are already on screen (DECIDED) {#p02-ack-gated-rebase}

**Decision:** The scroll transform is never moved in the same tick as a `t0` change. A rebase is applied by one of two paths: **(a) free** — if the tape's visible window is flat (a single held value edge to edge), any translation is a no-op and the rebase applies immediately; **(b) ack-gated** — otherwise the repaint is posted to the render worker with a sequence number, and the transform is applied from the worker's `painted` acknowledgement, inside a `requestAnimationFrame`.

**Rationale:**
- This is the direct cause of the truncated tape. `startEpoch`, `enterDormant`, and `wakeLive` all change `t0` and reset the transform synchronously, while the repaint travels `postMessage` → shared worker → compositor and lands one or more frames later. In that window the viewport shows the canvas at the new transform with the old pixels, displaced by up to `epochPx` (512 px on a 584 px canvas). Because a tape's ink occupies only about 81 px of that canvas and everything else is unpainted, the viewport frequently lands on blank canvas or on the boundary — a tape with an empty left portion and the staircase jammed to one side.
- The flat fast path is not a heuristic: it is exactly the precondition that `DORMANT_AFTER_MS = (VISIBLE_SECONDS + PRUNE_MARGIN_S) * 1000` was chosen to guarantee. A tape that reached flat-dormancy is provably a horizontal line across the visible window, and a horizontal line is translation-invariant. This is *why* the Session card never shows the defect and the Lens does: the card's rebases are almost always flat ones, and the Lens's off-screen rebases are not.
- Gating on the ack keeps the hot 4 Hz sample path one-directional, which is the worker's documented design contract; only rebase paints carry the flag.

**Implications:**
- `SparklineWorkerRequest`'s `tape` message gains an optional `ack` sequence number, and the worker gains one outbound message type. The main thread must install an `onmessage` handler on the shared worker and route by `id`.
- The on-main fallback painter (used when `transferControlToOffscreen` is unavailable) draws synchronously, so it acks synchronously — one code path, two latencies.
- A rebase that is superseded before its ack arrives is dropped by sequence number.

#### [P03] Off-screen is a pause, not a teardown (DECIDED) {#p03-pause-not-teardown}

**Decision:** `TugSparkline` distinguishes **flat-dormancy** (every change has scrolled off; the tape is inert and the picture is flat) from **hidden-pause** (the element is not intersecting; the picture is arbitrary). Flat-dormancy behaves as today. Hidden-pause calls `anim.pause()` and stops the timers, leaves `t0` and the transform exactly where they are, and rebuilds/resyncs on re-entry through the ack-gated path.

**Rationale:**
- Today both go through `enterDormant`, which does `anim.cancel()` (with `fill: forwards`, cancellation removes the effect and snaps the transform to `translateX(0)`) and `t0 = now`. For a flat picture that is harmless. For the Lens's off-screen rows it is a full-magnitude rebase of a non-flat picture on every scroll boundary crossing — the judder.
- `wakeLive` then rebuilds the entire tape by re-quantising ten seconds of `compositeSeries` history onto the 250 ms bin grid and restarts the epoch from `translateX(0)`. The whole visible staircase re-lands on a different grid, on top of the transform snap.
- Pausing is strictly cheaper than tearing down: no animation object churn, no `onfinish` respawn hazard, and the compositor keeps the layer.

**Implications:**
- `enterDormant` splits into `enterFlatDormancy` and `enterHiddenPause`; the wake paths differ (flat wake may rebase freely, hidden wake must ack-gate).
- The derived `t0` must freeze while paused. Because nothing is painted while paused, freezing is achieved by simply not deriving — the next derivation happens at resume, as part of the ack-gated rebase.

#### [P04] The visibility gate observes the scroll container, with hysteresis (DECIDED) {#p04-observer-hysteresis}

**Decision:** The `IntersectionObserver` uses the nearest scrollable ancestor as its `root` (falling back to the viewport), a `rootMargin` of `"160px 0px"`, and a 500 ms continuous-out-of-view delay before entering hidden-pause. Re-entry is immediate and cancels any pending pause.

**Rationale:**
- Today the observer takes the default root and `threshold: 0`. In the Lens the tape sits inside a `TugListView` scroll container, and rows re-measure constantly: `useMiddleTruncation` in `tug-pulse.tsx` runs a `ResizeObserver` on `.tug-pulse-line` — the sparkline's own parent — and rewrites the clipped activity run on every pulse beat, while `TugPulse`'s headline appears and disappears with the session overview. Rows near the clip edge therefore cross the boundary repeatedly, and each crossing today runs a full teardown-and-rebuild.
- `rootMargin` expands the *root's* rect, so it only helps if the root is the scroller — hence pairing the two.
- Hysteresis is the part that actually stops churn: dormancy is an optimisation, and an optimisation that fires on a 16 ms flap costs more than it saves.

**Implications:**
- A small `nearestScrollableAncestor(el)` helper (computed `overflow-y` of `auto`/`scroll`/`overlay`) lives in the component or `sparkline-tape.ts`'s DOM-adjacent sibling; the policy module stays DOM-free.
- The pause timer is one more thing the effect cleanup must clear ([L27]).

#### [P05] The tape's policy is a DOM-free module; the component is only the DOM (DECIDED) {#p05-policy-extraction}

**Decision:** The clock, the tape array, the deadband/settle/flat-off protocol, dormancy, and the rebase ordering move into `tugdeck/src/lib/sparkline-tape.ts` as a `SparklineTape` class taking an injected `now()` and a `SparklineSurface` output port. `TugSparkline` keeps the canvas claim, WAAPI, the `IntersectionObserver`, computed-style colour resolution, and the worker wiring.

**Rationale:**
- The rebase-ordering guarantee in [P02](#p02-ack-gated-rebase) is a statement about the *order of two calls*. That is exactly what a recorded output-port trace can assert, and exactly what no DOM-level test can assert cheaply — app-tests run in background windows with no rAF, so anything that depends on animation frames advancing is untestable there.
- The project bans jsdom render tests and mock-store assertion tests. This is neither: `SparklineTape` is real production code carrying the real logic, the clock is a production seam ([P01] makes it one), and the surface port is the component's real interface to WAAPI and the worker. The component's DOM behaviour is still covered by a real app-test.
- The current 800-line component mixes six concerns in one `useLayoutEffect` closure; the defects in this plan are all ordering defects in that closure.

**Implications:**
- New file `tugdeck/src/lib/sparkline-tape.ts` with `SparklineTape`, `SparklineSurface`, `SparklineTapeOptions`.
- `TugSparkline`'s `useLayoutEffect` becomes construction + wiring + cleanup.
- The two existing `useLayoutEffect`s keep their split (canvas claim vs. tape), because `transferControlToOffscreen` is once-per-element ([L26]).

#### [P06] Registration is self-healing, not assumed (DECIDED) {#p06-registration-self-check}

**Decision:** On every settle-burst append (only while live, i.e. only when something is already happening), the component compares the animation's implied scroll position against the position the clock implies. A divergence under 1 CSS px is corrected in place by writing `anim.startTime`; a larger one escalates to an ack-gated rebase. The same check runs on `document`'s `visibilitychange` → visible.

**Rationale:**
- [Q01](#q01-timeline-stall) is unresolved and does not need to be: a design that *verifies* its own registration is correct under both answers.
- The check costs one property read on a path that already runs at 250 ms and only while the tape is active. An idle tape still costs zero, which is the component's standing contract.
- Sub-pixel correction is imperceptible and needs no ack; escalation reuses [P02](#p02-ack-gated-rebase).

**Implications:**
- The policy module exposes `checkRegistration(animCurrentTimeMs)` and returns one of `ok` / `nudge(startTimeMs)` / `rebase`.
- The app-test records the observed divergence after a forced background/foreground transition, which writes down the answer to [Q01](#q01-timeline-stall).

#### [P07] The canvas's backing store tracks the live device pixel ratio (DECIDED) {#p07-dpr-reactivity}

**Decision:** `TugSparkline` listens for resolution changes via `matchMedia('(resolution: <dpr>dppx)')` and, on change, bumps a `dprEpoch` piece of React state that participates in the canvas element's `key` and in the geometry passed to the painter.

**Rationale:**
- Today `dpr` is read once inside the canvas-claim effect and is **not** in its dependency array. Moving the window to a different-resolution display, or applying page zoom (which changes `devicePixelRatio` in WebKit and is known to persist per bundle), leaves the backing store permanently mismatched to the presentation size — a soft, resampled tape with no way back short of a reload.
- Replacing the element via `key` is required, not optional: `transferControlToOffscreen()` throws `InvalidStateError` on a second call for the same element ([L26]).
- This is structure-zone state — it changes *what exists*, not how something looks — so `useState` is the correct mechanism and does not violate [L06].

**Implications:**
- One new piece of React state in the component, declared in [#state-zone-mapping](#state-zone-mapping).
- The canvas `key` becomes `${svgWidth}x${height}@${dpr}`.

#### [P08] A spent canvas degrades to the on-main painter instead of throwing (DECIDED) {#p08-transfer-guard}

**Decision:** `makePainter` wraps `canvas.transferControlToOffscreen()` in a `try`/`catch`; on failure it falls through to the existing 2D-context painter.

**Rationale:**
- The current code relies on the `key` being sufficient to guarantee a fresh element. Under React StrictMode's double-invoked effects, or any future dependency change that does not also change the key, the second transfer throws **out of a `useLayoutEffect`** — which does not fail one sparkline, it fails the render pass that contains it. In the Lens that is the whole rail.
- The fallback path already exists and draws the identical geometry; losing the worker thread is a performance regression, not a correctness one.

**Implications:**
- One `try`/`catch` and a dev-log line via `tugDevLogStore` (never `console.warn`).

---

### Deep Dives {#deep-dives}

#### The two defects, precisely {#the-two-defects}

**Defect 1 — two unreconciled clocks.**

`tug-sparkline.tsx` places ink with `Date.now()`: `tape.push({ t: now, v })`, `t0 = Date.now()`, and `sparkline-geometry.ts`'s `xOf(t) = width + ((t - t0) / 1000) * pxPerSec`. It places the *canvas* with a WAAPI animation on `document.timeline`. `startEpoch()` reads `Date.now()` into `t0` and then calls `track.animate(...)`, whose start time is pending until the next rendering update. The gap between those two events is a permanent offset for the whole epoch, it varies with main-thread load, and it differs per instance — so a rail of tapes sits at slightly different offsets from each other and from the card, and each rollover reshuffles them. `Date.now()` additionally exposes the tape to wall-clock steps and sleep/wake.

**Defect 2 — the rebase moves the transform before the pixels exist.**

Three functions change `t0` and the transform in one tick:

| Function | What it does to `t0` | What it does to the transform | Repaint |
|---|---|---|---|
| `startEpoch()` | `t0 = Date.now()` | `anim.cancel()` (removes a `fill: forwards` effect → snaps to `translateX(0)`), then a fresh `animate()` with a pending start | `redraw()` → `postMessage` |
| `enterDormant(now)` | `t0 = now` | `anim.cancel()` → snaps to `translateX(0)` | `redraw()` → `postMessage` |
| `wakeLive(now)` | via `rebuildTape` + `startEpoch` | as `startEpoch` | two `postMessage`s |

The transform change is synchronous. The repaint goes main thread → `postMessage` → shared render worker → `drawSparkline` → compositor commit, landing one or more frames later and queued behind every other tape's paint. For those frames the viewport shows the canvas at the **new** transform with the **old** pixels.

The displacement is `P = (now - t0_old) / 1000 * pxPerSec`, up to `epochPx` = `EPOCH_S * pxPerSec` = 512 px on the 584 px Lens canvas. A tape's actual ink spans only about `retainMs * pxPerSec` ≈ 81 px of that canvas (`drawSparkline` begins its path at `xOf(tape[0].t)` and paints nothing to the left of it); the rest is cleared. So the 64 px viewport, displaced by up to 512 px, usually lands on blank canvas and occasionally straddles the ink boundary. **That is the truncated sparkline in the report: a blank left portion with the staircase jammed to one side.**

**Why the Lens and not the card — frequency, and the flatness precondition.**

`DORMANT_AFTER_MS = (VISIBLE_SECONDS + PRUNE_MARGIN_S) * 1000` is the time for a change to scroll fully off. So a tape that reaches *flat*-dormancy is, by construction, a horizontal line edge to edge — and translating a horizontal line changes nothing. The card's tape is one always-visible instance whose rebases are almost all of that kind, so defect 2 is invisible there.

The Lens's tapes take the *other* dormancy path. They live in a `TugListView` scroll container; `TugSparkline`'s observer uses the default root and `threshold: 0`; and Lens rows change height on every pulse beat, because `useMiddleTruncation` (in `tug-pulse.tsx`) runs a `ResizeObserver` on `.tug-pulse-line` — the sparkline's own parent — and rewrites the middle-truncated activity text, while the `TugPulse` headline appears and disappears with the session overview. Rows near the clip edge therefore cross the intersection boundary repeatedly, and **each crossing rebases a picture that is not flat**: teardown, full tape rebuild re-quantised onto the 250 ms bin grid, epoch restart from `translateX(0)`, all with the paint arriving late. Repeated, that is judder; caught at the wrong frame, that is the blank tape. All N Lens tapes also share one render worker, so paints queue exactly when the rail is busiest.

#### Why the naive "draw the tape twice" rollover trick does not work {#rejected-periodic-canvas}

A tempting alternative to ack-gating is to make the canvas periodic with period `epochPx` — draw the staircase twice, once at `t0` and once at `t0 + EPOCH_S` — so the rollover becomes a transform snap onto identical pixels needing no repaint.

It does not work, and an implementer should not rediscover this. The two copies **overlap in the visible region**. Copy 1's ink spans canvas x from `width - retainPx` to `svgWidth`; copy 2's spans that same range shifted left by `epochPx`. At the rollover instant the viewport is at x ∈ [0, width], where both copies have ink, and they represent timelines an epoch apart. Clipping each copy to its own band does not rescue it either: for `P ∈ (0, width)` the viewport straddles the clip boundary and the two sides are discontinuous by exactly one epoch. A correct periodic canvas requires a genuine wrap-around ring buffer with per-segment wrapping in `drawSparkline`, which is a much larger change to shared geometry code for no benefit over ack-gating.

#### Rebase ordering, end to end {#rebase-ordering}

**Spec S01: The rebase protocol** {#s01-rebase-protocol}

```
rebase(reason, newT0):
  points := current tape
  if visibleWindowIsFlat(points, newT0):
      surface.paint(points, newT0, ack = none)
      surface.setEpochStart(newT0)            # free: translation-invariant
      return
  seq := ++pendingSeq
  surface.paint(points, newT0, ack = seq)     # worker draws, then posts { painted, id, seq }
  pending[seq] := newT0
  # ... later, on ack(seq):
  #   if seq is not the newest pending, drop it
  #   requestAnimationFrame(() => surface.setEpochStart(pending[seq]))
```

`visibleWindowIsFlat(points, t0)` is true when every point whose `xOf(t)` falls in `[t0 - VISIBLE_SECONDS, ∞)` carries the same `v` as the newest point, within the plot-pixel deadband already defined as `DEADBAND_PX / amplitude`. This is a pure function over the tape and belongs in `sparkline-tape.ts`.

`surface.setEpochStart(t)` is implemented by the component as `anim.startTime = t` — an exact write with no pending-start slop, no `cancel()`, and no new `Animation` object. Rollover is `setEpochStart(epochOrigin + (n + 1) * EPOCH_MS)`.

**Spec S02: Dormancy states** {#s02-dormancy-states}

| State | Entered by | Timers | Animation | Picture | Wake path |
|---|---|---|---|---|---|
| `live` | a data event, or mount with recent activity | settle burst + flat-off | running | arbitrary | — |
| `flat-dormant` | flat-off timer fired (`now - lastChangeAt >= DORMANT_AFTER_MS`) | none | paused | provably flat | rebase (free path) + resume |
| `hidden-paused` | observer reported not-intersecting for 500 ms continuous | none (pause timer cleared) | paused | arbitrary | rebase (ack path) + resume |

`hidden-paused` and `flat-dormant` can be true at once; the *exit* takes the stricter path (ack-gated) unless the picture is flat at exit time, which the fast path tests for anyway. The existing `onActivity` short-circuit — a dormant tape ignores an event whose sampled value would not clear the plot deadband — is preserved for both.

---

### Specification {#specification}

#### Public API surface {#public-api}

`tugdeck/src/lib/sparkline-tape.ts` (new):

```ts
/** Everything the tape needs from the world it is drawn into. */
export interface SparklineSurface {
  /** Post the whole tape for `t0`. `ack` non-null ⇒ the surface must call
   *  `SparklineTape.onPainted(ack)` once those pixels exist. */
  paint(points: readonly SparklinePoint[], t0: number, ack: number | null): void;
  /** Move the scroll origin. Only ever called from the tape's rebase protocol. */
  setEpochStart(timelineMs: number): void;
  /** Stop / start the scroll without destroying it. */
  pause(): void;
  resume(): void;
  /** The dominant-channel stamp + the colour repaint it forces. */
  stampChannel(channel: string | null, t0: number): void;
}

export interface SparklineTapeOptions {
  now: () => number;                  // performance.now() in production
  getSeries: (nowMs: number) => number[];
  getColorChannel?: (nowMs: number) => string | null;
  binMs: number;
  fullScale: number;
  curve: SparklineCurve;
  amplitude: number;                  // plot pixels, for the deadband
  pxPerSec: number;
  motion: boolean;
  setInterval: (fn: () => void, ms: number) => number;   // injected timers
  clearInterval: (h: number) => void;
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (h: number) => void;
}

export class SparklineTape {
  constructor(surface: SparklineSurface, options: SparklineTapeOptions);
  /** Mount: build from history, decide born-live vs born-flat-dormant. */
  start(epochOriginMs: number): void;
  /** A data event from the caller's activity channel. */
  onActivity(): void;
  /** The surface's acknowledgement for a `paint` that carried `ack`. */
  onPainted(ack: number): void;
  /** Visibility gate (already debounced by the caller). */
  setVisible(visible: boolean): void;
  /** [P06] — returns what the caller should do about the animation's position. */
  checkRegistration(animCurrentTimeMs: number):
    | { kind: "ok" }
    | { kind: "nudge"; startTimeMs: number }
    | { kind: "rebase" };
  /** Test/debug read-out; also what the app-test asserts against. */
  debugState(): { state: "live" | "flat-dormant" | "hidden-paused"; t0: number; points: number };
  stop(): void;
}
```

`tugdeck/src/lib/workers/sparkline-render-worker.ts` — protocol additions:

```ts
// request (existing `tape` message gains one optional field)
| { kind: "tape"; id: number; points: SparklinePoint[]; t0: number; now: number; ack?: number }

// response (new — the worker's only outbound message)
export type SparklineWorkerResponse = { kind: "painted"; id: number; ack: number };
```

The worker posts the response **at the end of** its draw handler, after `paint()` returns, so the `OffscreenCanvas` commit for that task is already queued. Messages without `ack` produce no response, keeping the 4 Hz sample path one-directional as documented in the worker's module header.

#### State Zone Mapping {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| Tape points, `t0`, epoch origin, deadband reference | local data (imperative, outside React) | `SparklineTape` fields, owned by a `useRef`-held instance | [L06] appearance is painted, not rendered |
| Dormancy state (`live` / `flat-dormant` / `hidden-paused`) | local data | `SparklineTape` field | [L06] |
| Settle burst, flat-off timer, pause hysteresis timer | local data | injected `setInterval`/`setTimeout`, all released in effect cleanup | [L27] |
| Scroll position (the motion itself) | appearance | WAAPI `translateX` on `.tug-sparkline-track` | [L13] |
| `data-activity-channel` tint stamp | appearance | DOM attribute + CSS in `tug-sparkline.css` | [L06] |
| Resolved line/area colours | appearance | `getComputedStyle` → worker `colors` message | [L06], [L16] |
| `dprEpoch` (which canvas element exists) | **structure** | `useState`, feeds the canvas `key` | [L24], [L26] |
| Canvas ↔ worker entry ownership | lifecycle | claimed in `useLayoutEffect`, released in its cleanup | [L03], [L27] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/lib/sparkline-tape.ts` | The DOM-free tape / clock / dormancy / rebase policy ([P05](#p05-policy-extraction)) |
| `tugdeck/src/lib/__tests__/sparkline-tape.test.ts` | Unit tests over the real policy with an injected clock and a recording surface |
| `tests/app-test/at0370-sparkline-registration.test.ts` | Real-app coverage: one animation across scroll cycles, DPR tracking, no teardown |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `SparklineTape` | class | `tugdeck/src/lib/sparkline-tape.ts` | New. Owns the tape, the clock, dormancy, and Spec S01 |
| `SparklineSurface` | interface | `tugdeck/src/lib/sparkline-tape.ts` | New. The output port |
| `SparklineTapeOptions` | interface | `tugdeck/src/lib/sparkline-tape.ts` | New |
| `visibleWindowIsFlat` | fn | `tugdeck/src/lib/sparkline-tape.ts` | New, exported for test |
| `SparklineWorkerResponse` | type | `tugdeck/src/lib/workers/sparkline-render-worker.ts` | New outbound message type |
| `SparklineWorkerRequest` | type | `tugdeck/src/lib/workers/sparkline-render-worker.ts` | `tape` variant gains `ack?: number` |
| `Painter` | interface | `tugdeck/src/components/tugways/tug-sparkline.tsx` | `draw` gains an `ack` argument; gains `onAck` registration |
| `makePainter` | fn | `tugdeck/src/components/tugways/tug-sparkline.tsx` | `try`/`catch` around `transferControlToOffscreen` ([P08](#p08-transfer-guard)); drops the dead `tapeSnapshot` local |
| `sparklineWorker` | fn | `tugdeck/src/components/tugways/tug-sparkline.tsx` | Installs the shared `onmessage` ack router |
| `nearestScrollableAncestor` | fn | `tugdeck/src/components/tugways/tug-sparkline.tsx` | New; the observer's `root` ([P04](#p04-observer-hysteresis)) |
| `startEpoch`, `enterDormant`, `wakeLive` | fns | `tugdeck/src/components/tugways/tug-sparkline.tsx` | Removed; replaced by `SparklineTape` methods + Spec S01 |
| `SparklinePoint.t` | field doc | `tugdeck/src/lib/sparkline-geometry.ts` | Doc change only: monotonic-clock ms |
| `recordActivity` | method | `tugdeck/src/test-surface.ts` | New on `TugTestSurface`; bump `SURFACE_VERSION` |

---

### Documentation Plan {#documentation-plan}

- [ ] Rewrite the `tug-sparkline.tsx` module header: it currently describes `Date.now()`, the cancel/restart epoch, and a single dormancy. Replace with the one-clock rule ([P01](#p01-one-clock)), Spec S01, and Spec S02.
- [ ] Update the `sparkline-render-worker.ts` header, which states "Nothing is ever posted back — the hot path is one-directional by design". Amend to: the hot path is one-directional; rebase paints alone carry an ack.
- [ ] Note the monotonic-clock contract on `SparklinePoint.t` in `sparkline-geometry.ts`.
- [ ] Add `@covers` lines to `at0370-sparkline-registration.test.ts` for `tug-sparkline.tsx`, `sparkline-tape.ts`, `sparkline-render-worker.ts`, `sparkline-geometry.ts`, `cards-session-cell.tsx`, and `session-pulse-strip.tsx`, and verify with `just app-test-covers-check`.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (`bun test` in `tugdeck`)** | Drive the real `SparklineTape` with an injected clock and injected timers, recording every `SparklineSurface` call | Clock derivation, rebase ordering, dormancy transitions, flatness fast path, self-check verdicts |
| **Golden geometry** | Feed a fixed tape to the real `drawSparkline` against a recording 2D context and compare the emitted path | Guard that the extraction did not move the staircase |
| **App-test (`just app-test`)** | Drive the real Tug.app: real Lens, real store, real WAAPI | One animation across scroll cycles, no `cancel`, DPR tracking, canvas sizing |
| **Drift prevention** | `grep`-style assertions inside unit tests | No `Date.now()` in the tape path |

#### What stays out of tests {#test-non-goals}

- **No jsdom render tests, no mock stores.** The unit tests drive real production classes; the injected clock is a production seam introduced by [P01](#p01-one-clock), and the recording surface is the component's real output port under [P05](#p05-policy-extraction), not a stand-in for the subject.
- **No assertion that depends on animation frames advancing.** App-tests run in background windows with no rAF and, when covered, report `visibilityState: "hidden"`. `at0370` therefore reads `Animation` object identity, count, `playState`, and `startTime` — all correct synchronously — and never reads a `currentTime` delta or a mid-flight computed transform.
- **No pixel/screenshot comparison of the tape.** The tape is live data; a screenshot would be flaky by construction. Correctness of the *picture* is covered by the golden-geometry test over `drawSparkline`.
- **No coverage of the reduced-motion path in the app-test.** It has no animation, so the invariants under test do not apply; it is covered by a unit case with `motion: false`.

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Extract the tape policy, behaviour-preserving | pending | — |
| #step-2 | One clock: `performance.now()` and an explicit epoch origin | pending | — |
| #step-3 | Worker paint acknowledgements | pending | — |
| #step-4 | Ack-gated rebase with a flat-window fast path | pending | — |
| #step-5 | Split flat-dormancy from hidden-pause | pending | — |
| #step-6 | Harden the visibility gate | pending | — |
| #step-7 | Self-healing registration | pending | — |
| #step-8 | Backing-store correctness and transfer guard | pending | — |
| #step-9 | `recordActivity` test hook and the real-app test | pending | — |
| #step-10 | Integration checkpoint | pending | — |

---

#### Step 1: Extract the tape policy, behaviour-preserving {#step-1}

**Commit:** `tugdeck(sparkline): lift the tape policy out of the component`

**References:** [P05](#p05-policy-extraction) Policy extraction, [Risk R01](#r01-extraction-hides-change), Spec S02 (#s02-dormancy-states), (#the-two-defects)

**Artifacts:**
- New `tugdeck/src/lib/sparkline-tape.ts` with `SparklineTape`, `SparklineSurface`, `SparklineTapeOptions` as specified in [#public-api](#public-api).
- New `tugdeck/src/lib/__tests__/sparkline-tape.test.ts`.
- `tug-sparkline.tsx`'s second `useLayoutEffect` reduced to construction, wiring, and cleanup.

**Tasks:**
- [ ] Move, unchanged, into `SparklineTape`: `VISIBLE_SECONDS`, `SAMPLE_MS`, `PRUNE_MARGIN_S`, `EPOCH_S`, `DORMANT_AFTER_MS`, `RATE_WINDOW_MS`, `DEADBAND_PX`, `SETTLE_TICKS`, and the closures `sampleRate`, `appendPoint`, `rebuildTape`, `startSettle`/`stopSettle`, `scheduleFlatOff`/`stopFlatOff`, `enterDormant`, `wakeLive`, `flatPastWindow`, `onActivity`, plus the mount decision (born-inert vs `wakeLive`).
- [ ] Route every DOM touch through `SparklineSurface`: `redraw()` → `surface.paint(points, t0, null)`; `startEpoch`'s animation work → `surface.setEpochStart` / `pause` / `resume`; the `data-activity-channel` stamp and its `repaintColors()` → `surface.stampChannel`.
- [ ] Inject `now`, `setInterval`, `clearInterval`, `setTimeout`, `clearTimeout` through `SparklineTapeOptions`. **Keep `now: () => Date.now()` in the component for this step** — the clock change is Step 2, and mixing the two would make a regression unattributable.
- [ ] In `TugSparkline`, hold the instance in a `useRef`, construct it in the existing tape `useLayoutEffect`, and call `stop()` from the cleanup ([L27]).
- [ ] Implement the component-side `SparklineSurface` against the existing `Painter` and the existing cancel/restart animation behaviour — no semantic change yet.
- [ ] Delete the dead `tapeSnapshot` local in `makePainter`'s worker branch (assigned, never read).

**Tests:**
- [ ] `sparkline-tape.test.ts`: a tape that receives no activity is born flat-dormant — the surface trace holds exactly one `paint` and no timers were scheduled.
- [ ] A tape built from a series with recent activity is born live: `paint` at mount, a settle burst at 250 ms intervals, and the burst stops after `SETTLE_TICKS` unchanged ticks **and** `RATE_WINDOW_MS + binMs` past the last event — assert it does *not* stop on stability alone while the window is still draining.
- [ ] The deadband reference advances only on recognised change: feed a ramp of sub-deadband steps and assert the accumulated drift eventually registers a change.
- [ ] The flat-off timeout fires exactly `DORMANT_AFTER_MS` after the last recognised change and reschedules when a later change lands during the wait.
- [ ] `motion: false` never calls `setEpochStart`, `pause`, or `resume`.
- [ ] Golden geometry: feed a fixed 5-point tape to the real `drawSparkline` with a recording 2D context and snapshot the emitted `moveTo`/`lineTo` sequence, including the held tail to `svgWidth` and the area's two baseline closers.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx tsc --noEmit`
- [ ] `cd tugdeck && bunx vite build`
- [ ] `just app-test at0282-pulse-two-level.test.ts`

---

#### Step 2: One clock — `performance.now()` and an explicit epoch origin {#step-2}

**Depends on:** #step-1

**Commit:** `tugdeck(sparkline): put the tape and its scroll on one monotonic clock`

**References:** [P01](#p01-one-clock) One clock, [Q01](#q01-timeline-stall), (#the-two-defects), Spec S01 (#s01-rebase-protocol)

**Artifacts:**
- `SparklineTape` derives `t0` instead of assigning it.
- `tug-sparkline.tsx` sets `Animation.startTime` explicitly and never relies on a pending start.

**Tasks:**
- [ ] Change the component's injected clock to `performance.now()`. Remove every `Date.now()` from `tug-sparkline.tsx` and `sparkline-tape.ts`.
- [ ] Give `SparklineTape.start(epochOriginMs)` the animation's origin and store it. Replace every `t0 = <assignment>` with the derivation `t0 = epochOrigin + Math.floor((now - epochOrigin) / EPOCH_MS) * EPOCH_MS`, exposed as a private `currentT0(now)`.
- [ ] In the component, create the animation **once** per mount: `anim = track.animate([...], { duration: EPOCH_S * 1000, easing: "linear", fill: "forwards" })`, then immediately `anim.startTime = origin` where `origin` is the same `performance.now()` value handed to `start()`. Assert in a dev-log line that `anim.pending === false` after the write.
- [ ] Replace `startEpoch`'s `cancel()` + `animate()` with `surface.setEpochStart(t)` → `anim.startTime = t`. Keep `anim.onfinish` as the rollover *trigger* only; it must call into the tape's rebase (wired for real in [#step-4](#step-4)) rather than restarting the animation itself.
- [ ] Remove the `anim.onfinish = null; anim.cancel();` orphan-guard blocks — with a single long-lived animation there is nothing to orphan. Cleanup still cancels once, on unmount.
- [ ] Document the monotonic-clock contract on `SparklinePoint.t` in `sparkline-geometry.ts`.

**Tests:**
- [ ] For a swept range of `now` values, `currentT0(now)` equals `epochOrigin + n * EPOCH_MS` exactly and the implied transform `-(now - t0) / 1000 * pxPerSec` stays within `[-epochPx, 0]`.
- [ ] Drift prevention: the test reads `tug-sparkline.tsx` and `sparkline-tape.ts` off disk and asserts neither contains `Date.now(`.
- [ ] A tape driven across an epoch boundary reports `t0` advancing by exactly `EPOCH_MS`, with no intermediate value.
- [ ] Clock-origin agreement: a unit assertion that `document.timeline.currentTime` and `performance.now()` agree within one frame is **not** unit-testable without a DOM; instead assert it in `at0370` ([#step-9](#step-9)) and record the observed delta as a `note()`.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`
- [ ] Open the app, watch a live Session card tape for one full 120 s epoch; the rollover shows no jump. (`just app-test at0282-pulse-two-level.test.ts` must also stay green.)

---

#### Step 3: Worker paint acknowledgements {#step-3}

**Depends on:** #step-2

**Commit:** `tugdeck(sparkline): let the render worker acknowledge a rebase paint`

**References:** [P02](#p02-ack-gated-rebase) Ack-gated rebase, Spec S01 (#s01-rebase-protocol), (#public-api)

**Artifacts:**
- `SparklineWorkerRequest`'s `tape` variant gains `ack?: number`; new `SparklineWorkerResponse`.
- The shared worker in `tug-sparkline.tsx` grows one `onmessage` router keyed by sparkline `id`.
- `Painter.draw` gains an `ack` parameter; `Painter` gains ack registration.

**Tasks:**
- [ ] In `sparkline-render-worker.ts`, add `ack?: number` to the `tape` message and post `{ kind: "painted", id, ack }` from the end of the `case "tape"` handler when `ack` is present. Nothing else changes; the header's one-directional claim gets amended.
- [ ] In `tug-sparkline.tsx`, keep the shared `Worker` singleton but attach a module-level `onmessage` that dispatches to a `Map<number, (ack: number) => void>` of registered sparkline ids. Register in `makePainter`, unregister in `release()` ([L27]).
- [ ] Extend `Painter.draw(tape, t0, now, ack)` on both branches. The on-main fallback draws synchronously and then invokes the ack callback synchronously — one protocol, two latencies.
- [ ] Wire `SparklineSurface.paint`'s `ack` argument through to the painter, and `SparklineTape.onPainted(ack)` to the registered callback.
- [ ] The tape does not yet *use* acks for anything — this step lands the plumbing only, so a regression here is attributable.

**Tests:**
- [ ] A recording surface that acks immediately, and one that acks after N intervening paints, both leave the tape in the same state (the tape must be indifferent to ack latency until Step 4 gives acks meaning).
- [ ] A `paint` with `ack: null` never produces an `onPainted` call.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`
- [ ] `just app-test at0282-pulse-two-level.test.ts`

---

#### Step 4: Ack-gated rebase with a flat-window fast path {#step-4}

**Depends on:** #step-3

**Commit:** `tugdeck(sparkline): never move the scroll ahead of the pixels`

**References:** [P02](#p02-ack-gated-rebase) Ack-gated rebase, Spec S01 (#s01-rebase-protocol), [Risk R02](#r02-ack-not-frame-exact), (#rejected-periodic-canvas)

**Artifacts:**
- `visibleWindowIsFlat` in `sparkline-tape.ts`.
- `SparklineTape`'s rebase protocol per Spec S01, replacing every direct `setEpochStart` call site.
- The component applies `setEpochStart` inside a `requestAnimationFrame` scheduled from the ack.

**Tasks:**
- [ ] Implement `visibleWindowIsFlat(points, t0, visibleMs, deadband)`: true when every point at or after `t0 - visibleMs` carries the same `v` as the newest, within `deadband`. Export it.
- [ ] Implement Spec S01 in `SparklineTape` as the single `rebase(newT0)` entry point. Maintain `pendingSeq` and a `pending` map; an ack for a superseded sequence is dropped.
- [ ] Route the epoch rollover through `rebase`: `anim.onfinish` → `tape.onEpochEnd()` → `rebase(origin + (n+1) * EPOCH_MS)`. While the ack is outstanding the animation sits at its `fill: forwards` end position, which is the *correct* picture — it just stops moving for a frame or two. That is intentional and must be commented as such.
- [ ] In the component's `setEpochStart`, wrap the `anim.startTime` write in `requestAnimationFrame` when it arrives from an ack, per [Risk R02](#r02-ack-not-frame-exact). Note in the comment that this is not an animation loop — it is a one-shot frame boundary — so [L13] is not in play.
- [ ] Delete the old `startEpoch` entirely.

**Tests:**
- [ ] **Ordering invariant (the headline test):** across every scenario the suite drives — mount, rollover, activity burst, dormancy, wake — scan the recorded surface trace and assert that every `setEpochStart(t)` is immediately preceded either by a `paint(..., t, ack)` whose ack has been delivered, or by a `paint(..., t, null)` for a flat window. No other ordering may appear.
- [ ] A rollover with a non-flat tape emits `paint(ack)` and no `setEpochStart` until `onPainted` is called.
- [ ] A rollover with a flat tape emits no ack and applies `setEpochStart` synchronously.
- [ ] A superseded rebase: two `rebase` calls back to back, then acks delivered out of order — only the newest `t0` is ever applied.
- [ ] The 4 Hz settle-burst paints never carry an ack.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`
- [ ] `just app-test at0282-pulse-two-level.test.ts`

---

#### Step 5: Split flat-dormancy from hidden-pause {#step-5}

**Depends on:** #step-4

**Commit:** `tugdeck(sparkline): an off-screen tape pauses instead of tearing down`

**References:** [P03](#p03-pause-not-teardown) Pause not teardown, Spec S02 (#s02-dormancy-states), (#the-two-defects)

**Artifacts:**
- `SparklineTape`'s single `dormant` boolean becomes the three-state machine of Spec S02.
- `SparklineSurface.pause()` / `resume()` replace the cancel/recreate pair.

**Tasks:**
- [ ] Replace `dormant: boolean` with `state: "live" | "flat-dormant" | "hidden-paused"`, and `inView: boolean` alongside it (the two are orthogonal; Spec S02's table is the authority).
- [ ] `enterFlatDormancy`: stop both timers, `surface.pause()`, `rebase(currentT0(now))` — which takes the free path by construction, since flat-dormancy's precondition *is* flatness. Assert that in a dev-log line rather than assuming it.
- [ ] `enterHiddenPause`: stop both timers, `surface.pause()`, and **change nothing else** — no `t0` move, no repaint, no rebuild.
- [ ] Wake from `hidden-paused`: `rebuildTape(now)`, then `rebase(currentT0(now))` (ack path unless flat), then `surface.resume()`, then arm the finishers. `resume()` must be ordered *after* the rebase is applied, so the transform never runs from a stale origin.
- [ ] Implement `pause()`/`resume()` in the component as `anim.pause()` / `anim.play()`. Remove `anim.cancel()` from every path except unmount cleanup.
- [ ] Preserve the existing below-deadband short-circuit in `onActivity` for both dormant states.

**Tests:**
- [ ] A hidden→visible cycle on a **non-flat** tape produces `pause`, then on wake a `paint(ack)`, then `setEpochStart`, then `resume` — in that order — and never `cancelAnimation` or `createAnimation`.
- [ ] A hidden→visible cycle on a flat tape takes the free path and still never tears down.
- [ ] `enterHiddenPause` emits no `paint` and no `setEpochStart`.
- [ ] A tape that goes hidden while live and is still hidden when its flat-off deadline passes converges to `flat-dormant` without a second `pause`.
- [ ] Activity arriving while hidden updates `lastChangeAt` and does not wake — matching today's behaviour — and re-entry then finds a non-flat tape and takes the ack path.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`
- [ ] `just app-test at0282-pulse-two-level.test.ts`
- [ ] In the running app: open the Lens with several sessions, scroll the Cards section so a session row leaves and re-enters the list, and confirm the tape resumes without a jump.

---

#### Step 6: Harden the visibility gate {#step-6}

**Depends on:** #step-5

**Commit:** `tugdeck(sparkline): observe the scroll container, and don't pause on a flap`

**References:** [P04](#p04-observer-hysteresis) Observer hysteresis, Spec S02 (#s02-dormancy-states), (#the-two-defects)

**Artifacts:**
- `nearestScrollableAncestor` in `tug-sparkline.tsx`.
- The `IntersectionObserver` gains a root, a `rootMargin`, and a debounce before pausing.

**Tasks:**
- [ ] Add `nearestScrollableAncestor(el: Element): Element | null` — walk `parentElement`, return the first whose computed `overflow-y` is `auto`, `scroll`, or `overlay`; `null` (the viewport) if none.
- [ ] Construct the observer with `{ root: nearestScrollableAncestor(container), rootMargin: "160px 0px", threshold: 0 }`. Comment that `rootMargin` expands the *root's* rect, which is why the root has to be the scroller for the margin to buy anything.
- [ ] Debounce the pause: on `!isIntersecting`, start a 500 ms timer that calls `tape.setVisible(false)`; on `isIntersecting`, clear any pending timer and call `tape.setVisible(true)` immediately.
- [ ] Clear the pause timer in the effect cleanup ([L27]).
- [ ] Add a `tugDevLogStore.debug` line on each state transition, tagged `sparkline`, so the dev panel (Opt-Cmd-/) can show churn directly. Never `console.warn`.

**Tests:**
- [ ] `setVisible(false)` followed by `setVisible(true)` inside the debounce window (driven at the tape level, since the debounce lives in the component) leaves the tape untouched — assert via the surface trace that a rapid flap sequence produces zero `pause` calls when the component's debounce is exercised through the injected timers.
- [ ] Beyond the window, exactly one `pause`.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`
- [ ] In the running app with the dev panel open: scroll the Lens Cards section briskly and confirm the `sparkline` transition log stays quiet.

---

#### Step 7: Self-healing registration {#step-7}

**Depends on:** #step-6

**Commit:** `tugdeck(sparkline): verify the tape's registration instead of assuming it`

**References:** [P06](#p06-registration-self-check) Registration self-check, [Q01](#q01-timeline-stall), [P02](#p02-ack-gated-rebase)

**Artifacts:**
- `SparklineTape.checkRegistration(animCurrentTimeMs)`.
- A `visibilitychange` listener in `tug-sparkline.tsx`.

**Tasks:**
- [ ] Implement `checkRegistration`: compute the expected animation position `expected = now - epochOrigin - n * EPOCH_MS`, compare against the supplied `animCurrentTimeMs`, convert the difference to CSS px via `pxPerSec`. Under 1 px → `{ kind: "ok" }`; under `epochPx` and over 1 px → `{ kind: "nudge", startTimeMs }`; anything larger (or a stalled/paused animation) → `{ kind: "rebase" }`.
- [ ] Call it from the settle burst's tick — only while `state === "live"`, so an idle tape still runs zero work.
- [ ] In the component, apply `nudge` as a direct `anim.startTime` write (sub-pixel, no ack needed) and `rebase` through Spec S01.
- [ ] Add a `document` `visibilitychange` listener that, on `visible`, runs one `checkRegistration` and records the observed divergence to `tugDevLogStore` — this is what writes down the answer to [Q01](#q01-timeline-stall). Remove the listener in cleanup ([L27]).

**Tests:**
- [ ] A fabricated divergence of 0.4 px returns `ok`; 3 px returns `nudge` with the corrected `startTimeMs`; `epochPx + 50 px` returns `rebase`.
- [ ] A `nudge` verdict never appears in the surface trace as a `setEpochStart` preceded by an unacked paint — i.e. the ordering invariant from [#step-4](#step-4) still holds with the self-check active, because a nudge is not a rebase.
- [ ] `checkRegistration` is never called while `flat-dormant` or `hidden-paused` (assert via the injected timers: no settle burst is running).

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`
- [ ] `just app-test at0282-pulse-two-level.test.ts`

---

#### Step 8: Backing-store correctness and transfer guard {#step-8}

**Depends on:** #step-7

**Commit:** `tugdeck(sparkline): track the live device pixel ratio, and survive a spent canvas`

**References:** [P07](#p07-dpr-reactivity) DPR reactivity, [P08](#p08-transfer-guard) Transfer guard, (#state-zone-mapping), [L26]

**Artifacts:**
- A `dprEpoch` `useState` in `TugSparkline` feeding the canvas `key` and the geometry.
- `try`/`catch` around `transferControlToOffscreen`.

**Tasks:**
- [ ] Add a `useLayoutEffect` that installs `matchMedia('(resolution: ' + dpr + 'dppx)')` and, on `change`, calls `setDprEpoch(n => n + 1)`, re-installing against the new ratio. This is structure-zone state ([L24]) — it changes which canvas element exists — so `useState` is correct and [L06] is not violated.
- [ ] Read `devicePixelRatio` during render (not inside the effect) so the geometry and the `key` agree, and make it a dependency of the canvas-claim effect.
- [ ] Change the canvas `key` to `` `${svgWidth}x${height}@${dpr}` `` so a ratio change replaces the element rather than re-transferring a spent one ([L26]).
- [ ] Wrap `canvas.transferControlToOffscreen()` in `try`/`catch`; on failure log via `tugDevLogStore.error` under the `sparkline` tag and fall through to the 2D-context painter.
- [ ] Re-read the module header of `tug-sparkline.tsx` and rewrite the paragraphs describing `Date.now()`, the cancel/restart epoch, and single dormancy — they are now wrong. Fold in [P01](#p01-one-clock), Spec S01, and Spec S02.
- [ ] Amend the `sparkline-render-worker.ts` header's "Nothing is ever posted back" claim.

**Tests:**
- [ ] Covered at the app-test layer in [#step-9](#step-9) — DPR and canvas transfer are not observable from a DOM-free unit test, and a jsdom stand-in is banned.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx tsc --noEmit`
- [ ] `cd tugdeck && bunx vite build`

---

#### Step 9: `recordActivity` test hook and the real-app test {#step-9}

**Depends on:** #step-8

**Commit:** `tugdeck(sparkline): cover tape registration in the real app`

**References:** [P01](#p01-one-clock), [P03](#p03-pause-not-teardown), [P04](#p04-observer-hysteresis), [P07](#p07-dpr-reactivity), (#test-non-goals), (#success-criteria)

**Artifacts:**
- `TugTestSurface.recordActivity(session, channel, units)` in `tugdeck/src/test-surface.ts`, with `SURFACE_VERSION` bumped.
- New `tests/app-test/at0370-sparkline-registration.test.ts`.

**Tasks:**
- [ ] Add `recordActivity(session: string, channel: ActivityChannel, units: number): void` to `TugTestSurface`, implemented by calling the real `getSessionActivityStore()?.record(session, channel, units, performance.now())`. This drives the real ingestion path — no fixture, no mock — and gives the app-test a deterministic way to make a tape live. Bump `SURFACE_VERSION` (currently `2.1.0`) per its documented contract.
- [ ] Write `at0370-sparkline-registration.test.ts` with `@covers` for `tug-sparkline.tsx`, `sparkline-tape.ts`, `sparkline-render-worker.ts`, `sparkline-geometry.ts`, `cards-session-cell.tsx`, `session-pulse-strip.tsx`.
- [ ] Test: open the Lens, drive `recordActivity` on a bound session, and assert `document.querySelector('.sessions-monitor-spark .tug-sparkline-track').getAnimations().length === 1` with `playState === 'running'` and a non-null, non-pending `startTime`.
- [ ] Test: capture the `Animation` object, scroll the Cards section so the row leaves and re-enters three times, and assert the animation is the **same object** each time (`getAnimations()[0] === captured`) and `playState` never reaches `'idle'` — the falsifiable form of "no teardown".
- [ ] Test: for every mounted `.tug-sparkline-canvas`, assert `canvas.width === Math.ceil(parseFloat(canvas.style.width) * devicePixelRatio)`.
- [ ] Test: `note()` the delta between `document.timeline.currentTime` and `performance.now()`, which records the answer to [Q01](#q01-timeline-stall) in the run's `Diagnostics:` section.
- [ ] Nothing in the test may await an animation frame or read a mid-flight computed transform — background windows run no rAF, and transitions poison style assertions.
- [ ] Run `just app-test-covers-check`.

**Tests:**
- [ ] The four assertions above are the tests.

**Checkpoint:**
- [ ] `just app-test-covers-check`
- [ ] `just app-test at0370-sparkline-registration.test.ts`
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx vite build`

---

#### Step 10: Integration checkpoint {#step-10}

**Depends on:** #step-4, #step-5, #step-6, #step-7, #step-9

**Commit:** `N/A (verification only)`

**References:** (#success-criteria), (#exit-criteria), [Risk R03](#r03-other-causes)

**Tasks:**
- [ ] Verify every success criterion in [#success-criteria](#success-criteria) mechanically, criterion by criterion.
- [ ] Run the selective app-test derived from the working diff, then the core tier — the changes touch `test-surface.ts`, which no `@covers` line can scope.
- [ ] Watch a live session in the Lens and on its card side by side for at least two full epochs (240 s) with real streaming activity; confirm neither judders and neither blanks.
- [ ] With the dev panel open (Opt-Cmd-/), scroll the Lens rail hard during streaming and confirm the `sparkline` transition log is quiet and no registration `rebase` verdicts fire.
- [ ] If judder remains after all of the above, record it against [Risk R03](#r03-other-causes) with a WebKit layer-tree capture rather than reopening the registration work.

**Tests:**
- [ ] Full unit suite plus the two app-tests, green together.

**Checkpoint:**
- [ ] `cd tugdeck && bun test`
- [ ] `cd tugdeck && bunx tsc --noEmit`
- [ ] `cd tugdeck && bunx vite build`
- [ ] `just app-test-changed`
- [ ] `just app-test`

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A sparkline whose tape and whose scroll are provably the same function of one monotonic clock, which never moves its transform ahead of its pixels, and which pauses rather than tears down when it leaves the screen — so the Lens rail reads exactly like the card.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] No `Date.now()` remains in `tug-sparkline.tsx` or `sparkline-tape.ts` (drift-prevention unit test).
- [ ] The ordering invariant holds in every unit scenario: no `setEpochStart` without a delivered ack or a flat window ([#step-4](#step-4) headline test).
- [ ] No animation teardown outside mount/unmount in any scenario, unit or app-test ([#step-5](#step-5), [#step-9](#step-9)).
- [ ] A Lens row survives three scroll-out/scroll-in cycles with the same `Animation` object, still running (`at0370`).
- [ ] Canvas backing store matches the live `devicePixelRatio` on every mounted tape (`at0370`).
- [ ] `tug-sparkline.tsx` and `sparkline-render-worker.ts` module headers describe the shipped design, not the replaced one.
- [ ] `cd tugdeck && bun test`, `bunx tsc --noEmit`, `bunx vite build`, `just app-test-changed`, and `just app-test` all clean.

**Acceptance tests:**
- [ ] `tugdeck/src/lib/__tests__/sparkline-tape.test.ts`
- [ ] `tests/app-test/at0370-sparkline-registration.test.ts`
- [ ] `tests/app-test/at0282-pulse-two-level.test.ts` (unchanged, must stay green)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] [Q02](#q02-epoch-length) — reduce `EPOCH_S` now that rollover is cheap. At 120 s the canvas is 584 CSS px per Lens row and 2240 per Pulse-card channel row (≈6.5 MB of backing store for the seven-channel popover at dpr 2).
- [ ] Consider a genuine wrap-around ring-buffer canvas (see [#rejected-periodic-canvas](#rejected-periodic-canvas)) if texture pressure ever outweighs the complexity — it would remove the rollover rebase entirely.
- [ ] Investigate whether the Lens rail's composited layer under `overflow: hidden` inside a scroll container, beneath `.tug-pulse-trailing`'s `translateY(-3px)`, is independently costing the tape its composited layer ([Risk R03](#r03-other-causes)).
- [ ] Extend `recordActivity` coverage to the expanded Pulse card's per-channel tapes, which this plan changes but does not directly app-test.

| Checkpoint | Verification |
|------------|--------------|
| Policy extraction is behaviour-preserving | `bun test` green with Step 1's tests written against current behaviour; `at0282` green |
| One clock | drift-prevention test; `currentT0` derivation test |
| Ack protocol lands without semantic change | Step 3's ack-latency-indifference test |
| Rebase never precedes its pixels | Step 4's trace-ordering test across all scenarios |
| Off-screen is a pause | Step 5's no-teardown trace test; `at0370` same-`Animation` assertion |
| Gate does not flap | Step 6's debounce test; quiet dev-log during a hard Lens scroll |
| Registration self-heals | Step 7's three-verdict test; `visibilitychange` divergence recorded as a `note()` |
| Backing store correct | `at0370` canvas-size assertion |
| Whole phase | Step 10's checkpoint list |
