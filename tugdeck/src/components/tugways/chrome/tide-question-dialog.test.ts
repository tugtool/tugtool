/**
 * Pure-logic tests for `tide-question-dialog.tsx`.
 *
 * `QuestionDialog`'s behaviour is its exported pure helpers — the
 * `AskUserQuestion` payload parser, the initial-selection seed, the
 * per-question selection apply, and the `answers`-record builder —
 * plus the dispatch wiring (`KIND_RENDERERS.question` resolves to the
 * real component). Per project policy (pure-logic `bun:test` +
 * real-app tests only, no fake-DOM render tests), the suite pins those
 * exhaustively; the answer round-trip, the radio/checkbox paint, and
 * primary-button focus are HMR / live-smoke vetted because the
 * app-test harness can't inject `control_request_forward` events (the
 * same gap that gates the permission dialog).
 *
 * Coverage:
 *  - `parseQuestions` — the real `input.questions` shape, the
 *    `multiSelect` flag, option descriptions, the drop rules
 *    (no question text, no options, malformed option), and the
 *    degenerate `[]` for a non-object / question-less payload.
 *  - `initialQuestionSelections` — single-select pre-selects the
 *    first option, multi-select starts empty.
 *  - `applyQuestionSelection` — single-select replaces, multi-select
 *    toggles on and off.
 *  - `buildQuestionAnswers` — keyed by question text, single label,
 *    multi-select comma-join (no spaces), empty-selection passthrough.
 *  - dispatch routing — a `question` RenderInput resolves to
 *    `QuestionDialog`.
 */

import { describe, it, expect } from "bun:test";

import {
  QuestionDialog,
  applyQuestionSelection,
  buildQuestionAnswers,
  initialQuestionSelections,
  parseQuestions,
  type ParsedQuestion,
} from "./tide-question-dialog";
import {
  KIND_RENDERERS,
  dispatch,
  type DispatchContext,
  type RenderInput,
} from "@/components/tugways/cards/tide-assistant-renderer-dispatch";
import type { ControlRequestForward } from "@/lib/code-session-store";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A question `control_request_forward` carrying the real tugcode
 *  `AskUserQuestion` input shape (`input.questions[]`). */
function questionForward(questions: unknown): ControlRequestForward {
  return {
    request_id: "q-req-1",
    is_question: true,
    tool_name: "AskUserQuestion",
    input: { questions },
  };
}

/** A `ParsedQuestion` literal for the selection / answer helpers. */
function parsed(
  question: string,
  multiSelect: boolean,
  labels: string[],
): ParsedQuestion {
  return {
    question,
    multiSelect,
    options: labels.map((label) => ({ label })),
  };
}

// ---------------------------------------------------------------------------
// parseQuestions
// ---------------------------------------------------------------------------

