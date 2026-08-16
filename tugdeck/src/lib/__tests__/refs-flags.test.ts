/**
 * refs-flags — the `/match` and `/search` argument grammar ([P07]).
 *
 * Typed flags are the truth, so this grammar has to round-trip: whatever the
 * deferred option cluster sets, it must be expressible as a line the user
 * could have typed, and parsing that line must give the same flags back.
 */
import { describe, expect, it } from "bun:test";

import {
  composeRefsCommandLine,
  composeRefsFlagTokens,
  parseRefsArgs,
  tokenizeRefsArgs,
} from "@/lib/refs-flags";

describe("tokenizeRefsArgs — a needle may carry a space", () => {
  it("splits on whitespace", () => {
    expect(tokenizeRefsArgs("foo  bar")).toEqual(["foo", "bar"]);
  });

  it("keeps a quoted needle whole and strips the quotes", () => {
    expect(tokenizeRefsArgs(`"foo bar" baz`)).toEqual(["foo bar", "baz"]);
    expect(tokenizeRefsArgs("'foo bar'")).toEqual(["foo bar"]);
  });

  it("keeps an empty quoted needle rather than dropping it silently", () => {
    expect(tokenizeRefsArgs(`"" foo`)).toEqual(["", "foo"]);
  });

  it("runs an unterminated quote to end of line — the mid-type case", () => {
    expect(tokenizeRefsArgs(`"foo bar`)).toEqual(["foo bar"]);
  });
});

describe("parseRefsArgs — /match (List L01)", () => {
  it("defaults to no flags at all", () => {
    expect(parseRefsArgs("match", "foo")).toEqual({
      needles: ["foo"],
      flags: {},
      unknown: [],
    });
  });

  it("reads each flag to its feed-side name", () => {
    expect(parseRefsArgs("match", "-a x").flags).toEqual({ any: true });
    expect(parseRefsArgs("match", "-e x").flags).toEqual({ exact: true });
    expect(parseRefsArgs("match", "-d x").flags).toEqual({ dirs: true });
    expect(parseRefsArgs("match", "-s x").flags).toEqual({ case_sensitive: true });
    expect(parseRefsArgs("match", "-1 x").flags).toEqual({ first_only: true });
  });

  it("clusters short flags into one token", () => {
    expect(parseRefsArgs("match", "-ae1 x").flags).toEqual({
      any: true,
      exact: true,
      first_only: true,
    });
  });

  it("collects an unknown flag and still runs the rest of the line", () => {
    const parsed = parseRefsArgs("match", "-z -a foo");
    expect(parsed.unknown).toEqual(["-z"]);
    expect(parsed.flags).toEqual({ any: true });
    expect(parsed.needles).toEqual(["foo"]);
  });

  it("reports a search-only flag as unknown here — the tables are separate", () => {
    // `-i` is case-insensitive for /search; /match is case-insensitive by
    // default and has no such flag.
    expect(parseRefsArgs("match", "-i foo").unknown).toEqual(["-i"]);
  });
});

describe("parseRefsArgs — /search (List L02)", () => {
  it("reads each flag to its feed-side name", () => {
    expect(parseRefsArgs("search", "-i x").flags).toEqual({ case_insensitive: true });
    expect(parseRefsArgs("search", "-e x").flags).toEqual({ regex: true });
    expect(parseRefsArgs("search", "-y x").flags).toEqual({ any: true });
    expect(parseRefsArgs("search", "-l x").flags).toEqual({ per_line: true });
  });

  it("treats -a and -s as the one all-files flag", () => {
    expect(parseRefsArgs("search", "-a x").flags).toEqual({ all_files: true });
    expect(parseRefsArgs("search", "-s x").flags).toEqual({ all_files: true });
  });

  it("keeps multiple needles in typed order", () => {
    expect(parseRefsArgs("search", "-ie alpha beta").needles).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("stops reading flags after `--`, so a dashed needle is reachable", () => {
    const parsed = parseRefsArgs("search", "-i -- -e");
    expect(parsed.flags).toEqual({ case_insensitive: true });
    expect(parsed.needles).toEqual(["-e"]);
    expect(parsed.unknown).toEqual([]);
  });

  it("treats a bare `-` as a needle, not an empty flag cluster", () => {
    expect(parseRefsArgs("search", "-").needles).toEqual(["-"]);
  });
});

describe("parseRefsArgs — the valued context flag", () => {
  it("reads the value from the next token, the same token, or after an `=`", () => {
    for (const line of ["-c 64 x", "-c64 x", "-c=64 x"]) {
      const parsed = parseRefsArgs("search", line);
      expect(parsed.flags).toEqual({ context_chars: 64 });
      expect(parsed.needles).toEqual(["x"]);
    }
  });

  it("rides at the end of a cluster", () => {
    expect(parseRefsArgs("search", "-ic 8 x").flags).toEqual({
      case_insensitive: true,
      context_chars: 8,
    });
  });

  it("takes zero, which is the whole-line escape hatch", () => {
    expect(parseRefsArgs("search", "-c 0 x").flags).toEqual({ context_chars: 0 });
  });

  it("reports a missing or unreadable value rather than guessing one", () => {
    // The needle is not silently eaten as a value, and the run still happens
    // — one bad flag should not cost the user their search.
    const parsed = parseRefsArgs("search", "-c foo");
    expect(parsed.flags).toEqual({});
    expect(parsed.unknown).toEqual(["-c"]);
    expect(parsed.needles).toEqual([]);
    expect(parseRefsArgs("search", "-c").needles).toEqual([]);
    expect(parseRefsArgs("search", "-c -4 x").unknown).toEqual(["-c"]);
  });

  it("is a /search flag only — /match reads `-c` as unknown", () => {
    expect(parseRefsArgs("match", "-c 8 x").unknown).toEqual(["-c"]);
  });

  it("round-trips through the emitter as its own token", () => {
    const flags = parseRefsArgs("search", "-ic 64 foo").flags;
    expect(composeRefsFlagTokens("search", flags)).toBe("-i -c 64");
    expect(parseRefsArgs("search", "-i -c 64 foo").flags).toEqual(flags);
  });
});

describe("composeRefsFlagTokens — the inverse the option cluster writes", () => {
  it("emits nothing for no flags", () => {
    expect(composeRefsFlagTokens("search", {})).toBe("");
  });

  it("round-trips a parsed line back to the same flags", () => {
    const flags = parseRefsArgs("search", "-iel foo").flags;
    const tokens = composeRefsFlagTokens("search", flags);
    expect(parseRefsArgs("search", `${tokens} foo`).flags).toEqual(flags);
  });

  it("emits the all-files flag once, under its canonical letter", () => {
    // `-a` and `-s` are one flag; emitting both would parse back the same but
    // read as two settings.
    expect(composeRefsFlagTokens("search", { all_files: true })).toBe("-a");
  });

  it("ignores a flag this op does not have", () => {
    expect(composeRefsFlagTokens("match", { regex: true })).toBe("");
  });
});

describe("composeRefsCommandLine", () => {
  it("composes the canonical line for a run", () => {
    expect(composeRefsCommandLine("search", ["foo"], { case_insensitive: true })).toBe(
      "/search -i foo",
    );
  });

  it("omits the flag token entirely when there are none", () => {
    expect(composeRefsCommandLine("match", ["foo", "bar"], {})).toBe(
      "/match foo bar",
    );
  });
});
