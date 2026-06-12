/**
 * pulse-facts — the Claude Code route's PULSE fact producer.
 *
 * One {@link PulseFactProducer} per session observes the OUTBOUND IPC
 * stream (installed as the `ipc.writeLine` observer) and emits
 * `pulse_fact` frames — one plain-language sentence each — onto stdout
 * for the tugcast pulse bridge to divert to the commentator daemon.
 *
 * **The subject is the execution, not the request.** PULSE narrates
 * what the assistant, its tools, subagents, and background jobs are
 * DOING — the approach, progress, reversals, and texture of the work.
 * The developer's request rides along exactly once per turn as a
 * `context:`-prefixed fact so the commentator can interpret the work,
 * and the prompt contract forbids narrating it back (the developer
 * wrote it).
 *
 * Fact sites:
 *
 *   - turn start: the request as `context:` (explicit hook, inbound)
 *   - every tool call AT ITS RESULT, carrying the true outcome and a
 *     repeat ordinal ("Bash: tokei — ok (6s)", "Edit on reducer.ts —
 *     failed (2nd time this turn)") — facts state only what actually
 *     happened, because a commentator given calls without outcomes
 *     fabricates them (measured: a clean tokei run narrated as
 *     "tokei unavailable")
 *   - task-list adds / status flips (TaskCreate / TaskUpdate tools)
 *   - background-job launches + terminal flips (task_started /
 *     task_updated frames)
 *   - API retries (first attempt, then every 5th)
 *   - turn end: tool count + files edited + outcome
 *
 * Replay discipline: everything between `replay_started` and
 * `replay_complete` on the wire is persisted history being re-emitted —
 * the producer mutes itself across the bracket so reconnects never
 * re-narrate the past.
 *
 * @module pulse-facts
 */

/** Mirror of the wire envelope (see tugcast's pulse bridge / Spec S01). */
export interface PulseFactFrame {
  type: "pulse_fact";
  source: "claude-code";
  scope: string;
  kind: "turn" | "tool" | "task" | "job" | "error" | "note";
  fact: string;
  at: number;
}

/** Durations at or past this surface in the tool-outcome fact. */
export const TOOL_DURATION_MS = 1_500;
/** Preview budget for the turn's request-context fact. */
const CONTEXT_CHARS = 90;
/** API-retry facts: attempt 1, then every Nth. */
const RETRY_FACT_STRIDE = 5;
/** Turn-end fact lists at most this many edited files. */
const MAX_FILES_IN_TURN_END = 3;

// ---------------------------------------------------------------------------
// Pure phrasing helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Clip to `n` chars with an ellipsis; collapse internal newlines. */
export function clip(text: string, n: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= n ? flat : `${flat.slice(0, n - 1)}…`;
}

/** `2 → "2nd"`, `3 → "3rd"`, `11 → "11th"`, … */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** The request-context fact — interpretation aid, never narration. */
export function phraseTurnContext(preview: string): string {
  return `context: the developer's request this turn — "${clip(preview, CONTEXT_CHARS)}"`;
}

/** A short, specific hint for a tool call's target. */
export function toolHint(name: string, input: Record<string, unknown>): string {
  const filePath = input.file_path ?? input.path ?? input.notebook_path;
  if (typeof filePath === "string" && filePath.length > 0) {
    const base = filePath.split("/").pop() ?? filePath;
    return ` on ${base}`;
  }
  if (name === "Bash" && typeof input.command === "string") {
    return `: ${clip(input.command, 50)}`;
  }
  if (name === "Grep" && typeof input.pattern === "string") {
    return ` for "${clip(input.pattern, 40)}"`;
  }
  if (typeof input.description === "string" && input.description.length > 0) {
    return `: ${clip(input.description, 50)}`;
  }
  if (typeof input.prompt === "string" && input.prompt.length > 0) {
    return `: ${clip(input.prompt, 50)}`;
  }
  return "";
}

/**
 * One completed tool call: target, TRUE outcome, duration when
 * notable, and a repeat ordinal past the first occurrence.
 */
export function phraseToolDone(
  name: string,
  input: Record<string, unknown>,
  occurrence: number,
  elapsedMs: number,
  isError: boolean,
): string {
  const outcome = isError ? "failed" : "ok";
  const duration =
    elapsedMs >= TOOL_DURATION_MS ? ` (${Math.round(elapsedMs / 1000)}s)` : "";
  const repeat = occurrence > 1 ? ` (${ordinal(occurrence)} time this turn)` : "";
  return `${name}${toolHint(name, input)} — ${outcome}${duration}${repeat}`;
}

