import { describe, test, expect, mock } from "bun:test";
import { createSDKAdapter } from "../sdk-adapter.ts";

describe("sdk-adapter.ts", () => {
  test("createSDKAdapter returns expected interface", () => {
    const adapter = createSDKAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.createSession).toBe("function");
    expect(typeof adapter.resumeSession).toBe("function");
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

  describe("SDK option passthrough", () => {
    test("cwd is passed directly to SDK", async () => {
      let capturedOptions: any = null;

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

      const { createSDKAdapter: createMockedAdapter } = await import("../sdk-adapter.ts");
      const adapter = createMockedAdapter();

      await adapter.createSession({
        model: "claude-opus-4-6",
        cwd: "/test/dir",
      });

      expect(capturedOptions.cwd).toBe("/test/dir");
      expect(capturedOptions.includePartialMessages).toBe(true);
    });

    test("cwd is undefined when not set", async () => {
      let capturedOptions: any = null;

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

      const { createSDKAdapter: createMockedAdapter } = await import("../sdk-adapter.ts");
      const adapter = createMockedAdapter();

      await adapter.createSession({
        model: "claude-opus-4-6",
      });

      expect(capturedOptions.cwd).toBeUndefined();
    });

    test("permissionMode is passed through", async () => {
      let capturedOptions: any = null;

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

      const { createSDKAdapter: createMockedAdapter } = await import("../sdk-adapter.ts");
      const adapter = createMockedAdapter();

      await adapter.createSession({
        model: "claude-opus-4-6",
        permissionMode: "acceptEdits",
      });

      expect(capturedOptions.permissionMode).toBe("acceptEdits");
    });

    test("onStderr callback is passed through as stderr", async () => {
      let capturedOptions: any = null;

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

      const { createSDKAdapter: createMockedAdapter } = await import("../sdk-adapter.ts");
      const adapter = createMockedAdapter();

      const stderrCallback = (data: string) => {};

      await adapter.createSession({
        model: "claude-opus-4-6",
        onStderr: stderrCallback,
      });

      expect(capturedOptions.stderr).toBe(stderrCallback);
    });
  });
});
