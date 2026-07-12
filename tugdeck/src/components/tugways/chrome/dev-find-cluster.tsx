/**
 * `DevFindCluster` — the Find route's Z4B cluster: the shared
 * {@link TugFindCluster} (Case / Word / Grep toggles + match-count chip)
 * adapted over the card's {@link DevFindSession}.
 *
 * It occupies the same centred-floating Z4B slot the code route fills with
 * Mode / Model / Effort ([D97]) — swapping the occupant on the ⌕ route is the
 * slot working as designed. This wrapper owns only the engine adaptation:
 * the session snapshot projects onto the {@link FindSurface} contract, and
 * option writes go to the session AND to tugbank (`putFindOptions`) so the
 * toggles survive a card reload — the find-options preference is one global
 * setting shared by every find surface.
 *
 * Laws: [L02] the surface adapter preserves snapshot identity for
 * `useSyncExternalStore`; everything else is the shared cluster's.
 *
 * @module components/tugways/chrome/dev-find-cluster
 */

import React, { useCallback, useMemo } from "react";

import { TugFindCluster } from "@/components/tugways/tug-find-cluster";
import { devFindSurface } from "@/lib/find-surface";
import type { DevFindSession } from "@/lib/dev-find-session";
import type { FindOptions } from "@/lib/transcript-search";
import { putFindOptions } from "@/settings-api";

export interface DevFindClusterProps {
  /** The card's Find store — read for options + count, written on toggle. */
  findSession: DevFindSession;
  /** Author the option group into the prompt cluster's focus cycle ([P02]). */
  focusGroup?: string;
  /** Order within {@link focusGroup}. */
  focusOrder?: number;
}

/** Z4B Find cluster: the shared cluster over the Dev transcript engine. */
export function DevFindCluster({
  findSession,
  focusGroup,
  focusOrder,
}: DevFindClusterProps): React.ReactElement {
  const handleSetOptions = useCallback(
    (next: FindOptions) => {
      findSession.setOptions(next);
      putFindOptions(next);
    },
    [findSession],
  );
  const surface = useMemo(
    () => devFindSurface(findSession, handleSetOptions),
    [findSession, handleSetOptions],
  );
  return (
    <TugFindCluster
      surface={surface}
      focusGroup={focusGroup}
      focusOrder={focusOrder}
    />
  );
}
