/**
 * QuestionCard — React component for clarifying question prompts.
 *
 * Renders a form with shadcn controls based on question type:
 *   single_choice  → RadioGroup + RadioGroupItem (plus "Other" free-text)
 *   multi_choice   → Checkbox list (plus "Other" free-text)
 *   text           → Input
 *
 * On submit, dispatches a CustomEvent("question-answer") on the root element
 * with a QuestionAnswerInput payload. The parent React ConversationCard listens
 * for this event, sends the answer over CODE_INPUT, and removes the component.
 *
 * On cancel, dispatches CustomEvent("question-cancel") with the request_id.
 *
 * Vanilla `src/cards/conversation/question-card.ts` is retained until Step 10.
 *
 * References: [D03] React content only, [D04] CustomEvents, [D06] Replace tests,
 *             Table T01, Table T03
 */

import { useState, useRef, useCallback } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { QuestionDef } from "../../../cards/conversation/types";
import type { QuestionAnswerInput } from "../../../cards/conversation/types";

// ---- Event types ----

export interface QuestionAnswerEvent {
  answer: QuestionAnswerInput;
}

export interface QuestionCancelEvent {
  requestId: string;
}

// ---- Props ----

export interface QuestionCardProps {
  requestId: string;
  questions: QuestionDef[];
}

// ---- Single-choice question ----

interface SingleChoiceProps {
  question: QuestionDef;
  value: string;
  onChange: (val: string) => void;
}

function SingleChoiceQuestion({ question, value, onChange }: SingleChoiceProps) {
  const [otherText, setOtherText] = useState("");

  function handleOtherInput(text: string) {
    setOtherText(text);
    if (text.trim()) {
      onChange(text.trim());
    }
  }

  return (
    <RadioGroup
      value={value}
      onValueChange={onChange}
      aria-label={question.text}
    >
      {(question.options ?? []).map((option) => (
        <div key={option.label} className="flex items-start gap-2">
          <RadioGroupItem
            value={option.label}
            id={`${question.id}-${option.label}`}
            className="mt-0.5"
          />
          <label
            htmlFor={`${question.id}-${option.label}`}
            className="cursor-pointer"
          >
            <span className="text-sm font-medium">{option.label}</span>
            {option.description && (
              <p className="text-xs text-muted-foreground">{option.description}</p>
            )}
          </label>
        </div>
      ))}
      {/* Other option */}
      <div className="flex items-start gap-2">
        <RadioGroupItem
          value={otherText.trim() || "__other__"}
          id={`${question.id}-other`}
          className="mt-0.5"
        />
        <div className="flex flex-1 flex-col gap-1">
          <label
            htmlFor={`${question.id}-other`}
            className="cursor-pointer text-sm font-medium"
          >
            Other
          </label>
          <Input
            placeholder="Please specify..."
            value={otherText}
            onChange={(e) => handleOtherInput(e.target.value)}
            className="h-8 text-sm"
            aria-label="Other answer"
          />
        </div>
      </div>
    </RadioGroup>
  );
}

// ---- Multi-choice question ----

interface MultiChoiceProps {
  question: QuestionDef;
  values: string[];
  onChange: (vals: string[]) => void;
}

function MultiChoiceQuestion({ question, values, onChange }: MultiChoiceProps) {
  const [otherText, setOtherText] = useState("");

  function toggleOption(label: string, checked: boolean) {
    if (checked) {
      onChange([...values, label]);
    } else {
      onChange(values.filter((v) => v !== label));
    }
  }

  function handleOtherInput(text: string) {
    setOtherText(text);
    const trimmed = text.trim();
    const otherValue = trimmed ? `Other: ${trimmed}` : null;
    // Replace any existing "Other: ..." entry
    const withoutOther = values.filter((v) => !v.startsWith("Other: "));
    onChange(otherValue ? [...withoutOther, otherValue] : withoutOther);
  }

  return (
    <div className="flex flex-col gap-2" role="group" aria-label={question.text}>
      {(question.options ?? []).map((option) => (
        <div key={option.label} className="flex items-start gap-2">
          <Checkbox
            id={`${question.id}-${option.label}`}
            checked={values.includes(option.label)}
            onCheckedChange={(checked) =>
              toggleOption(option.label, checked === true)
            }
            className="mt-0.5"
          />
          <label
            htmlFor={`${question.id}-${option.label}`}
            className="cursor-pointer"
          >
            <span className="text-sm font-medium">{option.label}</span>
            {option.description && (
              <p className="text-xs text-muted-foreground">{option.description}</p>
            )}
          </label>
        </div>
      ))}
      {/* Other option */}
      <div className="flex items-start gap-2">
        <Checkbox
          id={`${question.id}-other`}
          checked={values.some((v) => v.startsWith("Other: "))}
          onCheckedChange={(checked) => {
            if (!checked) {
              onChange(values.filter((v) => !v.startsWith("Other: ")));
              setOtherText("");
            }
          }}
          className="mt-0.5"
        />
        <div className="flex flex-1 flex-col gap-1">
          <label
            htmlFor={`${question.id}-other`}
            className="cursor-pointer text-sm font-medium"
          >
            Other
          </label>
          <Input
            placeholder="Please specify..."
            value={otherText}
            onChange={(e) => handleOtherInput(e.target.value)}
            className="h-8 text-sm"
            aria-label="Other answer"
          />
        </div>
      </div>
    </div>
  );
}

