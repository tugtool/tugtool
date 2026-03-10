<!-- tugplan-skeleton v2 -->

## Tugways Phase 7a: TugAnimator Engine {#tug-animator}

**Purpose:** Build the TugAnimator programmatic animation engine wrapping WAAPI and the physics solvers (spring, gravity, friction) that pre-compute curves into WAAPI keyframes. Pure infrastructure -- no existing code migration.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | kocienda |
| Status | draft |
| Target branch | tugways-phase-7a-tug-animator |
| Last updated | 2026-03-10 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Tugdeck needs a programmatic animation engine for motion that CSS transitions cannot handle: coordinated multi-element animations, spring physics, drag release, cancellation with hold-at-current semantics, and completion promises. The Web Animations API (WAAPI) provides these capabilities natively in all modern browsers, but requires a coordination layer for named slots, animation groups, physics pre-computation, and token/motion awareness.

Phase 7a builds this engine as pure TypeScript infrastructure. No existing animations are migrated (that is Phase 7b). The engine establishes the foundation that all future programmatic motion in tugways depends on.

#### Strategy {#strategy}

- Build physics solvers first (spring, gravity, friction) as a standalone module with no DOM dependencies, enabling thorough unit testing in isolation.
- Build the TugAnimator engine second, importing physics solvers and wrapping WAAPI with the named-slot, group, and cancellation APIs.
- Use a singleton module export pattern (not a class instance), matching the `scale-timing.ts` convention -- callers import `animate()`, `group()` directly.
- Track named animation slots in a module-level `WeakMap<Element, Map<string, Animation>>` to avoid preventing GC of removed elements.
- Read `getTugTiming()` and `isTugMotionEnabled()` from `scale-timing.ts` at animation start time, not cached, so runtime changes to `--tug-timing` affect new animations.
- Test with a minimal WAAPI mock injected into `setup-rtl.ts`, verifying TugAnimator's coordination logic rather than WAAPI itself.

#### Success Criteria (Measurable) {#success-criteria}

- `animate()` returns a `TugAnimation` whose `.finished` promise resolves after the WAAPI animation completes (`bun test` verifies via mock)
- Named animation slots: calling `animate()` with the same key on the same element cancels the previous animation (verified by mock `.cancel()` call count)
- All three cancellation modes (snap-to-end, hold-at-current, reverse-from-current) produce the correct WAAPI calls (verified by mock assertions)
- `group().finished` resolves only after all constituent animations complete (verified via multiple mock animations)
- `SpringSolver.keyframes()` produces an array of transform values that converge to the target within the specified duration (verified by numerical assertions)
- `GravitySolver.keyframes()` produces values that bounce with decreasing amplitude (verified by numerical assertions)
- `FrictionSolver.keyframes()` produces normalized [0, 1] exponential decay values consistent with other solvers (verified by numerical assertions)
- Token name strings (e.g., `'--tug-base-motion-duration-moderate'`) are resolved to base ms values via lookup map, then scaled by `getTugTiming()` (verified by assertions on the duration passed to WAAPI mock)
- When `isTugMotionEnabled()` returns false, spatial animations are replaced with opacity fades (verified by checking keyframes passed to mock)
- All tests pass: `cd tugdeck && bun test src/__tests__/tug-animator.test.ts`

#### Scope {#scope}

1. `tugdeck/src/components/tugways/physics.ts` -- SpringSolver, GravitySolver, FrictionSolver classes
2. `tugdeck/src/components/tugways/tug-animator.ts` -- animate(), group(), cancellation modes, named slots, token/motion awareness, reduced-motion replacement
3. `tugdeck/src/__tests__/tug-animator.test.ts` -- unit tests for physics solvers and TugAnimator coordination
4. Minimal WAAPI mock additions to `tugdeck/src/__tests__/setup-rtl.ts`

#### Non-goals (Explicitly out of scope) {#non-goals}

- Migrating any existing CSS animations or rAF loops to TugAnimator (Phase 7b)
- Implementing skeleton loading states (Phase 7b)
- Startup continuity / flash elimination (Phase 7c)
- Driving Radix-managed enter/exit animations (Rule 14 -- Radix Presence owns that boundary)
- Replacing CSS transitions for hover/focus states (Rule 13 -- CSS handles declarative motion)

#### Dependencies / Prerequisites {#dependencies}

- `scale-timing.ts` exists with `getTugTiming()` and `isTugMotionEnabled()` exports (confirmed present)
- Motion tokens defined in `tug-tokens.css`: `--tug-base-motion-duration-fast/moderate/slow/glacial`, `--tug-base-motion-easing-standard` (confirmed present)
- Test infrastructure: `setup-rtl.ts` with happy-dom, rAF/cAF mocks (confirmed present)

#### Constraints {#constraints}

