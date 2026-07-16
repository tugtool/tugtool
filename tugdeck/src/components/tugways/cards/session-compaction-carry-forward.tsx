/**
 * `SessionCompactionCarryForward` — the post-`/compact` recap, rendered by
 * composing the real tool-block chrome ([BlockChrome] inside a
 * [ToolBlockHistoryCollapse]) rather than restyling a bordered box by hand.
 * The chrome supplies the header (a leading `Layers` glyph + the "Compaction
 * Summary" name), the built-in Copy + collapse chevron, and the collapsible
 * body region; the recap markdown is the body. Collapsed by default (reference
 * material, opened on demand). Renders nothing for a non-compacted session.
 *
 * The recap lives on `compactionSeed.summary` (the single source of truth for
 * the deferred seed).
 *
 * Laws:
 * - [L02] `compactionSeed` enters React via `useSyncExternalStore`.
 * - [L19] composes the shared Tug block components — no hand-rolled chrome, no
 *   borrowed `--tugx-block-*` markup (the "use existing Tug components" rule).
 *
 * @module components/tugways/cards/session-compaction-carry-forward
 */

import React from "react";
import { Layers } from "lucide-react";

import { BlockChrome } from "@/components/tugways/blocks/block-chrome";
import { ToolBlockHistoryCollapse } from "@/components/tugways/blocks/collapse-context";
import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";
import type { CodeSessionStore } from "@/lib/code-session-store";

const TITLE = "Compaction Summary";
/** Stable collapse key — one compaction summary per card (latest-wins seed). */
const COLLAPSE_KEY = "compaction-summary";

export function SessionCompactionCarryForward({
  codeSessionStore,
}: {
  codeSessionStore: CodeSessionStore;
}): React.ReactElement | null {
  const compactionSeed = React.useSyncExternalStore(
    codeSessionStore.subscribe,
    () => codeSessionStore.getSnapshot().compactionSeed,
  );

  const summary = compactionSeed?.summary ?? "";
  if (compactionSeed === null || summary.length === 0) return null;

  return (
    <ToolBlockHistoryCollapse
      toolUseId={COLLAPSE_KEY}
      defaultCollapsed
      copyText={summary}
    >
      <BlockChrome
        rootSlot="compaction-carry-forward"
        toolName={TITLE}
        leading={<Layers size={16} aria-hidden="true" />}
        copyText={summary}
      >
        <TugMarkdownBlock initialText={summary} />
      </BlockChrome>
    </ToolBlockHistoryCollapse>
  );
}
