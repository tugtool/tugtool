/**
 * open-file-in-card.reuse.test.ts — the `"reuse"` open target never
 * rebinds a dirty Text card ([P11]): a dirty frontmost card falls through
 * to a fresh card instead of tearing its buffer down.
 *
 * The deck default is set through the real `setTugbankClient` seam and the
 * dirty card is registered through the REAL open registry (registered in
 * `beforeAll`, unregistered in `afterAll`) — a `mock.module` here would
 * replace the registry for every later test file in the run (bun module
 * mocks are process-global), which is exactly the leak that once broke the
 * Lens Text Files suite. The dirty path returns before any focus-transfer /
 * DOM work, so no DOM seam needs stubbing.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { setTugbankClient } from "@/lib/tugbank-singleton";
import {
  registerOpenTextCard,
  unregisterOpenTextCard,
} from "@/lib/text-card-open-registry";
import { openFileInCard } from "@/lib/open-file-in-card";

beforeAll(() => {
  // Deck default → "reuse".
  setTugbankClient({
    get: () => ({ kind: "json", value: { openTarget: "reuse" } }),
  } as never);
  // The frontmost card: bound to another path, dirty. `openFile` throws so
  // the test proves the rebind path is never taken.
  registerOpenTextCard("c1", {
    getPath: () => "/old.txt",
    getDisplayName: () => "old.txt",
    isDirty: () => true, // dirty frontmost card
    revealLine: () => {},
    openFile: () => {
      throw new Error("dirty card must not be rebound ([P11])");
    },
  });
});
afterAll(() => {
  unregisterOpenTextCard("c1");
  setTugbankClient(null);
});

describe("reuse open target + dirty guard ([P11])", () => {
  test("a dirty frontmost card is NOT rebound; a fresh card opens instead", () => {
    const addCardCalls: unknown[] = [];
    const store = {
      getSnapshot: () => ({
        cards: [{ id: "c1", componentId: "text" }],
        panes: [{ id: "p1", activeCardId: "c1", cardIds: ["c1"] }],
      }),
      getFirstResponderCardId: () => "c1",
      activateCard: () => {},
      // The fresh-card path saves the outgoing card's focus bag before `addCard`
      // so the previously-focused surface (e.g. the Lens list) keeps its key view.
      invokeSaveCallback: () => {},
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
