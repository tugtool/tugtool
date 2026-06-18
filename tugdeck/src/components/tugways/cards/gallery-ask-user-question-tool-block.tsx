/**
 * gallery-ask-user-question-tool-block.tsx — visual fixtures for the
 * durable `AskUserQuestionToolBlock` (the recorded record left in the
 * transcript after a question resolves).
 *
 * Covers the answer surfaces this parity work added, plus the existing
 * salvage path:
 *
 *  1. Free-text answer — the user typed their own answer ([P01]); the
 *     value isn't an option label and renders verbatim.
 *  2. Multi-select + free text — a normal multi-select pick alongside a
 *     question answered with comma-bearing free text (must NOT be split
 *     into picks).
 *  3. Declined — the user chose `Chat about this` ([P02]); the result
 *     carries `response` and the block shows the "replied in chat" state.
 *  4. Salvage (>4 options) — Claude Code's options-cap
 *     `InputValidationError`; the inline salvage wizard renders the
 *     questions with no cap so the user can still answer. Needs a session
 *     to post the recovered answer, so a no-op stub is supplied.
 *
 * @module components/tugways/cards/gallery-ask-user-question-tool-block
 */

import React from "react";

import { AskUserQuestionToolBlock } from "./tool-blocks/ask-user-question-tool-block";
import type { ToolBlockProps } from "./tool-blocks/types";
import type { CodeSessionStore } from "@/lib/code-session-store";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A single-select question answered with free text — the value isn't one
// of the listed labels, so the block renders it verbatim ([P01]).
const FREE_TEXT_ANSWER: ToolBlockProps = {
  toolUseId: "auq-freetext",
  toolName: "AskUserQuestion",
  seq: 0,
  input: {
    questions: [
      {
        question: "Which approach should we take?",
        options: [
          { label: "Refactor first" },
          { label: "Patch in place" },
        ],
      },
    ],
    answers: {
      "Which approach should we take?":
        "Let's prototype a third option before deciding",
    },
  },
  status: "ready",
};

// A multi-question payload: one answered by picking labels (multi-select),
// one answered with comma-bearing free text that must stay verbatim.
const MIXED_ANSWERS: ToolBlockProps = {
  toolUseId: "auq-mixed",
  toolName: "AskUserQuestion",
  seq: 1,
  input: {
    questions: [
      {
        question: "Which checks should run?",
        multiSelect: true,
        options: [{ label: "lint" }, { label: "test" }, { label: "typecheck" }],
      },
      {
        question: "Anything else?",
        options: [{ label: "No" }, { label: "Yes" }],
      },
    ],
    answers: {
      "Which checks should run?": "lint,typecheck",
      "Anything else?": "Yes, also run the app-test sweep",
    },
  },
  status: "ready",
};

// The user declined the questions and replied in prose ([P02]); the
// result carries `response` instead of `answers`.
const DECLINED: ToolBlockProps = {
  toolUseId: "auq-declined",
  toolName: "AskUserQuestion",
  seq: 2,
  input: {
    questions: [
      {
        question: "Ship now or wait for review?",
        options: [{ label: "Ship now" }, { label: "Wait" }],
      },
    ],
    response:
      "Neither — let's pair on it tomorrow morning and decide together then.",
  },
  status: "ready",
};

// A >4-options payload Claude Code's schema rejected. The salvage wizard
// renders inline so the user can still answer; it posts via the session,
// so a no-op stub stands in for the gallery.
const SALVAGE_SESSION = {
  send: () => {},
} as unknown as CodeSessionStore;

const SALVAGE: ToolBlockProps = {
  toolUseId: "auq-salvage",
  toolName: "AskUserQuestion",
  seq: 3,
  input: {
    questions: [
      {
        question: "Which language for the docs?",
        options: [
          { label: "English" },
          { label: "Spanish" },
          { label: "French" },
          { label: "German" },
          { label: "Japanese" },
          { label: "Portuguese" },
        ],
      },
    ],
  },
  textOutput:
    'InputValidationError: [ { "origin": "array", "code": "too_big", "maximum": 4, "inclusive": true, "path": [ "questions", 0, "options" ], "message": "Too big: expected array to have <=4 items" } ]',
  isError: true,
  status: "error",
  session: SALVAGE_SESSION,
};

// ---------------------------------------------------------------------------
// GalleryAskUserQuestionToolBlock
// ---------------------------------------------------------------------------

export function GalleryAskUserQuestionToolBlock(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-ask-user-question-tool-block">
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Free-text answer — typed verbatim, not a listed label ([P01])
        </TugLabel>
        <AskUserQuestionToolBlock {...FREE_TEXT_ANSWER} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Mixed — multi-select picks + comma-bearing free text (not split)
        </TugLabel>
        <AskUserQuestionToolBlock {...MIXED_ANSWERS} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Declined — replied in chat instead of answering ([P02])
        </TugLabel>
        <AskUserQuestionToolBlock {...DECLINED} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Salvage — &gt;4 options rejected by the cap; inline recovery wizard
        </TugLabel>
        <AskUserQuestionToolBlock {...SALVAGE} />
      </div>
    </div>
  );
}
