# Perf brief 30 — contained motion, surface by surface {#top}

Successor to `roadmap/jul29B-perf-brief.md`. That brief ended with the idle burn attributed to a single mechanism, measured three independent ways on the real release deck (`#record-overlap-law`): **a running `transform` animation forces `computeCompositingRequirements` over the entire page's layer tree on every rendering update, priced by total mounted layer population; an `opacity` animation costs zero; `will-change` is irrelevant to both.** The walk is a threshold, not a proportion — one transform animation on the heavy deck costs a walk of 85 samples/5s, all thirty cost 112, zero costs 0. Static content is free at any size. Sticky pins are exonerated. Style invalidation is properly scoped and is not being defeated; the global structure is the `LayerOverlapMap`, by construction.

This brief attacks the problem **bottom-up, by surface**. The top-down framing ("make the engine term go away") produced the law but not the plan; the plan falls out of an inventory fact instead: the complete census of continuous animation on the real working deck at idle was **41 running animations — 30 pulsing-dot loops, 6 wave bars, 1 caret blink, 4 sparkline track tweens — and nothing else.** Five surfaces animate pervasively and at volume in Tug. Each gets its own workstream, its own definition of quiet, its own cheap mechanism, and its own measured exit. The engine-level goal (a silent settled deck, contained motion while working) is not enforced from the top; it falls out when every surface honors its contract.

Two standing constraints from the design discussion that produced this brief:

- **Opacity-only motion is rejected as doctrine.** Motion design keeps its channels — scale, translate, whatever the gesture calls for — provided the animation qualifies for contained residency (defined under [D2]). Opacity-only authoring is a fallback of last resort for a motion that provably cannot qualify, never the default.
- **No WKWebView-per-pane work in this brief.** The single-page deck model gets maximized first; per-pane process isolation and host-side pane composition are follow-up app architecture, to be designed with full knowledge of these findings, not reached for as an escape hatch.

**Process:** this brief is the map, not the recipes. Each workstream advances only on the user's explicit call, through the standing gates: review of this brief → `/devise` a plan per workstream (or per bundle of small ones) → `/implement` on a dash → user vets → user lands. Nothing here authorizes autonomous implementation.


## The doctrine, firm {#doctrine}

The laws this brief exists to prove out and then codify in `tuglaws/animation-doctrine.md` (`#tuglaws-doc`). D1, D4, D5, and D6 are already fully evidenced; D2 and D3 depend on investigations I1/I2.

