/**
 * DeveloperCard React component tests — Step 9 (context-based flow)
 *
 * Tests:
 * - Developer card renders 3 rows: Frontend, Backend, App
 * - All rows show "Clean" status with green dot initially
 * - Rows update to "Edited" status with file count when git feed reports changes
 * - categorizeFile correctly classifies file paths
 * - Frontend row shows "Reloaded" flash when transitioning from dirty to clean
 * - Backend row shows "Restart" button when stale notification received via DevNotificationContext
 * - App row shows "Relaunch" button when stale notification received via DevNotificationContext
 * - Clicking "Restart" dispatches the restart event
 * - Clicking "Relaunch" dispatches the relaunch event
 * - App row is hidden when WebKit bridge is not available
 * - DevNotificationContext.setBadge called with correct stale count
 * - Build progress indicator shows/hides based on DevNotificationContext.updateBuildProgress
 * - Developer card renders correctly with connection context provided
 */
import "./setup-test-dom"; // must be first

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { render, act, fireEvent } from "@testing-library/react";
import React, { createRef } from "react";

import { CardContextProvider } from "../../cards/card-context";
import { DevNotificationProvider, useDevNotification } from "../../contexts/dev-notification-context";
import type { DevNotificationRef } from "../../contexts/dev-notification-context";
import { DeveloperCard, categorizeFile } from "./developer-card";
import { FeedId } from "../../protocol";
import type { TugConnection } from "../../connection";

// ---- Helpers ----

function encodeGitStatus(overrides: {
  staged?: { path: string; status: string }[];
  unstaged?: { path: string; status: string }[];
} = {}): Uint8Array {
  const status = {
    branch: "main",
    ahead: 0,
    behind: 0,
    staged: overrides.staged ?? [],
    unstaged: overrides.unstaged ?? [],
    untracked: [],
    head_sha: "abc1234",
    head_message: "Latest commit",
  };
  return new TextEncoder().encode(JSON.stringify(status));
}

function makeMockConnection() {
  const calls: Array<{ action: string; params?: Record<string, unknown> }> = [];
  return {
    send: () => {},
    sendControlFrame: (action: string, params?: Record<string, unknown>) => {
      calls.push({ action, params });
    },
    _calls: calls,
  } as unknown as TugConnection & {
    _calls: Array<{ action: string; params?: Record<string, unknown> }>;
  };
}

function renderDeveloperCard(
  feedPayload?: Uint8Array,
  connection: TugConnection | null = null
) {
  const feedData = new Map<number, Uint8Array>();
  if (feedPayload) {
    feedData.set(FeedId.GIT, feedPayload);
  }
  const containerEl = document.createElement("div");
  document.body.appendChild(containerEl);

  // Control ref for injecting notifications from tests
  const devNotifRef = createRef<DevNotificationRef | null>() as React.MutableRefObject<DevNotificationRef | null>;

  const result = render(
    <DevNotificationProvider controlRef={devNotifRef}>
      <CardContextProvider
        connection={connection}
        feedData={feedData}
        dimensions={{ width: 0, height: 0 }}
        dragState={null}
        containerEl={containerEl}
      >
        <DeveloperCard />
      </CardContextProvider>
    </DevNotificationProvider>
  );
  return { ...result, containerEl, devNotifRef };
}

function dispatchDevNotification(
  devNotifRef: React.MutableRefObject<DevNotificationRef | null>,
  payload: {
    type: string;
    count?: number;
    timestamp?: number;
  }
) {
  devNotifRef.current?.notify(payload as Record<string, unknown>);
}

function dispatchBuildProgress(
  devNotifRef: React.MutableRefObject<DevNotificationRef | null>,
  payload: {
    stage?: string;
    status?: string;
    error?: string;
  }
) {
  devNotifRef.current?.updateBuildProgress(payload as Record<string, unknown>);
}

// ---- categorizeFile tests ----