export function phraseTaskAdded(subject: string): string {
  return `task added: "${clip(subject, 60)}"`;
}

export function phraseTaskStatus(status: string): string {
  return `task marked ${status}`;
}

export function phraseJobLaunch(description: string): string {
  return `background job launched: ${clip(description, 70)}`;
}

export function phraseJobTerminal(status: string, description: string): string {
  return `background job ${status}: ${clip(description, 60)}`;
}

export function phraseApiRetry(attempt: number, maxRetries: number, error: string): string {
  return `API retry ${attempt}/${maxRetries}: ${clip(error, 50)}`;
}

export function phraseTurnEnd(
  result: string,
  toolCount: number,
  filesTouched: readonly string[],
): string {
  const tools = toolCount === 1 ? "1 tool call" : `${toolCount} tool calls`;
  let files = "";
  if (filesTouched.length > 0) {
    const shown = filesTouched.slice(0, MAX_FILES_IN_TURN_END);
    const more =
      filesTouched.length > shown.length
        ? ` +${filesTouched.length - shown.length} more`
        : "";
    files = `, edited ${shown.join(", ")}${more}`;
  }
  return `turn end: ${tools}${files} — ${result}`;
}

// ---------------------------------------------------------------------------
// The producer
// ---------------------------------------------------------------------------

export class PulseFactProducer {
  private readonly scope: string;
  private readonly write: (frame: PulseFactFrame) => void;
  private enabled: boolean;
  /** Muted while a replay bracket is on the wire. */
  private inReplay = false;

  // Per-turn state, reset at turn start / turn end.
  private toolCount = 0;
  /** `name+hint` → occurrences this turn, for the repeat ordinal. */
  private toolOccurrences = new Map<string, number>();
  /** Basenames touched by ok Edit / Write this turn, insertion order. */
  private filesTouched = new Set<string>();
  /** tool_use_id → call info; the outcome fact fires at the result. */
  private toolStarts = new Map<
    string,
    { name: string; input: Record<string, unknown>; startedAt: number }
  >();
  /** task_id → description, for terminal-flip phrasing. */
  private jobDescriptions = new Map<string, string>();
  private lastRetryFactAttempt = 0;

  constructor(options: {
    scope: string;
    write: (frame: PulseFactFrame) => void;
    enabled?: boolean;
  }) {
    this.scope = options.scope;
    this.write = options.write;
    this.enabled = options.enabled ?? true;
  }

  /** Kill the producer (cheap no-op mode); facts stop at the source. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Explicit hook from `handleUserMessage`. Resets the per-turn state
   * and emits the request as CONTEXT — the one fact about the
   * developer's side, marked so the commentator interprets the work
   * through it without ever narrating it.
   */
  onTurnStart(previewText: string): void {
    this.resetTurnState();
    if (previewText.trim().length > 0) {
      this.emit("note", phraseTurnContext(previewText));
    }
  }

  /**
   * Observe one outbound IPC message (the `writeLine` observer).
   * Cheap: a type switch with early returns; unknown types fall
   * through silently.
   */
  observeOutbound(message: Record<string, unknown>): void {
    const type = message.type;
    if (typeof type !== "string") return;
    switch (type) {
      case "replay_started":
        this.inReplay = true;
        return;
      case "replay_complete":
        this.inReplay = false;
        return;
      case "pulse_fact":
        return; // our own output — never re-observe
      case "tool_use":
        this.onToolUse(message);
        return;
      case "tool_result":
        this.onToolResult(message);
        return;
      case "task_started":
        this.onTaskStarted(message);
        return;
      case "task_updated":
        this.onTaskUpdated(message);
        return;
      case "api_retry":
        this.onApiRetry(message);
        return;
      case "turn_complete":
        this.onTurnComplete(message);
        return;
      default:
        return;
    }
  }

  // -------------------------------------------------------------------------

