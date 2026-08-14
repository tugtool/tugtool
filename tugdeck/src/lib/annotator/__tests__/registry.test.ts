/**
 * Pure-logic coverage for the annotation kind registry.
 *
 * The gestures themselves are app-tested against the real app — a real
 * click seeding the real composer (at0225), a real right-click driving the
 * real clipboard (at0237). What this file pins is the routing table those
 * gestures read: that every kind the annotator can stamp resolves to an
 * entry, and that each kind's menu items and standard-item suppression are
 * what the interaction layer will find when it asks.
 *
 * Deliberately no dispatch assertions here: verifying a click by handing
 * the registry a hand-rolled store and counting calls would prove only
 * that the fake was called, which is the pattern this project bans.
 */

import { describe, expect, test } from "bun:test";

import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { annotationEntryFor } from "../registry";
import type { AnnotationKind } from "../types";

const ALL_KINDS: ReadonlyArray<AnnotationKind> = [
  "url",
  "email",
  "slash-command",
  "shell-command",
  "file-path",
  "directory",
  "image",
  "commit-sha",
];

describe("every stampable kind is registered", () => {
  for (const kind of ALL_KINDS) {
    test(kind, () => {
      expect(annotationEntryFor(kind)).not.toBeNull();
    });
  }
});

describe("command kinds replace the standard menu block", () => {
  for (const kind of ["slash-command", "shell-command"] as const) {
    test(kind, () => {
      const entry = annotationEntryFor(kind);
      expect(entry?.suppressStandardItems).toBe(true);
      expect(
        entry
          ?.menuEntries({ kind: "shell-command", command: "just x" })
          .map((e) => e.label),
      ).toEqual(["Copy", "Copy as Plain Text", "Insert into Prompt"]);
    });
  }

  test("the copy items name real vocabulary actions", () => {
    expect(
      annotationEntryFor("slash-command")
        ?.menuEntries({ kind: "slash-command", name: "diff", args: "" })
        .map((e) => e.action),
    ).toEqual([
      TUG_ACTIONS.COPY_COMMAND,
      TUG_ACTIONS.COPY_COMMAND_AS_PLAIN_TEXT,
      TUG_ACTIONS.INSERT_INTO_PROMPT,
    ]);
  });

  test("and a command is one thing to a secondary click", () => {
    // The whole point of replacing the standard block: the menu's items
    // all act on the entire command, so the click must not leave the
    // browser's smart-selected sub-word painted underneath it.
    for (const kind of ["slash-command", "shell-command"] as const) {
      expect(annotationEntryFor(kind)?.wholeEntitySelection).toBe(true);
    }
  });

  test("and a command click is registered at all", () => {
    expect(annotationEntryFor("slash-command")?.primaryClick).toBeDefined();
    expect(annotationEntryFor("shell-command")?.primaryClick).toBeDefined();
  });
});

describe("link kinds leave the standard menu block alone", () => {
  for (const kind of ["url", "email"] as const) {
    test(kind, () => {
      expect(annotationEntryFor(kind)?.suppressStandardItems).toBe(false);
    });
  }

  test("email registers no click — a mailto anchor's own default is correct", () => {
    expect(annotationEntryFor("email")?.primaryClick).toBeUndefined();
  });

  test("url registers a click only for the hosts that are not anchors", () => {
    // A link chip the user attached is a span, not an `<a>`, so something
    // has to open it. Anchors never reach this handler — the delegated
    // listener leaves them to their own navigation, which is what keeps a
    // real link from opening twice.
    expect(annotationEntryFor("url")?.primaryClick).toBeDefined();
  });

  test("each names its value in the idiom of its kind", () => {
    expect(
      annotationEntryFor("url")
        ?.menuEntries({ kind: "url", url: "https://x.y" })
        .map((e) => e.label),
    ).toEqual(["Copy Link", "Insert into Prompt"]);
    expect(
      annotationEntryFor("email")
        ?.menuEntries({ kind: "email", address: "a@b.com" })
        .map((e) => e.label),
    ).toEqual(["Copy Address", "Insert into Prompt"]);
  });
});

describe("a file offers one way into the composer", () => {
  // Whether the composer receives a chip or characters is the handler's
  // call, not a second menu item's — at0346 is where that lands.
  test("open, reveal, copy, insert — and no second insert beside it", () => {
    expect(
      annotationEntryFor("file-path")
        ?.menuEntries({ kind: "file-path", path: "/repo/a.ts" })
        .map((e) => e.label),
    ).toEqual([
      "Open in Editor",
      "Show in Finder",
      "Copy Path",
      "Insert into Prompt",
    ]);
  });
});

describe("every kind offers to send its value back into the conversation", () => {
  for (const kind of ALL_KINDS) {
    test(kind, () => {
      const sample = {
        url: { kind: "url", url: "https://x.y" },
        email: { kind: "email", address: "a@b.com" },
        "slash-command": { kind: "slash-command", name: "diff", args: "" },
        "shell-command": { kind: "shell-command", command: "just x" },
        "file-path": { kind: "file-path", path: "/repo/a.ts" },
        directory: { kind: "directory", path: "/repo/src" },
        image: { kind: "image", atomId: "atom-7", label: "image-1" },
        "commit-sha": {
          kind: "commit-sha",
          sha: "b089d34a8",
          root: "/repo",
          paths: ["a.ts"],
        },
        session: {
          kind: "session",
          target: "123e4567-e89b-42d3-a456-426614174000",
        },
      }[kind] as Parameters<
        NonNullable<ReturnType<typeof annotationEntryFor>>["menuEntries"]
      >[0];
      const actions = annotationEntryFor(kind)?.menuEntries(sample).map((e) => e.action);
      expect(actions).toContain(TUG_ACTIONS.INSERT_INTO_PROMPT);
    });
  }
});
