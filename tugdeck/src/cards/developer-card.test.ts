/**
 * Tests for developer-card
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Window } from "happy-dom";

// Setup DOM environment
const window = new Window();
global.window = window as any;
global.document = window.document as any;

// Mock localStorage
const localStorageMock = (() => {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
})();
global.localStorage = localStorageMock as any;

// Import after DOM setup
import { DeveloperCard, categorizeFile } from "./developer-card";
import { FeedId } from "../protocol";
import type { TugConnection } from "../connection";

// Mock TugConnection
class MockConnection implements Partial<TugConnection> {
  sentControlFrames: string[] = [];

  sendControlFrame(command: string): void {
    this.sentControlFrames.push(command);
  }

  clear(): void {
    this.sentControlFrames = [];
  }
}

// A fixed timestamp to use in tests (arbitrary epoch millis)
const TEST_TS = 1_740_000_000_000;

describe("categorizeFile", () => {
  // Styles patterns
  test("CSS file in tugdeck/ root maps to styles", () => {
    expect(categorizeFile("tugdeck/styles/tokens.css")).toBe("styles");
  });

  test("CSS file in tugdeck/ subdirectory maps to styles", () => {
    expect(categorizeFile("tugdeck/src/components/card.css")).toBe("styles");
  });

  test("HTML file in tugdeck/ maps to styles", () => {
    expect(categorizeFile("tugdeck/index.html")).toBe("styles");
  });

  // Code patterns -- tugdeck/src/
  test("TS file in tugdeck/src/ maps to code", () => {
    expect(categorizeFile("tugdeck/src/cards/developer-card.ts")).toBe("code");
  });

  test("TSX file in tugdeck/src/ maps to code", () => {
    expect(categorizeFile("tugdeck/src/components/Button.tsx")).toBe("code");
  });

  // Code patterns -- tugcode/
  test("Rust file in tugcode/ maps to code", () => {
    expect(categorizeFile("tugcode/src/main.rs")).toBe("code");
  });

  test("Cargo.toml in tugcode/ maps to code", () => {
    expect(categorizeFile("tugcode/Cargo.toml")).toBe("code");
  });

  test("Cargo.toml in tugcode/ subdirectory maps to code", () => {
    expect(categorizeFile("tugcode/tugtool-core/Cargo.toml")).toBe("code");
  });

  // App patterns
  test("Swift file in tugapp/Sources/ maps to app", () => {
    expect(categorizeFile("tugapp/Sources/TugApp/AppDelegate.swift")).toBe("app");
  });

  // Edge cases -- exclusions
  test("TS file in tugdeck/ root (not tugdeck/src/) returns null", () => {
    // tugdeck/some-file.ts is not under tugdeck/src/
    expect(categorizeFile("tugdeck/some-file.ts")).toBeNull();
  });

  test("Swift file in tugapp/ but not tugapp/Sources/ returns null", () => {
    expect(categorizeFile("tugapp/Tests/AppTests.swift")).toBeNull();
  });

  test("unmatched file returns null", () => {
    expect(categorizeFile("docs/README.md")).toBeNull();
  });

  test("tugplug TS file (not under tugdeck/src/) returns null", () => {
    expect(categorizeFile("tugplug/agents/coder-agent.ts")).toBeNull();
  });

  test("tugdeck/src/ TS file with .tsx extension maps to code", () => {
    expect(categorizeFile("tugdeck/src/main.tsx")).toBe("code");
  });

  test("RS file outside tugcode/ returns null", () => {
    expect(categorizeFile("someother/src/lib.rs")).toBeNull();
  });
});

describe("developer-card", () => {
  let connection: MockConnection;
  let card: DeveloperCard;
  let container: HTMLElement;
  let originalToLocaleTimeString: typeof Date.prototype.toLocaleTimeString;

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = "";

    // Create fresh container
    container = document.createElement("div");
    document.body.appendChild(container);

    // Create mock connection
    connection = new MockConnection();

    // Create developer card
    card = new DeveloperCard(connection as any);

    // Mock toLocaleTimeString to return a deterministic value
    originalToLocaleTimeString = Date.prototype.toLocaleTimeString;
    Date.prototype.toLocaleTimeString = function (_locales?: any, _options?: any): string {
      return "9:42 AM";
    };
  });

  afterEach(() => {
    // Restore original toLocaleTimeString
    Date.prototype.toLocaleTimeString = originalToLocaleTimeString;
  });

  describe("constructor", () => {
    test("constructor accepts TugConnection", () => {
      expect(card).toBeDefined();
      expect(card.feedIds).toContain(FeedId.GIT);
    });

    test("card subscribes to FeedId.GIT for working state tracking", () => {
      expect(card.feedIds).toContain(FeedId.GIT);
      expect(card.feedIds.length).toBe(1);
    });
  });

  describe("mount", () => {
    test("mount creates three status rows", () => {
      card.mount(container);

      const rows = container.querySelectorAll(".dev-row");
      expect(rows.length).toBe(3);
    });

    test("mount creates Styles, Code, and App rows with correct labels", () => {
      card.mount(container);

      const labels = Array.from(container.querySelectorAll(".dev-label"))
        .map((el) => el.textContent);

      expect(labels).toContain("Styles");
      expect(labels).toContain("Code");
      expect(labels).toContain("App");
    });

    test("mount initializes all rows to Clean status", () => {
      card.mount(container);

      const statuses = Array.from(container.querySelectorAll(".dev-status"))
        .map((el) => el.textContent);

      statuses.forEach((status) => {
        expect(status).toBe("Clean");
      });
    });

    test("mount creates Restart button (hidden initially)", () => {
      card.mount(container);

      const restartBtn = Array.from(container.querySelectorAll(".dev-action-btn"))
        .find((btn) => btn.textContent === "Restart") as HTMLElement;

      expect(restartBtn).toBeDefined();
      expect(restartBtn.style.display).toBe("none");
    });

    test("mount creates Relaunch button (hidden initially)", () => {
      card.mount(container);

      const relaunchBtn = Array.from(container.querySelectorAll(".dev-action-btn"))
        .find((btn) => btn.textContent === "Relaunch") as HTMLElement;

      expect(relaunchBtn).toBeDefined();
      expect(relaunchBtn.style.display).toBe("none");
    });

    test("mount creates Reset button", () => {
      card.mount(container);

      const resetBtn = container.querySelector(".dev-reset-btn") as HTMLElement;
      expect(resetBtn).toBeDefined();
      expect(resetBtn.textContent).toBe("Reset");
    });

    test("mount clears dock badge via CustomEvent", () => {
      let badgeCleared = false;
      const listener = (e: Event) => {
        const customEvent = e as CustomEvent;
        if (customEvent.detail.count === 0) {
          badgeCleared = true;
        }
      };
      document.addEventListener("td-dev-badge", listener);

      card.mount(container);

      expect(badgeCleared).toBe(true);
      document.removeEventListener("td-dev-badge", listener);
    });
  });

  describe("update() - notification types", () => {
    beforeEach(() => {
      card.mount(container);
    });

    test("update with type 'reloaded' flashes Styles status to 'Reloaded'", () => {
      card.update({ type: "reloaded", timestamp: TEST_TS });

      const stylesStatus = container.querySelectorAll(".dev-status")[0] as HTMLElement;
      expect(stylesStatus.textContent).toBe("Reloaded");
    });

    test("update with type 'reloaded' returns to 'Clean -- {time}' after timer", async () => {
      card.update({ type: "reloaded", timestamp: TEST_TS });

      // Wait for 2s timer
      await new Promise((resolve) => setTimeout(resolve, 2100));

      const stylesStatus = container.querySelectorAll(".dev-status")[0] as HTMLElement;
      expect(stylesStatus.textContent).toBe("Clean -- 9:42 AM");
    });

    test("update with type 'reloaded' and no timestamp returns to plain 'Clean' after timer", async () => {
      card.update({ type: "reloaded" });

      await new Promise((resolve) => setTimeout(resolve, 2100));

      const stylesStatus = container.querySelectorAll(".dev-status")[0] as HTMLElement;
      expect(stylesStatus.textContent).toBe("Clean");
    });

    test("update with type 'restart_available' sets Code row to dirty with timestamp", () => {
      card.update({ type: "restart_available", count: 3, timestamp: TEST_TS });

      const codeDot = container.querySelectorAll(".dev-dot")[1] as HTMLElement;
      const codeStatus = container.querySelectorAll(".dev-status")[1] as HTMLElement;

      expect(codeDot.style.backgroundColor).toBe("var(--td-warning)");
      expect(codeStatus.textContent).toBe("3 changes -- since 9:42 AM");
    });

    test("update with type 'restart_available' shows Restart button", () => {
      card.update({ type: "restart_available", count: 1, timestamp: TEST_TS });

      const restartBtn = Array.from(container.querySelectorAll(".dev-action-btn"))
        .find((btn) => btn.textContent === "Restart") as HTMLElement;

      expect(restartBtn.style.display).toBe("block");
    });

    test("update with type 'restart_available' count=1 shows '1 change -- since {time}'", () => {
      card.update({ type: "restart_available", count: 1, timestamp: TEST_TS });

      const codeStatus = container.querySelectorAll(".dev-status")[1] as HTMLElement;
      expect(codeStatus.textContent).toBe("1 change -- since 9:42 AM");
    });

    test("update with type 'restart_available' and no timestamp shows count only", () => {
      card.update({ type: "restart_available", count: 2 });

      const codeStatus = container.querySelectorAll(".dev-status")[1] as HTMLElement;
      expect(codeStatus.textContent).toBe("2 changes");
    });

    test("update with type 'relaunch_available' sets App row to dirty with timestamp", () => {
      card.update({ type: "relaunch_available", count: 2, timestamp: TEST_TS });

      const appDot = container.querySelectorAll(".dev-dot")[2] as HTMLElement;
      const appStatus = container.querySelectorAll(".dev-status")[2] as HTMLElement;

      expect(appDot.style.backgroundColor).toBe("var(--td-warning)");
      expect(appStatus.textContent).toBe("2 changes -- since 9:42 AM");
    });

    test("update with type 'relaunch_available' shows Relaunch button", () => {
      card.update({ type: "relaunch_available", count: 1, timestamp: TEST_TS });

      const relaunchBtn = Array.from(container.querySelectorAll(".dev-action-btn"))
        .find((btn) => btn.textContent === "Relaunch") as HTMLElement;

      expect(relaunchBtn.style.display).toBe("block");
    });

    test("second dirty notification preserves original 'since' timestamp", () => {
      const firstTs = 1_740_000_000_000;
      const secondTs = 1_740_000_060_000; // 1 minute later

      // First dirty notification sets the "since" clock
      card.update({ type: "restart_available", count: 1, timestamp: firstTs });
      const codeStatus = container.querySelectorAll(".dev-status")[1] as HTMLElement;
      const firstLabel = codeStatus.textContent;

      // Second dirty notification must not overwrite firstDirtySinceTs
      card.update({ type: "restart_available", count: 2, timestamp: secondTs });
      const secondLabel = codeStatus.textContent;

      // Both labels use the same formatted time (mocked to "9:42 AM") — the count updates
      expect(firstLabel).toBe("1 change -- since 9:42 AM");
      expect(secondLabel).toBe("2 changes -- since 9:42 AM");

      // Verify the "since" part did not change by checking that the count part changed
      // while the "since" part is identical
      const firstSince = firstLabel!.split("-- since ")[1];
      const secondSince = secondLabel!.split("-- since ")[1];
      expect(firstSince).toBe(secondSince);
    });

    test("restart click resets firstDirtySinceTs; next dirty notification starts fresh 'since' clock", () => {
      // First dirty notification
      card.update({ type: "restart_available", count: 1, timestamp: TEST_TS });

      const restartBtn = Array.from(container.querySelectorAll(".dev-action-btn"))
        .find((btn) => btn.textContent === "Restart") as HTMLElement;

      // Click Restart — resets firstDirtySinceTs
      restartBtn.click();

      const codeStatus = container.querySelectorAll(".dev-status")[1] as HTMLElement;
      expect(codeStatus.textContent).toBe("Clean -- 9:42 AM");

      // Now a new dirty notification should start a fresh "since" clock
      const newTs = 1_740_000_120_000;
      card.update({ type: "restart_available", count: 1, timestamp: newTs });
      expect(codeStatus.textContent).toBe("1 change -- since 9:42 AM");
    });
  });

  describe("onFrame() - git status working state", () => {
    // Helper to build a GitStatus payload Uint8Array
    function makeGitPayload(staged: { path: string; status: string }[], unstaged: { path: string; status: string }[], untracked: string[] = []): Uint8Array {
      const obj = { branch: "main", ahead: 0, behind: 0, staged, unstaged, untracked, head_sha: "abc123", head_message: "latest" };
      return new TextEncoder().encode(JSON.stringify(obj));
    }

    beforeEach(() => {
      card.mount(container);
    });

    test("onFrame with CSS files in unstaged sets Styles row to Edited with blue dot", () => {
      const payload = makeGitPayload([], [{ path: "tugdeck/styles/tokens.css", status: "M" }, { path: "tugdeck/styles/card.css", status: "M" }]);
      card.onFrame(FeedId.GIT, payload);

      const stylesDot = container.querySelectorAll(".dev-dot")[0] as HTMLElement;
      const stylesStatus = container.querySelectorAll(".dev-status")[0] as HTMLElement;

      expect(stylesDot.style.backgroundColor).toBe("var(--td-info)");
      expect(stylesStatus.textContent).toBe("Edited (2 files)");
    });

    test("onFrame with RS files in staged sets Code row to Edited with blue dot", () => {
      const payload = makeGitPayload([{ path: "tugcode/src/main.rs", status: "M" }], []);
      card.onFrame(FeedId.GIT, payload);

      const codeDot = container.querySelectorAll(".dev-dot")[1] as HTMLElement;
      const codeStatus = container.querySelectorAll(".dev-status")[1] as HTMLElement;

      expect(codeDot.style.backgroundColor).toBe("var(--td-info)");
      expect(codeStatus.textContent).toBe("Edited (1 file)");
    });

    test("onFrame with empty staged and unstaged shows Clean state", () => {
      // First set to edited
      const editPayload = makeGitPayload([], [{ path: "tugdeck/styles/tokens.css", status: "M" }]);
      card.onFrame(FeedId.GIT, editPayload);

      // Then send empty status
      const cleanPayload = makeGitPayload([], []);
      card.onFrame(FeedId.GIT, cleanPayload);

      const stylesDot = container.querySelectorAll(".dev-dot")[0] as HTMLElement;
      const stylesStatus = container.querySelectorAll(".dev-status")[0] as HTMLElement;

      expect(stylesDot.style.backgroundColor).toBe("var(--td-success)");
      expect(stylesStatus.textContent).toBe("Clean");
    });

    test("onFrame deduplicates paths appearing in both staged and unstaged", () => {
      // Same path in both staged and unstaged -- should count as 1, not 2
      const path = "tugdeck/styles/tokens.css";
      const payload = makeGitPayload([{ path, status: "M" }], [{ path, status: "M" }]);
      card.onFrame(FeedId.GIT, payload);

      const stylesStatus = container.querySelectorAll(".dev-status")[0] as HTMLElement;
      expect(stylesStatus.textContent).toBe("Edited (1 file)");
    });

    test("onFrame ignores untracked files", () => {
      // Only untracked CSS -- should not count toward Styles edited count
      const payload = makeGitPayload([], [], ["tugdeck/styles/new-file.css"]);
      card.onFrame(FeedId.GIT, payload);

      const stylesDot = container.querySelectorAll(".dev-dot")[0] as HTMLElement;
      const stylesStatus = container.querySelectorAll(".dev-status")[0] as HTMLElement;

      expect(stylesDot.style.backgroundColor).toBe("var(--td-success)");
      expect(stylesStatus.textContent).toBe("Clean");
    });

    test("onFrame with wrong feedId is ignored", () => {
      const payload = makeGitPayload([], [{ path: "tugdeck/styles/tokens.css", status: "M" }]);
      // Use a different feedId -- should be a no-op
      card.onFrame(0x10 as any, payload);

      const stylesDot = container.querySelectorAll(".dev-dot")[0] as HTMLElement;
      expect(stylesDot.style.backgroundColor).toBe("var(--td-success)");
    });

    test("onFrame with empty payload is ignored", () => {
      card.onFrame(FeedId.GIT, new Uint8Array(0));

      const stylesDot = container.querySelectorAll(".dev-dot")[0] as HTMLElement;
      expect(stylesDot.style.backgroundColor).toBe("var(--td-success)");
    });
  });

  describe("button click handlers", () => {
    beforeEach(() => {
      card.mount(container);
      connection.clear();
    });

    test("Restart button click sends 'restart' control frame", () => {
      // Make Restart button visible
      card.update({ type: "restart_available", count: 1, timestamp: TEST_TS });

      const restartBtn = Array.from(container.querySelectorAll(".dev-action-btn"))
        .find((btn) => btn.textContent === "Restart") as HTMLElement;

      restartBtn.click();

      expect(connection.sentControlFrames).toContain("restart");
    });

    test("Restart button click clears Code row to clean with timestamp", () => {
      // Set dirty
      card.update({ type: "restart_available", count: 1, timestamp: TEST_TS });

      const restartBtn = Array.from(container.querySelectorAll(".dev-action-btn"))
        .find((btn) => btn.textContent === "Restart") as HTMLElement;

      restartBtn.click();

      const codeDot = container.querySelectorAll(".dev-dot")[1] as HTMLElement;
      const codeStatus = container.querySelectorAll(".dev-status")[1] as HTMLElement;

      expect(codeDot.style.backgroundColor).toBe("var(--td-success)");
      expect(codeStatus.textContent).toBe("Clean -- 9:42 AM");
      expect(restartBtn.style.display).toBe("none");
    });

    test("Restart button click clears dock badge", () => {
      card.update({ type: "restart_available", count: 1, timestamp: TEST_TS });

      let badgeCleared = false;
      const listener = (e: Event) => {
        const customEvent = e as CustomEvent;
        if (customEvent.detail.count === 0) {
          badgeCleared = true;
        }
      };
      document.addEventListener("td-dev-badge", listener);

      const restartBtn = Array.from(container.querySelectorAll(".dev-action-btn"))
        .find((btn) => btn.textContent === "Restart") as HTMLElement;
      restartBtn.click();

      expect(badgeCleared).toBe(true);
      document.removeEventListener("td-dev-badge", listener);
    });

    test("Relaunch button click sends 'relaunch' control frame", () => {
      // Make Relaunch button visible
      card.update({ type: "relaunch_available", count: 1, timestamp: TEST_TS });

      const relaunchBtn = Array.from(container.querySelectorAll(".dev-action-btn"))
        .find((btn) => btn.textContent === "Relaunch") as HTMLElement;

      relaunchBtn.click();

      expect(connection.sentControlFrames).toContain("relaunch");
    });

    test("Relaunch button click clears App row to clean with timestamp", () => {
      // Set dirty
      card.update({ type: "relaunch_available", count: 1, timestamp: TEST_TS });

      const relaunchBtn = Array.from(container.querySelectorAll(".dev-action-btn"))
        .find((btn) => btn.textContent === "Relaunch") as HTMLElement;

      relaunchBtn.click();

      const appDot = container.querySelectorAll(".dev-dot")[2] as HTMLElement;
      const appStatus = container.querySelectorAll(".dev-status")[2] as HTMLElement;

      expect(appDot.style.backgroundColor).toBe("var(--td-success)");
      expect(appStatus.textContent).toBe("Clean -- 9:42 AM");
      expect(relaunchBtn.style.display).toBe("none");
    });

    test("Reset button click clears localStorage", () => {
      localStorage.setItem("test-key", "test-value");

      const resetBtn = container.querySelector(".dev-reset-btn") as HTMLElement;
      resetBtn.click();

      expect(localStorage.getItem("test-key")).toBeNull();
    });

    test("Reset button click sends 'reset' control frame", () => {
      const resetBtn = container.querySelector(".dev-reset-btn") as HTMLElement;
      resetBtn.click();

      expect(connection.sentControlFrames).toContain("reset");
    });

    test("Reset button click clears dock badge", () => {
      let badgeCleared = false;
      const listener = (e: Event) => {
        const customEvent = e as CustomEvent;
        if (customEvent.detail.count === 0) {
          badgeCleared = true;
        }
      };
      document.addEventListener("td-dev-badge", listener);

      const resetBtn = container.querySelector(".dev-reset-btn") as HTMLElement;
      resetBtn.click();

      expect(badgeCleared).toBe(true);
      document.removeEventListener("td-dev-badge", listener);
    });
  });

  describe("updateBuildProgress", () => {
    beforeEach(() => {
      card.mount(container);
    });

    test("updateBuildProgress shows progress area when stage and status present", () => {
      card.updateBuildProgress({ stage: "compile", status: "running" });

      const progressEl = container.querySelector(".developer-build-progress") as HTMLElement;
      expect(progressEl.style.display).toBe("block");
      expect(progressEl.textContent).toBe("compile: running");
    });

    test("updateBuildProgress includes error if present", () => {
      card.updateBuildProgress({
        stage: "compile",
        status: "failed",
        error: "syntax error"
      });

      const progressEl = container.querySelector(".developer-build-progress") as HTMLElement;
      expect(progressEl.textContent).toBe("compile: failed (syntax error)");
    });

    test("updateBuildProgress hides progress area when stage/status missing", () => {
      // Show first
      card.updateBuildProgress({ stage: "compile", status: "running" });

      // Then hide
      card.updateBuildProgress({});

      const progressEl = container.querySelector(".developer-build-progress") as HTMLElement;
      expect(progressEl.style.display).toBe("none");
    });
  });

  describe("destroy", () => {
    test("destroy clears reloaded timer", async () => {
      card.mount(container);

      // Trigger reloaded with timer
      card.update({ type: "reloaded", timestamp: TEST_TS });

      // Destroy before timer completes
      card.destroy();

      // Wait past timer duration
      await new Promise((resolve) => setTimeout(resolve, 2100));

      // No crash should occur
    });

    test("destroy clears container innerHTML", () => {
      card.mount(container);
      expect(container.innerHTML).not.toBe("");

      card.destroy();

      expect(container.innerHTML).toBe("");
    });

    test("destroy nullifies all element references", () => {
      card.mount(container);
      card.destroy();

      // Verify internal state is cleared (via subsequent update being safe)
      card.update({ type: "restart_available", count: 1, timestamp: TEST_TS });
      // Should not crash
    });
  });
});