- WAAPI is the only animation playback mechanism -- no `requestAnimationFrame` animation loops, no CSS `@keyframes` generation from JS (Rule 13)
- Physics solvers pre-compute keyframes arrays -- they do not run per-frame (WAAPI handles interpolation)
- Must work with React 19.2.4 (no React lifecycle coupling -- TugAnimator operates on raw DOM elements)
- All new files are TypeScript, no new CSS files needed
- Duration token resolution uses a hardcoded lookup map, not `getComputedStyle`, because unregistered CSS custom properties return unresolved `calc()` strings from `getComputedStyle`

#### Assumptions {#assumptions}

- WAAPI `Element.prototype.animate()` is available in all target browsers (Chrome, Safari, Firefox -- confirmed since 2020)
- happy-dom does not implement WAAPI, so tests require a mock
- Physics solvers use fixed-timestep integration (1/60s steps) to pre-compute keyframes, with step count determined by duration
- `getTugTiming()` and `isTugMotionEnabled()` are called at animation start time, not stored -- mid-animation changes to `--tug-timing` do not affect running animations
- Spring solver convergence threshold of 0.01 (normalized) is sufficient for visual settling

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan uses explicit anchors per the skeleton contract. All anchors are kebab-case, no phase numbers. See the skeleton for full rules.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| WAAPI mock diverges from real browser behavior | med | med | Keep mock minimal; verify manually in browser before Phase 7b migration | Mock-passing tests fail in real browser |
| Spring solver keyframe count is too high for long durations | low | low | Cap keyframe count at 300 (5 seconds at 60fps); warn if exceeded | Performance profiling shows animation jank |
| Duration token lookup map drifts from tug-tokens.css | low | low | Small stable set (5 entries), cross-reference comments, error on unrecognized token | Unrecognized token error in production |