**[D1] The quiet contract — every animated surface owns its silence.** Every surface that animates continuously has a data-driven notion of *quiet* that only its owner component can know: no data flowing, no work in flight, no gesture underway. The contract: **when my data is quiet, I am motion-silent and animation-object-free** — no running animations, no live timers driving repaint, no retained finished `CSSTransition`s (WebKit keeps finished transition objects in `getAnimations()` forever; shedding them is part of going quiet, which is what the pulsing dot's `data-static` demotion already does). A settled deck is then zero running animations *by construction*, surface by surface — assertable via `/api/eval` census and enforced in the idle-silence gate (at0291) as an invariant, not a hope. This is the first law of the doctrine and the organizing principle of the work plan.

**[D2] Live-work motion runs in the contained form.** A glyph depicting in-flight work may scale, translate, breathe, and wave, in any channel motion design calls for, **provided the animation qualifies for contained residency**: compositor-resident, invalidation bounded to its own layer and below — never rippling above the fixed-size box that hosts it — no per-frame overlap rebuild. The contained form is not yet a recipe — producing it is I1/I2's job — but its existence is proven inside this app today: the four sparkline WAAPI transform tweens ran with the whole-page walk at **zero** while every CSS loop was suppressed (jul29B leave-one-out, condition P3).

**[D3] The cost of motion is paid once, at authoring time, through the Tug animation API.** No raw `@keyframes` or bare `element.animate()` in product surfaces once the API exists (`#tug-animation-api`). Every motion primitive declares its residency class, and the class is *verified by measurement in the gallery bench*, not asserted in a comment.

**[D4] When real work is in flight, honest cost is acceptable; at rest, none is.** A session actively streaming is not idle — paying rendering cost to depict genuinely live work is defensible even before the contained form lands. Indefensible is paying it at rest: stuck in-flight indicators, breathing glyphs on settled sessions, decorative loops. The gate between quiet and motion is the truthful liveness of the thing depicted, derived from real state (turn phase, feed activity), never from "the card is mounted."

**[D5] Measurement discipline is part of the doctrine.** The binding method rules, dearly bought and recorded in jul29B `#record-overlap-law`: release-main is not a controlled environment (interleave baselines, repeat, take medians, discard runs whose baselines disagree); an occluded window does no rendering work and voids the run; suppress animations with `animation: none` via a probe sheet, never WAAPI `pause()` (pausing demotes to the main thread and reads *worse*); count leading sample integers from raw trees, never grep line counts; profile release builds only, via the dash-release lab.

**[D6] Finite transitions must end and must be droppable.** Settle crossings, hover/press states, card chrome — honest one-shots, but each retains a finished `CSSTransition` unless the surface drops it (`transition: none` on the rest state, per the dot's `data-static` pattern). A surface is not quiet until its transition population is zero.


## The conceptual target — downward-only invalidation {#containment-target}

The requirement, stated as it was stated: a render box that **does not change its own size**, containing an element that scales or moves within it, must never ripple invalidation higher in the tree than itself. The motion's consequences flow to that layer and its descendants, never upward.

The platform's obstacle is that painter's order is document-global — any layer may in general overlap any other, so a moving layer means re-deciding who else needs compositing. But WebKit carries two mechanisms that bound exactly this, and I1's whole question is which authoring forms engage them:

1. **Animation extent.** `computeExtentOfTransformAnimation` (present in the jul29B samples) computes the union bounds of a transform animation's entire journey so overlap can be reserved **once**, for the whole envelope, instead of re-walked per frame. A breath scaling 0.35→1.0 inside a fixed 32px box has a trivially computable extent. Something in the current authoring defeats this, or defeats acting on it.
2. **Overlap clip scopes.** The `LayerOverlapMap` maintains clipping scopes: a composited container that clips its descendants (`overflow: hidden`, `contain: paint`) bounds their possible overlap to its own box. A glyph inside such a scope should be provably unable to affect anything outside its 32px box.

If either mechanism can be reliably engaged by authoring — a property, a wrapper, a keyframe form — then "place dots and waves wherever we want" is achievable in the current single-page model, and the recipe becomes the heart of the Tug animation API. If neither can, that is a finding with teeth: the containment the pane model wants does not exist inside one WebKit page, and the follow-up architecture round inherits it as a hard input. Either way the groping ends: measured, named, written down.


## The five surfaces {#surfaces}

The complete inventory of pervasive, at-volume animation in Tug today, confirmed by census on the real deck. Each workstream states its quiet contract ([D1]), its cheap mechanism while legitimately running ([D2]/[D4]), and its measured exit. Ordering within the plan is the user's call; dependencies on the supporting investigations are noted per workstream.

### S1 — Caret blink (TugTextEditor / CM6) {#s1-caret}

**Status: done — and it is the template.** Moved to sampled opacity hold-stops under `linear` (jul29B), compositor-resident, measured free on the heavy deck (`applyKeyframeEffects` 0, walk contribution 0 — opacity animations do not touch the overlap map). Typing already suppresses it via `[data-tug-text-editor-typing]`.

- **Quiet contract:** already honored — the blink runs only in a focused composer; unfocused editors carry no animation.
- **Cheap mechanism:** compositor-free residency class, proven.
- **Exit (remaining):** none beyond citation — S1 is the worked example the doctrine and the API document point at.

### S2 — Sparklines (Pulse) {#s2-sparkline}

Two costs: the standing 120s WAAPI translate tween on `.tug-sparkline-track` (4 running at idle) and the 4Hz canvas sampler behind it. And one gift: the running tween is the **one walk-free transform in the app** — the I1 recipe donor.

- **Quiet contract — flatline dormancy, completed for all row kinds.** Sparklines spend most of their life idle at flatline. Rate rows already dorm via `subscribeRateActivity`; gauge rows (cpu/memory/disk) deliberately never dorm because the store never wakes on gauge samples — jul29B [H2], unfinished. Extend dormancy to gauges: when samples are unchanged within epsilon for a dormancy window (or the readout is off-screen/skipped), stop the sampler, cancel the tween, drop finished animation objects. First data delta re-arms — the existing rate-row wake protocol generalized.
- **Cheap mechanism while running:** the current form, unchanged — it is already the contained exemplar. I1 characterizes *why* so the property is preserved deliberately (a future innocent edit must not un-qualify it) and donated to S3/S4.
- **Measured exit:** all-flatline Pulse deck at idle → zero running animations, zero timer wakes from sparkline surfaces (census + sample); live rate row still animates; dormancy wake latency imperceptible (first paint on new data within one sampler period).

### S3 — TugProgressIndicator `pulsing-dot` {#s3-pulsing-dot}

The volume champion: 30 of the 41 idle animations, 10 live glyphs — 6 in one session card's telemetry status bar, 3 in Lens session rows, 1 in a tool-call header. 1,341 dot elements mounted (most already static/skipped — the `data-static` demotion works; the problem is the *running* population and its per-tick price).

- **Quiet contract — only truthful liveness breathes.** A dot animates only while the session/tool it depicts is genuinely in flight ([D4]). Audit the six status-bar glyphs: any depicting settled sessions demote to `data-static` (machinery exists — this is a gating bug, not new machinery). Lens rows breathe only for sessions actually running. Settled decks reach zero dot animations by gating alone, before any recipe work.
- **Cheap mechanism while running:** the contained form from I1/I2 — the honest two-or-three breathers cost nothing regardless of deck size, keeping the full motion design: scale breath, emitted ring, ignition advance, phase-locking. Already exonerated: `calc(var())` keyframe stops are not the problem (measured identical to literals); `will-change` refusal stays but its stated rationale gets corrected in I2's docstring pass.
- **Depends on:** I1 (recipe), I2 (application). The gating half depends on nothing and can ship first.
- **Measured exit:** settled deck → zero dot animations (census); one running dot on the 12k-layer bench → walk delta ≤ noise ×3 medians; motion design visually intact (gallery A/B against current).

### S4 — Wave (thinking indicator) {#s4-wave}

TugProgressIndicator's `wave` variant: three phase-locked `scaleY` bars, 960ms, in in-flight footers (and kin). Inherently in-flight-only — its whole existence is [D4]-honest — so its problem is different from S3's:

- **Quiet contract — stop reliably.** The two `.tug-transcript-entry__inflight-footer` waves observed animating on a *settled* deck are a broken quiet contract — a stuck-state bug, to be root-caused (state machine, not CSS) and fixed regardless of everything else in this brief. The contract: wave mounts animating only under a live turn phase, and the falling edge provably unmounts/stills it, including on abnormal turn ends (cancel, error, wedge-recovery paths).
- **Cheap mechanism while running:** the I1/I2 contained form, same recipe as S3.
- **Depends on:** stuck-footer fix — nothing; contained form — I1/I2.
- **Measured exit:** settled deck → zero wave animations across all turn-end paths (app-test the falling edges); one running wave on the bench → walk delta ≤ noise.

### S5 — Imposer pane motion {#s5-imposer}

Whole-pane animation under the layout imposer. Under the overlap law, an in-page transform on a pane root is a whole-page walk per frame — but this is gesture-time interactive cost ([D4]-honest), and the plan is to make each frame as close to free as the page model allows via the **kink-the-hose sequence**:

1. **Freeze** — halt feed/store delivery to the card(s) in the moving pane (the same muscle HMR/replay gating already exercises); let React commit and layout fully settle so nothing dirties mid-gesture.
2. **Promote** — the settled pane becomes one static composited layer (its content neither paints nor re-lays-out during the move).
3. **Move** — a single transform animates that layer. With S1–S4 quiet contracts honored, it is the *only* running animation: the per-frame walk exists but competes with no other dirt, and the population term is the only price.
4. **Land** — snap to final geometry, drop the promotion.
5. **Unkink** — resume delivery; one coalesced catch-up render applies everything that arrived during the move.

- **Quiet contract:** no standing animation between gestures — the imposer contributes zero to idle by construction; promotion and its layer are shed on land ([D6]).
- **Depends on:** S1–S4 (a frozen pane buys little if dots and sparklines tick through the drag); I3 lowers the walk's population multiplier for the frames that do pay it.
- **Measured exit:** a scripted pane move on the heavy deck holds frame budget (no main-thread frame over budget in the sampled gesture window); zero mid-gesture React commits from the frozen card; zero residual animations/layers after land; data catch-up correct after unkink (app-test).
- **Flagged for the architecture round:** if the measured gesture cost is still unacceptable after freeze+quiet+diet, pane motion is the first candidate to leave the page for host-side composition — recorded here so it is not re-derived, out of scope in this brief.


## Supporting investigations {#investigations}

Service roles for the workstreams — none is a deliverable in itself.

### I1 — the sparkline exception (feeds S2, S3, S4) {#i1-sparkline-exception}

Four WAAPI transform tweens ran with the walk at zero while a single 6×16px `scaleY` probe cost 85. A walk-free transform form exists in this app; I1 isolates which difference is load-bearing. On the lab (unoccluded, per D5), all app animations suppressed, one condition at a time against the 12,200-box synthetic layer population, interleaved no-probe baselines, ×3 medians. The factor matrix, varied one axis at a time from the sparkline's known-good form:

| axis | sparkline (walk = 0) | probe (walk = 85) |
|---|---|---|
| API | WAAPI `element.animate()` | CSS `@keyframes` |
| transform kind | `translateX` | `scaleY` |
| iteration | finite (1 × 120s) | `infinite` |
| element position | in-flow, inside composited `overflow: hidden` track | `position: fixed`, body child |
| duration | 120 000ms | 960ms |

Hypotheses in prior order: **[Q1]** an enclosing composited clip engages an overlap clip scope — probe inside vs outside such a wrapper; **[Q2]** `infinite` iteration defeats one-shot extent reservation; **[Q3]** `position: fixed` on the animated element forces global overlap treatment (probe-artifact hypothesis — closed first, since it taints the methodology); **[Q4]** scale vs translate extent handling; **[Q5]** WAAPI vs CSS path (lowest prior — both compile to `KeyframeEffect`).

Exit: a **minimal qualifying form** (smallest authoring conditions for zero per-frame walk on a heavy population) and a **minimal disqualifying delta** (the single change that re-triggers it), each ×3 medians on the lab, confirmed once on release-main.

### I2 — the contained-glyph recipe (feeds S3, S4) {#i2-contained-recipe}

Apply I1's qualifying form to the real primitives in the gallery: rebuild the dot's breathe/emit pair and the wave's three-bar loop in the qualifying form inside their existing fixed-size boxes; measure on the lab against the synthetic population. If the qualifying form cannot express the current envelopes (e.g., extent reservation conflicts with the ignition-advance structure), document the exact conflict and bring the minimal design delta to the user as a decision — the [D2] fallback ladder, exercised only on proof.

### I3 — layer-population diet (feeds S5, and any non-quiet moment) {#i3-population-diet}

The multiplier side, second priority: containment zeroes the term, dieting only divides it. Transcripts carry 26,374 layer-minting elements of 61,676 (`position: relative` 12,666, `overflow` 9,175, `position: sticky` 1,713, `z-index` 1,986, `contain: content` 789). Audit the top two classes for necessity — relatives whose z-index never engages, stale positioning-context scaffolding, overflow clips on elements that never clip. Every removal class gets its own A/B on the lab bench (walk cost under a deliberately non-qualifying probe — the multiplier is only observable while something animates). No sweeping CSS rewrites on spec.

### I4 — instrument hardening (serves all) {#i4-instruments}

(a) an **occlusion guard** in the profiling path — refuse to sample, or stamp the output, when the target window is occluded (`CGWindowListCopyWindowInfo` on-screen state, or an eval heartbeat asserting rAF delivery); (b) fix `scripts/perf-resize-profile.sh` bundle-id matching for dash-release bundles (`dev.tugtool.app.release-tugdash-<name>` — the lsof cache-dir match fails; newest-WebContent-by-start-time is the manual workaround); (c) **re-verify the lab's 0.9% idle on an unoccluded window** — it predates the occlusion discovery and is suspect; (d) a `diag/anim-census` eval snippet checked into the repo (running animations by name/target/playState, walk-relevant counts, retained-transition count) so the census stops being retyped by hand — it is also the assertion body for every workstream's quiet-contract exit.


## The Tug animation API {#tug-animation-api}

The end state [D3] points at, finalized after I1/I2 land the recipe: motion in Tug is authored through a small set of primitives whose residency class is declared, measured, and enforced — the way theme tokens made color sovereign and TugListView made lists measured-height-only.

- **Residency classes**, named in code: `compositor-free` (opacity/filter — zero cost at any population, proven by S1), `compositor-contained` (transform in the I1 qualifying form — zero walk, proven by bench), `main-thread` (everything else — forbidden in product surfaces; available to gallery benches only).
- **The quiet contract as API surface**: primitives expose arm/disarm driven by owner liveness, and disarm means animation-object-free ([D1]/[D6]) — the `data-static` demotion and rate-row dormancy patterns generalized, not reinvented per surface.
- **The primitive layer**: a motion module owning keyframe construction, the qualifying-form wrapper (whatever I1 proves load-bearing), phase-locking helpers (the dot's shared-clock/drift machinery generalized), and the settle/handoff pattern (pin live pose inline, drop animation, transition to rest).
- **Enforcement**: a gallery bench per primitive mounting it against the synthetic population and asserting walk delta ≤ noise via the lab harness (on-demand measurement benches, not CI sweeps); a lint that product code doesn't reach for raw `@keyframes`/`element.animate()` outside the primitive layer.

## The tuglaws document {#tuglaws-doc}

Once I1/I2 convert doctrine-in-waiting into proven recipe, write `tuglaws/animation-doctrine.md` (with INDEX.md entry): D1–D6 in final form with the quiet contract as the first law; the residency classes with their measured price table (the jul29B/jul30 numbers as permanent evidence); the qualifying form as an authoring recipe with S2 as the worked example; the falsification method (how to bench a new primitive before shipping it); cross-references into [L06]/[L13] (deepened, not replaced) and `pane-model.md` (what containment the pane model can and cannot promise inside one page). Reconcile the dot's inline docstring (correct on `linear()` easings; superseded on `will-change` reasoning) to cite the law doc.


## Carried forward from jul29B {#carried}

Standing items, re-ranked, not part of the five surfaces:

1. **TugListView per-cell ResizeObserver** (~1.1% of the 5.8%): unobserve cells while `content-visibility: auto` skips them; re-observe on `contentvisibilityautostatechange`; the width-invalidation stamp-strip path must explicitly re-observe or unobserved-while-skipped cells keep stale intrinsic sizes forever. Load-bearing machinery — own pass, own test.
2. **selection-guard autoscroll watchdog** — a lost `pointerup` pins `runAutoscrollTick` in a permanent 60/s rAF loop (measured +2.1% from the wake alone). Zero-delta watchdog. Latent wedge, not current residual.

## Exit criteria {#exit}

- [ ] S2: all-flatline Pulse deck → zero sparkline animations and timer wakes; live rows unaffected.
- [ ] S3: settled deck → zero dot animations by gating; running dot on the 12k bench → walk ≤ noise, motion design intact.
- [ ] S4: stuck footers root-caused and fixed; all turn-end falling edges verifiably still the wave; running wave → walk ≤ noise.
- [ ] S5: kink-the-hose pane move holds frame budget on the heavy deck; zero idle contribution between gestures; correct catch-up after unkink.
- [ ] I1 verdict recorded: minimal qualifying form + minimal disqualifying delta, ×3 medians, confirmed on release-main.
- [ ] Release-main unattended idle ≤ **1.5%** ×3 (medians, D5 method) with the full working deck mounted and all sessions at rest.
- [ ] `tuglaws/animation-doctrine.md` written and indexed; animation-API primitive layer landed or explicitly scoped into its own follow-up plan.
- [ ] Lab 0.9% re-verified unoccluded; profiler occlusion guard + dash-bundle matching fixed.
