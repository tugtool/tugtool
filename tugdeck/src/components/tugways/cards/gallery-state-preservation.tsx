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
 *   - Confirm the control and the "captured" echo both come back with
 *     the same values.
 */

import React, { useEffect, useId, useState } from "react";
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
 * value at save time; a fresh mount reads the captured value back. No
 * parent state is required — the checkbox is self-sufficient.
 */
function PreservedCheckboxDemo(): React.ReactElement {
  return (
    <div className="cg-variant-row">
      <TugLabel size="2xs" color="muted">Uncontrolled opt-in</TugLabel>
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
 * current `checked` prop at save time and, on restore, dispatches a
 * `toggle` action through the responder chain so the parent updates
 * its own state. This is a best-effort restore — the parent is the
 * source of truth — but in practice it reproduces the saved state
 * faithfully when the handler is a plain setter.
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
        <TugLabel size="2xs" color="muted">Controlled opt-in</TugLabel>
        <div className="cg-size-group">
          <TugCheckbox
            componentStatePreservationKey="controlled-done"
            senderId={cbId}
            label="Reviewed"
            size="md"
            checked={checked}
          />
        </div>
        <TugLabel size="2xs" color="muted">
          {`parent state: ${checked ? "checked" : "unchecked"}`}
        </TugLabel>
      </div>
    </ResponderScope>
  );
}

// ---------------------------------------------------------------------------
// LateMountPreservedCheckbox — async-mount opt-in example (Phase E.7).
// ---------------------------------------------------------------------------

/**
 * Demonstrates the late-mount restore path ([A9c]). The opted-in
 * `TugCheckbox` is gated behind a Promise.resolve-then-state-flip so
 * it mounts AFTER `CardHost`'s one-shot `restoreCardState` effect has
 * already iterated an empty registry — the exact shape that tide-card's
 * transcript body kinds present in production (mount after session-
 * resume populates the data source).
 *
 * Without the framework's `observeRegister` channel + per-card
 * `lastBagComponents` cache, the saved bag would silently drop on the
 * restore path because the registry would be empty at the moment
 * CardHost iterates. With the channel in place, the saved value is
 * delivered the instant the checkbox registers, so first paint after
 * late mount reflects the restore.
 *
 * The Phase E.7 app-test (`at0062-late-mount-component-restore.test.ts`)
 * drives this fixture.
 */
function LateMountPreservedCheckbox(): React.ReactElement {
  const [mounted, setMounted] = useState<boolean>(false);
  useEffect(() => {
    // Microtask-then-state-flip so the late mount lands strictly after
    // any synchronous CardHost effect could have run. setTimeout(0)
    // would also work; resolved-promise is the minimum-latency form
    // that still escapes the synchronous mount window.
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      setMounted(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="cg-variant-row" data-testid="late-mount-row">
      <TugLabel size="2xs" color="muted">Late-mount opt-in</TugLabel>
      <div className="cg-size-group" data-testid="late-mount-slot">
        {mounted ? (
          <TugCheckbox
            componentStatePreservationKey="late-mount-done"
            label="Acknowledged"
            size="md"
          />
        ) : null}
      </div>
    </div>
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
            <LateMountPreservedCheckbox />
          </div>
        </div>
      </div>
      <TugSeparator />
      <div className="cg-section">
        <TugLabel size="2xs" color="muted">
          Toggle any of the above, reload the window, and confirm the
          state survives. Each new opt-in component lands here as its
          step merges.
        </TugLabel>
      </div>
    </div>
  );
}

/**
 * `gallery-late-mount-preservation` — scoped variant of the state-
 * preservation gallery card that renders ONLY the late-mount checkbox
 * fixture. Used by `at0062-late-mount-component-restore.test.ts` so the
 * test surface is isolated from the broader gallery (no neighboring
 * checkboxes that could distract the harness, no markdown sections
 * that change layout).
 */
export function GalleryLateMountPreservation(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-late-mount-preservation">
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Late-mount [A9] state preservation
        </TugLabel>
        <div className="cg-matrix">
          <div className="cg-subtype-block">
            <LateMountPreservedCheckbox />
          </div>
        </div>
      </div>
    </div>
  );
}
