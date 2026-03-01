/**
 * DevNotificationContext RTL tests — Step 7.
 *
 * Tests cover:
 * - DevNotificationProvider renders children
 * - useDevNotification hook returns default state
 * - notify() adds a notification to state
 * - updateBuildProgress() updates buildProgress state
 * - setBadge() updates badgeCounts state
 * - ref-based setter (controlRef) allows non-React code to push notifications
 *
 * [D05] DevNotificationContext replaces CustomEvent bridges
 * Spec S06
 */
import "./setup-rtl";

import React, { createRef, useEffect, useState } from "react";
import { describe, it, expect } from "bun:test";
import { render, act } from "@testing-library/react";

import {
  DevNotificationProvider,
  useDevNotification,
} from "@/contexts/dev-notification-context";
import type {
  DevNotificationRef,
  DevNotificationContextValue,
} from "@/contexts/dev-notification-context";

// ---- Helpers ----

interface CaptureResult {
  captured: DevNotificationContextValue | null;
}

function CaptureContext({ result }: { result: CaptureResult }) {
  const value = useDevNotification();
  result.captured = value;
  return null;
}

function renderProvider(controlRef?: React.RefObject<DevNotificationRef | null>) {
  const result: CaptureResult = { captured: null };

  const { unmount, rerender } = render(
    <DevNotificationProvider controlRef={controlRef}>
      <CaptureContext result={result} />
    </DevNotificationProvider>
  );

  return { result, unmount, rerender };
}

// ---- Tests ----

describe("DevNotificationProvider – basic rendering", () => {
  it("renders children without throwing", () => {
    const { unmount } = render(
      <DevNotificationProvider>
        <div data-testid="child">child content</div>
      </DevNotificationProvider>
    );
    unmount();
  });

  it("useDevNotification returns initial empty state", () => {
    const { result, unmount } = renderProvider();

    expect(result.captured).not.toBeNull();
    expect(result.captured!.state.notifications).toEqual([]);
    expect(result.captured!.state.buildProgress).toBeNull();
    expect(result.captured!.state.badgeCounts.size).toBe(0);
    unmount();
  });
});

describe("DevNotificationProvider – notify()", () => {
  it("adds a notification to state when notify() is called", async () => {
    const { result, unmount } = renderProvider();

    await act(async () => {
      result.captured!.notify({ message: "Test notification", level: "info" });
    });

    expect(result.captured!.state.notifications.length).toBe(1);
    expect(result.captured!.state.notifications[0].message).toBe("Test notification");
    expect(result.captured!.state.notifications[0].level).toBe("info");
    unmount();
  });

  it("notify() with level 'warning' sets notification level", async () => {
    const { result, unmount } = renderProvider();

    await act(async () => {
      result.captured!.notify({ message: "A warning", level: "warning" });
    });

    expect(result.captured!.state.notifications[0].level).toBe("warning");
    unmount();
  });

  it("notify() with level 'error' sets notification level", async () => {
    const { result, unmount } = renderProvider();

    await act(async () => {
      result.captured!.notify({ message: "An error", level: "error" });
    });

    expect(result.captured!.state.notifications[0].level).toBe("error");
    unmount();
  });

  it("multiple notify() calls accumulate notifications", async () => {
    const { result, unmount } = renderProvider();

    await act(async () => {
      result.captured!.notify({ message: "First", level: "info" });
      result.captured!.notify({ message: "Second", level: "info" });
      result.captured!.notify({ message: "Third", level: "warning" });
    });

    expect(result.captured!.state.notifications.length).toBe(3);
    unmount();
  });

  it("notification has id and timestamp", async () => {
    const { result, unmount } = renderProvider();

    await act(async () => {
      result.captured!.notify({ message: "With metadata" });
    });

    const notif = result.captured!.state.notifications[0];
    expect(typeof notif.id).toBe("string");
    expect(notif.id.length).toBeGreaterThan(0);
    expect(typeof notif.timestamp).toBe("number");
    unmount();
  });
});

