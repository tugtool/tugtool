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

  test("createSession throws not implemented (Step 1)", async () => {
    const adapter = createSDKAdapter();
    await expect(adapter.createSession({ model: "claude-opus-4-20250514" })).rejects.toThrow(
      "not yet implemented"
    );
  });

  test("resumeSession throws not implemented (Step 1)", async () => {
    const adapter = createSDKAdapter();
    await expect(
      adapter.resumeSession("test-session-id", { model: "claude-opus-4-20250514" })
    ).rejects.toThrow("not yet implemented");
  });

  test("sendMessage throws not implemented (Step 1)", async () => {
    const adapter = createSDKAdapter();
    await expect(adapter.sendMessage("test-id", "hello")).rejects.toThrow(
      "not yet implemented"
    );
  });

  test("streamResponse throws not implemented (Step 1)", async () => {
    const adapter = createSDKAdapter();
    const gen = adapter.streamResponse("test-id");
    await expect(gen.next()).rejects.toThrow("not yet implemented");
  });

  test("cancelTurn throws not implemented (Step 1)", async () => {
    const adapter = createSDKAdapter();
    await expect(adapter.cancelTurn("test-id")).rejects.toThrow("not yet implemented");
  });

  test("setPermissionMode throws not implemented (Step 1)", async () => {
    const adapter = createSDKAdapter();
    await expect(adapter.setPermissionMode("test-id", "default")).rejects.toThrow(
      "not yet implemented"
    );
  });
});