**Risk R01: WAAPI mock fidelity** {#r01-waapi-mock}

- **Risk:** The minimal WAAPI mock may not capture edge cases in real browser WAAPI behavior (e.g., auto-removal of finished animations, composite mode interactions).
- **Mitigation:** Keep the mock surface area small (`.finished`, `.cancel()`, `.finish()`, `.commitStyles()`, `.persist()`). Defer browser-specific edge cases to Phase 7b integration testing.
- **Residual risk:** Some coordination bugs may only surface when running in a real browser. Phase 7b migration will catch these.

**Risk R02: Duration token lookup map drift from tug-tokens.css** {#r02-token-drift}

- **Risk:** The hardcoded base-value lookup map in `tug-animator.ts` could fall out of sync if new duration tokens are added to `tug-tokens.css` without updating the map.
- **Mitigation:** The token set is small (5 entries) and stable. Add a code comment in both files cross-referencing each other. A future phase could add a build-time check.
- **Residual risk:** Low -- new duration tokens are rare and would be caught during development when the token string throws an unrecognized-token error.

---

### Design Decisions {#design-decisions}

#### [D01] Singleton module export pattern (DECIDED) {#d01-singleton-module}

**Decision:** TugAnimator exports free functions (`animate()`, `group()`) from a module, not a class instance.

**Rationale:**
- Matches the established `scale-timing.ts` pattern in the codebase
- No need for multiple animator instances -- animation state is per-element via WeakMap
- Simpler API surface for callers: `import { animate } from './tug-animator'`

**Implications:**
- Module-level `WeakMap<Element, Map<string, Animation>>` for named slot tracking
- Module-level state means tests must clean up between test cases (clear the WeakMap)

#### [D02] WeakMap for named animation slots (DECIDED) {#d02-weakmap-slots}

**Decision:** Named animation slots are tracked in a `WeakMap<Element, Map<string, Animation>>` at module scope.

**Rationale:**
- WeakMap keys are weak references -- when an element is removed from the DOM and GC'd, its slot map is automatically collected
- Prevents memory leaks for dynamically created/destroyed elements
- Per-element slot maps allow multiple independent animation keys per element

**Implications:**
- Cannot enumerate all tracked elements (WeakMap is not iterable) -- this is acceptable since we never need global animation queries
- Tests must create fresh elements to avoid cross-test pollution
- **Named slots vs additive composition:** These serve different purposes. Named slots (`key` option) are for replacement -- a new animation with the same key cancels the previous one (e.g., repositioning a card cancels the previous position animation). Additive composition (`composite: 'add'`) is for layering independent animations on the same element without cancellation (e.g., a bounce effect layered on top of a position animation). An additive animation can still use a named slot to make it individually cancellable.

#### [D03] Stateful physics solver classes (DECIDED) {#d03-stateful-solvers}

**Decision:** Physics solvers are stateful classes (`new SpringSolver(mass, stiffness, damping, initialVelocity)`) with `.keyframes(durationMs)` and `.velocityAt(t)` methods.

**Rationale:**
- Stateful design enables velocity matching on interruption: read `.velocityAt(t)` from the current animation, pass it as `initialVelocity` to the new solver
- Class instances encapsulate the physics parameters, making it easy to create multiple solvers with different configs
- `.keyframes()` returns a pre-computed array suitable for WAAPI's keyframes parameter

**Implications:**
- Solver instances are short-lived -- created at animation start, used to generate keyframes, then discarded
- `velocityAt(t)` requires the solver to store its parameters (not just the generated keyframes)

#### [D04] Token name or raw ms for duration (DECIDED) {#d04-duration-api}

**Decision:** The `duration` option accepts either a duration token name string (e.g., `'--tug-base-motion-duration-moderate'`) or a raw number in milliseconds. Both paths produce a final ms value by looking up the base (unscaled) duration and multiplying by `getTugTiming()`:

- **Token string:** Look up the base ms value from a hardcoded map inside `tug-animator.ts`. The map mirrors `tug-tokens.css` and contains the unscaled base values:
  ```
  '--tug-base-motion-duration-instant':  0,
  '--tug-base-motion-duration-fast':     100,
  '--tug-base-motion-duration-moderate': 200,
  '--tug-base-motion-duration-slow':     350,
  '--tug-base-motion-duration-glacial':  500,
  ```
  After lookup, multiply by `getTugTiming()` to get the final scaled duration.
- **Raw number:** The caller provides an unscaled ms value. Multiply by `getTugTiming()` to apply the timing scalar.

Both paths apply `getTugTiming()` exactly once, preventing double-scaling.

**Rationale:**
- Token names keep animation durations consistent with the design system
- Raw ms allows physics solvers and custom durations that don't map to tokens
- A hardcoded lookup map is necessary because the CSS tokens are unregistered custom properties defined as `calc(Nms * var(--tug-timing))`. For unregistered properties, `getComputedStyle` performs `var()` substitution but does NOT resolve `calc()` expressions -- it returns a string like `"calc(100ms * 1)"`, not a numeric value. `parseFloat()` on this string returns `NaN`. Registering the tokens via `@property { syntax: '<time>' }` would fix this but expands scope to CSS changes. The lookup map is simpler and keeps all 5 entries trivially in sync with `tug-tokens.css`.
- `getTugTiming()` reads the live `--tug-timing` value from `:root` at call time, so timing scalar changes propagate to new animations

**Implications:**
- `animate()` must check if `duration` is a string (lookup + scale) or number (direct scale)
- If a token name is not found in the map, throw an error with the unrecognized token name
- The map must be updated if new duration tokens are added to `tug-tokens.css` (low maintenance -- the token set is stable and small)
- No `getComputedStyle` dependency for token resolution (only `getTugTiming()` reads from the DOM)
- Tests do not need to mock `getComputedStyle` for duration token resolution -- only for `getTugTiming()` (which `scale-timing.ts` already handles via `document.documentElement`)

#### [D05] Reverse cancellation via getComputedStyle approximation (DECIDED) {#d05-reverse-cancel}

**Decision:** The "reverse-from-current" cancellation mode reads current property values from `getComputedStyle()` at cancellation time and animates back to the original start values. The easing of the reversal is a separate parameter.

**Rationale:**
- `getComputedStyle()` provides the current rendered values after WAAPI's `.cancel()` commits styles
- Approximation is sufficient -- the visual result is a smooth reversal from wherever the animation was
- Separating the reversal easing parameter allows callers to choose appropriate deceleration curves

**Promise behavior for reverse-from-current:** The original `TugAnimation.finished` promise is re-wired to resolve when the reversal animation completes (not when the original is cancelled). This is the most caller-friendly behavior -- `await anim.finished` resolves after the full visual sequence (original + reversal) completes, regardless of whether cancellation occurred midway. Internally, the `.finished` promise is replaced with the reversal animation's `.finished` promise.

**Implications:**
- Must call `.commitStyles()` before `.cancel()` to bake current values into inline styles, then read them, then animate back
- The reversal creates a new WAAPI animation (not a playback rate change), occupying the same named slot
- The original WAAPI `.finished` rejection is caught internally -- callers see only the re-wired promise
- Properties to reverse must be known -- stored when the original animation starts

#### [D06] Reduced motion replaces spatial with opacity (DECIDED) {#d06-reduced-motion}

**Decision:** When `isTugMotionEnabled()` returns false, `animate()` replaces spatial keyframes (transform, translate, scale, rotate) with opacity fades. Non-spatial animations (opacity-only, color changes) play unchanged.

**Rationale:**
- Follows Apple's "replace, don't remove" principle -- UI state changes still communicate visually
- Design doc (Concept 8) specifies this behavior explicitly
- Checking at animation start time means reduced-motion toggle changes affect new animations immediately

**Implications:**
- `animate()` must inspect keyframe properties to determine if they are spatial
- The replacement opacity fade uses a standard duration (`--tug-base-motion-duration-fast`)
- Completion promises still resolve at the correct time (the fade has a real duration)

#### [D07] Animation groups use Promise.all on .finished (DECIDED) {#d07-group-promise-all}

**Decision:** `TugAnimationGroup.finished` is implemented as `Promise.all()` over all constituent WAAPI animation `.finished` promises.

**Rationale:**
- Matches the UIView.animate model -- group completion means all animations are done
- Promise.all fails fast if any animation is cancelled/rejected, which is correct behavior (group cancellation should propagate)
- No custom synchronization needed -- WAAPI provides the per-animation promises

**Implications:**
- Cancelling one animation in a group rejects the group's `.finished` promise
- Callers should use try/catch or `.catch()` if they expect partial cancellation
- Group does not own the animations -- it aggregates their promises

---

### Specification {#specification}

#### Public API Surface {#public-api}

**Spec S01: TugAnimation interface** {#s01-tug-animation}

```typescript
interface TugAnimation {
  /**
   * Resolves when the animation completes.
   * - Natural completion: resolves normally.
   * - snap-to-end cancel: resolves (animation.finish() resolves the WAAPI promise).
   * - hold-at-current cancel: rejects (animation is cancelled).
   * - reverse-from-current cancel: re-wired to resolve when the reversal completes.
   */
  finished: Promise<void>;
  /** Cancel with the specified mode. Defaults to 'snap-to-end'. */
  cancel(mode?: 'snap-to-end' | 'hold-at-current' | 'reverse-from-current', opts?: { reverseEasing?: string }): void;
  /** The underlying WAAPI Animation object (escape hatch). */
  raw: Animation;
}
```

**Spec S02: animate() function** {#s02-animate}

```typescript
function animate(
  el: Element,
  keyframes: Keyframe[] | PropertyIndexedKeyframes,
  options?: {
    duration?: string | number;  // token name or raw ms
    easing?: string;             // raw CSS easing string (e.g., 'ease-out', 'cubic-bezier(0.2, 0, 0, 1)'); no token resolution -- callers pass the value directly
    key?: string;                // named slot key
    slotCancelMode?: 'snap-to-end' | 'hold-at-current';  // how to cancel prev animation in same slot; default 'snap-to-end'
    composite?: CompositeOperation;  // default 'replace'
    fill?: FillMode;             // default 'forwards'
  }
): TugAnimation;
```

**Spec S03: group() function** {#s03-group}

```typescript
interface TugAnimationGroup {
  /** Add an animation to this group. Returns TugAnimation for individual control. */
  animate(el: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes, options?: AnimateOptions): TugAnimation;
  /** Resolves when ALL animations in the group complete. */
  finished: Promise<void>;
  /** Cancel all animations in the group. */
  cancel(mode?: CancelMode): void;
}

function group(options?: {
  duration?: string | number;
  easing?: string;
}): TugAnimationGroup;
```

**Spec S04: Physics solver classes** {#s04-physics-solvers}

```typescript
class SpringSolver {
  constructor(params: {
    mass: number;         // default 1
    stiffness: number;    // default 100
    damping: number;      // default 10
    initialVelocity?: number;  // default 0
  });
  /** Pre-compute keyframes for a normalized 0-to-1 transition over the given duration. */
  keyframes(durationMs: number): number[];
  /** Get the velocity at time t (0 to durationMs). Used for velocity matching on interruption. */
  velocityAt(t: number): number;
}

class GravitySolver {
  constructor(params: {
    acceleration?: number;           // default 9.8 (normalized units/s^2)
    coefficientOfRestitution?: number;  // default 0.6 (bounce factor)
    initialVelocity?: number;        // default 0
  });
  /**
   * Pre-compute a drop-to-rest bounce curve.
   * Returns values in [0, 1]: 1.0 = initial drop height, 0.0 = ground (rest).
   * First value is 1.0, converges to 0.0 with bounces of decreasing amplitude.
   */
  keyframes(durationMs: number): number[];
}

class FrictionSolver {
  constructor(params: {
    initialVelocity: number;
    friction?: number;  // default 0.1 (exponential decay coefficient)
  });
  /**
   * Pre-compute a friction deceleration curve.
   * Returns values in [0, 1]: 0.0 = start position, 1.0 = asymptotic rest position.
   * Normalized by dividing by v0/friction so output is parameter-independent.
   * Callers scale [0, 1] output by desired displacement.
   */
  keyframes(durationMs: number): number[];
}
```

#### Internal Architecture {#internal-architecture}

**Table T01: Module dependencies** {#t01-module-deps}

| Module | Imports from | Exports |
|--------|-------------|---------|
| `physics.ts` | (none) | `SpringSolver`, `GravitySolver`, `FrictionSolver` |
| `tug-animator.ts` | `scale-timing.ts` (`getTugTiming`, `isTugMotionEnabled`), `physics.ts` (re-exports) | `animate`, `group`, `TugAnimation`, `TugAnimationGroup`, re-exports physics solvers |

**Table T02: Named slot lifecycle** {#t02-slot-lifecycle}

| Event | Action |
|-------|--------|
| `animate(el, kf, { key: 'foo' })` called, no existing 'foo' slot | Create WAAPI animation, store in WeakMap under el/'foo' |
| `animate(el, kf, { key: 'foo' })` called, existing 'foo' slot | Cancel existing animation using `slotCancelMode` (default: snap-to-end), create new, store in WeakMap |
| Animation completes naturally | Remove from WeakMap slot |
| Element is GC'd | WeakMap entry is automatically collected |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files (if any) {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/physics.ts` | Spring, gravity, friction solvers -- pre-compute physics curves into WAAPI keyframe arrays |
| `tugdeck/src/components/tugways/tug-animator.ts` | WAAPI wrapper with animate(), group(), named slots, cancellation modes, token/motion awareness |
| `tugdeck/src/__tests__/tug-animator.test.ts` | Unit tests for physics solvers and TugAnimator coordination logic |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `SpringSolver` | class | `physics.ts` | Damped harmonic oscillator, `.keyframes()`, `.velocityAt()` |
| `GravitySolver` | class | `physics.ts` | Constant acceleration with bounce |
| `FrictionSolver` | class | `physics.ts` | Exponential decay |
| `DURATION_TOKEN_MAP` | const | `tug-animator.ts` | Maps token names to base ms values (mirrors tug-tokens.css) |
| `animate` | function | `tug-animator.ts` | Core animation API, returns `TugAnimation` |
| `group` | function | `tug-animator.ts` | Animation group factory, returns `TugAnimationGroup` |
| `TugAnimation` | interface | `tug-animator.ts` | `.finished` promise, `.cancel()` with modes, `.raw` escape hatch |
| `TugAnimationGroup` | interface | `tug-animator.ts` | `.animate()`, `.finished`, `.cancel()` |
| `_resetSlots` | function | `tug-animator.ts` | Test-only: clears the WeakMap for test isolation |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test physics solver math in isolation (no DOM, no WAAPI) | SpringSolver, GravitySolver, FrictionSolver keyframe generation and velocity computation |
| **Unit (mocked WAAPI)** | Test TugAnimator coordination logic with mock WAAPI | animate(), group(), named slots, cancellation, token resolution, reduced motion |

#### WAAPI Mock Strategy {#waapi-mock-strategy}

The WAAPI mock is injected into `setup-rtl.ts` and provides:
- `Element.prototype.animate(keyframes, options)` returning a fake `Animation` object
- Fake `Animation` with: `.finished` (controllable Promise), `.cancel()`, `.finish()`, `.commitStyles()`, `.persist()`, `.playState`, `.effect`
- Tests control promise resolution to simulate completion and cancellation
- Mock tracks call arguments for assertion (what keyframes and options were passed)

---

### Execution Steps {#execution-steps}

> Execution comes last. Each step should be executable, with a clear commit boundary and a checkpoint.
>
> **Commit after all checkpoints pass.** This rule applies to every step below.

#### Step 1: Add WAAPI mock to test setup {#step-1}

**Commit:** `test: add minimal WAAPI mock to setup-rtl.ts for TugAnimator tests`

**References:** [D01] Singleton module export pattern, Risk R01 (#r01-waapi-mock), Risk R02 (#r02-token-drift), (#waapi-mock-strategy)

**Artifacts:**
- Modified `tugdeck/src/__tests__/setup-rtl.ts` with WAAPI mock
- New file `tugdeck/src/__tests__/tug-animator.test.ts` with WAAPI mock smoke tests

**Tasks:**
- [ ] Add a mock `Element.prototype.animate` to `setup-rtl.ts` that returns a fake Animation object
- [ ] The fake Animation must have: `.finished` (Promise that resolves on demand), `.cancel()`, `.commitStyles()`, `.persist()`, `.playState`, `.effect` (with `.getComputedTiming()`)
- [ ] Track all `animate()` calls on a module-level array so tests can inspect what was called
- [ ] Export a `mockWaapi` object from setup-rtl or make it accessible via `(global as any).__waapi_mock__` for test inspection
- [ ] Ensure `getComputedStyle` mock can be extended per-test to return CSS property values (for reverse-from-current cancellation tests that read current element styles)
- [ ] Create `tugdeck/src/__tests__/tug-animator.test.ts` with initial smoke tests that verify the WAAPI mock works (subsequent steps add test cases to this file)

**Tests:**
- [ ] Verify that calling `document.createElement('div').animate([], {})` in a test returns the mock Animation object
- [ ] Verify that `.finished` is a Promise

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/tug-animator.test.ts` -- WAAPI mock smoke tests pass

---

#### Step 2: Implement physics solvers {#step-2}

**Depends on:** #step-1

**Commit:** `feat: add physics solvers (spring, gravity, friction) for TugAnimator`

**References:** [D03] Stateful physics solver classes, Spec S04 (#s04-physics-solvers), (#strategy)

**Artifacts:**
- New file `tugdeck/src/components/tugways/physics.ts`

**Tasks:**
- [ ] Implement `SpringSolver` class:
  - Constructor accepts `{ mass, stiffness, damping, initialVelocity }` with defaults (mass=1, stiffness=100, damping=10, initialVelocity=0)
  - `.keyframes(durationMs)` uses fixed-timestep integration at 1/60s to solve the damped harmonic oscillator ODE, returning an array of normalized position values (0 to 1, with possible overshoot)
  - `.velocityAt(t)` returns the instantaneous velocity at time t by re-running the integration up to time t
  - Spring ODE: `x'' = -(stiffness/mass) * x - (damping/mass) * x'`, integrated via semi-implicit Euler: `v_new = v + a*dt; x_new = x + v_new*dt`
- [ ] Implement `GravitySolver` class:
  - Constructor accepts `{ acceleration, coefficientOfRestitution, initialVelocity }` with defaults
  - `.keyframes(durationMs)` simulates a drop-to-rest bounce: values are in [0, 1] where 1.0 is the initial drop height and 0.0 is the rest position (ground). The first keyframe is 1.0 (start at top), values decrease under gravity toward 0.0, bounce back with amplitude reduced by `coefficientOfRestitution`, and converge to 0.0 (at rest on ground). Callers map these values to CSS properties (e.g., `translateY: value * dropDistance`).
  - Position is clamped to >= 0 (cannot go below ground)
- [ ] Implement `FrictionSolver` class:
  - Constructor accepts `{ initialVelocity, friction }` with defaults
  - `.keyframes(durationMs)` computes exponential decay and normalizes to [0, 1]: raw position is `(v0/friction) * (1 - e^(-friction * t))`, which asymptotically approaches `v0/friction`. Divide by the asymptotic maximum `v0/friction` to normalize, yielding `1 - e^(-friction * t)`. Output range is [0, 1] where 0.0 is the start position and 1.0 is the asymptotic rest position, consistent with SpringSolver and GravitySolver. Callers scale the [0, 1] output by desired displacement.
  - Returns array of normalized position values in [0, 1]
- [ ] All solvers cap keyframe arrays at 300 entries (5 seconds at 60fps) to prevent performance issues
- [ ] SpringSolver: clamp the final keyframe value to exactly 1.0 to ensure visual completion regardless of whether the spring has fully converged within the given duration (callers should choose compatible parameters, but clamping prevents visual artifacts if they don't)
- [ ] Export all three classes from `physics.ts`

**Tests:**
- [ ] SpringSolver: keyframes converge to 1.0 (within 0.01) by the last frame
- [ ] SpringSolver: underdamped spring produces overshoot (values > 1.0 in the middle)
- [ ] SpringSolver: critically damped spring reaches 1.0 without overshoot
- [ ] SpringSolver: `.velocityAt(0)` equals `initialVelocity`
- [ ] SpringSolver: `.velocityAt(durationMs)` is near 0 for a settled spring
- [ ] GravitySolver: first keyframe is 1.0 (drop height), values decrease toward 0.0 (ground), bounce with decreasing amplitude, converge to 0.0
- [ ] GravitySolver: coefficientOfRestitution=0 produces no bounce (sticks on first ground contact at 0.0)
- [ ] FrictionSolver: keyframes follow normalized exponential decay curve (values in [0, 1])
- [ ] FrictionSolver: final value approaches 1.0 asymptotically (normalized)
- [ ] FrictionSolver: first keyframe is 0.0 (start position)
- [ ] All solvers: keyframe array length does not exceed 300

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/tug-animator.test.ts` -- physics solver tests pass

---

#### Step 3: Implement TugAnimator core -- animate() and named slots {#step-3}

**Depends on:** #step-1, #step-2

**Commit:** `feat: implement TugAnimator animate() with named slots and cancellation modes`

**References:** [D01] Singleton module export pattern, [D02] WeakMap for named animation slots, [D04] Token name or raw ms for duration, [D05] Reverse cancellation via getComputedStyle approximation, [D06] Reduced motion replaces spatial with opacity, Spec S01 (#s01-tug-animation), Spec S02 (#s02-animate), Table T02 (#t02-slot-lifecycle), (#public-api, #internal-architecture)

**Artifacts:**
- New file `tugdeck/src/components/tugways/tug-animator.ts`

**Tasks:**
- [ ] Create module-level `WeakMap<Element, Map<string, Animation>>` for named slot tracking
- [ ] Define the duration token lookup map as a module-level `Record<string, number>` with 5 entries matching `tug-tokens.css` base values: instant=0, fast=100, moderate=200, slow=350, glacial=500
- [ ] Implement `animate(el, keyframes, options)`:
  - Resolve `duration`: if string (token name), look up the base ms value from the token map (throw if not found). If number (raw ms), use directly. In both cases, multiply by `getTugTiming()` to get the final scaled duration.
  - Check `isTugMotionEnabled()`: if false and keyframes contain spatial properties (transform, translate, scale, rotate), replace with opacity fade using `--tug-base-motion-duration-fast`
  - If `key` is provided: check WeakMap for existing animation on this element with this key. If found, cancel it using `slotCancelMode` (default: `'snap-to-end'`; also accepts `'hold-at-current'` for fluid motion scenarios like velocity-matched spring interruptions). When the slot cancel mode is `'hold-at-current'`, attach a no-op `.catch()` to the outgoing animation's `.finished` promise before cancelling, to prevent unhandled promise rejection errors (the rejection is expected and intentional). Store new animation under the key.
  - Create WAAPI animation via `el.animate(keyframes, { duration, easing, composite, fill })`
  - Wrap in `TugAnimation` object with `.finished`, `.cancel()`, `.raw`
  - On natural completion, remove from WeakMap slot
  - Return `TugAnimation`
- [ ] Implement `TugAnimation.cancel(mode)`:
  - `'snap-to-end'`: call `.finish()` on the underlying WAAPI animation, which snaps to the final keyframe values and resolves `.finished`
  - `'hold-at-current'`: call `.commitStyles()` then `.cancel()` (bakes current interpolated values into inline styles, then removes the animation)
  - `'reverse-from-current'`: call `.commitStyles()`, read current values from `getComputedStyle(el)`, `.cancel()` the original, then start a new animation from current values back to the stored original start values with the specified `reverseEasing`
- [ ] For reverse-from-current support, `animate()` must extract and store the first keyframe's property values at creation time:
  - For `Keyframe[]` format: clone the first element of the array and store it
  - For `PropertyIndexedKeyframes` format: extract the first value from each property's array and store as a `Record<string, string>`
  - Store this start-values snapshot on the `TugAnimation` wrapper object (private field) so `.cancel('reverse-from-current')` can access it later
- [ ] Implement `_resetSlots()` for test cleanup -- replaces the module-level WeakMap with a new instance (declare with `let`, not `const`, since `WeakMap` has no `.clear()` method)
- [ ] Export `animate`, `TugAnimation` interface, `_resetSlots`

**Tests:**
- [ ] `animate()` calls `el.animate()` with resolved duration and easing
- [ ] Token string duration resolves via lookup map and IS multiplied by `getTugTiming()` (e.g., `'--tug-base-motion-duration-moderate'` with timing=2 yields 400ms)
- [ ] Raw number duration IS multiplied by `getTugTiming()` timing scalar
- [ ] Unrecognized token string throws an error
- [ ] Named slot: second `animate()` with same key cancels first (default snap-to-end: `.finish()` called)
- [ ] Named slot: `slotCancelMode: 'hold-at-current'` uses `.commitStyles()` + `.cancel()` instead of `.finish()`
- [ ] Named slot: `slotCancelMode: 'hold-at-current'` does not produce unhandled promise rejection (internal `.catch()` absorbs it)
- [ ] Named slot: different keys on same element coexist
- [ ] Cancel snap-to-end: `.finish()` called on underlying animation (snaps to final keyframe values)
- [ ] Cancel hold-at-current: `.commitStyles()` and `.cancel()` called
- [ ] Cancel reverse-from-current: starts a new animation from current values to original start values
- [ ] Cancel reverse-from-current: `.finished` promise re-wires to resolve when the reversal animation completes (not reject on original cancel)
- [ ] Cancel hold-at-current: `.finished` promise rejects
- [ ] `.finished` promise resolves when underlying animation completes
- [ ] Completed animation is removed from WeakMap slot

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/tug-animator.test.ts` -- animate() and named slot tests pass

---

#### Step 4: Implement animation groups {#step-4}

**Depends on:** #step-3

**Commit:** `feat: implement TugAnimator animation groups with coordinated completion`

**References:** [D07] Animation groups use Promise.all on .finished, Spec S03 (#s03-group), (#public-api)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-animator.ts` -- add `group()` function

**Tasks:**
- [ ] Implement `group(options)`:
  - Returns `TugAnimationGroup` object
  - Group-level `duration` and `easing` serve as defaults for animations added to the group
  - `group.animate(el, keyframes, options)` calls the module-level `animate()` with merged options (per-animation options override group defaults)
  - `group.finished` is `Promise.all()` over all constituent `TugAnimation.finished` promises, mapped to resolve to `void`
  - `group.cancel(mode)` calls `.cancel(mode)` on all constituent animations
- [ ] Export `group`, `TugAnimationGroup` interface
- [ ] Re-export physics solvers from `tug-animator.ts` for convenience: `export { SpringSolver, GravitySolver, FrictionSolver } from './physics'`

**Tests:**
- [ ] Group with two animations: `.finished` resolves only after both complete
- [ ] Group with one animation cancelled: `.finished` rejects
- [ ] Group `cancel()` cancels all constituent animations
- [ ] Per-animation options override group defaults
- [ ] Empty group: `.finished` resolves immediately

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/tug-animator.test.ts` -- all group tests pass

---

#### Step 5: Implement reduced-motion awareness {#step-5}

**Depends on:** #step-3

**Commit:** `feat: add reduced-motion awareness to TugAnimator`

**References:** [D06] Reduced motion replaces spatial with opacity, (#success-criteria)

**Artifacts:**
- Modified `tugdeck/src/components/tugways/tug-animator.ts` -- add reduced-motion logic to `animate()`

**Tasks:**
- [ ] Define the set of spatial CSS properties that trigger replacement: `transform`, `translate`, `translateX`, `translateY`, `scale`, `scaleX`, `scaleY`, `rotate`
- [ ] Handle both WAAPI keyframe formats before inspection:
  - `Keyframe[]` (array of objects): detect with `Array.isArray()`. Check each object's keys for spatial properties. Strip spatial keys from each keyframe object.
  - `PropertyIndexedKeyframes` (single object with array values per property): detect when not an array. Check the object's top-level keys for spatial properties. Delete spatial keys from the object.
  - Normalize to `Keyframe[]` before stripping if the implementation is simpler, since both formats are accepted by WAAPI.
- [ ] In `animate()`, when `isTugMotionEnabled()` returns false:
  - Inspect the (possibly normalized) keyframes for spatial properties
  - If any spatial properties are found: strip spatial properties from keyframes. If opacity values are already present in the original keyframes, preserve them (the fade direction is already defined). If no opacity is present, default to a fade-in (`[{ opacity: 0 }, { opacity: 1 }]`).
  - Use `--tug-base-motion-duration-fast` as the replacement duration
  - If the original keyframes contain only non-spatial properties, play them unchanged
- [ ] The replacement preserves the named slot key, so cancellation still works correctly

**Tests:**
- [ ] Motion enabled: spatial keyframes are passed through unchanged
- [ ] Motion disabled + spatial keyframes: replaced with opacity fade
- [ ] Motion disabled + non-spatial keyframes (e.g., opacity-only): played unchanged
- [ ] Motion disabled + mixed spatial and opacity: spatial removed, opacity preserved as fade
- [ ] Motion disabled + PropertyIndexedKeyframes format: spatial properties stripped correctly (not just Keyframe[] format)
- [ ] Replacement animation's `.finished` promise still resolves

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/tug-animator.test.ts` -- reduced-motion tests pass

---

#### Step 6: Integration Checkpoint {#step-6}

**Depends on:** #step-2, #step-3, #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] Singleton module export pattern, [D06] Reduced motion replaces spatial with opacity, (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Verify `physics.ts` exports are importable from `tug-animator.ts`
- [ ] Verify `tug-animator.ts` re-exports physics solvers
- [ ] Verify no circular dependencies between modules
- [ ] Verify all success criteria are met by the test suite

**Tests:**
- [ ] Full test suite passes end-to-end

**Checkpoint:**
- [ ] `cd tugdeck && bun test src/__tests__/tug-animator.test.ts` -- all tests pass (complete suite)
- [ ] `cd tugdeck && bunx tsc --noEmit --project tsconfig.json` -- no type errors in production code (test files are type-checked by `bun test`)
- [ ] `cd tugdeck && bun test` -- no regressions in existing tests

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** TugAnimator programmatic animation engine and physics solvers, fully tested, ready for Phase 7b migration.

#### Phase Exit Criteria ("Done means...") {#exit-criteria}

- [ ] `tugdeck/src/components/tugways/physics.ts` exists with SpringSolver, GravitySolver, FrictionSolver classes
- [ ] `tugdeck/src/components/tugways/tug-animator.ts` exists with animate(), group(), named slots, cancellation modes, token awareness, reduced-motion awareness
- [ ] `tugdeck/src/__tests__/tug-animator.test.ts` exists with comprehensive test coverage
- [ ] All tests pass: `cd tugdeck && bun test src/__tests__/tug-animator.test.ts`
- [ ] No TypeScript errors in production code: `cd tugdeck && bunx tsc --noEmit --project tsconfig.json` (test files are type-checked by `bun test`, not `tsc`)
- [ ] No regressions: `cd tugdeck && bun test`

**Acceptance tests:**
- [ ] `animate()` returns TugAnimation with working `.finished` promise
- [ ] Named slots cancel previous animation when reused
- [ ] All three cancellation modes (snap-to-end, hold-at-current, reverse-from-current) work
- [ ] Animation groups coordinate completion via `.finished`
- [ ] Spring solver produces converging keyframes with correct overshoot behavior
- [ ] Token string durations resolve correctly
- [ ] Spatial animations are replaced with opacity fades when motion is disabled

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Phase 7b: Migrate programmatic @keyframes animations to TugAnimator (flash overlay, dropdown blink, button spinner)
- [ ] Phase 7b: Implement skeleton loading states with shimmer and crossfade
- [ ] Phase 7c: Startup continuity with three-layer flash elimination
- [ ] Browser integration testing to validate WAAPI mock fidelity

| Checkpoint | Verification |
|------------|--------------|
| Physics solvers produce correct curves | `bun test src/__tests__/tug-animator.test.ts` -- SpringSolver/GravitySolver/FrictionSolver describe blocks pass |
| animate() coordinates WAAPI correctly | `bun test src/__tests__/tug-animator.test.ts` -- animate() and named slots describe blocks pass |
| Groups coordinate completion | `bun test src/__tests__/tug-animator.test.ts` -- animation groups describe block passes |
| Reduced motion works | `bun test src/__tests__/tug-animator.test.ts` -- reduced motion describe block passes |
| No regressions | `cd tugdeck && bun test` -- full test suite passes |
| Type-safe | `cd tugdeck && bunx tsc --noEmit --project tsconfig.json` -- no errors |
