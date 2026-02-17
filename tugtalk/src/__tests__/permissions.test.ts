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
});
