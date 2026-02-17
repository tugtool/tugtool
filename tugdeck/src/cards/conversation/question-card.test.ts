/**
 * Tests for question-card - clarifying questions
 * Using happy-dom for DOM environment
 */

import { describe, test, expect, beforeAll, mock } from "bun:test";
import { Window } from "happy-dom";

// Setup DOM environment
const window = new Window();
global.window = window as any;
global.document = window.document as any;
global.DOMParser = window.DOMParser as any;

// Mock navigator.clipboard
global.navigator = {
  clipboard: {
    writeText: mock(() => Promise.resolve()),
  },
} as any;

// Import after DOM setup
import { QuestionCard } from "./question-card";
import type { QuestionDef } from "./types";

describe("question-card", () => {
  describe("container structure", () => {
    test("renders container with correct class", () => {
      const questions: QuestionDef[] = [
        {
          id: "q1",
          text: "What is your favorite color?",
          type: "single_choice",
          options: [{ label: "Red" }, { label: "Blue" }],
        },
      ];
      const card = new QuestionCard("req-123", questions);
      const element = card.render();
      expect(element.className).toBe("question-card");
    });

    test("sets data-request-id attribute", () => {
      const questions: QuestionDef[] = [
        { id: "q1", text: "Test?", type: "text" },
      ];
      const card = new QuestionCard("req-456", questions);
      const element = card.render();
      expect(element.dataset.requestId).toBe("req-456");
    });

    test("question text renders correctly", () => {
      const questions: QuestionDef[] = [
        {
          id: "q1",
          text: "What is your favorite programming language?",
          type: "single_choice",
          options: [{ label: "TypeScript" }],
        },
      ];
      const card = new QuestionCard("req-789", questions);
      const element = card.render();
      const text = element.querySelector(".question-card-text");
      expect(text?.textContent).toBe("What is your favorite programming language?");
    });
  });

  describe("single_choice questions", () => {
    test("renders radio buttons for single_choice", () => {
      const questions: QuestionDef[] = [
        {
          id: "q1",
          text: "Choose one:",
          type: "single_choice",
          options: [
            { label: "Option A" },
            { label: "Option B" },
          ],
        },
      ];
      const card = new QuestionCard("req-radio", questions);
      const element = card.render();
      const radios = element.querySelectorAll('input[type="radio"]');
      expect(radios.length).toBeGreaterThan(0);
    });

    test("radio buttons allow only single selection", () => {
      const questions: QuestionDef[] = [
        {
          id: "q1",
          text: "Choose one:",
          type: "single_choice",
          options: [
            { label: "Option A" },
            { label: "Option B" },
          ],
        },
      ];
      const card = new QuestionCard("req-single", questions);
      const element = card.render();
      const radios = element.querySelectorAll('input[type="radio"]') as NodeListOf<HTMLInputElement>;
      
      // All radios should have the same name
      const names = Array.from(radios).map(r => r.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(1);
    });

    test("option labels display correctly", () => {
      const questions: QuestionDef[] = [
        {
          id: "q1",
          text: "Pick:",
          type: "single_choice",
          options: [
            { label: "First Option", description: "This is the first" },
          ],
        },
      ];
      const card = new QuestionCard("req-labels", questions);
      const element = card.render();
      const label = element.querySelector(".question-card-option-label");
      expect(label?.textContent).toBe("First Option");
    });

    test("option descriptions display correctly", () => {
      const questions: QuestionDef[] = [
        {
          id: "q1",
          text: "Pick:",
          type: "single_choice",
          options: [
            { label: "Option", description: "Detailed description here" },
          ],
        },
      ];
      const card = new QuestionCard("req-desc", questions);
      const element = card.render();
      const desc = element.querySelector(".question-card-option-description");
      expect(desc?.textContent).toBe("Detailed description here");
    });
  });

  describe("multi_choice questions", () => {
    test("renders checkboxes for multi_choice", () => {
      const questions: QuestionDef[] = [
        {
          id: "q1",
          text: "Choose multiple:",
          type: "multi_choice",
          options: [
            { label: "Option A" },
            { label: "Option B" },
          ],
        },
      ];
      const card = new QuestionCard("req-checkbox", questions);
      const element = card.render();
      const checkboxes = element.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).toBeGreaterThan(0);
    });

    test("checkboxes allow multiple selection", () => {
      const questions: QuestionDef[] = [
        {
          id: "q1",
          text: "Choose multiple:",
          type: "multi_choice",
          options: [
            { label: "A" },
            { label: "B" },
            { label: "C" },
          ],
        },
      ];
      const card = new QuestionCard("req-multi", questions);
      const element = card.render();
      const checkboxes = element.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
      
      // Check multiple boxes
      checkboxes[0].checked = true;
      checkboxes[1].checked = true;

      // Both should remain checked
      expect(checkboxes[0].checked).toBe(true);
      expect(checkboxes[1].checked).toBe(true);
    });
  });

  describe("text questions", () => {
    test("renders text input for text type", () => {
      const questions: QuestionDef[] = [
        {
          id: "q1",
          text: "Enter your answer:",
          type: "text",
        },
      ];
      const card = new QuestionCard("req-text", questions);
      const element = card.render();
      const input = element.querySelector('.question-card-text-input input[type="text"]');
      expect(input).not.toBeNull();
    });
  });

  describe("submit button", () => {
    test("Submit button renders correctly", () => {
      const questions: QuestionDef[] = [
        { id: "q1", text: "Test?", type: "text" },
      ];
      const card = new QuestionCard("req-submit", questions);
      const element = card.render();
      const submitBtn = element.querySelector(".question-card-submit");
      expect(submitBtn).not.toBeNull();
      expect(submitBtn?.textContent).toBe("Submit");
    });

    test("Submit fires callback with answers", () => {
      const questions: QuestionDef[] = [
        {
          id: "q1",
          text: "Pick one:",
          type: "single_choice",
          options: [{ label: "Answer A" }],
        },
      ];
      const card = new QuestionCard("req-callback", questions);
      let capturedAnswers: Record<string, string> | null = null;
      card.setCallbacks((answers) => {
        capturedAnswers = answers;
      });

      const element = card.render();
      
      // Select an option
      const radio = element.querySelector('input[type="radio"]') as HTMLInputElement;
      radio.checked = true;
      radio.dispatchEvent(new Event("change"));

      // Click submit
      const submitBtn = element.querySelector(".question-card-submit") as HTMLButtonElement;
      submitBtn.click();

      expect(capturedAnswers).not.toBeNull();
      expect(capturedAnswers?.q1).toBe("Answer A");
    });
  });

  describe("submitted state", () => {
    test("after submission card has submitted class", () => {
      const questions: QuestionDef[] = [
        { id: "q1", text: "Test?", type: "text" },
      ];
      const card = new QuestionCard("req-submitted", questions);
      card.setCallbacks(() => {});

      const element = card.render();
      const submitBtn = element.querySelector(".question-card-submit") as HTMLButtonElement;
      submitBtn.click();

      expect(element.classList.contains("submitted")).toBe(true);
    });

    test("after submission inputs are disabled", () => {
      const questions: QuestionDef[] = [
        {
          id: "q1",
          text: "Pick:",
          type: "single_choice",
          options: [{ label: "A" }],
        },
      ];
      const card = new QuestionCard("req-disabled", questions);
      card.setCallbacks(() => {});

      const element = card.render();
      const submitBtn = element.querySelector(".question-card-submit") as HTMLButtonElement;
      submitBtn.click();

      // Check that inputs are disabled
      const inputs = element.querySelectorAll("input");
      inputs.forEach(input => {
        expect(input.disabled).toBe(true);
      });

      // Check that submit button is disabled
      expect(submitBtn.disabled).toBe(true);
    });

    test("selected answer highlighted after submission", () => {
      const questions: QuestionDef[] = [
        {
          id: "q1",
          text: "Choose:",
          type: "single_choice",
          options: [{ label: "My Answer" }],
        },
      ];
      const card = new QuestionCard("req-highlight", questions);
      card.setCallbacks(() => {});

      const element = card.render();
      
      // Select option
      const radio = element.querySelector('input[type="radio"]') as HTMLInputElement;
      radio.checked = true;
      radio.dispatchEvent(new Event("change"));

      // Submit
      const submitBtn = element.querySelector(".question-card-submit") as HTMLButtonElement;
      submitBtn.click();

      // Check for highlighted answer
      const highlight = element.querySelector(".question-card-answer-highlight");
      expect(highlight).not.toBeNull();
      expect(highlight?.textContent).toContain("My Answer");
    });
  });

  describe("Other text input", () => {
    test("Other text input renders for single_choice", () => {
      const questions: QuestionDef[] = [
        {
          id: "q1",
          text: "Choose:",
          type: "single_choice",
          options: [{ label: "A" }],
        },
      ];
      const card = new QuestionCard("req-other", questions);
      const element = card.render();
      const otherInput = element.querySelector(".question-card-other-input");
      expect(otherInput).not.toBeNull();
    });

    test("Other text input renders for multi_choice", () => {
      const questions: QuestionDef[] = [
        {
          id: "q1",
          text: "Choose multiple:",
          type: "multi_choice",
          options: [{ label: "A" }],
        },
      ];
      const card = new QuestionCard("req-other-multi", questions);
      const element = card.render();
      const otherInput = element.querySelector(".question-card-other-input");
      expect(otherInput).not.toBeNull();
    });
  });

  describe("edge cases", () => {
    test("handles question with no options", () => {
      const questions: QuestionDef[] = [
        {
          id: "q1",
          text: "Pick:",
          type: "single_choice",
          options: [],
        },
      ];
      const card = new QuestionCard("req-empty", questions);
      const element = card.render();
      expect(element.className).toBe("question-card");
    });

    test("handles multiple questions", () => {
      const questions: QuestionDef[] = [
        { id: "q1", text: "First question?", type: "text" },
        { id: "q2", text: "Second question?", type: "text" },
      ];
      const card = new QuestionCard("req-multiple", questions);
      const element = card.render();
      const questionEls = element.querySelectorAll(".question-card-question");
      expect(questionEls.length).toBe(2);
    });
  });
});