describe("parseQuestions", () => {
  it("parses a single-select question with options", () => {
    const out = parseQuestions(
      questionForward([
        {
          question: "Which approach?",
          options: [
            { label: "Refactor", description: "Restructure first" },
            { label: "Patch" },
          ],
        },
      ]),
    );
    expect(out).toEqual([
      {
        question: "Which approach?",
        multiSelect: false,
        options: [
          { label: "Refactor", description: "Restructure first" },
          { label: "Patch", description: undefined },
        ],
      },
    ]);
  });

  it("carries the multiSelect flag", () => {
    const out = parseQuestions(
      questionForward([
        {
          question: "Pick all that apply",
          multiSelect: true,
          options: [{ label: "A" }, { label: "B" }],
        },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].multiSelect).toBe(true);
  });

  it("parses a multi-question payload", () => {
    const out = parseQuestions(
      questionForward([
        { question: "First?", options: [{ label: "Yes" }] },
        { question: "Second?", options: [{ label: "No" }] },
      ]),
    );
    expect(out.map((q) => q.question)).toEqual(["First?", "Second?"]);
  });

  it("drops a question with no text", () => {
    const out = parseQuestions(
      questionForward([
        { question: "   ", options: [{ label: "A" }] },
        { options: [{ label: "B" }] },
      ]),
    );
    expect(out).toEqual([]);
  });

  it("drops a question with no usable options (it cannot round-trip)", () => {
    const out = parseQuestions(
      questionForward([
        { question: "No options here", options: [] },
        { question: "Bad options", options: [{ description: "no label" }, null] },
      ]),
    );
    expect(out).toEqual([]);
  });

  it("drops a single malformed option but keeps the rest of the question", () => {
    const out = parseQuestions(
      questionForward([
        {
          question: "Mixed options",
          options: [{ label: "Good" }, { label: "  " }, 7, { label: "Also good" }],
        },
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].options.map((o) => o.label)).toEqual(["Good", "Also good"]);
  });

  it("returns [] for a non-object input or a missing questions array", () => {
    expect(parseQuestions({ request_id: "r", is_question: true })).toEqual([]);
    expect(
      parseQuestions({ request_id: "r", is_question: true, input: "nope" }),
    ).toEqual([]);
    expect(parseQuestions(questionForward("not-an-array"))).toEqual([]);
    expect(parseQuestions(questionForward([]))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// initialQuestionSelections
// ---------------------------------------------------------------------------

describe("initialQuestionSelections", () => {
  it("pre-selects the first option of a single-select question", () => {
    expect(
      initialQuestionSelections([parsed("Q", false, ["A", "B", "C"])]),
    ).toEqual([["A"]]);
  });

  it("starts a multi-select question empty", () => {
    expect(
      initialQuestionSelections([parsed("Q", true, ["A", "B"])]),
    ).toEqual([[]]);
  });

  it("seeds each question of a mixed payload independently", () => {
    expect(
      initialQuestionSelections([
        parsed("single", false, ["X", "Y"]),
        parsed("multi", true, ["P", "Q"]),
      ]),
    ).toEqual([["X"], []]);
  });
});

// ---------------------------------------------------------------------------
// applyQuestionSelection
// ---------------------------------------------------------------------------

describe("applyQuestionSelection", () => {
  it("single-select replaces the current choice (radio semantics)", () => {
    const q = parsed("Q", false, ["A", "B"]);
    expect(applyQuestionSelection(q, ["A"], "B")).toEqual(["B"]);
  });

  it("multi-select adds an unselected option (checkbox semantics)", () => {
    const q = parsed("Q", true, ["A", "B"]);
    expect(applyQuestionSelection(q, [], "A")).toEqual(["A"]);
    expect(applyQuestionSelection(q, ["A"], "B")).toEqual(["A", "B"]);
  });

  it("multi-select toggles a selected option back off", () => {
    const q = parsed("Q", true, ["A", "B"]);
    expect(applyQuestionSelection(q, ["A", "B"], "A")).toEqual(["B"]);
  });
});

// ---------------------------------------------------------------------------
// buildQuestionAnswers
// ---------------------------------------------------------------------------

describe("buildQuestionAnswers", () => {
  it("keys answers by question text, single-select value is the label", () => {
    expect(
      buildQuestionAnswers([parsed("Which approach?", false, ["Refactor"])], [
        ["Refactor"],
      ]),
    ).toEqual({ "Which approach?": "Refactor" });
  });

  it("comma-joins multi-select labels with no spaces", () => {
    // tugcode's formatQuestionAnswer expects bare-comma joins (PN-5).
    expect(
      buildQuestionAnswers([parsed("Pick all", true, ["A", "B", "C"])], [
        ["A", "C"],
      ]),
    ).toEqual({ "Pick all": "A,C" });
  });

  it("emits an empty-string value for a question with no selection", () => {
    expect(
      buildQuestionAnswers([parsed("Skipped?", true, ["A"])], [[]]),
    ).toEqual({ "Skipped?": "" });
  });

  it("builds one entry per question of a multi-question payload", () => {
    expect(
      buildQuestionAnswers(
        [parsed("First?", false, ["Yes"]), parsed("Second?", true, ["X", "Y"])],
        [["Yes"], ["X", "Y"]],
      ),
    ).toEqual({ "First?": "Yes", "Second?": "X,Y" });
  });
});

// ---------------------------------------------------------------------------
// dispatch routing
// ---------------------------------------------------------------------------

describe("dispatch — question routing", () => {
  it("routes a question RenderInput to the real QuestionDialog", () => {
    const input: RenderInput = {
      kind: "question",
      request: {
        request_id: "q-1",
        is_question: true,
        tool_name: "AskUserQuestion",
        input: {
          questions: [{ question: "Proceed?", options: [{ label: "Yes" }] }],
        },
      },
    };
    const result = dispatch(input, {} as DispatchContext);
    expect(result.Component).toBe(QuestionDialog);
    expect(result.Component).toBe(KIND_RENDERERS.question);
    expect(result.caution).toBeUndefined();
    expect((result.props as { input: RenderInput }).input).toBe(input);
  });
});