describe("DevNotificationProvider – updateBuildProgress()", () => {
  it("updateBuildProgress sets buildProgress state", async () => {
    const { result, unmount } = renderProvider();

    await act(async () => {
      result.captured!.updateBuildProgress({ step: "Compiling", progress: 3, total: 10 });
    });

    expect(result.captured!.state.buildProgress).not.toBeNull();
    expect(result.captured!.state.buildProgress?.step).toBe("Compiling");
    expect(result.captured!.state.buildProgress?.progress).toBe(3);
    expect(result.captured!.state.buildProgress?.total).toBe(10);
    unmount();
  });

  it("updateBuildProgress with null-like payload clears buildProgress", async () => {
    const { result, unmount } = renderProvider();

    // First set it
    await act(async () => {
      result.captured!.updateBuildProgress({ step: "Building", progress: 5, total: 10 });
    });
    expect(result.captured!.state.buildProgress).not.toBeNull();

    // Then clear with null payload (passes null directly)
    await act(async () => {
      result.captured!.updateBuildProgress(null as unknown as Record<string, unknown>);
    });
    expect(result.captured!.state.buildProgress).toBeNull();
    unmount();
  });
});

describe("DevNotificationProvider – setBadge()", () => {
  it("setBadge() adds a badge count for a componentId", async () => {
    const { result, unmount } = renderProvider();

    await act(async () => {
      result.captured!.setBadge("terminal", 5);
    });

    expect(result.captured!.state.badgeCounts.get("terminal")).toBe(5);
    unmount();
  });

  it("setBadge() with count 0 removes the badge", async () => {
    const { result, unmount } = renderProvider();

    await act(async () => {
      result.captured!.setBadge("terminal", 3);
    });
    expect(result.captured!.state.badgeCounts.get("terminal")).toBe(3);

    await act(async () => {
      result.captured!.setBadge("terminal", 0);
    });
    expect(result.captured!.state.badgeCounts.has("terminal")).toBe(false);
    unmount();
  });

  it("setBadge() handles multiple componentIds independently", async () => {
    const { result, unmount } = renderProvider();

    await act(async () => {
      result.captured!.setBadge("terminal", 2);
      result.captured!.setBadge("git", 7);
    });

    expect(result.captured!.state.badgeCounts.get("terminal")).toBe(2);
    expect(result.captured!.state.badgeCounts.get("git")).toBe(7);
    unmount();
  });
});

describe("DevNotificationContext – ref-based setter (controlRef)", () => {
  it("controlRef.current is populated after render", async () => {
    const controlRef = createRef<DevNotificationRef | null>();
    const { unmount } = renderProvider(controlRef);

    await act(async () => {});

    expect(controlRef.current).not.toBeNull();
    expect(typeof controlRef.current?.notify).toBe("function");
    expect(typeof controlRef.current?.updateBuildProgress).toBe("function");
    expect(typeof controlRef.current?.setBadge).toBe("function");
    unmount();
  });

  it("ref-based notify() updates React state inside the provider", async () => {
    const controlRef = createRef<DevNotificationRef | null>();
    const { result, unmount } = renderProvider(controlRef);

    await act(async () => {});

    // Call via the ref (simulating non-React code like action-dispatch.ts)
    await act(async () => {
      controlRef.current?.notify({ message: "From ref", level: "info" });
    });

    expect(result.captured!.state.notifications.length).toBe(1);
    expect(result.captured!.state.notifications[0].message).toBe("From ref");
    unmount();
  });

  it("ref-based setBadge() updates React state inside the provider", async () => {
    const controlRef = createRef<DevNotificationRef | null>();
    const { result, unmount } = renderProvider(controlRef);

    await act(async () => {});

    await act(async () => {
      controlRef.current?.setBadge("code", 4);
    });

    expect(result.captured!.state.badgeCounts.get("code")).toBe(4);
    unmount();
  });

  it("ref-based updateBuildProgress() updates React state inside the provider", async () => {
    const controlRef = createRef<DevNotificationRef | null>();
    const { result, unmount } = renderProvider(controlRef);

    await act(async () => {});

    await act(async () => {
      controlRef.current?.updateBuildProgress({ step: "Linking", progress: 8, total: 10 });
    });

    expect(result.captured!.state.buildProgress?.step).toBe("Linking");
    unmount();
  });
});