describe("categorizeFile", () => {
  it("classifies tugdeck CSS as frontend", () => {
    expect(categorizeFile("tugdeck/styles/main.css")).toBe("frontend");
  });

  it("classifies tugdeck HTML as frontend", () => {
    expect(categorizeFile("tugdeck/index.html")).toBe("frontend");
  });

  it("classifies tugdeck/src .ts as frontend", () => {
    expect(categorizeFile("tugdeck/src/main.ts")).toBe("frontend");
  });

  it("classifies tugdeck/src .tsx as frontend", () => {
    expect(categorizeFile("tugdeck/src/app.tsx")).toBe("frontend");
  });

  it("classifies tugcode .rs as backend", () => {
    expect(categorizeFile("tugcode/src/main.rs")).toBe("backend");
  });

  it("classifies tugcode Cargo.toml as backend", () => {
    expect(categorizeFile("tugcode/Cargo.toml")).toBe("backend");
  });

  it("classifies tugcode Cargo.lock as backend", () => {
    expect(categorizeFile("tugcode/Cargo.lock")).toBe("backend");
  });

  it("classifies tugapp Swift as app", () => {
    expect(categorizeFile("tugapp/Sources/App.swift")).toBe("app");
  });

  it("returns null for unrecognized paths", () => {
    expect(categorizeFile("README.md")).toBeNull();
    expect(categorizeFile("docs/design.md")).toBeNull();
  });

  it("classifies tugdeck CSS before matching code patterns", () => {
    // A file like tugdeck/src/styles.css should still be frontend, not backend
    expect(categorizeFile("tugdeck/src/styles.css")).toBe("frontend");
  });
});

// ---- DeveloperCard rendering tests ----

describe("DeveloperCard – initial rendering", () => {
  beforeEach(() => {
    delete (window as any).webkit;
  });

  it("renders 3 rows: Frontend, Backend, App (when webkit available)", async () => {
    // Make webkit available so App row shows
    (window as any).webkit = {};
    const { container, unmount } = renderDeveloperCard();
    await act(async () => {});

    const text = container.textContent ?? "";
    expect(text).toContain("Frontend");
    expect(text).toContain("Backend");
    expect(text).toContain("App");

    unmount();
    delete (window as any).webkit;
  });

  it("shows Clean status for all rows initially", async () => {
    (window as any).webkit = {};
    const { container, unmount } = renderDeveloperCard();
    await act(async () => {});

    const statusEls = container.querySelectorAll(".dev-status");
    for (const el of statusEls) {
      expect(el.textContent).toContain("Clean");
    }

    unmount();
    delete (window as any).webkit;
  });

  it("hides App row when WebKit bridge is not available", async () => {
    delete (window as any).webkit;
    const { container, unmount } = renderDeveloperCard();
    await act(async () => {});

    const text = container.textContent ?? "";
    expect(text).toContain("Frontend");
    expect(text).toContain("Backend");
    // App row should not be present
    expect(text).not.toContain("App");

    unmount();
  });
});

describe("DeveloperCard – git feed parsing", () => {
  it("shows Edited status with file count when git feed reports frontend changes", async () => {
    const payload = encodeGitStatus({
      staged: [{ path: "tugdeck/styles/main.css", status: "M" }],
    });
    const { container, unmount } = renderDeveloperCard(payload);
    await act(async () => {});

    const frontendStatus = Array.from(
      container.querySelectorAll(".dev-status")
    )[0];
    expect(frontendStatus?.textContent).toContain("Edited");
    expect(frontendStatus?.textContent).toContain("1 file");

    unmount();
  });

  it("shows Edited status for Frontend row when git feed reports tugdeck TS/TSX changes", async () => {
    const payload = encodeGitStatus({
      staged: [
        { path: "tugdeck/src/main.ts", status: "M" },
        { path: "tugdeck/src/app.tsx", status: "A" },
      ],
    });
    const { container, unmount } = renderDeveloperCard(payload);
    await act(async () => {});

    const frontendStatus = Array.from(
      container.querySelectorAll(".dev-status")
    )[0];
    expect(frontendStatus?.textContent).toContain("Edited");
    expect(frontendStatus?.textContent).toContain("2 files");

    unmount();
  });

  it("shows Edited status for Backend row with correct count", async () => {
    const payload = encodeGitStatus({
      staged: [
        { path: "tugcode/crates/tugcast/src/main.rs", status: "M" },
        { path: "tugcode/crates/tugcast/src/lib.rs", status: "A" },
      ],
    });
    const { container, unmount } = renderDeveloperCard(payload);
    await act(async () => {});

    const backendStatus = Array.from(
      container.querySelectorAll(".dev-status")
    )[1];
    expect(backendStatus?.textContent).toContain("Edited");
    expect(backendStatus?.textContent).toContain("2 files");

    unmount();
  });

  it("counts unstaged files in addition to staged files", async () => {
    const payload = encodeGitStatus({
      staged: [{ path: "tugcode/src/main.rs", status: "M" }],
      unstaged: [{ path: "tugcode/src/lib.rs", status: "M" }],
    });
    const { container, unmount } = renderDeveloperCard(payload);
    await act(async () => {});

    const backendStatus = Array.from(
      container.querySelectorAll(".dev-status")
    )[1];
    expect(backendStatus?.textContent).toContain("Edited");
    expect(backendStatus?.textContent).toContain("2 files");

    unmount();
  });
});

