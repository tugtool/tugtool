import { describe, test, expect } from "bun:test";
import { PermissionManager } from "../permissions.ts";

describe("permissions.ts", () => {
  test("default mode is acceptEdits", () => {
    const pm = new PermissionManager();
    expect(pm.getMode()).toBe("acceptEdits");
  });

  test("setMode changes mode", () => {
    const pm = new PermissionManager();
    pm.setMode("default");
    expect(pm.getMode()).toBe("default");
    pm.setMode("bypassPermissions");
    expect(pm.getMode()).toBe("bypassPermissions");
    pm.setMode("plan");
    expect(pm.getMode()).toBe("plan");
  });

  test("setMode accepts dontAsk mode", () => {
    const pm = new PermissionManager();
    pm.setMode("dontAsk");
    expect(pm.getMode()).toBe("dontAsk");
  });

  test("setMode accepts delegate mode", () => {
    const pm = new PermissionManager();
    pm.setMode("delegate");
    expect(pm.getMode()).toBe("delegate");
  });

  test("setMode cycles through all valid modes", () => {
    const pm = new PermissionManager();
    const allModes = ["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk", "delegate"] as const;
    for (const mode of allModes) {
      pm.setMode(mode);
      expect(pm.getMode()).toBe(mode);
    }
  });
});
