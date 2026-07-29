# Perf brief 29B — from circling to the bullseye {#top}

Successor to `roadmap/jul29-perf-tuneup-brief.md`. That brief's program cut idle renderer busy from 13.8% to 8.3% by shrinking composited breadth (438 pulsing-dot stacking contexts → 0, retained transitions → 0, sticky A/B). This brief exists because that is not good enough, and because the remaining cost is **measured but not attributed**. Three charges stand:

1. **The remaining ~8% at idle is unexplained.** We know its shape (86% of busy is `Page::updateRendering`) but not its cause — nobody has named what *schedules* those rendering updates on a deck that is supposedly at rest.
2. **Style recalculation has never been attributed.** `Style::TreeResolver::resolve` holds ~23 samples per 5s at idle (~7% of busy) and we cannot say which component's DOM writes cause it.
3. **There is no guarantee typing won't lag.** Typing busy measured 65.9% on the heavy card; the dominant term (`updateCompositingLayersAfterLayoutIfNeeded`, 241+61 samples) survived both A/B suspects (sticky headers forced static, all 506 ResizeObservers disconnected) and is attributed to nothing. There is no regression gate that would catch typing lag coming back.

The rule for this brief: **no fix ships before its cost is attributed, and no attribution counts until it predicts the profile numerically.** We have been paying for fixes aimed at categories ("animations", "stickies"). The bullseye is a causal model where every busy sample has a name, and the fixes fall out.


## The mechanism model {#mechanism}

Everything measured so far fits one equation:

> **renderer busy = (rendering updates per second) × (cost per update)**

The cost-per-update side is now well understood: each dirty frame pays `Document::resolveStyle`, then **two** full compositing walks (`updateCompositingLayersAfterStyleChange` and, when layout ran, `updateCompositingLayersAfterLayoutIfNeeded`), and each walk's cost tracks the size of the layer tree, not the size of the change. The jul29 program attacked exactly this side and the after-style walk fell 424 → ~79 samples on the same deck. Proven, closed.

The wake side has never been measured. **At true idle nothing should schedule a rendering update at all** — no dirty style, no rAF, no animation events, no observer deliveries. 303 samples of `updateRendering` per 5s means something wakes the page several times a second, forever. Cut wakes to zero and idle busy approaches zero *regardless of tree breadth*; that is the idle bullseye, and it makes the remaining breadth work (which still matters for typing) a separate axis instead of a confounded one.


## Charge 1 — attribute the idle 8% {#idle-attribution}

### The named suspects {#idle-suspects}

