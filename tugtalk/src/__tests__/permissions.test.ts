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
  });

  test("bypassPermissions auto-allows everything", async () => {
    const pm = new PermissionManager();
    pm.setMode("bypassPermissions");

    const callback = pm.createCanUseToolCallback(
      () => "req-123",
      async () => "allow"
    );

    const result = await callback("Bash", { command: "rm -rf /" });
    expect(result.behavior).toBe("allow");
  });

  test("plan mode denies everything", async () => {
    const pm = new PermissionManager();
    pm.setMode("plan");

    const callback = pm.createCanUseToolCallback(
      () => "req-123",
      async () => "allow"
    );

    const result = await callback("Read", { file: "test.txt" });
    expect(result.behavior).toBe("deny");
    expect(result.message).toContain("Plan mode");
  });

  test("acceptEdits auto-allows safe tools", async () => {
    const pm = new PermissionManager();
    pm.setMode("acceptEdits");

    const callback = pm.createCanUseToolCallback(
      () => "req-123",
      async () => "deny" // Should not be called
    );

    for (const tool of ["Read", "Edit", "Write", "Glob", "Grep"]) {
      const result = await callback(tool, {});
      expect(result.behavior).toBe("allow");
    }
  });

  test("acceptEdits prompts for Bash", async () => {
    const pm = new PermissionManager();
    pm.setMode("acceptEdits");

    let emittedRequest: string | null = null;
    const callback = pm.createCanUseToolCallback(
      (toolName, input) => {
        emittedRequest = `${toolName}`;
        return "req-123";
      },
      async (requestId) => {
        expect(requestId).toBe("req-123");
        return "allow";
      }
    );

    const result = await callback("Bash", { command: "ls" });
    expect(emittedRequest).toBe("Bash");
    expect(result.behavior).toBe("allow");
  });

  test("default mode prompts for everything", async () => {
    const pm = new PermissionManager();
    pm.setMode("default");

    let promptCount = 0;
    const callback = pm.createCanUseToolCallback(
      () => {
        promptCount++;
        return `req-${promptCount}`;
      },
      async () => "allow"
    );

    await callback("Read", {});
    await callback("Bash", {});
    await callback("Edit", {});

    expect(promptCount).toBe(3);
  });

  test("dynamic mode switch mid-session", async () => {
    const pm = new PermissionManager();

    // Start in default mode
    pm.setMode("default");
    let callback = pm.createCanUseToolCallback(
      () => "req-1",
      async () => "allow"
    );
    let result = await callback("Bash", {});
    expect(result.behavior).toBe("allow");

    // Switch to plan mode
    pm.setMode("plan");
    callback = pm.createCanUseToolCallback(
      () => "req-2",
      async () => "allow"
    );
    result = await callback("Bash", {});
    expect(result.behavior).toBe("deny");

    // Switch to bypassPermissions
    pm.setMode("bypassPermissions");
    callback = pm.createCanUseToolCallback(
      () => "req-3",
      async () => "deny"
    );
    result = await callback("Bash", {});
    expect(result.behavior).toBe("allow");
  });

  test("user denies tool approval", async () => {
    const pm = new PermissionManager();
    pm.setMode("default");

    const callback = pm.createCanUseToolCallback(
      () => "req-123",
      async () => "deny"
    );

    const result = await callback("Bash", { command: "ls" });
    expect(result.behavior).toBe("deny");
    expect(result.message).toContain("denied");
  });
});
