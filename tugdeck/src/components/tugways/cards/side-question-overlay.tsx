/**
 * side-question-overlay.tsx — the non-modal `/btw` side-question surface
 * ([P02]).
 *
 * `/btw <question>` asks Claude a quick side question, answered from the live
 * conversation with no tools and never entering the transcript. The answer
 * renders here in a **pinned** {@link TugPinnedPanel} — a small "/btw" mini-pane
 * that floats over the bottom of the transcript, right-aligned to the card and
 * sitting just above the Z2 status row (the least obtrusive spot, so a
 * streaming turn stays visible while a side answer loads — mid-turn is the
 * point, [Q01]b). Unlike the popover it replaced, it stays put until the user
 * closes it with the panel's `×` — clicking away or switching panes no longer
 * dismisses it. The user can drag it horizontally to a comfortable reading
 * spot; that position persists across reloads per card ([L02]).
 *
 * The pane reads the ephemeral {@link SideQuestionStore} via
 * `useSyncExternalStore` ([L02]) and renders each exchange as a mini
 * transcript pair — a `You` row (the question) over a `Bot` row (the answer,
 * as markdown via {@link TugMarkdownBlock}, or the three-bar thinking
 * indicator while it loads). Multiple side questions stack, newest last. Each
 * exchange carries a `×` to cancel/dismiss it; the footer's Clear empties the
 * whole zone. Appearance (loading pose, synthetic marker) rides `data-*` + CSS,
 * never React state ([L06]).
 *
 * Nothing is dispatched to the code-session store, so the exchange never
 * becomes a transcript row and survives a reload with no trace ([P05]). The
 * dev card opens it imperatively (`ref.open()`) from `slashCommandSurfaces` —
 * the [D107] pattern `/tasks` uses for the WORK popover.
 *
 * @module components/tugways/cards/side-question-overlay
 */

import React, {
  forwardRef,
  useImperativeHandle,
  useState,
  useSyncExternalStore,
} from "react";
import { Bot, MessageSquareDashed, User, X } from "lucide-react";

import { TugPinnedPanel } from "@/components/tugways/tug-pinned-panel";
import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";
import { TugProgressIndicator } from "@/components/tugways/tug-progress-indicator";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { BlockCopyButton } from "@/components/tugways/body-kinds/affordances";
import type { SideQuestionStore, SideQuestionExchange } from "@/lib/side-question-store";

import "./side-question-overlay.css";

/** Imperative handle: the dev card opens the pane from the `/btw` surface. */
export interface SideQuestionOverlayHandle {
  open(): void;
}

export interface SideQuestionOverlayProps {
  store: SideQuestionStore;
  /**
   * Tugbank key under which the pane's horizontal drag position persists
   * across reloads (per card, e.g. `btw:<cardId>`). Omit for an ephemeral
   * position that resets each time the pane opens.
   */
  persistKey?: string;
}

/** Plain-text answer for a settled/loading/errored exchange (footer copy). */
function exchangeAnswerText(ex: SideQuestionExchange): string {
  if (ex.phase === "loading") return "…";
  if (ex.phase === "error" || ex.answer === null) return "No response received.";
  return ex.answer;
}

/** Plain-text dump of the whole zone, for the footer Copy. */
function composeZoneCopyText(exchanges: readonly SideQuestionExchange[]): string {
  return exchanges
    .map((ex) => `Q: ${ex.question}\nA: ${exchangeAnswerText(ex)}`)
    .join("\n\n");
}

/**
 * One ask/answer exchange as a mini-transcript pair: a `You` row (question)
 * over a `Bot` row (answer). No timestamps. A settled answer renders as
 * markdown with a copy affordance beneath it; a loading answer shows the same
 * three-bar thinking indicator the transcript uses. The `×` cancels (loading)
 * or dismisses (settled) this exchange.
 */