// ---- Text question ----
// Uses an uncontrolled input so the value is always readable via the DOM ref
// regardless of the test environment's event simulation limitations.

interface TextQuestionProps {
  question: QuestionDef;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

function TextQuestion({ question, inputRef }: TextQuestionProps) {
  return (
    <Input
      id={`${question.id}-text`}
      ref={inputRef as React.RefObject<HTMLInputElement>}
      placeholder="Type your answer..."
      defaultValue=""
      aria-label={question.text}
    />
  );
}

// ---- Main component ----

export function QuestionCard({ requestId, questions }: QuestionCardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [submitted, setSubmitted] = useState(false);

  // Controlled state for choice-based questions
  const [singleSelections, setSingleSelections] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      questions.filter((q) => q.type === "single_choice").map((q) => [q.id, ""])
    )
  );
  const [multiSelections, setMultiSelections] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      questions.filter((q) => q.type === "multi_choice").map((q) => [q.id, []])
    )
  );

  // Uncontrolled refs for text inputs — avoids event simulation issues in happy-dom
  const textRefs = useRef<Record<string, React.RefObject<HTMLInputElement | null>>>({});
  const getTextRef = useCallback(
    (id: string): React.RefObject<HTMLInputElement | null> => {
      if (!textRefs.current[id]) {
        textRefs.current[id] = { current: null };
      }
      return textRefs.current[id];
    },
    []
  );

  function handleSubmit() {
    if (submitted) return;

    // Build answers Record<string, string>
    const answers: Record<string, string> = {};
    for (const q of questions) {
      if (q.type === "single_choice") {
        answers[q.id] = singleSelections[q.id] ?? "";
      } else if (q.type === "multi_choice") {
        answers[q.id] = (multiSelections[q.id] ?? []).join(", ");
      } else {
        // Read directly from the uncontrolled input's DOM value
        answers[q.id] = textRefs.current[q.id]?.current?.value ?? "";
      }
    }

    setSubmitted(true);

    const payload: QuestionAnswerInput = {
      type: "question_answer",
      request_id: requestId,
      answers,
    };

    rootRef.current?.dispatchEvent(
      new CustomEvent<QuestionAnswerInput>("question-answer", {
        detail: payload,
        bubbles: true,
      })
    );
  }

  function handleCancel() {
    rootRef.current?.dispatchEvent(
      new CustomEvent<QuestionCancelEvent>("question-cancel", {
        detail: { requestId },
        bubbles: true,
      })
    );
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-4 rounded-lg border p-4">
      {questions.map((question) => (
        <div key={question.id} className="flex flex-col gap-2">
          <p className="text-sm font-medium">{question.text}</p>

          {question.type === "single_choice" && (
            <SingleChoiceQuestion
              question={question}
              value={singleSelections[question.id] ?? ""}
              onChange={(val) =>
                setSingleSelections((prev) => ({ ...prev, [question.id]: val }))
              }
            />
          )}

          {question.type === "multi_choice" && (
            <MultiChoiceQuestion
              question={question}
              values={multiSelections[question.id] ?? []}
              onChange={(vals) =>
                setMultiSelections((prev) => ({ ...prev, [question.id]: vals }))
              }
            />
          )}

          {question.type === "text" && (
            <TextQuestion
              question={question}
              inputRef={getTextRef(question.id)}
            />
          )}
        </div>
      ))}

      <div className="flex gap-2">
        <Button
          onClick={handleSubmit}
          disabled={submitted}
          size="sm"
        >
          Submit
        </Button>
        <Button
          variant="outline"
          onClick={handleCancel}
          disabled={submitted}
          size="sm"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
