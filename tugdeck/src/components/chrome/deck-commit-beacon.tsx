/**
 * DeckCommitBeacon — zero-output React component that records a
 * `commit-tick` deck-trace event on every React commit.
 *
 * ## Why this exists
 *
 * The deck trace (see `deck-trace.ts`) interleaves DOM-level events
 * (focusin, focusout), store-level events (first-responder flip,
 * destination flip, save callbacks), and DOM-registration lifecycle
 * (card-host mount / unmount, `[A3]` effect fires). What it cannot
 * see on its own is a React commit boundary — "everything recorded
 * between commit-tick N and commit-tick N+1 belongs to one React
 * render cycle." Without that boundary, a developer reading a
 * `dumpTable()` transcript has no reliable way to align
 * `destination-flip` (emitted from the store notify) with the
 * `[A3]` fire or `card-host-mount` that the commit produced.
 *
 * ## How it works
 *
 * The component renders `null`. It holds a local counter in a ref
 * and runs a `useLayoutEffect` with an empty dependency list — the
 * effect fires on every commit of this component, which in practice
 * means every commit of the deck tree (since the beacon is mounted
 * once at the deck root and never unmounts). Each fire increments
 * the counter and records a `commit-tick` event carrying the new
 * count.
 *
 * `useLayoutEffect` (not `useEffect`) is chosen because the beacon
 * must fire in the same layout phase as other commit-adjacent work
 * (CardHost's registration effects, tug-pane's content-element
 * registration, `[A3]`'s activation effect). All of those also run
 * in `useLayoutEffect`, so ordering in the trace is deterministic:
 * within a single commit, component effects run child-first, so the
 * beacon — mounted at the deck root — runs AFTER every descendant's
 * effect. This gives `commit-tick` the semantic "end of commit N"
 * marker we want.
 *
 * ## Placement
 *
 * Mounted exactly once, at the deck root (inside `DeckCanvas`). The
 * plan allows for it to live at any deck-root-level slot; `DeckCanvas`
 * is the closest authoritative root that the deck tree reliably
 * commits through.
 *
 * ## Tuglaws
 *
 *   - **L03** — registration + commit-observer effect runs in
 *     `useLayoutEffect`, the same phase where downstream consumers
 *     (CardHost effects) register. Ensures `commit-tick` interleaves
 *     with those effects correctly.
 *   - **L06** — the beacon does not drive any React state or DOM
 *     appearance; the recorded event is diagnostic-only and visible
 *     only through `window.__deckTrace`.
 *   - **L10** — single responsibility: one-to-one correspondence
 *     between React commits and emitted commit-tick events.
 *
 * @module deck-commit-beacon
 */

import { useLayoutEffect, useRef } from "react";
import { deckTrace } from "../../deck-trace";

/**
 * Emits a `commit-tick` event to the deck trace on every React
 * commit. Renders nothing.
 *
 * Mount at the deck root (see `DeckCanvas`). The component is
 * idempotent and can be mounted multiple times without coordination
 * — each instance has its own counter — but one instance at the
 * deck root is the expected deployment.
 */
export function DeckCommitBeacon(): null {
  const countRef = useRef(0);
  useLayoutEffect(() => {
    countRef.current += 1;
    deckTrace.record({ kind: "commit-tick", count: countRef.current });
  });
  return null;
}
