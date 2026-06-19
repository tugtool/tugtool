/**
 * `DevCompactionCarryForward` — the recap shown after `/compact`, rendered
 * as its own block beneath the "Session compacted" header strip
 * (compact-then-wait). Worn in the **tool-block renderer style**: a quiet
 * header strip with the title on the left and a right-aligned, icon-only
 * copy + expand/collapse cluster (the same `BlockCopyButton` /
 * `BlockFoldCue` affordances tool blocks use), and the summary in a
 * content area below. Collapsed by default; the body unmounts when
 * collapsed (the header is the whole block), exactly like a tool block.
 * Renders nothing for ordinary (non-compacted) sessions.
 *
 * The recap lives on `compactionSeed.summary` (the single source of truth
 * for the deferred seed).
 *
 * Laws:
 * - [L02] `compactionSeed` enters React via `useSyncExternalStore`.
 * - [L06] the collapsed state lives on `data-collapsed`; the body subtree
 *   mounts/unmounts on it (no per-frame React churn). The collapse flag is
 *   genuine local UI state (a disclosure), held in `useState`.
 * - [L19] `.tsx` + `.css` pair; `data-slot` anchors every primitive.
 * - [L20] consumer-only — reuses the shared `--tugx-block-*` chrome tokens
 *   and the block affordances; no new token slot family.
 *
 * @module components/tugways/cards/dev-compaction-carry-forward
 */

import "./dev-compaction-carry-forward.css";

import React from "react";

import { BlockCopyButton } from "@/components/tugways/body-kinds/affordances/block-copy-button";
import { BlockFoldCue } from "@/components/tugways/body-kinds/affordances/block-fold-cue";
import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";
import type { CodeSessionStore } from "@/lib/code-session-store";

const TITLE = "Compaction Summary";

export function DevCompactionCarryForward({
  codeSessionStore,
}: {
  codeSessionStore: CodeSessionStore;
}): React.ReactElement | null {
  const compactionSeed = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().compactionSeed,
  );
  // Collapsed by default — the recap is reference material, opened on
  // demand. Local disclosure state, not appearance.
  const [collapsed, setCollapsed] = React.useState(true);

  const summary = compactionSeed?.summary ?? "";
  if (compactionSeed === null || summary.length === 0) return null;

  return (
    <div
      className="dev-compaction-carry-forward"
      data-slot="compaction-carry-forward"
      data-collapsed={collapsed ? "true" : undefined}
    >
      <div className="dev-compaction-carry-forward-header">
        <span className="dev-compaction-carry-forward-name">{TITLE}</span>
        <span className="dev-compaction-carry-forward-actions">
          <BlockCopyButton
            subtype="icon"
            size="xs"
            getText={() => summary}
            aria-label="Copy compaction summary"
            data-slot="compaction-carry-forward-copy"
          />
          <BlockFoldCue
            collapsed={collapsed}
            onToggle={setCollapsed}
            collapsedLabel="Expand"
            expandedLabel="Collapse"
            ariaLabelExpand="Expand compaction summary"
            ariaLabelCollapse="Collapse compaction summary"
            size="xs"
            subtype="icon"
            data-slot="compaction-carry-forward-disclosure"
          />
        </span>
      </div>
      {!collapsed ? (
        <div
          className="dev-compaction-carry-forward-body"
          data-slot="compaction-summary"
        >
          <TugMarkdownBlock initialText={summary} />
        </div>
      ) : null}
    </div>
  );
}
