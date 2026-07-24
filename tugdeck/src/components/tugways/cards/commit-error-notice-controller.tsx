/**
 * CommitErrorNoticeController — projects commit mode's failure detail onto a
 * pane bulletin.
 *
 * A `changeset_commit_err` reply settles the round-trip into `commitError` and
 * re-enters the mode (the shade comes back up), but the detail itself had no
 * surface: a refused commit read as the sheet flashing and returning with no
 * word of why. This zero-render controller mounts inside the card's top-right
 * `TugPaneBulletinProvider`, subscribes straight to the `CommitModeController`
 * ([L22] — a bulletin is a direct DOM update, so it must not round-trip through
 * `useSyncExternalStore`/render), and posts one sticky danger notice carrying
 * git's own stderr. The notice dismisses when the error clears (the next
 * attempt's `pending`, or a success).
 *
 * The subscription registers in `useLayoutEffect` ([L03]); no notice state
 * enters React state ([L02]); appearance is the bulletin's own CSS/DOM ([L06]).
 */

import { useLayoutEffect, useRef } from "react";

import type { CommitModeController } from "@/lib/commit-mode-controller";

import { useTugPaneBulletin } from "../tug-pane-bulletin";

const NOTICE_ID = "commit-error";

export function CommitErrorNoticeController({
  controller,
}: {
  controller: CommitModeController;
}): null {
  const api = useTugPaneBulletin();
  // Last-posted detail. Local data ([L24]) — never React state.
  const postedRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const apply = (): void => {
      const detail = controller.getSnapshot().commitError;
      if (detail === postedRef.current) return;
      postedRef.current = detail;
      if (detail === null) {
        api.dismiss(NOTICE_ID);
      } else {
        api.danger("Commit failed", {
          id: NOTICE_ID,
          description: detail,
          sticky: true,
        });
      }
    };

    apply();
    return controller.subscribe(apply);
  }, [controller, api]);

  return null;
}
