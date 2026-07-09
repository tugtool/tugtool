/**
 * card-close-guard.test.ts — the per-card close-guard registry: register,
 * resolve, and release ([L27]).
 */

import { describe, test, expect } from "bun:test";
import {
  registerCardCloseGuard,
  getCardCloseGuard,
} from "@/lib/card-close-guard";

describe("card close guard registry", () => {
  test("resolves the registered guard and releases it", () => {
    const guard = async () => "close" as const;
    expect(getCardCloseGuard("c1")).toBeNull();

    const release = registerCardCloseGuard("c1", guard);
    expect(getCardCloseGuard("c1")).toBe(guard);

    release();
    expect(getCardCloseGuard("c1")).toBeNull();
  });

  test("a re-registration replaces the prior guard and owns the slot", () => {
    const first = async () => "cancel" as const;
    const second = async () => "close" as const;
    const releaseFirst = registerCardCloseGuard("c2", first);
    const releaseSecond = registerCardCloseGuard("c2", second);
    expect(getCardCloseGuard("c2")).toBe(second);

    // The stale first release must NOT evict the second guard.
    releaseFirst();
    expect(getCardCloseGuard("c2")).toBe(second);

    releaseSecond();
    expect(getCardCloseGuard("c2")).toBeNull();
  });

  test("guards for distinct cards are independent", () => {
    const a = async () => "close" as const;
    const b = async () => "cancel" as const;
    const releaseA = registerCardCloseGuard("cA", a);
    const releaseB = registerCardCloseGuard("cB", b);
    expect(getCardCloseGuard("cA")).toBe(a);
    expect(getCardCloseGuard("cB")).toBe(b);
    releaseA();
    releaseB();
  });
});
