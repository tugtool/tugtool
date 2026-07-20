/**
 * landing-receipt — receipt formatting + the Tug-Dash trailer parser
 * ([P09], Spec S04).
 */

import { describe, expect, test } from "bun:test";

import {
  dashNameFromTrailer,
  formatCommitReceiptInk,
  formatJoinReceiptInk,
  formatReleaseReceiptInk,
  parseNumstatReceipt,
} from "@/lib/landing-receipt";

describe("parseNumstatReceipt", () => {
  test("aggregates files, insertions, and deletions; binary counts as a file", () => {
    const receipt = "10\t2\tsrc/a.rs\n0\t5\tsrc/b.rs\n-\t-\tassets/logo.png\n";
    expect(parseNumstatReceipt(receipt)).toEqual({
      files: 3,
      insertions: 10,
      deletions: 7,
    });
  });

  test("empty and malformed lines are skipped", () => {
    expect(parseNumstatReceipt("")).toEqual({
      files: 0,
      insertions: 0,
      deletions: 0,
    });
    expect(parseNumstatReceipt("garbage\n\n1\t1\ta.txt")).toEqual({
      files: 1,
      insertions: 1,
      deletions: 1,
    });
  });
});

describe("receipt ink formatting (Spec S04)", () => {
  test("commit: verb, short sha, subject, counts", () => {
    const ink = formatCommitReceiptInk({
      sha: "45ae095d1abcdef00",
      message: "Move changeset drafts to changes.db\n\n- ledger DDL",
      numstatReceipt: "3\t1\ta.rs\n2\t0\tb.rs\n",
    });
    expect(ink.command).toBe("/commit");
    expect(ink.output).toBe(
      "committed 45ae095d1 — Move changeset drafts to changes.db\n2 files +5 −1",
    );
  });

  test("join: verb, short sha, dash provenance with rounds", () => {
    const ink = formatJoinReceiptInk({
      commitHash: "7510a3427ffff",
      dashName: "snippets",
      rounds: 6,
    });
    expect(ink.command).toBe("/join snippets");
    expect(ink.output).toBe("joined 7510a3427 — from dash snippets · 6 rounds");
    // A missing hash (defensive) still receipts the provenance.
    expect(
      formatJoinReceiptInk({ commitHash: null, dashName: "x", rounds: 1 }).output,
    ).toBe("joined — from dash x · 1 round");
  });

  test("release: no sha; names the discards, or reads clean ([P14])", () => {
    expect(
      formatReleaseReceiptInk({ dashName: "snippets", rounds: 6, dirty: true })
        .output,
    ).toBe("released dash snippets · discarded 6 rounds, a dirty worktree");
    expect(
      formatReleaseReceiptInk({ dashName: "x", rounds: 0, dirty: false }).output,
    ).toBe("released dash x · clean release");
  });
});

describe("dashNameFromTrailer", () => {
  test("parses the squash trailer's dash ref, with and without the onto clause", () => {
    expect(dashNameFromTrailer("tugdash/snippets onto main")).toBe("snippets");
    expect(dashNameFromTrailer("tugdash/fix-join")).toBe("fix-join");
    expect(dashNameFromTrailer("  tugdash/x onto main  ")).toBe("x");
  });

  test("non-dash values and absence yield null (no badge)", () => {
    expect(dashNameFromTrailer(undefined)).toBeNull();
    expect(dashNameFromTrailer(null)).toBeNull();
    expect(dashNameFromTrailer("")).toBeNull();
    expect(dashNameFromTrailer("main")).toBeNull();
    expect(dashNameFromTrailer("tugdash/")).toBeNull();
  });
});
