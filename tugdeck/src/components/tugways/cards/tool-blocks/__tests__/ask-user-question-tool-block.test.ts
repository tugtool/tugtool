/**
 * Pure-logic tests for `AskUserQuestionToolBlock`'s helpers and the
 * `AskUserQuestion` dispatch resolution.
 *
 * The visible composition (chrome + numbered Q&A list) is HMR-vetted
 * per the project's testing policy. This file pins:
 *
 *  - `readAnswers` — defensive narrowing of the `answers` map from
 *    either `structuredResult` or `input` (tugcode's
 *    `formatQuestionAnswer` merges the map onto `updatedInput`,
 *    so either surface can carry it depending on catalog version).
 *  - `composeAnswerSummary` — pairs each parsed question with its
 *    chosen label(s), splits multi-select answers on the bare comma
 *    join tugcode uses (PN-5), drops empty answers to `[]`.
 *  - `composeQuestionCountLabel` — short args summary for the chrome
 *    header: `"N questions"` vs `"M of N answered"`.
 *  - Dispatch resolution: `AskUserQuestion` (any casing) resolves to
 *    the real `AskUserQuestionToolBlock` factory.
 */

import { describe, expect, test } from "bun:test";

import {
  AskUserQuestionToolBlock,
  composeAnswerSummary,
  composeQuestionCountLabel,
  composeSalvagedAnswerMessage,
  composeValidationErrorBanner,
  parseAskUserQuestionInputValidationError,
  readAnswers,
} from "../ask-user-question-tool-block";
import {
  _resetToolBlockRegistryForTests,
  registerToolBlock,
  resolveToolBlock,
} from "../../tide-assistant-renderer-dispatch";
import type { ParsedQuestion } from "@/components/tugways/chrome/tide-question-dialog";

function q(question: string, multiSelect: boolean, labels: string[]): ParsedQuestion {
  return {
    question,
    multiSelect,
    options: labels.map((label) => ({ label })),
  };
}

describe("readAnswers", () => {
  test("reads structuredResult.answers when present", () => {
    const out = readAnswers(
      { questions: [] },
      { answers: { "Q1?": "A1" } },
    );
    expect(out).toEqual({ "Q1?": "A1" });
  });

  test("falls back to input.answers when structuredResult lacks answers", () => {
    // tugcode's formatQuestionAnswer merges the answers map onto
    // `updatedInput`; some catalog versions surface that as the
    // visible `tool_use.input` while the structured result is empty.
    const out = readAnswers(
      { questions: [], answers: { "Q1?": "A1" } },
      undefined,
    );
    expect(out).toEqual({ "Q1?": "A1" });
  });

  test("structuredResult.answers wins over input.answers", () => {
    const out = readAnswers(
      { answers: { "Q1?": "stale" } },
      { answers: { "Q1?": "fresh" } },
    );
    expect(out).toEqual({ "Q1?": "fresh" });
  });

  test("returns empty object when neither surface carries answers", () => {
    expect(readAnswers({ questions: [] }, undefined)).toEqual({});
    expect(readAnswers(null, null)).toEqual({});
    expect(readAnswers(undefined, undefined)).toEqual({});
  });

  test("drops non-string answer values silently", () => {
    const out = readAnswers(
      undefined,
      { answers: { "Q1?": "ok", "Q2?": 42, "Q3?": null } },
    );
    expect(out).toEqual({ "Q1?": "ok" });
  });
});

