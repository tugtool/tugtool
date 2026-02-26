/**
 * Tests for developer-card
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";
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
import { DeveloperCard } from "./developer-card";
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

describe("developer-card", () => {
  let connection: MockConnection;
  let card: DeveloperCard;
  let container: HTMLElement;

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
  });

  describe("constructor", () => {
    test("constructor accepts TugConnection", () => {
      expect(card).toBeDefined();
      expect(card.feedIds).toEqual([]);
    });

    test("card has no feedIds (receives data via action-dispatch)", () => {
      expect(card.feedIds.length).toBe(0);
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
      card.update({ type: "reloaded", changes: ["styles.css"] });

      const stylesStatus = container.querySelectorAll(".dev-status")[0] as HTMLElement;
      expect(stylesStatus.textContent).toBe("Reloaded");
    });

    test("update with type 'reloaded' returns to 'Clean' after timer", async () => {
      card.update({ type: "reloaded", changes: ["styles.css"] });

      // Wait for 2s timer
      await new Promise((resolve) => setTimeout(resolve, 2100));

      const stylesStatus = container.querySelectorAll(".dev-status")[0] as HTMLElement;
      expect(stylesStatus.textContent).toBe("Clean");
    });

    test("update with type 'restart_available' sets Code row to dirty", () => {
      card.update({ type: "restart_available", count: 3 });

      const codeDot = container.querySelectorAll(".dev-dot")[1] as HTMLElement;
      const codeStatus = container.querySelectorAll(".dev-status")[1] as HTMLElement;

      expect(codeDot.style.backgroundColor).toBe("var(--td-warning)");
      expect(codeStatus.textContent).toBe("3 changes");
    });

    test("update with type 'restart_available' shows Restart button", () => {
      card.update({ type: "restart_available", count: 1 });

      const restartBtn = Array.from(container.querySelectorAll(".dev-action-btn"))
        .find((btn) => btn.textContent === "Restart") as HTMLElement;

      expect(restartBtn.style.display).toBe("block");
    });

    test("update with type 'restart_available' count=1 shows '1 change'", () => {
      card.update({ type: "restart_available", count: 1 });

      const codeStatus = container.querySelectorAll(".dev-status")[1] as HTMLElement;
      expect(codeStatus.textContent).toBe("1 change");
    });

    test("update with type 'relaunch_available' sets App row to dirty", () => {
      card.update({ type: "relaunch_available", count: 2 });

      const appDot = container.querySelectorAll(".dev-dot")[2] as HTMLElement;
      const appStatus = container.querySelectorAll(".dev-status")[2] as HTMLElement;

      expect(appDot.style.backgroundColor).toBe("var(--td-warning)");
      expect(appStatus.textContent).toBe("2 changes");
    });

    test("update with type 'relaunch_available' shows Relaunch button", () => {
      card.update({ type: "relaunch_available", count: 1 });

      const relaunchBtn = Array.from(container.querySelectorAll(".dev-action-btn"))
        .find((btn) => btn.textContent === "Relaunch") as HTMLElement;

      expect(relaunchBtn.style.display).toBe("block");
    });
  });

  describe("button click handlers", () => {
    beforeEach(() => {
      card.mount(container);
      connection.clear();
    });

    test("Restart button click sends 'restart' control frame", () => {
      // Make Restart button visible
      card.update({ type: "restart_available", count: 1 });

      const restartBtn = Array.from(container.querySelectorAll(".dev-action-btn"))
        .find((btn) => btn.textContent === "Restart") as HTMLElement;

      restartBtn.click();

      expect(connection.sentControlFrames).toContain("restart");
    });

    test("Restart button click clears Code row state", () => {
      // Set dirty
      card.update({ type: "restart_available", count: 1 });

      const restartBtn = Array.from(container.querySelectorAll(".dev-action-btn"))
        .find((btn) => btn.textContent === "Restart") as HTMLElement;

      restartBtn.click();

      const codeDot = container.querySelectorAll(".dev-dot")[1] as HTMLElement;
      const codeStatus = container.querySelectorAll(".dev-status")[1] as HTMLElement;

      expect(codeDot.style.backgroundColor).toBe("var(--td-success)");
      expect(codeStatus.textContent).toBe("Clean");
      expect(restartBtn.style.display).toBe("none");
    });

    test("Restart button click clears dock badge", () => {
      card.update({ type: "restart_available", count: 1 });

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
      card.update({ type: "relaunch_available", count: 1 });

      const relaunchBtn = Array.from(container.querySelectorAll(".dev-action-btn"))
        .find((btn) => btn.textContent === "Relaunch") as HTMLElement;

      relaunchBtn.click();

      expect(connection.sentControlFrames).toContain("relaunch");
    });

    test("Relaunch button click clears App row state", () => {
      // Set dirty
      card.update({ type: "relaunch_available", count: 1 });

      const relaunchBtn = Array.from(container.querySelectorAll(".dev-action-btn"))
        .find((btn) => btn.textContent === "Relaunch") as HTMLElement;

      relaunchBtn.click();

      const appDot = container.querySelectorAll(".dev-dot")[2] as HTMLElement;
      const appStatus = container.querySelectorAll(".dev-status")[2] as HTMLElement;

      expect(appDot.style.backgroundColor).toBe("var(--td-success)");
      expect(appStatus.textContent).toBe("Clean");
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
      card.update({ type: "reloaded", changes: ["styles.css"] });

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
      card.update({ type: "restart_available", count: 1 });
      // Should not crash
    });
  });
});
