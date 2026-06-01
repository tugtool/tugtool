/**
 * tugproto/inbound — the client → tugcode CODE_INPUT message contract,
 * authored ONCE and imported by both tugdeck (the sender) and tugcode (the
 * receiver) ([#step-13c1]).
 *
 * Before this module the contract was authored twice — `tugdeck/protocol.ts`
 * and `tugcode/types.ts` — and tugcode mirrored the verb set in three more
 * places (the `isInboundMessage` allowlist, a per-type guard, and a hand-
 * written branch in `main.ts`'s dispatch). A missed allowlist edit was a
 * *silent* failure ("Invalid message type", the sheet hangs). Here the verb
 * vocabulary is one list ({@link INBOUND_VERBS}); `isInboundMessage` and the
 * tugcode dispatch registry derive from it, so adding a verb can't drift.
 *
 * `tugproto` is a source-only shared dir at the repo root — no build, no
 * publish. Both bundlers resolve it via the `@tugproto/*` path alias (tsconfig
 * `paths` for both; an extra Vite `resolve.alias` for tugdeck). Pure types +
 * pure runtime helpers — no React, no DOM, no Node/Bun API.
 *
 * **Payload strictness.** Where the two sides historically diverged, this
 * module uses the SENDER-permissive type so neither side breaks: `mode` is a
 * bare `string`, `answers` is `Record<string, unknown>`, `updatedInput` is
 * `unknown`. The receiver (tugcode) narrows at its handler boundary — the
 * correct place to validate JSON off the wire.
 *
 * @module tugproto/inbound
 */

// ---------------------------------------------------------------------------
// Content blocks — the Anthropic content-block wire shape carried on
// `user_message`. tugcode forwards `content` verbatim to the Agent SDK.
// ---------------------------------------------------------------------------

export interface ContentBlockText {
  type: "text";
  text: string;
}

export interface ContentBlockImageSourceBase64 {
  type: "base64";
  media_type: string;
  data: string;
}

export interface ContentBlockImage {
  type: "image";
  source: ContentBlockImageSourceBase64;
}

export type ContentBlock = ContentBlockText | ContentBlockImage;

// ---------------------------------------------------------------------------
// Per-verb payload interfaces
// ---------------------------------------------------------------------------

/** Handshake: the client announces its protocol version on connect. */
export interface ProtocolInit {
  type: "protocol_init";
  version: number;
}

/** A user turn — an Anthropic content-block array forwarded to the SDK. */
export interface UserMessage {
  type: "user_message";
  content: ContentBlock[];
}

/** Approve / deny a pending `can_use_tool` permission request. */
export interface ToolApproval {
  type: "tool_approval";
  request_id: string;
  decision: "allow" | "deny";
  /** On allow: optional override of the tool input. */
  updatedInput?: Record<string, unknown>;
  /** On deny: a human-readable reason. */
  message?: string;
  /** On allow: the SDK `PermissionUpdate[]` durable-scope suggestion, opaque. */
  updatedPermissions?: unknown[];
}

/** Answer a pending `AskUserQuestion`. Values are the selected option labels. */
export interface QuestionAnswer {
  type: "question_answer";
  request_id: string;
  answers: Record<string, string>;
}

/** Interrupt the in-flight turn. */
export interface Interrupt {
  type: "interrupt";
}

/** The session permission modes claude accepts. */
export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "auto"
  | "dontAsk"
  | "delegate";

/** Set the session permission mode. */
export interface PermissionModeMessage {
  type: "permission_mode";
  mode: PermissionMode;
}

/** Switch the active model. */
export interface ModelChange {
  type: "model_change";
  model: string;
}

/**
 * Set the reasoning-effort level ([#step-4]). claude has no live effort control
 * subtype, so tugcode applies it by respawning with `--effort` + `--resume`.
 */
export interface EffortChange {
  type: "effort_change";
  effort: string;
}