function SideQuestionExchangeRow({
  exchange,
  onDismiss,
}: {
  exchange: SideQuestionExchange;
  onDismiss: (id: string) => void;
}): React.ReactElement {
  const answered = exchange.phase === "answered" && exchange.answer !== null;
  return (
    <div
      className="side-question-exchange"
      data-phase={exchange.phase}
      data-synthetic={exchange.synthetic ? "" : undefined}
    >
      <button
        type="button"
        className="side-question-dismiss"
        aria-label="Dismiss this side question"
        title={exchange.phase === "loading" ? "Cancel this side question" : "Dismiss"}
        tabIndex={-1}
        data-tug-focus="refuse"
        onClick={() => onDismiss(exchange.id)}
      >
        <X size={12} strokeWidth={2} aria-hidden />
      </button>

      <div className="side-question-line" data-role="you">
        <span className="side-question-avatar" data-role="you" aria-hidden>
          <User size={14} strokeWidth={2} />
        </span>
        <div className="side-question-text side-question-question">
          {exchange.question}
        </div>
      </div>

      <div className="side-question-line" data-role="bot">
        <span className="side-question-avatar" data-role="bot" aria-hidden>
          <Bot size={14} strokeWidth={2} />
        </span>
        <div className="side-question-text side-question-answer" data-phase={exchange.phase}>
          {answered ? (
            <TugMarkdownBlock
              // Mount-once on the settled text (loading → answered is the only
              // transition; a re-ask is a new exchange with a new id/key).
              initialText={exchange.answer ?? ""}
              className="side-question-markdown"
            />
          ) : exchange.phase === "loading" ? (
            <TugProgressIndicator
              variant="wave"
              state="running"
              role="inherit"
              // Smaller than the transcript's 16px default — the mini-pane
              // runs at ~0.82rem text, so the thinking glyph scales down too.
              size={12}
              aria-label="Thinking…"
              aria-live="polite"
            />
          ) : (
            "No response received."
          )}
        </div>
      </div>

      {answered ? (
        <div className="side-question-answer-actions">
          <BlockCopyButton
            subtype="icon-text"
            emphasis="ghost"
            size="2xs"
            aria-label="Copy this side question and answer"
            getText={() => `Q: ${exchange.question}\nA: ${exchangeAnswerText(exchange)}`}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The `/btw` mini-pane. A {@link TugPinnedPanel} shown on demand: the dev card
 * opens it via the imperative handle the instant the `/btw` route is chosen,
 * and it stays put until the user closes it with the panel's `×`. Rendered
 * in-DOM inside the (position:relative) Z2 status row, so it is card-scoped and
 * grows upward over the transcript's tail; the caller CSS pins it just above Z2
 * and fixes its width, while the panel owns the horizontal drag.
 */
export const SideQuestionOverlay = forwardRef<
  SideQuestionOverlayHandle,
  SideQuestionOverlayProps
>(function SideQuestionOverlay({ store, persistKey }, ref) {
  const [open, setOpen] = useState(false);
  useImperativeHandle(ref, () => ({ open: () => setOpen(true) }), []);

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { exchanges } = snapshot;

  return (
    <TugPinnedPanel
      open={open}
      onClose={() => setOpen(false)}
      persistKey={persistKey}
      className="side-question-pane"
      aria-label="Side questions"
      closeLabel="Close side questions"
      header={
        <>
          <MessageSquareDashed
            className="side-question-header-icon"
            size={14}
            strokeWidth={2}
            aria-hidden
          />
          <span className="side-question-header-title">/btw</span>
        </>
      }
    >
      <div className="side-question-body" data-slot="side-question-body">
        {exchanges.length === 0 ? (
          <div className="side-question-empty">No side questions yet.</div>
        ) : (
          exchanges.map((ex) => (
            <SideQuestionExchangeRow
              key={ex.id}
              exchange={ex}
              onDismiss={(id) => store.dismiss(id)}
            />
          ))
        )}
      </div>

      {exchanges.length > 0 ? (
        <div className="side-question-footer" data-slot="side-question-footer">
          <BlockCopyButton
            subtype="text"
            emphasis="outlined"
            size="2xs"
            aria-label="Copy the side-question history"
            getText={() => composeZoneCopyText(exchanges)}
          />
          <TugPushButton
            emphasis="outlined"
            role="action"
            size="2xs"
            aria-label="Clear side questions"
            title="Clear the side-question zone"
            onClick={() => store.clear()}
          >
            Clear
          </TugPushButton>
        </div>
      ) : null}
    </TugPinnedPanel>
  );
});
