/**
 * local-model-bridge — the deck's side of the host's `localModel` handler.
 *
 * The contract worth pinning is the degradation one: absent host, host that
 * never answers, and host that answers a failure all resolve to the same
 * "no opinion" value, so no caller ever needs a try/catch.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";

import {
  isLocalModelBridgeAvailable,
  requestAvailability,
  requestClassify,
  requestSummarize,
  _resetLocalModelBridgeForTest,
} from "../local-model-bridge";

interface Posted {
  v: number;
  requestId: string;
  task: string;
  [key: string]: unknown;
}

const g = globalThis as unknown as {
  webkit?: unknown;
  __tugBridge?: { onLocalModelResult?: (r: Record<string, unknown>) => void };
};

let posted: Posted[] = [];

/** Stand up a host that records posts and never answers on its own. */
function installHost(): void {
  posted = [];
  g.webkit = {
    messageHandlers: {
      localModel: {
        postMessage: (value: unknown) => {
          posted.push(value as Posted);
        },
      },
    },
  };
}

function removeHost(): void {
  delete g.webkit;
}

/** Answer the most recent post the way the host would. */
function answer(fields: Record<string, unknown>): void {
  const last = posted[posted.length - 1];
  g.__tugBridge?.onLocalModelResult?.({ requestId: last?.requestId, ...fields });
}

beforeEach(() => {
  _resetLocalModelBridgeForTest();
  installHost();
});

afterEach(() => {
  removeHost();
  _resetLocalModelBridgeForTest();
});

describe("without a host", () => {
  test("the bridge reports itself unavailable", () => {
    removeHost();
    expect(isLocalModelBridgeAvailable()).toBe(false);
  });

  test("every helper answers the degraded value without throwing", async () => {
    removeHost();
    expect(await requestClassify("git status")).toBeNull();
    expect(await requestSummarize("a digest")).toBeNull();
    expect((await requestAvailability()).ready).toBe(false);
  });
});

describe("with a host", () => {
  test("classify posts a versioned envelope carrying the labels", async () => {
    const pending = requestClassify("git status");
    expect(posted).toHaveLength(1);
    expect(posted[0]?.v).toBe(1);
    expect(posted[0]?.task).toBe("classify");
    expect(posted[0]?.text).toBe("git status");
    expect(posted[0]?.labels).toEqual(["shell", "prompt"]);
    answer({ ok: true, verdict: "shell" });
    expect(await pending).toBe("shell");
  });

  test("concurrent requests resolve independently", async () => {
    const first = requestClassify("git status");
    const second = requestClassify("why is the build failing?");
    const [a, b] = posted;
    g.__tugBridge?.onLocalModelResult?.({ requestId: b?.requestId, ok: true, verdict: "prompt" });
    g.__tugBridge?.onLocalModelResult?.({ requestId: a?.requestId, ok: true, verdict: "shell" });
    expect(await first).toBe("shell");
    expect(await second).toBe("prompt");
  });

  test("a failed answer is no opinion, not an error", async () => {
    const pending = requestClassify("git status");
    answer({ ok: false, error: "no local model installed" });
    expect(await pending).toBeNull();
  });

  test("a verdict outside the requested labels is discarded", async () => {
    const pending = requestClassify("git status");
    answer({ ok: true, verdict: "maybe" });
    expect(await pending).toBeNull();
  });

  test("a silent host times out to null", async () => {
    expect(await requestClassify("git status", 20)).toBeNull();
  });

  test("a reply that arrives after the timeout is dropped", async () => {
    const pending = requestClassify("git status", 20);
    expect(await pending).toBeNull();
    // The late answer must not throw, and must not resolve anything.
    answer({ ok: true, verdict: "shell" });
    expect(await pending).toBeNull();
  });

  test("an empty summary reads as no summary", async () => {
    const pending = requestSummarize("a digest", 50);
    answer({ ok: true, text: "" });
    expect(await pending).toBeNull();
  });

  test("availability passes the host's answer through", async () => {
    const pending = requestAvailability();
    answer({ ok: true, availability: { ready: true, backend: "mlx" } });
    expect(await pending).toEqual({ ready: true, backend: "mlx" });
  });
});
