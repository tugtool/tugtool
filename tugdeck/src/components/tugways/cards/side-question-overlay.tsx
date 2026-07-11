/**
 * side-question-overlay.tsx — the `/btw` side-question surface body ([P02]).
 *
 * `/btw <question>` asks Claude a quick side question, answered from the live
 * conversation with no tools and never entering the transcript. The answer
 * renders in the shared Z2 {@link TugPlacard} (opened on the BTW cell) — this
 * module contributes only the placard's **body**: the exchange list + footer.
 * The placard chrome (header, open/close, under-cell anchoring, auto-dismiss)
 * is owned by the Z2 status row like every other Z2 surface, so `/btw` is no
 * longer special — one open at a time, dismissed by clicking away.
 *
 * The body reads the ephemeral {@link SideQuestionStore} via
 * `useSyncExternalStore` ([L02]) and renders each exchange as a mini
 * transcript pair — a `You` row (the question) over a `Bot` row (the answer,
 * as markdown via {@link TugMarkdownBlock}, or the three-bar thinking
 * indicator while it loads). Multiple side questions stack, newest last. Each
 * exchange carries a `×` to cancel/dismiss it; the footer's Clear empties the
 * whole zone. Appearance (loading pose, synthetic marker) rides `data-*` + CSS,
 * never React state ([L06]).
 *
 * Nothing is dispatched to the code-session store, so the exchange never
 * becomes a transcript row and survives a reload with no trace ([P05]).
 *
 * @module components/tugways/cards/side-question-overlay
 */

import React, { useSyncExternalStore } from "react";
import { Bot, User, X } from "lucide-react";

import { TugMarkdownBlock } from "@/components/tugways/tug-markdown-block";
import { TugProgressIndicator } from "@/components/tugways/tug-progress-indicator";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { BlockCopyButton } from "@/components/tugways/body-kinds/affordances";
import type { SideQuestionStore, SideQuestionExchange } from "@/lib/side-question-store";

import "./side-question-overlay.css";

export interface SideQuestionBodyProps {
  store: SideQuestionStore;
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
 * The `/btw` placard body — the exchange list + footer, rendered inside the
 * shared Z2 {@link TugPlacard} by the status row when the BTW cell is open.
 * Reads the ephemeral {@link SideQuestionStore} via `useSyncExternalStore`
 * ([L02]); the placard chrome (open/close, anchoring, dismiss) lives in the
 * host, not here.
 */
export function SideQuestionBody({ store }: SideQuestionBodyProps): React.ReactElement {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { exchanges } = snapshot;

  return (
    <>
      <div className="side-question-body" data-slot="side-question-body">
        {exchanges.length === 0 ? (
          <div className="side-question-empty">No side questions</div>
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
    </>
  );
}
