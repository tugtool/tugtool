/**
 * `DiffSummaryBadges` — the house `+N −M` diff stat as two `TugBadge`s,
 * both `ghost` in the neutral `inherit` role: no border, no fill, no
 * green/red tint (the monochrome +N −M doctrine, [P27]), so the pair
 * reads as the surrounding line's own text. The single rendering for a
 * diff count anywhere it appears — tool-block headers, changes-list row
 * trailing metadata, the `/commit` receipt — so counts are pixel-identical
 * across surfaces.
 *
 * @module components/tugways/blocks/diff-summary-badges
 */

import type React from "react";

import { TugBadge } from "@/components/tugways/tug-badge";
import { formatDiffSummaryParts } from "./tool-result-summary";

export function DiffSummaryBadges({
  added,
  removed,
}: {
  added: number;
  removed: number;
}): React.ReactElement {
  const parts = formatDiffSummaryParts({ added, removed });
  return (
    <>
      <TugBadge emphasis="ghost" role="inherit" size="sm" copyText={parts.added}>
        {parts.added}
      </TugBadge>
      <TugBadge emphasis="ghost" role="inherit" size="sm" copyText={parts.removed}>
        {parts.removed}
      </TugBadge>
    </>
  );
}
