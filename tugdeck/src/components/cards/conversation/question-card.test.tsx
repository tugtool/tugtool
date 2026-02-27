/**
 * QuestionCard React component tests — Step 6.1
 *
 * Covers:
 * - Renders radio buttons (Radix RadioGroupItem: button[role='radio']) for single_choice
 * - Renders checkboxes (Radix Checkbox: button[role='checkbox']) for multi_choice
 * - Renders text input for free-text questions
 * - Submit dispatches question-answer CustomEvent with correct payload
 * - Cancel dispatches question-cancel CustomEvent
 */
import "./setup-test-dom"; // must be first

import { describe, it, expect } from "bun:test";
import { render, fireEvent, act } from "@testing-library/react";
import React from "react";

/**
 * Set the value of an uncontrolled Input and optionally fire a change event.
 *
 * The QuestionCard text inputs are uncontrolled (defaultValue + ref), so we
 * can assign input.value directly without needing to trigger React state
 * updates. The value is then read via the DOM ref at submit time.
 */
function setInputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
}

import { QuestionCard } from "./question-card";
import type { QuestionDef } from "../../../cards/conversation/types";
import type { QuestionAnswerInput } from "../../../cards/conversation/types";

// ---- Helpers ----

function makeTextQuestion(overrides: Partial<QuestionDef> = {}): QuestionDef {
  return { id: "q1", text: "What is your name?", type: "text", ...overrides };
}

function makeSingleChoiceQuestion(overrides: Partial<QuestionDef> = {}): QuestionDef {
  return {
    id: "q1",
    text: "Pick one:",
    type: "single_choice",
    options: [
      { label: "Option A" },
      { label: "Option B", description: "A detailed option" },
    ],
    ...overrides,
  };
}

function makeMultiChoiceQuestion(overrides: Partial<QuestionDef> = {}): QuestionDef {
  return {
    id: "q1",
    text: "Pick many:",
    type: "multi_choice",
    options: [
      { label: "Alpha" },
      { label: "Beta" },
    ],
    ...overrides,
  };
}

/** Render a QuestionCard and return the container plus a listener for events. */
function renderCard(questions: QuestionDef[]) {
  const receivedAnswers: QuestionAnswerInput[] = [];
  const receivedCancels: string[] = [];

  const { container, unmount } = render(
    <QuestionCard requestId="req-test" questions={questions} />
  );

  container.addEventListener("question-answer", (e) => {
    receivedAnswers.push((e as CustomEvent<QuestionAnswerInput>).detail);
  });
  container.addEventListener("question-cancel", (e) => {
    receivedCancels.push((e as CustomEvent<{ requestId: string }>).detail.requestId);
  });

  return { container, unmount, receivedAnswers, receivedCancels };
}

// ---- Tests: single_choice ----

describe("QuestionCard – single_choice", () => {
  it("renders radio buttons for a single_choice question", async () => {
    const { container, unmount } = renderCard([makeSingleChoiceQuestion()]);
    await act(async () => {});

    // Radix RadioGroupItem renders as button[role='radio']
    const radios = container.querySelectorAll("button[role='radio']");
    // Named options + "Other" radio
    expect(radios.length).toBeGreaterThanOrEqual(2);

    unmount();
  });

  it("renders option labels for single_choice", async () => {
    const { container, unmount } = renderCard([makeSingleChoiceQuestion()]);
    await act(async () => {});

    const labels = Array.from(container.querySelectorAll("label")).map(
      (el) => el.textContent?.trim()
    );
    expect(labels.some((l) => l?.includes("Option A"))).toBe(true);
    expect(labels.some((l) => l?.includes("Option B"))).toBe(true);

    unmount();
  });

  it("renders option description when present", async () => {
    const { container, unmount } = renderCard([makeSingleChoiceQuestion()]);
    await act(async () => {});

    const desc = Array.from(container.querySelectorAll("p")).find((el) =>
      el.textContent?.includes("A detailed option")
    );
    expect(desc).not.toBeNull();

    unmount();
  });

  it("Submit dispatches question-answer event with selected radio value", async () => {
    const { container, unmount, receivedAnswers } = renderCard([
      makeSingleChoiceQuestion(),
    ]);
    await act(async () => {});

    // Click "Option A" radio
    const optionARadio = container.querySelector(
      "button[role='radio'][id='q1-Option A']"
    ) as HTMLButtonElement | null;
    expect(optionARadio).not.toBeNull();

    await act(async () => {
      fireEvent.click(optionARadio!);
    });

    // Click Submit
    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Submit"
    );
    expect(submitBtn).not.toBeNull();

    await act(async () => {
      fireEvent.click(submitBtn!);
    });

    expect(receivedAnswers.length).toBe(1);
    expect(receivedAnswers[0].type).toBe("question_answer");
    expect(receivedAnswers[0].request_id).toBe("req-test");
    expect(receivedAnswers[0].answers["q1"]).toBe("Option A");

    unmount();
  });
});

