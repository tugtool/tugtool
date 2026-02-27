/**
 * StatsCard React component tests — Step 7.3
 *
 * Tests:
 * - Stats card renders stat sections from feed data
 * - Section visibility toggles work correctly
 * - Stats update when new feed frames arrive
 */
import "./setup-test-dom"; // must be first

import { describe, it, expect } from "bun:test";
import { render, act } from "@testing-library/react";
import React from "react";

import { CardContextProvider } from "../../cards/card-context";
import { StatsCard } from "./stats-card";
import { FeedId } from "../../protocol";

// ---- Helpers ----

function encodeJSON(data: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(data));
}

function renderStatsCard(feeds: {
  processInfo?: object | null;
  tokenUsage?: object | null;
  buildStatus?: object | null;
} = {}) {
  const feedData = new Map<number, Uint8Array>();
  if (feeds.processInfo !== undefined) {
    feedData.set(FeedId.STATS_PROCESS_INFO, encodeJSON(feeds.processInfo));
  }
  if (feeds.tokenUsage !== undefined) {
    feedData.set(FeedId.STATS_TOKEN_USAGE, encodeJSON(feeds.tokenUsage));
  }
  if (feeds.buildStatus !== undefined) {
    feedData.set(FeedId.STATS_BUILD_STATUS, encodeJSON(feeds.buildStatus));
  }

  const containerEl = document.createElement("div");
  document.body.appendChild(containerEl);

  const metaUpdates: any[] = [];
  containerEl.addEventListener("card-meta-update", (e: Event) => {
    metaUpdates.push((e as CustomEvent).detail);
  });

  const result = render(
    <CardContextProvider
      connection={null}
      feedData={feedData}
      dimensions={{ width: 0, height: 0 }}
      dragState={null}
      containerEl={containerEl}
    >
      <StatsCard />
    </CardContextProvider>
  );
  return { ...result, containerEl, metaUpdates };
}

// ---- Tests ----

describe("StatsCard – section rendering", () => {
  it("renders CPU/Memory section label", async () => {
    const { container, unmount } = renderStatsCard();
    await act(async () => {});

    expect(container.textContent).toContain("CPU / Memory");

    unmount();
  });

  it("renders Token Usage section label", async () => {
    const { container, unmount } = renderStatsCard();
    await act(async () => {});

    expect(container.textContent).toContain("Token Usage");

    unmount();
  });

  it("renders Build Status section label", async () => {
    const { container, unmount } = renderStatsCard();
    await act(async () => {});

    expect(container.textContent).toContain("Build Status");

    unmount();
  });
});

describe("StatsCard – process info feed", () => {
  it("renders CPU and Memory values from STATS_PROCESS_INFO feed", async () => {
    const { container, unmount } = renderStatsCard({
      processInfo: { cpu_percent: 42.5, memory_mb: 256 },
    });
    await act(async () => {});

    const text = container.textContent ?? "";
    expect(text).toContain("42.5%");
    expect(text).toContain("256MB");

    unmount();
  });
});

describe("StatsCard – token usage feed", () => {
  it("renders token count and context percent from STATS_TOKEN_USAGE feed", async () => {
    const { container, unmount } = renderStatsCard({
      tokenUsage: { total_tokens: 1234, context_window_percent: 12.5 },
    });
    await act(async () => {});

    const text = container.textContent ?? "";
    expect(text).toContain("1234 tokens");
    expect(text).toContain("12.5%");

    unmount();
  });

  it("renders N/A when token usage data is null", async () => {
    const { container, unmount } = renderStatsCard({
      tokenUsage: null,
    });
    await act(async () => {});

    // null payload encodes as "null"
    const text = container.textContent ?? "";
    expect(text).toContain("N/A");

    unmount();
  });
});

describe("StatsCard – build status feed", () => {
  it("renders build status value from STATS_BUILD_STATUS feed", async () => {
    const { container, unmount } = renderStatsCard({
      buildStatus: { status: "building" },
    });
    await act(async () => {});

    expect(container.textContent).toContain("building");

    unmount();
  });

  it("renders idle status", async () => {
    const { container, unmount } = renderStatsCard({
      buildStatus: { status: "idle" },
    });
    await act(async () => {});

    expect(container.textContent).toContain("idle");

    unmount();
  });
});

