// Test driver for BranchSlug. Run via tests/build-info/test-branch-slug.sh,
// which concatenates this file with tugapp/Sources/BranchSlug.swift and
// pipes the pair to `swift -`. The test driver runs against the same
// source the app builds against — no duplicated algorithm.

let cases: [(input: String, expected: String)] = [
    // The three examples called out in the plan task list.
    ("feat/foo",      "feat-foo"),
    ("Tide-1",        "tide-1"),
    ("wip/foo bar",   "wip-foo-bar"),

    // Identity cases — values already valid as slugs.
    ("main",          "main"),
    ("dev",           "dev"),
    ("0",             "0"),

    // Hyphen runs survive (already collapsed/trimmed).
    ("foo-bar-baz",   "foo-bar-baz"),

    // Multiple slashes all become hyphens.
    ("a/b/c",         "a-b-c"),

    // Mixed-case and digits.
    ("Tide-Wake-1",   "tide-wake-1"),
    ("ABC123",        "abc123"),

    // Whitespace becomes a separator.
    ("hello world",   "hello-world"),
    ("  pad  ",       "pad"),

    // Underscore is a separator.
    ("foo_bar",       "foo-bar"),

    // Punctuation becomes separators; runs collapse.
    ("v1.2.3",        "v1-2-3"),
    ("feature#42",    "feature-42"),
    ("a@b.c",         "a-b-c"),

    // Runs of non-slug chars collapse to a single dash.
    ("a///b",         "a-b"),
    ("foo   bar",     "foo-bar"),

    // Leading/trailing non-slug chars trim away cleanly.
    ("--leading",     "leading"),
    ("trailing--",    "trailing"),

    // Unicode becomes separators (only ASCII a-z, 0-9 survive).
    ("café",          "caf"),
    ("naïve",         "na-ve"),

    // Detached-HEAD shape produced by capture-build-info.sh (already
    // slug-safe — verify identity).
    ("detached-abcd1234", "detached-abcd1234"),

    // Empty input is empty out — callers are responsible for composing
    // a fallback if they need one.
    ("",              ""),
]

var failures: [String] = []
for c in cases {
    let actual = BranchSlug.compute(c.input)
    if actual != c.expected {
        failures.append("BranchSlug.compute(\"\(c.input)\") → \"\(actual)\"  (expected \"\(c.expected)\")")
    }
}

if failures.isEmpty {
    print("ok: \(cases.count) branch-slug cases pass")
} else {
    print("FAIL: \(failures.count) of \(cases.count) cases failed:")
    for f in failures { print("  - \(f)") }
    exit(1)
}
