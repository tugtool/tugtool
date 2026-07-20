import { describe, it, expect } from "bun:test";

import {
  AUTO_SHELL_DETECTION_ENABLED,
  autoShellOpener,
  classifyShellLine,
} from "../shell-line-classifier";

// A representative login-PATH set. The classifier keys the first command token
// against this; unknown names fall to Code unless path-shaped.
const COMMANDS: ReadonlySet<string> = new Set([
  "ls", "git", "cargo", "make", "cat", "grep", "rg", "cd", "pwd", "echo",
  "cp", "mv", "rm", "mkdir", "touch", "find", "man", "time", "test", "sort",
  "head", "tail", "less", "more", "which", "open", "npm", "bun", "node",
  "python", "python3", "docker", "kubectl", "ssh", "curl", "tar", "chmod",
  "sed", "awk", "kill", "ps", "top", "df", "du", "cat", "tmux",
]);

// ≥30 command lines that MUST classify shell. A single miss here is a
// false-Code (acceptable direction) — but they anchor the intended coverage.
const MUST_SHELL: readonly string[] = [
  "ls",
  "ls -la",
  "pwd",
  "git status",
  "git commit -am wip",
  "git push origin main",
  "cargo build",
  "cargo nextest run 2>&1 | tail -30",
  "./scripts/build.sh --release",
  "FOO=1 make test",
  "make test",
  "npm run build",
  "bun test",
  "node index.js",
  "python3 -m venv .venv",
  "docker ps -a",
  "kubectl get pods",
  "grep -rn TODO src",
  "rg --files",
  "cat README.md",
  "cd tugrust && cargo nextest run",
  "rm -rf dist",
  "mkdir -p build/out",
  "cp -r a b",
  "mv old new",
  "chmod +x run.sh",
  "sed -n '1,20p' file.rs",
  "curl -sSL https://example.com/x",
  "tar -xzf archive.tar.gz",
  "ssh host 'uptime'",
  "ps aux | grep node",
  "df -h",
  "du -sh *",
  "echo $HOME",
  "git log --oneline -10",
  "find . -name '*.rs'",
];

// ≥30 prose lines that MUST classify Code. Any of these classifying shell FAILS
// the suite — the zero-false-shell gate.
const MUST_CODE: readonly string[] = [
  "find the bug in the parser",
  "test whether the parser handles unicode",
  "man do I need to fix this",
  "git is confusing me, explain rebase",
  "time to refactor this module",
  "cat and dog pictures please",
  "sort out this mess for me",
  "head to the next section",
  "tail end of the file is wrong",
  "less is more in this design",
  "make sure the tests pass",
  "open the door for extension",
  "which approach do you recommend",
  "touch base with me about this",
  "why is this so slow?",
  "how do I run the tests?",
  "what does this function do?",
  "can you explain this code",
  "please add a test for the edge case",
  "we should refactor the store layer",
  "the parser needs a new rule",
  "look at the way this is structured",
  "test the hypothesis that it leaks",
  "find where the memory grows",
  "explain the ownership model here",
  "rewrite this to use iterators",
  "is there a cleaner way to do this",
  "add error handling to the loop",
  "review my changes and suggest fixes",
  "summarize what changed in this file",
  "walk me through the auth flow",
  "make the button wider",
  "sort the results by date and then name",
  "cat got your tongue about this bug",
  "do you think this is thread safe",
];

// Auto-detection is parked off (`AUTO_SHELL_DETECTION_ENABLED = false`): both
// entry points short-circuit to Code / null. The corpora below document the
// intended verdicts as the hook — gate each positive-detection assertion on the
// flag so the suite stays correct in both states.

describe("classifyShellLine — MUST classify shell", () => {
  it("has at least 30 command lines", () => {
    expect(MUST_SHELL.length).toBeGreaterThanOrEqual(30);
  });
  for (const line of MUST_SHELL) {
    it(`shell: ${line}`, () => {
      expect(classifyShellLine(line, COMMANDS)).toBe(AUTO_SHELL_DETECTION_ENABLED);
    });
  }
});

describe("classifyShellLine — MUST classify Code (zero-false-shell gate)", () => {
  it("has at least 30 prose lines", () => {
    expect(MUST_CODE.length).toBeGreaterThanOrEqual(30);
  });
  for (const line of MUST_CODE) {
    it(`code: ${line}`, () => {
      expect(classifyShellLine(line, COMMANDS)).toBe(false);
    });
  }
});

describe("classifyShellLine — gates", () => {
  it("answers Code while the command set is null (loading)", () => {
    expect(classifyShellLine("ls -la", null)).toBe(false);
  });

  it("never routes a slash command (already intercepted)", () => {
    expect(classifyShellLine("/shell ls", COMMANDS)).toBe(false);
  });

  it("never routes a `#` comment / aside", () => {
    expect(classifyShellLine("# note to self", COMMANDS)).toBe(false);
  });

  it("rejects an unknown, non-path first token", () => {
    expect(classifyShellLine("frobnicate the widget", COMMANDS)).toBe(false);
  });

  it("rejects an over-long line", () => {
    expect(classifyShellLine(`ls ${"x".repeat(401)}`, COMMANDS)).toBe(false);
  });

  it("routes a path-shaped executable not in the set", () => {
    expect(classifyShellLine("./bin/tool --run", COMMANDS)).toBe(
      AUTO_SHELL_DETECTION_ENABLED,
    );
  });
});

describe("autoShellOpener — live `!shell` chip insert gate", () => {
  // The opener token when detection is on, else null (parked off).
  const opened = (token: string): string | null =>
    AUTO_SHELL_DETECTION_ENABLED ? token : null;

  it("fires on an unambiguous PATH command + trailing space, caret at end", () => {
    expect(autoShellOpener("git ", 4, COMMANDS)).toBe(opened("git"));
    expect(autoShellOpener("ls ", 3, COMMANDS)).toBe(opened("ls"));
    expect(autoShellOpener("cargo ", 6, COMMANDS)).toBe(opened("cargo"));
  });

  it("fires on a path-shaped executable", () => {
    expect(autoShellOpener("./run.sh ", 9, COMMANDS)).toBe(opened("./run.sh"));
    expect(autoShellOpener("~/bin/tool ", 11, COMMANDS)).toBe(opened("~/bin/tool"));
  });

  it("never fires on ambiguous openers or stopword-ish commands", () => {
    for (const doc of ["cat ", "find ", "make ", "test ", "open ", "which "]) {
      expect(autoShellOpener(doc, doc.length, COMMANDS)).toBeNull();
    }
  });

  it("never fires on an unknown token, sigil leads, or a null set", () => {
    expect(autoShellOpener("frobnicate ", 11, COMMANDS)).toBeNull();
    expect(autoShellOpener("/shell ", 7, COMMANDS)).toBeNull();
    expect(autoShellOpener("!shell ", 7, COMMANDS)).toBeNull();
    expect(autoShellOpener("# note ", 7, COMMANDS)).toBeNull();
    expect(autoShellOpener("git ", 4, null)).toBeNull();
  });

  it("requires exactly one token + one space with the caret at the end", () => {
    expect(autoShellOpener("git", 3, COMMANDS)).toBeNull();
    expect(autoShellOpener("git status ", 11, COMMANDS)).toBeNull();
    expect(autoShellOpener("git ", 2, COMMANDS)).toBeNull();
    expect(autoShellOpener("git \n", 5, COMMANDS)).toBeNull();
  });
});
