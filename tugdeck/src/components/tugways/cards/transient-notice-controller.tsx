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
    const apply = (): void => {
      const next = projectNotices(store.getSnapshot());
      for (const action of reconcileNotices(prevRef.current, next)) {
        if (action.type === "dismiss") {
          api.dismiss(action.id);
        } else {
          applyShow(api, action.desc);
        }
      }
      prevRef.current = next;
    };

    // Reconcile once against the current snapshot (the store does not call the
    // listener on subscribe), then on every subsequent emission.
    apply();
    return store.subscribe(apply);
  }, [store, api]);

  return null;
}
