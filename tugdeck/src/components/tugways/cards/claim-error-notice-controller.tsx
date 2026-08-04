/**
 * ClaimErrorNoticeController — projects a failed file claim or disclaim onto a
 * pane bulletin.
 *
 * Either verb's success is self-evident: the server writes (or deletes) its
 * rows and the aggregate recompute moves the file between buckets. A failure
 * had no surface at all — `changeset_claim_err` (a guard refusing the project
 * or the ledger) and a `changeset_claim_ok` that claimed fewer paths than were
 * asked for both landed in silence, so a dead claim was indistinguishable from
 * a click that never registered. This zero-render controller mounts inside the
 * card's top-right `TugPaneBulletinProvider`, subscribes straight to the
 * `ChangesetVerbStore` ([L22] — a bulletin is a direct DOM update, so it must
 * not round-trip through `useSyncExternalStore`/render), and posts one sticky
 * danger notice per verb carrying the detail. A notice dismisses when its error
 * clears (the next attempt's `pending`, or a success).
 *
 * The subscription registers in `useLayoutEffect` ([L03]); no notice state
 * enters React state ([L02]); appearance is the bulletin's own CSS/DOM ([L06]).
 */

import { useLayoutEffect, useRef } from "react";

import { getChangesetVerbStore } from "@/lib/changeset-verb-store";

import { useTugPaneBulletin } from "../tug-pane-bulletin";

const CLAIM_NOTICE_ID = "claim-error";
const DISCLAIM_NOTICE_ID = "disclaim-error";

export function ClaimErrorNoticeController({
  entryKey,
}: {
  /** The card entry whose claim/disclaim round trips this notice reports on. */
  entryKey: string;
}): null {
  const api = useTugPaneBulletin();
  // Last-posted detail per verb. Local data ([L24]) — never React state.
  const postedRef = useRef<{ claim: string | null; disclaim: string | null }>({
    claim: null,
    disclaim: null,
  });

  useLayoutEffect(() => {
    const store = getChangesetVerbStore();
    if (store === null) return;

    const apply = (): void => {
      const posted = postedRef.current;
      const claimDetail = store.claimState(entryKey).error;
      if (claimDetail !== posted.claim) {
        posted.claim = claimDetail;
        if (claimDetail === null) {
          api.dismiss(CLAIM_NOTICE_ID);
        } else {
          api.danger("Claim failed", {
            id: CLAIM_NOTICE_ID,
            description: claimDetail,
            sticky: true,
          });
        }
      }
      const disclaimDetail = store.disclaimState(entryKey).error;
      if (disclaimDetail !== posted.disclaim) {
        posted.disclaim = disclaimDetail;
        if (disclaimDetail === null) {
          api.dismiss(DISCLAIM_NOTICE_ID);
        } else {
          api.danger("Disclaim failed", {
            id: DISCLAIM_NOTICE_ID,
            description: disclaimDetail,
            sticky: true,
          });
        }
      }
    };

    apply();
    return store.subscribe(apply);
  }, [entryKey, api]);

  return null;
}
