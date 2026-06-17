/**
 * History-collapse contexts for tool blocks ([P02] of the
 * resume-performance plan).
 *
 * Replayed (historical) tool blocks mount header-only; the body
 * materializes on expand. Two contexts carry the mechanism:
 *
 *  - `ToolBlockExpansionContext` — the card-scoped
 *    `ToolBlockExpansionState` (sparse expansion overrides), provided
 *    by the transcript host, which also persists it under one [A9]
 *    key. `null` outside a transcript (gallery, standalone) — the
 *    provider below then keeps purely local state.
 *  - `ToolBlockCollapseContext` — the per-block collapse handle
 *    `{ collapsed, toggle }`, provided by `ToolBlockHistoryCollapse`
 *    and consumed by `ToolBlockChrome`, which renders the disclosure
 *    affordance and withholds the body subtree while collapsed.
 *    `null` for live blocks — the chrome then renders exactly as
 *    before this mechanism existed.
 *
 * `ToolBlockHistoryCollapse` wraps a dispatched tool-block element at
 * the transcript's dispatch site. The wrapper is what keeps [L26]
 * intact: the block component's type and key never change across
 * collapse → expand; the body is a child subtree that appears.
 *
 * The same mechanism is expected to serve live-turn collapsing later
 * (the transcript is noisy live, too): nothing here assumes
 * "historical" beyond the `defaultCollapsed` value the dispatch site
 * passes.
 *
 * Laws: [L24] — the expansion boolean is local-data (wrapper-owned
 * `useState`, registry-written-through, [A9]-persisted at the host);
 * [L26] — stable mount identity across collapse/expand; [L02]/[L06]
 * untouched (no store subscription, no appearance-by-React-state —
 * the boolean changes WHICH subtree exists, not how it looks).
 *
 * @module components/tugways/cards/tool-blocks/collapse-context
 */

import React from "react";

import { ToolBlockExpansionState } from "./expansion-state";

/** Card-scoped expansion overrides; provided by the transcript host. */
export const ToolBlockExpansionContext =
  React.createContext<ToolBlockExpansionState | null>(null);

/**
 * The dispatching tool call's id, provided by the transcript renderer
 * around every top-level tool block. `ToolBlockChrome` reads it so its
 * `data-tool-use-id` is present on **every** tool root — not only the
 * collapse-wrapped ones, which alone get an id from
 * `ToolBlockCollapseContext`. This is what lets the COPY walk address
 * any tool block from the DOM ([P01]). No DOM element — a transparent
 * provider — so it doesn't perturb the transcript's block layout.
 */
export const ToolUseIdContext = React.createContext<string | null>(null);

export interface ToolBlockCollapseHandle {
  /** Whether the block is currently collapsed (body unmounted). */
  collapsed: boolean;
  /** Toggle to `next`. Wired to the chrome's disclosure affordance. */
  toggle: (next: boolean) => void;
  /**
   * The block's stable tool-call id. The chrome stamps it as
   * `data-tool-use-id` on its root so tests (and the dev panel) can
   * address a specific block across windowed unmount/remount.
   */
  toolUseId: string;
  /**
   * Markdown for the whole tool call (command + result) — what the
   * collapsed header's Copy button writes ([P09]). Supplied by the
   * dispatch site (which holds the `ToolUseMessage`) so collapsed Copy
   * yields the same payload as the expanded block and a selection copy.
   * `undefined` when none was provided.
   */
  copyText?: string | (() => string);
}

/**
 * Per-block collapse handle consumed by `ToolBlockChrome`. `null`
 * means "this block does not participate" — the chrome renders no
 * disclosure and always mounts its body.
 */
export const ToolBlockCollapseContext =
  React.createContext<ToolBlockCollapseHandle | null>(null);

export interface ToolBlockHistoryCollapseProps {
  /** Stable tool-call id — the expansion-override key. */
  toolUseId: string;
  /**
   * The collapsed value when the user has expressed no preference.
   * Historical blocks pass `true`; a future live policy passes
   * whatever it decides.
   */
  defaultCollapsed?: boolean;
  /**
   * Markdown for the whole tool call (command + result), surfaced on the
   * collapse handle for the collapsed header's Copy button ([P09]).
   */
  copyText?: string | (() => string);
  children: React.ReactNode;
}

/**
 * Owns one block's collapse boolean: seeded from the card's expansion
 * overrides (so a windowed remount or a cold boot lands in the
 * user's last-chosen state), written through on toggle.
 */
export const ToolBlockHistoryCollapse: React.FC<
  ToolBlockHistoryCollapseProps
> = ({ toolUseId, defaultCollapsed = true, copyText, children }) => {
  const expansion = React.useContext(ToolBlockExpansionContext);
  const [collapsed, setCollapsed] = React.useState<boolean>(() =>
    expansion !== null
      ? expansion.resolve(toolUseId, defaultCollapsed)
      : defaultCollapsed,
  );
  const handle = React.useMemo<ToolBlockCollapseHandle>(
    () => ({
      collapsed,
      toggle: (next: boolean) => {
        expansion?.set(toolUseId, next, defaultCollapsed);
        setCollapsed(next);
      },
      toolUseId,
      copyText,
    }),
    [collapsed, expansion, toolUseId, defaultCollapsed, copyText],
  );
  return (
    <ToolBlockCollapseContext.Provider value={handle}>
      {children}
    </ToolBlockCollapseContext.Provider>
  );
};
