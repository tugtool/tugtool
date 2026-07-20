/**
 * `SessionCompactionEntry` — the in-transcript marker for a `/compact`
 * point, rendered as ONE collapsible bar rather than a quiet line plus a
 * separate "Compaction Summary" block. The bar stands outside the
 * assistant's attribution (a session-meta message, not the model
 * speaking): a single `Layers` glyph, the "Session compacted" label, the
 * pre-compaction token count as the trailing summary, and the recap
 * markdown one expand away in the body.
 *
 * The recap lives on `compactionSeed.summary` (the single source of truth
 * for the deferred seed); the label + token count come from the compact
 * `system_note` text passed in as `noteText` (per-compaction correct even
 * though the latest-wins seed carries only the most recent summary). With
 * no summary yet the bar is a bare, non-expandable marker — the chrome's
 * chevron disables itself when there is no body.
 *
 * Laws:
 * - [L02] `compactionSeed` enters React via `useSyncExternalStore`.
 * - [L19] composes the shared Tug block components — no hand-rolled chrome,
 *   no borrowed `--tugx-block-*` markup (the "use existing Tug components"
 *   rule).
 *
 * @module components/tugways/cards/session-compaction-entry
 */

import React from "react";
import { Layers } from "lucide-react";

import { BlockChrome } from "@/components/tugways/blocks/block-chrome";
import { ToolBlockHistoryCollapse } from "@/components/tugways/blocks/collapse-context";
import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";
import type { CodeSessionStore } from "@/lib/code-session-store";

/** Stable collapse key — one compaction summary per card (latest-wins seed). */
const COLLAPSE_KEY = "session-compaction";

export function SessionCompactionEntry({
  codeSessionStore,
  noteText,
}: {
  codeSessionStore: CodeSessionStore;
  /** The compact `system_note` text — "Session compacted · ~Nk tokens". */
  noteText: string;
}): React.ReactElement {
  const compactionSeed = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().compactionSeed,
  );

  const summary = compactionSeed?.summary ?? "";
  const hasSummary = summary.length > 0;

  // "Session compacted · ~647k tokens" → label + trailing token count. The
  // count reads as the header's quiet trailing summary, present in both the
  // collapsed and expanded states.
  const [label, ...rest] = noteText.split(" · ");
  const tokensLabel = rest.length > 0 ? rest.join(" · ") : undefined;

  return (
    <ToolBlockHistoryCollapse
      toolUseId={COLLAPSE_KEY}
      defaultCollapsed
      copyText={hasSummary ? summary : undefined}
    >
      <BlockChrome
        rootSlot="session-compaction"
        className="session-compaction-bar"
        leading={<Layers size={16} aria-hidden="true" />}
        toolName={label}
        resultSummary={
          tokensLabel !== undefined
            ? { kind: "text", text: tokensLabel }
            : undefined
        }
        copyText={hasSummary ? summary : undefined}
      >
        {hasSummary ? <TugMarkdownBlock initialText={summary} /> : null}
      </BlockChrome>
    </ToolBlockHistoryCollapse>
  );
}