Grepped from the live tree, these are the periodic wakers that exist in tugdeck today. Each is a hypothesis to convict or absolve with the waker census (#instruments), not a pre-judged villain — but H1 is a smoking gun on inspection:

**[H1] Pulse-card readout paint — 4Hz per row, ungated, writes on every tick.** `pulse-card.tsx:108` sets `READOUT_PAINT_MS = 250`; the `paint` closure (`pulse-card.tsx:194–213`) runs on `setInterval` for every mounted `ChannelRow` and executes `el.textContent = formatValue(...)` plus `el.dataset.idle = ...` **unconditionally**. Assigning `textContent` replaces the text node even when the string is identical — that is a DOM mutation, a style invalidation, and a scheduled rendering update, 4×/s×rows, at rest. The sparkline beneath the row has a dormancy protocol; the readout above it has none. If a Pulse card was mounted during any idle profile, this alone plausibly accounts for the wake cadence.

**[H2] Gauge sparklines never dorm — by design, but the design predates the walk bill.** `tug-sparkline.tsx:58` (`SAMPLE_MS = 250`), `:373` (the sample interval). Rate rows dorm via `subscribeRateActivity`; gauge rows (cpu/memory/disk) deliberately keep the 4Hz sampler and the WAAPI scroll animation alive forever because the store never wakes on gauge samples. Canvas redraw doesn't recalc style, but the running WAAPI scroll and the timer both keep the page from resting.

**[H3] The shared 1Hz telemetry tick.** `session-card-telemetry-renderers.tsx:222–230` — a module-scoped `setInterval(…, 1_000)` notifying every session-clock renderer through `useSyncExternalStore`. It is subscriber-gated (stops when nothing subscribes), but if any mounted readout subscribes at idle, that is 1Hz of React commits.

**[H4] `useLifecycleTick`** (`lib/code-session-store/hooks/use-lifecycle-tick.ts`) — 1Hz, but registered only while a turn is in flight, and cleared on terminal phases. Expected innocent at idle; the census will confirm, and the `alsoWhile` escape hatch (kept alive by background agents) is the one clause worth checking.

**[H5] Non-timer wakes**: IntersectionObserver deliveries (21 samples at idle — deliveries require rendering updates; what keeps re-triggering them at rest?), WebSocket traffic → store notify → React commit (keep-alives, telemetry feeds from tugcast), and compositor-driven animation event bookkeeping. These are only reachable by the timeline instrument, not by grep.

### Arithmetic the model must survive {#idle-arithmetic}

Post-fix idle: ~340ms busy per 5s. If the waker census finds ~8–10 wakes/s (two 4Hz timers + 1Hz), that is ~45 wakes per window → **~7.5ms per wake**, which must decompose into resolveStyle + two walks + paint over the measured tree (119 stacking contexts, `computeCompositingRequirements` at 110 samples). If the census finds far fewer wakes than that, the per-wake cost is bigger than the model allows and something else is burning — either way the numbers must close. **An attribution that doesn't predict the sample counts is rejected.**

### Idle exit criterion {#idle-exit}

**[E1] An idle deck schedules zero rendering updates**, enforced two ways: every timer in tugdeck is dormancy-gated or change-gated (a paint that would write an unchanged value writes nothing), and an app-test gate asserts the mutation census (#instruments) reads **0 DOM writes/s** on a settled heavy deck. Idle busy target after the wakes die: **≤ 1%**, re-profiled on the release bundle. If a waker is judged legitimately alive at idle (a real live readout), it is named in the brief with its measured cost — nothing stays anonymous.


## Charge 2 — make style recalculation a numbered, attributed quantity {#style-recalcs}

What we actually know: `TreeResolver::resolve` ≈ 23/23/19 samples per 5s idle window. What we don't know: which elements, invalidated by whom. `sample` fundamentally cannot answer this — it sees the resolver's frames, never the mutation that dirtied the tree.

Two instruments close the gap:

**Web Inspector Timelines.** The WKWebView is already inspectable in every build — `webView.isInspectable = true` at `tugapp/Sources/MainWindow.swift:316`, not `#if DEBUG`-fenced. Safari → Develop → Tug.app → Timelines, record 10s of idle on the heavy deck: the Rendering Frames timeline attributes each style recalc, layout, and composite to its initiating JS callsite. This is the instrument class the whole investigation has been missing, and it costs nothing to wire — it is already wired. First session's deliverables: the initiator list for idle recalcs, and the same for a 5s typing burst.

**A mutation census in `perf-monitor.ts`.** A `MutationObserver` on `document.documentElement` (childList + attributes + characterData, subtree) accumulating counts per second, bucketed by target (tag.class, like the census does). This turns "who writes DOM at idle" into an app-testable number with named culprits — the same graduation path animationCensus took: instrument → convict → fix → become the gate. The observer is start/stop (`beginMutationCensus()` / `endMutationCensus()`), never left running outside a measurement window, so the instrument doesn't become its own waker.

**Recalc *scope* matters too, not just count.** WebKit resolves style from the invalidation root down; a class flip on a container re-resolves the subtree. The timeline shows recalc durations per frame — a 4Hz × 0.5ms recalc is a different crime than a 4Hz × 5ms one. Both the count and the per-recalc cost go in the record.

**[E2] Exit criterion:** idle style recalcs = 0 (subsumed by E1 once DOM writes are zero), and for the typing regime a recorded, attributed per-keystroke recalc cost with the CM6 editor's own necessary work separated from collateral invalidation outside the composer.


## Charge 3 — the typing guarantee {#typing}

### What the A/B already proved {#typing-known}

On the restored heavy card: typing busy 65.9%; after-style walk collapsed to ~0+9 (the census/dot work paid off here) but **after-layout walk held at 241+61 across all three phases** — baseline, sticky headers forced static, all 506 ResizeObservers disconnected. Two suspects absolved; term unattributed. And a hard honesty note: there is **no pre-fix typing number** — "kill the typing-lag bill" was never evidenced for typing itself. This brief creates the durable typing number and its gate.

### The breadth hypothesis, stated precisely {#typing-hypothesis}

**[H6]** Every keystroke makes CM6 lay out (necessary), and layout triggers `updateCompositingLayersAfterLayoutIfNeeded`, whose `computeCompositingRequirements` recursion visits **every RenderLayer in the document** — and RenderLayers are made by positioned elements, overflow scrollers, and transforms, not just stacking contexts. Our `layerTreeProbe` counts stacking contexts (119); the RenderLayer population on a heavy transcript deck is plausibly in the thousands. That would explain the A/B cleanly: removing 28 sticky-header contexts was removing 28 from thousands — invisible in the sample counts, exactly as observed.

Decisive tests, in order:

1. **Ground truth via Web Inspector Layers tab** on the heavy deck: the real composited-layer list with reasons and memory. Also extend `layerTreeProbe` with a RenderLayer-candidate count (position ≠ static, overflow ≠ visible, transform ≠ none, will-change) so the number is app-testable, not inspector-only.
2. **The containment experiment.** `content-visibility: auto` (or `contain: strict` + fixed sizing) on off-viewport transcript entries collapses their layout, style, and layer participation. One evalJS experiment on the restored heavy card: apply to all `[data-transcript-entry]` outside the viewport, re-run the typing profile, read the after-layout walk. If H6 holds, this is the single biggest lever in the codebase — it shrinks the walked tree instead of nibbling at categories. (Real adoption must respect the no-height-estimates doctrine: `content-visibility: auto` keeps natural layout when on-screen and uses `contain-intrinsic-size` only for off-screen placeholding — that boundary gets its own design pass if the experiment convicts.)
3. **Scoped-walk check.** If the timeline shows WebKit re-walking compositing for keystrokes that dirty only the composer's subtree, investigate why the update isn't scoped — overlay/ancestor structures (the pane chrome, the sticky positioning context) can force root-wide invalidation.

### The gate — "won't lag" becomes a number {#typing-gate}

**[E3] A typing-latency app-test on the heavy fixture deck**: focus the composer, `nativeType` a fixed ~80-char burst, measure per-keystroke `keydown → post-paint` latency in-page (keydown timestamp vs the next rAF-after-paint tick, collected by a probe installed via evalJS), assert **p95 under one 60Hz frame (16.7ms)** and record the distribution in the test output. This is the guarantee: not a vibe, a gated budget that fails CI when a future card regresses it. Alongside it, budget assertions on the structural proxies (stacking contexts, RenderLayer candidates, idle DOM writes/s) so the gate names the cause when it trips, not just the symptom.


## Instruments {#instruments}

| id | instrument | what it answers | status |
|----|-----------|-----------------|--------|
| I1 | **Web Inspector** (Timelines + Layers) against the running app — `isInspectable` already true (`MainWindow.swift:316`) | who initiates each rendering frame, recalc, layout; real composited-layer list with reasons | available today, never yet used in this investigation |
| I2 | **Waker census** in `perf-monitor.ts` — boot-time wrap of `setInterval`/`setTimeout`/`requestAnimationFrame` recording creation stacks and per-second fire counts into a registry read by evalJS | which timers exist, who made them, how often they fire at idle | to build |
| I3 | **Mutation census** in `perf-monitor.ts` — windowed MutationObserver, counts by target bucket | who writes DOM at idle; the E1/E2 gate's sensor | to build |
| I4 | **Typing-latency probe** — in-page keydown→post-paint sampler, installed by the gate test | the E3 number | to build |
| I5 | `layerTreeProbe` extension — RenderLayer-candidate count alongside stacking contexts | the H6 denominator, app-testable | to build |
| — | `scripts/perf-resize-profile.sh` | end-to-end release verdicts (with the known `applyKeyframeEffects` transition false-positive) | exists |

I2–I5 live where `animationCensus` lives and graduate the same way: instrument first, gate after conviction.


## Execution {#execution}

Order matters: instruments before verdicts, verdicts before fixes, fixes before gates, and the release re-profile last.

- **Step 1 — Build I2/I3/I5** in `perf-monitor.ts`, with an app-test that exercises each on a seeded deck (anti-vacuity floors like at0288's: the waker census must see the wrapped timers fire, the mutation census must see a deliberate write).
- **Step 2 — The attribution session.** Web Inspector + the new censuses against the heavy deck at idle, debug and release. Deliverable: a table where **every** rendering update per second and every style recalc has a named initiator, and the arithmetic in #idle-arithmetic closes against fresh `sample` numbers. No fixes in this step.
- **Step 3 — Kill the idle wakes.** Change-gate the pulse readout paint (write only when the formatted string or idle flag actually changed — this also stops the dataset write), extend dormancy to whatever Step 2 convicted, re-examine the gauge-row always-alive policy against its measured cost. Each fix is one commit with a before/after census read.
- **Step 4 — The typing term.** Layers-tab ground truth, then the containment experiment on the restored heavy card, then the scoped-walk check. Deliverable: the after-layout walk attributed and a chosen lever with measured effect.
- **Step 5 — Land the gates.** The E1 idle-silence assertion and the E3 typing-latency budget as app-tests; extend at0288's docstring scope honestly if the census family grows.
- **Step 6 — Release re-profile** against all three exit criteria; record in this brief's #record section; archive.

## Exit criteria, restated as one line each {#exit}

- **[E1]** Idle deck: zero scheduled rendering updates, ≤1% release busy, every surviving waker named with its cost.
- **[E2]** Style recalcs: zero at idle; per-keystroke recalc cost attributed with CM6's necessary work separated from collateral.
- **[E3]** Typing: p95 keystroke→paint < 16.7ms on the heavy fixture deck, enforced by a committed app-test.

## Record {#record}

*(filled as steps close)*
