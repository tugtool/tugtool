## Jul29B Perf — Idle Silence, Recalc Zero, the Typing Gate, and the Other 15 Cores {#jul29b-perf}

**Purpose:** Attribute every remaining renderer cost named in `roadmap/jul29B-perf-brief.md` and eliminate or gate it: idle rendering updates to zero, style recalculations to zero at idle, typing latency under a committed budget test, and the committed multicore work (brief items M1/M2/M3) landed — with the M4 out-of-process-iframe spike verdict delivered before anything else.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-07-29 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The jul29 perf program (`roadmap/archive/jul29-perf-tuneup.md`) cut release idle renderer busy from 13.8% to 8.3% by shrinking composited breadth: 438 pulsing-dot stacking contexts to 0, retained finished transitions to 0. What remains is measured but unattributed, and `roadmap/jul29B-perf-brief.md` charges this phase with four things: name what *schedules* the ~8% of idle rendering updates (86% of remaining busy is `Page::updateRendering` on a deck that should be asleep), make style recalculation an attributed and gated quantity (~23 `Style::TreeResolver::resolve` samples per 5s idle window, initiator unknown), turn "typing won't lag" into an enforced number (typing busy measured 65.9% with the dominant term — the after-layout compositing walk at 241+61 samples — surviving both A/B suspects), and use the machine's other cores where that is honestly possible (brief `#multicore`, calls made 2026-07-29: M1/M2/M3 IN, M4 spike-first, M5 OUT).

The controlling model, from the brief's `#mechanism`: **renderer busy = wakes per second × cost per wake**. The prior phase attacked cost-per-wake; this phase attacks the wake side at idle, the walked-tree size under typing, and adds the gates that keep both down.

#### Strategy {#strategy}

- The M4 spike runs first and alone ([P01]); its verdict completes the committed work list before any other step starts.
- Instruments before verdicts, verdicts before fixes, fixes before gates, release re-profile last ([P02]). No fix ships before its cost is attributed, and no attribution counts until it predicts the profile numerically.
- All new instruments live in `tugdeck/src/lib/perf-monitor.ts` beside `animationCensus`/`layerTreeProbe`, dev/test-gated and windowed so the monitor never violates the budgets it guards ([P03]).
- Idle fixes follow one doctrine: a write that changes nothing is a defect; a timer that can sleep must sleep; a waker that legitimately survives is named with its measured cost ([P04]).
- The typing charge is pursued on two fronts: attribute the after-layout walk (the RenderLayer-breadth hypothesis, brief `#typing-hypothesis`), and land a keystroke-latency gate that fails CI regardless of which mechanism regresses ([P08]).
- Multicore work is scoped to what the code actually is: the sparkline is SVG today, so brief item M2 is a *conversion* to worker-drawn `OffscreenCanvas` ([P05]); Tug.app is single-window today, so brief item M3 is the process-isolation groundwork verified by process count ([P06]); brief item M1 lands one worker offload against the top hotspot the attribution session names ([Q04]).

#### Success Criteria (Measurable) {#success-criteria}

- The M4 spike has a written yes/no verdict in `roadmap/jul29B-perf-brief.md#record` backed by a WebContent process count and a cross-stall observation (Step 1 checkpoint).
- Idle attribution closes arithmetically: measured wakes/s × measured per-wake cost predicts the `sample` busy total within ±25%, with every waker named (Step 3 checkpoint).
- A settled heavy deck reads **0 DOM writes/s** on the mutation census, enforced by a committed app-test (Step 5).
- Release idle busy ≤ **1.5%** on `scripts/perf-resize-profile.sh dev.tugtool.app idle 5`, three consecutive samples (Step 12; brief target ≤1%, tolerance for gauge readouts justified in the record if used).
- Typing keystroke→paint latency on the heavy fixture deck: **p50 < 9ms, p95 < 17ms**, enforced by a committed app-test (Step 11).
- The after-layout compositing walk under typing is attributed with a measured experiment (containment A/B), verdict recorded (Step 8).
- Brief items M1, M2, M3 landed; M5 untouched.

#### Scope {#scope}

1. The M4 out-of-process-iframe spike and its verdict.
2. Three new instruments in `perf-monitor.ts`: waker census, mutation census, RenderLayer-candidate probe.
3. The idle attribution session and the fixes it convicts (pulse readout change-gating first).
4. The idle-silence gate and the typing-latency gate as app-tests.
5. Typing attribution: layer ground truth + containment experiment, and productization if convicted.
6. Multicore: sparkline worker conversion (M2), per-window process pool (M3), one data-plane worker offload (M1).
7. Release re-profile and brief record updates.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Brief item M5 (separate WKWebView per heavy surface) — OUT by user call until further notice.
- `tuglaws/motion-residency.md` authorship — tracked in `roadmap/archive/animation-tuneup.md` step-19; the census remains the contract.
- The other five progress-indicator variants' settled-state costs ([Q06] of the archived animation-tuneup brief) — separate follow-on.
- Any windowing/virtualization of the transcript; estimated cell heights remain banned.
- Speculative worker offloads beyond the one Step 3 names ([P07] discipline: no threading without a named hotspot).

#### Dependencies / Prerequisites {#dependencies}

- A debug build with the app-test harness (`just app-debug`, `just app-test <files…>`) and a user-built release bundle for re-profiles (`just app-release`, `just launch-release`).
- `scripts/perf-resize-profile.sh` (exists; note its `applyKeyframeEffects` verdict-line false positive on finite transitions, brief `#method`).
- The corpus fixture `session-transcript-basic` (reference-seeded; session content never enters the repo) for heavy-deck tests, as used by `tests/app-test/at0289-transcript-motion-hygiene.test.ts`.
- Safari with the Develop menu for Web Inspector attribution sessions (the WKWebView is already inspectable: `tugapp/Sources/MainWindow.swift` sets `webView.isInspectable = true` unconditionally on macOS 13.3+).

#### Constraints {#constraints}

- bun, never npm; `bunx vite build` must pass before any tugdeck step is declared done (debug app loads the production rollup bundle).
- Rust warnings are errors; Swift changes must build via `just app-debug` / `just app-release`.
- App-tests: selective runs only (`just app-test-changed`, explicit files); every new test carries `@covers`; `just app-test-covers-check` enforces declarations and per-source fan-out budgets (`ACCEPTED_FANOUT` may need a new entry for `perf-monitor.ts`, which at0288/at0289 already cover).
- The perf monitor and all new instruments run only under `import.meta.env.DEV || window.__tugTestMode` (the existing gate in `tugdeck/src/main.tsx`); production carries zero instrument wakeups.
- Persistent state through tugbank `/api/defaults/...` only; no localStorage/IndexedDB anywhere in this plan.
- Only the user commits on `main`; the implement skill commits on a dash worktree via `tugutil dash commit` when run as a dash.

