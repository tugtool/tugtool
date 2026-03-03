/**
 * useTugcardData hook tests -- Step 2.
 *
 * Tests cover:
 * - T06: useTugcardData returns null when rendered outside TugcardDataProvider
 * - T07: useTugcardData (map overload) returns non-null when provider has populated data
 * - T08: useTugcardData returns null when feedData map is empty (feedless card)
 * - T09: useTugcardData<T>() typed overload returns the first feed entry's decoded value
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect } from "bun:test";
import { render, act } from "@testing-library/react";

import {
  TugcardDataContext,
  TugcardDataProvider,
  useTugcardData,
} from "@/components/tugways/hooks/use-tugcard-data";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Captures the return value of useTugcardData via a ref so tests can
 * inspect it outside of render without triggering re-renders themselves.
 */
function DataCapture({ captureRef }: { captureRef: React.MutableRefObject<unknown> }) {
  const data = useTugcardData();
  captureRef.current = data;
  return null;
}

// ---------------------------------------------------------------------------
// T06: outside TugcardDataProvider returns null
// ---------------------------------------------------------------------------

describe("useTugcardData – outside provider", () => {
  it("T06: returns null when rendered outside TugcardDataProvider", () => {
    const ref = { current: "not-yet-set" as unknown };

    act(() => {
      render(<DataCapture captureRef={ref} />);
    });

    expect(ref.current).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T07: inside TugcardDataProvider with populated data (map overload)
// ---------------------------------------------------------------------------

describe("useTugcardData – inside provider with data", () => {
  it("T07: returns non-null when rendered inside TugcardDataProvider with populated data", () => {
    const ref = { current: "not-yet-set" as unknown };
    const payload = { text: "hello" };
    const feedData = new Map<number, unknown>([[1, payload]]);

    act(() => {
      render(
        <TugcardDataProvider feedData={feedData}>
          <DataCapture captureRef={ref} />
        </TugcardDataProvider>
      );
    });

    // The hook returns the first entry's decoded value (not the map itself)
    expect(ref.current).not.toBeNull();
    expect(ref.current).toBe(payload);
  });
});

// ---------------------------------------------------------------------------
// T09: typed overload returns the first feed entry's decoded value
// ---------------------------------------------------------------------------

describe("useTugcardData – typed overload", () => {
  it("T09: useTugcardData<T>() returns the first feed entry's decoded value typed as T", () => {
    interface Payload { text: string }
    const ref = { current: "not-yet-set" as unknown };
    const payload: Payload = { text: "typed-value" };
    const feedData = new Map<number, unknown>([[1, payload]]);

    function TypedCapture({ captureRef }: { captureRef: React.MutableRefObject<unknown> }) {
      const data = useTugcardData<Payload>();
      captureRef.current = data;
      return null;
    }

    act(() => {
      render(
        <TugcardDataProvider feedData={feedData}>
          <TypedCapture captureRef={ref} />
        </TugcardDataProvider>
      );
    });

    expect(ref.current).not.toBeNull();
    // Must be the decoded value itself, not the Map
    expect(ref.current).toBe(payload);
    expect((ref.current as Payload).text).toBe("typed-value");
    // Must NOT be the Map
    expect(ref.current instanceof Map).toBe(false);
  });

  it("typed overload returns null when feedData is empty", () => {
    const ref = { current: "not-yet-set" as unknown };

    function TypedCapture({ captureRef }: { captureRef: React.MutableRefObject<unknown> }) {
      const data = useTugcardData<{ text: string }>();
      captureRef.current = data;
      return null;
    }

    act(() => {
      render(
        <TugcardDataProvider feedData={new Map()}>
          <TypedCapture captureRef={ref} />
        </TugcardDataProvider>
      );
    });

    expect(ref.current).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T08: feedless card (empty map) returns null
// ---------------------------------------------------------------------------

describe("useTugcardData – empty feedData map", () => {
  it("T08: returns null when feedData map is empty (feedless card)", () => {
    const ref = { current: "not-yet-set" as unknown };
    const emptyMap = new Map<number, unknown>();

    act(() => {
      render(
        <TugcardDataProvider feedData={emptyMap}>
          <DataCapture captureRef={ref} />
        </TugcardDataProvider>
      );
    });

    expect(ref.current).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Extra: context default value is null
// ---------------------------------------------------------------------------

describe("TugcardDataContext – default value", () => {
  it("default context value is null", () => {
    // Consuming the context without any provider should yield null
    const ref = { current: "not-yet-set" as unknown };

    function RawContextConsumer() {
      const value = React.useContext(TugcardDataContext);
      ref.current = value;
      return null;
    }

    act(() => {
      render(<RawContextConsumer />);
    });

    expect(ref.current).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Extra: TugcardDataProvider is internal -- not re-exported from barrel
// ---------------------------------------------------------------------------

describe("TugcardDataProvider – wraps children with context", () => {
  it("children rendered inside TugcardDataProvider can access feedData via context", () => {
    const ref = { current: "not-yet-set" as unknown };
    const feedData = new Map<number, unknown>([[7, "seven"]]);

    function DirectContextConsumer() {
      const ctx = React.useContext(TugcardDataContext);
      ref.current = ctx;
      return null;
    }

    act(() => {
      render(
        <TugcardDataProvider feedData={feedData}>
          <DirectContextConsumer />
        </TugcardDataProvider>
      );
    });

    expect(ref.current).not.toBeNull();
    const ctx = ref.current as { feedData: Map<number, unknown> };
    expect(ctx.feedData).toBe(feedData);
  });
});

