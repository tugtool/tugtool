/**
 * ApprovalPrompt React component tests — Step 6.2
 *
 * Covers:
 * - Renders tool name and description (input preview)
 * - Allow button dispatches tool-approval event with approved: true (decision: "allow")
 * - Deny button dispatches tool-approval event with approved: false (decision: "deny")
 * - Buttons use correct shadcn variants (default for Allow, destructive for Deny)
 * - Deny shows "Denied by user" inline state after click
 * - Stale prop disables both buttons
 */
import "./setup-test-dom"; // must be first

import { describe, it, expect } from "bun:test";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";

import { ApprovalPrompt } from "./approval-prompt";
import type { ToolApprovalRequest } from "../../../cards/conversation/types";
import type { ToolApprovalEvent } from "./approval-prompt";

// ---- Helpers ----

function makeRequest(overrides: Partial<ToolApprovalRequest> = {}): ToolApprovalRequest {
  return {
    type: "tool_approval_request",
    request_id: "req-001",
    tool_name: "Bash",
    input: { command: "ls -la" },
    ...overrides,
  };
}

function renderPrompt(request: ToolApprovalRequest, stale = false) {
  const received: ToolApprovalEvent[] = [];

  const { container, unmount } = render(
    <ApprovalPrompt request={request} stale={stale} />
  );

  container.addEventListener("tool-approval", (e) => {
    received.push((e as CustomEvent<ToolApprovalEvent>).detail);
  });

  return { container, unmount, received };
}

// ---- Tests ----

describe("ApprovalPrompt – renders content", () => {
  it("renders the tool name", async () => {
    const { container, unmount } = renderPrompt(makeRequest({ tool_name: "Write" }));
    await act(async () => {});

    expect(container.textContent).toContain("Write");
    expect(container.textContent).toContain("requires approval");

    unmount();
  });

  it("renders input key-value preview", async () => {
    const { container, unmount } = renderPrompt(
      makeRequest({ input: { command: "ls -la", timeout: "30" } })
    );
    await act(async () => {});

    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain("command:");
    expect(pre?.textContent).toContain("ls -la");
    expect(pre?.textContent).toContain("timeout:");

    unmount();
  });

  it("renders '(no input)' when input is empty", async () => {
    const { container, unmount } = renderPrompt(makeRequest({ input: {} }));
    await act(async () => {});

    const pre = container.querySelector("pre");
    expect(pre?.textContent).toBe("(no input)");

    unmount();
  });

  it("renders Allow and Deny buttons", async () => {
    const { container, unmount } = renderPrompt(makeRequest());
    await act(async () => {});

    const allowBtn = container.querySelector("button[aria-label='Allow tool use']");
    const denyBtn = container.querySelector("button[aria-label='Deny tool use']");

    expect(allowBtn).not.toBeNull();
    expect(allowBtn?.textContent?.trim()).toBe("Allow");
    expect(denyBtn).not.toBeNull();
    expect(denyBtn?.textContent?.trim()).toBe("Deny");

    unmount();
  });
});

describe("ApprovalPrompt – button variants", () => {
  it("Allow button has default (primary) variant classes", async () => {
    const { container, unmount } = renderPrompt(makeRequest());
    await act(async () => {});

    const allowBtn = container.querySelector(
      "button[aria-label='Allow tool use']"
    ) as HTMLButtonElement | null;
    expect(allowBtn).not.toBeNull();
    // shadcn default variant: bg-primary text-primary-foreground
    expect(allowBtn?.className).toContain("bg-primary");

    unmount();
  });

  it("Deny button has destructive variant classes", async () => {
    const { container, unmount } = renderPrompt(makeRequest());
    await act(async () => {});

    const denyBtn = container.querySelector(
      "button[aria-label='Deny tool use']"
    ) as HTMLButtonElement | null;
    expect(denyBtn).not.toBeNull();
    // shadcn destructive variant: bg-destructive
    expect(denyBtn?.className).toContain("bg-destructive");

    unmount();
  });
});

describe("ApprovalPrompt – Allow action", () => {
  it("Allow button dispatches tool-approval event with decision: 'allow'", async () => {
    const { container, unmount, received } = renderPrompt(makeRequest());
    await act(async () => {});

    const allowBtn = container.querySelector(
      "button[aria-label='Allow tool use']"
    ) as HTMLButtonElement;
    expect(allowBtn).not.toBeNull();

    await act(async () => {
      fireEvent.click(allowBtn);
    });

    expect(received.length).toBe(1);
    expect(received[0].decision).toBe("allow");
    expect(received[0].payload.type).toBe("tool_approval");
    expect(received[0].payload.request_id).toBe("req-001");
    expect(received[0].payload.decision).toBe("allow");

    unmount();
  });
});

describe("ApprovalPrompt – Deny action", () => {
  it("Deny button dispatches tool-approval event with decision: 'deny'", async () => {
    const { container, unmount, received } = renderPrompt(makeRequest());
    await act(async () => {});

    const denyBtn = container.querySelector(
      "button[aria-label='Deny tool use']"
    ) as HTMLButtonElement;
    expect(denyBtn).not.toBeNull();

    await act(async () => {
      fireEvent.click(denyBtn);
    });

    expect(received.length).toBe(1);
    expect(received[0].decision).toBe("deny");
    expect(received[0].payload.decision).toBe("deny");

    unmount();
  });

  it("shows 'Denied by user' inline state after Deny is clicked", async () => {
    const { container, unmount } = renderPrompt(makeRequest());
    await act(async () => {});

    const denyBtn = container.querySelector(
      "button[aria-label='Deny tool use']"
    ) as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(denyBtn);
    });

    expect(container.textContent).toContain("Denied by user");
    // Buttons should no longer be present after deny
    expect(
      container.querySelector("button[aria-label='Allow tool use']")
    ).toBeNull();
    expect(
      container.querySelector("button[aria-label='Deny tool use']")
    ).toBeNull();

    unmount();
  });
});

describe("ApprovalPrompt – stale state", () => {
  it("buttons are disabled when stale=true", async () => {
    const { container, unmount } = renderPrompt(makeRequest(), true);
    await act(async () => {});

    // Stale prompt shows stale message, no action buttons
    expect(container.textContent).toContain("Session restarted");
    expect(
      container.querySelector("button[aria-label='Allow tool use']")
    ).toBeNull();
    expect(
      container.querySelector("button[aria-label='Deny tool use']")
    ).toBeNull();

    unmount();
  });
});
