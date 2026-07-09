import { describe, expect, it } from "bun:test";

import {
  allocateUntitledNumber,
  formatUntitledName,
  reserveUntitledNumber,
} from "../untitled-naming";

describe("formatUntitledName", () => {
  it("names the first buffer 'Untitled' and numbers the rest", () => {
    expect(formatUntitledName(1)).toBe("Untitled");
    expect(formatUntitledName(2)).toBe("Untitled-2");
    expect(formatUntitledName(7)).toBe("Untitled-7");
  });

  it("degrades a missing/invalid number to the bare name", () => {
    expect(formatUntitledName(null)).toBe("Untitled");
    expect(formatUntitledName(undefined)).toBe("Untitled");
    expect(formatUntitledName(0)).toBe("Untitled");
  });
});

describe("allocateUntitledNumber", () => {
  it("hands out a strictly increasing run", () => {
    const a = allocateUntitledNumber();
    const b = allocateUntitledNumber();
    const c = allocateUntitledNumber();
    expect(b).toBe(a + 1);
    expect(c).toBe(b + 1);
  });

  it("never reissues a reserved (restored) number", () => {
    const next = allocateUntitledNumber();
    // A restore replays a number far above the live counter.
    reserveUntitledNumber(next + 100);
    expect(allocateUntitledNumber()).toBe(next + 101);
  });

  it("ignores a reservation at or below the current floor", () => {
    const next = allocateUntitledNumber();
    reserveUntitledNumber(1);
    reserveUntitledNumber(next - 1);
    expect(allocateUntitledNumber()).toBe(next + 1);
  });
});
