/**
 * `validateActionAtNode` — enabled-state for targeted dispatch.
 *
 * `validateAction` walks from the first responder, which is the wrong
 * question for a control that dispatches to an explicit target: a button in
 * a background card would be answered by whatever holds focus. TugButton
 * used to paper over that by aliasing its "validated" state to
 * `nodeCanHandle`, so a responder's `validateAction` was written,
 * registered, and never consulted by any button.
 *
 * These pin the two questions apart against a real `ResponderChainManager`,
 * including the shape that makes the distinction load-bearing: a last-resort
 * responder whose `canHandle` says yes to everything while its
 * `validateAction` affirms only what it genuinely implements.
 */

import { describe, expect, test } from "bun:test";

import { ResponderChainManager } from "../responder-chain";
import { TUG_ACTIONS } from "../action-vocabulary";

describe("validateActionAtNode", () => {
  test("a handled action with no validateAction is enabled", () => {
    const chain = new ResponderChainManager();
    chain.register({
      id: "target",
      parentId: null,
      actions: { [TUG_ACTIONS.COPY]: () => {} },
    });
    expect(chain.nodeCanHandle("target", TUG_ACTIONS.COPY)).toBe(true);
    expect(chain.validateActionAtNode("target", TUG_ACTIONS.COPY)).toBe(true);
  });

  test("a handled action whose predicate says no is can-handle-but-not-now", () => {
    const chain = new ResponderChainManager();
    chain.register({
      id: "target",
      parentId: null,
      actions: { [TUG_ACTIONS.COPY]: () => {} },
      validateAction: () => false,
    });
    // The exact divergence TugButton could not see before.
    expect(chain.nodeCanHandle("target", TUG_ACTIONS.COPY)).toBe(true);
    expect(chain.validateActionAtNode("target", TUG_ACTIONS.COPY)).toBe(false);
  });

  test("an unhandled action is unavailable, not merely disabled", () => {
    const chain = new ResponderChainManager();
    chain.register({
      id: "target",
      parentId: null,
      actions: { [TUG_ACTIONS.COPY]: () => {} },
      validateAction: () => true,
    });
    expect(chain.validateActionAtNode("target", TUG_ACTIONS.PASTE)).toBe(false);
  });

  test("an unregistered node answers false rather than throwing", () => {
    const chain = new ResponderChainManager();
    expect(chain.validateActionAtNode("nobody", TUG_ACTIONS.COPY)).toBe(false);
  });

  test("a last-resort responder is honest about what it actually implements", () => {
    // DeckCanvas's shape: `canHandle: () => true` keeps it a dispatch
    // last-resort, while `validateAction` affirms only its real capabilities.
    const IMPLEMENTED = new Set<string>([TUG_ACTIONS.NEXT_TAB]);
    const chain = new ResponderChainManager();
    chain.register({
      id: "deck-canvas",
      parentId: null,
      canHandle: () => true,
      actions: { [TUG_ACTIONS.NEXT_TAB]: () => {} },
      validateAction: (action) => IMPLEMENTED.has(action),
    });

    // Can-handle answers yes to everything — that is what keeps dispatch
    // from falling off the root.
    expect(chain.nodeCanHandle("deck-canvas", TUG_ACTIONS.NEXT_TAB)).toBe(true);
    expect(chain.nodeCanHandle("deck-canvas", TUG_ACTIONS.SAVE)).toBe(true);

    // Enabled-state does not: a control targeting the canvas with an action
    // the canvas merely absorbs is dispatching into a no-op, and now says so.
    expect(chain.validateActionAtNode("deck-canvas", TUG_ACTIONS.NEXT_TAB)).toBe(true);
    expect(chain.validateActionAtNode("deck-canvas", TUG_ACTIONS.SAVE)).toBe(false);
  });

  test("targets its own node, not whoever holds focus", () => {
    const chain = new ResponderChainManager();
    chain.register({
      id: "focused",
      parentId: null,
      actions: { [TUG_ACTIONS.COPY]: () => {} },
      validateAction: () => true,
    });
    chain.register({
      id: "background",
      parentId: null,
      actions: { [TUG_ACTIONS.COPY]: () => {} },
      validateAction: () => false,
    });
    chain.makeFirstResponder("focused");

    // The first-responder walk says enabled; the background target does not.
    expect(chain.validateAction(TUG_ACTIONS.COPY)).toBe(true);
    expect(chain.validateActionAtNode("background", TUG_ACTIONS.COPY)).toBe(false);
  });
});