#### Assumptions {#assumptions}

- The heavy-deck profiles in the brief (8.3% idle, 65.9% typing) remain reproducible on the same machine; if the user's live deck changed materially, Step 3 re-baselines before attributing.
- `Date.now()` clocking in instruments is acceptable (they are dev/test-only measurement code, not product state).
- WebKit's `MutationObserver` sees `textContent` replacement as a `childList` mutation (it does — the old text node is removed, a new one added), so the mutation census catches the pulse readout's write pattern.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan follows the devise-skeleton conventions: explicit `{#anchor}` on every heading cited later, `[P##]` for plan-local decisions, `[Q##]` open questions, `S##` specs, `T##` tables, `R##` risks, `**Depends on:**` lines with `#step-N` anchors, and `**References:**` lines citing labels and anchors, never line numbers. Brief items M1–M5 are *brief-local* labels from `roadmap/jul29B-perf-brief.md#multicore-options`; this plan cites them as "brief M1" etc. to keep them distinct from any plan milestone.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Does WKWebView give a cross-origin iframe its own WebContent process on this macOS? (OPEN) {#q01-site-isolation}

**Question:** With a stock `WKWebViewConfiguration` (no experimental-feature toggles — we ship stock), does navigating an iframe to a different origin create a second WebContent process, and does main-thread load in one fail to stall the other?

**Why it matters:** This is the only honest path to "a session card on its own thread" (brief M4). If yes, per-card isolation becomes a real design option and graduates to IN with its own design pass; if no, the typing charge leans entirely on breadth/containment levers and the question closes permanently.

**Options (if known):** Origin trick — the deck is served at `http://127.0.0.1:<port>` (tugcast; vite in dev — see `AppDelegate.swift` `loadURL` call sites), and `http://localhost:<port>` is the *same server on a different origin*, so the spike needs no second server.

**Plan to resolve:** Step 1 spike, before all other work.

**Resolution:** OPEN — resolved by #step-1.

#### [Q02] Can off-viewport transcript entries carry `content-visibility: auto` without breaking transcript features? (OPEN) {#q02-containment-features}

**Question:** Does skipping rendering for off-screen transcript entries break find-in-transcript (which measures/reveals matches), the share gesture, reveal-scrolling under the sticky header (`reference: sticky-header reveal gotcha`), or CSS Custom Highlight painting?

**Why it matters:** If the containment experiment (Step 8) convicts tree breadth, `content-visibility` is the productization lever — but only if the features survive. The no-height-estimates doctrine also constrains the mechanism ([P09]).

**Plan to resolve:** Step 8 measures the perf effect with a style-injection experiment; Step 9 (conditional) does the feature-correctness pass before any productization.

**Resolution:** OPEN — resolved by #step-8 / #step-9.

#### [Q03] After change-gating, how much legitimate churn remains in the pulse gauge readouts? (OPEN) {#q03-gauge-churn}

**Question:** Once the readout paint writes only on actual formatted-string change, do live cpu/memory gauges still flip digits often enough at idle to keep waking the page?

**Why it matters:** [P04] allows named, justified live readouts — but if the last digit strobes at 4Hz, the fix is display quantization or a slower gauge cadence, which is a product-feel decision.

**Plan to resolve:** Step 4 measures the residual with the mutation census after change-gating lands; if residual writes exceed ~1/s per visible card, quantize the formatted precision (e.g. whole-percent cpu) in the same step and note it in the brief record.

**Resolution:** OPEN — resolved by #step-4.

#### [Q04] Which data-plane hotspot does the brief-M1 worker offload target? (OPEN) {#q04-m1-target}

**Question:** Which JS hotspot on the restore/ingestion path is worth the first worker: markdown parsing (`tugdeck/src/lib/markdown/parse-cache.ts` `ensureParsed`, already counted by `lib/markdown/parse-counters.ts`), transcript find indexing (`tugdeck/src/lib/transcript-find-engine.ts`), or diff computation (`components/tugways/body-kinds/diff-block.tsx`)?

**Why it matters:** [P07]: no speculative threading. Today's profiles show style/layout/compositing dominating, not JS — the offload must chase a *named* JS hotspot or it is busywork.

**Plan to resolve:** Step 3's attribution session profiles a cold restore of the heavy fixture (Web Inspector JavaScript & Events timeline) and names the top JS self-time entry; Step 10 implements that one.

**Resolution:** OPEN — resolved by #step-3, implemented by #step-10.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Site isolation absent in WKWebView (R01) | med | med | Spike is one step; verdict recorded; plan proceeds on breadth levers | New macOS/WebKit release notes |
| Change-gating starves a live readout (R02) | med | low | Gate on formatted-output equality only, never on raw value deltas | Q03 residual measurement |
| Canvas sparkline visual regression (R03) | med | med | Parity checklist + user gallery eyeball; staircase geometry ported 1:1 | Step 6 checkpoint |
| Containment breaks find/reveal/share (R04) | high | med | Experiment is style-injection only; productization gated on feature pass (Q02) | Step 9 tests |
| Typing gate flaky on machine variance (R05) | med | med | p50/p95 over ≥60 keystrokes, budgets with headroom, one retry, assert after settle | First CI failures |

**Risk R01: M4 spike answers "no"** {#r01-site-isolation-dead}

- **Risk:** WKWebView hosts cross-origin iframes in-process on this macOS; per-card isolation is dead on our engine.
- **Mitigation:** That outcome is a *successful* spike — the verdict is recorded in the brief and the question never burns another hour; the typing work (Steps 8–9, 11) does not depend on it.
- **Residual risk:** None material; the plan's other levers are independent.

**Risk R03: sparkline conversion changes the pixels** {#r03-sparkline-pixels}

- **Risk:** The worker-drawn canvas tape differs visibly from the SVG tape (stroke rendering, device-pixel snapping, area fill alpha, theme tint).
- **Mitigation:** Port the exact staircase geometry (`redraw()`'s sample-and-hold point construction), draw at `devicePixelRatio`, resolve stroke/fill colors from the same CSS custom properties on the main thread and re-post on theme change; keep the WAAPI scroll on the same `.tug-sparkline-track` element so motion is untouched.
- **Residual risk:** Sub-pixel stroke differences only the user's eyes can judge — the Step 6 checkpoint includes that eyeball explicitly.

---

### Design Decisions {#design-decisions}

#### [P01] The M4 spike runs first, before any other step (DECIDED) {#p01-spike-first}

**Decision:** Step 1 is the out-of-process-iframe spike; no other step starts until its verdict is written.

**Rationale:**
- User call, 2026-07-29 (brief `#multicore-options`): the verdict completes the IN list before execution order is locked.
- If per-card isolation is alive, it changes how hard later steps lean on containment.

**Implications:** Step 1 has no dependencies; every other step transitively depends on it.

#### [P02] Attribution before fixes; arithmetic must close (DECIDED) {#p02-attribution-first}

**Decision:** No fix ships before its cost is attributed, and an attribution is accepted only when measured wakes × measured per-wake cost predicts the sampled busy total within ±25%.

**Rationale:**
- The prior phase's lesson (brief `#top`): fixes aimed at categories left an unexplained 8%.
- A closure criterion makes "attributed" falsifiable instead of rhetorical.

**Implications:** Step 3 (idle) and Step 8 (typing) are measurement steps with docs-only commits; they gate the fix steps behind them.

#### [P03] Instruments live in `perf-monitor.ts`, dev/test-gated, windowed (DECIDED) {#p03-instruments-windowed}

**Decision:** The waker census, mutation census, and RenderLayer-candidate probe are implemented in `tugdeck/src/lib/perf-monitor.ts`, exposed on `window.tugPerfMonitor` inside the existing `import.meta.env.DEV || window.__tugTestMode` gate in `tugdeck/src/main.tsx`, and every observation window is explicitly started and stopped — no standing observers, no standing counters that tick at idle.

**Rationale:**
- The monitor "must never violate the thing it guards" (module docstring); a standing `MutationObserver` would be its own waker.
- One home, one exposure point, one graduation path — the same as `animationCensus` (instrument → convict → fix → gate).

**Implications:** Production builds carry zero instrument code paths at runtime; app-tests and the DevPanel are the only consumers.

#### [P04] The idle contract: change-gated writes, dormancy-gated timers, named survivors (DECIDED) {#p04-idle-contract}

**Decision:** An idle deck schedules zero rendering updates. Concretely: no DOM write may occur when its output is unchanged (compare the formatted string, write only on difference); every periodic timer must be dormancy-gated or subscriber-gated; any waker judged legitimately alive at idle is named in the brief record with its measured cost.

**Rationale:**
- `el.textContent = same string` still replaces the text node and dirties style — the pulse readout defect (brief H1) is exactly this.
- Zero-at-idle is the only budget that composes: any nonzero allowance grows silently.

**Implications:** The Step 5 gate asserts mutation-census zero on a settled test deck; product code adopts write-on-change as a standing convention.

#### [P05] Brief M2 is a conversion: the sparkline tape becomes a worker-drawn OffscreenCanvas, keeping the tape architecture (DECIDED) {#p05-sparkline-worker}

**Decision:** `TugSparkline` (`tugdeck/src/components/tugways/tug-sparkline.tsx`) replaces its `<svg>`/`<polyline>`/`<polygon>` tape with a `<canvas>` whose rendering context is transferred to a shared render worker (`transferControlToOffscreen`); the tape data model, staircase geometry, epoch-rebased WAAPI `translateX` scroll on `.tug-sparkline-track`, dormancy protocol, `IntersectionObserver` visibility gate, and `data-activity-channel` tinting attribute all stay exactly as they are; sampling stays on the main thread (it reads main-thread stores) and per-sample work becomes one `postMessage`.

**Rationale:**
- The brief said "OffscreenCanvas sparklines" but the component is SVG today — the 4Hz live-mode cost is `setAttribute("points", …)` style invalidation on the main thread, and that is what the conversion removes (a worker's canvas commit composites without waking the page's main thread).
- The tape/dormancy design survived careful review and A/Bs; rewriting it would be waste and risk. Only the *painting* moves.
- The in-repo precedent is `tugdeck/src/lib/workers/image-downsample-worker.ts` (Worker + OffscreenCanvas, `OffscreenCanvas` only goes off-thread when owned by a Worker).

**Implications:** Colors must be resolved on the main thread (`getComputedStyle` of the container's stroke/fill custom properties) and posted at init and on theme/`data-activity-channel` change; the worker draws at `devicePixelRatio`; Spec S05 is the protocol; laws [L06]/[L13] retained (appearance via DOM/compositor, motion stays WAAPI).

#### [P06] Brief M3 is per-window process-pool groundwork, verified by process count (DECIDED) {#p06-process-pool}

**Decision:** `MainWindow` (`tugapp/Sources/MainWindow.swift`) gives its `WKWebViewConfiguration` an explicitly non-shared `WKProcessPool` owned by the window instance, so any future second deck window gets its own WebContent process by construction; the checkpoint verifies one WebContent process per window via `pgrep`.

**Rationale:**
- Tug.app is single-window today (one `MainWindow` construction in `AppDelegate.swift`); the user-visible payoff of M3 arrives with multi-window support, but the isolation property should be structural now so it cannot regress silently later.
- Cost is a few lines of Swift; no behavior change for one window.

**Implications:** Documented in the brief record as "groundwork landed, payoff at multi-window"; no UI work in this plan.

#### [P07] No speculative threading (DECIDED) {#p07-no-speculative-threading}

**Decision:** Worker offloads land only against a hotspot named by a profile (Step 3 for brief M1); brief M5 gets zero work.

**Rationale:** User call, and brief `#multicore-exit` [E4]: today's bills are wake-rate and breadth, not JS compute.

**Implications:** Step 10 implements exactly one offload; further candidates go to the roadmap section, not to code.

#### [P08] The typing gate: keydown→post-paint, p50 < 9ms / p95 < 17ms over ≥60 keystrokes (DECIDED) {#p08-typing-gate}

**Decision:** The gate test installs an in-page probe (keydown listener records `performance.now()`; a `requestAnimationFrame` callback followed by a `setTimeout(0)` records post-paint completion; per-key latency = post-paint − keydown), drives ≥60 keystrokes into the session composer on the restored heavy fixture via `nativeType`, and asserts p50 < 9ms and p95 < 16.7ms, printing the full distribution.

**Rationale:**
- "Won't lag" must be a number that fails CI (brief `#typing-gate`); rAF-after-paint is the closest harness-observable proxy for frame commit WebKit gives us without Event Timing support.
- p50 catches steady-state cost; p95 catches the walk spikes; headroom (9 vs 16.7) keeps machine variance from flaking p50.

**Implications:** Budgets are calibrated once on the post-fix structure (after Step 8/9) and then frozen; loosening them requires a recorded decision, not a test edit in passing.

#### [P09] Containment must honor the no-height-estimates doctrine (DECIDED) {#p09-containment-heights}

**Decision:** If containment productizes (Step 9), off-screen transcript entries use `content-visibility: auto` with `contain-intrinsic-size: auto <last>` semantics only — the engine's *remembered real size* — never a hand-authored estimated height; if remembered-size semantics prove unavailable or unstable in our WebKit, productization stops and the verdict is recorded instead.

**Rationale:**
- Estimated cell heights are banned in this codebase (windowing was pivoted out on exactly this); `contain-intrinsic-size: auto` keeps the doctrine because the placeholder is the element's own last-rendered measurement.

**Implications:** Step 9's tasks include verifying remembered-size behavior empirically before any CSS ships.

---

### Deep Dives {#deep-dives}

#### The idle waker suspects, with code ground truth {#waker-suspects}

**Table T01: Periodic wakers in tugdeck as of 2026-07-29** {#t01-wakers}

| # | Source | Cadence | Gating today | Expected verdict path |
|---|--------|---------|--------------|----------------------|
| 1 | Pulse readout paint — `components/tugways/cards/pulse-card.tsx`, `READOUT_PAINT_MS = 250`, `paint()` writes `el.textContent` + `el.dataset.idle` unconditionally per `ChannelRow` | 4Hz × rows | None (runs while card mounted) | Smoking gun (brief H1); fix = change-gate ([P04]), Step 4 |
| 2 | Sparkline sampler — `components/tugways/tug-sparkline.tsx`, `SAMPLE_MS = 250`, live mode writes SVG `points` attributes | 4Hz × live tapes | Rate rows dorm via `subscribeRateActivity`; **gauge rows never dorm** (`subscribeActivity` undefined by design) | Convict via census; fix = [P05] conversion (Step 6) removes the style dirt; gauge always-alive policy re-costed in Step 3 |
| 3 | Shared telemetry tick — `components/tugways/cards/session-card-telemetry-renderers.tsx`, module-scoped `setInterval(…, 1_000)` | 1Hz | Subscriber-gated (stops at zero subscribers) | Census says whether anything subscribes at idle |
| 4 | `useLifecycleTick` — `lib/code-session-store/hooks/use-lifecycle-tick.ts` | 1Hz | Turn-gated (`isLivePhase`), `alsoWhile` escape hatch | Expected innocent; check `alsoWhile` holders |
| 5 | Non-timer wakes: IntersectionObserver deliveries, WebSocket → store notify → commit, animation-event bookkeeping for running accelerated loops | — | — | Only reachable via Web Inspector timeline (Step 3) |

The perf monitor's own 1Hz heartbeat (`perf-monitor.ts`, `HEARTBEAT_MS`) fires in dev/test builds only — attribution sessions on the release bundle are unpolluted by it; census sessions on debug must subtract it.

#### Why `sample` cannot finish this job {#sample-limits}

`sample` sees stack frames, not causes: it shows `TreeResolver::resolve` but never the mutation that dirtied the tree, `updateRendering` but never who scheduled it. The two instruments that close the gap: Safari Web Inspector Timelines (initiator attribution per rendering frame — available because `MainWindow.swift` sets `isInspectable` unconditionally) and the in-page censuses (S01/S02), which make the same facts app-testable. `scripts/perf-resize-profile.sh` remains the end-to-end release thermometer, with its known false positive: nonzero `applyKeyframeEffects` reached through `updateCSSTransitionsForStyleableAndProperty` is a finite transition doing its job, not an unaccelerated loop (brief `#method`).

#### The after-layout walk under typing (brief H6) {#after-layout-walk}

Every keystroke makes CM6 lay out (necessary); layout triggers `updateCompositingLayersAfterLayoutIfNeeded`, whose `computeCompositingRequirements` recursion visits every RenderLayer — created by positioned elements, overflow scrollers, and transforms, a far larger population than the 119 stacking contexts `layerTreeProbe` counts. That would explain the prior A/B cleanly: forcing 28 sticky headers static removed 28 contexts from thousands of layers — invisible, exactly as observed (241+61 samples invariant across all three phases). The decisive tests: the Web Inspector Layers tab (real composited-layer list with reasons), the S03 candidate count (app-testable denominator), and the containment experiment (shrink the walked tree, re-measure).

---

### Specification {#specification}

**Spec S01: Waker census** {#s01-waker-census}

`startWakerCensus()` installs wrappers over `window.setInterval`, `window.setTimeout`, and `window.requestAnimationFrame` (idempotent; original functions retained and always called through). Each registration records a callsite key — the top non-perf-monitor frame of `new Error().stack` — plus kind and period. `readWakerCensus(windowMs)` returns, after observing for `windowMs`: `{ entries: [{ kind: "interval"|"timeout"|"raf", callsite: string, activeCount: number, firesPerSecond: number, periodMs: number|null }], totalFiresPerSecond: number }`, sorted by fires/s. `stopWakerCensus()` unwraps. Wrapping happens only when explicitly started (never at boot), so timers created before the census started are visible via their *fires* (the wrapper wraps the primitive, so pre-existing intervals registered before wrapping are the one blind spot — the census doc must state it, and the attribution session compensates by hard-reloading the deck with the census armed via a `sessionStorage`-free URL flag: `?wakerCensus=1` read in `main.tsx` inside the dev/test gate).

**Spec S02: Mutation census** {#s02-mutation-census}

`mutationCensus(windowMs)` returns a Promise: installs one `MutationObserver` on `document.documentElement` (`childList`, `attributes`, `characterData`, `subtree`, with old-value capture off), accumulates for `windowMs`, disconnects, resolves `{ windowMs, totalWrites, writesPerSecond, byTarget: [bucket, count][], byType: { childList, attributes, characterData } }` where `bucket` is `tag.class.class` (first two classes) of the mutation target's element (or its parent element for text nodes), sorted desc, capped at 20 buckets. Attribute mutations that set an identical value are still delivered by the platform and counted — that is correct for our purpose (the write itself is the defect).

**Spec S03: RenderLayer-candidate probe** {#s03-layer-candidates}

`layerTreeProbe()` (existing, `perf-monitor.ts`) gains: `renderLayerCandidates: number` and `renderLayerHistogram: [string, number][]` — elements whose computed style has `position !== "static"`, or `overflow`/`overflow-x`/`overflow-y` in `{auto, scroll, hidden}` (hidden included: WebKit creates layers for clipping contexts), or `transform !== "none"`, or non-auto `will-change`, bucketed like `stackingHistogram`. The existing `display: none` short-circuit applies. This is a *candidate* count (an upper-bound proxy for RenderLayer population), and the field docs must say so.

**Spec S04: Typing-latency probe and gate** {#s04-typing-probe}

Probe (installed by the gate test via `evalJS`): a capture-phase `keydown` listener on `document` records `performance.now()` into a pending slot; `requestAnimationFrame(() => setTimeout(() => record(now - pending), 0))` closes it (post-paint proxy). Collects `{ samples: number[], p50, p95, max }`; the test types ≥60 characters via `nativeType` with the composer focused on the restored `session-transcript-basic` fixture, waits for settle, asserts [P08] budgets, prints the distribution.

**Spec S05: Sparkline render-worker protocol** {#s05-sparkline-protocol}

One module-scoped shared worker instance (`tugdeck/src/lib/workers/sparkline-render-worker.ts`, plain dedicated Worker shared by all sparklines via an id-keyed registry — mirrors the downsample worker's build wiring). Messages, all `{ id }`-keyed per sparkline instance:

- `init { id, canvas: OffscreenCanvas (transferred), width, height, dpr, svgWidth, baselineY, amplitude, colors: { line, area } }`
- `tape { id, points: { t, v }[] , t0 }` — full rebuild (mount, wake, epoch rebase)
- `sample { id, t, v, t0 }` — append one point and redraw
- `colors { id, colors }` — theme or `data-activity-channel` change (main thread resolves computed colors)
- `clear { id }` / `dispose { id }`

The worker owns the tape array and the staircase geometry (ported verbatim from `redraw()`: flat hold to each new sample's x, step, held tail past the right edge, area polygon closed to `baselineY`); the main thread owns timers, dormancy, WAAPI scroll, visibility, and data reads. Nothing returns from the worker on the hot path.

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

| State | Zone (appearance / local-data / structure) | Mechanism | Law |
|-------|--------------------------------------------|-----------|-----|
| Waker/mutation census registries | none (dev/test instrument, module-scoped, windowed) | module singletons in `perf-monitor.ts`, read by probes | [P03]; explicitly not React state |
| Sparkline worker handle + per-instance id | local resource, not state | `useRef` inside `TugSparkline`'s existing `useLayoutEffect`; released in cleanup | [L03], [L27] |
| Pulse readout last-formatted string | local data (imperative write guard) | closure variable beside `paint()` in the existing effect | [L06] (appearance stays DOM-written) |
| Canvas pixel content | appearance | worker draws; compositor presents | [L06], [L13] (scroll stays WAAPI) |
| No new React state anywhere in this plan | — | — | [L24] table complete |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/public/perf-spike-iframe.html` | M4 spike page: rAF counter into `document.title`, `?busy=1` synchronous spin loop (temporary; removed in #step-12) |
| `tugdeck/src/lib/workers/sparkline-render-worker.ts` | S05 worker: tape ownership + staircase drawing |
| `tests/app-test/at0290-perf-instruments.test.ts` | Instrument self-test (S01/S02/S03 anti-vacuity) |
| `tests/app-test/at0291-idle-silence.test.ts` | E1 gate: mutation census 0 writes/s on a settled deck |
| `tests/app-test/at0292-typing-latency.test.ts` | E3 gate: [P08] budgets on the heavy fixture |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `startWakerCensus` / `readWakerCensus` / `stopWakerCensus` | fn | `tugdeck/src/lib/perf-monitor.ts` | S01 |
| `mutationCensus` | fn | `tugdeck/src/lib/perf-monitor.ts` | S02 |
| `renderLayerCandidates`, `renderLayerHistogram` | fields | `LayerTreeProbe`, `tugdeck/src/lib/perf-monitor.ts` | S03 |
| `tugPerfMonitor` exposure | object | `tugdeck/src/main.tsx` | add the new fns inside the existing dev/test gate; honor `?wakerCensus=1` |
| `paint` change-gate | closure | `tugdeck/src/components/tugways/cards/pulse-card.tsx` | [P04]: compare formatted string + idle flag, write on change only |
| `TugSparkline` canvas mode | component | `tugdeck/src/components/tugways/tug-sparkline.tsx` | [P05]/S05; SVG elements removed |
| per-window `WKProcessPool` | Swift | `tugapp/Sources/MainWindow.swift` | [P06] |
| brief M1 offload | worker | target named by #step-3 ([Q04]) | one offload only ([P07]) |

---

### Documentation Plan {#documentation-plan}

- [ ] `roadmap/jul29B-perf-brief.md#record`: spike verdict, attribution tables, arithmetic closure, fix before/afters, containment verdict, final release numbers.
- [ ] `perf-monitor.ts` module docstring: extend the budgets section with the idle-contract sentence ([P04]) and document the S01 pre-existing-timer blind spot.
- [ ] Brief `#method`: add the censuses to the instrument list.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **App-test (instrument self-test)** | Prove each census sees what it must (anti-vacuity floors) | at0290: a deliberately created interval is counted; a deliberate DOM write is counted; candidates > 0 on a seeded deck |
| **App-test (gate)** | Enforce the exit criteria permanently | at0291 idle silence, at0292 typing latency |
| **Unit (bun)** | Pure logic only | callsite bucketing, formatted-string gate predicate — real timers in bun runtime, no fake DOM |
| **Operator-assisted measurement** | Attribution sessions on the real deck | Steps 3 and 8; deliverable is the brief record, not a test |

#### What stays out of tests {#test-non-goals}

- Visual parity of the canvas sparkline — no pixel-diff harness; the user's gallery eyeball is the checkpoint (screenshots via `app.screenshot()` are available for the record but not asserted, per the highlight-wash gotcha).
- Web Inspector timeline contents — human instrument, not automatable.
- The M4 spike — it ends in a recorded verdict, not a committed test (the spike page itself is removed at close).
- Long real-scribe UI flows — out of scope per the transient-workspace constraint; nothing here needs them.

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass.** Applies to every step.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | M4 spike: out-of-process iframe verdict | pending | — |
| #step-2 | Instruments: waker census, mutation census, layer candidates | pending | — |
| #step-3 | Idle attribution session (arithmetic closure) | pending | — |
| #step-4 | Kill the idle wakes: change-gate the pulse readout + convicted fixes | pending | — |
| #step-5 | Idle-silence gate (at0291) | pending | — |
| #step-6 | Sparkline → worker-drawn OffscreenCanvas (brief M2) | pending | — |
| #step-7 | Per-window process pool (brief M3) | pending | — |
| #step-8 | Typing attribution: layer ground truth + containment experiment | pending | — |
| #step-9 | Containment productization (conditional on #step-8) | pending | — |
| #step-10 | Data-plane worker offload (brief M1) | pending | — |
| #step-11 | Typing-latency gate (at0292) | pending | — |
| #step-12 | Release re-profile, record, cleanup | pending | — |

#### Step 1: M4 spike — out-of-process iframe verdict {#step-1}

**Commit:** `tugdash(jul29B-perf): spike page for the out-of-process iframe verdict`

**References:** [P01] spike first, [Q01] site isolation, Risk R01, (#waker-suspects, brief `#multicore-options`)

**Artifacts:**
- `tugdeck/public/perf-spike-iframe.html` (temporary, removed in #step-12): standalone page, no bundle imports — an rAF loop writing a frames-per-second figure into `document.title`, a visible spinning `div` (CSS transform loop), and when loaded with `?busy=1` a repeating 200ms synchronous spin (`while (performance.now() < t + 200)` scheduled every 250ms) to saturate its main thread.
- Verdict paragraph in `roadmap/jul29B-perf-brief.md#record`.

**Tasks:**
- [ ] Add the spike page; verify it is served in dev (vite serves `public/` at root) and by the debug app's origin.
- [ ] With the debug app running, inject the cross-origin iframe from the app-test harness or Web Inspector console: the deck's origin is `http://127.0.0.1:<port>` and `http://localhost:<port>/perf-spike-iframe.html?busy=1` is the same server on a different origin — no second server needed. (`document.body.appendChild(Object.assign(document.createElement("iframe"), { src: … }))`.)
- [ ] Observation A (process): `pgrep -fl 'WebKit.WebContent' | wc -l` before and after the iframe loads, attributing by Tug's cache path via `lsof` as `scripts/perf-resize-profile.sh` does. Second process appears → out-of-process; count unchanged → in-process.
- [ ] Observation B (stall): with `?busy=1` active, measure the deck's own responsiveness — `window.tugPerfMonitor.snapshot()` drift stalls over 30s, and typed input feel. If out-of-process, deck stalls must not correlate with the iframe's busy loop; if in-process, they will, confirming Observation A.
- [ ] Write the verdict (yes/no, evidence, WebKit/macOS version) into the brief record; if yes, add a follow-on line to #roadmap for the per-card isolation design pass — do not start it.

**Tests:**
- [ ] None committed (spike; verdict is the artifact).

**Checkpoint:**
- [ ] The brief record contains the verdict with both observations' numbers; `bunx vite build` still clean.

---

#### Step 2: Instruments — waker census, mutation census, layer candidates {#step-2}

**Depends on:** #step-1

**Commit:** `tugdash(jul29B-perf): waker + mutation censuses and layer-candidate probe, with self-test`

**References:** [P03] windowed instruments, Spec S01, Spec S02, Spec S03, (#sample-limits, #t01-wakers)

**Artifacts:**
- S01/S02/S03 implemented in `tugdeck/src/lib/perf-monitor.ts`; exposure added to `window.tugPerfMonitor` in `tugdeck/src/main.tsx` inside the existing dev/test gate, plus the `?wakerCensus=1` boot-arm flag (S01 blind-spot mitigation).
- `tests/app-test/at0290-perf-instruments.test.ts` with `@covers tugdeck/src/lib/perf-monitor.ts` (extend `ACCEPTED_FANOUT` if `just app-test-covers-check` objects — at0288/at0289 already cover this file).

**Tasks:**
- [ ] Implement S01 with the documented pre-existing-timer blind spot noted in the fn docstring; wrappers must pass through return values and `clearInterval`/`cancelAnimationFrame` identity.
- [ ] Implement S02 (Promise-based window; observer disconnected in a `finally`).
- [ ] Implement S03 fields on `LayerTreeProbe`; document "candidate = upper-bound proxy".
- [ ] at0290: (a) arm census, create a 50ms interval via `evalJS`, read ≥ its expected fires ±1 and its callsite bucket non-empty, clear it; (b) run `mutationCensus(1000)` across a deliberate `textContent` write and assert it is counted in `byTarget` under the right bucket, then across a quiet window on the same DOM and assert near-zero; (c) seed `gallery-tug-progress-indicator` (constants as in `at0288`) and assert `renderLayerCandidates > 0` and `> ` the empty-deck reading.

**Tests:**
- [ ] `just app-test at0290-perf-instruments.test.ts` green.

**Checkpoint:**
- [ ] `bunx tsc --noEmit` (tugdeck) clean; `bunx vite build` clean; `just app-test-covers-check` clean; at0290 green.

---

#### Step 3: Idle attribution session — arithmetic closure {#step-3}

**Depends on:** #step-2

**Commit:** `tugdash(jul29B-perf): record idle attribution — every waker named, arithmetic closed`

**References:** [P02] attribution first, [Q03] gauge churn, [Q04] M1 target, Table T01, (#sample-limits, #waker-suspects, brief `#idle-arithmetic`)

**Artifacts:**
- Attribution tables in `roadmap/jul29B-perf-brief.md#record`: wakes/s by named source (waker census, `?wakerCensus=1` boot-armed), DOM writes/s by target (mutation census), Web Inspector Rendering Frames initiators for a 10s idle window, and the closure computation (wakes × per-wake cost vs `sample` busy, ±25%).
- The named brief-M1 hotspot ([Q04]): top JS self-time entry from a cold heavy-fixture restore, Web Inspector JavaScript & Events timeline.

**Tasks:**
- [ ] Operator-assisted: on the user's heavy deck (debug build for censuses; release bundle + `sample` for the busy numbers), run the three instruments and one `scripts/perf-resize-profile.sh dev.tugtool.app idle 5` triplet; subtract the perf monitor's own heartbeat on debug readings.
- [ ] Convict/absolve each Table T01 row; name any waker outside the table.
- [ ] Record the residual-churn measurement that resolves [Q03]'s input (pre-fix readout write rate).
- [ ] Profile one cold restore of `session-transcript-basic`; record the top-3 JS self-time entries and name the [Q04] target.

**Tests:**
- [ ] None (docs-only step; [P02]).

**Checkpoint:**
- [ ] The closure computation is in the record and lands within ±25%, or the discrepancy is itself named as a finding with a follow-up hypothesis. Every row of T01 carries a verdict.

---

#### Step 4: Kill the idle wakes — change-gate the pulse readout + convicted fixes {#step-4}

**Depends on:** #step-3

**Commit:** `tugways(pulse): write readouts only on change; dormancy for convicted wakers`

**References:** [P04] idle contract, [Q03] gauge churn, Table T01, Risk R02, (#waker-suspects)

**Artifacts:**
- `pulse-card.tsx` `paint()` gated: compute the formatted string and idle flag, write `textContent`/`dataset.idle` only when either differs from the last written values (closure variables; see #state-zone-mapping).
- Fixes for any additional Step-3-convicted waker (each small; if one grows past a focused diff, split it into its own step at implement time and note it in the ledger).
- [Q03] resolution: post-fix residual writes/s measured; if > ~1/s per visible card, quantize the gauge display precision in the same commit and record the choice.

**Tasks:**
- [ ] Implement the change gate ([P04]: compare formatted output, never raw values — R02).
- [ ] Re-run `mutationCensus(3000)` on a mounted, idle Pulse card; record before/after in the brief.
- [ ] Apply the other convicted fixes from Step 3's table.

**Tests:**
- [ ] Extend the existing Pulse-covering app-test selection (`just app-test-changed` will derive it via `@covers`) — all green.

**Checkpoint:**
- [ ] `bunx vite build` clean; `just app-test-changed` green; brief record carries the before/after writes/s.

---

#### Step 5: Idle-silence gate — at0291 {#step-5}

**Depends on:** #step-4

**Commit:** `tugdash(jul29B-perf): gate idle silence — zero DOM writes on a settled deck`

**References:** [P04] idle contract, Spec S02, (#success-criteria), brief `[E1]`

**Artifacts:**
- `tests/app-test/at0291-idle-silence.test.ts` (`@covers` the pulse card, `perf-monitor.ts`): seeds a deck with a Pulse card and a restored `session-transcript-basic` session card (cold restore, `waitForTranscriptSettled`), waits a settle window, then asserts `mutationCensus(3000)` reads `totalWrites === 0` and `readWakerCensus(3000)` shows no interval firing into a DOM-writing callsite bucket (assert on the census tables printed for diagnosis).

**Tasks:**
- [ ] Write the test with an anti-vacuity floor: before the quiet window, perform one deliberate write and assert the census counts it (the instrument is alive), then measure the real window.
- [ ] Account for the app-test transient-workspace constraint (changeset entries live ~2s): let that churn finish inside the settle window before the measured window opens.

**Tests:**
- [ ] `just app-test at0291-idle-silence.test.ts` green three consecutive runs (flake check).

**Checkpoint:**
- [ ] at0291 green ×3; `just app-test-covers-check` clean.

---

#### Step 6: Sparkline → worker-drawn OffscreenCanvas (brief M2) {#step-6}

**Depends on:** #step-4

**Commit:** `tugways(sparkline): paint the tape in a worker — OffscreenCanvas, geometry and dormancy unchanged`

**References:** [P05] conversion decision, Spec S05, Risk R03, (#state-zone-mapping), brief `#multicore-options` M2

**Artifacts:**
- `tugdeck/src/lib/workers/sparkline-render-worker.ts` (S05); `tug-sparkline.tsx` converted (SVG elements out, one `<canvas>` in the track; all lifecycle/dormancy/scroll logic untouched); `tug-sparkline.css` adjusted if the SVG selectors referenced element types.

**Tasks:**
- [ ] Port `redraw()`'s staircase geometry into the worker verbatim (flat hold, step, held tail, area to baseline); draw at `devicePixelRatio`.
- [ ] Resolve line/area colors on the main thread from the container's computed style at init, on theme change, and on `data-activity-channel` change; post `colors` messages (R03).
- [ ] Wire the worker with the same bundler pattern as `image-downsample-worker.ts` (`new Worker(new URL(…), { type: "module" })` — copy its wiring, it is the proven path through vite).
- [ ] Instance registry keyed by id; `dispose` on effect cleanup ([L27]).
- [ ] Fallback: if `transferControlToOffscreen` is unavailable (it is not expected to be — the downsample worker proves support), render on-main into the same canvas with the same drawing module; one code path for geometry either way.

**Tests:**
- [ ] `just app-test-changed` (derives Pulse/sparkline coverage via `@covers`) green.
- [ ] at0291 still green (the conversion must not add wakes).

**Checkpoint:**
- [ ] `bunx vite build` clean; `just app-test-changed` green; at0291 green; **user gallery eyeball** of the Pulse card live + dormant (R03 residual) — record their verdict before commit.

---

#### Step 7: Per-window process pool (brief M3) {#step-7}

**Depends on:** #step-1

**Commit:** `tugapp: per-window WKProcessPool — process isolation groundwork for multi-window`

**References:** [P06] process pool, (#assumptions), brief `#multicore-options` M3

**Artifacts:**
- `MainWindow.swift`: the window's `WKWebViewConfiguration` gets an instance-owned `WKProcessPool` (`config.processPool = WKProcessPool()` beside the existing configuration setup).

**Tasks:**
- [ ] Implement; confirm no interaction with the DEBUG test-harness user-script injection path.
- [ ] Verify: `just app-debug`, launch, `pgrep -fl 'WebKit.WebContent'` attributed via Tug's cache path shows exactly one WebContent process for the window; app boots to a working deck.
- [ ] Note in the brief record: groundwork landed; user-visible payoff arrives with multi-window support (single-window app today, one `MainWindow` construction in `AppDelegate.swift`).

**Tests:**
- [ ] `just app-test-smoke` green (boot-path change → the curated smoke trio is the right scope; a CORE TIER ADVISED advisory from `app-test-changed`, if any, is answered with `just app-test`).

**Checkpoint:**
- [ ] Debug and release builds succeed; smoke green; process count verified.

---

#### Step 8: Typing attribution — layer ground truth + containment experiment {#step-8}

**Depends on:** #step-2, #step-5

**Commit:** `tugdash(jul29B-perf): record typing attribution — after-layout walk named, containment verdict`

**References:** [P02] attribution first, [Q02] containment features, Spec S03, Risk R04, (#after-layout-walk), brief `#typing-hypothesis`

**Artifacts:**
- Brief record: S03 candidate counts on the heavy deck (empty vs seeded, histogram), Web Inspector Layers-tab reading (real composited layers, reasons), and the containment A/B — typing profile (`sample` during a scripted 15s `nativeType` burst) with and without an injected style forcing `content-visibility: auto` on off-viewport transcript entries (`evalJS` style injection on the restored heavy fixture; identify the entry selector from `components/tugways/tug-transcript-entry.tsx` at implement time).
- H6 verdict: does shrinking the walked tree collapse the after-layout walk (241+61 baseline)?

**Tasks:**
- [ ] Idle wakes are already silenced (#step-5 dependency), so the typing profile is unpolluted — note this in the record's method line.
- [ ] Run the A/B; record after-layout walk samples, total busy, and the S04 probe's latency distribution in both arms (the probe exists as an evalJS snippet ahead of its gate).
- [ ] Preliminary [Q02] feature probe in the containment arm: run a transcript find, a reveal-scroll, and a share gesture by hand; note breakage candidates for Step 9.
- [ ] If the containment arm does NOT move the walk, name the next hypothesis from the Layers-tab evidence (scroller layers, overlay ancestors forcing root-wide invalidation) and record it — Step 9 is then skipped and its ledger row marked accordingly.

**Tests:**
- [ ] None (docs-only; [P02]).

**Checkpoint:**
- [ ] The record contains both arms' numbers and a stated verdict; [Q02]'s feature-probe notes exist if Step 9 proceeds.

---

#### Step 9: Containment productization (conditional) {#step-9}

**Depends on:** #step-8

**Commit:** `tugways(transcript): content-visibility on off-viewport entries — walked tree, not estimates`

**References:** [P09] doctrine boundary, [Q02] containment features, Risk R04, (#after-layout-walk)

**Artifacts:**
- CSS (+ minimal component wiring if an attribute hook is needed) applying `content-visibility: auto` to transcript entries, honoring [P09]: `contain-intrinsic-size: auto`-remembered real sizes only — verify empirically that scroll position is stable across an entry leaving and re-entering the viewport before shipping; if remembered-size semantics are unstable in our WebKit, stop and record instead.

**Tasks:**
- [ ] Implement; run the [Q02] feature matrix as tests where coverable: find-in-transcript reveal (respecting the sticky-header reveal constraint — reveals must clear the stuck header bottom), share gesture, scroll restoration on card switch.
- [ ] Re-run the Step 8 typing profile; record the landed after/before.

**Tests:**
- [ ] `just app-test-changed` green (transcript `@covers` fan-in).

**Checkpoint:**
- [ ] `bunx vite build` clean; feature matrix green; typing profile improvement recorded; user eyeball on transcript scrolling feel.

---

#### Step 10: Data-plane worker offload (brief M1) {#step-10}

**Depends on:** #step-3

**Commit:** `tugdeck: move <named hotspot> off the main thread — worker offload per attribution`

**References:** [P07] no speculative threading, [Q04] M1 target, (#symbol-inventory), brief `#multicore-options` M1

**Artifacts:**
- One worker offload for the hotspot Step 3 named (candidates and their current homes: markdown `ensureParsed` in `lib/markdown/parse-cache.ts` with `recordRowParse` counters already in place; find indexing in `lib/transcript-find-engine.ts`; diff compute in `body-kinds/diff-block.tsx`). Wiring pattern: `image-downsample-worker.ts`.

**Tasks:**
- [ ] Implement against the named target only; preserve the synchronous fast path where results are cached (e.g. `parse-cache` hits must not gain a worker round-trip).
- [ ] Measure the restore-path improvement (repeat Step 3's cold-restore profile; record before/after top JS self-time).

**Tests:**
- [ ] `just app-test-changed` green; existing unit tests for the moved logic still green (`bun test` in tugdeck).

**Checkpoint:**
- [ ] `bunx vite build` clean (worker bundling verified — this is exactly the class of import that breaks the rollup build while dev works); before/after recorded.

---

#### Step 11: Typing-latency gate — at0292 {#step-11}

**Depends on:** #step-8, #step-9

**Commit:** `tugdash(jul29B-perf): gate typing latency — p50/p95 budgets on the heavy fixture`

**References:** [P08] typing gate, Spec S04, Risk R05, (#success-criteria), brief `[E3]`

**Artifacts:**
- `tests/app-test/at0292-typing-latency.test.ts` (`@covers` the session composer surface + `perf-monitor.ts` if the probe graduates into it): S04 probe, ≥60 keystrokes via `nativeType` into the focused composer on the restored heavy fixture, budgets asserted, distribution printed.

**Tasks:**
- [ ] Calibrate once on the post-Step-9 structure; freeze budgets ([P08]); space synthetic gestures with settle delays per the first-responder harness constraint.
- [ ] One retry on budget failure (R05), with both distributions printed when the retry differs.

**Tests:**
- [ ] `just app-test at0292-typing-latency.test.ts` green three consecutive runs.

**Checkpoint:**
- [ ] at0292 green ×3; `just app-test-covers-check` clean.

---

#### Step 12: Release re-profile, record, cleanup {#step-12}

**Depends on:** #step-5, #step-6, #step-7, #step-10, #step-11

**Commit:** `tugdash(jul29B-perf): release re-profile against exit criteria; spike page removed`

**References:** [P02] arithmetic closure, (#success-criteria, #exit-criteria), brief `#exit`

**Artifacts:**
- Brief `#record` closed: three idle samples on a fresh user-built release bundle (`just app-release`; verify the bundle's JS/CSS carry this plan's changes before sampling — the prior phase was once burned by profiling a stale bundle), typing-gate numbers, every exit line answered.
- `tugdeck/public/perf-spike-iframe.html` deleted.

**Tasks:**
- [ ] `scripts/perf-resize-profile.sh dev.tugtool.app idle 5` ×3 on the release bundle; target ≤1.5% (#success-criteria); read the `applyKeyframeEffects` line through the known false positive before believing any verdict.
- [ ] If the target misses, the miss is attributed with the censuses before this step closes — an unexplained miss reopens Step 3, and the ledger says so.
- [ ] Remove the spike page; confirm zero `zz-`/spike artifacts remain (`ls tugdeck/public/ tests/app-test/`).

**Tests:**
- [ ] `just app-test at0290 at0291 at0292` green as a set.

**Checkpoint:**
- [ ] All #exit-criteria boxes checkable with evidence in the brief record; `bunx vite build` clean; the three gates green.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A release build whose idle renderer is silent and explained, whose style recalcs at idle are zero and gated, whose typing latency is under a committed budget test, and whose committed multicore work (brief M1/M2/M3) is landed — with the M4 verdict on the record.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] M4 verdict written with process-count and cross-stall evidence (brief record).
- [ ] Idle attribution closed arithmetically (±25%) with every waker named.
- [ ] at0291 (idle silence: 0 DOM writes/s settled) committed and green.
- [ ] Release idle busy ≤1.5% ×3 samples on a verified-fresh bundle.
- [ ] at0292 (typing: p50 < 9ms, p95 < 17ms, ≥60 keys, heavy fixture) committed and green.
- [ ] After-layout walk under typing attributed; containment verdict recorded (landed or refuted).
- [ ] Sparkline tape painted in a worker; Pulse card visually blessed by the user.
- [ ] Per-window process pool landed and verified; M1 offload landed against the named hotspot.
- [ ] Spike page removed; brief record complete.

**Acceptance tests:**
- [ ] `just app-test at0290-perf-instruments.test.ts at0291-idle-silence.test.ts at0292-typing-latency.test.ts`
- [ ] `just app-test-covers-check`

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Per-card isolation design pass — only if the M4 verdict is yes ([Q01]).
- [ ] Gauge cadence/precision product decision beyond the [Q03] quick fix, if residual churn was quantized.
- [ ] Remaining indicator variants' settled-state costs (archived animation-tuneup [Q06]/step-16/step-18).
- [ ] `tuglaws/motion-residency.md` authorship (archived animation-tuneup step-19).
- [ ] Further worker offloads beyond the Step 10 target, each against its own named profile.

| Checkpoint | Verification |
|------------|--------------|
| Idle silence | at0291 green; mutation census 0 writes/s |
| Idle explained | closure arithmetic in brief record, ±25% |
| Typing gated | at0292 green ×3 |
| Release number | `perf-resize-profile.sh` idle ≤1.5% ×3 |
| Multicore IN list | M1/M2/M3 commits in ledger; M4 verdict recorded; M5 zero commits |
