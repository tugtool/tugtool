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
  readAnswers,
} from "../ask-user-question-tool-block";
import {
  _resetToolWrapperRegistryForTests,
  registerToolWrapper,
  resolveToolWrapper,
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
    _resetToolWrapperRegistryForTests();
    registerToolWrapper("askuserquestion", AskUserQuestionToolBlock);
    expect(resolveToolWrapper("askuserquestion")).toBe(AskUserQuestionToolBlock);
    expect(resolveToolWrapper("AskUserQuestion")).toBe(AskUserQuestionToolBlock);
    expect(resolveToolWrapper("ASKUSERQUESTION")).toBe(AskUserQuestionToolBlock);
  });
});
