/**
 * command-dispatch.ts — funnel #1: the one front door every command goes
 * through.
 *
 * A command can arrive from a Swift menu item's control frame, a chord, a
 * button, or a slash bridge. Each of those resolves a command id and calls
 * `dispatchCommand`; the mechanism that carries it to its implementation is
 * read from the registry entry's `routing` field rather than chosen at the
 * call site ([P04]).
 *
 * ## Validation gates doors, not dispatch
 *
 * `validateCommand` answers whether a command is applicable right now, and
 * its consumers are the surfaces that show a command: the native menu's
 * enablement mirror, buttons, context menus. `dispatchCommand` does not
 * consult it — the responder that would perform the command is the thing
 * that decides what happens, and a command nobody handles is already a
 * silent no-op at the end of the chain walk. This is Cocoa's split:
 * `validateUserInterfaceItem:` dims the door; `sendAction:` just sends.
 */

import type {
  CommandEntry,
  CommandValidationSource,
} from "@/components/tugways/command-registry";
import {
  COMMANDS_BY_ID,
  commandAction,
  commandWire,
} from "@/components/tugways/command-registry";
import {
  getRegistryHandler,
  getResponderChainManager,
} from "./action-dispatch";

/** Notified after every dispatch, handled or not. */
export type CommandObserver = (id: string, handled: boolean) => void;

const observers = new Set<CommandObserver>();

/** Observe every command dispatch. Returns an unsubscribe. */
export function observeCommands(observer: CommandObserver): () => void {
  observers.add(observer);
  return () => {
    observers.delete(observer);
  };
}

function notifyCommandObservers(id: string, handled: boolean): void {
  for (const observer of observers) observer(id, handled);
}

/**
 * The `ActionEvent.value` a dispatch carries: the entry's static payload
 * when it declares one, else the caller's `value`.
 */
/**
 * The record a `registry` handler receives. A per-value entry ([P05])
 * carries its parameters as a static payload object; they overlay the
 * caller's frame so `dispatchCommand("arrange-cards:tile")` reaches the
 * same handler with the same fields the Swift wire would have sent.
 */
function registryPayload(
  entry: CommandEntry,
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const base = payload ?? {};
  if (typeof entry.payload === "object" && entry.payload !== null) {
    return { ...base, ...(entry.payload as Record<string, unknown>) };
  }
  return base;
}

function resolveValue(
  entry: CommandEntry,
  payload: Record<string, unknown> | undefined,
): unknown {
  if (entry.payload !== undefined) return entry.payload;
  return payload?.value;
}

/**
 * Dispatch a command by id. Returns whether anything handled it.
 *
 * An unknown id warns and returns unhandled — the same posture
 * `dispatchAction` takes for an unregistered wire.
 */
export function dispatchCommand(
  id: string,
  payload?: Record<string, unknown>,
): boolean {
  const entry = COMMANDS_BY_ID.get(id);
  if (entry === undefined) {
    console.warn(`dispatchCommand: unknown command: ${id}`, payload);
    return false;
  }

  if (entry.routing === "registry") {
    const handler = getRegistryHandler(commandWire(entry));
    if (handler === undefined) {
      console.warn(`dispatchCommand: ${id} has no registered handler`);
      notifyCommandObservers(id, false);
      return false;
    }
    handler(registryPayload(entry, payload));
    notifyCommandObservers(id, true);
    return true;
  }

  if (entry.routing === "native") {
    // AppKit performs these; the entry exists so the keymap UI can show
    // Hide, Quit, Minimize and the NSText five rather than leaving them
    // as commands the user cannot find.
    console.warn(`dispatchCommand: ${id} is performed natively and is not JS-routable`);
    notifyCommandObservers(id, false);
    return false;
  }

  const manager = getResponderChainManager();
  if (manager === null) {
    console.warn(`dispatchCommand: ${id}: responder chain manager not registered yet`);
    notifyCommandObservers(id, false);
    return false;
  }

  const action = commandAction(entry);
  if (action === null) {
    console.warn(`dispatchCommand: ${id} declares no chain action`);
    notifyCommandObservers(id, false);
    return false;
  }

  const event = {
    action,
    value: resolveValue(entry, payload),
    phase: "discrete",
  } as const;

  let handled = false;
  switch (entry.routing) {
    case "first-responder": {
      // Continuation-aware, and the continuation runs immediately. Handlers
      // built for the in-app context menu defer their visible side effect
      // into a returned continuation so it lands after the menu blink; a
      // native menu round-trip arrives after AppKit already played its own
      // blink, so there is nothing left to defer past.
      const result = manager.sendToFirstResponderForContinuation(event);
      result.continuation?.();
      handled = result.handled;
      break;
    }
    case "key-card":
      handled = manager.sendToKeyCard(event);
      break;
    case "target": {
      const targetId = payload?.targetId;
      if (typeof targetId !== "string") {
        console.warn(`dispatchCommand: ${id} needs a targetId on its payload`, payload);
        break;
      }
      handled = manager.sendToTarget(targetId, event);
      break;
    }
  }

  notifyCommandObservers(id, handled);
  return handled;
}

/**
 * Whether a command is applicable right now ([P06]).
 *
 * An explicit `validate` predicate wins. Otherwise a chain-routed command
 * is validated by the chain — walked from the same node it would dispatch
 * to, so a key-card command answers from the key card rather than from
 * wherever focus happens to sit. A `registry` entry with no predicate has
 * no responder to ask and answers enabled; a `native` entry is AppKit's to
 * validate, never ours.
 */
export function validateCommand(
  entry: CommandEntry,
  chain: CommandValidationSource,
): boolean {
  if (entry.validate !== undefined) return entry.validate(chain);

  const action = commandAction(entry);
  if (action === null) return true;

  switch (entry.routing) {
    case "key-card":
      return chain.validateActionInKeyCard(action);
    case "first-responder":
    case "target":
      return chain.validateAction(action);
    case "registry":
    case "native":
      return true;
  }
}

/**
 * A command's state projection — a checkmark, a radio selection, a toggle
 * ([P07]). `undefined` means the command does not participate in a check
 * column at all.
 */
export function queryCommandState(
  entry: CommandEntry,
  chain: CommandValidationSource,
): boolean | string | undefined {
  if (entry.state !== undefined) return entry.state(chain);

  const action = commandAction(entry);
  if (action === null) return undefined;

  switch (entry.routing) {
    case "key-card":
      return chain.queryActionStateInKeyCard(action);
    case "first-responder":
    case "target":
      return chain.queryActionState(action);
    case "registry":
    case "native":
      return undefined;
  }
}
