/**
 * Pure-logic tests for `TodoWriteToolBlock`'s dispatch resolution.
 *
 * The wrapper's body composition (chrome + embedded `TodoListBlock` +
 * inline progress bar) is HMR-vetted per the project's testing
 * policy. The data-narrowing + count helpers the wrapper consumes
 * are pinned by `body-kinds/__tests__/todo-list-block.test.ts`.
 * This file pins the one piece of behaviour unique to the wrapper
 * surface — that the dispatch resolves `TodoWrite` (any casing) to
 * the real `TodoWriteToolBlock` factory.
 */

import { describe, expect, test } from "bun:test";

import { TodoWriteToolBlock } from "../todo-write-tool-block";
import {
  _resetToolWrapperRegistryForTests,
  registerToolWrapper,
  resolveToolWrapper,
} from "../../tide-assistant-renderer-dispatch";

describe("TodoWrite dispatch resolution", () => {
  test("TodoWrite (any casing) resolves to the real TodoWriteToolBlock", () => {
    // Self-contained: register the real wrapper, then resolve through
    // the case-insensitive registry. Independent of module-load order.
    _resetToolWrapperRegistryForTests();
    registerToolWrapper("todowrite", TodoWriteToolBlock);
    expect(resolveToolWrapper("todowrite")).toBe(TodoWriteToolBlock);
    expect(resolveToolWrapper("TodoWrite")).toBe(TodoWriteToolBlock);
    expect(resolveToolWrapper("TODOWRITE")).toBe(TodoWriteToolBlock);
  });
});
