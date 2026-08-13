/**
 * at0368-gazette-session-citations.test.ts — a session named in prose becomes
 * the live citation chip, and the run it occupies is never claimed by the
 * wrong scan.
 *
 * A `project/callsign` token is shaped EXACTLY like a relative path, and the
 * answer that tells the two apart — does the ledger hold this session? —
 * arrives asynchronously, a verdict batch after the ink is painted. Scan order
 * cannot settle that: every scan's matches land in one array sorted by offset,
 * and whichever claims the run first blocks the other permanently. So a
 * pending session candidate RESERVES its run: marked by nobody, available to
 * nobody, until the verdict lands.
 *
 * All three outcomes are asserted on the real app, because all three are
 * properties of a DOM pass over rendered markdown and there is no in-process
 * DOM to run one in:
 *
 *  1. **Reserved.** Before the ledger answers, the session-shaped run carries
 *     no annotation of any kind — not a citation, and NOT the path annotation
 *     it would have been given had the path scan been allowed to take it.
 *  2. **Confirmed.** Once the ledger answers with the session, the run becomes
 *     a live `TugSessionCitation`, portaled into the span the annotator marked.
 *  3. **Refuted.** A look-alike the ledger has never heard of stays ordinary
 *     text — no chip, not even a slashed one. An unresolvable *declared* ref
 *     wears the slashed chip; a scanned token that turns out to be nothing is
 *     just a word.
 *
 * And the other direction, which is the half a session scan can break: a real
 * repository path in the same post still ends up a path annotation.
 *
 * The ledger's answer is delivered through `dispatchControlAction`, which is
 * the production `resolve_sessions_ok` handler — the same function the wire
 * frame reaches. Everything downstream of it is production: the citation
 * store, the verdict batch, the re-mark, the portal.
 *
 * @covers tugdeck/src/lib/annotator/detect-session-ref.ts
 * @covers tugdeck/src/lib/annotator/session-resolution.ts
 * @covers tugdeck/src/lib/annotator/annotate-content.ts
 * @covers tugdeck/src/lib/annotator/wrap-matches.ts
 * @covers tugdeck/src/components/tugways/session-citation-portals.tsx
 * @covers tugdeck/src/components/tugways/tug-markdown-block.tsx
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { launchTugApp, note } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 120_000;

const CARD = '[data-testid="gazette-card"]';
const BODY = `${CARD} .gazette-post-body`;

/** This checkout — so the post's paths resolve through the real chain. */
const REPO_ROOT = resolve(import.meta.dir, "../..");
/** Its leaf name, which is what a `project/callsign` spelling carries. */
const PROJECT = REPO_ROOT.split("/").pop()!;

const SESSION_ID = "b3c4d5e6-1a2b-4c3d-8e4f-5a6b7c8d9e02";
const HELD = "brisk-lantern";
const MISSING = "imaginary-lantern";

/** The ledger's answer, through the production `resolve_sessions_ok` handler. */
function resolveSessions(): string {
  return `window.__tug.dispatchControlAction("resolve_sessions_ok", ${JSON.stringify({
    sessions: [
      {
        queried: HELD,
        session: {
          session_id: SESSION_ID,
          workspace_key: "ws-1",
          project_dir: REPO_ROOT,
          created_at: 1_754_600_000_000,
          last_used_at: 1_754_600_100_000,
          turn_count: 4,
          last_user_prompt: null,
          state: "closed",
          card_id: null,
          name: null,
          tag: HELD,
        },
      },
    ],
    unknown: [MISSING],
  })})`;
}

/** What every session-shaped run in the post currently is. */
const RUNS_JS = `(function () {
  var body = document.querySelector(${JSON.stringify(BODY)});
  if (body === null) return null;
  function classify(needle) {
    var wrapped = Array.from(body.querySelectorAll("[data-tug-annotation]"))
      .find(function (el) {
        var text = (el.textContent || "") + (el.getAttribute("data-tugx-session-text") || "");
        return text.indexOf(needle) !== -1;
      });
    return wrapped === undefined
      ? null
      : {
          kind: wrapped.getAttribute("data-tug-annotation"),
          target: wrapped.getAttribute("data-target"),
          chip: wrapped.querySelector('[data-slot="tug-session-identity"], .tug-session-identity') !== null,
        };
  }
  return {
    held: classify(${JSON.stringify(`${PROJECT}/${HELD}`)}),
    missing: classify(${JSON.stringify(`${PROJECT}/${MISSING}`)}),
    path: classify("tugdeck/src/lib/gazette-store.ts"),
    text: (body.textContent || "").replace(/\\s+/g, " ").trim(),
    awaiting: body.querySelector("[data-tugx-awaiting]") !== null
      || (body.firstElementChild !== null
          && body.firstElementChild.hasAttribute("data-tugx-awaiting")),
  };
})()`;

