/**
 * usePropertyStore hook unit tests -- Step 2.
 *
 * Tests cover:
 * - usePropertyStore creates a PropertyStore with the provided schema and
 *   initial values
 * - usePropertyStore calls the context callback with the store instance
 *
 * Uses @testing-library/react renderHook with a context wrapper to simulate
 * the TugcardPropertyContext registration pattern.
 */

import "./setup-rtl";
import { describe, it, expect, mock } from "bun:test";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { usePropertyStore, TugcardPropertyContext } from "@/components/tugways/hooks/use-property-store";
import type { PropertyDescriptor } from "@/components/tugways/property-store";
import { PropertyStore } from "@/components/tugways/property-store";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCHEMA: PropertyDescriptor[] = [
  {
    path: "style.backgroundColor",
    type: "color",
    label: "Background Color",
  },
  {
    path: "style.fontSize",
    type: "number",
    label: "Font Size",
    min: 8,
    max: 72,
  },
];

const INITIAL_VALUES = {
  "style.backgroundColor": "#4f8ef7",
  "style.fontSize": 16,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("usePropertyStore – store creation", () => {
  it("creates a PropertyStore with the provided schema and initial values", () => {
    const { result } = renderHook(() =>
      usePropertyStore({ schema: SCHEMA, initialValues: INITIAL_VALUES })
    );

    const store = result.current;
    expect(store).toBeInstanceOf(PropertyStore);
    expect(store.get("style.backgroundColor")).toBe("#4f8ef7");
    expect(store.get("style.fontSize")).toBe(16);
  });

  it("returns a stable store reference across re-renders", () => {
    const { result, rerender } = renderHook(() =>
      usePropertyStore({ schema: SCHEMA, initialValues: INITIAL_VALUES })
    );

    const firstRef = result.current;
    rerender();
    const secondRef = result.current;

    // Same reference -- store is created once in useRef
    expect(firstRef).toBe(secondRef);
  });

  it("store schema matches the provided descriptors", () => {
    const { result } = renderHook(() =>
      usePropertyStore({ schema: SCHEMA, initialValues: INITIAL_VALUES })
    );

    const schema = result.current.getSchema();
    const paths = schema.paths.map((d) => d.path);
    expect(paths).toContain("style.backgroundColor");
    expect(paths).toContain("style.fontSize");
    expect(schema.paths).toHaveLength(2);
  });
});

describe("usePropertyStore – context registration", () => {
  it("calls the context callback with the store instance", () => {
    const registrar = mock((_store: PropertyStore) => {});

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(TugcardPropertyContext, { value: registrar }, children);

    const { result } = renderHook(
      () => usePropertyStore({ schema: SCHEMA, initialValues: INITIAL_VALUES }),
      { wrapper }
    );

    // The registrar should have been called once during useLayoutEffect
    expect(registrar).toHaveBeenCalledTimes(1);
    // It should have been called with the store instance returned by the hook
    expect(registrar).toHaveBeenCalledWith(result.current);
  });

  it("works without a context (outside Tugcard) without throwing", () => {
    // No wrapper -- TugcardPropertyContext has a null default
    expect(() => {
      renderHook(() =>
        usePropertyStore({ schema: SCHEMA, initialValues: INITIAL_VALUES })
      );
    }).not.toThrow();
  });

  it("does not call the registrar when context is null", () => {
    // Explicitly provide null context value
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(TugcardPropertyContext, { value: null }, children);

    const registrar = mock((_store: PropertyStore) => {});

    // Render without a registrar -- the hook should silently skip registration
    const { result } = renderHook(
      () => usePropertyStore({ schema: SCHEMA, initialValues: INITIAL_VALUES }),
      { wrapper }
    );

    // Store still created and functional
    expect(result.current).toBeInstanceOf(PropertyStore);
    // registrar should NOT be called (it was never passed to the context)
    expect(registrar).not.toHaveBeenCalled();
  });
});

describe("usePropertyStore – store functionality", () => {
  it("store returned by hook can get/set/observe values", () => {
    const { result } = renderHook(() =>
      usePropertyStore({ schema: SCHEMA, initialValues: INITIAL_VALUES })
    );

    const store = result.current;
    const changes: unknown[] = [];
    store.observe("style.fontSize", () => changes.push(store.get("style.fontSize")));

    act(() => {
      store.set("style.fontSize", 32, "test");
    });

    expect(store.get("style.fontSize")).toBe(32);
    expect(changes).toHaveLength(1);
  });
});
