import { describe, test, expect } from "bun:test";
import { createSDKAdapter } from "../sdk-adapter.ts";

describe("sdk-adapter.ts", () => {
  test("createSDKAdapter returns expected interface with all 6 methods", () => {
    const adapter = createSDKAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.createSession).toBe("function");
    expect(typeof adapter.resumeSession).toBe("function");
    expect(typeof adapter.sendMessage).toBe("function");
    expect(typeof adapter.streamResponse).toBe("function");
    expect(typeof adapter.cancelTurn).toBe("function");
    expect(typeof adapter.setPermissionMode).toBe("function");
  });

  test("createSession returns AdapterSession (requires API key)", async () => {
    // This test requires ANTHROPIC_API_KEY environment variable
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("Skipping createSession test (no API key)");
      return;
    }

    const adapter = createSDKAdapter();
    const session = await adapter.createSession({
      model: "claude-opus-4-20250514",
      cwd: process.cwd(),
    });

    expect(session).toBeDefined();
    expect(typeof session.send).toBe("function");
    expect(typeof session.stream).toBe("function");
    expect(typeof session.close).toBe("function");

    // Clean up
    session.close();
  });

  test("deprecated methods throw helpful errors", async () => {
    const adapter = createSDKAdapter();

    await expect(adapter.sendMessage("test-id", "hello")).rejects.toThrow("deprecated");
    await expect(adapter.streamResponse("test-id").next()).rejects.toThrow("deprecated");
    await expect(adapter.cancelTurn("test-id")).rejects.toThrow("deprecated");
    await expect(adapter.setPermissionMode("test-id", "default")).rejects.toThrow(
      "deprecated"
    );
  });
});
