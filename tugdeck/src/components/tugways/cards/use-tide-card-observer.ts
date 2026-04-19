/**
 * useTideCardObserver — bridges per-card session events to the
 * picker-notice store.
 *
 * Single responsibility: when `lastError.cause === "resume_failed"`,
 * stash a one-shot notice keyed by this card and clear the binding.
 * The cleared binding makes `useTideCardServices` return null →
 * `TideCardContent` re-renders the picker, which reads the notice
 * and surfaces it above the radio group. We deliberately do NOT
 * call `sendCloseSession` here: the bridge has already torn down
 * on the supervisor side, so a close would leak a duplicate frame.
 *
 * Per-error dedup uses the `lastError.at` timestamp so each unique
 * failure triggers exactly one unbind.
 */

import { useLayoutEffect, useRef } from "react";

import type { CodeSessionStore } from "@/lib/code-session-store";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";
import { pickerNoticeStore } from "@/lib/picker-notice-store";
import { logSessionLifecycle } from "@/lib/session-lifecycle-log";

export function useTideCardObserver(
  cardId: string,
  codeSessionStore: CodeSessionStore,
): void {
  const consumedLastErrorAtRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    return codeSessionStore.subscribe(() => {
      const snap = codeSessionStore.getSnapshot();
      const err = snap.lastError;
      if (
        err === null ||
        err.cause !== "resume_failed" ||
        consumedLastErrorAtRef.current === err.at
      ) {
        return;
      }
      consumedLastErrorAtRef.current = err.at;
      logSessionLifecycle("card.unbind_on_resume_failed", {
        card_id: cardId,
        message: err.message,
      });
      pickerNoticeStore.set(cardId, {
        category: "resume_failed",
        message: err.message,
      });
      cardSessionBindingStore.clearBinding(cardId);
    });
  }, [cardId, codeSessionStore]);
}
