/**
 * ClaimErrorNoticeController — projects a failed file claim onto a pane
 * bulletin.
 *
 * A claim's success is self-evident: the server writes its proof rows and the
 * aggregate recompute migrates them out of the unattributed bucket. A failure
 * had no surface at all — `changeset_claim_err` (a guard refusing the project
 * or the ledger) and a `changeset_claim_ok` that claimed fewer paths than were
 * asked for both landed in silence, so a dead claim was indistinguishable from
 * a click that never registered. This zero-render controller mounts inside the
 * card's top-right `TugPaneBulletinProvider`, subscribes straight to the
 * `ChangesetVerbStore` ([L22] — a bulletin is a direct DOM update, so it must
 * not round-trip through `useSyncExternalStore`/render), and posts one sticky
 * danger notice carrying the detail. The notice dismisses when the error clears
 * (the next attempt's `pending`, or a success).
 *
 * The subscription registers in `useLayoutEffect` ([L03]); no notice state
 * enters React state ([L02]); appearance is the bulletin's own CSS/DOM ([L06]).
 */

import { useLayoutEffect, useRef } from "react";

import { getChangesetVerbStore } from "@/lib/changeset-verb-store";

import { useTugPaneBulletin } from "../tug-pane-bulletin";

const NOTICE_ID = "claim-error";

export function ClaimErrorNoticeController({
  entryKey,
}: {
  /** The card entry whose claim round trips this notice reports on. */
  entryKey: string;
}): null {
  const api = useTugPaneBulletin();
  // Last-posted detail. Local data ([L24]) — never React state.
  const postedRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const store = getChangesetVerbStore();
    if (store === null) return;

    const apply = (): void => {
      const detail = store.claimState(entryKey).error;
      if (detail === postedRef.current) return;
      postedRef.current = detail;
      if (detail === null) {
        api.dismiss(NOTICE_ID);
      } else {
        api.danger("Claim failed", {
          id: NOTICE_ID,
          description: detail,
          sticky: true,
        });
      }
    };

    apply();
    return store.subscribe(apply);
  }, [entryKey, api]);

  return null;
}
