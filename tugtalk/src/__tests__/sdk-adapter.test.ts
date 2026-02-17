import { describe, test, expect, mock } from "bun:test";
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
      model: "claude-opus-4-6",
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

  describe("env merging regression tests", () => {
    test("env merging includes process.env when cwd is set", async () => {
      // Capture what gets passed to the SDK
      let capturedOptions: any = null;

      // Mock the SDK module to intercept calls
      const fakeSession = {
        sessionId: "fake-session-id",
        send: async () => {},
        stream: async function* () {},
        close: () => {},
      };

      mock.module("@anthropic-ai/claude-agent-sdk", () => ({
        unstable_v2_createSession: (opts: any) => {
          capturedOptions = opts;
          return fakeSession;
        },
        unstable_v2_resumeSession: (id: string, opts: any) => {
          capturedOptions = opts;
          return fakeSession;
        },
      }));

      // Dynamically import to get the mocked version
      const { createSDKAdapter: createMockedAdapter } = await import("../sdk-adapter.ts");
      const adapter = createMockedAdapter();

      // Call createSession with cwd set
      await adapter.createSession({
        model: "claude-opus-4-6",
        cwd: "/test/dir",
      });

      // Verify env was constructed correctly
      expect(capturedOptions.env).toBeDefined();
      expect(capturedOptions.env.PWD).toBe("/test/dir");
      expect(capturedOptions.env.PATH).toBeDefined();
      expect(capturedOptions.env.HOME).toBeDefined();
    });

    test("env is undefined when cwd is not set", async () => {
      // Capture what gets passed to the SDK
      let capturedOptions: any = null;

      // Mock the SDK module
      const fakeSession = {
        sessionId: "fake-session-id",
        send: async () => {},
        stream: async function* () {},
        close: () => {},
      };

      mock.module("@anthropic-ai/claude-agent-sdk", () => ({
        unstable_v2_createSession: (opts: any) => {
          capturedOptions = opts;
          return fakeSession;
        },
        unstable_v2_resumeSession: (id: string, opts: any) => {
          capturedOptions = opts;
          return fakeSession;
        },
      }));

      // Dynamically import to get the mocked version
      const { createSDKAdapter: createMockedAdapter } = await import("../sdk-adapter.ts");
      const adapter = createMockedAdapter();

      // Call createSession without cwd
      await adapter.createSession({
        model: "claude-opus-4-6",
      });

      // Verify env is undefined
      expect(capturedOptions.env).toBeUndefined();
    });
  });
});