describe("DeveloperCard – dev notifications via DevNotificationContext", () => {
  afterEach(() => {
    delete (window as any).webkit;
  });

  it("shows Restart button when restart_available notification received", async () => {
    const { container, unmount, devNotifRef } = renderDeveloperCard();
    await act(async () => {});

    // No restart button initially
    let restartBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Restart")
    );
    expect(restartBtn).toBeUndefined();

    await act(async () => {
      dispatchDevNotification(devNotifRef, { type: "restart_available", count: 2 });
    });

    restartBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Restart")
    );
    expect(restartBtn).not.toBeUndefined();

    unmount();
  });

  it("shows Relaunch button when relaunch_available notification received", async () => {
    (window as any).webkit = {};
    const { container, unmount, devNotifRef } = renderDeveloperCard();
    await act(async () => {});

    // No relaunch button initially
    let relaunchBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Relaunch")
    );
    expect(relaunchBtn).toBeUndefined();

    await act(async () => {
      dispatchDevNotification(devNotifRef, { type: "relaunch_available", count: 1 });
    });

    relaunchBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Relaunch")
    );
    expect(relaunchBtn).not.toBeUndefined();

    unmount();
    delete (window as any).webkit;
  });

  it("shows Reloaded flash when td-hmr-update event received", async () => {
    const { container, unmount } = renderDeveloperCard();
    await act(async () => {});

    await act(async () => {
      document.dispatchEvent(new CustomEvent("td-hmr-update"));
    });

    const frontendStatus = Array.from(
      container.querySelectorAll(".dev-status")
    )[0];
    expect(frontendStatus?.textContent).toContain("Reloaded");

    unmount();
  });

  it("reverts Frontend row to Clean after Reloaded flash expires", async () => {
    const { container, unmount } = renderDeveloperCard();
    await act(async () => {});

    await act(async () => {
      document.dispatchEvent(new CustomEvent("td-hmr-update"));
    });

    // Should show "Reloaded" immediately
    const frontendStatus = Array.from(
      container.querySelectorAll(".dev-status")
    )[0];
    expect(frontendStatus?.textContent).toContain("Reloaded");

    // Wait for flash to expire (2 seconds + buffer)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2100));
    });

    expect(frontendStatus?.textContent).toContain("Clean");

    unmount();
  });
});

