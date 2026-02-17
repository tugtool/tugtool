// IPC message type definitions per Spec S01 and S02

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

// Inbound message types (tugcast to tugtalk stdin) - Spec S01
export interface ProtocolInit {
  type: "protocol_init";
  version: number;
}

export interface UserMessage {
  type: "user_message";
  text: string;
  attachments: Attachment[];
}

export interface ToolApproval {
  type: "tool_approval";
  request_id: string;
  decision: "allow" | "deny";
}

export interface QuestionAnswer {
  type: "question_answer";
  request_id: string;
  answers: Record<string, string>;
}

export interface Interrupt {
  type: "interrupt";
}

export interface PermissionModeMessage {
  type: "permission_mode";
  mode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "delegate";
}

export type InboundMessage =
  | ProtocolInit
  | UserMessage
  | ToolApproval
  | QuestionAnswer
  | Interrupt
  | PermissionModeMessage;

// Outbound message types (tugtalk stdout to tugcast) - Spec S02
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
  status: string;
}

export interface ToolUse {
  type: "tool_use";
  msg_id: string;
  seq: number;
  tool_name: string;
  tool_use_id: string;
  input: object;
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
  input: object;
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

export type OutboundMessage =
  | ProtocolAck
  | SessionInit
  | AssistantText
  | ToolUse
  | ToolResult
  | ToolApprovalRequest
  | Question
  | TurnComplete
  | TurnCancelled
  | ErrorEvent;

// Type guards
export function isInboundMessage(msg: unknown): msg is InboundMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const typed = msg as { type?: string };
  return (
    typed.type === "protocol_init" ||
    typed.type === "user_message" ||
    typed.type === "tool_approval" ||
    typed.type === "question_answer" ||
    typed.type === "interrupt" ||
    typed.type === "permission_mode"
  );
}

export function isProtocolInit(msg: InboundMessage): msg is ProtocolInit {
  return msg.type === "protocol_init";
}

export function isUserMessage(msg: InboundMessage): msg is UserMessage {
  return msg.type === "user_message";
}

export function isToolApproval(msg: InboundMessage): msg is ToolApproval {
  return msg.type === "tool_approval";
}

export function isQuestionAnswer(msg: InboundMessage): msg is QuestionAnswer {
  return msg.type === "question_answer";
}

export function isInterrupt(msg: InboundMessage): msg is Interrupt {
  return msg.type === "interrupt";
}

export function isPermissionMode(msg: InboundMessage): msg is PermissionModeMessage {
  return msg.type === "permission_mode";
}
