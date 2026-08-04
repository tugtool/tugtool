/**
 * Edit ▸ Delete's capability, end to end through the real chain.
 *
 * Delete had a menu item, a `TUG_ACTIONS.DELETE` name, and a `delete` field
 * in the pushed edit block — but no responder anywhere registered a handler,
 * so `validateAction` found nothing to ask and the item was permanently dark.
 * These drive a real `ResponderChainManager` with a real registration shaped
 * like the editing surfaces': Delete is handled, and gated on writability.
 *
 * Granularity is deliberate. Delete does NOT gate on having a selection, for
 * the same reason Cut doesn't: the edit block is republished on focus and
 * registration changes, not on caret moves, so a selection-granular predicate
 * would answer from stale state by the time AppKit opened the menu. Making
 * the whole clipboard family selection-granular means republishing on every
 * caret move, which is a cost to measure rather than to assume. The handlers
 * no-op on a collapsed selection, so the command is honest either way.
 */

import { describe, expect, test } from "bun:test";

import { ResponderChainManager } from "../responder-chain";
import { TUG_ACTIONS } from "../action-vocabulary";
import { computeEditCapabilities } from "../../../lib/host-menu-state";

/** An editing surface's shape: handles the clipboard verbs plus Delete, with
 *  the write verbs gated on a writable document. */
function editingSurface(state: { readOnly: boolean }) {
  const chain = new ResponderChainManager();
  chain.register({
    id: "editor",
    parentId: null,
    actions: {
      [TUG_ACTIONS.CUT]: () => {},
      [TUG_ACTIONS.COPY]: () => {},
      [TUG_ACTIONS.DELETE]: () => {},
    },
    validateAction: (action) => {
      if (action === TUG_ACTIONS.DELETE || action === TUG_ACTIONS.CUT) {
        return !state.readOnly;
      }
      return true;
    },
  });
  chain.makeFirstResponder("editor");
  return chain;
}

describe("Edit ▸ Delete capability", () => {
  test("a focused writable surface enables it", () => {
    const chain = editingSurface({ readOnly: false });
    expect(chain.validateAction(TUG_ACTIONS.DELETE)).toBe(true);
    expect(computeEditCapabilities(chain).delete).toBe(true);
  });

  test("a read-only document disables it, alongside Cut", () => {
    const caps = computeEditCapabilities(editingSurface({ readOnly: true }));
    expect(caps.delete).toBe(false);
    expect(caps.cut).toBe(false);
    // Copy is unaffected by writability.
    expect(caps.copy).toBe(true);
  });

  test("the predicate is read live, not captured at registration", () => {
    const state = { readOnly: true };
    const chain = editingSurface(state);
    expect(computeEditCapabilities(chain).delete).toBe(false);
    state.readOnly = false;
    expect(computeEditCapabilities(chain).delete).toBe(true);
  });

  test("a surface that registers no Delete handler leaves the item dark", () => {
    const chain = new ResponderChainManager();
    chain.register({
      id: "read-only-surface",
      parentId: null,
      actions: { [TUG_ACTIONS.COPY]: () => {} },
    });
    chain.makeFirstResponder("read-only-surface");
    // The pre-repair state of every surface in the app: unhandled, so the
    // walk finds no answer and the capability reads false.
    expect(computeEditCapabilities(chain).delete).toBe(false);
    expect(computeEditCapabilities(chain).copy).toBe(true);
  });

  test("Delete rides the same gate as Cut across both states", () => {
    for (const readOnly of [true, false]) {
      const caps = computeEditCapabilities(editingSurface({ readOnly }));
      expect(caps.delete, `delete tracks cut at readOnly=${readOnly}`).toBe(caps.cut);
    }
  });
});
