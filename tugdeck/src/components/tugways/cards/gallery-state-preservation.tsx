/**
 * gallery-state-preservation.tsx — Component Gallery demo for the
 * Component State Preservation Protocol ([D13], [A9]).
 *
 * Built as the canonical testbed for components opting into
 * `useComponentStatePreservation`. Today it exercises a single
 * `<TugCheckbox componentStatePreservationKey="…">` — the
 * first-consumer proof. As subsequent components opt into the protocol,
 * add them to this card's sections so the one place to manually verify
 * "does reload preserve this component?" is here.
 *
 * Each section follows the same shape so the demo reads as a survey:
 *   1. A brief label naming the component being tested.
 *   2. The opted-in control(s).
 *   3. A live echo of the captured state so a user can see what the
 *      framework would write into `bag.components[scopedKey]` at save
 *      time.
 *
 * Manual verification recipe (for each section):
 *   - Interact with the control (toggle, type, pick, etc.).
 *   - Cmd-R to reload the window, OR switch away and back.
 *   - Confirm the control comes back with the same value on the very
 *     first paint — no toggle flicker.
 */

import React, { useId, useState } from "react";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { useResponderForm } from "@/components/tugways/use-responder-form";

// ---------------------------------------------------------------------------
// PreservedCheckboxDemo — uncontrolled (internal-state) opt-in example.
// ---------------------------------------------------------------------------

/**
 * Demonstrates the uncontrolled opt-in path: the checkbox owns its
 * state internally when `componentStatePreservationKey` is set.
 * Toggling updates the internal value; the framework captures the
 * value at save time; a fresh mount reads the captured value back via
 * `useSavedComponentState` inside `useState`'s initializer so the
 * first paint reflects the user's last-saved checked-ness — no
 * toggle flicker.
 */
function PreservedCheckboxDemo(): React.ReactElement {
  return (
    <div className="cg-variant-row">
      <TugLabel size="2xs" emphasis="calm">Uncontrolled opt-in</TugLabel>
      <div className="cg-size-group">
        <TugCheckbox
          componentStatePreservationKey="uncontrolled-done"
          label="Done"
          size="md"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ControlledPreservedCheckboxDemo — controlled opt-in example.
// ---------------------------------------------------------------------------

/**
 * Demonstrates the controlled opt-in path: the parent owns `checked`
 * and the TUG_ACTIONS.TOGGLE handler. The framework captures the
 * current `checked` prop at save time. On cold boot the parent
 * responder mounts in its own saved state via [A9] and propagates the
 * saved value back down here through the `checked` prop, so the
 * checkbox arrives at first paint already in the right state.
 */
function ControlledPreservedCheckboxDemo(): React.ReactElement {
  const [checked, setChecked] = useState<boolean>(false);
  const cbId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    toggle: {
      [cbId]: setChecked,
    },
  });

  return (
    <ResponderScope>
      <div
        className="cg-variant-row"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        <TugLabel size="2xs" emphasis="calm">Controlled opt-in</TugLabel>
        <div className="cg-size-group">
          <TugCheckbox
            componentStatePreservationKey="controlled-done"
            senderId={cbId}
            label="Reviewed"
            size="md"
            checked={checked}
          />
        </div>
        <TugLabel size="2xs" emphasis="calm">
          {`parent state: ${checked ? "checked" : "unchecked"}`}
        </TugLabel>
      </div>
    </ResponderScope>
  );
}

// ---------------------------------------------------------------------------
// GalleryStatePreservation
// ---------------------------------------------------------------------------

/**
 * State Preservation gallery card. Add a new section for each
 * component as it opts into the Component State Preservation Protocol
 * so this card remains the one place to sanity-check end-to-end
 * behavior by hand.
 */
export function GalleryStatePreservation(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-state-preservation">
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugCheckbox — [A9] state preservation</TugLabel>
        <div className="cg-matrix">
          <div className="cg-subtype-block">
            <PreservedCheckboxDemo />
            <ControlledPreservedCheckboxDemo />
          </div>
        </div>
      </div>
      <TugSeparator />
      <div className="cg-section">
        <TugLabel size="2xs" emphasis="calm">
          Toggle any of the above, reload the window, and confirm the
          state survives on the very first paint. Each new opt-in
          component lands here as its step merges.
        </TugLabel>
      </div>
    </div>
  );
}
