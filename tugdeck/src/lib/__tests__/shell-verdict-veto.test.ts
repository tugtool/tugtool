import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { vetoesShellVerdict } from "../shell-line-classifier";

/**
 * The routing corpus the live gate scores, read rather than copied. Every line
 * it labels `shell` must survive the veto, or the veto has collapsed the feature
 * it protects — and reading the same file the harness reads is what keeps this
 * test from drifting away from `just model-classify`.
 */
function corpusLines(label: "shell" | "prompt"): string[] {
  const path = join(import.meta.dir, "../../../../tests/model-eval/classify-corpus.json");
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const cases = Array.isArray(parsed)
    ? parsed
    : (parsed as { cases: unknown[] }).cases;
  return (cases as { text: string; label: string }[])
    .filter((c) => c.label === label)
    .map((c) => c.text);
}

describe("vetoesShellVerdict", () => {
  it("vetoes both lines that really were executed on 2026-07-29", () => {
    expect(vetoesShellVerdict("count the number of lines of code with tokei")).toBe(true);
    expect(
      vetoesShellVerdict(
        "make a task list (not a markdown list) to write a c program to make a " +
          "command-line calculator. set it up with a makefile and a README.",
      ),
    ).toBe(true);
  });

  it("leaves every shell-labeled corpus case alone", () => {
    const survived = corpusLines("shell").filter((t) => !vetoesShellVerdict(t));
    expect(survived).toEqual(corpusLines("shell"));
  });

  it("leaves a command carrying prose inside quotes alone", () => {
    expect(vetoesShellVerdict('git commit -m "fix the thing for me"')).toBe(false);
    expect(vetoesShellVerdict('rg "the quick brown fox" src')).toBe(false);
    expect(vetoesShellVerdict("git commit -m 'about the crash on launch'")).toBe(false);
  });

  it("leaves long real commands alone", () => {
    expect(vetoesShellVerdict("rg -n --hidden --glob '!target' TODO src tests")).toBe(false);
    expect(vetoesShellVerdict('FOO=1 make test ARGS="--nocapture"')).toBe(false);
    expect(vetoesShellVerdict("docker run -it --rm -v /tmp:/tmp alpine sh")).toBe(false);
    expect(vetoesShellVerdict("cargo nextest run -p tugcast session_overview")).toBe(false);
  });

  it("does not read a path, a dotfile, or a bare dot as a sentence break", () => {
    expect(vetoesShellVerdict("./setup.sh")).toBe(false);
    expect(vetoesShellVerdict("split notes.txt")).toBe(false);
    expect(vetoesShellVerdict("find . -name main.rs")).toBe(false);
    expect(vetoesShellVerdict("cp src/main.rs src/old.rs")).toBe(false);
  });

  it("does not read a flag's own spelling as prose", () => {
    expect(vetoesShellVerdict("awk -F, file")).toBe(false);
    expect(vetoesShellVerdict("sort -k1,3 names")).toBe(false);
    expect(vetoesShellVerdict("git log --format=%h,%s")).toBe(false);
    expect(vetoesShellVerdict("tar -xzf archive.tgz -C /tmp")).toBe(false);
  });

  it("vetoes a question, a sentence break, and a bare article", () => {
    expect(vetoesShellVerdict("why is the build failing?")).toBe(true);
    expect(vetoesShellVerdict("make the button bigger")).toBe(true);
    expect(vetoesShellVerdict("open a PR for this")).toBe(true);
    expect(vetoesShellVerdict("run the tests. then push")).toBe(true);
  });

  it("needs length before a weak signal counts", () => {
    // `with` alone is plausible as an argument, so a short line keeps it.
    expect(vetoesShellVerdict("grep with src")).toBe(false);
    // The same word in a line longer than any command in the corpus does not.
    expect(vetoesShellVerdict("grep src tests docs build dist with everything")).toBe(true);
  });

  it("vetoes most prose-labeled corpus cases, since that is the point", () => {
    const vetoed = corpusLines("prompt").filter((t) => vetoesShellVerdict(t));
    // Not all of them: `find the memory leak` is caught, `build the project` is
    // caught, but `test the parser`-shaped lines that the model already calls
    // `prompt` need no help. The veto is a backstop, not the classifier.
    expect(vetoed.length).toBeGreaterThanOrEqual(corpusLines("prompt").length / 2);
  });
});
