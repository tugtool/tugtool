<!-- devise-skeleton v4 -->

## Animation Tune-up — Motion Residency, Stationing, and Enforcement {#animation-tuneup}

**Purpose:** Make Tug's long-running animations structurally free — every design-approved loop runs on the compositor, inside a contained box, pausing when its pane collapses — and lock the contract in with a machine-checked residency law so no future animation can regress it.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-07-28 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Tug uses long-running animation deliberately — pulsing dots on running sessions and tool-call headers, the wave caret in a streaming prompt, spinners and bars in progress surfaces, skeleton shimmer during loads. That is a design commitment and it is not changing. What must change is what those animations *cost*. Profiling (2026-07-28, `sample` on the live WebContent processes) showed the release app spending ~20% of wall-clock main-thread time at idle, with ~63% of the busy time inside `LocalFrameViewLayoutContext::updateCompositingLayersAfterStyleChange` — the full-tree compositing-requirements walk — and the style path running `KeyframeEffectStack::applyKeyframeEffects` → `preventsAcceleration` / `canBeAccelerated` every frame. Translation: some running animations fail WebKit's compositor-acceleration test, so the main thread blends keyframes, re-resolves style, and re-walks the layer tree at 60Hz for as long as they run. A window live-resize adds a full relayout per frame on top of that already-saturated loop, which is the judder the user feels.

The failures are specific properties, not the animation API: `tug-skeleton` animates `background-color` (never accelerable); the pulsing dot's `emit-thicken` animates `border-width` (a layout property, and one non-accelerable property in an element's effect stack forces the element's *entire* stack onto the main thread — the dot's own CSS docstring underestimates this as "re-rasters the ring"); the spinner animates `opacity` on SVG interior `<rect>` spokes and the ring rotates a nested SVG (SVG interiors never get compositing layers, so those loops are main-thread by construction). Meanwhile even the correctly-accelerated transform loops subscribe the page to per-update overlap testing (`computeExtentOfTransformAnimation` → `computeCompositingRequirements`, observed recursing 10 deep with `calculateClipRects` 6 deep beneath), a cost that scales with the whole layer tree because nothing bounds the animated elements' extents.

#### Strategy {#strategy}

- **Fix the mechanism, not the design.** Every re-plumb below reproduces the shipped look exactly through a compositor-eligible mechanism (opacity crossfades, transforms on HTML wrappers). Zero visual change is a checkpoint, not a hope.
- **Compositor residency first** (skeleton, pulsing dot, spinner, ring) — these run *during turns*, which is exactly when the user resizes and feels jank, and they are the largest measured cost.
- **Then stationing**: wrap every long-run animation in a fixed-size contained box so its overlap extent is local, plus a `will-change` audit so layers exist only while their animation runs.
- **Then dormancy**: a collapsed pane must not tick animations under its `height: 0` body.
- **Enforce by census, not by review.** `document.getAnimations()` exposes every running animation, its target, and its keyframe properties; an app-test asserts the residency contract against the real app so a violating animation fails CI with its name in the message.
- **Measure before and after.** A `just` profiling recipe turns "does resize jank" into a number (`sample`-based main-thread busy %), taken at step 1 and re-taken at the end.

#### Success Criteria (Measurable) {#success-criteria}

- With a session card mid-turn (dots pulsing, wave running), `sample` of the WebContent process over 5s shows `Style::TreeResolver::resolve` absent from the per-frame timer path — no `KeyframeEffectStack::applyKeyframeEffects` under `RemoteLayerTreeDrawingArea::updateRendering` at steady state. (Verify: `just perf-resize-profile` idle mode, before/after comparison.)
- The residency app-test passes: every running `CSSAnimation` with infinite iterations targets an `HTMLElement`, animates only `transform`/`opacity`, and sits inside a `.tugx-motion-station`. (Verify: the new app-test in CI / `just app-test-changed`.)
- All six `TugProgressIndicator` variants, the skeleton, and the gallery timing bench are visually indistinguishable from before at every state — verified side-by-side in the gallery cards. (Verify: gallery inspection + `app.screenshot()` comparison during implementation.)
- Collapsing a pane whose card hosts running indicators stops those animations from ticking (`document.getAnimations()` on elements under the collapsed body reports `playState !== "running"`), and expanding resumes them seamlessly. (Verify: assertion in the residency app-test.)
- `bunx vite build` passes; `just app-test-changed` green.

#### Scope {#scope}

1. Re-plumb the four non-accelerable long-run animations: skeleton shimmer, pulsing-dot ring thicken, spinner spoke fade, ring spin (and verify pie/bar/wave/marquee/session-changes pass as-is).
2. Introduce the **motion station** wrapper (`contain`-based extent bounding) across the progress-indicator family, skeleton, sparkline, and marquee.
3. `will-change` audit across the 16 standing declarations: keep only those co-located with a running-state selector.
4. Collapse dormancy: pause long-run animations under a collapsed pane body via an inherited CSS variable.
5. Enforcement: animation census helper in `perf-monitor.ts`, a residency app-test, and a `just perf-resize-profile` recipe.
6. Doctrine: a motion-residency section in tuglaws plus a global design-decision entry, cross-linked from `component-authoring.md`.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Occlusion-based dormancy (pausing animations in panes fully covered by other panes) — requires z-order geometry tracking; revisit only if post-tune-up profiles still show idle burn.
- Reducing transcript layer depth (sticky pins, block headers) — the July perf program (P3) already restructured these; re-open only on post-tune-up evidence.
- Imposed-card *width* tracking during window resize — the imposer's fixed-width/live-position design (`tugdeck/src/lib/layout-imposer.ts`) is a separate design question, not a perf one.
- Changing any animation's design: timing, easing, geometry, and choreography are untouched.
- The `tug-sheet` and imposer settle *transitions* — finite, gesture-scoped, already correct.

#### Dependencies / Prerequisites {#dependencies}

- July 2026 perf program shipped (sparkline dormancy, notify batching, `__pin` sticky consolidation, `offscreenSkip`) — this plan builds on it and does not re-open it.
- App-test harness with `@covers` selection (`tests/app-test/`), `evalJS` bridge, and `window.tugPerfMonitor` (dev/test-only, `tugdeck/src/lib/perf-monitor.ts`).
- `sample` CLI (ships with macOS) and AppleScript System Events access for the profiling recipe (accessibility permission on the driving terminal).

#### Constraints {#constraints}