/**
 * Add a working directory ([#step-13c]). Like `effort_change`, claude exposes
 * no live add-directory verb over the bridge, so tugcode respawns claude with
 * the dir in `--add-dir` (+ `--resume`).
 */
export interface AddDirectory {
  type: "add_directory";
  directory: string;
}

/** Fork / continue / new the conversation ([D10]). */
export interface SessionCommand {
  type: "session_command";
  command: "fork" | "continue" | "new";
}

/** Stop a running subagent task. */
export interface StopTask {
  type: "stop_task";
  task_id: string;
}

/** Ask tugcode to replay the session JSONL ([D12]). */
export interface RequestReplay {
  type: "request_replay";
}

/**
 * `/rewind` diff-stat preview ([#step-7-1]). `promptUuid` is claude's
 * user-prompt-record uuid — the rewind anchor, not the dev-card `msgId`.
 */
export interface RewindPreview {
  type: "rewind_preview";
  promptUuid: string;
}

/**
 * Apply a `/rewind` ([#step-7-1]/[#step-7-2]). `scope` selects the dimension(s);
 * `fork` (conversation/both only) selects a forked copy over destructive
 * in-place.
 */
export interface SessionRewind {
  type: "session_rewind";
  promptUuid: string;
  scope: "conversation" | "code" | "both";
  fork?: boolean;
}

/** Request the `/skills` inventory ([#step-12d]); answered by `request_id`. */
export interface SkillsInventoryQuery {
  type: "skills_inventory_query";
  request_id: string;
}

/** Request the `/hooks` inventory ([#step-12c]); answered by `request_id`. */
export interface HooksQuery {
  type: "hooks_query";
  request_id: string;
}

// ---------------------------------------------------------------------------
// The union + the verb vocabulary (single source of truth)
// ---------------------------------------------------------------------------

/** Every message the client can send to tugcode over CODE_INPUT. */
export type InboundMessage =
  | ProtocolInit
  | UserMessage
  | ToolApproval
  | QuestionAnswer
  | Interrupt
  | PermissionModeMessage
  | ModelChange
  | EffortChange
  | AddDirectory
  | SessionCommand
  | StopTask
  | RequestReplay
  | RewindPreview
  | SessionRewind
  | SkillsInventoryQuery
  | HooksQuery;

/**
 * The canonical list of inbound verb names — the ONE place the verb set is
 * declared. `isInboundMessage` and tugcode's dispatch registry derive from it,
 * so a new verb is admitted/dispatched by adding it here (+ its payload type +
 * the union member above), never by editing a separate allowlist. Keep in sync
 * with {@link InboundMessage} (co-located, one file).
 */
export const INBOUND_VERBS = [
  "protocol_init",
  "user_message",
  "tool_approval",
  "question_answer",
  "interrupt",
  "permission_mode",
  "model_change",
  "effort_change",
  "add_directory",
  "session_command",
  "stop_task",
  "request_replay",
  "rewind_preview",
  "session_rewind",
  "skills_inventory_query",
  "hooks_query",
] as const satisfies ReadonlyArray<InboundMessage["type"]>;

/** A recognized inbound verb name. */
export type InboundVerb = (typeof INBOUND_VERBS)[number];

const INBOUND_VERB_SET: ReadonlySet<string> = new Set(INBOUND_VERBS);

/** Whether `name` is a recognized inbound verb. */
export function isInboundVerb(name: string): name is InboundVerb {
  return INBOUND_VERB_SET.has(name);
}

/**
 * Whether `msg` is a recognized inbound message — an object whose `type` is a
 * known verb. Derived from {@link INBOUND_VERBS}, so the allowlist can't drift
 * from the verb set. Per-payload field validation is the receiver's job (it
 * narrows the discriminated union in the handler).
 */
export function isInboundMessage(msg: unknown): msg is InboundMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const type = (msg as { type?: unknown }).type;
  return typeof type === "string" && isInboundVerb(type);
}