describe("composeAnswerSummary", () => {
  test("pairs each question with its chosen single-select label", () => {
    const out = composeAnswerSummary(
      [q("Which approach?", false, ["Refactor", "Patch"])],
      { "Which approach?": "Refactor" },
    );
    expect(out).toEqual([{ question: "Which approach?", answers: ["Refactor"] }]);
  });

  test("splits multi-select answers on the bare comma join (PN-5)", () => {
    const out = composeAnswerSummary(
      [q("Pick all", true, ["A", "B", "C"])],
      { "Pick all": "A,C" },
    );
    expect(out).toEqual([{ question: "Pick all", answers: ["A", "C"] }]);
  });

  test("trims and drops empty parts from a multi-select answer", () => {
    // Defensive: a downstream layer that adds spaces or trailing
    // separators shouldn't break the row count.
    const out = composeAnswerSummary(
      [q("Pick", true, ["A", "B"])],
      { Pick: "A, ,B" },
    );
    expect(out[0].answers).toEqual(["A", "B"]);
  });

  test("missing answer renders as empty array (no answer)", () => {
    const out = composeAnswerSummary(
      [q("Q1", false, ["A"]), q("Q2", false, ["B"])],
      { Q1: "A" },
    );
    expect(out).toEqual([
      { question: "Q1", answers: ["A"] },
      { question: "Q2", answers: [] },
    ]);
  });

  test("empty-string answer renders as no answer", () => {
    const out = composeAnswerSummary([q("Q", true, ["X"])], { Q: "" });
    expect(out).toEqual([{ question: "Q", answers: [] }]);
  });

  test("preserves question order from the parsed questions array", () => {
    const out = composeAnswerSummary(
      [q("First", false, ["A"]), q("Second", false, ["B"]), q("Third", false, ["C"])],
      { Third: "C", First: "A", Second: "B" },
    );
    expect(out.map((e) => e.question)).toEqual(["First", "Second", "Third"]);
  });
});

describe("composeQuestionCountLabel", () => {
  test("empty list → empty string", () => {
    expect(composeQuestionCountLabel(0, 0)).toBe("");
  });

  test("no answers yet → singular / plural count", () => {
    expect(composeQuestionCountLabel(1, 0)).toBe("1 question");
    expect(composeQuestionCountLabel(3, 0)).toBe("3 questions");
  });

  test("partial answers → 'M of N answered'", () => {
    expect(composeQuestionCountLabel(3, 1)).toBe("1 of 3 answered");
    expect(composeQuestionCountLabel(3, 3)).toBe("3 of 3 answered");
  });
});

describe("AskUserQuestion dispatch resolution", () => {
  test("AskUserQuestion (any casing) resolves to the real wrapper", () => {
    _resetToolBlockRegistryForTests();
    registerToolBlock("askuserquestion", AskUserQuestionToolBlock);
    expect(resolveToolBlock("askuserquestion")).toBe(AskUserQuestionToolBlock);
    expect(resolveToolBlock("AskUserQuestion")).toBe(AskUserQuestionToolBlock);
    expect(resolveToolBlock("ASKUSERQUESTION")).toBe(AskUserQuestionToolBlock);
  });
});

// ---------------------------------------------------------------------------
// Validation-error parser (salvage trigger)
// ---------------------------------------------------------------------------

describe("parseAskUserQuestionInputValidationError", () => {
  /** A real-world InputValidationError as Claude Code emits it. */
  const REAL_ERROR =
    'InputValidationError: [ { "origin": "array", "code": "too_big", "maximum": 4, "inclusive": true, "path": [ "questions", 1, "options" ], "message": "Too big: expected array to have <=4 items" } ]';

  test("parses the canonical too-big-options error", () => {
    const out = parseAskUserQuestionInputValidationError(REAL_ERROR);
    expect(out).not.toBeNull();
    expect(out?.issues.length).toBe(1);
    expect(out?.issues[0].code).toBe("too_big");
    expect(out?.issues[0].maximum).toBe(4);
    expect(out?.issues[0].path).toEqual(["questions", 1, "options"]);
    expect(out?.issues[0].message).toContain("expected array to have <=4 items");
  });

  test("returns null for non-validation error text", () => {
    expect(parseAskUserQuestionInputValidationError("Some other error")).toBeNull();
    expect(parseAskUserQuestionInputValidationError("Tool call timed out")).toBeNull();
  });

  test("returns null for undefined / empty", () => {
    expect(parseAskUserQuestionInputValidationError(undefined)).toBeNull();
    expect(parseAskUserQuestionInputValidationError("")).toBeNull();
  });

  test("returns null when the bracketed payload is malformed JSON", () => {
    expect(
      parseAskUserQuestionInputValidationError(
        "InputValidationError: [ this is not json ]",
      ),
    ).toBeNull();
  });

  test("survives trailing prose after the issue array", () => {
    const text = `${REAL_ERROR} please retry with fewer options`;
    const out = parseAskUserQuestionInputValidationError(text);
    expect(out).not.toBeNull();
    expect(out?.issues.length).toBe(1);
  });

  test("parses multiple issues", () => {
    const text =
      'InputValidationError: [ { "code": "too_big", "path": [ "questions", 0, "options" ], "maximum": 4 }, { "code": "too_big", "path": [ "questions", 2, "options" ], "maximum": 4 } ]';
    const out = parseAskUserQuestionInputValidationError(text);
    expect(out?.issues.length).toBe(2);
    expect(out?.issues[1].path).toEqual(["questions", 2, "options"]);
  });

  test("drops non-string non-number path entries silently", () => {
    const text =
      'InputValidationError: [ { "code": "too_big", "path": [ "questions", 1, null, "options" ] } ]';
    const out = parseAskUserQuestionInputValidationError(text);
    expect(out?.issues[0].path).toEqual(["questions", 1, "options"]);
  });
});

