import { describe, expect, it } from "bun:test";

import {
  matchesCommitReceipt,
  parseCommitReceipt,
} from "@/components/tugways/cards/session-commit-receipt-block";

describe("matchesCommitReceipt", () => {
  it("claims /commit and /commit <message>, not /commitx or a bare git", () => {
    expect(matchesCommitReceipt("/commit")).toBe(true);
    expect(matchesCommitReceipt("/commit tidy up")).toBe(true);
    expect(matchesCommitReceipt("/commitx")).toBe(false);
    expect(matchesCommitReceipt("git commit")).toBe(false);
    expect(matchesCommitReceipt("commit")).toBe(false);
  });
});

describe("parseCommitReceipt", () => {
  it("parses a well-formed S02 summary", () => {
    const out = "committed 0123456789 — Fix the thing\n2 file(s) · +14 −2";
    expect(parseCommitReceipt(out)).toEqual({
      sha: "0123456789",
      subject: "Fix the thing",
      files: 2,
      added: 14,
      removed: 2,
    });
  });

  it("returns null for a non-S02 output (older or truncated)", () => {
    expect(parseCommitReceipt("committed abc")).toBeNull();
    expect(parseCommitReceipt("some shell output\nmore lines")).toBeNull();
    // A hand-typed hyphen (not the em dash) never false-parses.
    expect(parseCommitReceipt("committed abc - subj\n1 file(s) · +1 −0")).toBeNull();
  });
});
