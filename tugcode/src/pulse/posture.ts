/**
 * The commentator's claude-CLI posture and system prompt — constants
 * pinned by the voice spike (`v2.1.173-pulse-spike/README.md`). Every
 * element was forced by a measured failure:
 *
 *  - exact model id (the `haiku` alias silently ran sonnet)
 *  - default permission mode + every tool disallowed (plan mode
 *    permits read-only tools; the model ran Bash/Agent investigations)
 *  - `--setting-sources ""` (the user's global `alwaysThinkingEnabled`
 *    cost 6–14s of thinking per one-line beat; settings isolation does
 *    not touch OAuth auth)
 *  - `MAX_THINKING_TOKENS=0` belt-and-braces
 *  - `--bare` rejected: it never reads OAuth/keychain
 *
 * @module pulse/posture
 */

/** Exact model id — aliases are not honored reliably. */
export const PULSE_MODEL = "claude-haiku-4-5";

/**
 * The tool vocabulary of claude 2.1.173's init frame. The CLI
 * hard-errors on unknown names in `--disallowedTools`, so this list
 * must track the release the daemon targets.
 */
export const PULSE_DISALLOWED_TOOLS = [
  "Task", "AskUserQuestion", "Bash", "CronCreate", "CronDelete", "CronList",
  "DesignSync", "Edit", "EnterPlanMode", "EnterWorktree", "ExitPlanMode",
  "ExitWorktree", "Monitor", "NotebookEdit", "PushNotification", "Read",
  "ScheduleWakeup", "Skill", "TaskCreate", "TaskGet", "TaskList",
  "TaskOutput", "TaskStop", "TaskUpdate", "ToolSearch", "WebFetch",
  "WebSearch", "Workflow", "Write",
] as const;

/**
 * The PULSE system prompt. Iterated in the spike, then re-aimed after
 * live integration (see the spike README's history):
 *
 *  - v3 fixed the silence: the spike's DEFAULT-TO-PASS posture
 *    double-filtered on top of the already-filtering producer.
 *  - v4 fixed the SUBJECT: the commentator was summarizing the
 *    developer's requests back at them. PULSE narrates the execution
 *    — what the assistant, its tools, subagents, and background jobs
 *    are doing, the approach and its texture — never the request,
 *    which rides along only as `context:` for interpretation.
 *  - v5 fixed FABRICATION: handed tool calls without outcomes, the
 *    model invented one (a clean tokei run narrated as "tokei
 *    unavailable"). Facts now carry true outcomes (producer change)
 *    and the prompt pins the digest as the only source of truth.
 */
export const PULSE_SYSTEM_PROMPT = [
  "You are PULSE, the color commentator on an AI coding assistant at",
  "work. Your audience is the developer who gave the assistant its",
  "instructions; your job is the look behind the scenes — what the",
  "assistant, its tools, its subagents, and its background jobs are",
  "DOING to carry the work out: the approach taking shape, progress,",
  "detours, errors and recoveries, interesting choices.",
  "",
  "You have no tools — never attempt to investigate anything; everything",
  "you know arrives in the digests. Each user message is a beat digest:",
  "factual lines about the assistant's actions, grouped under scope tags",
  "like [a1b2]. A line starting \"context:\" is the developer's standing",
  "request — use it to interpret the work, but NEVER restate, summarize,",
  "or echo it: the developer wrote it and knows what they asked.",
  "Narrate only the execution.",
  "",
  "THE DIGEST IS YOUR ONLY SOURCE OF TRUTH. Every fact states what",
  "actually happened — \"ok\" means it succeeded, \"failed\" means it",
  "failed. Never assert anything the digest does not state: no guessed",
  "outcomes, no invented errors, no speculation about availability or",
  "causes. If you cannot say something true and grounded, say PASS.",
  "",
  "Reply with EXACTLY ONE plain-text line — aim for 60–90 characters,",
  "never exceed 110. Your DEFAULT IS TO SPEAK — every beat deserves a",
  "line unless it genuinely adds nothing your previous lines didn't",
  "already carry. Reply with exactly PASS for those nothing-new beats.",
  "Never invent drama; quiet specificity beats hype.",
  "",
  "When you speak:",
  "- Present tense. Name specifics: files, commands, counts, durations.",
  "- Say what the assistant's actions MEAN — the approach, the pattern",
  "  in a burst of calls, a reversal, a milestone — not a restatement",
  "  of single events. Repeated calls on one file read as a struggle or",
  "  a sweep; a burst of reads before an edit reads as reconnaissance;",
  "  say so.",
  "- Never repeat information any of your previous lines already carried.",
  "- When two scopes appear, weave them or pick the more notable one.",
  "- No filler, no hype, no emoji, no markdown, no surrounding quotes.",
].join("\n");

/** Full argv (after the binary) for the commentator session. */
export function pulseClaudeArgs(): string[] {
  return [
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--verbose",
    "--model", PULSE_MODEL,
    "--permission-mode", "default",
    "--setting-sources", "",
    "--disallowedTools", ...PULSE_DISALLOWED_TOOLS,
    "--append-system-prompt", PULSE_SYSTEM_PROMPT,
  ];
}

/**
 * Subprocess env: parent env minus Anthropic auth vars (so the CLI
 * authenticates via the user's subscription credentials, exactly like
 * tugcode's session spawns — keep the scrub list in sync with
 * `session.ts`), plus a zero thinking budget.
 */
export function pulseClaudeEnv(
  parentEnv: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const {
    ANTHROPIC_API_KEY,
    ANTHROPIC_AUTH_TOKEN,
    CLAUDE_CODE_OAUTH_TOKEN,
    ...scrubbed
  } = parentEnv;
  void ANTHROPIC_API_KEY;
  void ANTHROPIC_AUTH_TOKEN;
  void CLAUDE_CODE_OAUTH_TOKEN;
  scrubbed.MAX_THINKING_TOKENS = "0";
  return scrubbed;
}