describe("composeValidationErrorBanner", () => {
  test("calls out the options cap explicitly when the issue is too_big-options", () => {
    const banner = composeValidationErrorBanner({
      issues: [
        {
          code: "too_big",
          path: ["questions", 0, "options"],
          maximum: 4,
        },
      ],
    });
    expect(banner).toContain("at most 4 options");
    expect(banner).toContain("Answer it here anyway");
  });

  test("falls back to a generic line for unknown shapes", () => {
    const banner = composeValidationErrorBanner({
      issues: [{ code: "weird", message: "something" }],
    });
    expect(banner).toContain("Claude Code rejected");
    expect(banner).toContain("Answer it here anyway");
  });

  test("uses the issue's maximum when present", () => {
    const banner = composeValidationErrorBanner({
      issues: [
        {
          code: "too_big",
          path: ["questions", 0, "options"],
          maximum: 6,
        },
      ],
    });
    expect(banner).toContain("at most 6 options");
  });
});

describe("composeSalvagedAnswerMessage", () => {
  function q(question: string, multiSelect: boolean, labels: string[]): ParsedQuestion {
    return {
      question,
      multiSelect,
      options: labels.map((label) => ({ label })),
    };
  }

  test("composes a numbered Q→A message for posting back as a user turn", () => {
    const questions = [
      q("Which scope?", false, ["A", "B"]),
      q("Which kinds?", true, ["X", "Y", "Z"]),
    ];
    const answers = new Map<string, string[]>([
      ["Which scope?", ["A"]],
      ["Which kinds?", ["X", "Z"]],
    ]);
    const text = composeSalvagedAnswerMessage(questions, answers);
    expect(text).toContain("My answers to your AskUserQuestion");
    expect(text).toContain("1. Which scope? → A");
    expect(text).toContain("2. Which kinds? → X, Z");
  });

  test("renders empty selections as `(no answer)`", () => {
    const questions = [q("Pick one", false, ["A"])];
    const answers = new Map<string, string[]>([["Pick one", []]]);
    const text = composeSalvagedAnswerMessage(questions, answers);
    expect(text).toContain("(no answer)");
  });

  test("handles a missing entry the same as an empty selection", () => {
    const questions = [q("Pick one", false, ["A"])];
    const text = composeSalvagedAnswerMessage(questions, new Map());
    expect(text).toContain("(no answer)");
  });

  test("preserves question order from the questions array", () => {
    const questions = [
      q("First", false, ["a"]),
      q("Second", false, ["b"]),
      q("Third", false, ["c"]),
    ];
    const answers = new Map([
      ["Third", ["c"]],
      ["First", ["a"]],
      ["Second", ["b"]],
    ]);
    const lines = composeSalvagedAnswerMessage(questions, answers).split("\n");
    // Skip the lead-in line; the next three are 1./2./3.
    expect(lines[1]).toContain("1. First");
    expect(lines[2]).toContain("2. Second");
    expect(lines[3]).toContain("3. Third");
  });
});
