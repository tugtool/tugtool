/**
 * Teardown-save shape guard.
 *
 * Every teardown-class path — beforeunload, HMR, visibilitychange, the quit
 * RPC, and the reload prepare — must persist the same things: the pending
 * debounced layout save and every card's bag. That guarantee used to be
 * copy-pasted into each entry point, and `saveAndFlushSync` (the ⌘Q path) held
 * an incomplete copy: it never cleared the layout `saveTimer` and never called
 * `saveLayout`, so a window move or resize inside the 500 ms debounce was lost
 * on quit. The fix was structural — one `teardownSave` core, wrappers that add
 * only their own guard semantics — and this pins that structure.
 *
 * A source guard because `DeckManager` needs a live container element to
 * construct: there is no fake-DOM substrate in this suite (happy-dom is
 * deleted), so behavior is covered in the app-test corpus. The same idiom
 * guards the boot restore invariant in `boot-faithful-restore.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DECK_MANAGER_SRC = readFileSync(
  resolve(import.meta.dir, "..", "deck-manager.ts"),
  "utf8",
);

/**
 * Return the body of a class member declared at two-space indentation,
 * from its opening brace to the matching close.
 */
function memberBody(src: string, declaration: string): string {
  const start = src.indexOf(`\n  ${declaration}`);
  expect(start).toBeGreaterThan(-1);
  // The body brace is the first `{` outside the parameter list — an inline
  // options-object type would otherwise be mistaken for it.
  let parens = 0;
  let sawParen = false;
  let open = -1;
  for (let i = src.indexOf("(", start); i < src.length; i++) {
    if (src[i] === "(") {
      parens += 1;
      sawParen = true;
    } else if (src[i] === ")") {
      parens -= 1;
    } else if (src[i] === "{" && sawParen && parens === 0) {
      open = i;
      break;
    }
  }
  expect(open).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated member body for ${declaration}`);
}

/** The teardown-class entry points, by their declaration prefix. */
const ENTRY_POINTS = [
  "captureAllForTeardown(",
  "saveAndFlushSync(",
  "saveAndFlush(",
  "async prepareForReload(",
  "private readonly handleVisibilityChange =",
];

describe("teardown-save core", () => {
  for (const declaration of ENTRY_POINTS) {
    test(`${declaration} delegates to teardownSave`, () => {
      expect(memberBody(DECK_MANAGER_SRC, declaration)).toContain("teardownSave(");
    });

    test(`${declaration} keeps no private copy of the save sequence`, () => {
      const body = memberBody(DECK_MANAGER_SRC, declaration);
      expect(body).not.toContain("invokeSaveCallback(");
      expect(body).not.toContain("flushDirtyCardStates(");
      expect(body).not.toContain("saveLayout(");
    });
  }

  test("the core retires the pending layout timer and saves the layout", () => {
    const core = memberBody(DECK_MANAGER_SRC, "private teardownSave(");
    expect(core).toContain("clearTimeout(this.saveTimer)");
    expect(core).toContain("this.saveTimer = null");
    expect(core).toContain("this.saveLayout()");
    expect(core).toContain("this.invokeSaveCallback(");
    expect(core).toContain("this.flushDirtyCardStates(");
  });
});