  private onToolUse(message: Record<string, unknown>): void {
    const name = typeof message.name === "string" ? message.name : "";
    if (name.length === 0) return;
    this.toolCount++;
    const toolUseId =
      typeof message.tool_use_id === "string" ? message.tool_use_id : "";
    const input =
      typeof message.input === "object" && message.input !== null
        ? (message.input as Record<string, unknown>)
        : {};
    if (name === "TaskCreate") {
      const subject = typeof input.subject === "string" ? input.subject : "";
      if (subject.length > 0) this.emit("task", phraseTaskAdded(subject));
      return;
    }
    if (name === "TaskUpdate") {
      const status = typeof input.status === "string" ? input.status : "";
      if (status.length > 0) this.emit("task", phraseTaskStatus(status));
      return;
    }
    // The fact for an ordinary tool call fires at its RESULT — never
    // here — so it can state the true outcome. A commentator handed
    // calls without outcomes invents them.
    if (toolUseId.length > 0) {
      this.toolStarts.set(toolUseId, { name, input, startedAt: Date.now() });
    }
  }

  private onToolResult(message: Record<string, unknown>): void {
    const toolUseId =
      typeof message.tool_use_id === "string" ? message.tool_use_id : "";
    const started = this.toolStarts.get(toolUseId);
    if (started === undefined) return;
    this.toolStarts.delete(toolUseId);
    const isError = message.is_error === true;
    const elapsed = Date.now() - started.startedAt;
    const { name, input } = started;
    if (!isError && (name === "Edit" || name === "Write" || name === "NotebookEdit")) {
      const filePath = input.file_path ?? input.notebook_path;
      if (typeof filePath === "string" && filePath.length > 0) {
        this.filesTouched.add(filePath.split("/").pop() ?? filePath);
      }
    }
    // The repeat ordinal counts completions of the same call shape —
    // repetition is signal (a sweep or a struggle), and at result
    // time the ordinal rides a true outcome.
    const label = `${name}${toolHint(name, input)}`;
    const occurrence = (this.toolOccurrences.get(label) ?? 0) + 1;
    this.toolOccurrences.set(label, occurrence);
    this.emit(
      isError ? "error" : "tool",
      phraseToolDone(name, input, occurrence, elapsed, isError),
    );
  }

  private onTaskStarted(message: Record<string, unknown>): void {
    const taskId = typeof message.task_id === "string" ? message.task_id : "";
    const description =
      typeof message.description === "string" && message.description.length > 0
        ? message.description
        : taskId;
    if (taskId.length > 0) this.jobDescriptions.set(taskId, description);
    this.emit("job", phraseJobLaunch(description));
  }

  private onTaskUpdated(message: Record<string, unknown>): void {
    const patch =
      typeof message.patch === "object" && message.patch !== null
        ? (message.patch as Record<string, unknown>)
        : {};
    const status = typeof patch.status === "string" ? patch.status : "";
    if (status.length === 0) return;
    const taskId = typeof message.task_id === "string" ? message.task_id : "";
    const description = this.jobDescriptions.get(taskId) ?? taskId;
    this.jobDescriptions.delete(taskId);
    this.emit("job", phraseJobTerminal(status, description));
  }

  private onApiRetry(message: Record<string, unknown>): void {
    const attempt = typeof message.attempt === "number" ? message.attempt : 0;
    // Source throttle: attempt 1 narrates the problem appearing; then
    // every Nth so a long outage doesn't flood the daemon.
    if (attempt !== 1 && attempt - this.lastRetryFactAttempt < RETRY_FACT_STRIDE) {
      return;
    }
    this.lastRetryFactAttempt = attempt;
    const maxRetries =
      typeof message.max_retries === "number" ? message.max_retries : 0;
    const error = typeof message.error === "string" ? message.error : "unknown";
    this.emit("error", phraseApiRetry(attempt, maxRetries, error));
  }

  private onTurnComplete(message: Record<string, unknown>): void {
    const result = typeof message.result === "string" ? message.result : "";
    this.emit(
      "turn",
      phraseTurnEnd(
        result.length > 0 ? result : "success",
        this.toolCount,
        [...this.filesTouched],
      ),
    );
    this.resetTurnState();
  }

  private resetTurnState(): void {
    this.toolCount = 0;
    this.toolOccurrences.clear();
    this.filesTouched.clear();
    this.toolStarts.clear();
    this.lastRetryFactAttempt = 0;
  }

  private emit(kind: PulseFactFrame["kind"], fact: string): void {
    if (!this.enabled || this.inReplay) return;
    this.write({
      type: "pulse_fact",
      source: "claude-code",
      scope: this.scope,
      kind,
      fact,
      at: Date.now(),
    });
  }
}
