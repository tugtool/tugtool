/**
 * gallery-pane-bulletin.tsx — TugPaneBulletin demo card for the Component
 * Gallery.
 *
 * Unlike the deck-global TugBulletin, the pane bulletin is scoped to its
 * `TugPaneBulletinProvider`, so the demo wraps a fixed-height "pane" stage and
 * fires bulletins into it — exercising stacking, hover-persist (the auto-dismiss
 * pauses while the pointer is over a bulletin), tone accents, and dismissal.
 *
 * @module components/tugways/cards/gallery-pane-bulletin
 */

import React from "react";
import {
  TugPaneBulletinProvider,
  useTugPaneBulletin,
} from "@/components/tugways/tug-pane-bulletin";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugLabel } from "@/components/tugways/tug-label";

const labelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  marginBottom: "8px",
};

const stageStyle: React.CSSProperties = {
  position: "relative",
  minHeight: 320,
  // Clip the absolutely-positioned toaster to the demo "pane" so it can't
  // extend the gallery card's scroll height (the bulletin would otherwise add
  // an unwanted scrollbar) — and so bulletins stay within the pane, as a
  // pane-scoped bulletin should.
  overflow: "hidden",
  border: "1px dashed var(--tug7-element-global-border-normal-muted-rest)",
  borderRadius: "0.5rem",
  padding: "1rem",
};

let stackCounter = 0;

function GalleryPaneBulletinControls(): React.ReactElement {
  const paneBulletin = useTugPaneBulletin();
  return (
    <div className="cg-section" style={{ gap: "8px" }}>
      <TugLabel className="cg-section-title">Pane Bulletins</TugLabel>
      <div style={labelStyle}>
        useTugPaneBulletin() — fired into THIS pane only. Hover a bulletin to
        pause its auto-dismiss; click ✕ to dismiss.
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <TugPushButton
          emphasis="outlined"
          size="sm"
          onClick={() => paneBulletin("Most recent message copied")}
        >
          Default
        </TugPushButton>
        <TugPushButton
          emphasis="outlined"
          size="sm"
          role="action"
          onClick={() =>
            paneBulletin.success("Sync complete", {
              description: "All changes saved.",
            })
          }
        >
          Success + description
        </TugPushButton>
        <TugPushButton
          emphasis="outlined"
          size="sm"
          role="danger"
          onClick={() => paneBulletin.danger("Copy failed")}
        >
          Danger
        </TugPushButton>
        <TugPushButton
          emphasis="outlined"
          size="sm"
          role="danger"
          onClick={() => paneBulletin.caution("Low disk space")}
        >
          Caution
        </TugPushButton>
        <TugPushButton
          emphasis="outlined"
          size="sm"
          onClick={() => {
            stackCounter += 1;
            const base = stackCounter * 3;
            paneBulletin(`Bulletin ${base - 2}`);
            paneBulletin(`Bulletin ${base - 1}`);
            paneBulletin(`Bulletin ${base}`);
          }}
        >
          Stack three
        </TugPushButton>
        <TugPushButton
          emphasis="outlined"
          size="sm"
          onClick={() =>
            paneBulletin("Processing…", {
              description: "Stays for 10 seconds.",
              duration: 10000,
            })
          }
        >
          Long duration
        </TugPushButton>
        <TugPushButton
          emphasis="outlined"
          size="sm"
          role="action"
          onClick={() =>
            paneBulletin.success("Session compacted", { sticky: true })
          }
        >
          Sticky (OK)
        </TugPushButton>
        <TugPushButton
          emphasis="outlined"
          size="sm"
          onClick={() =>
            paneBulletin("Update installed", {
              sticky: true,
              okLabel: "Got it",
            })
          }
        >
          Sticky (custom label)
        </TugPushButton>
      </div>
    </div>
  );
}

/**
 * GalleryPaneBulletin — TugPaneBulletin demo card. The provider's root is the
 * dashed "pane" stage; bulletins anchor to its bottom-center.
 */
export function GalleryPaneBulletin(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-pane-bulletin">
      <TugPaneBulletinProvider placement="bottom" style={stageStyle}>
        <GalleryPaneBulletinControls />
      </TugPaneBulletinProvider>
    </div>
  );
}
