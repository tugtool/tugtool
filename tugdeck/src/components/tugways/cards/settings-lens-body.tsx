/**
 * settings-lens-body.tsx — the Settings **General** tab body.
 *
 * Hosts the Lens section: choose which side of the deck the Lens rail
 * anchors to. The choice persists via the lens store (tugbank
 * `dev.tugtool.lens` / `anchorSide`) and is applied by the deck manager,
 * which flips an already-open rail in place and opens future rails on the
 * chosen edge.
 *
 * Laws: [L02] subscribes to `lensStore` via `useLensAnchorSide`; [L11]
 * the choice group emits a `selectValue` action owned by this body's
 * responder (via `useResponderForm`), which forwards to the global
 * `set-lens-side` action; [L19] composes Tug primitives
 * (`TugChoiceGroup`, `TugLabel`).
 *
 * @module components/tugways/cards/settings-lens-body
 */

import React, { useCallback } from "react";
import { dispatchAction } from "@/action-dispatch";
import { useLensAnchorSide } from "@/lib/lens-store/use-lens-anchor-side";
import { normalizeLensAnchorSide } from "@/lib/lens-store/types";
import { TugBox } from "../tug-box";
import { TugChoiceGroup } from "../tug-choice-group";
import { useResponderForm } from "../use-responder-form";
// Reuse the General/Session-Card group layout (bordered TugBox + legend inset).
import "./settings-general-body.css";
import "./settings-lens-body.css";

/** Stable sender id so the responder routes this group's selectValue here. */
const LENS_SIDE_SENDER = "settings-lens-side";

export function SettingsLensBody(): React.ReactElement {
  const side = useLensAnchorSide();

  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: {
      [LENS_SIDE_SENDER]: useCallback((value: string) => {
        dispatchAction({
          action: "set-lens-side",
          side: normalizeLensAnchorSide(value),
        });
      }, []),
    },
  });

  return (
    <ResponderScope>
      <div
        className="settings-general"
        data-testid="settings-general-body"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        <TugBox
          label="Lens"
          labelPosition="legend"
          variant="bordered"
          className="settings-general-group"
        >
          <div className="settings-lens-row">
            <span className="settings-lens-row-label">Side</span>
            <TugChoiceGroup
              size="sm"
              value={side}
              senderId={LENS_SIDE_SENDER}
              aria-label="Lens anchor side"
              data-testid="settings-lens-side"
              items={[
                { value: "left", label: "Left" },
                { value: "right", label: "Right" },
              ]}
            />
          </div>
        </TugBox>
      </div>
    </ResponderScope>
  );
}
