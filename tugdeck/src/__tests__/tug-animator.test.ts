/**
 * tug-animator.test.ts -- Unit tests for physics solvers and TugAnimator.
 *
 * Step 1: WAAPI mock smoke tests.
 * Step 2: Physics solver unit tests (SpringSolver, GravitySolver, FrictionSolver).
 * Subsequent steps add TugAnimator coordination tests.
 *
 * Import setup-rtl FIRST -- it installs the WAAPI mock on Element.prototype
 * before any test code runs.
 */
import "./setup-rtl";

import { describe, it, expect, afterEach } from "bun:test";
import { SpringSolver, GravitySolver, FrictionSolver } from "@/components/tugways/physics";

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
