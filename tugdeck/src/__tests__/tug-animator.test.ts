/**
 * tug-animator.test.ts -- Unit tests for physics solvers and TugAnimator.
 *
 * Step 1: WAAPI mock smoke tests.
 * Subsequent steps add physics solver and TugAnimator coordination tests.
 *
 * Import setup-rtl FIRST -- it installs the WAAPI mock on Element.prototype
 * before any test code runs.
 */
import "./setup-rtl";

import { describe, it, expect, afterEach } from "bun:test";

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
