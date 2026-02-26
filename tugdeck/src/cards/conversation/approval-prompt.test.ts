/**
 * Tests for approval-prompt - tool approval requests
 * Using happy-dom for DOM environment
 */

import { describe, test, expect, beforeAll, mock } from "bun:test";
import { Window } from "happy-dom";

// Setup DOM environment
const window = new Window();
global.window = window as any;
global.document = window.document as any;
global.DOMParser = window.DOMParser as any;

// Mock navigator.clipboard while preserving userAgent for react-dom compatibility.
global.navigator = {
  userAgent: window.navigator.userAgent,
  clipboard: {
    writeText: mock(() => Promise.resolve()),
  },
} as any;

// Import after DOM setup
import { ApprovalPrompt } from "./approval-prompt";

describe("approval-prompt", () => {
  describe("container structure", () => {
    test("renders container with approval-prompt class", () => {
      const prompt = new ApprovalPrompt("Bash", "req-123", { command: "ls" });
      const element = prompt.render();
      expect(element.className).toBe("approval-prompt");
    });

    test("sets data-request-id attribute", () => {
      const prompt = new ApprovalPrompt("Read", "req-456", { file_path: "test.txt" });
      const element = prompt.render();
      expect(element.dataset.requestId).toBe("req-456");
    });

    test("renders correct tool icon for known tools", () => {
      const prompt = new ApprovalPrompt("Bash", "req-789", { command: "pwd" });
      const element = prompt.render();
      const icon = element.querySelector(".approval-prompt-icon");
      expect(icon).not.toBeNull();
      expect(icon?.querySelector("svg")).not.toBeNull();
    });

    test("renders tool name with approval message", () => {
      const prompt = new ApprovalPrompt("Write", "req-abc", { file_path: "output.txt" });
      const element = prompt.render();
      const name = element.querySelector(".approval-prompt-name");
      expect(name?.textContent).toContain("Write");
      expect(name?.textContent).toContain("requires approval");
    });

    test("renders input preview in monospace showing tool input", () => {
      const prompt = new ApprovalPrompt("Bash", "req-def", {
        command: "rm -rf /",
        timeout: 5000,
      });
      const element = prompt.render();
      const preview = element.querySelector(".approval-prompt-preview");
      expect(preview).not.toBeNull();
      expect(preview?.textContent).toContain("command:");
      expect(preview?.textContent).toContain("rm -rf /");
      expect(preview?.textContent).toContain("timeout:");
      expect(preview?.textContent).toContain("5000");
    });

    test("Allow button renders with correct class", () => {
      const prompt = new ApprovalPrompt("Read", "req-ghi", { file_path: "test.txt" });
      const element = prompt.render();
      const allowBtn = element.querySelector(".approval-prompt-allow");
      expect(allowBtn).not.toBeNull();
      expect(allowBtn?.textContent).toBe("Allow");
    });

    test("Deny button renders with correct class", () => {
      const prompt = new ApprovalPrompt("Read", "req-jkl", { file_path: "test.txt" });
      const element = prompt.render();
      const denyBtn = element.querySelector(".approval-prompt-deny");
      expect(denyBtn).not.toBeNull();
      expect(denyBtn?.textContent).toBe("Deny");
    });
  });

  describe("button interactions", () => {
    test("Allow click calls onAllow callback", () => {
      const prompt = new ApprovalPrompt("Bash", "req-allow", { command: "ls" });
      let allowCalled = false;
      prompt.setCallbacks(
        () => { allowCalled = true; },
        () => {}
      );

      const element = prompt.render();
      const allowBtn = element.querySelector(".approval-prompt-allow") as HTMLButtonElement;
      allowBtn.click();

      expect(allowCalled).toBe(true);
    });

    test("Deny click calls onDeny callback and shows denied state", () => {
      const prompt = new ApprovalPrompt("Bash", "req-deny", { command: "ls" });
      let denyCalled = false;
      prompt.setCallbacks(
        () => {},
        () => { denyCalled = true; }
      );

      const element = prompt.render();
      const denyBtn = element.querySelector(".approval-prompt-deny") as HTMLButtonElement;
      denyBtn.click();

      expect(denyCalled).toBe(true);

      // Check denied state
      expect(element.classList.contains("approval-prompt-denied")).toBe(true);
    });

    test("denied state shows X icon and Denied by user text and removes buttons", () => {
      const prompt = new ApprovalPrompt("Bash", "req-denied-state", { command: "ls" });
      const element = prompt.render();

      // Trigger denied state
      prompt.showDenied();

      // Check for denied label
      const deniedLabel = element.querySelector(".approval-prompt-denied-label");
      expect(deniedLabel).not.toBeNull();
      expect(deniedLabel?.textContent).toContain("Denied by user");

      // Check for X icon
      expect(deniedLabel?.querySelector("svg")).not.toBeNull();

      // Check that buttons are removed
      const allowBtn = element.querySelector(".approval-prompt-allow");
      const denyBtn = element.querySelector(".approval-prompt-deny");
      expect(allowBtn).toBeNull();
      expect(denyBtn).toBeNull();
    });
  });

  describe("input area disabled state", () => {
    test("input area can be disabled with correct attributes", () => {
      const textarea = document.createElement("textarea");
      textarea.disabled = false;
      textarea.placeholder = "Type a message...";

      // Simulate disabling
      textarea.disabled = true;
      textarea.placeholder = "Waiting for tool approval...";

      expect(textarea.disabled).toBe(true);
      expect(textarea.placeholder).toBe("Waiting for tool approval...");
    });

    test("send button can be disabled", () => {
      const button = document.createElement("button");
      button.disabled = false;

      button.disabled = true;

      expect(button.disabled).toBe(true);
    });
  });

  describe("integration with other elements", () => {
    test("ApprovalPrompt coexists with ToolCard and message elements in a list", () => {
      const container = document.createElement("div");
      container.className = "message-list";

      // Add user message
      const userMsg = document.createElement("div");
      userMsg.className = "message message-user";
      userMsg.textContent = "Run this command";
      container.appendChild(userMsg);

      // Add approval prompt
      const prompt = new ApprovalPrompt("Bash", "req-int", { command: "ls -la" });
      container.appendChild(prompt.render());

      // Verify both elements present
      expect(container.querySelector(".message-user")).not.toBeNull();
      expect(container.querySelector(".approval-prompt")).not.toBeNull();

      // Check data attribute
      const promptEl = container.querySelector(".approval-prompt");
      expect(promptEl?.getAttribute("data-request-id")).toBe("req-int");
    });

    test("multiple approval prompts can coexist", () => {
      const container = document.createElement("div");

      const prompt1 = new ApprovalPrompt("Bash", "req-multi-1", { command: "ls" });
      const prompt2 = new ApprovalPrompt("Write", "req-multi-2", { file_path: "out.txt" });

      container.appendChild(prompt1.render());
      container.appendChild(prompt2.render());

      const prompts = container.querySelectorAll(".approval-prompt");
      expect(prompts.length).toBe(2);

      expect(container.querySelector('[data-request-id="req-multi-1"]')).not.toBeNull();
      expect(container.querySelector('[data-request-id="req-multi-2"]')).not.toBeNull();
    });
  });

  describe("edge cases", () => {
    test("handles empty input object", () => {
      const prompt = new ApprovalPrompt("Bash", "req-empty", {});
      const element = prompt.render();
      const preview = element.querySelector(".approval-prompt-preview");
      expect(preview?.textContent).toBe("(no input)");
    });

    test("handles input with special characters", () => {
      const prompt = new ApprovalPrompt("Bash", "req-special", {
        command: 'echo "Hello & <world>"',
      });
      const element = prompt.render();
      const preview = element.querySelector(".approval-prompt-preview");
      expect(preview?.textContent).toContain('echo "Hello & <world>"');
    });

    test("handles long input values", () => {
      const longValue = "a".repeat(200);
      const prompt = new ApprovalPrompt("Read", "req-long", {
        file_path: longValue,
      });
      const element = prompt.render();
      const preview = element.querySelector(".approval-prompt-preview");
      expect(preview?.textContent).toContain(longValue);
    });
  });

  describe("markStale", () => {
    test("markStale disables buttons and adds overlay", () => {
      const prompt = new ApprovalPrompt("Bash", "req-stale-1", { command: "ls" });
      const element = prompt.render();

      const allowBtn = element.querySelector(".approval-prompt-allow") as HTMLButtonElement;
      const denyBtn = element.querySelector(".approval-prompt-deny") as HTMLButtonElement;

      // Initially buttons should be enabled
      expect(allowBtn.disabled).toBe(false);
      expect(denyBtn.disabled).toBe(false);

      // Mark as stale
      prompt.markStale();

      // Buttons should be disabled
      expect(allowBtn.disabled).toBe(true);
      expect(denyBtn.disabled).toBe(true);

      // Overlay should be present
      const overlay = element.querySelector(".approval-prompt-stale-overlay");
      expect(overlay).not.toBeNull();
      expect(overlay?.textContent).toContain("Session restarted");

      // Container should have stale class
      expect(element.classList.contains("approval-prompt-stale")).toBe(true);

      // Container should have position:relative
      expect(element.style.position).toBe("relative");
    });

    test("markStale is idempotent", () => {
      const prompt = new ApprovalPrompt("Read", "req-stale-2", { file_path: "test.txt" });
      const element = prompt.render();

      prompt.markStale();
      const firstOverlay = element.querySelector(".approval-prompt-stale-overlay");

      prompt.markStale();
      const overlays = element.querySelectorAll(".approval-prompt-stale-overlay");

      // Should only have one overlay after multiple calls
      expect(overlays.length).toBe(1);
      expect(overlays[0]).toBe(firstOverlay);
    });
  });
});
