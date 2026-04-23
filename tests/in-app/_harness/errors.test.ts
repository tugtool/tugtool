/**
 * errors.test.ts — Pure-logic unit tests for the harness error
 * classes. Mirrors Spec [#s02-error-classes].
 */

import { describe, expect, test } from "bun:test";
import {
  AppCrashedError,
  TimeoutError,
  VersionSkewError,
} from "./errors";

describe("TimeoutError", () => {
  test("preserves name and optional script/timeoutMs", () => {
    const e = new TimeoutError("foo", "bar", 100);
    expect(e.name).toBe("TimeoutError");
    expect(e.message).toBe("foo");
    expect(e.script).toBe("bar");
    expect(e.timeoutMs).toBe(100);
    expect(e).toBeInstanceOf(TimeoutError);
    expect(e).toBeInstanceOf(Error);
  });

  test("defaults optional fields to undefined", () => {
    const e = new TimeoutError("msg");
    expect(e.script).toBeUndefined();
    expect(e.timeoutMs).toBeUndefined();
  });
});

describe("AppCrashedError", () => {
  test("carries exitCode and signal when provided", () => {
    const e = new AppCrashedError("died", 137, "SIGKILL");
    expect(e.name).toBe("AppCrashedError");
    expect(e.exitCode).toBe(137);
    expect(e.signal).toBe("SIGKILL");
  });

  test("accepts null exitCode / signal", () => {
    const e = new AppCrashedError("bye", null, null);
    expect(e.exitCode).toBeNull();
    expect(e.signal).toBeNull();
  });
});

describe("VersionSkewError", () => {
  test("preserves expected / actual", () => {
    const e = new VersionSkewError("x", "1.0.0", "2.0.0");
    expect(e.name).toBe("VersionSkewError");
    expect(e.expected).toBe("1.0.0");
    expect(e.actual).toBe("2.0.0");
    expect(e).toBeInstanceOf(VersionSkewError);
  });
});
