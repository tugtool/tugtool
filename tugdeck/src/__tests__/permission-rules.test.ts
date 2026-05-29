/**
 * permission-rules.test.ts — pure-logic coverage for the `/permissions`
 * rules data model ([#step-1-6]): matcher parse, response parse, the
 * scope-labeled bucket union (precedence + dedup), and the search filter.
 */

import { describe, expect, test } from "bun:test";
import {
  emptyPermissionsSnapshot,
  filterResolvedRules,
  isValidRuleMatcher,
  parsePermissionsResponse,
  parseRule,
  resolveBucket,
  type PermissionsSnapshot,
} from "@/lib/permission-rules";

describe("isValidRuleMatcher", () => {
  test("accepts well-formed matchers, including unknown tool names", () => {
    for (const ok of ["WebSearch", "Bash(ls:*)", "Read(//tmp/**)", "qqolWIHJqwoihqweFOIH"]) {
      expect(isValidRuleMatcher(ok), ok).toBe(true);
    }
  });

  test("rejects blatantly malformed input", () => {
    for (const bad of ["", "   ", "9lives", "foo bar", "(oops)", "Bash(ls:*"]) {
      expect(isValidRuleMatcher(bad), bad).toBe(false);
    }
  });
});

describe("parseRule", () => {
  test("splits Tool(specifier)", () => {
    expect(parseRule("Bash(ls:*)")).toEqual({ tool: "Bash", specifier: "ls:*" });
    expect(parseRule("Read(//tmp/**)")).toEqual({ tool: "Read", specifier: "//tmp/**" });
    expect(parseRule("WebFetch(domain:docs.claude.com)")).toEqual({
      tool: "WebFetch",
      specifier: "domain:docs.claude.com",
    });
  });

  test("bare tool has null specifier", () => {
    expect(parseRule("WebSearch")).toEqual({ tool: "WebSearch", specifier: null });
  });

  test("empty parens yield empty-string specifier", () => {
    expect(parseRule("Bash()")).toEqual({ tool: "Bash", specifier: "" });
  });

  test("odd input degrades to a bare tool, never throws", () => {
    expect(parseRule("  not a rule  ")).toEqual({ tool: "not a rule", specifier: null });
  });
});

describe("parsePermissionsResponse", () => {
  test("extracts cwd + per-scope buckets, keeping only string entries", () => {
    const snap = parsePermissionsResponse({
      cwd: "/project",
      scopes: {
        local: { allow: ["Bash(ls:*)", 42], deny: ["Read(./.env)"] },
        project: { ask: ["Bash(git push:*)"] },
      },
    });
    expect(snap.cwd).toBe("/project");
    expect(snap.scopes.local.allow).toEqual(["Bash(ls:*)"]); // 42 dropped
    expect(snap.scopes.local.deny).toEqual(["Read(./.env)"]);
    expect(snap.scopes.project.ask).toEqual(["Bash(git push:*)"]);
    // Absent scope → empty buckets.
    expect(snap.scopes.user.allow).toEqual([]);
  });

  test("malformed body degrades to an empty snapshot", () => {
    expect(parsePermissionsResponse(null)).toEqual(emptyPermissionsSnapshot(null));
    expect(parsePermissionsResponse("nope")).toEqual(emptyPermissionsSnapshot(null));
  });
});

describe("resolveBucket — scope precedence + dedup", () => {
  const snap: PermissionsSnapshot = {
    cwd: "/project",
    scopes: {
      user: { allow: ["WebSearch", "Bash(shared:*)"], ask: [], deny: [], additionalDirectories: [] },
      project: { allow: ["Bash(shared:*)"], ask: [], deny: [], additionalDirectories: [] },
      local: { allow: ["Bash(ls:*)"], ask: [], deny: [], additionalDirectories: [] },
    },
  };

  test("union visits local→project→user, deduping to the highest scope", () => {
    const rules = resolveBucket(snap, "allow");
    expect(rules.map((r) => r.raw)).toEqual(["Bash(ls:*)", "Bash(shared:*)", "WebSearch"]);
    // The shared rule resolves to project (higher precedence than user).
    const shared = rules.find((r) => r.raw === "Bash(shared:*)");
    expect(shared?.scope).toBe("project");
    // The local-only rule resolves to local; parsed fields populated.
    const local = rules.find((r) => r.raw === "Bash(ls:*)");
    expect(local).toMatchObject({ scope: "local", tool: "Bash", specifier: "ls:*" });
  });

  test("an empty bucket resolves to []", () => {
    expect(resolveBucket(snap, "deny")).toEqual([]);
  });
});

describe("filterResolvedRules", () => {
  const snap: PermissionsSnapshot = {
    cwd: null,
    scopes: {
      user: { allow: [], ask: [], deny: [], additionalDirectories: [] },
      project: { allow: [], ask: [], deny: [], additionalDirectories: [] },
      local: {
        allow: ["Bash(ls:*)", "Bash(cargo build:*)", "WebSearch"],
        ask: [],
        deny: [],
        additionalDirectories: [],
      },
    },
  };
  const rules = resolveBucket(snap, "allow");

  test("empty query returns all rules (a copy)", () => {
    const out = filterResolvedRules(rules, "   ");
    expect(out.map((r) => r.raw)).toEqual(["Bash(ls:*)", "Bash(cargo build:*)", "WebSearch"]);
    expect(out).not.toBe(rules);
  });

  test("case-insensitive substring match on the raw matcher", () => {
    expect(filterResolvedRules(rules, "CARGO").map((r) => r.raw)).toEqual([
      "Bash(cargo build:*)",
    ]);
    expect(filterResolvedRules(rules, "web").map((r) => r.raw)).toEqual(["WebSearch"]);
    expect(filterResolvedRules(rules, "zzz")).toEqual([]);
  });
});
