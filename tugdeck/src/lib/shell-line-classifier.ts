/**
 * shell-line-classifier — the precondition half of deciding whether an
 * unprefixed, atom-free, single-line draft means the shell or means Claude
 * (Spec S03, [P09]).
 *
 * This module does not decide anything about intent. It brackets the model's
 * judgement from both sides with facts, and the model decides between them.
 *
 * Before: {@link isShellCandidate} asks *does the first word name a program that
 * exists on this machine?* That is checkable against the login PATH, and when
 * the answer is no the line cannot be a command, so no inference is spent on it.
 * Everything past that point — whether the person meant to RUN that program or
 * was writing a sentence that happens to start with its name — is a judgement
 * about English, and the model makes it.
 *
 * After: {@link vetoesShellVerdict} asks *is this line shaped like English?* and
 * can refuse to honor a `shell` verdict. It can only refuse; see its own doc for
 * why that makes it a different instrument from the rules described next.
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

/** A quoted span — the message of `git commit -m "fix the thing for me"`. */
const QUOTED_SPAN = /'[^']*'|"[^"]*"/g;

/**
 * Words a command line has essentially no use for and prose can hardly avoid.
 * One of these, standing as its own token outside quotes and outside a flag, is
 * enough on its own.
 */
const PROSE_MARKERS = new Set([
  "the", "a", "an",
  "i", "it", "me", "my", "you", "this", "that", "these", "those", "them",
]);

/**
 * Weaker prose signals. Each is plausible enough as a command argument that
 * length has to corroborate it before it counts.
 */
const PROSE_HINTS = new Set([
  "of", "for", "about", "into", "with", "from", "and", "or", "but",
  "is", "are", "was", "do", "does", "should", "please",
  "why", "what", "how", "when",
]);

/**
 * Tokens past which a line is longer than any command in the routing corpus,
 * whose longest case is three. Well clear of it, because real commands run
 * longer than the corpus does: `rg -n --hidden --glob '!target' TODO src tests`
 * is seven tokens and is a command.
 */
const COMMAND_TOKEN_CEILING = 6;

/**
 * Whether a `shell` verdict for this line must not be honored — the line is
 * shaped like English, whatever the model called it.
 *
 * This can only ever decline to execute. It never produces a `shell` verdict and
 * is never consulted on a `prompt` one, and that is what separates it from the
 * stopword, ambiguous-opener, and token-count rules this module used to carry.
 * Those decided *toward* shell: they let the classifier answer `which bun` and
 * `open .` by itself and hand the model only the leftovers, taking the
 * irreversible decision away from the model without adding any safety. A veto is
 * the opposite instrument. It cannot pre-empt anything toward shell because it
 * has no power to route there; it only adds one more degraded path to the list
 * this module already keeps, all of which resolve to Claude. The asymmetry is
 * unchanged — the shell is still reached only by an explicit `shell` verdict,
 * and now that verdict also has to survive this.
 *
 * Quoted spans are removed before anything else, so a command carrying prose as
 * an argument survives: `git commit -m "fix the thing for me"` is a command.
 *
 * Two signals cost a real command a keystroke. A trailing `?` on a glob
 * (`ls file?`) reads as a question, and an unquoted English word as a literal
 * argument (`rg the src`) reads as prose. Both resolve to Claude, which is the
 * direction doubt is supposed to fall here.
 */
export function vetoesShellVerdict(text: string): boolean {
  const bare = text.replace(QUOTED_SPAN, " ");

  // A question mark closing the line, or a period closing a sentence inside it.
  // The period must follow a word character, which is what tells a sentence
  // break (`calculator. set it up`) from a path (`./setup.sh`, `notes.txt`) and
  // from a bare `.` argument (`find . -name x`).
  if (/[A-Za-z]\?\s*$/.test(bare)) return true;
  if (/[A-Za-z0-9]\.\s+[a-z]/.test(bare)) return true;

  const tokens = bare.split(/\s+/).filter((t) => t.length > 0);

  let hint = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    // Neither a flag nor a flag's value is prose, whatever it spells. This is
    // also what keeps `awk -F, file` clear of the comma test below.
    if (token.startsWith("-")) continue;
    if (i > 0 && tokens[i - 1]!.startsWith("-")) continue;

    // A comma joining two multi-word clauses. Interior commas that punctuate an
    // argument rather than a sentence (`sort -k1,3`) are not followed by space.
    if (token.endsWith(",") && i >= 2 && tokens.length - i >= 3) return true;

    const word = token.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, "");
    if (PROSE_MARKERS.has(word)) return true;
    if (PROSE_HINTS.has(word)) hint = true;
  }

  return hint && tokens.length > COMMAND_TOKEN_CEILING;
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
