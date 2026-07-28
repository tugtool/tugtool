/**
 * shell-line-classifier — the precondition half of deciding whether an
 * unprefixed, atom-free, single-line draft means the shell or means Claude
 * (Spec S03, [P09]).
 *
 * This module does not decide anything about intent. It answers one factual
 * question — {@link isShellCandidate} — and the local model answers the rest.
 *
 * The fact is: *does the first word name a program that exists on this
 * machine?* That is checkable against the login PATH, and when the answer is no
 * the line cannot be a command, so no inference is spent on it. Everything past
 * that point — whether the person meant to RUN that program or was writing a
 * sentence that happens to start with its name — is a judgement about English,
 * and the model makes it.
 *
 * An earlier revision tried to make that judgement here, with a stopword list,
 * a list of "ambiguous" openers, and a token-count rule. Those were guesses
 * about English dressed as syntax, and they pre-empted the model on most lines
 * it should have seen: the classifier decided `which bun` and `open .` by
 * itself and delegated only the leftovers. They are gone. The rule now is that
 * anything opening on a real program name is the model's question.
 *
 * The wrong-way costs are asymmetric and that asymmetry sets the whole design.
 * A line sent to Claude that meant the shell costs one keystroke to retype with
 * `!shell`. A line sent to the shell that meant Claude has **already executed**
 * — the auto-routed row offers "send to Claude instead", but nothing un-runs
 * the command. So every degraded path here resolves to Claude: no model, no
 * PATH set, no verdict, a timeout, a malformed answer. The shell is reached
 * only by an explicit `shell` verdict.
 *
 * Routing is decided once, at submit, over the **whole line**. There is no
 * opener-only judgement while the user types: the set of English words that are
 * also PATH executables is large (`write`, `say`, `who`, `last`, `join`,
 * `split`, `yes`, `top`, `sleep`, …) and varies by machine, so a first-word
 * test cannot tell `write me a haiku` from `write kocienda ttys001` and has no
 * line context yet to help it.
 *
 * Pure — no side effects, no store reads. The caller enforces the rest of the
 * precondition (the draft has no atoms; `text` is trimmed and single-line),
 * supplies the login-PATH command set (null until it loads, which answers
 * Claude — the safety net, not the steady state), and supplies its own
 * readiness.
 *
 * @module lib/shell-line-classifier
 */

/** A leading `NAME=value` environment-assignment token (skipped to find the command). */
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * The longest draft worth putting to the model. Past this the line is prose by
 * volume, and the classify prompt is tuned on command-length input.
 */
const MAX_CANDIDATE_LENGTH = 400;

/**
 * Whether a trimmed, single-line, atom-free draft could be a shell command at
 * all — the factual precondition the model's verdict is conditioned on.
 *
 * True means "the first word names a real program on this machine", which is
 * exactly what the classify prompt tells the model it may assume. It does
 * **not** mean the line is a command; only the model's verdict means that.
 *
 * A null command set (still loading) answers false: a line whose first word
 * can't be checked doesn't satisfy the precondition, so asking would put the
 * model a question it was told the answer to.
 */
export function isShellCandidate(
  text: string,
  commands: ReadonlySet<string> | null,
): boolean {
  if (commands === null) return false;

  // `#` leads a comment or a prose aside. (Slash commands are handled below,
  // where they are told apart from absolute paths.)
  if (text.length === 0 || text.length > MAX_CANDIDATE_LENGTH) return false;
  if (text.startsWith("#")) return false;

  const tokens = text.split(/\s+/).filter((t) => t.length > 0);

  // Skip a leading `NAME=value` env-assignment prefix (`FOO=1 make test`) so the
  // real command token is the one examined.
  let cmdStart = 0;
  while (cmdStart < tokens.length && ENV_ASSIGN.test(tokens[cmdStart]!)) cmdStart += 1;
  const first = tokens[cmdStart];
  if (first === undefined) return false;

  // Either a known PATH executable, or a program named by path — a script at
  // `./build.sh` is as real as one on the PATH, and tokens never contain
  // spaces. An absolute path needs an interior slash (`/usr/bin/true`), which
  // is what separates it from a slash command (`/shell`, `/tugplug:draft`);
  // those are intercepted upstream and must not be read as programs here.
  if (commands.has(first)) return true;
  return (
    first.startsWith("./") || first.startsWith("~/") || /^\/[^/]+\//.test(first)
  );
}

/**
 * Verdicts already obtained from the model, keyed by the exact draft text.
 *
 * A model round trip costs hundreds of milliseconds, and a user editing the tail
 * of a line re-presents earlier prefixes constantly — so the same question would
 * otherwise be asked over and over. Bounded because a draft's history is
 * unbounded; cleared on submit/clear because verdicts belong to the draft being
 * composed, not to the session.
 */
export class ShellVerdictCache {
  /** Distinct drafts remembered before the oldest is dropped. */
  static readonly capacity = 32;

  private readonly entries = new Map<string, "shell" | "prompt">();

  get(text: string): "shell" | "prompt" | undefined {
    return this.entries.get(text);
  }

  set(text: string, verdict: "shell" | "prompt"): void {
    // Re-insert so a repeatedly-consulted draft stays hot rather than aging out
    // behind drafts that were asked about once.
    this.entries.delete(text);
    this.entries.set(text, verdict);
    while (this.entries.size > ShellVerdictCache.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
