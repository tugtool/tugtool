import { describe, it, expect } from "bun:test";

import {
  bandShellLine,
  classifyShellLine,
  ShellVerdictCache,
} from "../shell-line-classifier";

// A representative login-PATH set. The classifier keys the first command token
// against this; unknown names fall to Code unless path-shaped.
const COMMANDS: ReadonlySet<string> = new Set([
  "ls", "git", "cargo", "make", "cat", "grep", "rg", "cd", "pwd", "echo",
  "cp", "mv", "rm", "mkdir", "touch", "find", "man", "time", "test", "sort",
  "head", "tail", "less", "more", "which", "open", "npm", "bun", "node",
  "python", "python3", "docker", "kubectl", "ssh", "curl", "tar", "chmod",
  "sed", "awk", "kill", "ps", "top", "df", "du", "cat", "tmux", "write", "apply",
  "sleep", "say", "who", "last", "join", "split", "yes",
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


// Prose openers that are also real executables — the exact cases that kept
// auto-detection parked before there was a model to ask. They must never reach
// `shell` on syntax alone; `unsure` is the whole point of the band.
const MUST_BE_UNSURE: readonly string[] = [
  "write a poem",
  "apply the patch",
  "make the button bigger",
  "find where the memory grows",
  "test the hypothesis that it leaks",
  "sort out this mess for me",
];

describe("bandShellLine — MUST band shell", () => {
  it("has at least 30 command lines", () => {
    expect(MUST_SHELL.length).toBeGreaterThanOrEqual(30);
  });
  for (const line of MUST_SHELL) {
    it(`shell: ${line}`, () => {
      expect(bandShellLine(line, COMMANDS)).toBe("shell");
    });
  }
});

describe("bandShellLine — the zero-false-shell gate", () => {
  it("has at least 30 prose lines", () => {
    expect(MUST_CODE.length).toBeGreaterThanOrEqual(30);
  });
  for (const line of MUST_CODE) {
    it(`never shell: ${line}`, () => {
      expect(bandShellLine(line, COMMANDS)).not.toBe("shell");
    });
  }
});

describe("bandShellLine — the ambiguous middle", () => {
  for (const line of MUST_BE_UNSURE) {
    it(`unsure: ${line}`, () => {
      expect(bandShellLine(line, COMMANDS)).toBe("unsure");
    });
  }

  it("a line that doesn't open with an executable is prose, not a question for the model", () => {
    expect(bandShellLine("why is this so slow?", COMMANDS)).toBe("prompt");
    expect(bandShellLine("frobnicate the widget", COMMANDS)).toBe("prompt");
    expect(bandShellLine("we should refactor the store layer", COMMANDS)).toBe("prompt");
  });

  it("a trailing question mark settles it without the model", () => {
    expect(bandShellLine("git status?", COMMANDS)).toBe("prompt");
  });
});

describe("bandShellLine — gates", () => {
  it("bands prose while the command set is null (loading)", () => {
    expect(bandShellLine("ls -la", null)).toBe("prompt");
  });

  it("never routes a slash command (already intercepted)", () => {
    expect(bandShellLine("/shell ls", COMMANDS)).toBe("prompt");
  });

  it("never routes a `#` comment / aside", () => {
    expect(bandShellLine("# note to self", COMMANDS)).toBe("prompt");
  });

  it("rejects an over-long line", () => {
    expect(bandShellLine(`ls ${"x".repeat(401)}`, COMMANDS)).toBe("prompt");
  });

  it("routes a path-shaped executable not in the set", () => {
    expect(bandShellLine("./bin/tool --run", COMMANDS)).toBe("shell");
  });
});

describe("classifyShellLine — the compatibility wrapper", () => {
  it("is the `shell` band, and only when the caller says routing is live", () => {
    expect(classifyShellLine("git status", COMMANDS, true)).toBe(true);
    expect(classifyShellLine("git status", COMMANDS, false)).toBe(false);
  });

  it("answers Code for the unsure band — no verdict means Claude", () => {
    expect(bandShellLine("make the button bigger", COMMANDS)).toBe("unsure");
    expect(classifyShellLine("make the button bigger", COMMANDS, true)).toBe(false);
  });
});

describe("bandShellLine — prose opening with an executable reaches the model", () => {
  // English verbs that are also PATH executables are the whole reason routing
  // is decided on the full line rather than the opener: on a stock macOS
  // install `write`, `say`, `who`, `last`, `join`, `split`, `yes`, `top` and
  // `sleep` are all real binaries, and the set grows with whatever else is on
  // a given machine's PATH. Each of these must reach `unsure` — the band that
  // spends a model round trip — and never `shell`.
  const PROSE_OPENING_WITH_A_BINARY: readonly string[] = [
    "write me a haiku about summertime",
    "write a test for the classifier",
    "top of the file needs a docblock",
    "sleep is what I need after this bug",
  ];

  it("bands prose that opens with an executable as unsure, never shell", () => {
    for (const line of PROSE_OPENING_WITH_A_BINARY) {
      expect(bandShellLine(line, COMMANDS)).toBe("unsure");
      expect(classifyShellLine(line, COMMANDS, true)).toBe(false);
    }
  });

  it("still bands the same opener as shell when the line is a real command", () => {
    expect(bandShellLine("write kocienda ttys001", COMMANDS)).toBe("shell");
  });
});

describe("ShellVerdictCache", () => {
  it("remembers a verdict by exact draft text", () => {
    const cache = new ShellVerdictCache();
    cache.set("make test", "shell");
    expect(cache.get("make test")).toBe("shell");
    expect(cache.get("make tests")).toBeUndefined();
  });

  it("drops the oldest entry past its capacity", () => {
    const cache = new ShellVerdictCache();
    for (let i = 0; i <= ShellVerdictCache.capacity; i += 1) {
      cache.set(`line ${i}`, "prompt");
    }
    expect(cache.size).toBe(ShellVerdictCache.capacity);
    expect(cache.get("line 0")).toBeUndefined();
    expect(cache.get(`line ${ShellVerdictCache.capacity}`)).toBe("prompt");
  });

  it("keeps a repeatedly-consulted draft hot rather than aging it out", () => {
    const cache = new ShellVerdictCache();
    cache.set("keep me", "shell");
    for (let i = 0; i < ShellVerdictCache.capacity - 1; i += 1) {
      cache.set(`filler ${i}`, "prompt");
    }
    cache.set("keep me", "shell");
    cache.set("one more", "prompt");
    expect(cache.get("keep me")).toBe("shell");
    expect(cache.get("filler 0")).toBeUndefined();
  });

  it("clears wholesale", () => {
    const cache = new ShellVerdictCache();
    cache.set("make test", "shell");
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("make test")).toBeUndefined();
  });
});
