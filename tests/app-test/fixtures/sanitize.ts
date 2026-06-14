/**
 * sanitize.ts — extract a small, scrubbed slice of a REAL Claude Code
 * session JSONL into a COMMITTED test fixture.
 *
 * Why this exists: app-tests must not depend on, or draw content from,
 * the live `~/.claude/projects/` archive (private local files that
 * mutate and never belong in git). Perf legs still measure the real
 * local corpus (gitignored — see `corpus/README.md`); everything else
 * resumes a committed, stable, sanitized fixture produced here.
 *
 * What it does:
 *  - Streams the first `--turns` user-initiated turns of a source
 *    session (line by line; whale files never load whole), stopping at
 *    a clean turn boundary so the slice is a valid replayable prefix.
 *  - Scrubs every record: home/abs paths → `/work/repo`, identity and
 *    machine fields (`cwd`, `gitBranch`, `sessionId`, `requestId`,
 *    `userID`) → fixed placeholders, emails → `user@example.com`, and
 *    a battery of secret patterns → `<REDACTED>`.
 *  - Preserves the wire shape the real replay→reducer→list-view path
 *    consumes (`message.id`, content-block kinds, `uuid`/`parentUuid`
 *    chains, `type`), so the fixture is *real-derived*, not synthetic.
 *  - Prints an auditable report (records kept, scrubs by category) so a
 *    human reviews the result before committing.
 *
 * Usage:
 *   bun run tests/app-test/fixtures/sanitize.ts \
 *     --in <source.jsonl> --out tests/app-test/fixtures/sessions/<name>.jsonl \
 *     [--turns 8] [--session-id fixture-0001]
 *
 * The output is reviewed by a human and committed; the source path is
 * never recorded in the fixture or in git.
 */

