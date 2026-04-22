/**
 * useCardPropertyStore hook unit tests.
 *
 * Host-side hook that owns the ref a card's PropertyStore registers into.
 * These tests exercise the hook in isolation via a minimal host that
 * simulates the registration handshake.
 */
import "./setup-rtl";

import { describe, it, expect } from "bun:test";
import { renderHook } from "@testing-library/react";

import { useCardPropertyStore } from "@/components/tugways/hooks/use-card-property-store";
import { PropertyStore } from "@/components/tugways/property-store";

describe("useCardPropertyStore", () => {
  it("returns a null ref before any registration", () => {
    const { result } = renderHook(() => useCardPropertyStore());
    expect(result.current.ref.current).toBeNull();
  });

  it("populates ref.current when register is called", () => {
    const { result } = renderHook(() => useCardPropertyStore());
    const store = new PropertyStore({ schema: [], initialValues: {} });
    result.current.register(store);
    expect(result.current.ref.current).toBe(store);
  });

  it("keeps register stable across re-renders", () => {
    const { result, rerender } = renderHook(() => useCardPropertyStore());
    const firstRegister = result.current.register;
    rerender();
    expect(result.current.register).toBe(firstRegister);
  });

  it("keeps ref identity stable across re-renders", () => {
    const { result, rerender } = renderHook(() => useCardPropertyStore());
    const firstRef = result.current.ref;
    rerender();
    expect(result.current.ref).toBe(firstRef);
  });

  it("overwrites ref.current on subsequent register calls", () => {
    const { result } = renderHook(() => useCardPropertyStore());
    const a = new PropertyStore({ schema: [], initialValues: {} });
    const b = new PropertyStore({ schema: [], initialValues: {} });
    result.current.register(a);
    expect(result.current.ref.current).toBe(a);
    result.current.register(b);
    expect(result.current.ref.current).toBe(b);
  });
});