describe("DeveloperCard – action buttons", () => {
  afterEach(() => {
    delete (window as any).webkit;
  });

  it("clicking Restart calls sendControlFrame('restart') and button stays until confirmation", async () => {
    const conn = makeMockConnection();
    const { container, unmount, devNotifRef } = renderDeveloperCard(undefined, conn);
    await act(async () => {});

    // Trigger restart_available notification via context
    await act(async () => {
      dispatchDevNotification(devNotifRef, { type: "restart_available", count: 1 });
    });

    const restartBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Restart")
    );
    expect(restartBtn).not.toBeUndefined();

    await act(async () => {
      fireEvent.click(restartBtn!);
    });

    expect(conn._calls).toContainEqual({ action: "restart", params: undefined });

    // Button should still be visible because stale state is NOT cleared on click
    const restartBtnAfterClick = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Restart")
    );
    expect(restartBtnAfterClick).not.toBeUndefined();

    // Dispatch relaunch_available as confirmation from the new tugcast instance.
    // Any dev_notification clears the restartPendingRef (per D07 pending-flag pattern).
    // Using relaunch_available avoids re-staleing backendRow, so the Restart button disappears.
    await act(async () => {
      dispatchDevNotification(devNotifRef, { type: "relaunch_available", count: 0, timestamp: Date.now() });
    });

    // Now the button should be gone (backendRow stale cleared by pending-flag logic)
    const restartBtnAfterConfirm = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Restart")
    );
    expect(restartBtnAfterConfirm).toBeUndefined();

    unmount();
  });

  it("clicking Relaunch calls sendControlFrame('relaunch') and button stays until confirmation", async () => {
    (window as any).webkit = {};
    const conn = makeMockConnection();
    const { container, unmount, devNotifRef } = renderDeveloperCard(undefined, conn);
    await act(async () => {});

    await act(async () => {
      dispatchDevNotification(devNotifRef, { type: "relaunch_available", count: 1 });
    });

    const relaunchBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Relaunch")
    );
    expect(relaunchBtn).not.toBeUndefined();

    await act(async () => {
      fireEvent.click(relaunchBtn!);
    });

    expect(conn._calls).toContainEqual({ action: "relaunch", params: undefined });

    // Button should still be visible because stale state is NOT cleared on click
    const relaunchBtnAfterClick = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Relaunch")
    );
    expect(relaunchBtnAfterClick).not.toBeUndefined();

    // Dispatch restart_available as confirmation from the new tugcast instance.
    // Any dev_notification clears the relaunchPendingRef (per D07 pending-flag pattern).
    // Using restart_available avoids re-staleing appRow, so the Relaunch button disappears.
    await act(async () => {
      dispatchDevNotification(devNotifRef, { type: "restart_available", count: 0, timestamp: Date.now() });
    });

    // Now the button should be gone (appRow stale cleared by pending-flag logic)
    const relaunchBtnAfterConfirm = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Relaunch")
    );
    expect(relaunchBtnAfterConfirm).toBeUndefined();

    unmount();
    delete (window as any).webkit;
  });
});

// BadgeProbe reads badgeCounts from DevNotificationContext for test assertions
function BadgeProbe({ result }: { result: { badgeCount: number } }) {
  const { state: devState } = useDevNotification();
  result.badgeCount = devState.badgeCounts.get("developer") ?? 0;
  return null;
}

describe("DeveloperCard – badge via DevNotificationContext", () => {
  it("badge count updated in context when restart_available notification received", async () => {
    const feedData = new Map<number, Uint8Array>();
    const containerEl = document.createElement("div");
    document.body.appendChild(containerEl);

    const devNotifRef = createRef<DevNotificationRef | null>() as React.MutableRefObject<DevNotificationRef | null>;
    const badgeResult = { badgeCount: 0 };

    const { unmount } = render(
      <DevNotificationProvider controlRef={devNotifRef}>
        <CardContextProvider
          connection={null}
          feedData={feedData}
          dimensions={{ width: 0, height: 0 }}
          dragState={null}
          containerEl={containerEl}
        >
          <DeveloperCard />
          <BadgeProbe result={badgeResult} />
        </CardContextProvider>
      </DevNotificationProvider>
    );
    await act(async () => {});

    // Dispatch restart_available notification via context
    await act(async () => {
      devNotifRef.current?.notify({ type: "restart_available", count: 3 } as Record<string, unknown>);
    });

    // Allow React state to settle
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // The DeveloperCard dispatchBadge useEffect should have updated badge in context
    expect(badgeResult.badgeCount).toBe(3);

    unmount();
  });
});