- WARNINGS ARE ERRORS (workspace-wide); `bunx vite build` must pass before any tugdeck change is done (dev-esbuild/rollup divergence).
- Never `npm`; bun only. Tugdeck HMR is live; no manual frontend builds during development.
- App-tests: selective runs via `just app-test-changed`; every new test carries `@covers` and registers in `tuglaws/app-test-inventory.md`.
- Motion-off must keep working: `body[data-tug-motion="off"]` zeroes all loops today; every re-plumbed animation must stay under that gate.
- Reduced-motion/`--tug-timing` scaling (`calc(… * var(--tug-timing, 1))`) must survive every re-plumb.

#### Assumptions {#assumptions}

- WebKit accelerates `transform`/`opacity` `@keyframes` on HTML elements that hold their own compositing layer, and never accelerates animations targeting SVG interior elements or animating layout/paint properties (`border-width`, `background-color`). This matches the observed `preventsAcceleration` frames in the profile.
- `contain: layout paint` on a fixed-size wrapper clips a descendant animation's overlap extent at the wrapper (WebKit's `computeClippedOverlapBounds` clips by ancestor clip rects), making overlap testing local to the station.
- A paused CSS animation (`animation-play-state: paused`) does not dirty style per frame; resuming restores the loop mid-phase with no visual cut.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Does the thicken crossfade read identically to the border-width lerp? (OPEN → resolve in implementation) {#q01-thicken-parity}

**Question:** The pulsing dot's ring stroke "thickens" over the back of its cycle by animating `border-width` between `--tugx-progress-pulsing-dot-pulse-birth-width` and `--…-pulse-end-width`. The re-plumb replaces this with two stacked ring elements (birth weight, end weight) crossfaded by opacity. A crossfade of two stroke weights is not mathematically a stroke-width lerp — at some mid-cycle frames it may read as a soft double edge instead of a single thickening line.

**Why it matters:** The dot is the most-seen indicator in the product; a visibly mushier ring is a design regression the plan promises not to make.

**Options (if known):**
- Two-layer crossfade (planned) — verify at both size treatments (28px Lens row, 10px status cell) in the gallery timing bench.
- Fallback: a single static mid-weight stroke with the existing expand+fade — loses the thicken gesture; a design call for the owner, not the implementer.

**Plan to resolve:** Implement the crossfade behind the same `data-emitting` gate; compare against the shipped build side-by-side in `gallery-tug-progress-indicator` (the timing bench already renders four cuts side-by-side). If parity fails at either size, stop and surface the fallback option to the user before proceeding.

**Resolution:** OPEN (resolved at #step-3's checkpoint).

#### [Q02] Is the ring's SVG-root spin actually main-thread? (DECIDED — moot, see [P06]) {#q02-svg-root-acceleration}

**Question:** `tug-progress-ring.css` animates `.tug-progress-ring-svg` — the `<svg>` *root*, which unlike SVG interiors can hold a compositing layer, so its spin may already be accelerated.

**Why it matters:** Only for effort estimation — if accelerated, the ring re-plumb is optional.

**Resolution:** DECIDED — moot. [P06] moves the spin to the HTML wrapper regardless, because the enforcement law asserts `target instanceof HTMLElement` and a uniform law beats a per-case carve-out for SVG roots. The move is two selector edits.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Crossfade thicken reads visibly different | med | med | [Q01] side-by-side bench check before landing; fallback design call | Gallery comparison fails |
| `contain` on stations clips deliberate overshoot (small pulsing dot lets its ring past the box) | med | high if ignored | Station box is the *motion extent*, not the glyph box — see [P02]; small-dot reach computed from `sizeGeometry` | Any clipped ring in gallery small-size row |
| `contain: size` breaks a consumer that relied on content-driven indicator sizing | low | low | Indicators are already fixed-size (`size` prop → inline width/height); census step greps consumers | tsc/visual break in a consumer |
| Census test is flaky (animations mid-transition at assert time) | med | med | Assert only infinite-iteration `CSSAnimation`s; settle-wait before census; exempt finite transitions | Test flakes in CI |
| `animation-play-state` var gate missed on some loop → collapse doesn't pause it | low | med | The census test asserts paused state under a collapsed pane for every discovered loop, so a miss is caught mechanically | Census collapse assertion fails |

**Risk R01: Visual drift under re-plumb** {#r01-visual-drift}

- **Risk:** Re-plumbed mechanisms (overlay crossfades, HTML spokes) subtly change rendering — anti-aliasing, sub-pixel rounding, blend order.
- **Mitigation:** Each re-plumb step's checkpoint includes a gallery side-by-side against the pre-change build; `app.screenshot()` captures for the record; land one component per commit so a drift bisects to one change.
- **Residual risk:** Sub-pixel AA differences invisible at 1x may appear at 2x; accepted if unnoticeable in the gallery at both zooms.

**Risk R02: Perf win smaller than expected** {#r02-perf-shortfall}

- **Risk:** Residency + stationing lands but resize still judders, because the irreducible per-frame relayout of a resize dominates.
- **Mitigation:** Step 1 captures the baseline profile so the delta is attributable; the plan's success criterion is the *style/animation path* leaving the frame loop, which is what we control.
- **Residual risk:** If post-tune-up profiles still jank, the next suspect is transcript layer depth — explicitly a follow-on (#roadmap), now with numbers to justify it.

---

### Design Decisions {#design-decisions}

#### [P01] The compositor-residency contract (DECIDED) {#p01-residency-contract}

**Decision:** A long-running animation (infinite iterations, or total duration > 5s) may animate only `transform` and `opacity`, must target an `HTMLElement` (never any SVG element, root or interior), and no other animation on the same element may animate any other property while it runs.

**Rationale:**
- These are exactly WebKit's acceleration conditions (observed: `KeyframeEffect::canBeAccelerated` failures put the whole effect stack on the main thread at 60Hz).
- One flat rule is enforceable by census ([P09]); carve-outs ("SVG roots are sometimes fine") are not.
- Finite gesture transitions (imposer settle, sheet roll, state crossings) are exempt — they end.

**Implications:**
- Skeleton shimmer, pulsing-dot thicken, spinner spokes, and ring spin must be re-plumbed ([P03]–[P06]).
- Future indicators are born under the law; the census test names violators.

#### [P02] Motion stations: `contain: layout paint size` at the motion extent (DECIDED) {#p02-motion-stations}

**Decision:** Every long-run animation lives inside a `.tugx-motion-station` wrapper — a fixed-size box with `contain: layout paint size` (equivalent to `contain: strict`) sized to the animation's full **motion extent**, not the glyph box.

**Rationale:**
- Paint containment clips the animated descendants' overlap extents at the station, so WebKit's per-update overlap test is local (a few dozen px²) instead of page-global.
- Size+layout containment guarantees the loop can never dirty ancestor layout.
- The extent distinction is load-bearing: the pulsing dot's small treatment (below 28px) deliberately sends the ring **past** the glyph box (`--tugx-progress-pulsing-dot-emit-reach-auto` ramps past 1; see `sizeGeometry` in `tug-progress-pulsing-dot.tsx`). The station must be `size × reach` so containment never clips the designed overshoot.

**Implications:**
- The station wrapper renders inside `TugProgressIndicator` (one place covers all six variants), standalone inside `TugSkeleton`, `TugSparkline`, and `TugMarquee`, and on the wave caret's self-built root span (`wave-caret.ts` bypasses the indicator facade — see Spec S02).
- The station also carries the dormancy variable ([P08]) — one wrapper, two jobs.
- The census test asserts `target.closest(".tugx-motion-station") !== null`.

#### [P03] Skeleton shimmer via overlay opacity crossfade (DECIDED) {#p03-skeleton-overlay}

**Decision:** `.tug-skeleton` keeps `background-color: var(--tugx-skeleton-base)` static; an `::after` overlay (`inset: 0`, `border-radius: inherit`, `background-color: var(--tugx-skeleton-highlight)`, `opacity: 0`) animates `opacity` 0 → 1 → 0 on the existing 2s `cubic-bezier(0.4, 0, 0.6, 1)` cycle, replacing the `td-shimmer` background-color keyframes (`tugdeck/src/components/tugways/tug-skeleton.css`).

**Rationale:**
- With an opaque highlight token, `α·highlight + (1−α)·base` is *pixel-identical* to interpolating `background-color` between the same two colors — same curve, same period, same colors.
- `opacity` on a pseudo-element is compositor-accelerable.

**Implications:**
- If any theme ships a non-opaque `--tugx-skeleton-highlight`, parity breaks — check the six theme files during the step; none are expected to.

#### [P04] Pulsing-dot thicken via stacked-stroke crossfade (DECIDED) {#p04-dot-thicken-crossfade}

**Decision:** The emitted ring becomes a wrapper + two stroke layers: the wrapper `<span>` carries the existing `emit-expand` (transform) and `emit-fade` (opacity) keyframes; two child `<span>`s carry static `border-width`s (`--…-pulse-birth-width`, `--…-pulse-end-width`) and crossfade by opacity on the `emit-thicken` easing (`--tugx-progress-pulsing-dot-emit-thicken-ease`), replacing the `border-width` keyframes in `tugx-progress-pulsing-dot-emit-thicken` (`tug-progress-pulsing-dot.css`).

**Rationale:**
- Removes the one layout-property animation from the stack, restoring the whole dot to the compositor.
- Phase lock is preserved by the component's existing mechanism: all ring animations share one duration and are gated on `data-emitting` written by the component (`releaseEmitter` clocks the pulse, not the state) — the two new opacity keyframes ride the same clock.

**Implications:**
- DOM change in `tug-progress-pulsing-dot.tsx` (currently `<span class="…-dot">` + `<span class="…-ring">` under the root, `tug-progress-pulsing-dot.tsx` render): ring becomes a 3-element group. The component's ref-based catch-and-cross logic (`ringRef`) must move to the wrapper.
- [Q01] governs acceptance; both size treatments checked.

#### [P05] Spinner spokes as HTML elements (DECIDED) {#p05-spinner-html-spokes}

**Decision:** `TugProgressSpinner` (`tugdeck/src/components/tugways/internal/tug-progress-spinner.tsx`) drops the `<svg viewBox="0 0 100 100">` + 12 `<rect>` structure for 12 absolutely-positioned `<span>` spokes — each a rounded rect via `border-radius`, placed with `transform: rotate(i·30deg) translateY(…)`, dimensions scaled from the same constants (`INNER 24, OUTER 48, SPOKE_WIDTH 9`, viewBox-units → percentages of the box). The staggered `tug-progress-spinner-fade` opacity loop and per-spoke negative `animation-delay` move unchanged onto the spans.

**Rationale:**
- SVG interior `<rect>`s can never be accelerated; 12 spokes × opacity loop is 12 perpetual main-thread animations per visible spinner.
- The geometry is trivially reproducible in HTML: a spoke is a rounded rect — exactly what a `<span>` with `border-radius` is.

**Implications:**
- The static pose transform (`rotate` for placement) and the animated property (`opacity`) live on the same element — allowed by [P01] (only the *animated* property set matters; static transforms are fine).
- `fill:` becomes `background-color:` on the spoke class; state selectors (`-running/-paused/-completed/-disabled`) unchanged.

#### [P06] Ring and pie spin on the HTML wrapper (DECIDED) {#p06-spin-on-wrapper}

**Decision:** `tug-progress-ring.css` moves the `tug-progress-ring-spin` animation (and its scoped `will-change: transform`) from `.tug-progress-ring-indeterminate .tug-progress-ring-svg` to the component's root `<span>`; the SVG becomes static art. Pie already animates its HTML element (`.tug-progress-pie-indeterminate`) and needs no change beyond census verification.

**Rationale:**
- Resolves [Q02] by construction; keeps the law flat (`HTMLElement` targets only).
- The determinate arc's `stroke-dashoffset` *transition* is finite and exempt under [P01].

**Implications:**
- The `-90deg` start angle currently baked into the spin keyframes must be preserved (a static `transform: rotate(-90deg)` on the SVG, with the wrapper spinning 0→360, or keyframes kept as-is on the wrapper).

#### [P07] `will-change` only under a running-state selector (DECIDED) {#p07-will-change-discipline}

**Decision:** A `will-change` declaration is legal only in a rule whose selector requires the animation to be running (e.g. `.tug-progress-spinner-running …`, `.tug-progress-ring-indeterminate …`, `[data-breathing]`, `.session-changes-scanning-spin`). Standing declarations on always-present elements are removed or re-scoped.

**Rationale:**
- `will-change` forces a permanent layer that participates in every overlap walk; most of the family already scopes it correctly (ring/pie/spinner/bar/wave are exemplary) — this makes the good pattern the law.
- Known audit targets from the 2026-07-28 inventory (16 sites): `tug-marquee.css` `.tug-marquee-strip` (standing — scope to its scrolling state), `tug-sparkline.css` `.tug-sparkline-track` (standing — scope to the dormancy-awake state from the July program), `tug-sheet.css` (standing on the shade — sheets are transient surfaces; verify the element unmounts at rest, else scope), `gallery.css` petals/pole (gallery-only; scope to running selectors for hygiene).

**Implications:**
- Each removal is verified by re-checking the animation still composites (no jank reintroduced) — the profiling recipe covers this.

#### [P08] Collapse dormancy via an inherited play-state variable (DECIDED) {#p08-collapse-dormancy}

**Decision:** Every long-run animation declaration includes `animation-play-state: var(--tugx-motion-play, running);` as part of the residency contract, and `.tug-pane-chrome--collapsed` (the existing collapse class, `tug-pane.css`) sets `--tugx-motion-play: paused` so the variable inherits into every station under the collapsed body.

**Rationale:**
- A collapsed pane keeps its body mounted under `height: 0; overflow: hidden` (`.tug-pane-chrome--collapsed .tug-pane-body`), and hidden-but-mounted animations tick style forever — the exact hole the sparkline dormancy work closed for one component, closed here for all of them.
- `animation-play-state` can't be set for descendants from an ancestor rule, but a custom property inherits — the var is the only mechanism that lets one ancestor rule pause arbitrary descendants without enumerating them.
- Pause/resume is seamless by spec: the loop freezes mid-phase and resumes mid-phase, so expanding a pane shows no cut. (Non-active *tab* cards are already safe — they render `display: none`, which removes animations entirely.)

**Implications:**
- The census test asserts the pause behaviorally: collapse a seeded pane, then require every infinite animation under its body to report `playState !== "running"`.
- **The var gates CSS animations only** — WAAPI loops (the sparkline) don't read `animation-play-state`. The sparkline's activity-driven dormancy (shipped 2026-07) covers the common case; full WAAPI collapse-pause is a follow-on (#roadmap), and the doctrine doc must state this asymmetry plainly rather than imply the var covers everything ([P11]).
- Inactive/occluded (not collapsed) panes are out of scope (#non-goals).

#### [P09] Enforcement by census app-test (DECIDED) {#p09-census-enforcement}

**Decision:** A new app-test seeds the `gallery-tug-progress-indicator` card (componentId registered in `gallery-registrations.tsx`, which mounts all variants and states), plus a `TugSkeleton` surface, and asserts over `document.getAnimations()`: every long-running animation — **any `Animation` that is not a `CSSTransition`** (CSS `@keyframes` and WAAPI alike; the sparkline's WAAPI scroll must not dodge the law) — with `effect.getTiming().iterations === Infinity` (1) targets an `HTMLElement`, (2) has `effect.getKeyframes()` properties ⊆ {`transform`, `opacity`, `offset`, `easing`, `composite`}, (3) has `effect.target.closest(".tugx-motion-station") !== null`; then collapses the pane and asserts every such animation under it is not `running` ([P08]). Before asserting zero violations, the test asserts a **minimum discovered count** (≥ the number of running variants the seeded gallery card mounts) so a motion-off environment or a failed card mount reads as a failure, never a vacuous pass.

**Rationale:**
- The whole contract is introspectable from JS against the *real* app — no mocks, no jsdom, per the project's real-code-paths doctrine.
- A violation fails with the animation name and target class — self-diagnosing.

**Implications:**
- Census logic lives as `animationCensus()` in `tugdeck/src/lib/perf-monitor.ts` (exposed on `window.tugPerfMonitor`, dev/test-only), so the app-test and any future DevPanel tile share one implementation.
- Registered in `tuglaws/app-test-inventory.md` with `@covers` lines for the indicator family files.

#### [P10] `just perf-resize-profile` — the resize jank meter (DECIDED) {#p10-profiling-recipe}

**Decision:** A `just` recipe drives a paced window resize on a named running Tug process via AppleScript System Events (`set size of window 1`, ~60 steps × 80ms, restoring the original frame), concurrently runs `sample <WebContent-pid> 5`, and prints a short verdict: main-thread busy %, and the top style-path frames (`resolveStyle`, `updateCompositingLayersAfterStyleChange`, `applyKeyframeEffects` counts). An idle mode skips the resize drive for steady-state measurement.

**Rationale:**
- This exact procedure produced every number in #context; scripting it makes before/after comparison a one-liner instead of Instruments ceremony.
- It is a manual tool, not CI — `sample` output is machine-load-dependent.

**Implications:**
- The recipe must find the right WebContent child (the one whose ancestor is the target app's pid — via `pgrep`/`ps` walk), and must tolerate missing accessibility permission with a clear error.

#### [P11] Doctrine lands in tuglaws (DECIDED) {#p11-tuglaws-doctrine}

**Decision:** A new `tuglaws/motion-residency.md` records the contract ([P01], [P02], [P07], [P08]) with the WebKit cost model that motivates it; `tuglaws/design-decisions.md` gains one entry (next free `[D##]`) naming the contract; `tuglaws/component-authoring.md` gains a cross-link in its motion guidance.

**Rationale:**
- tuglaws is the curated durable doc surface; the census test enforces the letter, the doc preserves the why.

**Implications:**
- Future `[L13]` motion citations should co-cite the residency doc.

---

### Deep Dives {#deep-dives}

#### The WebKit cost model (why the contract has exactly these clauses) {#webkit-cost-model}

A CSS/WAAPI animation runs in one of two regimes. **Accelerated:** the animation's keyframes are handed to the compositor once; the main thread does nothing per frame. Requires: only `transform`/`opacity` animated, target element holds a compositing layer, and no co-animated non-accelerable property on the same element (WebKit evaluates the whole `KeyframeEffectStack`; one bad property demotes everything — `KeyframeEffect::preventsAcceleration`). SVG interior elements never hold layers, so their animations are never accelerated. **Main-thread:** every frame runs keyframe blending inside style resolution (`Style::TreeResolver` → `applyKeyframeEffects`), which dirties style, which triggers `updateCompositingLayersAfterStyleChange` — a recursive walk (`computeCompositingRequirements`) over the layer tree doing overlap testing (`computeClippedOverlapBounds`, `accumulateOffsetTowardsAncestor` — the hottest leaf in the 2026-07-28 profiles). The cost is O(layer-tree size × depth), per frame, for the animation's lifetime.

Even accelerated transform animations participate in overlap testing whenever a compositing update runs for any reason (and during a window resize one runs every frame): the engine computes the union of every pose the animation can take (`computeExtentOfTransformAnimation`) and promotes anything it might overlap. Ancestor clips bound that extent — which is what makes stationing ([P02]) effective and why `.tug-pane-chrome`'s existing `overflow: clip` already stops extents at pane boundaries. The station tightens the bound from "the pane" to "the glyph's own box".

**Table T01: Long-run animation inventory and verdicts (2026-07-28 audit)** {#t01-inventory}

| Surface | File | Animated property → target | Verdict |
|---------|------|---------------------------|---------|
| Skeleton shimmer | `tugways/tug-skeleton.css` (`td-shimmer`) | `background-color` → div | **VIOLATION** → [P03] |
| Pulsing-dot breathe | `tugways/internal/tug-progress-pulsing-dot.css` | `transform` → span | OK |
| Pulsing-dot emit (expand/fade/**thicken**) | same | `transform`+`opacity`+**`border-width`** → ring span | **VIOLATION** (thicken poisons stack) → [P04] |
| Spinner spoke fade | `tugways/internal/tug-progress-spinner.css` | `opacity` → **SVG `<rect>`** ×12 | **VIOLATION** → [P05] |
| Ring spin | `tugways/internal/tug-progress-ring.css` | `transform` → **`<svg>` root** | **VIOLATION** under flat law → [P06] |
| Pie spin | `tugways/internal/tug-progress-pie.css` | `transform` → span | OK (verify by census) |
| Bar barber-pole | `tugways/internal/tug-progress-bar.css` | `transform` → HTML, clipped by track | OK (exemplary) |
| Wave / wave-caret | `tugways/internal/tug-progress-wave.css` | `transform` (scaleY) → spans | OK (exemplary); wave-caret builds this DOM directly in the editor (`wave-caret.ts`), so it needs its own station ([P02], Spec S02) |
| Sparkline scroll | `tugways/tug-sparkline.css` + WAAPI | `transform` → div | OK (dormancy shipped 2026-07); station + will-change scope in [P07] |
| Marquee scroll | `tugways/tug-marquee.css` | `transform` → strip | OK; standing `will-change` → [P07] |
| Session-changes scanning spin | `tugways/cards/session-changes/session-changes-view.css` | `transform` → HTML | OK (will-change already scoped) |
| Gallery petals/pole demos | `tugways/cards/gallery.css` | `transform`/`opacity` | OK; hygiene pass in [P07] |
| Skeleton pulse (gallery demo) | `tugways/cards/gallery-skeleton.tsx` | inherits [P03] | follows skeleton |

#### Existing component mechanics an implementer must not break {#component-mechanics}

- **Pulsing dot's crossing machinery** (`tug-progress-pulsing-dot.tsx`): motion is gated on `data-breathing`/`data-emitting` attributes the component writes — *not* on `data-state` — so state arrivals cross instead of cutting. `releaseEmitter` releases the ring on the pulse's own clock; `breathPhaseFor` starts the breathe loop at the phase matching the dot's pinned pose. The [P04] wrapper takes over the current ring element's role; the two stroke children are purely presentational and need no script.
- **Indicator states** (`tug-progress-indicator.tsx`): `running/paused/stopped/completed/aborted` + `disabled`; `paused` uses `animation-play-state: paused` already — the [P08] var must compose with it (two pause sources; CSS `animation-play-state` takes one value, so paused-state rules must keep their explicit `paused`, which wins by being the more specific rule — verify in the step).
- **Motion-off**: `body[data-tug-motion="off"]` zeroes loops globally; `--tug-timing` scales durations. Both must hold for every re-plumbed rule.
- **Skeleton API** (`tug-skeleton.tsx`): single `div.tug-skeleton` with `width/height/radius` props and a `tug-skeleton-group` container — the `::after` overlay adds no DOM.

---

### Specification {#specification}

**Spec S01: The residency contract (normative)** {#s01-residency-contract}

1. An animation is **long-running** iff `iterations === Infinity` or `duration × iterations > 5000ms`. The contract covers **every `Animation` kind** — CSS `@keyframes` (`CSSAnimation`) and WAAPI (`Animation`) alike; only `CSSTransition`s are outside it (they are finite by construction).
2. A long-running animation MUST animate only `transform` and/or `opacity`.
3. Its effect target MUST be an `HTMLElement` (never `SVGElement`, root or interior).
4. No other animation or transition on the same element may animate a property outside {`transform`, `opacity`} while the long-running animation runs.
5. The target MUST have a `.tugx-motion-station` ancestor (or be the station itself).
6. Every long-running animation declaration MUST include `animation-play-state: var(--tugx-motion-play, running)` unless a more specific state rule (e.g. paused-state) overrides it deliberately.
7. `will-change` MUST appear only in rules whose selector implies the animation is running.
8. Finite gesture transitions and one-shot animations are exempt from 2–7 (but not from good sense).

**Spec S02: `.tugx-motion-station`** {#s02-motion-station}

- CSS: `contain: layout paint size; display: inline-block; position: relative;` — the box MUST carry explicit dimensions equal to the hosted animation's full motion extent (glyph size × max designed overshoot).
- Lives in a new `tugdeck/src/components/tugways/internal/tugx-motion-station.css` (or folded into `tug-progress-indicator.css`; implementer's call, one place only).
- Rendered by: `TugProgressIndicator` (around the variant glyph), `TugSkeleton`, `TugSparkline`, `TugMarquee`, and the **wave caret** (`tugdeck/src/components/tugways/tug-text-editor/wave-caret.ts` — it builds `tug-progress-wave` DOM directly inside the CM6 editor, bypassing `TugProgressIndicator`, so it stations its own root span; extent = the wave box it already sizes via the `--tugx-progress-wave-*` variables it sets).
- For the pulsing dot, the station box is `size × emit-reach` per `sizeGeometry` (`tug-progress-pulsing-dot.tsx`) — reach is 1 at ≥28px and ramps past 1 below.

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

| State | Zone (appearance / local-data / structure) | Mechanism | Law |
|-------|--------------------------------------------|-----------|-----|
| Collapse pause (`--tugx-motion-play`) | appearance | CSS custom property set by existing `.tug-pane-chrome--collapsed` rule; inherited | [L06] |
| Animation census | dev/test-only derived data | plain function in `perf-monitor.ts`, exposed on `window.tugPerfMonitor`; no store, no React | [L02] n/a (never enters React) |
| Station geometry | appearance | inline `width/height` computed from existing size props at render | [L06] |

No new React state, no new stores, no new persistence.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tuglaws/motion-residency.md` | The doctrine: contract, cost model, station spec |
| `tests/app-test/at02XX-motion-residency.test.ts` | Census enforcement app-test (number = next free per `tuglaws/app-test-inventory.md`) |
| `scripts/perf-resize-profile.sh` (or inline in justfile) | Paced-resize + `sample` profiling driver |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `animationCensus()` | fn | `tugdeck/src/lib/perf-monitor.ts` | Enumerates `document.getAnimations()`, classifies per Spec S01, returns violations list |
| `.tugx-motion-station` | CSS class | per Spec S02 | Contain wrapper + `--tugx-motion-play` reader host |
| `TugProgressIndicator` | component | `tugdeck/src/components/tugways/tug-progress-indicator.tsx` | Wraps glyph in station |
| `TugSkeleton` | component | `tugdeck/src/components/tugways/tug-skeleton.tsx` | `::after` shimmer overlay ([P03]); station class on root |
| `TugProgressPulsingDot` | component | `tugdeck/src/components/tugways/internal/tug-progress-pulsing-dot.tsx` | Ring → wrapper + 2 stroke layers ([P04]) |
| `TugProgressSpinner` | component | `tugdeck/src/components/tugways/internal/tug-progress-spinner.tsx` | HTML spokes ([P05]) |
| `tug-progress-ring.css` | CSS | `tugdeck/src/components/tugways/internal/` | Spin to wrapper ([P06]) |
| `wave-caret.ts` | module | `tugdeck/src/components/tugways/tug-text-editor/` | Station class + extent on its root span (Spec S02) |
| `perf-resize-profile` | just recipe | `justfile` | [P10] |

---

### Documentation Plan {#documentation-plan}

- [ ] `tuglaws/motion-residency.md` — contract + cost model ([P11])
- [ ] `tuglaws/design-decisions.md` — one new `[D##]` entry citing the contract
- [ ] `tuglaws/component-authoring.md` — cross-link from motion guidance
- [ ] `tuglaws/app-test-inventory.md` — register the census test

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **App-test (census)** | Assert the residency contract against the real running deck | The enforcement backbone; collapse-pause behavior |
| **Visual (manual + screenshot)** | Prove re-plumbs are pixel-faithful | Each re-plumb step's checkpoint, gallery side-by-side |
| **Profile (manual recipe)** | Before/after main-thread numbers | Step 1 baseline; final verification |
| **Build** | `bunx vite build` + tsc | Every step (rollup/dev-esbuild divergence) |

#### What stays out of tests {#test-non-goals}

- jsdom/mock render tests of indicators — banned pattern; the census test drives the real app.
- Automated pixel-diff CI — screenshots inform the implementer during the step; AA/scale variance makes them brittle as CI gates.
- CI-gated profiling — `sample` numbers are machine-dependent; the recipe is a tool, not a gate.
- Occlusion dormancy — out of scope (#non-goals).

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Baseline profile + census helper + profiling recipe | pending | — |
| #step-2 | Skeleton shimmer overlay | pending | — |
| #step-3 | Pulsing-dot thicken crossfade | pending | — |
| #step-4 | Spinner HTML spokes | pending | — |
| #step-5 | Ring spin to wrapper; pie/bar/wave census pass | pending | — |
| #step-6 | Motion stations + will-change audit | pending | — |
| #step-7 | Collapse dormancy | pending | — |
| #step-8 | Residency app-test + inventory registration | pending | — |
| #step-9 | tuglaws doctrine | pending | — |
| #step-10 | Integration checkpoint | pending | — |

#### Step 1: Baseline profile + census helper + profiling recipe {#step-1}

**Commit:** `tugways(motion-residency): animation census helper and perf-resize-profile recipe`

**References:** [P09] Census enforcement, [P10] Profiling recipe, Spec S01, (#webkit-cost-model, #success-criteria)

**Artifacts:**
- `animationCensus()` in `tugdeck/src/lib/perf-monitor.ts`, exposed on `window.tugPerfMonitor`
- `just perf-resize-profile [app-name]` recipe (+ helper script if not inline)
- Baseline profile captures recorded in the commit message body (idle + resize, before any fix)

**Tasks:**
- [ ] Implement `animationCensus()`: filter `document.getAnimations()` to long-running per Spec S01 rule 1 — every non-`CSSTransition` `Animation`, WAAPI included; for each, capture animation name, target tag/class, keyframe property set (`effect.getKeyframes()`), `playState`, station ancestry; return `{ total, longRunning, violations: [...] }` with violation reasons.
- [ ] Write the profiling recipe per [P10]: resolve the app's WebContent pid (walk `pgrep -f com.apple.WebKit.WebContent` children against the target app's auxiliary processes; simplest reliable approach — `sample` each candidate briefly or match via `ps` ancestry), drive the paced AX resize, run `sample`, grep the output into the verdict summary. Include an `idle` mode (no resize).
- [ ] Run the recipe against the debug app twice (idle, resize); store both outputs under `/tmp` and summarize numbers in the commit body.

**Tests:**
- [ ] `cd tugdeck && bun x tsc --noEmit` (helper compiles; dev/test-only gating like the rest of perf-monitor)

**Checkpoint:**
- [ ] `just perf-resize-profile Tug-debug` prints a verdict with nonzero sample counts
- [ ] In the running debug app: `window.tugPerfMonitor.animationCensus()` returns a violations list that names the skeleton and/or pulsing dot when one is on screen (proving the detector sees the known offenders)
- [ ] `bunx vite build` passes

---

#### Step 2: Skeleton shimmer overlay {#step-2}

**Depends on:** #step-1

**Commit:** `tugways(motion-residency): skeleton shimmer via overlay opacity crossfade`

**References:** [P01] Residency contract, [P03] Skeleton overlay, Table T01, Risk R01, (#component-mechanics)

**Artifacts:**
- `tug-skeleton.css`: static base background; `::after` overlay animating `opacity`

**Tasks:**
- [ ] Replace `td-shimmer` background-color keyframes with an opacity keyframes block on `.tug-skeleton::after` (highlight color, `position: absolute; inset: 0`, `border-radius: inherit`, `pointer-events: none`), same 2s period and easing. `.tug-skeleton` is currently a plain div — it needs `position: relative` to become the overlay's containing block.
- [ ] Verify `--tugx-skeleton-highlight` is opaque in all six theme files (`tugdeck/styles/themes/*.css`); note any exception in the step.
- [ ] Confirm motion-off (`body[data-tug-motion="off"]`) still zeroes the shimmer.

**Tests:**
- [ ] Census in the running app: skeleton no longer appears in `animationCensus().violations`.

**Checkpoint:**
- [ ] Gallery skeleton card (`gallery-skeleton.tsx`) side-by-side vs. pre-change: indistinguishable shimmer
- [ ] `bunx vite build` passes

---

#### Step 3: Pulsing-dot thicken crossfade {#step-3}

**Depends on:** #step-1

**Commit:** `tugways(motion-residency): pulsing-dot ring thicken via stacked-stroke crossfade`

**References:** [P01] Residency contract, [P04] Dot thicken crossfade, [Q01] Thicken parity, Table T01, Risk R01, (#component-mechanics)

**Artifacts:**
- `tug-progress-pulsing-dot.tsx`: ring rendered as wrapper + two stroke spans
- `tug-progress-pulsing-dot.css`: `emit-thicken` border-width keyframes replaced by two opacity keyframes on the stroke layers

**Tasks:**
- [ ] Restructure the ring DOM: wrapper span carries `emit-expand` + `emit-fade` (and `ringRef` / `releaseEmitter` wiring, `data-emitting` gate); children carry static `border-width`s from `--…-pulse-birth-width` / `--…-pulse-end-width` and opacity keyframes on the thicken easing var.
- [ ] Preserve both size treatments' geometry (BIG_SIZE path and the sub-28px reach ramp in `sizeGeometry`).
- [ ] Preserve every state crossing: running→paused/stopped/completed/aborted arrivals must still cross, not cut (the component's docstring documents the contract; exercise all five states in the gallery).
- [ ] Confirm motion-off and `--tug-timing` scaling hold.

**Tests:**
- [ ] Census: pulsing dot absent from violations while running.

**Checkpoint:**
- [ ] [Q01] resolved: gallery timing bench side-by-side at 28px and 10px treatments — thicken gesture reads identically; if not, STOP and surface the [Q01] fallback to the user
- [ ] All five states + disabled visually verified in `gallery-tug-progress-indicator`
- [ ] `bunx vite build` passes

---

#### Step 4: Spinner HTML spokes {#step-4}

**Depends on:** #step-1

**Commit:** `tugways(motion-residency): spinner spokes as HTML elements`

**References:** [P01] Residency contract, [P05] Spinner HTML spokes, Table T01, Risk R01

**Artifacts:**
- `tug-progress-spinner.tsx`: 12 positioned `<span>` spokes replacing the SVG
- `tug-progress-spinner.css`: spoke geometry/placement rules; `fill` → `background-color`

**Tasks:**
- [ ] Port the viewBox-unit geometry (INNER 24 / OUTER 48 / WIDTH 9 on a 100-unit box) to percentage-based spans rotated about the box center; keep the per-spoke negative `animation-delay` stagger and the `--tugx-progress-spinner-cycle` clock.
- [ ] Keep all four state classes' behavior (`running/paused/completed/disabled`) byte-for-byte in semantics.

**Tests:**
- [ ] Census: spinner absent from violations while running.

**Checkpoint:**
- [ ] Gallery spinner rows (all sizes/roles/states) indistinguishable side-by-side
- [ ] `bunx vite build` passes

---

#### Step 5: Ring spin to wrapper; pie/bar/wave census pass {#step-5}

**Depends on:** #step-1

**Commit:** `tugways(motion-residency): ring spin on the HTML wrapper; census-verify pie, bar, wave`

**References:** [P01] Residency contract, [P06] Spin on wrapper, [Q02] SVG-root acceleration, Table T01

**Artifacts:**
- `tug-progress-ring.css`: spin + scoped `will-change` on the root span; SVG holds a static `-90deg` rotation

**Tasks:**
- [ ] Move the `tug-progress-ring-spin` animation from `.tug-progress-ring-svg` to the indeterminate root; preserve the start angle.
- [ ] Run `animationCensus()` with pie, bar, wave, marquee, session-changes-scanning, and sparkline on screen; confirm zero violations from them (Table T01 "OK" rows) and record the census output in the commit body.

**Tests:**
- [ ] Census: ring absent from violations while indeterminate.

**Checkpoint:**
- [ ] Gallery ring (determinate + indeterminate) indistinguishable; determinate arc transition (stroke-dashoffset) unaffected
- [ ] `bunx vite build` passes

---

#### Step 6: Motion stations + will-change audit {#step-6}

**Depends on:** #step-2, #step-3, #step-4, #step-5

**Commit:** `tugways(motion-residency): motion stations and will-change scoping`

**References:** [P02] Motion stations, [P07] will-change discipline, Spec S02, Risk R01, (#webkit-cost-model)

**Artifacts:**
- `.tugx-motion-station` CSS + wrappers in `TugProgressIndicator`, `TugSkeleton`, `TugSparkline`, `TugMarquee`
- Re-scoped/removed `will-change` at the audit targets named in [P07]

**Tasks:**
- [ ] Implement Spec S02; for the pulsing dot compute the station box from `sizeGeometry` reach so sub-28px overshoot is never clipped (Risk table row 2).
- [ ] Station the wave caret: add the station class + extent sizing to the root span `wave-caret.ts` builds (it bypasses `TugProgressIndicator`; see Spec S02) — verify caret alignment in the editor is unchanged.
- [ ] Audit all 16 `will-change` declarations (grep `will-change` under `tugdeck/src` + `tugdeck/styles`); leave the correctly-scoped ones, re-scope `tug-marquee-strip`, `tug-sparkline-track`, `tug-sheet` shade (verify unmount-at-rest first), gallery petals/pole.
- [ ] Verify no indicator consumer breaks on the station's `inline-block` wrapper (grep consumers of `TugProgressIndicator`, `TugSkeleton`, `TugSparkline`, `TugMarquee`; spot-check Lens session rows, block headers, Z2 status, prompt entry).

**Tests:**
- [ ] Census: every long-running animation now reports a station ancestor.

**Checkpoint:**
- [ ] Gallery + Lens + a live session card visually unchanged (especially small pulsing dots' ring overshoot)
- [ ] `bunx vite build` passes; `just app-test-changed` green

---

#### Step 7: Collapse dormancy {#step-7}

**Depends on:** #step-6

**Commit:** `tugways(motion-residency): pause long-run animations under collapsed panes`

**References:** [P08] Collapse dormancy, Spec S01 rule 6, (#component-mechanics)

**Artifacts:**
- `animation-play-state: var(--tugx-motion-play, running)` added to every long-run animation declaration (Table T01 rows)
- `.tug-pane-chrome--collapsed { --tugx-motion-play: paused; }` in `tug-pane.css`

**Tasks:**
- [ ] Add the var read to each loop rule; verify the explicit paused-state rules (e.g. `.tug-progress-spinner-paused`) still win where intended.
- [ ] Gotcha: the `animation:` shorthand **resets** `animation-play-state` — the var declaration must come *after* the shorthand within the same rule (or the shorthand must carry it), else the gate silently never applies.
- [ ] Manually verify collapse→expand of a pane with a running indicator shows a freeze/resume, not a cut or restart.

**Tests:**
- [ ] Behavioral assertion deferred to the census app-test (#step-8), which collapses a seeded pane and asserts non-running play states.

**Checkpoint:**
- [ ] In the running app: collapse a session card mid-turn; `document.getAnimations()` under its body reports no `running` infinite loops; expand resumes seamlessly
- [ ] `bunx vite build` passes

---

#### Step 8: Residency app-test + inventory registration {#step-8}

**Depends on:** #step-6, #step-7

**Commit:** `tugways(motion-residency): census app-test enforcing the residency contract`

**References:** [P09] Census enforcement, [P08] Collapse dormancy, Spec S01, Spec S02, (#test-plan-concepts)

**Artifacts:**
- `tests/app-test/at02XX-motion-residency.test.ts` (next free AT number; `at0284` was the highest at authoring time — confirm against `tuglaws/app-test-inventory.md`)
- Inventory registration + `@covers` lines (`tug-progress-indicator.tsx`, the six internal variant files, `tug-skeleton.tsx`, `tug-text-editor/wave-caret.ts`, `perf-monitor.ts`, `tug-pane.css`)

**Tasks:**
- [ ] Seed a pane with the `gallery-tug-progress-indicator` card (all variants/states mounted) and a skeleton surface; settle-wait; call `window.tugPerfMonitor.animationCensus()` via `evalJS`; assert the minimum-count floor first (`longRunning ≥` the seeded card's running-variant count — a vacuous-pass guard per [P09]), then assert zero violations.
- [ ] Collapse the seeded pane (drive the real collapse gesture or store call `togglePaneCollapse`), re-census, assert every long-running animation under it is not `running`; expand and assert they resume.
- [ ] Keep the test fast and exiting per app-test doctrine; use settle delays around the collapse gesture.

**Tests:**
- [ ] The test itself.

**Checkpoint:**
- [ ] `just app-test tests/app-test/at02XX-motion-residency.test.ts` passes
- [ ] `just app-test-covers-check` passes

---

#### Step 9: tuglaws doctrine {#step-9}

**Depends on:** #step-8

**Commit:** `tuglaws(motion-residency): the compositor-residency contract`

**References:** [P11] tuglaws doctrine, [P01] [P02] [P07] [P08], Spec S01, Spec S02, (#webkit-cost-model)

**Artifacts:**
- `tuglaws/motion-residency.md`; `design-decisions.md` entry; `component-authoring.md` cross-link

**Tasks:**
- [ ] Write the doc: the contract (Spec S01), the station (Spec S02), the WebKit cost model (#webkit-cost-model), the census test as the enforcement mechanism, the exemption for finite gesture motion, and the WAAPI asymmetry — `--tugx-motion-play` pauses CSS loops only; WAAPI loops need their own dormancy controller ([P08]).
- [ ] Add the global `[D##]` entry (next free number) and the component-authoring cross-link.

**Tests:**
- [ ] n/a (documentation)

**Checkpoint:**
- [ ] Doc review: a component author can determine from the doc alone whether a proposed animation is legal and how to station it

---

#### Step 10: Integration checkpoint {#step-10}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5, #step-6, #step-7, #step-8, #step-9

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #exit-criteria), [P10] Profiling recipe, Risk R02

**Tasks:**
- [ ] Re-run `just perf-resize-profile` (idle + resize) against a debug build with a session card mid-turn; compare against the step-1 baseline; record both in the session notes for the user.
- [ ] Verify the success criterion: no `applyKeyframeEffects` in the steady-state per-frame path.
- [ ] Full selective sweep: `just app-test-changed`.

**Tests:**
- [ ] Aggregate: census app-test + selective sweep green.

**Checkpoint:**
- [ ] `just app-test-changed` green; `bunx vite build` passes; profile delta reported to the user
- [ ] If resize still janks: record the top remaining frames and file the transcript-layer-depth follow-on (#roadmap) with those numbers

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Every long-running animation in Tug runs compositor-resident inside a contained motion station, pauses under collapsed panes, and is guarded by a census app-test and a one-command profiling recipe — with the doctrine recorded in tuglaws.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Census app-test green in the selective sweep (`just app-test-changed`)
- [ ] Zero `animationCensus()` violations with the full gallery + a live session on screen (manual check in the running app)
- [ ] Steady-state profile shows no per-frame `applyKeyframeEffects` / style-resolution loop (`just perf-resize-profile` idle mode)
- [ ] All re-plumbed surfaces visually indistinguishable (gallery side-by-sides done at each step)
- [ ] `bunx vite build` + `bun x tsc --noEmit` clean; tuglaws docs landed

**Acceptance tests:**
- [ ] `at02XX-motion-residency.test.ts` (census + collapse dormancy)
- [ ] `just app-test-changed` over the touched files

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Transcript layer-depth reduction — only if the step-10 profile still shows resize jank; carry the recorded frames as evidence
- [ ] Occlusion-based dormancy for fully-covered panes
- [ ] DevPanel census tile (needs a cached/versioned snapshot per the perf-monitor docstring; census fn is already shared-ready)
- [ ] Imposed-card live *width* derivation during window resize (design question on `layout-imposer.ts`, separate from perf)

| Checkpoint | Verification |
|------------|--------------|
| Residency enforced | census app-test in CI sweep |
| Perf improved | step-1 vs step-10 `perf-resize-profile` delta |
| Look preserved | per-step gallery side-by-sides |
| Doctrine durable | `tuglaws/motion-residency.md` + `[D##]` entry |
