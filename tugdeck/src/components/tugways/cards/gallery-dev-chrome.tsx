/**
 * gallery-dev-chrome.tsx — visual fixture for the per-card chrome
 * surfaces shipped in [#step-29] and earlier: `DevSessionInitBanner`,
 * `DevErrorBlock`, and `DevCautionBadge`.
 *
 * Each component stacks 3-5 mock variants:
 *
 *  SessionInitBanner ([#step-29])
 *   - First observation (no previous metadata) → renders
 *   - Identical-shape repeat → null
 *   - Model change → renders
 *   - Permission-mode change → renders
 *   - Drift caution threaded through → caution chip in the banner
 *
 *  ErrorBlock ([#step-29])
 *   - Recoverable with Retry handler
 *   - Recoverable without Retry handler (status-only)
 *   - Non-recoverable (Copy button)
 *
 *  CautionBadge (existing)
 *   - unknown_tool
 *   - unknown_shape
 *   - version_drift
 *
 * @module components/tugways/cards/gallery-dev-chrome
 */

import React from "react";

import { DevSessionInitBanner } from "@/components/tugways/chrome/dev-session-init-banner";
import { DevErrorBlock } from "@/components/tugways/chrome/dev-error-block";
import { DevCautionBadge } from "@/components/tugways/chrome/dev-caution-badge";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// SessionInitBanner fixtures
// ---------------------------------------------------------------------------

const META_BASE = {
  type: "system_metadata",
  model: "claude-opus-4-7[1m]",
  permissionMode: "acceptEdits",
  version: "2.1.148",
  cwd: "/Users/koci/Mounts/u/src/tugtool",
  tools: ["Bash", "Read", "Edit", "Write"],
  skills: ["commit", "verify"],
  agents: ["claude", "Explore"],
};

const META_MODEL_CHANGED = { ...META_BASE, model: "claude-sonnet-4-6" };
const META_PERMISSION_CHANGED = { ...META_BASE, permissionMode: "plan" };

// ---------------------------------------------------------------------------
// GalleryDevChrome
// ---------------------------------------------------------------------------

export function GalleryDevChrome(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-dev-chrome">
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          SessionInitBanner — first observation (no previous metadata)
        </TugLabel>
        <DevSessionInitBanner
          input={{ kind: "system_metadata", metadata: META_BASE }}
        />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          SessionInitBanner — identical repeat (renders null; nothing
          visible below this label)
        </TugLabel>
        <DevSessionInitBanner
          input={{
            kind: "system_metadata",
            metadata: META_BASE,
            previousMetadata: META_BASE,
          }}
        />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          SessionInitBanner — model changed
        </TugLabel>
        <DevSessionInitBanner
          input={{
            kind: "system_metadata",
            metadata: META_MODEL_CHANGED,
            previousMetadata: META_BASE,
          }}
        />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          SessionInitBanner — permission-mode changed
        </TugLabel>
        <DevSessionInitBanner
          input={{
            kind: "system_metadata",
            metadata: META_PERMISSION_CHANGED,
            previousMetadata: META_BASE,
          }}
        />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          SessionInitBanner — with drift caution chip
        </TugLabel>
        <DevSessionInitBanner
          input={{
            kind: "system_metadata",
            metadata: { ...META_BASE, version: "2.2.0" },
          }}
          caution={{
            reason: "version_drift",
            detail: "2.2.0 ≠ 2.1.148",
          }}
        />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          ErrorBlock — recoverable (Retry button wired)
        </TugLabel>
        <DevErrorBlock
          input={{
            kind: "error",
            message: "Network hiccup — request timed out after 30s.",
            recoverable: true,
          }}
          onRetry={() => {
            /* gallery no-op */
          }}
        />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          ErrorBlock — recoverable (no Retry handler; status-only)
        </TugLabel>
        <DevErrorBlock
          input={{
            kind: "error",
            message: "Rate limit reached; auto-retry will fire in 15s.",
            recoverable: true,
          }}
        />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          ErrorBlock — non-recoverable (Copy-error button)
        </TugLabel>
        <DevErrorBlock
          input={{
            kind: "error",
            message:
              "Stream-json parse error at offset 4892: expected ',' got '}'. Session terminated.",
            recoverable: false,
          }}
        />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          CautionBadge — unknown_tool / unknown_shape / version_drift
        </TugLabel>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <DevCautionBadge caution={{ reason: "unknown_tool", detail: "ZzzMystery" }} />
          <DevCautionBadge caution={{ reason: "unknown_shape", detail: "Read: file: missing" }} />
          <DevCautionBadge caution={{ reason: "version_drift", detail: "2.2.0 ≠ 2.1.148" }} />
        </div>
      </div>
    </div>
  );
}
