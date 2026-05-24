/**
 * gallery-share-onboarding-guide-tool-block.tsx — visual fixture
 * for `ShareOnboardingGuideToolBlock`.
 *
 * Five sections cover the four modes + a streaming variant + an
 * error variant. The `check` and `create` sections demonstrate the
 * URL-extraction path (link rendered as a clickable `<a>`); the
 * `delete` section shows the no-URL fallback (raw text in a
 * `ToolBlockPre`).
 *
 * @module components/tugways/cards/gallery-share-onboarding-guide-tool-block
 */

import React from "react";

import { ShareOnboardingGuideToolBlock } from "./tool-blocks/share-onboarding-guide-tool-block";
import type { ToolBlockProps } from "./tool-blocks/types";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHECK: ToolBlockProps = {
  toolUseId: "sog-1",
  toolName: "ShareOnboardingGuide",
  msgId: "gallery-msg",
  seq: 0,
  input: { mode: "check" },
  textOutput: "Found existing guide: https://claude.ai/code/onboarding/abc123 (status: has_existing)",
  isError: false,
  status: "ready",
};

const CREATE: ToolBlockProps = {
  toolUseId: "sog-2",
  toolName: "ShareOnboardingGuide",
  msgId: "gallery-msg",
  seq: 1,
  input: { mode: "create" },
  textOutput: "Created new guide: https://claude.ai/code/onboarding/xyz789",
  isError: false,
  status: "ready",
};

const UPDATE: ToolBlockProps = {
  toolUseId: "sog-3",
  toolName: "ShareOnboardingGuide",
  msgId: "gallery-msg",
  seq: 2,
  input: { mode: "update", short_code: "abc123" },
  textOutput: "Updated guide: https://claude.ai/code/onboarding/abc123",
  isError: false,
  status: "ready",
};

const DELETE: ToolBlockProps = {
  toolUseId: "sog-4",
  toolName: "ShareOnboardingGuide",
  msgId: "gallery-msg",
  seq: 3,
  input: { mode: "delete", short_code: "abc123" },
  textOutput: "Deleted guide abc123",
  isError: false,
  status: "ready",
};

const STREAMING: ToolBlockProps = {
  toolUseId: "sog-5",
  toolName: "ShareOnboardingGuide",
  msgId: "gallery-msg",
  seq: 4,
  input: { mode: "check" },
  status: "streaming",
};

const ERROR: ToolBlockProps = {
  toolUseId: "sog-6",
  toolName: "ShareOnboardingGuide",
  msgId: "gallery-msg",
  seq: 5,
  input: { mode: "update", short_code: "missing" },
  textOutput: "Error: no guide with short_code 'missing'",
  isError: true,
  status: "error",
};

// ---------------------------------------------------------------------------
// GalleryShareOnboardingGuideToolBlock
// ---------------------------------------------------------------------------

export function GalleryShareOnboardingGuideToolBlock(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-share-onboarding-guide-tool-block">
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          check — existing-link path; URL extracted + rendered as `&lt;a&gt;`
        </TugLabel>
        <ShareOnboardingGuideToolBlock {...CHECK} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          create — fresh-link path
        </TugLabel>
        <ShareOnboardingGuideToolBlock {...CREATE} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          update — short_code in args + URL in body
        </TugLabel>
        <ShareOnboardingGuideToolBlock {...UPDATE} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          delete — no URL; falls back to raw result text
        </TugLabel>
        <ShareOnboardingGuideToolBlock {...DELETE} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Streaming — StreamingPlaceholder body
        </TugLabel>
        <ShareOnboardingGuideToolBlock {...STREAMING} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Error — chrome error band; mode + short_code still rendered
        </TugLabel>
        <ShareOnboardingGuideToolBlock {...ERROR} />
      </div>
    </div>
  );
}