// ---- Tests: multi_choice ----

describe("QuestionCard – multi_choice", () => {
  it("renders checkboxes for a multi_choice question", async () => {
    const { container, unmount } = renderCard([makeMultiChoiceQuestion()]);
    await act(async () => {});

    // Radix Checkbox renders as button[role='checkbox']
    const checkboxes = container.querySelectorAll("button[role='checkbox']");
    // Named options + "Other" checkbox
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);

    unmount();
  });

  it("Submit dispatches question-answer event with checked options joined by comma", async () => {
    const { container, unmount, receivedAnswers } = renderCard([
      makeMultiChoiceQuestion(),
    ]);
    await act(async () => {});

    // Check "Alpha"
    const alphaBox = container.querySelector(
      "button[role='checkbox'][id='q1-Alpha']"
    ) as HTMLButtonElement | null;
    expect(alphaBox).not.toBeNull();

    await act(async () => {
      fireEvent.click(alphaBox!);
    });

    // Check "Beta"
    const betaBox = container.querySelector(
      "button[role='checkbox'][id='q1-Beta']"
    ) as HTMLButtonElement | null;
    expect(betaBox).not.toBeNull();

    await act(async () => {
      fireEvent.click(betaBox!);
    });

    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Submit"
    );
    await act(async () => {
      fireEvent.click(submitBtn!);
    });

    expect(receivedAnswers.length).toBe(1);
    expect(receivedAnswers[0].answers["q1"]).toContain("Alpha");
    expect(receivedAnswers[0].answers["q1"]).toContain("Beta");

    unmount();
  });
});

// ---- Tests: text ----

describe("QuestionCard – text", () => {
  it("renders a text input for a text question", async () => {
    const { container, unmount } = renderCard([makeTextQuestion()]);
    await act(async () => {});

    // shadcn Input renders as <input> with no explicit type attribute
    const input = container.querySelector("input#q1-text") as HTMLInputElement | null;
    expect(input).not.toBeNull();

    unmount();
  });

  it("Submit dispatches question-answer event with typed text value", async () => {
    const { container, unmount, receivedAnswers } = renderCard([makeTextQuestion()]);
    await act(async () => {});

    const input = container.querySelector("input#q1-text") as HTMLInputElement;
    expect(input).not.toBeNull();

    // Uncontrolled input — set value directly on the DOM node
    setInputValue(input, "Hello world");

    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Submit"
    );
    await act(async () => {
      fireEvent.click(submitBtn!);
    });

    expect(receivedAnswers.length).toBe(1);
    expect(receivedAnswers[0].answers["q1"]).toBe("Hello world");

    unmount();
  });
});

// ---- Tests: cancel ----

describe("QuestionCard – cancel button", () => {
  it("Cancel button dispatches question-cancel event", async () => {
    const { container, unmount, receivedCancels } = renderCard([makeTextQuestion()]);
    await act(async () => {});

    const cancelBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Cancel"
    );
    expect(cancelBtn).not.toBeNull();

    await act(async () => {
      fireEvent.click(cancelBtn!);
    });

    expect(receivedCancels.length).toBe(1);
    expect(receivedCancels[0]).toBe("req-test");

    unmount();
  });
});

// ---- Tests: multiple questions ----

describe("QuestionCard – multiple questions", () => {
  it("renders multiple question blocks correctly", async () => {
    const questions: QuestionDef[] = [
      makeTextQuestion({ id: "q1", text: "First question?" }),
      makeTextQuestion({ id: "q2", text: "Second question?" }),
    ];
    const { container, unmount } = renderCard(questions);
    await act(async () => {});

    const paragraphs = Array.from(container.querySelectorAll("p")).map((el) =>
      el.textContent
    );
    expect(paragraphs.some((t) => t?.includes("First question?"))).toBe(true);
    expect(paragraphs.some((t) => t?.includes("Second question?"))).toBe(true);

    unmount();
  });

  it("Submit collects answers for all questions", async () => {
    const questions: QuestionDef[] = [
      makeTextQuestion({ id: "q1", text: "Q1?" }),
      makeTextQuestion({ id: "q2", text: "Q2?" }),
    ];
    const { container, unmount, receivedAnswers } = renderCard(questions);
    await act(async () => {});

    // shadcn Input renders <input> with id "{questionId}-text"
    const input1 = container.querySelector("input#q1-text") as HTMLInputElement;
    const input2 = container.querySelector("input#q2-text") as HTMLInputElement;
    expect(input1).not.toBeNull();
    expect(input2).not.toBeNull();

    // Uncontrolled inputs — set values directly on the DOM nodes
    setInputValue(input1, "Answer 1");
    setInputValue(input2, "Answer 2");

    const submitBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Submit"
    );
    await act(async () => {
      fireEvent.click(submitBtn!);
    });

    expect(receivedAnswers[0].answers["q1"]).toBe("Answer 1");
    expect(receivedAnswers[0].answers["q2"]).toBe("Answer 2");

    unmount();
  });
});
