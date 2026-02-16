/**
 * Question card - renders clarifying question with radio/checkbox selection
 */

import type { QuestionDef } from "./types";

export class QuestionCard {
  private container: HTMLElement;
  private submitted = false;
  private selections: Map<string, string | string[]> = new Map();
  private onSubmitCallback?: (answers: Record<string, string>) => void;

  constructor(
    private requestId: string,
    private questions: QuestionDef[]
  ) {
    this.container = this.createContainer();
  }

  private createContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = "question-card";
    container.dataset.requestId = this.requestId;

    // Render each question
    for (const question of this.questions) {
      const questionEl = this.renderQuestion(question);
      container.appendChild(questionEl);
    }

    // Submit button
    const submitBtn = document.createElement("button");
    submitBtn.className = "question-card-submit";
    submitBtn.textContent = "Submit";
    submitBtn.addEventListener("click", () => this.handleSubmit());

    container.appendChild(submitBtn);

    return container;
  }

  private renderQuestion(question: QuestionDef): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "question-card-question";

    // Question text
    const text = document.createElement("div");
    text.className = "question-card-text";
    text.textContent = question.text;
    wrapper.appendChild(text);

    // Render based on type
    if (question.type === "single_choice") {
      wrapper.appendChild(this.renderSingleChoice(question));
    } else if (question.type === "multi_choice") {
      wrapper.appendChild(this.renderMultiChoice(question));
    } else if (question.type === "text") {
      wrapper.appendChild(this.renderTextInput(question));
    }

    return wrapper;
  }

  private renderSingleChoice(question: QuestionDef): HTMLElement {
    const options = document.createElement("div");
    options.className = "question-card-options";

    // Render each option as radio button
    for (const option of question.options || []) {
      const optionEl = document.createElement("label");
      optionEl.className = "question-card-option";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `question-${question.id}`;
      radio.value = option.label;
      radio.addEventListener("change", () => {
        this.selections.set(question.id, option.label);
      });

      const labelText = document.createElement("div");
      labelText.className = "question-card-option-content";

      const labelSpan = document.createElement("div");
      labelSpan.className = "question-card-option-label";
      labelSpan.textContent = option.label;
      labelText.appendChild(labelSpan);

      if (option.description) {
        const descSpan = document.createElement("div");
        descSpan.className = "question-card-option-description";
        descSpan.textContent = option.description;
        labelText.appendChild(descSpan);
      }

      optionEl.appendChild(radio);
      optionEl.appendChild(labelText);
      options.appendChild(optionEl);
    }

    // Add "Other" option with text input
    const otherWrapper = document.createElement("div");
    otherWrapper.className = "question-card-other";

    const otherLabel = document.createElement("label");
    otherLabel.className = "question-card-option";

    const otherRadio = document.createElement("input");
    otherRadio.type = "radio";
    otherRadio.name = `question-${question.id}`;
    otherRadio.value = "other";

    const otherLabelText = document.createElement("span");
    otherLabelText.className = "question-card-option-label";
    otherLabelText.textContent = "Other";

    otherLabel.appendChild(otherRadio);
    otherLabel.appendChild(otherLabelText);

    const otherInput = document.createElement("input");
    otherInput.type = "text";
    otherInput.className = "question-card-other-input";
    otherInput.placeholder = "Please specify...";
    otherInput.addEventListener("input", () => {
      if (otherInput.value.trim()) {
        otherRadio.checked = true;
        this.selections.set(question.id, otherInput.value.trim());
      }
    });

    otherRadio.addEventListener("change", () => {
      if (otherRadio.checked && otherInput.value.trim()) {
        this.selections.set(question.id, otherInput.value.trim());
      }
    });

    otherWrapper.appendChild(otherLabel);
    otherWrapper.appendChild(otherInput);
    options.appendChild(otherWrapper);

    return options;
  }

  private renderMultiChoice(question: QuestionDef): HTMLElement {
    const options = document.createElement("div");
    options.className = "question-card-options";

    // Initialize selection as array
    this.selections.set(question.id, []);

    // Render each option as checkbox
    for (const option of question.options || []) {
      const optionEl = document.createElement("label");
      optionEl.className = "question-card-option";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = option.label;
      checkbox.addEventListener("change", () => {
        const current = (this.selections.get(question.id) as string[]) || [];
        if (checkbox.checked) {
          current.push(option.label);
        } else {
          const index = current.indexOf(option.label);
          if (index > -1) {
            current.splice(index, 1);
          }
        }
        this.selections.set(question.id, current);
      });

      const labelText = document.createElement("div");
      labelText.className = "question-card-option-content";

      const labelSpan = document.createElement("div");
      labelSpan.className = "question-card-option-label";
      labelSpan.textContent = option.label;
      labelText.appendChild(labelSpan);

      if (option.description) {
        const descSpan = document.createElement("div");
        descSpan.className = "question-card-option-description";
        descSpan.textContent = option.description;
        labelText.appendChild(descSpan);
      }

      optionEl.appendChild(checkbox);
      optionEl.appendChild(labelText);
      options.appendChild(optionEl);
    }

    // Add "Other" option with text input
    const otherWrapper = document.createElement("div");
    otherWrapper.className = "question-card-other";

    const otherLabel = document.createElement("label");
    otherLabel.className = "question-card-option";

    const otherCheckbox = document.createElement("input");
    otherCheckbox.type = "checkbox";
    otherCheckbox.value = "other";

    const otherLabelText = document.createElement("span");
    otherLabelText.className = "question-card-option-label";
    otherLabelText.textContent = "Other";

    otherLabel.appendChild(otherCheckbox);
    otherLabel.appendChild(otherLabelText);

    const otherInput = document.createElement("input");
    otherInput.type = "text";
    otherInput.className = "question-card-other-input";
    otherInput.placeholder = "Please specify...";
    otherInput.addEventListener("input", () => {
      const current = (this.selections.get(question.id) as string[]) || [];
      if (otherInput.value.trim()) {
        otherCheckbox.checked = true;
        // Add "Other: <value>" to selections if not already there
        const otherValue = `Other: ${otherInput.value.trim()}`;
        const otherIndex = current.findIndex(v => v.startsWith("Other: "));
        if (otherIndex > -1) {
          current[otherIndex] = otherValue;
        } else {
          current.push(otherValue);
        }
      } else {
        // Remove "Other: " entries
        const filtered = current.filter(v => !v.startsWith("Other: "));
        this.selections.set(question.id, filtered);
      }
    });

    otherWrapper.appendChild(otherLabel);
    otherWrapper.appendChild(otherInput);
    options.appendChild(otherWrapper);

    return options;
  }

  private renderTextInput(question: QuestionDef): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "question-card-text-input";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Type your answer...";
    input.addEventListener("input", () => {
      this.selections.set(question.id, input.value.trim());
    });

    wrapper.appendChild(input);
    return wrapper;
  }

  private handleSubmit(): void {
    if (this.submitted) return;

    // Convert selections to Record<string, string>
    const answers: Record<string, string> = {};
    for (const [questionId, selection] of this.selections.entries()) {
      if (Array.isArray(selection)) {
        // Multi-choice: join with commas
        answers[questionId] = selection.join(", ");
      } else {
        // Single choice or text
        answers[questionId] = selection || "";
      }
    }

    this.submitted = true;
    this.showSubmitted(answers);

    if (this.onSubmitCallback) {
      this.onSubmitCallback(answers);
    }
  }

  /**
   * Set callback for submit action
   */
  setCallbacks(onSubmit: (answers: Record<string, string>) => void): void {
    this.onSubmitCallback = onSubmit;
  }

  /**
   * Show submitted state with highlighted answers
   */
  showSubmitted(answers: Record<string, string>): void {
    this.container.classList.add("submitted");

    // Disable all inputs
    const inputs = this.container.querySelectorAll("input, button");
    inputs.forEach(input => {
      (input as HTMLInputElement).disabled = true;
    });

    // Highlight selected answers
    for (const [questionId, answer] of Object.entries(answers)) {
      const question = this.questions.find(q => q.id === questionId);
      if (!question) continue;

      // Find the question element and add highlighted answer
      const questionEls = this.container.querySelectorAll(".question-card-question");
      const questionIndex = this.questions.indexOf(question);
      if (questionIndex >= 0 && questionIndex < questionEls.length) {
        const questionEl = questionEls[questionIndex];
        
        const answerEl = document.createElement("div");
        answerEl.className = "question-card-answer-highlight";
        answerEl.textContent = `Answer: ${answer}`;
        questionEl.appendChild(answerEl);
      }
    }
  }

  /**
   * Get the DOM element for this question card
   */
  render(): HTMLElement {
    return this.container;
  }
}
