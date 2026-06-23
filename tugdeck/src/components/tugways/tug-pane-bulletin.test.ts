import { describe, expect, test } from "bun:test";

import { mapOptions, scopedToastId } from "./tug-pane-bulletin";

describe("mapOptions", () => {
  test("always carries the toasterId scope", () => {
    expect(mapOptions("pane-1")).toEqual({ toasterId: "pane-1" });
  });

  test("threads a stable id, namespaced under the pane, so repeat posts replace in place", () => {
    const result = mapOptions("pane-1", { id: "api-retry" });
    expect(result.id).toBe(scopedToastId("pane-1", "api-retry"));
    expect(result.toasterId).toBe("pane-1");
  });

  test("the same logical id under different panes never collides", () => {
    const a = mapOptions("pane-1", { id: "notice-api-retry" });
    const b = mapOptions("pane-2", { id: "notice-api-retry" });
    expect(a.id).not.toBe(b.id);
  });

  test("passes description and duration through", () => {
    const result = mapOptions("pane-1", {
      description: "Reconnecting…",
      duration: 4000,
    });
    expect(result.description).toBe("Reconnecting…");
    expect(result.duration).toBe(4000);
  });

  test("sticky never auto-dismisses and renders an OK button", () => {
    const result = mapOptions("pane-1", { sticky: true });
    expect(result.duration).toBe(Infinity);
    expect(result.action).toEqual({
      label: "OK",
      onClick: expect.any(Function),
    });
  });

  test("sticky honors a custom okLabel and ignores duration/action", () => {
    const result = mapOptions("pane-1", {
      sticky: true,
      okLabel: "Got it",
      duration: 4000,
      action: { label: "Retry", onClick: () => {} },
    });
    expect(result.duration).toBe(Infinity);
    expect((result.action as { label: string }).label).toBe("Got it");
  });

  test("a plain action is forwarded when not sticky", () => {
    const onClick = () => {};
    const result = mapOptions("pane-1", { action: { label: "Undo", onClick } });
    expect(result.action).toEqual({ label: "Undo", onClick });
  });
});
