/**
 * file-location-query.test.ts — the Open Quickly query parser.
 *
 * Exercises the real clipboard shapes: a bare name, the `file:line` form
 * compilers and grep emit, `file:line:col`, absolute paths in and out of the
 * project, and the near-misses that must NOT be read as a location.
 */

import { describe, expect, test } from "bun:test";
import { parseFileLocationQuery } from "./file-location-query";

const ROOT = "/Users/kocienda/Mounts/u/src/tugtool";

describe("parseFileLocationQuery", () => {
  test("a bare path carries no line", () => {
    expect(parseFileLocationQuery("tug-list-view.tsx")).toEqual({
      search: "tug-list-view.tsx",
    });
  });

  test("file:line splits into path and line", () => {
    expect(parseFileLocationQuery("tug-list-view.tsx:123")).toEqual({
      search: "tug-list-view.tsx",
      line: 123,
    });
  });

  test("file:line:col keeps the line and drops the column", () => {
    expect(parseFileLocationQuery("src/lib/foo.ts:12:30")).toEqual({
      search: "src/lib/foo.ts",
      line: 12,
    });
  });

  test("an absolute path inside the project relativizes", () => {
    expect(
      parseFileLocationQuery(`${ROOT}/tugdeck/src/lib/foo.ts:12`, ROOT),
    ).toEqual({ search: "tugdeck/src/lib/foo.ts", line: 12 });
  });

  test("a trailing slash on the root does not leave a leading slash", () => {
    expect(
      parseFileLocationQuery(`${ROOT}/tugdeck/src/lib/foo.ts`, `${ROOT}/`),
    ).toEqual({ search: "tugdeck/src/lib/foo.ts" });
  });

  test("an absolute path outside the project loses only its leading slash", () => {
    expect(parseFileLocationQuery("/etc/hosts:4", ROOT)).toEqual({
      search: "etc/hosts",
      line: 4,
    });
  });

  test("a leading ./ is stripped", () => {
    expect(parseFileLocationQuery("./src/lib/foo.ts")).toEqual({
      search: "src/lib/foo.ts",
    });
  });

  test("surrounding whitespace and quotes are stripped", () => {
    expect(parseFileLocationQuery('  "src/lib/foo.ts:12"  ')).toEqual({
      search: "src/lib/foo.ts",
      line: 12,
    });
  });

  test("a bare number is a search, not a line", () => {
    expect(parseFileLocationQuery("123")).toEqual({ search: "123" });
  });

  test("a non-numeric suffix stays part of the path", () => {
    expect(parseFileLocationQuery("foo:bar.ts")).toEqual({
      search: "foo:bar.ts",
    });
  });

  test("line 0 is dropped — reveal lines are 1-based", () => {
    expect(parseFileLocationQuery("foo.ts:0")).toEqual({ search: "foo.ts" });
  });

  test("an empty query stays empty", () => {
    expect(parseFileLocationQuery("   ")).toEqual({ search: "" });
  });
});
