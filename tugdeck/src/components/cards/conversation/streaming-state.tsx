/**
 * Streaming state utilities for the React Conversation card.
 *
 * The vanilla StreamingState class directly manipulates DOM nodes and cannot
 * be used inside a React render tree.  This module replaces it with:
 *
 *   StreamingIndicator — React component showing a blinking spinner badge
 *   useStreamingState  — hook managing the `isStreaming` boolean state
 *
 * The CSS classes (.streaming-active, .streaming-cursor) are kept for visual
 * parity with the vanilla implementation; they are applied via className props
 * rather than classList.add().
 *
 * References: [D03] React content only, Step 8.3
 */

import { useState, useCallback } from "react";
import { Loader2 } from "lucide-react";

// ---- Spinner texts (from vanilla conversation-card.ts) ----

const SPINNER_TEXTS = [
  "Thinking", "Working", "Planning", "Analyzing", "Processing",
  "Executing", "Resolving", "Building", "Validating",
  "Calculating", "Synthesizing", "Refining", "Compiling", "Organizing",
  "Drafting", "Evaluating", "Coordinating", "Inspecting", "Assembling",
];

function randomSpinnerText(): string {
  return SPINNER_TEXTS[Math.floor(Math.random() * SPINNER_TEXTS.length)];
}

// ---- StreamingIndicator component ----

export interface StreamingIndicatorProps {
  visible: boolean;
  text?: string;
}

export function StreamingIndicator({ visible, text }: StreamingIndicatorProps) {
  if (!visible) return null;

  return (
    <div
      className="turn-spinner-badge flex items-center gap-1.5 text-xs text-muted-foreground"
      data-testid="streaming-indicator"
      aria-live="polite"
      aria-label="Processing"
    >
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      <span>{text ?? randomSpinnerText()}</span>
    </div>
  );
}

// ---- useStreamingState hook ----

export interface StreamingStateHook {
  isStreaming: boolean;
  spinnerText: string;
  startStreaming: () => void;
  stopStreaming: () => void;
}

export function useStreamingState(): StreamingStateHook {
  const [isStreaming, setIsStreaming] = useState(false);
  const [spinnerText, setSpinnerText] = useState(randomSpinnerText);

  const startStreaming = useCallback(() => {
    setSpinnerText(randomSpinnerText());
    setIsStreaming(true);
  }, []);

  const stopStreaming = useCallback(() => {
    setIsStreaming(false);
  }, []);

  return { isStreaming, spinnerText, startStreaming, stopStreaming };
}
