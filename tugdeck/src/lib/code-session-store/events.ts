/**
 * Decoded event union consumed by the `CodeSessionStore` reducer.
 *
 * Step 1 ships a placeholder with a single "noop" variant so the reducer
 * can type-check; Steps 3–8 populate the concrete decoded-stream-json,
 * SESSION_STATE, internal-action, and transport variants.
 */

import type { AtomSegment } from "../tug-atom-img";

/**
 * Placeholder variant used during scaffolding. It carries no payload and
 * is never emitted in production — the reducer's `switch` falls through
 * on it, leaving state unchanged. Later steps add sibling variants to
 * form the real discriminated union.
 */
export interface NoopEvent {
  type: "__noop__";
}

/**
 * Internal `send` action event injected by `CodeSessionStore.send`. The
 * reducer consumes this as the trigger for the `idle → submitting`
 * transition. Step 3 wires it up; the type is surfaced now so Step 1's
 * scaffold class can reference it.
 */
export interface SendActionEvent {
  type: "send";
  text: string;
  atoms: AtomSegment[];
}

/** Discriminated union of events the reducer accepts. */
export type CodeSessionEvent = NoopEvent | SendActionEvent;