describe("DeveloperCard – build progress via DevNotificationContext", () => {
  it("shows build progress text when updateBuildProgress dispatched via context", async () => {
    const { container, unmount, devNotifRef } = renderDeveloperCard();
    await act(async () => {});

    // No progress initially
    let progressEl = container.querySelector(".developer-build-progress");
    expect(progressEl).toBeNull();

    await act(async () => {
      dispatchBuildProgress(devNotifRef, { stage: "compile", status: "running" });
    });

    progressEl = container.querySelector(".developer-build-progress");
    expect(progressEl).not.toBeNull();
    expect(progressEl?.textContent).toContain("compile");
    expect(progressEl?.textContent).toContain("running");

    unmount();
  });

  it("hides build progress when dispatch has no stage/status", async () => {
    const { container, unmount, devNotifRef } = renderDeveloperCard();
    await act(async () => {});

    // Show progress first
    await act(async () => {
      dispatchBuildProgress(devNotifRef, { stage: "compile", status: "running" });
    });

    expect(container.querySelector(".developer-build-progress")).not.toBeNull();

    // Now hide it
    await act(async () => {
      dispatchBuildProgress(devNotifRef, {});
    });

    expect(container.querySelector(".developer-build-progress")).toBeNull();

    unmount();
  });

  it("includes error text in build progress when error field is present", async () => {
    const { container, unmount, devNotifRef } = renderDeveloperCard();
    await act(async () => {});

    await act(async () => {
      dispatchBuildProgress(devNotifRef, {
        stage: "compile",
        status: "failed",
        error: "syntax error",
      });
    });

    const progressEl = container.querySelector(".developer-build-progress");
    expect(progressEl?.textContent).toContain("syntax error");

    unmount();
  });
});

describe("DeveloperCard – with connection context", () => {
  it("renders correctly with a connection provided via context", async () => {
    const conn = makeMockConnection();
    const { container, unmount } = renderDeveloperCard(undefined, conn);
    await act(async () => {});

    // Should render without errors
    const devRows = container.querySelectorAll(".dev-row");
    // At minimum Frontend and Backend rows should be present (App hidden without webkit)
    expect(devRows.length).toBeGreaterThanOrEqual(2);

    unmount();
  });
});

describe("DeveloperCard – pending-flag confirmation pattern", () => {
  afterEach(() => {
    delete (window as any).webkit;
  });

  it("backendRow clears stale state when dev_notification arrives after Restart click", async () => {
    const conn = makeMockConnection();
    const { container, unmount, devNotifRef } = renderDeveloperCard(undefined, conn);
    await act(async () => {});

    // Make backendRow stale
    await act(async () => {
      dispatchDevNotification(devNotifRef, { type: "restart_available", count: 3 });
    });

    // Verify Restart button is visible
    let restartBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Restart")
    );
    expect(restartBtn).not.toBeUndefined();

    // Click Restart — sets restartPendingRef, does NOT clear stale state
    await act(async () => {
      fireEvent.click(restartBtn!);
    });

    // Button still visible (stale not cleared yet)
    restartBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Restart")
    );
    expect(restartBtn).not.toBeUndefined();

    // Dispatch relaunch_available as confirmation (proof the new tugcast instance is running).
    // Any dev_notification clears restartPendingRef; using relaunch_available avoids
    // re-staleing backendRow so the Restart button disappears cleanly.
    await act(async () => {
      dispatchDevNotification(devNotifRef, { type: "relaunch_available", count: 0, timestamp: Date.now() });
    });

    // backendRow stale state cleared — Restart button should be gone
    restartBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Restart")
    );
    expect(restartBtn).toBeUndefined();

    // Backend row status should show "Clean"
    const backendStatus = Array.from(container.querySelectorAll(".dev-status"))[1];
    expect(backendStatus?.textContent).toContain("Clean");

    unmount();
  });

  it("backendRow shows new stale count after restart_available arrives with restartPending set", async () => {
    const conn = makeMockConnection();
    const { container, unmount, devNotifRef } = renderDeveloperCard(undefined, conn);
    await act(async () => {});

    // Make backendRow stale with count=1
    await act(async () => {
      dispatchDevNotification(devNotifRef, { type: "restart_available", count: 1 });
    });

    // Click Restart — sets restartPendingRef
    const restartBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Restart")
    );
    await act(async () => {
      fireEvent.click(restartBtn!);
    });

    // Dispatch restart_available(count=2) from the new tugcast instance.
    // React 18 batches: pending flag clears stale, then restart_available sets new stale.
    // Net result: backendRow is stale with staleCount=2.
    await act(async () => {
      dispatchDevNotification(devNotifRef, { type: "restart_available", count: 2 });
    });

    // Restart button should still be visible (new notification made backendRow stale again)
    const restartBtnAfter = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Restart")
    );
    expect(restartBtnAfter).not.toBeUndefined();

    // Status should reflect the new stale count
    const backendStatus = Array.from(container.querySelectorAll(".dev-status"))[1];
    expect(backendStatus?.textContent).toContain("2");

    unmount();
  });
});
