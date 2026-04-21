/**
 * useCardData hook tests.
 *
 * Tests cover:
 * - T06: useCardData returns null when rendered outside CardDataProvider
 * - T07: useCardData (map overload) returns non-null when provider has populated data
 * - T08: useCardData returns null when feedData map is empty (feedless card)
 * - T09: useCardData<T>() typed overload returns the first feed entry's decoded value
 *
 * Note: setup-rtl MUST be the first import (required for all RTL test files).
 */
import "./setup-rtl";

import React from "react";
import { describe, it, expect } from "bun:test";
import { render, act } from "@testing-library/react";

import {
  CardDataContext,
  CardDataProvider,
  useCardData,
} from "@/components/tugways/hooks/use-card-data";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Captures the return value of useCardData via a ref so tests can
 * inspect it outside of render without triggering re-renders themselves.
 */
function DataCapture({ captureRef }: { captureRef: React.MutableRefObject<unknown> }) {
  const data = useCardData();
  captureRef.current = data;
  return null;
}

// ---------------------------------------------------------------------------
// T06: outside CardDataProvider returns null
// ---------------------------------------------------------------------------

describe("useCardData – outside provider", () => {
  it("T06: returns null when rendered outside CardDataProvider", () => {
    const ref = { current: "not-yet-set" as unknown };

    act(() => {
      render(<DataCapture captureRef={ref} />);
    });

    expect(ref.current).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T07: inside CardDataProvider with populated data (map overload)
// ---------------------------------------------------------------------------

describe("useCardData – inside provider with data", () => {
  it("T07: returns non-null when rendered inside CardDataProvider with populated data", () => {
    const ref = { current: "not-yet-set" as unknown };
    const payload = { text: "hello" };
    const feedData = new Map<number, unknown>([[1, payload]]);

    act(() => {
      render(
        <CardDataProvider feedData={feedData}>
          <DataCapture captureRef={ref} />
        </CardDataProvider>
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

describe("useCardData – typed overload", () => {
  it("T09: useCardData<T>() returns the first feed entry's decoded value typed as T", () => {
    interface Payload { text: string }
    const ref = { current: "not-yet-set" as unknown };
    const payload: Payload = { text: "typed-value" };
    const feedData = new Map<number, unknown>([[1, payload]]);

    function TypedCapture({ captureRef }: { captureRef: React.MutableRefObject<unknown> }) {
      const data = useCardData<Payload>();
      captureRef.current = data;
      return null;
    }

    act(() => {
      render(
        <CardDataProvider feedData={feedData}>
          <TypedCapture captureRef={ref} />
        </CardDataProvider>
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
      const data = useCardData<{ text: string }>();
      captureRef.current = data;
      return null;
    }

    act(() => {
      render(
        <CardDataProvider feedData={new Map()}>
          <TypedCapture captureRef={ref} />
        </CardDataProvider>
      );
    });

    expect(ref.current).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T08: feedless card (empty map) returns null
// ---------------------------------------------------------------------------

describe("useCardData – empty feedData map", () => {
  it("T08: returns null when feedData map is empty (feedless card)", () => {
    const ref = { current: "not-yet-set" as unknown };
    const emptyMap = new Map<number, unknown>();

    act(() => {
      render(
        <CardDataProvider feedData={emptyMap}>
          <DataCapture captureRef={ref} />
        </CardDataProvider>
      );
    });

    expect(ref.current).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Extra: context default value is null
// ---------------------------------------------------------------------------

describe("CardDataContext – default value", () => {
  it("default context value is null", () => {
    // Consuming the context without any provider should yield null
    const ref = { current: "not-yet-set" as unknown };

    function RawContextConsumer() {
      const value = React.useContext(CardDataContext);
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
// Extra: CardDataProvider is internal -- not re-exported from barrel
// ---------------------------------------------------------------------------

describe("CardDataProvider – wraps children with context", () => {
  it("children rendered inside CardDataProvider can access feedData via context", () => {
    const ref = { current: "not-yet-set" as unknown };
    const feedData = new Map<number, unknown>([[7, "seven"]]);

    function DirectContextConsumer() {
      const ctx = React.useContext(CardDataContext);
      ref.current = ctx;
      return null;
    }

    act(() => {
      render(
        <CardDataProvider feedData={feedData}>
          <DirectContextConsumer />
        </CardDataProvider>
      );
    });

    expect(ref.current).not.toBeNull();
    const ctx = ref.current as { feedData: Map<number, unknown> };
    expect(ctx.feedData).toBe(feedData);
  });
});