import { createReadStream, mkdirSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

interface Args {
  in: string;
  out: string;
  turns: number;
  sessionId: string;
  maxBlockChars: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const input = get("--in");
  const out = get("--out");
  if (input === undefined || out === undefined) {
    throw new Error(
      "usage: sanitize.ts --in <source.jsonl> --out <fixture.jsonl> [--turns N] [--session-id ID]",
    );
  }
  return {
    in: input,
    out,
    turns: Number(get("--turns") ?? "8"),
    sessionId: get("--session-id") ?? "fixture-0001",
    maxBlockChars: Number(get("--max-block-chars") ?? "800"),
  };
}

// ---------------------------------------------------------------------------
// Scrubbing
// ---------------------------------------------------------------------------

const HOME = homedir();

/** Categories tracked for the audit report. */
type ScrubKind = "path" | "email" | "secret" | "truncated" | "image";
const counts: Record<ScrubKind, number> = {
  path: 0,
  email: 0,
  secret: 0,
  truncated: 0,
  image: 0,
};

/** 1×1 transparent PNG. Image content blocks (the user's screenshots)
 * are replaced with this so the fixture keeps the "image-bearing
 * message" case without shipping a real screenshot. */
const PLACEHOLDER_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Oversized content blocks (file dumps, command output) are clipped to
 * this many chars so the fixture stays small and reviewable — the case
 * (a tool_result of that kind, its prose) is preserved, the blob is not.
 * Set in `main` from `--max-block-chars`. */
let MAX_CHARS = Number.POSITIVE_INFINITY;

const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{16,}/g, // Anthropic API key
  /sk-[A-Za-z0-9]{20,}/g, // OpenAI-style key
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack token
  /Bearer\s+[A-Za-z0-9._-]{20,}/g, // bearer header
  /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g,
];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function scrubString(s: string): string {
  let out = s;
  for (const pat of SECRET_PATTERNS) {
    out = out.replace(pat, () => {
      counts.secret += 1;
      return "<REDACTED>";
    });
  }
  // Home dir first (most specific), then any other /Users/<name>/ root.
  out = out.replace(new RegExp(escapeRegExp(HOME), "g"), () => {
    counts.path += 1;
    return "/work/repo";
  });
  out = out.replace(/\/Users\/[^/\s"']+/g, () => {
    counts.path += 1;
    return "/work/repo";
  });
  out = out.replace(EMAIL, () => {
    counts.email += 1;
    return "user@example.com";
  });
  if (out.length > MAX_CHARS) {
    counts.truncated += 1;
    out = out.slice(0, MAX_CHARS) + "… [truncated]";
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scrubValue(v: unknown): unknown {
  if (typeof v === "string") return scrubString(v);
  if (Array.isArray(v)) return v.map(scrubValue);
  if (v !== null && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    // Image content block: swap the (screenshot) base64 for a 1×1 PNG.
    const source = obj.source as { data?: unknown } | undefined;
    if (
      obj.type === "image" &&
      source !== undefined &&
      typeof source === "object" &&
      typeof source.data === "string"
    ) {
      counts.image += 1;
      return {
        ...obj,
        source: { ...source, media_type: "image/png", data: PLACEHOLDER_PNG },
      };
    }
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(obj)) {
      out[k] = scrubValue(val);
    }
    return out;
  }
  return v;
}

/** Apply fixed placeholders to the machine/identity fields, then deep-scrub. */
function sanitizeRecord(rec: Record<string, unknown>, sessionId: string): Record<string, unknown> {
  const scrubbed = scrubValue(rec) as Record<string, unknown>;
  if ("cwd" in scrubbed) scrubbed.cwd = "/work/repo";
  if ("gitBranch" in scrubbed) scrubbed.gitBranch = "main";
  if ("sessionId" in scrubbed) scrubbed.sessionId = sessionId;
  if ("requestId" in scrubbed) scrubbed.requestId = "req_fixture";
  if ("userID" in scrubbed) scrubbed.userID = "fixture-user";
  if ("userId" in scrubbed) scrubbed.userId = "fixture-user";
  return scrubbed;
}

/** A record opens a new turn when it is a user PROMPT (not a tool_result). */
function isUserPrompt(rec: Record<string, unknown>): boolean {
  if (rec.type !== "user") return false;
  const msg = rec.message as { role?: string; content?: unknown } | undefined;
  if (msg?.role !== "user") return false;
  // tool_result records are also role:"user" but carry an array of
  // tool_result blocks; a real prompt is a string or a text block.
  if (typeof msg.content === "string") return true;
  if (Array.isArray(msg.content)) {
    return msg.content.some(
      (b) => (b as { type?: string })?.type === "text",
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  MAX_CHARS = args.maxBlockChars;
  const rl = createInterface({
    input: createReadStream(args.in),
    crlfDelay: Infinity,
  });

  const kept: string[] = [];
  let turnsSeen = 0;
  let records = 0;
  let torn = 0;

  for await (const line of rl) {
    if (line.trim().length === 0) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line);
    } catch {
      torn += 1; // live-append torn line — drop
      continue;
    }
    if (isUserPrompt(rec)) {
      // Stop BEFORE the (turns+1)-th prompt so the slice ends at a
      // clean turn boundary.
      if (turnsSeen >= args.turns) break;
      turnsSeen += 1;
    }
    if (turnsSeen === 0) continue; // skip any preamble before the first prompt
    kept.push(JSON.stringify(sanitizeRecord(rec, args.sessionId)));
    records += 1;
  }
  rl.close();

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, kept.join("\n") + "\n", "utf8");

  const bytes = Buffer.byteLength(kept.join("\n") + "\n", "utf8");
  process.stdout.write(
    [
      `sanitize: wrote ${args.out}`,
      `  turns kept:   ${turnsSeen}`,
      `  records kept: ${records}`,
      `  torn dropped: ${torn}`,
      `  size:         ${(bytes / 1024).toFixed(1)} KB`,
      `  scrubs:       paths=${counts.path} emails=${counts.email} secrets=${counts.secret} truncated=${counts.truncated} images=${counts.image}`,
      `  session id:   ${args.sessionId}`,
      ``,
      `Review the fixture before committing — confirm no residual paths,`,
      `identifiers, or secrets, and that the content is acceptable to ship.`,
      ``,
    ].join("\n"),
  );
}

await main();
