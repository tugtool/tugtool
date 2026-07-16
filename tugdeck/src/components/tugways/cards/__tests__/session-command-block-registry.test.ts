/**
 * Governance test for `session-command-block-registry.ts` — pins the
 * registry's classification rules on the [D101] grammar ([P05]):
 *
 *  - Resolution is TOTAL: every command resolves to a renderer, and
 *    the default is the generic `ShellExchangeBlock` — raw output
 *    always renders; richness is opt-in.
 *  - No double registration: a duplicate `name` throws. There is no
 *    alias/bucket system to make an override legitimate, so a repeat
 *    is always a wiring mistake.
 *  - Matchers resolve in registration order — first claim wins.
 *  - The skeleton ships EMPTY ([P05]): bespoke renderers (git status,
 *    ls, build progress) are follow-ons; none register at module load.
 *
 * @module components/tugways/cards/__tests__/session-command-block-registry
 */

import { afterEach, describe, expect, test } from "bun:test";

import {
  _resetCommandBlockRegistryForTests,
  registerCommandBlock,
  registeredCommandBlocks,
  resolveCommandBlock,
} from "../session-command-block-registry";
import type { CommandBlockRenderer } from "../session-command-block-registry";
import { ShellExchangeBlock } from "../shell-exchange-block";

const RendererA: CommandBlockRenderer = () => null;
const RendererB: CommandBlockRenderer = () => null;

afterEach(() => {
  _resetCommandBlockRegistryForTests();
});

describe("session-command-block-registry", () => {
  test("the skeleton ships empty — no bespoke renderers at module load ([P05])", () => {
    expect(registeredCommandBlocks()).toEqual([]);
  });

  test("resolution is total: any command defaults to the generic exchange block", () => {
    expect(resolveCommandBlock("git status")).toBe(ShellExchangeBlock);
    expect(resolveCommandBlock("")).toBe(ShellExchangeBlock);
    expect(resolveCommandBlock("   ")).toBe(ShellExchangeBlock);
    expect(resolveCommandBlock("some | weird && pipeline")).toBe(ShellExchangeBlock);
  });

  test("a registered matcher claims its command; misses still default", () => {
    registerCommandBlock("git-status", (c) => c.startsWith("git status"), RendererA);
    expect(resolveCommandBlock("git status")).toBe(RendererA);
    expect(resolveCommandBlock("  git status --short  ")).toBe(RendererA);
    expect(resolveCommandBlock("git log")).toBe(ShellExchangeBlock);
  });

  test("first registration wins when two matchers claim the same command", () => {
    registerCommandBlock("first", (c) => c.startsWith("ls"), RendererA);
    registerCommandBlock("second", () => true, RendererB);
    expect(resolveCommandBlock("ls -la")).toBe(RendererA);
    expect(resolveCommandBlock("pwd")).toBe(RendererB);
  });

  test("double registration of a name throws", () => {
    registerCommandBlock("git-status", (c) => c.startsWith("git status"), RendererA);
    expect(() =>
      registerCommandBlock("git-status", () => true, RendererB),
    ).toThrow('Command block "git-status" is already registered');
  });

  test("registeredCommandBlocks reports registration (= resolution) order", () => {
    registerCommandBlock("b", () => false, RendererB);
    registerCommandBlock("a", () => false, RendererA);
    expect(registeredCommandBlocks()).toEqual(["b", "a"]);
  });
});