interface Run {
  kind: string | null;
  target: string | null;
  chip: boolean;
}

interface Runs {
  held: Run | null;
  missing: Run | null;
  path: Run | null;
  text: string;
  awaiting: boolean;
}

describe.skipIf(!SHOULD_RUN)("at0368 — sessions named in Gazette prose", () => {
  test(
    "a reserved run is claimed by neither scan, then becomes a citation or plain text",
    async () => {
      const app = await launchTugApp({
        testName: "at0368-gazette-session-citations",
      });
      try {
        await app.nativeKey("g", ["cmd", "ctrl"]);
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(CARD)}) !== null`,
          { timeoutMs: 10_000 },
        );

        // One post naming three things: a session the ledger will hold, a
        // look-alike it will not, and a real file. All three are shaped alike
        // enough to contend.
        const post = {
          id: 9201,
          at_ms: 1_754_600_000_000,
          author: "reporter",
          body: `Session ${PROJECT}/${HELD} finished its turn while ${PROJECT}/${MISSING} sat idle; both touched tugdeck/src/lib/gazette-store.ts today.`,
          // A ref is what makes the card acquire this post's workspace
          // (`useGazetteRefRoots`), and the workspace is what mints the path
          // and commit resolvers the annotation context runs on. Without one
          // the post's prose has nothing to resolve against.
          refs: [{ kind: "file", target: "tugdeck/src/lib/gazette-store.ts" }],
          project_dir: REPO_ROOT,
        };
        expect(
          await app.evalJS<boolean>(
            `window.__tug.publishGazettePost(${JSON.stringify(JSON.stringify(post))})`,
          ),
        ).toBe(true);

        // ---- 1. Reserved: the path resolves, the sessions do not yet. ----
        await app.waitForCondition<boolean>(
          `(function () {
            var body = document.querySelector(${JSON.stringify(BODY)});
            return body !== null
              && body.querySelector('[data-tug-annotation="file-path"]') !== null;
          })()`,
          { timeoutMs: 25_000 },
        );
        const pending = await app.evalJS<Runs>(RUNS_JS);
        note("while the ledger is being asked", JSON.stringify(pending));
        // Neither session run is marked — and crucially neither is a
        // `file-path`, which is what the path scan would have made of a
        // `project/callsign` token had the reservation not held the run.
        expect(pending.held).toBeNull();
        expect(pending.missing).toBeNull();
        // The real path was never in contention and resolved normally.
        expect(pending.path?.kind).toBe("file-path");
        // Every character is still on screen: a reservation marks nothing and
        // changes nothing.
        expect(pending.text).toContain(`${PROJECT}/${HELD}`);
        expect(pending.text).toContain(`${PROJECT}/${MISSING}`);

        // ---- 2 & 3. The ledger answers: one session, one miss. ----
        await app.evalJS<unknown>(resolveSessions());

        // Waited on the CHIP rather than on the mark: the mark is the
        // annotator's layout pass, the chip is the React commit that follows
        // it, and asserting between the two is a race the mark always wins.
        await app.waitForCondition<boolean>(
          `(function () {
            var body = document.querySelector(${JSON.stringify(BODY)});
            return body !== null
              && body.querySelector('[data-tug-annotation="session"] [data-slot="tug-session-identity"]') !== null;
          })()`,
          { timeoutMs: 15_000 },
        );
        const settled = await app.evalJS<Runs>(RUNS_JS);
        note("after the ledger answered", JSON.stringify(settled));

        // The held session is a citation, carrying the FULL id however the
        // prose spelled it, with the live chip portaled into the run.
        expect(settled.held?.kind).toBe("session");
        expect(settled.held?.target).toBe(SESSION_ID);
        expect(settled.held?.chip).toBe(true);

        // The look-alike is nothing at all — not a chip, not a slashed one,
        // not a path. Just words.
        expect(settled.missing).toBeNull();
        expect(settled.text).toContain(`${PROJECT}/${MISSING}`);

        // And the path is still a path: a session scan that stole path runs
        // would show here.
        expect(settled.path?.kind).toBe("file-path");
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
