// Protocol-level types for claude CLI stdout messages.
// These represent the raw JSON structures emitted by the claude process,
// distinct from the IPC types in types.ts (which tugtalk emits to tugcast).

// ---------------------------------------------------------------------------
// System init message
// ---------------------------------------------------------------------------

export interface SystemInitMessage {
  type: "system";
  subtype: "init";
  session_id: string;
  cwd: string;
  tools: Array<string | Record<string, unknown>>;
  model: string;
  permissionMode: string;
  slash_commands: Array<Record<string, unknown>>;
  skills: Array<Record<string, unknown>>;
  agents: Array<Record<string, unknown>>;
  plugins: Array<Record<string, unknown>>;
  mcp_servers: Array<Record<string, unknown>>;
  claude_code_version: string;
  output_style: string;
  fast_mode_state: string;
  apiKeySource: string;
}

// ---------------------------------------------------------------------------
// Result message
// ---------------------------------------------------------------------------

export interface ModelUsageEntry {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD: number;
  contextWindow: number;
  maxOutputTokens: number;
}

export interface ResultMessage {
  type: "result";
  subtype:
    | "success"
    | "error_during_execution"
    | "error_max_turns"
    | "error_max_budget_usd"
    | "error_max_structured_output_retries";
  session_id: string;
  is_error: boolean;
  result: string;
  total_cost_usd: number;
  num_turns: number;
  duration_ms: number;
  // Per PN-19: duration of API calls only, excluding user wait time.
  duration_api_ms: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  // Per PN-11: per-model cost/token breakdown.
  modelUsage: Record<string, ModelUsageEntry>;
  permission_denials: Array<unknown>;
}

// ---------------------------------------------------------------------------
// Control request/response (from stdout; we write response to stdin)
// ---------------------------------------------------------------------------

// Per PN-7: permission suggestions are a discriminated union of action types.
export type PermissionSuggestion =
  | {
      type: "addDirectories";
      directories: string[];
      destination: "session" | "projectSettings" | "userSettings";
    }
  | {
      type: "addRules";
      rules: Array<{ toolName: string; ruleContent: string }>;
      destination: "session" | "projectSettings" | "userSettings";
    }
  | {
      type: "setMode";
      mode: "acceptEdits" | "bypassPermissions";
      destination: "session" | "projectSettings" | "userSettings";
    };

export interface ControlRequestMessage {
  type: "control_request";
  request_id: string;
  request: {
    subtype: "can_use_tool";
    tool_name: string;
    input: Record<string, unknown>;
    tool_use_id?: string;
    decision_reason?: string;
    blocked_path?: string;
    permission_suggestions?: PermissionSuggestion[];
  };
}

// ---------------------------------------------------------------------------
// AskUserQuestion tool input structure
// ---------------------------------------------------------------------------

export interface AskUserQuestionInput {
  questions: Array<{
    question: string;
    header?: string;
    multiSelect?: boolean;
    options?: Array<{ label: string; description?: string }>;
  }>;
}

// ---------------------------------------------------------------------------
// Structured tool result types (per D11, PN-4)
// ---------------------------------------------------------------------------

export interface StructuredPatchHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface EditToolResult {
  filePath: string;
  oldString: string;
  newString: string;
  originalFile: string | null;
  structuredPatch: StructuredPatchHunk[];
  userModified?: boolean;
  replaceAll?: boolean;
}

export interface WriteToolResult {
  type: "create" | "overwrite";
  filePath: string;
  content: string;
  structuredPatch: StructuredPatchHunk[];
  originalFile: string | null;
}
