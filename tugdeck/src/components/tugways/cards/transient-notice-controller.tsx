/**
 * TransientNoticeController — observes a `CodeSessionStore` and projects its
 * transient interruption state onto pane bulletins, with no React render in
 * the loop.
 *
 * This is the imperative half of the transient-notice surface (the pure half
 * is `transient-notice.ts`). It mounts inside the card's top-right
 * `TugPaneBulletinProvider`, subscribes directly to the store ([L22] — a
 * bulletin is a direct DOM update, so it must not round-trip through
 * `useSyncExternalStore`/render), and on every store emission diffs the
 * projected notices against the last set and applies the post/dismiss actions
 * to the bulletin API. The subscription is registered in `useLayoutEffect`
 * ([L03]); no notice state ever enters React state ([L02]); appearance is the
 * bulletin's own CSS/DOM ([L06]).
 *
 * Zero-render: it returns `null`. The component exists only to own the
 * subscription lifecycle within the provider's context.
 */

import { useLayoutEffect, useRef } from "react";

import type { CodeSessionStore } from "@/lib/code-session-store";

import {
  type TugPaneBulletinApi,
  useTugPaneBulletin,
} from "../tug-pane-bulletin";
import {
  type NoticeDesc,
  projectNotices,
  reconcileNotices,
} from "./transient-notice";

function applyShow(api: TugPaneBulletinApi, desc: NoticeDesc): void {
  const options: {
    id: string;
    description?: string;
    duration?: number;
    sticky?: boolean;
  } = { id: desc.id, description: desc.description };
  if (desc.persistence === "condition") {
    // Persist with no auto-timeout and no dismiss button; the controller
    // dismisses it when the driving condition clears.
    options.duration = Infinity;
  } else if (desc.persistence === "ack") {
    options.sticky = true;
  }
  // `ephemeral` leaves the default duration so it auto-dismisses.

  switch (desc.tone) {
    case "danger":
      api.danger(desc.message, options);
      break;
    case "success":
      api.success(desc.message, options);
      break;
    case "caution":
      api.caution(desc.message, options);
      break;
    default:
      api(desc.message, options);
  }
}

export function TransientNoticeController({
  store,
}: {
  store: CodeSessionStore;
}): null {
  const api = useTugPaneBulletin();
  // Last-projected notices. Local data ([L24]) — never React state, so a
  // climbing retry count doesn't re-render the card.
  const prevRef = useRef<NoticeDesc[]>([]);

  useLayoutEffect(() => {
    // 1 Hz countdown ticker. A retry notice carries a `countdownTo` deadline;
    // its "next try in Ns" tail must advance once a second even when the store
    // is silent. We can't lean on the store (it's time-free) or React state
    // (this controller is zero-render [L22]), so the tick is a self-managing
    // interval that simply re-runs `apply` — `projectNotices` recomputes the
    // tail against the new `now`, and the existing diff drives the in-place
    // update. The interval only runs while something is counting down; an idle
    // tick would be a pure no-op diff, so we stop it rather than spin.
    let tickId: ReturnType<typeof setInterval> | null = null;
    const stopTick = (): void => {
      if (tickId !== null) {
        clearInterval(tickId);
        tickId = null;
      }
    };

    const apply = (): void => {
      const now = Date.now();
      const next = projectNotices(store.getSnapshot(), now);
      for (const action of reconcileNotices(prevRef.current, next)) {
        if (action.type === "dismiss") {
          api.dismiss(action.id);
        } else {
          applyShow(api, action.desc);
        }
      }
      prevRef.current = next;

      const ticking = next.some(
        (d) => d.countdownTo !== undefined && d.countdownTo > now,
      );
      if (ticking && tickId === null) {
        tickId = setInterval(apply, 1000);
      } else if (!ticking) {
        stopTick();
      }
    };

    // Reconcile once against the current snapshot (the store does not call the
    // listener on subscribe), then on every subsequent emission.
    apply();
    const unsubscribe = store.subscribe(apply);
    return () => {
      unsubscribe();
      stopTick();
    };
  }, [store, api]);

  return null;
}
