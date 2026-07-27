/**
 * local-model-store — folding tugcast's `local_model_*` CONTROL frames into
 * the deck's snapshot, and the absent-reads-as-permissive configuration rules
 * of Spec S06.
 *
 * Frames go in as the real encoded bytes the wire carries, through the real
 * `onFrame` handler, so the decode path under test is the shipping one.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";

import {
  attachLocalModelStore,
  getLocalModelStore,
  readSelection,
  readTenantEnabled,
  _resetLocalModelStoreForTest,
  IDLE_LOCAL_MODEL_SNAPSHOT,
  MODEL_AUTO,
  SHELL_ROUTING_KEY,
  PULSE_OVERVIEW_KEY,
} from "../local-model-store";

type FrameHandler = (payload: Uint8Array) => void;

let handler: FrameHandler | null = null;
let sent: Array<{ action: string; params?: Record<string, unknown> }> = [];

const fakeConn = {
  onFrame: (_feed: number, cb: FrameHandler) => {
    handler = cb;
    return () => {};
  },
  sendControlFrame: (action: string, params?: Record<string, unknown>) => {
    sent.push({ action, ...(params !== undefined ? { params } : {}) });
  },
} as never;

function feed(body: Record<string, unknown>): void {
  handler?.(new TextEncoder().encode(JSON.stringify(body)));
}

const ENTRY = {
  id: "ternary-bonsai-8b-2bit",
  displayName: "Ternary Bonsai 8B",
  recommended: true,
  offered: true,
  notes: "a note",
  totalBytes: 2315155948,
};

beforeEach(() => {
  handler = null;
  sent = [];
  _resetLocalModelStoreForTest();
});

afterEach(() => _resetLocalModelStoreForTest());

describe("configuration defaults", () => {
  test("absent values read as auto and enabled", () => {
    // No tugbank client is attached in this environment, which is the same
    // shape as a domain that was never written.
    expect(readSelection()).toBe(MODEL_AUTO);
    expect(readTenantEnabled(SHELL_ROUTING_KEY)).toBe(true);
    expect(readTenantEnabled(PULSE_OVERVIEW_KEY)).toBe(true);
  });

  test("the idle snapshot is the fully-degraded posture", () => {
    expect(IDLE_LOCAL_MODEL_SNAPSHOT.selection).toBe(MODEL_AUTO);
    expect(IDLE_LOCAL_MODEL_SNAPSHOT.models).toHaveLength(0);
    expect(IDLE_LOCAL_MODEL_SNAPSHOT.download).toBeNull();
    expect(IDLE_LOCAL_MODEL_SNAPSHOT.availability.ready).toBe(false);
  });
});

describe("frame folding", () => {
  test("attach asks tugcast for the inventory", () => {
    attachLocalModelStore(fakeConn);
    expect(sent.map((s) => s.action)).toContain("local_model_list");
  });

  test("an inventory frame becomes the model list", () => {
    const store = attachLocalModelStore(fakeConn);
    feed({
      action: "local_model_inventory",
      models: [{ ...ENTRY, state: "installed", receivedBytes: null }],
    });
    const models = store.getSnapshot().models;
    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe(ENTRY.id);
    expect(models[0]?.state).toBe("installed");
    expect(models[0]?.recommended).toBe(true);
    expect(models[0]?.offered).toBe(true);
    expect(models[0]?.notes).toBe("a note");
  });

  test("progress frames land as the in-flight download", () => {
    const store = attachLocalModelStore(fakeConn);
    feed({
      action: "local_model_download_progress",
      model: ENTRY.id,
      file: "model.safetensors",
      fileIndex: 2,
      fileCount: 6,
      receivedBytes: 1_000_000,
      totalBytes: ENTRY.totalBytes,
    });
    const download = store.getSnapshot().download;
    expect(download?.model).toBe(ENTRY.id);
    expect(download?.receivedBytes).toBe(1_000_000);
    expect(download?.fileCount).toBe(6);
  });

  test("a failed result clears progress and keeps the error", () => {
    const store = attachLocalModelStore(fakeConn);
    feed({ action: "local_model_download_progress", model: ENTRY.id, receivedBytes: 5 });
    feed({ action: "local_model_download_result", model: ENTRY.id, ok: false, error: "disk full" });
    expect(store.getSnapshot().download).toBeNull();
    expect(store.getSnapshot().lastError).toBe("disk full");
  });

  test("a successful result clears both progress and any prior error", () => {
    const store = attachLocalModelStore(fakeConn);
    feed({ action: "local_model_download_result", model: ENTRY.id, ok: false, error: "network" });
    feed({ action: "local_model_download_result", model: ENTRY.id, ok: true });
    expect(store.getSnapshot().lastError).toBeNull();
    expect(store.getSnapshot().download).toBeNull();
  });

  test("an inventory with nothing downloading ends a stale progress bar", () => {
    const store = attachLocalModelStore(fakeConn);
    feed({ action: "local_model_download_progress", model: ENTRY.id, receivedBytes: 5 });
    expect(store.getSnapshot().download).not.toBeNull();
    feed({
      action: "local_model_inventory",
      models: [{ ...ENTRY, state: "installed", receivedBytes: null }],
    });
    expect(store.getSnapshot().download).toBeNull();
  });

  test("an inventory that still names a download leaves progress alone", () => {
    const store = attachLocalModelStore(fakeConn);
    feed({ action: "local_model_download_progress", model: ENTRY.id, receivedBytes: 5 });
    feed({
      action: "local_model_inventory",
      models: [{ ...ENTRY, state: "downloading", receivedBytes: 5 }],
    });
    expect(store.getSnapshot().download?.receivedBytes).toBe(5);
  });

  test("unrelated and malformed frames are ignored", () => {
    const store = attachLocalModelStore(fakeConn);
    const before = store.getSnapshot();
    feed({ action: "claude_auth_result", loggedIn: true });
    handler?.(new TextEncoder().encode("not json at all"));
    handler?.(new TextEncoder().encode("{}"));
    expect(store.getSnapshot()).toBe(before);
  });
});

describe("verbs", () => {
  test("download, cancel, and delete send their CONTROL actions", () => {
    const store = attachLocalModelStore(fakeConn);
    store.download(ENTRY.id);
    store.cancelDownload();
    store.delete(ENTRY.id);
    const actions = sent.map((s) => s.action);
    expect(actions).toContain("local_model_download");
    expect(actions).toContain("local_model_download_cancel");
    expect(actions).toContain("local_model_delete");
    expect(sent.find((s) => s.action === "local_model_download")?.params).toEqual({
      model: ENTRY.id,
    });
  });

  test("starting a download clears a previous error", () => {
    const store = attachLocalModelStore(fakeConn);
    feed({ action: "local_model_download_result", model: ENTRY.id, ok: false, error: "network" });
    store.download(ENTRY.id);
    expect(store.getSnapshot().lastError).toBeNull();
  });

  test("the singleton is idempotent", () => {
    const first = attachLocalModelStore(fakeConn);
    expect(attachLocalModelStore(fakeConn)).toBe(first);
    expect(getLocalModelStore()).toBe(first);
  });
});
