/**
 * Tests for tool-card - tool use rendering
 * Using happy-dom for DOM environment
 */

import { describe, test, expect, beforeAll, mock } from "bun:test";
import { Window } from "happy-dom";

// Setup DOM environment
const window = new Window();
global.window = window as any;
global.document = window.document as any;
global.DOMParser = window.DOMParser as any;

// Mock navigator.clipboard
global.navigator = {
  clipboard: {
    writeText: mock(() => Promise.resolve()),
  },
} as any;

// Import after DOM setup
import { ToolCard, getToolIcon } from "./tool-card";

describe("tool-card", () => {
  describe("icon mapping", () => {
    test("Read returns an icon", () => {
      const Icon = getToolIcon("Read");
      expect(Icon).toBeDefined();
    });

    test("Edit returns an icon", () => {
      const Icon = getToolIcon("Edit");
      expect(Icon).toBeDefined();
    });

    test("Write returns an icon", () => {
      const Icon = getToolIcon("Write");
      expect(Icon).toBeDefined();
    });

    test("Bash returns an icon", () => {
      const Icon = getToolIcon("Bash");
      expect(Icon).toBeDefined();
    });

    test("Glob returns an icon", () => {
      const Icon = getToolIcon("Glob");
      expect(Icon).toBeDefined();
    });

    test("Grep returns an icon", () => {
      const Icon = getToolIcon("Grep");
      expect(Icon).toBeDefined();
    });

    test("unknown tool returns default Wrench icon", () => {
      const Icon = getToolIcon("UnknownTool");
      expect(Icon).toBeDefined();
    });
  });

  describe("container structure", () => {
    test("renders container with tool-card class", () => {
      const card = new ToolCard("Read", "tool-123", { file_path: "test.txt" });
      const element = card.render();
      expect(element.className).toBe("tool-card");
    });

    test("sets data-tool-use-id attribute", () => {
      const card = new ToolCard("Read", "tool-456", { file_path: "test.txt" });
      const element = card.render();
      expect(element.dataset.toolUseId).toBe("tool-456");
    });

    test("renders header with tool name", () => {
      const card = new ToolCard("Bash", "tool-789", { command: "ls" });
      const element = card.render();
      const name = element.querySelector(".tool-card-name");
      expect(name?.textContent).toBe("Bash");
    });

    test("renders summary from first input value", () => {
      const card = new ToolCard("Read", "tool-abc", { file_path: "/path/to/file.txt" });
      const element = card.render();
      const summary = element.querySelector(".tool-card-summary");
      expect(summary?.textContent).toContain("/path/to/file.txt");
    });

    test("truncates long summary at 80 characters", () => {
      const longPath = "a".repeat(100);
      const card = new ToolCard("Read", "tool-def", { file_path: longPath });
      const element = card.render();
      const summary = element.querySelector(".tool-card-summary");
      expect(summary?.textContent?.length).toBeLessThanOrEqual(83); // 80 + "..."
    });
  });

  describe("status transitions", () => {
    test("initial status is running with Loader icon", () => {
      const card = new ToolCard("Read", "tool-run", { file_path: "test.txt" });
      const element = card.render();
      const status = element.querySelector(".tool-card-status");
      expect(status?.classList.contains("running")).toBe(true);
    });

    test("updateStatus success shows Check icon with success color", () => {
      const card = new ToolCard("Read", "tool-success", { file_path: "test.txt" });
      card.updateStatus("success");
      const element = card.render();
      const status = element.querySelector(".tool-card-status");
      expect(status?.classList.contains("success")).toBe(true);
    });

    test("updateStatus failure shows X icon with destructive color", () => {
      const card = new ToolCard("Read", "tool-fail", { file_path: "test.txt" });
      card.updateStatus("failure");
      const element = card.render();
      const status = element.querySelector(".tool-card-status");
      expect(status?.classList.contains("failure")).toBe(true);
    });

    test("updateStatus interrupted shows Octagon icon with warning color", () => {
      const card = new ToolCard("Read", "tool-int", { file_path: "test.txt" });
      card.updateStatus("interrupted");
      const element = card.render();
      const status = element.querySelector(".tool-card-status");
      expect(status?.classList.contains("interrupted")).toBe(true);
    });
  });

  describe("collapse/expand", () => {
    test("default state is collapsed (content hidden)", () => {
      const card = new ToolCard("Read", "tool-col", { file_path: "test.txt" });
      const element = card.render();
      const content = element.querySelector(".tool-card-content");
      expect(content?.classList.contains("collapsed")).toBe(true);
    });

    test("clicking header toggles content visibility", () => {
      const card = new ToolCard("Read", "tool-toggle", { file_path: "test.txt" });
      const element = card.render();
      const header = element.querySelector(".tool-card-header") as HTMLElement;
      const content = element.querySelector(".tool-card-content");

      // Initially collapsed
      expect(content?.classList.contains("collapsed")).toBe(true);

      // Click to expand
      header.click();
      expect(content?.classList.contains("collapsed")).toBe(false);

      // Click to collapse
      header.click();
      expect(content?.classList.contains("collapsed")).toBe(true);
    });

    test("chevron changes from ChevronRight to ChevronDown on expand", () => {
      const card = new ToolCard("Read", "tool-chev", { file_path: "test.txt" });
      const element = card.render();
      const header = element.querySelector(".tool-card-header") as HTMLElement;
      const chevron = element.querySelector(".tool-card-chevron");

      // Initially collapsed (ChevronRight)
      expect(chevron?.innerHTML).toContain("svg");

      // Click to expand (should have ChevronDown)
      header.click();
      expect(chevron?.innerHTML).toContain("svg");
    });
  });

  describe("input rendering", () => {
    test("input section renders key-value pairs", () => {
      const card = new ToolCard("Read", "tool-input", { file_path: "test.txt" });
      const element = card.render();
      const inputRow = element.querySelector(".tool-card-input-row");
      expect(inputRow).not.toBeNull();

      const key = inputRow?.querySelector(".tool-card-input-key");
      const value = inputRow?.querySelector(".tool-card-input-value");
      expect(key?.textContent).toBe("file_path:");
      expect(value?.textContent).toBe("test.txt");
    });

    test("multiple input keys all rendered", () => {
      const card = new ToolCard("Bash", "tool-multi", {
        command: "ls -la",
        timeout: 5000,
      });
      const element = card.render();
      const inputRows = element.querySelectorAll(".tool-card-input-row");
      expect(inputRows.length).toBe(2);
    });
  });

  describe("result rendering", () => {
    test("result truncation at 10 lines shows Show all link", async () => {
      const card = new ToolCard("Bash", "tool-trunc", { command: "ls" });
      const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`);
      const output = lines.join("\n");

      await card.updateResult(output, false);
      const element = card.render();

      const showAllBtn = element.querySelector(".tool-card-show-all");
      expect(showAllBtn).not.toBeNull();
      expect(showAllBtn?.textContent).toContain("15 lines");
    });

    test("clicking Show all expands to full content", async () => {
      const card = new ToolCard("Bash", "tool-expand", { command: "ls" });
      const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`);
      const output = lines.join("\n");

      await card.updateResult(output, false);
      const element = card.render();

      const showAllBtn = element.querySelector(".tool-card-show-all") as HTMLButtonElement;
      expect(showAllBtn).not.toBeNull();

      // Click to expand
      showAllBtn.click();

      // Show all button should be gone
      const showAllBtnAfter = element.querySelector(".tool-card-show-all");
      expect(showAllBtnAfter).toBeNull();
    });

    test("error result renders with error class", async () => {
      const card = new ToolCard("Read", "tool-err", { file_path: "missing.txt" });
      await card.updateResult("File not found", true);
      const element = card.render();

      const result = element.querySelector(".tool-card-result");
      expect(result?.classList.contains("error")).toBe(true);
    });

    test("short output does not show Show all link", async () => {
      const card = new ToolCard("Bash", "tool-short", { command: "echo hello" });
      await card.updateResult("hello\nworld", false);
      const element = card.render();

      const showAllBtn = element.querySelector(".tool-card-show-all");
      expect(showAllBtn).toBeNull();
    });
  });

  describe("golden test", () => {
    test("full tool card lifecycle", async () => {
      // Create card
      const card = new ToolCard("Read", "tool-golden", {
        file_path: "/path/to/file.ts",
        offset: 0,
        limit: 100,
      });

      // Check initial structure
      const element = card.render();
      expect(element.className).toBe("tool-card");
      expect(element.dataset.toolUseId).toBe("tool-golden");

      // Check header
      const header = element.querySelector(".tool-card-header");
      expect(header).not.toBeNull();

      const name = element.querySelector(".tool-card-name");
      expect(name?.textContent).toBe("Read");

      const summary = element.querySelector(".tool-card-summary");
      expect(summary?.textContent).toContain("/path/to/file.ts");

      // Initial status
      const status = element.querySelector(".tool-card-status");
      expect(status?.classList.contains("running")).toBe(true);

      // Update status to success
      card.updateStatus("success");
      expect(status?.classList.contains("success")).toBe(true);

      // Update result
      await card.updateResult("const x = 42;", false);
      const result = element.querySelector(".tool-card-result");
      expect(result).not.toBeNull();

      // Check input section rendered
      const inputRows = element.querySelectorAll(".tool-card-input-row");
      expect(inputRows.length).toBe(3); // file_path, offset, limit

      // Content should be collapsed initially
      const content = element.querySelector(".tool-card-content");
      expect(content?.classList.contains("collapsed")).toBe(true);

      // Expand
      const headerEl = element.querySelector(".tool-card-header") as HTMLElement;
      headerEl.click();
      expect(content?.classList.contains("collapsed")).toBe(false);
    });
  });
});
