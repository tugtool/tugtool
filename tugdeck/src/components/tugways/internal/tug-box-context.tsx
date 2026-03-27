/**
 * TugBoxContext — shared disabled-cascade context for TugBox grouping.
 *
 * Internal building block — app code should use TugBox instead.
 *
 * Provides TugBoxContext and the useTugBoxDisabled hook. Any tugways control
 * reads this context to merge the box's disabled signal with its own prop.
 * Default value is { disabled: false } so controls outside any TugBox are
 * unaffected.
 *
 * Laws: [L06] appearance via CSS, [L19] component authoring guide
 */

import React from "react";

// ---- Context ----

export interface TugBoxContextValue {
  disabled: boolean;
}

export const TugBoxContext = React.createContext<TugBoxContextValue>({
  disabled: false,
});

/**
 * Hook for controls to read the nearest TugBox's disabled state.
 * Returns the context disabled value — OR it with the control's own disabled prop
 * to get the effective disabled state.
 */
export function useTugBoxDisabled(): boolean {
  return React.useContext(TugBoxContext).disabled;
}