describe("StatsCard – section visibility toggles", () => {
  it("hides CPU/Memory section when toggle is called", async () => {
    const { container, metaUpdates, unmount } = renderStatsCard({
      processInfo: { cpu_percent: 10, memory_mb: 128 },
    });
    await act(async () => {});

    // Verify it's visible initially
    expect(container.textContent).toContain("CPU / Memory");

    // Find toggle action from meta
    const lastMeta = metaUpdates[metaUpdates.length - 1];
    const toggleItem = lastMeta.menuItems.find(
      (item: any) => item.label === "Show CPU / Memory"
    );
    expect(toggleItem).not.toBeUndefined();
    expect(toggleItem?.checked).toBe(true);

    await act(async () => {
      toggleItem.action(false);
    });

    // Section should be hidden
    expect(container.textContent).not.toContain("CPU / Memory");

    unmount();
  });

  it("hides Token Usage section when toggle is called", async () => {
    const { container, metaUpdates, unmount } = renderStatsCard({
      tokenUsage: { total_tokens: 100, context_window_percent: 5 },
    });
    await act(async () => {});

    expect(container.textContent).toContain("Token Usage");

    const lastMeta = metaUpdates[metaUpdates.length - 1];
    const toggleItem = lastMeta.menuItems.find(
      (item: any) => item.label === "Show Token Usage"
    );
    expect(toggleItem).not.toBeUndefined();

    await act(async () => {
      toggleItem.action(false);
    });

    expect(container.textContent).not.toContain("Token Usage");

    unmount();
  });

  it("hides Build Status section when toggle is called", async () => {
    const { container, metaUpdates, unmount } = renderStatsCard({
      buildStatus: { status: "idle" },
    });
    await act(async () => {});

    expect(container.textContent).toContain("Build Status");

    const lastMeta = metaUpdates[metaUpdates.length - 1];
    const toggleItem = lastMeta.menuItems.find(
      (item: any) => item.label === "Show Build Status"
    );
    expect(toggleItem).not.toBeUndefined();

    await act(async () => {
      toggleItem.action(false);
    });

    expect(container.textContent).not.toContain("Build Status");

    unmount();
  });
});

describe("StatsCard – feed updates", () => {
  it("updates CPU value when new STATS_PROCESS_INFO frame arrives", async () => {
    const containerEl = document.createElement("div");
    document.body.appendChild(containerEl);
    const feedData = new Map<number, Uint8Array>();
    feedData.set(FeedId.STATS_PROCESS_INFO, encodeJSON({ cpu_percent: 10, memory_mb: 100 }));

    const { container, rerender, unmount } = render(
      <CardContextProvider
        connection={null}
        feedData={feedData}
        dimensions={{ width: 0, height: 0 }}
        dragState={null}
        containerEl={containerEl}
      >
        <StatsCard />
      </CardContextProvider>
    );
    await act(async () => {});
    expect(container.textContent).toContain("10.0%");

    // Update feed
    const feedData2 = new Map<number, Uint8Array>();
    feedData2.set(FeedId.STATS_PROCESS_INFO, encodeJSON({ cpu_percent: 75, memory_mb: 512 }));

    await act(async () => {
      rerender(
        <CardContextProvider
          connection={null}
          feedData={feedData2}
          dimensions={{ width: 0, height: 0 }}
          dragState={null}
          containerEl={containerEl}
        >
          <StatsCard />
        </CardContextProvider>
      );
    });

    expect(container.textContent).toContain("75.0%");

    unmount();
  });
});

describe("StatsCard – card meta", () => {
  it("dispatches card-meta-update with Stats title and menu items", async () => {
    const { metaUpdates, unmount } = renderStatsCard();
    await act(async () => {});

    expect(metaUpdates.length).toBeGreaterThan(0);
    const lastMeta = metaUpdates[metaUpdates.length - 1];
    expect(lastMeta.title).toBe("Stats");
    expect(lastMeta.icon).toBe("Activity");

    const sparklineItem = lastMeta.menuItems.find(
      (item: any) => item.label === "Sparkline Timeframe"
    );
    expect(sparklineItem).not.toBeUndefined();
    expect(sparklineItem?.type).toBe("select");

    unmount();
  });
});
