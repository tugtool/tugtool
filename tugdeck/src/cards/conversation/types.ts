/**
 * Conversation message types
 *
 * TypeScript mirrors of tugtalk's IPC message types (Spec S01/S02)
 * and message identity model (Spec S04).
 */

// Helper types

export interface Attachment {
  filename: string;
  content: string; // text or base64
  media_type: string; // MIME type
}

export interface QuestionDef {
  id: string;
  text: string;
  type: "single_choice" | "multi_choice" | "text";
  options?: Array<{ label: string; description?: string }>;
}

// Outbound message types (received by tugdeck from tugtalk via 0x40)

export interface ProtocolAck {
  type: "protocol_ack";
  version: number;
  session_id: string;
}

export interface SessionInit {
  type: "session_init";
  session_id: string;
}

export interface AssistantText {
  type: "assistant_text";
  msg_id: string;
  seq: number;
  rev: number;
  text: string;
  is_partial: boolean;
  status: "partial" | "complete" | "cancelled";
}

export interface ToolUse {
  type: "tool_use";
  msg_id: string;
  seq: number;
  tool_name: string;
  tool_use_id: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  type: "tool_result";
  tool_use_id: string;
  output: string;
  is_error: boolean;
}

export interface ToolApprovalRequest {
  type: "tool_approval_request";
  request_id: string;
  tool_name: string;
  input: Record<string, unknown>;
}

export interface Question {
  type: "question";
  request_id: string;
  questions: QuestionDef[];
}

export interface TurnComplete {
  type: "turn_complete";
  msg_id: string;
  seq: number;
  result: string;
}

export interface TurnCancelled {
  type: "turn_cancelled";
  msg_id: string;
  seq: number;
  partial_result: string;
}

export interface ErrorEvent {
  type: "error";
  message: string;
  recoverable: boolean;
}

export interface ProjectInfo {
  type: "project_info";
  project_dir: string;
}

export type ConversationEvent =
  | ProtocolAck
  | SessionInit
  | AssistantText
  | ToolUse
  | ToolResult
  | ToolApprovalRequest
  | Question
  | TurnComplete
  | TurnCancelled
  | ErrorEvent
  | ProjectInfo;

// Inbound message types (sent by tugdeck to tugtalk via 0x41)

export interface UserMessageInput {
  type: "user_message";
  text: string;
  attachments: Attachment[];
}

export interface ToolApprovalInput {
  type: "tool_approval";
  request_id: string;
  decision: "allow" | "deny";
}

export interface QuestionAnswerInput {
  type: "question_answer";
  request_id: string;
  answers: Record<string, string>;
}

export interface InterruptInput {
  type: "interrupt";
}

export interface PermissionModeInput {
  type: "permission_mode";
  mode: "default" | "acceptEdits" | "bypassPermissions" | "plan";
}

export type ConversationInput =
  | UserMessageInput
  | ToolApprovalInput
  | QuestionAnswerInput
  | InterruptInput
  | PermissionModeInput;

// Message identity model (Spec S04)

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface TextBlock {
  type: "text";
  block_index: number;
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  block_index: number;
  tool_name: string;
  tool_use_id: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  block_index: number;
  tool_use_id: string;
  output: string;
  is_error: boolean;
}

export interface ConversationMessage {
  msg_id: string;
  seq: number;
  rev: number;
  blocks: ContentBlock[];
  status: "partial" | "complete" | "cancelled";
}

// Type guards

export function isConversationEvent(obj: unknown): obj is ConversationEvent {
  if (typeof obj !== "object" || obj === null) return false;
  const typed = obj as { type?: string };
  return (
    typed.type === "protocol_ack" ||
    typed.type === "session_init" ||
    typed.type === "assistant_text" ||
    typed.type === "tool_use" ||
    typed.type === "tool_result" ||
    typed.type === "tool_approval_request" ||
    typed.type === "question" ||
    typed.type === "turn_complete" ||
    typed.type === "turn_cancelled" ||
    typed.type === "error" ||
    typed.type === "project_info"
  );
}

// Parser

export function parseConversationEvent(payload: Uint8Array): ConversationEvent | null {
  try {
    const text = new TextDecoder().decode(payload);
    const parsed = JSON.parse(text);
    return isConversationEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
