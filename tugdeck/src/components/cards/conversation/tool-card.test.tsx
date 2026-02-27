/**
 * ToolCard React component tests — Step 8.2
 *
 * Covers:
 * - Renders tool name
 * - Renders running status icon
 * - Expands to show detail on header click
 * - Shows success status when result is provided
 * - Shows failure status for error results
 * - Shows stale overlay when stale=true
 */
import "./setup-test-dom"; // must be first

import { describe, it, expect } from "bun:test";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";
import { ToolCard } from "./tool-card";
import type { ToolUse, ToolResult } from "../../../cards/conversation/types";

// ---- Helpers ----

function makeToolUse(overrides: Partial<ToolUse> = {}): ToolUse {
  return {
    type: "tool_use",
    msg_id: "msg-001",
    seq: 1,
    tool_name: "Bash",
    tool_use_id: "tu-001",
    input: { command: "ls -la" },
    ...overrides,
  };
}

function makeResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    type: "tool_result",
    tool_use_id: "tu-001",
    output: "file1.ts\nfile2.ts",
    is_error: false,
    ...overrides,
  };
}

// ---- Tests ----

describe("ToolCard – renders name and status", () => {
  it("renders tool name", async () => {
    const { container, unmount } = render(
      <ToolCard toolUse={makeToolUse({ tool_name: "Read" })} />
    );
    await act(async () => {});
    expect(container.querySelector("[data-testid='tool-name']")?.textContent).toBe("Read");
    unmount();
  });

  it("shows running status icon when no result", async () => {
    const { container, unmount } = render(<ToolCard toolUse={makeToolUse()} />);
    await act(async () => {});
    const statusEl = container.querySelector(".tool-card-status");
    expect(statusEl?.className).toContain("running");
    unmount();
  });

  it("shows success status when result is not an error", async () => {
    const { container, unmount } = render(
      <ToolCard toolUse={makeToolUse()} result={makeResult({ is_error: false })} />
    );
    await act(async () => {});
    const statusEl = container.querySelector(".tool-card-status");
    expect(statusEl?.className).toContain("success");
    unmount();
  });

  it("shows failure status when result is an error", async () => {
    const { container, unmount } = render(
      <ToolCard
        toolUse={makeToolUse()}
        result={makeResult({ is_error: true })}
      />
    );
    await act(async () => {});
    const statusEl = container.querySelector(".tool-card-status");
    expect(statusEl?.className).toContain("failure");
    unmount();
  });

  it("shows interrupted status when stale=true", async () => {
    const { container, unmount } = render(
      <ToolCard toolUse={makeToolUse()} stale={true} />
    );
    await act(async () => {});
    const statusEl = container.querySelector(".tool-card-status");
    expect(statusEl?.className).toContain("interrupted");
    unmount();
  });
});

describe("ToolCard – expand / collapse", () => {
  it("content is not shown initially", async () => {
    const { container, unmount } = render(
      <ToolCard toolUse={makeToolUse()} result={makeResult()} />
    );
    await act(async () => {});
    expect(container.querySelector(".tool-card-content")).toBeNull();
    unmount();
  });

  it("expands to show content on header click", async () => {
    const { container, unmount } = render(
      <ToolCard toolUse={makeToolUse()} result={makeResult()} />
    );
    await act(async () => {});

    const header = container.querySelector(".tool-card-header") as HTMLElement;
    await act(async () => { fireEvent.click(header); });

    expect(container.querySelector(".tool-card-content")).not.toBeNull();
    unmount();
  });

  it("shows result output after expanding", async () => {
    const { container, unmount } = render(
      <ToolCard
        toolUse={makeToolUse()}
        result={makeResult({ output: "hello output" })}
      />
    );
    await act(async () => {});

    const header = container.querySelector(".tool-card-header") as HTMLElement;
    await act(async () => { fireEvent.click(header); });

    expect(container.textContent).toContain("hello output");
    unmount();
  });

  it("collapses again on second header click", async () => {
    const { container, unmount } = render(
      <ToolCard toolUse={makeToolUse()} result={makeResult()} />
    );
    await act(async () => {});

    const header = container.querySelector(".tool-card-header") as HTMLElement;
    await act(async () => { fireEvent.click(header); });
    expect(container.querySelector(".tool-card-content")).not.toBeNull();

    await act(async () => { fireEvent.click(header); });
    expect(container.querySelector(".tool-card-content")).toBeNull();
    unmount();
  });
});

describe("ToolCard – stale overlay", () => {
  it("shows stale overlay when stale=true", async () => {
    const { container, unmount } = render(
      <ToolCard toolUse={makeToolUse()} stale={true} />
    );
    await act(async () => {});
    expect(container.querySelector(".tool-card-stale-overlay")).not.toBeNull();
    expect(container.textContent).toContain("Session restarted");
    unmount();
  });

  it("does not show stale overlay when stale=false", async () => {
    const { container, unmount } = render(
      <ToolCard toolUse={makeToolUse()} stale={false} />
    );
    await act(async () => {});
    expect(container.querySelector(".tool-card-stale-overlay")).toBeNull();
    unmount();
  });
});
