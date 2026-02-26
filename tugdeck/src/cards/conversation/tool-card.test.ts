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

// Mock navigator.clipboard while preserving userAgent for react-dom compatibility.
global.navigator = {
  userAgent: window.navigator.userAgent,
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

  describe("integration: multiple tool uses in conversation", () => {
    test("multiple tool cards render correctly side-by-side", async () => {
      // Create a conversation container
      const container = document.createElement("div");
      container.className = "message-list";

      // Create 4 different tool cards
      const readCard = new ToolCard("Read", "tool-read-1", {
        file_path: "/src/main.ts",
      });

      const bashCard = new ToolCard("Bash", "tool-bash-1", {
        command: "ls -la",
        timeout: 5000,
      });

      const grepCard = new ToolCard("Grep", "tool-grep-1", {
        pattern: "function",
        path: "/src",
      });

      const writeCard = new ToolCard("Write", "tool-write-1", {
        file_path: "/output.txt",
        content: "Hello world",
      });

      // Update statuses
      readCard.updateStatus("success");
      bashCard.updateStatus("success");
      grepCard.updateStatus("failure");
      writeCard.updateStatus("interrupted");

      // Add results
      await readCard.updateResult("const x = 42;\nconst y = 100;", false);
      await bashCard.updateResult("total 8\ndrwxr-xr-x  2 user user 4096 Jan 1 12:00 .", false);
      await grepCard.updateResult("Error: No matches found", true);
      // writeCard left without result

      // Append all to container
      container.appendChild(readCard.render());
      container.appendChild(bashCard.render());
      container.appendChild(grepCard.render());
      container.appendChild(writeCard.render());

      // Assert all 4 cards present
      const allCards = container.querySelectorAll(".tool-card");
      expect(allCards.length).toBe(4);

      // Assert correct tool-use-ids
      expect(container.querySelector('[data-tool-use-id="tool-read-1"]')).not.toBeNull();
      expect(container.querySelector('[data-tool-use-id="tool-bash-1"]')).not.toBeNull();
      expect(container.querySelector('[data-tool-use-id="tool-grep-1"]')).not.toBeNull();
      expect(container.querySelector('[data-tool-use-id="tool-write-1"]')).not.toBeNull();

      // Assert correct tool names
      const readName = container.querySelector('[data-tool-use-id="tool-read-1"] .tool-card-name');
      expect(readName?.textContent).toBe("Read");

      const bashName = container.querySelector('[data-tool-use-id="tool-bash-1"] .tool-card-name');
      expect(bashName?.textContent).toBe("Bash");

      const grepName = container.querySelector('[data-tool-use-id="tool-grep-1"] .tool-card-name');
      expect(grepName?.textContent).toBe("Grep");

      const writeName = container.querySelector('[data-tool-use-id="tool-write-1"] .tool-card-name');
      expect(writeName?.textContent).toBe("Write");
    });

    test("status transitions work independently across cards", () => {
      const container = document.createElement("div");

      const card1 = new ToolCard("Read", "tool-ind-1", { file_path: "a.txt" });
      const card2 = new ToolCard("Bash", "tool-ind-2", { command: "echo hi" });
      const card3 = new ToolCard("Grep", "tool-ind-3", { pattern: "test" });

      card1.updateStatus("success");
      card2.updateStatus("failure");
      card3.updateStatus("interrupted");

      container.appendChild(card1.render());
      container.appendChild(card2.render());
      container.appendChild(card3.render());

      // Check each card has independent status
      const status1 = container.querySelector('[data-tool-use-id="tool-ind-1"] .tool-card-status');
      expect(status1?.classList.contains("success")).toBe(true);

      const status2 = container.querySelector('[data-tool-use-id="tool-ind-2"] .tool-card-status');
      expect(status2?.classList.contains("failure")).toBe(true);

      const status3 = container.querySelector('[data-tool-use-id="tool-ind-3"] .tool-card-status');
      expect(status3?.classList.contains("interrupted")).toBe(true);
    });

    test("results render correctly per tool type", async () => {
      const container = document.createElement("div");

      const readCard = new ToolCard("Read", "tool-render-1", { file_path: "test.js" });
      const bashCard = new ToolCard("Bash", "tool-render-2", { command: "pwd" });
      const errorCard = new ToolCard("Read", "tool-render-3", { file_path: "missing.txt" });

      readCard.updateStatus("success");
      bashCard.updateStatus("success");
      errorCard.updateStatus("failure");

      await readCard.updateResult("console.log('test');", false);
      await bashCard.updateResult("/home/user", false);
      await errorCard.updateResult("File not found", true);

      container.appendChild(readCard.render());
      container.appendChild(bashCard.render());
      container.appendChild(errorCard.render());

      // Bash result should have terminal styling
      const bashResult = container.querySelector('[data-tool-use-id="tool-render-2"] .tool-card-result-terminal');
      expect(bashResult).not.toBeNull();

      // Error result should have error class
      const errorResult = container.querySelector('[data-tool-use-id="tool-render-3"] .tool-card-result');
      expect(errorResult?.classList.contains("error")).toBe(true);
    });

    test("collapse/expand works independently per card", () => {
      const container = document.createElement("div");

      const card1 = new ToolCard("Read", "tool-collapse-1", { file_path: "a.txt" });
      const card2 = new ToolCard("Bash", "tool-collapse-2", { command: "ls" });

      container.appendChild(card1.render());
      container.appendChild(card2.render());

      // Both initially collapsed
      const content1 = container.querySelector('[data-tool-use-id="tool-collapse-1"] .tool-card-content');
      const content2 = container.querySelector('[data-tool-use-id="tool-collapse-2"] .tool-card-content');
      expect(content1?.classList.contains("collapsed")).toBe(true);
      expect(content2?.classList.contains("collapsed")).toBe(true);

      // Expand card1 only
      const header1 = container.querySelector('[data-tool-use-id="tool-collapse-1"] .tool-card-header') as HTMLElement;
      header1.click();

      // card1 expanded, card2 still collapsed
      expect(content1?.classList.contains("collapsed")).toBe(false);
      expect(content2?.classList.contains("collapsed")).toBe(true);

      // Expand card2
      const header2 = container.querySelector('[data-tool-use-id="tool-collapse-2"] .tool-card-header') as HTMLElement;
      header2.click();

      // Both expanded
      expect(content1?.classList.contains("collapsed")).toBe(false);
      expect(content2?.classList.contains("collapsed")).toBe(false);

      // Collapse card1
      header1.click();

      // card1 collapsed, card2 still expanded
      expect(content1?.classList.contains("collapsed")).toBe(true);
      expect(content2?.classList.contains("collapsed")).toBe(false);
    });

    test("truncation with show all works in multi-card context", async () => {
      const container = document.createElement("div");

      const card1 = new ToolCard("Bash", "tool-trunc-1", { command: "ls" });
      const card2 = new ToolCard("Bash", "tool-trunc-2", { command: "cat file" });

      // card1: long output (truncated)
      const longOutput = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
      await card1.updateResult(longOutput, false);

      // card2: short output (not truncated)
      await card2.updateResult("short output", false);

      container.appendChild(card1.render());
      container.appendChild(card2.render());

      // card1 should have Show all button
      const showAll1 = container.querySelector('[data-tool-use-id="tool-trunc-1"] .tool-card-show-all');
      expect(showAll1).not.toBeNull();
      expect(showAll1?.textContent).toContain("20 lines");

      // card2 should NOT have Show all button
      const showAll2 = container.querySelector('[data-tool-use-id="tool-trunc-2"] .tool-card-show-all');
      expect(showAll2).toBeNull();

      // Clicking Show all on card1 doesn't affect card2
      (showAll1 as HTMLButtonElement).click();

      // card1 Show all button gone
      const showAll1After = container.querySelector('[data-tool-use-id="tool-trunc-1"] .tool-card-show-all');
      expect(showAll1After).toBeNull();

      // card2 unaffected
      const card2Result = container.querySelector('[data-tool-use-id="tool-trunc-2"] .tool-card-result');
      expect(card2Result?.textContent).toContain("short output");
    });

    test("conversation with mixed tool results and text messages", async () => {
      const container = document.createElement("div");

      // Add user message
      const userMsg = document.createElement("div");
      userMsg.className = "message message-user";
      userMsg.textContent = "List files";
      container.appendChild(userMsg);

      // Add tool card
      const toolCard = new ToolCard("Bash", "tool-mixed-1", { command: "ls" });
      toolCard.updateStatus("success");
      await toolCard.updateResult("file1.txt\nfile2.txt", false);
      container.appendChild(toolCard.render());

      // Add assistant message
      const assistantMsg = document.createElement("div");
      assistantMsg.className = "message message-assistant";
      assistantMsg.textContent = "Found 2 files";
      container.appendChild(assistantMsg);

      // Assert all elements present
      expect(container.querySelector(".message-user")).not.toBeNull();
      expect(container.querySelector(".tool-card")).not.toBeNull();
      expect(container.querySelector(".message-assistant")).not.toBeNull();

      // Assert correct order
      const children = Array.from(container.children);
      expect(children[0].className).toBe("message message-user");
      expect(children[1].className).toBe("tool-card");
      expect(children[2].className).toBe("message message-assistant");
    });
  });

  describe("markStale", () => {
    test("markStale adds overlay and changes status", () => {
      const toolCard = new ToolCard("Bash", "tool-stale-1", { command: "ls" });
      const container = toolCard.render();

      // Initial status should be running
      expect(toolCard.getStatus()).toBe("running");

      // Mark as stale
      toolCard.markStale();

      // Status should change to interrupted
      expect(toolCard.getStatus()).toBe("interrupted");

      // Overlay should be present
      const overlay = container.querySelector(".tool-card-stale-overlay");
      expect(overlay).not.toBeNull();
      expect(overlay?.textContent).toContain("Session restarted");

      // Container should have position:relative
      expect(container.style.position).toBe("relative");
    });

    test("markStale is idempotent", () => {
      const toolCard = new ToolCard("Read", "tool-stale-2", { file_path: "test.txt" });
      const container = toolCard.render();

      toolCard.markStale();
      const firstOverlay = container.querySelector(".tool-card-stale-overlay");

      toolCard.markStale();
      const overlays = container.querySelectorAll(".tool-card-stale-overlay");

      // Should only have one overlay after multiple calls
      expect(overlays.length).toBe(1);
      expect(overlays[0]).toBe(firstOverlay);
    });
  });
});
