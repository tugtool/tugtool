/**
 * open-file-in-card.reuse.test.ts — the `"reuse"` open target never
 * rebinds a dirty File card ([P11]): a dirty frontmost card falls through
 * to a fresh card instead of tearing its buffer down.
 *
 * The deck default is set through the real `setTugbankClient` seam (not a
 * module mock) so nothing leaks into other files' tugbank assertions. Only
 * the open registry — used solely by `open-file-in-card` — is mocked. The
 * dirty path returns before any focus-transfer / DOM work, so no DOM seam
 * needs stubbing.
 */

import { describe, test, expect, mock, beforeAll, afterAll } from "bun:test";
import { setTugbankClient } from "@/lib/tugbank-singleton";

mock.module("@/lib/file-card-open-registry", () => ({
  findFileCardByPath: () => null,
  getOpenFileCard: () => ({
    getPath: () => "/old.txt",
    isDirty: () => true, // dirty frontmost card
    revealLine: () => {},
    openFile: () => {
      throw new Error("dirty card must not be rebound ([P11])");
    },
  }),
}));

let openFileInCard: typeof import("@/lib/open-file-in-card").openFileInCard;
beforeAll(async () => {
  // Deck default → "reuse".
  setTugbankClient({
    get: () => ({ kind: "json", value: { openTarget: "reuse" } }),
  } as never);
  ({ openFileInCard } = await import("@/lib/open-file-in-card"));
});
afterAll(() => setTugbankClient(null));

describe("reuse open target + dirty guard ([P11])", () => {
  test("a dirty frontmost card is NOT rebound; a fresh card opens instead", () => {
    const addCardCalls: unknown[] = [];
    const store = {
      getSnapshot: () => ({
        cards: [{ id: "c1", componentId: "file" }],
        panes: [{ id: "p1", activeCardId: "c1", cardIds: ["c1"] }],
      }),
      getFirstResponderCardId: () => "c1",
      activateCard: () => {},
      addCard: (...args: unknown[]) => {
        addCardCalls.push(args);
        return "cNew";
      },
      addCardToPane: () => "cNew",
    };
    // `openFile` throws if reached — reaching `addCard` proves the
    // dirty card was left intact and a fresh card opened instead.
    openFileInCard(store as never, "/new.txt");
    expect(addCardCalls).toHaveLength(1);
  });
});
