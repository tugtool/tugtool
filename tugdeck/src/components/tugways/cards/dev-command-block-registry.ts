/**
 * dev-command-block-registry.ts — the command-block registry for
 * `$`-route exchange rows ([P05], on the [D101] registry grammar).
 *
 * Rich rendering for shell commands accretes the way tool blocks do:
 * a module-static registry that bespoke renderers join as they ship,
 * with a total default underneath. `resolveCommandBlock(command)`
 * walks the registrations in order and returns the first whose
 * matcher claims the command; a miss lands on the generic
 * `ShellExchangeBlock` — raw output always renders, richness is
 * opt-in per command family (`git status`, `ls`, build progress —
 * follow-ons; none ship here).
 *
 * Contrast with the tool-block registry
 * (`dev-assistant-renderer-dispatch.ts`): tool names are a closed,
 * case-normalized vocabulary, so that registry keys on name and
 * resolves by lookup. Commands are open-ended text, so this registry
 * keys each registration on a unique `name` (the governance handle)
 * and resolves by matcher predicate in registration order.
 *
 * # Invariants (enforced by `dev-command-block-registry.test.ts`)
 *
 *  - Registration is append-only and named: re-registering a `name`
 *    throws — a double registration is always a mistake, never an
 *    override (there is no alias or bucket system to mediate one).
 *  - Resolution is total: every command resolves to a renderer; the
 *    default is the generic exchange block, never `undefined`.
 *  - No bespoke renderers ship with the skeleton ([P05]) — the
 *    registry is empty at module load.
 *
 * @module components/tugways/cards/dev-command-block-registry
 */

import type React from "react";

import type { ShellExchangeMessage } from "@/lib/code-session-store/types";
import { ShellExchangeBlock } from "./shell-exchange-block";

/**
 * Props every command-block renderer receives — identical to the
 * generic `ShellExchangeBlock`'s, so the default and any bespoke
 * renderer are interchangeable at the render site.
 */
export interface CommandBlockProps {
  message: ShellExchangeMessage;
  /** Share gesture ([P08]) — omitted where no prompt entry can consume it. */
  onShare?: () => void;
}

export type CommandBlockRenderer = React.ComponentType<CommandBlockProps>;

/** Predicate over the exchange's command text (as submitted, trimmed). */
export type CommandBlockMatcher = (command: string) => boolean;

interface CommandBlockRegistration {
  name: string;
  matcher: CommandBlockMatcher;
  renderer: CommandBlockRenderer;
}

const COMMAND_BLOCK_REGISTRY: CommandBlockRegistration[] = [];

/**
 * Register a bespoke command block. Called by renderer modules at
 * import time as they ship. `name` is the registration's governance
 * handle — unique, lowercase-kebab (e.g. `"git-status"`). Matchers
 * are consulted in registration order; the first claim wins.
 *
 * Throws on a duplicate `name`: a double registration is a wiring
 * mistake, and there is no bucket/alias system to make an override
 * legitimate.
 */
export function registerCommandBlock(
  name: string,
  matcher: CommandBlockMatcher,
  renderer: CommandBlockRenderer,
): void {
  if (COMMAND_BLOCK_REGISTRY.some((r) => r.name === name)) {
    throw new Error(`Command block "${name}" is already registered`);
  }
  COMMAND_BLOCK_REGISTRY.push({ name, matcher, renderer });
}

/**
 * Resolve the renderer for a command. Total: a command no matcher
 * claims — including every command today, with no bespoke renderers
 * shipped ([P05]) — renders through the generic `ShellExchangeBlock`.
 */
export function resolveCommandBlock(command: string): CommandBlockRenderer {
  const trimmed = command.trim();
  for (const registration of COMMAND_BLOCK_REGISTRY) {
    if (registration.matcher(trimmed)) return registration.renderer;
  }
  return ShellExchangeBlock;
}

/** Enumerate registered names, in registration (= resolution) order. */
export function registeredCommandBlocks(): ReadonlyArray<string> {
  return COMMAND_BLOCK_REGISTRY.map((r) => r.name);
}

/**
 * Test-only: clear the registry so each test starts from the shipped
 * (empty) state. Production code never calls this.
 */
export function _resetCommandBlockRegistryForTests(): void {
  COMMAND_BLOCK_REGISTRY.length = 0;
}
