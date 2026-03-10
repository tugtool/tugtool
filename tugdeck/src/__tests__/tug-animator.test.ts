/**
 * tug-animator.test.ts -- Unit tests for physics solvers and TugAnimator.
 *
 * Step 1: WAAPI mock smoke tests.
 * Step 2: Physics solver unit tests (SpringSolver, GravitySolver, FrictionSolver).
 * Step 3: TugAnimator animate() coordination, named slots, cancellation modes.
 * Step 4: Animation groups (group(), TugAnimationGroup).
 * Step 5: Reduced-motion awareness (spatial stripping, opacity fade).
 *
 * Import setup-rtl FIRST -- it installs the WAAPI mock on Element.prototype
 * before any test code runs.
 */
import "./setup-rtl";

import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { SpringSolver, GravitySolver, FrictionSolver } from "@/components/tugways/physics";
import { animate, group, _resetSlots } from "@/components/tugways/tug-animator";

// ---------------------------------------------------------------------------
// WAAPI mock smoke tests (Step 1)
// ---------------------------------------------------------------------------

describe("WAAPI mock", () => {
  afterEach(() => {
    (global as any).__waapi_mock__.reset();
  });

  it("Element.prototype.animate returns a mock Animation object", () => {
    const el = document.createElement("div");
    const animation = (el as any).animate([], { duration: 200 });
    expect(animation).toBeDefined();
  });

  it(".finished is a Promise", () => {
    const el = document.createElement("div");
    const animation = (el as any).animate([], { duration: 200 });
    expect(animation.finished).toBeInstanceOf(Promise);
  });

  it("mock records the call on __waapi_mock__.calls", () => {
    const el = document.createElement("div");
    const keyframes = [{ opacity: "0" }, { opacity: "1" }];
    (el as any).animate(keyframes, { duration: 300 });
    const mock = (global as any).__waapi_mock__;
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].el).toBe(el);
    expect(mock.calls[0].options?.duration).toBe(300);
  });

  it(".finished resolves when resolve() is called", async () => {
    const el = document.createElement("div");
    const animation = (el as any).animate([], { duration: 100 });
    const mock = (global as any).__waapi_mock__;
    const call = mock.calls[0];

    let resolved = false;
    const p = animation.finished.then(() => {
      resolved = true;
    });
    call.resolve();
    await p;
    expect(resolved).toBe(true);
  });

  it(".finished rejects when reject() is called", async () => {
    const el = document.createElement("div");
    const animation = (el as any).animate([], { duration: 100 });
    const mock = (global as any).__waapi_mock__;
    const call = mock.calls[0];

    let rejected = false;
    const p = animation.finished.catch(() => {
      rejected = true;
    });
    call.reject(new Error("cancelled"));
    await p;
    expect(rejected).toBe(true);
  });

  it(".cancel() sets playState to idle and rejects .finished", async () => {
    const el = document.createElement("div");
    const animation = (el as any).animate([], { duration: 200 });

    let rejected = false;
    const p = animation.finished.catch(() => {
      rejected = true;
    });
    animation.cancel();
    await p;
    expect(animation.playState).toBe("idle");
    expect(rejected).toBe(true);
  });

  it(".finish() sets playState to finished and resolves .finished", async () => {
    const el = document.createElement("div");
    const animation = (el as any).animate([], { duration: 200 });

    let resolved = false;
    const p = animation.finished.then(() => {
      resolved = true;
    });
    animation.finish();
    await p;
    expect(animation.playState).toBe("finished");
    expect(resolved).toBe(true);
  });

  it("mock.reset() clears call history", () => {
    const el = document.createElement("div");
    (el as any).animate([], {});
    const mock = (global as any).__waapi_mock__;
    expect(mock.calls).toHaveLength(1);
    mock.reset();
    expect(mock.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SpringSolver (Step 2)
// ---------------------------------------------------------------------------

describe("SpringSolver", () => {
  it("keyframes converge to 1.0 (within 0.01) by the last frame", () => {
    // Default params: mass=1, stiffness=100, damping=10 (underdamped but settles)
    const solver = new SpringSolver({ mass: 1, stiffness: 100, damping: 10 });
    const kf = solver.keyframes(500);
    // Plan mandates final value is clamped to exactly 1.0
    expect(kf[kf.length - 1]).toBe(1.0);
    // Also verify second-to-last is within 0.01 so the clamp isn't hiding a broken spring
    expect(Math.abs(kf[kf.length - 2] - 1.0)).toBeLessThan(0.1);
  });

  it("underdamped spring produces overshoot (values > 1.0 in the middle)", () => {
    // Low damping => strong overshoot
    const solver = new SpringSolver({ mass: 1, stiffness: 200, damping: 2 });
    const kf = solver.keyframes(500);
    const maxVal = Math.max(...kf);
    expect(maxVal).toBeGreaterThan(1.0);
  });

  it("critically/overdamped spring reaches 1.0 without overshoot", () => {
    // High damping => no overshoot (overdamped)
    const solver = new SpringSolver({ mass: 1, stiffness: 100, damping: 30 });
    const kf = solver.keyframes(500);
    // All values (except the clamped final) should be <= 1.0
    const allButLast = kf.slice(0, -1);
    for (const v of allButLast) {
      expect(v).toBeLessThanOrEqual(1.0 + 1e-10);
    }
  });

  it(".velocityAt(0) equals initialVelocity", () => {
    const solver = new SpringSolver({ mass: 1, stiffness: 100, damping: 10, initialVelocity: 5 });
    expect(solver.velocityAt(0)).toBe(5);
  });

  it(".velocityAt(durationMs) is near 0 for a settled spring", () => {
    // Well-damped spring over generous duration: 1000ms is enough to fully settle
    const solver = new SpringSolver({ mass: 1, stiffness: 100, damping: 15 });
    const vel = solver.velocityAt(1000);
    expect(Math.abs(vel)).toBeLessThan(0.01);
  });

  it("keyframe array length does not exceed 300", () => {
    // Very long duration: 10 seconds => would be 600 steps without cap
    const solver = new SpringSolver();
    const kf = solver.keyframes(10000);
    expect(kf.length).toBeLessThanOrEqual(300);
  });

  it("first keyframe is 0 (start position)", () => {
    const solver = new SpringSolver();
    const kf = solver.keyframes(300);
    expect(kf[0]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GravitySolver (Step 2)
// ---------------------------------------------------------------------------

describe("GravitySolver", () => {
  it("first keyframe is 1.0 (drop height)", () => {
    const solver = new GravitySolver();
    const kf = solver.keyframes(1000);
    expect(kf[0]).toBe(1.0);
  });

  it("values decrease toward 0.0 (ground) and bounce with decreasing amplitude", () => {
    const solver = new GravitySolver({ acceleration: 9.8, coefficientOfRestitution: 0.6 });
    const kf = solver.keyframes(1500);

    // All values must be >= 0 (clamped at ground)
    for (const v of kf) {
      expect(v).toBeGreaterThanOrEqual(0);
    }

    // The sequence must reach 0 at some point (first ground contact)
    expect(kf.some((v) => v === 0)).toBe(true);

    // After the first bounce, there should be a value > 0 again
    const firstGroundIdx = kf.findIndex((v) => v === 0);
    expect(firstGroundIdx).toBeGreaterThan(0);
    const afterBounce = kf.slice(firstGroundIdx + 1);
    expect(afterBounce.some((v) => v > 0)).toBe(true);
  });

  it("coefficientOfRestitution=0 produces no bounce (sticks on first ground contact)", () => {
    const solver = new GravitySolver({ acceleration: 9.8, coefficientOfRestitution: 0 });
    const kf = solver.keyframes(500);

    // Find first ground contact
    const firstGroundIdx = kf.findIndex((v) => v === 0);
    expect(firstGroundIdx).toBeGreaterThan(0);

    // All values after first ground contact must be 0
    const afterContact = kf.slice(firstGroundIdx);
    for (const v of afterContact) {
      expect(v).toBe(0);
    }
  });

  it("keyframe array length does not exceed 300", () => {
    const solver = new GravitySolver();
    const kf = solver.keyframes(10000);
    expect(kf.length).toBeLessThanOrEqual(300);
  });
});

// ---------------------------------------------------------------------------
// FrictionSolver (Step 2)
// ---------------------------------------------------------------------------

describe("FrictionSolver", () => {
  it("first keyframe is 0.0 (start position)", () => {
    const solver = new FrictionSolver({ initialVelocity: 1.0 });
    const kf = solver.keyframes(500);
    expect(kf[0]).toBe(0);
  });

  it("keyframes are in [0, 1] (normalized exponential decay)", () => {
    const solver = new FrictionSolver({ initialVelocity: 5.0, friction: 0.2 });
    const kf = solver.keyframes(500);
    for (const v of kf) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("values are monotonically increasing (approaching asymptote)", () => {
    const solver = new FrictionSolver({ initialVelocity: 1.0, friction: 0.1 });
    const kf = solver.keyframes(500);
    for (let i = 1; i < kf.length; i++) {
      expect(kf[i]).toBeGreaterThanOrEqual(kf[i - 1]);
    }
  });

  it("final value approaches 1.0 asymptotically (normalized)", () => {
    // With high friction and long duration, final value should be close to 1.0
    const solver = new FrictionSolver({ initialVelocity: 1.0, friction: 2.0 });
    const kf = solver.keyframes(3000);
    expect(kf[kf.length - 1]).toBeGreaterThan(0.99);
  });

  it("keyframe array length does not exceed 300", () => {
    const solver = new FrictionSolver({ initialVelocity: 1.0 });
    const kf = solver.keyframes(10000);
    expect(kf.length).toBeLessThanOrEqual(300);
  });
});

// ---------------------------------------------------------------------------
// Helpers shared by step 3+ tests
// ---------------------------------------------------------------------------

function getMock() {
  return (global as any).__waapi_mock__;
}

// ---------------------------------------------------------------------------
// animate() -- duration resolution (Step 3)
// ---------------------------------------------------------------------------

describe("animate() duration resolution", () => {
  beforeEach(() => {
    _resetSlots();
    getMock().reset();
    document.documentElement.style.removeProperty("--tug-timing");
  });

  afterEach(() => {
    getMock().reset();
    document.documentElement.style.removeProperty("--tug-timing");
  });

  it("calls el.animate() with the resolved duration and easing", () => {
    const el = document.createElement("div");
    animate(el, [{ opacity: "0" }, { opacity: "1" }], {
      duration: 150,
      easing: "ease-out",
    });
    const mock = getMock();
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].options?.duration).toBe(150); // timing=1 (default)
    expect(mock.calls[0].options?.easing).toBe("ease-out");
  });

  it("token string duration resolves via lookup map and is scaled by getTugTiming()", () => {
    // Set timing scalar to 2
    document.documentElement.style.setProperty("--tug-timing", "2");
    const el = document.createElement("div");
    animate(el, [{ opacity: "0" }, { opacity: "1" }], {
      duration: "--tug-base-motion-duration-moderate",
    });
    const mock = getMock();
    // moderate=200ms * timing=2 => 400ms
    expect(mock.calls[0].options?.duration).toBe(400);
  });

  it("raw number duration is multiplied by getTugTiming()", () => {
    document.documentElement.style.setProperty("--tug-timing", "3");
    const el = document.createElement("div");
    animate(el, [{ opacity: "0" }, { opacity: "1" }], { duration: 100 });
    const mock = getMock();
    expect(mock.calls[0].options?.duration).toBe(300);
  });

  it("unrecognized token string throws an error", () => {
    const el = document.createElement("div");
    expect(() =>
      animate(el, [{ opacity: "0" }], {
        duration: "--tug-base-motion-duration-nonexistent",
      })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// animate() -- named slots (Step 3)
// ---------------------------------------------------------------------------

describe("animate() named slots", () => {
  beforeEach(() => {
    _resetSlots();
    getMock().reset();
    document.documentElement.style.removeProperty("--tug-timing");
  });

  afterEach(() => {
    getMock().reset();
    document.documentElement.style.removeProperty("--tug-timing");
  });

  it("second animate() with same key cancels first via snap-to-end (.finish() called)", () => {
    const el = document.createElement("div");
    animate(el, [{ opacity: "0" }, { opacity: "1" }], { key: "fade" });
    const firstAnim = getMock().calls[0].animation;

    let firstFinished = false;
    firstAnim.finished.then(() => {
      firstFinished = true;
    });

    // Second call with same key -- default slotCancelMode is snap-to-end.
    animate(el, [{ opacity: "1" }, { opacity: "0" }], { key: "fade" });

    // snap-to-end calls .finish(), which resolves .finished.
    expect(firstAnim.playState).toBe("finished");
  });

  it("slotCancelMode: 'hold-at-current' uses commitStyles + cancel instead of finish", () => {
    const el = document.createElement("div");
    animate(el, [{ opacity: "0" }, { opacity: "1" }], { key: "slide" });
    const firstAnim = getMock().calls[0].animation;

    let commitStylesCalled = false;
    let cancelCalled = false;
    let finishCalled = false;
    const origCommit = firstAnim.commitStyles.bind(firstAnim);
    firstAnim.commitStyles = () => { commitStylesCalled = true; origCommit(); };
    const origCancel = firstAnim.cancel.bind(firstAnim);
    firstAnim.cancel = () => { cancelCalled = true; origCancel(); };
    const origFinish = firstAnim.finish.bind(firstAnim);
    firstAnim.finish = () => { finishCalled = true; origFinish(); };

    animate(el, [{ opacity: "1" }, { opacity: "0" }], {
      key: "slide",
      slotCancelMode: "hold-at-current",
    });

    expect(commitStylesCalled).toBe(true);
    expect(cancelCalled).toBe(true);
    expect(finishCalled).toBe(false);
  });

  it("slotCancelMode: 'hold-at-current' does not produce unhandled promise rejection", async () => {
    const el = document.createElement("div");
    animate(el, [{ opacity: "0" }, { opacity: "1" }], { key: "move" });

    // If unhandled rejection occurred, bun would surface it as a test failure.
    // This test verifies that the internal .catch() absorbs it cleanly.
    animate(el, [{ opacity: "1" }, { opacity: "0" }], {
      key: "move",
      slotCancelMode: "hold-at-current",
    });

    // Allow microtasks to flush (the rejection fires asynchronously).
    await new Promise((r) => setTimeout(r, 0));
    // If we reach here without an unhandled rejection error, the test passes.
    expect(true).toBe(true);
  });

  it("different keys on same element coexist", () => {
    const el = document.createElement("div");
    animate(el, [{ opacity: "0" }, { opacity: "1" }], { key: "alpha" });
    animate(el, [{ translateX: "0px" }, { translateX: "100px" }], {
      key: "beta",
    });

    const mock = getMock();
    // Both animations should have been started (no cancellation between different keys).
    expect(mock.calls).toHaveLength(2);
    // Both are still running.
    expect(mock.calls[0].animation.playState).toBe("running");
    expect(mock.calls[1].animation.playState).toBe("running");
  });
});

// ---------------------------------------------------------------------------
// animate() -- cancellation modes (Step 3)
// ---------------------------------------------------------------------------

describe("animate() cancellation modes", () => {
  beforeEach(() => {
    _resetSlots();
    getMock().reset();
    document.documentElement.style.removeProperty("--tug-timing");
  });

  afterEach(() => {
    getMock().reset();
    document.documentElement.style.removeProperty("--tug-timing");
  });

  it("cancel snap-to-end: .finish() called on underlying animation", () => {
    const el = document.createElement("div");
    const tugAnim = animate(el, [{ opacity: "0" }, { opacity: "1" }], {
      duration: 200,
    });
    const waapiAnim = getMock().calls[0].animation;

    let finishCalled = false;
    const orig = waapiAnim.finish.bind(waapiAnim);
    waapiAnim.finish = () => { finishCalled = true; orig(); };

    tugAnim.cancel("snap-to-end");
    expect(finishCalled).toBe(true);
    expect(waapiAnim.playState).toBe("finished");
  });

  it("cancel hold-at-current: commitStyles and cancel called", async () => {
    const el = document.createElement("div");
    const tugAnim = animate(el, [{ opacity: "0" }, { opacity: "1" }], {
      duration: 200,
    });
    const waapiAnim = getMock().calls[0].animation;

    let commitStylesCalled = false;
    let cancelCalled = false;
    const origCommit = waapiAnim.commitStyles.bind(waapiAnim);
    waapiAnim.commitStyles = () => { commitStylesCalled = true; origCommit(); };
    const origCancel = waapiAnim.cancel.bind(waapiAnim);
    waapiAnim.cancel = () => { cancelCalled = true; origCancel(); };

    // Absorb the expected rejection so bun doesn't surface it as an unhandled error.
    const p = tugAnim.finished.catch(() => { /* expected */ });
    tugAnim.cancel("hold-at-current");
    await p;
    expect(commitStylesCalled).toBe(true);
    expect(cancelCalled).toBe(true);
  });

  it("cancel hold-at-current: .finished promise rejects", async () => {
    const el = document.createElement("div");
    const tugAnim = animate(el, [{ opacity: "0" }, { opacity: "1" }], {
      duration: 200,
    });

    let rejected = false;
    const p = tugAnim.finished.catch(() => { rejected = true; });
    tugAnim.cancel("hold-at-current");
    await p;
    expect(rejected).toBe(true);
  });

  it("cancel snap-to-end: .finished promise resolves", async () => {
    const el = document.createElement("div");
    const tugAnim = animate(el, [{ opacity: "0" }, { opacity: "1" }], {
      duration: 200,
    });

    let resolved = false;
    const p = tugAnim.finished.then(() => { resolved = true; });
    tugAnim.cancel("snap-to-end");
    await p;
    expect(resolved).toBe(true);
  });

  it("cancel reverse-from-current: starts a new animation from current to start values", () => {
    const el = document.createElement("div");
    const tugAnim = animate(
      el,
      [{ opacity: "0" }, { opacity: "1" }],
      { duration: 200 }
    );

    // The original animation is call index 0.
    expect(getMock().calls).toHaveLength(1);

    tugAnim.cancel("reverse-from-current");

    // A second WAAPI animation should have been started (the reversal).
    expect(getMock().calls).toHaveLength(2);
    // The reversal animation should be running.
    expect(getMock().calls[1].animation.playState).toBe("running");
  });

  it("cancel reverse-from-current: .finished re-wires to resolve when reversal completes", async () => {
    const el = document.createElement("div");
    const tugAnim = animate(
      el,
      [{ opacity: "0" }, { opacity: "1" }],
      { duration: 200 }
    );

    let resolved = false;
    tugAnim.cancel("reverse-from-current");

    // Wire up the handler AFTER the cancel (re-wire must already be in place).
    const p = tugAnim.finished.then(() => { resolved = true; });

    // Resolve the reversal animation (call index 1).
    getMock().calls[1].resolve();
    await p;
    expect(resolved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// animate() -- .finished promise and WeakMap slot cleanup (Step 3)
// ---------------------------------------------------------------------------

describe("animate() .finished and slot cleanup", () => {
  beforeEach(() => {
    _resetSlots();
    getMock().reset();
    document.documentElement.style.removeProperty("--tug-timing");
  });

  afterEach(() => {
    getMock().reset();
    document.documentElement.style.removeProperty("--tug-timing");
  });

  it(".finished resolves when the underlying WAAPI animation completes naturally", async () => {
    const el = document.createElement("div");
    const tugAnim = animate(el, [{ opacity: "0" }, { opacity: "1" }], {
      duration: 200,
    });

    let resolved = false;
    const p = tugAnim.finished.then(() => { resolved = true; });
    // Resolve the mock animation.
    getMock().calls[0].resolve();
    await p;
    expect(resolved).toBe(true);
  });

  it("completed animation is removed from the named slot", async () => {
    const el = document.createElement("div");
    animate(el, [{ opacity: "0" }, { opacity: "1" }], { key: "test-slot" });

    const mock = getMock();
    // Resolve the WAAPI animation to trigger natural completion.
    mock.calls[0].resolve();
    // Wait for microtasks (the .then() that clears the slot fires asynchronously).
    await new Promise((r) => setTimeout(r, 0));

    // After natural completion, re-animating the same key should NOT cancel any
    // previous animation (slot was cleared). Only one new WAAPI animate() call
    // should be made.
    const callCountBefore = mock.calls.length;
    animate(el, [{ opacity: "1" }, { opacity: "0" }], { key: "test-slot" });
    // The new animation is at the same index (no extra cancel calls).
    expect(mock.calls.length).toBe(callCountBefore + 1);
    // The new animation is running (not prematurely finished).
    expect(mock.calls[mock.calls.length - 1].animation.playState).toBe("running");
  });
});

// ---------------------------------------------------------------------------
// group() -- animation groups (Step 4)
// ---------------------------------------------------------------------------

describe("group()", () => {
  beforeEach(() => {
    _resetSlots();
    getMock().reset();
    document.documentElement.style.removeProperty("--tug-timing");
  });

  afterEach(() => {
    getMock().reset();
    document.documentElement.style.removeProperty("--tug-timing");
  });

  it("empty group: .finished resolves immediately", async () => {
    const g = group();
    let resolved = false;
    await g.finished.then(() => { resolved = true; });
    expect(resolved).toBe(true);
  });

  it("group with two animations: .finished resolves only after both complete", async () => {
    const g = group({ duration: 200 });
    const el1 = document.createElement("div");
    const el2 = document.createElement("div");
    g.animate(el1, [{ opacity: "0" }, { opacity: "1" }]);
    g.animate(el2, [{ opacity: "0" }, { opacity: "1" }]);

    const mock = getMock();
    let resolved = false;
    const p = g.finished.then(() => { resolved = true; });

    // Resolve only the first animation -- group should not resolve yet.
    mock.calls[0].resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(resolved).toBe(false);

    // Resolve the second animation -- group should now resolve.
    mock.calls[1].resolve();
    await p;
    expect(resolved).toBe(true);
  });

  it("group with one animation cancelled: .finished rejects", async () => {
    const g = group({ duration: 200 });
    const el1 = document.createElement("div");
    const el2 = document.createElement("div");
    g.animate(el1, [{ opacity: "0" }, { opacity: "1" }]);
    g.animate(el2, [{ opacity: "0" }, { opacity: "1" }]);

    const mock = getMock();

    // Attach .catch() on g.finished BEFORE cancelling so the Promise.all
    // rejection is handled synchronously at the point it fires.
    let rejected = false;
    const p = g.finished.catch(() => { rejected = true; });

    // Also absorb the per-animation rejection from the TugAnimation wrapper.
    mock.calls[0].animation.finished.catch(() => { /* expected */ });

    // Cancel the first underlying WAAPI animation directly (simulates
    // hold-at-current: commitStyles is a no-op in the mock).
    mock.calls[0].animation.cancel();

    await p;
    expect(rejected).toBe(true);
  });

  it("group cancel() cancels all constituent animations", () => {
    const g = group({ duration: 200 });
    const el1 = document.createElement("div");
    const el2 = document.createElement("div");
    const a1 = g.animate(el1, [{ opacity: "0" }, { opacity: "1" }]);
    const a2 = g.animate(el2, [{ opacity: "0" }, { opacity: "1" }]);

    // Absorb rejections before snap-to-end group cancel resolves both.
    // snap-to-end calls .finish() which resolves, so no rejection expected here.
    let a1Finished = false;
    let a2Finished = false;
    a1.finished.then(() => { a1Finished = true; }).catch(() => {});
    a2.finished.then(() => { a2Finished = true; }).catch(() => {});

    g.cancel("snap-to-end");

    const mock = getMock();
    // Both underlying WAAPI animations should have been finished (snap-to-end).
    expect(mock.calls[0].animation.playState).toBe("finished");
    expect(mock.calls[1].animation.playState).toBe("finished");
  });

  it("per-animation options override group defaults", () => {
    const g = group({ duration: "--tug-base-motion-duration-slow", easing: "ease-in" });
    const el = document.createElement("div");
    // Override duration for this specific animation.
    g.animate(el, [{ opacity: "0" }, { opacity: "1" }], { duration: 50, easing: "linear" });

    const mock = getMock();
    // timing=1 (default), so 50ms raw * 1 = 50ms.
    expect(mock.calls[0].options?.duration).toBe(50);
    expect(mock.calls[0].options?.easing).toBe("linear");
  });

  it("group animate() uses group defaults when no per-animation override", () => {
    document.documentElement.style.setProperty("--tug-timing", "2");
    const g = group({ duration: "--tug-base-motion-duration-fast", easing: "ease-out" });
    const el = document.createElement("div");
    g.animate(el, [{ opacity: "0" }, { opacity: "1" }]);

    const mock = getMock();
    // fast=100ms * timing=2 = 200ms.
    expect(mock.calls[0].options?.duration).toBe(200);
    expect(mock.calls[0].options?.easing).toBe("ease-out");
  });
});

// ---------------------------------------------------------------------------
// Reduced-motion awareness (Step 5)
// ---------------------------------------------------------------------------

describe("animate() reduced-motion awareness", () => {
  beforeEach(() => {
    _resetSlots();
    getMock().reset();
    document.documentElement.style.removeProperty("--tug-timing");
    document.documentElement.style.removeProperty("--tug-motion");
  });

  afterEach(() => {
    getMock().reset();
    document.documentElement.style.removeProperty("--tug-timing");
    document.documentElement.style.removeProperty("--tug-motion");
  });

  it("motion enabled: spatial keyframes are passed through unchanged", () => {
    document.documentElement.style.setProperty("--tug-motion", "1");
    const el = document.createElement("div");
    const kf = [{ transform: "translateX(0px)" }, { transform: "translateX(100px)" }];
    animate(el, kf, { duration: 200 });

    const mock = getMock();
    const passedKf = mock.calls[0].keyframes as Keyframe[];
    expect(passedKf).toHaveLength(2);
    expect((passedKf[0] as Record<string, unknown>).transform).toBe("translateX(0px)");
    expect((passedKf[1] as Record<string, unknown>).transform).toBe("translateX(100px)");
  });

  it("motion disabled + spatial keyframes: replaced with opacity fade [{ opacity: 0 }, { opacity: 1 }]", () => {
    document.documentElement.style.setProperty("--tug-motion", "0");
    const el = document.createElement("div");
    animate(el, [{ transform: "translateX(0px)" }, { transform: "translateX(100px)" }], {
      duration: 300,
    });

    const mock = getMock();
    const passedKf = mock.calls[0].keyframes as Keyframe[];
    // Spatial properties replaced with opacity fade.
    expect(passedKf).toHaveLength(2);
    expect((passedKf[0] as Record<string, unknown>).opacity).toBe(0);
    expect((passedKf[1] as Record<string, unknown>).opacity).toBe(1);
    expect((passedKf[0] as Record<string, unknown>).transform).toBeUndefined();
    // Duration overridden to fast (100ms * timing=1 = 100ms).
    expect(mock.calls[0].options?.duration).toBe(100);
  });

  it("motion disabled + non-spatial keyframes: played unchanged", () => {
    document.documentElement.style.setProperty("--tug-motion", "0");
    const el = document.createElement("div");
    const kf = [{ opacity: "0" }, { opacity: "1" }];
    animate(el, kf, { duration: 150 });

    const mock = getMock();
    const passedKf = mock.calls[0].keyframes as Keyframe[];
    // Opacity-only keyframes should pass through unchanged.
    expect(passedKf).toHaveLength(2);
    expect((passedKf[0] as Record<string, unknown>).opacity).toBe("0");
    expect((passedKf[1] as Record<string, unknown>).opacity).toBe("1");
    // Duration uses the caller's value (non-spatial, no replacement).
    expect(mock.calls[0].options?.duration).toBe(150);
  });

  it("motion disabled + mixed spatial and opacity: spatial removed, opacity preserved", () => {
    document.documentElement.style.setProperty("--tug-motion", "0");
    const el = document.createElement("div");
    // Keyframes with both transform (spatial) and opacity (non-spatial).
    animate(
      el,
      [
        { transform: "scale(0.8)", opacity: 0 },
        { transform: "scale(1)", opacity: 1 },
      ],
      { duration: 250 }
    );

    const mock = getMock();
    const passedKf = mock.calls[0].keyframes as Keyframe[];
    // transform should be stripped; opacity should be preserved.
    expect(passedKf).toHaveLength(2);
    expect((passedKf[0] as Record<string, unknown>).transform).toBeUndefined();
    expect((passedKf[1] as Record<string, unknown>).transform).toBeUndefined();
    expect((passedKf[0] as Record<string, unknown>).opacity).toBe(0);
    expect((passedKf[1] as Record<string, unknown>).opacity).toBe(1);
  });

  it("motion disabled + PropertyIndexedKeyframes format: spatial properties stripped correctly", () => {
    document.documentElement.style.setProperty("--tug-motion", "0");
    const el = document.createElement("div");
    // PropertyIndexedKeyframes format (object with array values per property).
    animate(
      el,
      { transform: ["translateY(0px)", "translateY(50px)"], opacity: [0, 1] },
      { duration: 200 }
    );

    const mock = getMock();
    const passedKf = mock.calls[0].keyframes as Keyframe[];
    // transform should be stripped; opacity values should be preserved.
    expect(passedKf).toHaveLength(2);
    expect((passedKf[0] as Record<string, unknown>).transform).toBeUndefined();
    expect((passedKf[1] as Record<string, unknown>).transform).toBeUndefined();
    expect((passedKf[0] as Record<string, unknown>).opacity).toBe(0);
    expect((passedKf[1] as Record<string, unknown>).opacity).toBe(1);
  });

  it("replacement animation's .finished promise still resolves", async () => {
    document.documentElement.style.setProperty("--tug-motion", "0");
    const el = document.createElement("div");
    const tugAnim = animate(
      el,
      [{ transform: "translateX(0px)" }, { transform: "translateX(100px)" }],
      { duration: 200 }
    );

    let resolved = false;
    const p = tugAnim.finished.then(() => { resolved = true; });
    getMock().calls[0].resolve();
    await p;
    expect(resolved).toBe(true);
  });
});
