import { beforeEach, describe, expect, mock, test } from "bun:test";

// Capture the CODE_INPUT frames `ask` sends. Mocked before importing the store.
let sentFrames: Array<{ feedId: number; payload: string }> = [];
mock.module("../connection-singleton", () => ({
  getConnection: () => ({
    send: (feedId: number, payload: Uint8Array) => {
      sentFrames.push({ feedId, payload: new TextDecoder().decode(payload) });
    },
  }),
}));

import { FeedId } from "../../protocol";
import {
  SideQuestionStore,
  parseSideQuestionAnswerPayload,
} from "../side-question-store";

// A minimal FeedStore whose `emit` drives the store's feed subscription.
class MockFeedStore {
  private _data = new Map<number, unknown>();
  private _listeners: Array<() => void> = [];
  subscribe(listener: () => void): () => void {
    this._listeners.push(listener);
    return () => {
      const i = this._listeners.indexOf(listener);
      if (i >= 0) this._listeners.splice(i, 1);
    };
  }
  getSnapshot(): Map<number, unknown> {
    return this._data;
  }
  emit(feedId: number, payload: unknown): void {
    const next = new Map(this._data);
    next.set(feedId, payload);
    this._data = next;
    for (const l of this._listeners) l();
  }
}

function newStore(): { store: SideQuestionStore; feed: MockFeedStore } {
  const feed = new MockFeedStore();
  const store = new SideQuestionStore(
    feed as unknown as ConstructorParameters<typeof SideQuestionStore>[0],
    FeedId.CODE_OUTPUT,
    "sess-1",
  );
  return { store, feed };
}

function answerFrame(requestId: string, answer: string | null, synthetic = false) {
  return {
    type: "side_question_answer",
    tug_session_id: "sess-1",
    request_id: requestId,
    answer,
    synthetic,
    ipc_version: 2,
  };
}

beforeEach(() => {
  sentFrames = [];
});

describe("parseSideQuestionAnswerPayload", () => {
  test("parses a well-formed payload", () => {
    const p = parseSideQuestionAnswerPayload(answerFrame("btw-1", "hi", true));
    expect(p).toEqual({ request_id: "btw-1", answer: "hi", synthetic: true });
  });
  test("defaults a missing synthetic to false and tolerates a null answer", () => {
    const p = parseSideQuestionAnswerPayload({
      type: "side_question_answer",
      request_id: "btw-2",
      answer: null,
    });
    expect(p).toEqual({ request_id: "btw-2", answer: null, synthetic: false });
  });
  test("rejects a non-side_question or malformed payload", () => {
    expect(parseSideQuestionAnswerPayload(null)).toBeNull();
    expect(parseSideQuestionAnswerPayload({ type: "hooks_inventory" })).toBeNull();
    expect(parseSideQuestionAnswerPayload({ type: "side_question_answer" })).toBeNull();
  });
});

describe("SideQuestionStore.ask", () => {
  test("appends a loading exchange and sends the side_question CODE_INPUT verb", () => {
    const { store } = newStore();
    store.ask("what was that file?");
    const [ex] = store.getSnapshot().exchanges;
    expect(ex).toMatchObject({ question: "what was that file?", phase: "loading", answer: null });
    expect(typeof ex.at).toBe("number");

    expect(sentFrames.length).toBe(1);
    expect(sentFrames[0].feedId).toBe(FeedId.CODE_INPUT);
    const sent = JSON.parse(sentFrames[0].payload);
    expect(sent).toMatchObject({
      type: "side_question",
      tug_session_id: "sess-1",
      request_id: ex.id,
      question: "what was that file?",
    });
    store.dispose();
  });

  test("ignores a blank/whitespace-only question", () => {
    const { store } = newStore();
    store.ask("   ");
    expect(store.getSnapshot().exchanges.length).toBe(0);
    expect(sentFrames.length).toBe(0);
    store.dispose();
  });
});

describe("SideQuestionStore feed correlation", () => {
  test("a matching answer flips the exchange to answered with the settled text", () => {
    const { store, feed } = newStore();
    store.ask("the magic word?");
    const id = store.getSnapshot().exchanges[0].id;
    feed.emit(FeedId.CODE_OUTPUT, answerFrame(id, "XYLOPHONE-42", false));
    const ex = store.getSnapshot().exchanges[0];
    expect(ex).toMatchObject({ phase: "answered", answer: "XYLOPHONE-42", synthetic: false });
    store.dispose();
  });

  test("a null answer settles to the error phase (no response received)", () => {
    const { store, feed } = newStore();
    store.ask("q");
    const id = store.getSnapshot().exchanges[0].id;
    feed.emit(FeedId.CODE_OUTPUT, answerFrame(id, null));
    expect(store.getSnapshot().exchanges[0].phase).toBe("error");
    store.dispose();
  });

  test("an answer for an unknown id is ignored", () => {
    const { store, feed } = newStore();
    store.ask("q");
    feed.emit(FeedId.CODE_OUTPUT, answerFrame("btw-999", "nope"));
    expect(store.getSnapshot().exchanges[0].phase).toBe("loading");
    store.dispose();
  });
});

describe("SideQuestionStore history", () => {
  test("preserves ask order (newest last) and clears", () => {
    const { store, feed } = newStore();
    store.ask("first");
    store.ask("second");
    const ids = store.getSnapshot().exchanges.map((e) => e.id);
    expect(store.getSnapshot().exchanges.map((e) => e.question)).toEqual(["first", "second"]);
    // Settling the first leaves the second in flight, order intact.
    feed.emit(FeedId.CODE_OUTPUT, answerFrame(ids[0], "A1"));
    expect(store.getSnapshot().exchanges.map((e) => e.phase)).toEqual(["answered", "loading"]);

    store.clear();
    expect(store.getSnapshot().exchanges.length).toBe(0);
    store.dispose();
  });

  test("dismiss removes a single exchange (cancel), leaving the rest", () => {
    const { store } = newStore();
    store.ask("first");
    store.ask("second");
    const ids = store.getSnapshot().exchanges.map((e) => e.id);
    store.dismiss(ids[0]);
    expect(store.getSnapshot().exchanges.map((e) => e.question)).toEqual(["second"]);
    // Dismissing an unknown id is a no-op.
    store.dismiss("btw-999");
    expect(store.getSnapshot().exchanges.length).toBe(1);
    store.dispose();
  });

  test("a late answer for a dismissed (cancelled) loading exchange is ignored", () => {
    const { store, feed } = newStore();
    store.ask("q");
    const id = store.getSnapshot().exchanges[0].id;
    store.dismiss(id); // cancel while loading
    feed.emit(FeedId.CODE_OUTPUT, answerFrame(id, "late answer"));
    expect(store.getSnapshot().exchanges.length).toBe(0);
    store.dispose();
  });
});
