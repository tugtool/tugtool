/**
 * ApprovalPrompt — React component for tool approval requests.
 *
 * Displays the tool name, a description of the pending action (key-value
 * pairs from the input record), and Allow / Deny buttons using shadcn Button
 * with the correct variants: default (primary) for Allow, destructive for Deny.
 *
 * On Allow: dispatches CustomEvent("tool-approval") with approved: true.
 * On Deny:  dispatches CustomEvent("tool-approval") with approved: false,
 *           then shows a "Denied by user" inline state.
 *
 * The parent React ConversationCard listens for "tool-approval", sends the
 * ToolApprovalInput payload over CODE_INPUT, and removes the component.
 *
 * Vanilla `src/cards/conversation/approval-prompt.ts` is retained until Step 10.
 *
 * References: [D03] React content only, [D06] Replace tests, Table T03
 */

import { useState, useRef } from "react";
import { X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ToolApprovalRequest, ToolApprovalInput } from "../../../cards/conversation/types";

// ---- Event types ----

export interface ToolApprovalEvent {
  decision: "allow" | "deny";
  payload: ToolApprovalInput;
}

// ---- Props ----

export interface ApprovalPromptProps {
  request: ToolApprovalRequest;
  /** When true the prompt is stale (session restarted) and buttons are disabled. */
  stale?: boolean;
}

// ---- Component ----

export function ApprovalPrompt({ request, stale = false }: ApprovalPromptProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [decided, setDecided] = useState<"allow" | "deny" | null>(null);

  const isDisabled = stale || decided !== null;

  // Format input as key: value lines for the description preview
  const inputLines = Object.entries(request.input).map(
    ([key, value]) => `${key}: ${String(value)}`
  );
  const inputPreview = inputLines.length > 0 ? inputLines.join("\n") : "(no input)";

  function dispatch(decision: "allow" | "deny") {
    if (isDisabled) return;
    setDecided(decision);

    const payload: ToolApprovalInput = {
      type: "tool_approval",
      request_id: request.request_id,
      decision,
    };

    rootRef.current?.dispatchEvent(
      new CustomEvent<ToolApprovalEvent>("tool-approval", {
        detail: { decision, payload },
        bubbles: true,
      })
    );
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-3 rounded-lg border p-4">
      {/* Header: tool name */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">
          {request.tool_name} requires approval
        </span>
      </div>

      {/* Input preview */}
      <pre className="rounded bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all">
        {inputPreview}
      </pre>

      {/* Actions / post-decision state */}
      {decided === "deny" ? (
        <div className="flex items-center gap-1.5 text-sm text-destructive">
          <X size={14} aria-hidden="true" />
          <span>Denied by user</span>
        </div>
      ) : stale ? (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>Session restarted — this request is no longer active</span>
        </div>
      ) : decided === "allow" ? null : (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => dispatch("allow")}
            disabled={isDisabled}
            aria-label="Allow tool use"
          >
            Allow
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => dispatch("deny")}
            disabled={isDisabled}
            aria-label="Deny tool use"
          >
            Deny
          </Button>
        </div>
      )}
    </div>
  );
}
