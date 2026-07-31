/**
 * at9997-scratch-snippet-heavy-deck.test.ts — SCRATCH probe. What does a
 * discrete mutation cost on a loaded deck, and how much of the snippet-open
 * bill is the stylesheet's `:has()` rules?
 *
 * Rebuilds the release deck shape (three transcript-bearing session cards,
 * the Lens pinned right, five-up) and runs three experiments:
 *
 *   1. Bare-mutation pricing — a plain div into the Lens, a plain div into a
 *      transcript, a junk attribute on <html>, each followed by a forced
 *      read. Distinguishes "any mutation pays" from "this gesture pays".
 *   2. A `div.snippet-editor` decoy — flips the `.lens-sections:has(...)`
 *      anchors with no React, no CodeMirror, no focus machinery.
 *   3. The real Return gesture, timed ×3, before and after scrubbing `:has()`
 *      rules from the live stylesheets (AT9997_SCRUB=all|md|lens).
 *
 * Not a regression test — a stopwatch. Delete when the question is answered.
 *
 * @covers tugdeck/src/components/lens/sections/snippets-section.tsx
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchTugApp, type App } from "./_harness";
import { mkTempTugbank, seedTugbankForLaunch } from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";
const TEST_TIMEOUT_MS = 480_000;

const FEED_CODE_OUTPUT = 0x40;

/** Transcript blocks pushed into EACH session card. */
const BLOCKS_PER_SESSION = Number(process.env.AT9997_BLOCKS ?? "40");
/** Which :has() rules to scrub before the second gesture pass. */
const SCRUB = process.env.AT9997_SCRUB ?? "all";
/** Session cards on the deck. */
const SESSIONS = ["A", "B", "C"] as const;

const SNIPPETS_KBD = `.lens-content .lens-snippets-list[data-key-view-kbd]`;
const EDITOR = `.lens-snippets-list .snippet-editor`;

const TEXTS = [
  "walk me through whether 2027 is a prime number or not",
  "render the quadratic formula, along with a description of the terms",
  "list out maxwell's functions (in derivative form)",
  "count the number of lines of code with tokei",
  "ask me some questions to guide the process",
  "make a task list to write a c program to multiply matrices",
  "run a bash command: find . -type f | head -300",
  "ask me a single question about the codebase",
  "Let's audit the implementation work on the dash worktree for:",
  "which bun",
  "write me a haiku about summertime",
];

/** A chunk of markdown prose with enough structure to build real transcript
 *  DOM — headings, a list, inline code, a fenced block. */
function blockText(session: string, n: number): string {
  return [
    `## ${session} — step ${n}`,
    "",
    `Working through the ${n}th stage of the imposition. The band is measured`,
    "from the canvas, not observed, so `calc()` re-resolves on reflow.",
    "",
    "- the pin is the width on a right-side deck",
    "- every horizontal pin is emitted as `left`",
    "- a kind is a slot count and nothing else",
    "",
    "```ts",
    `const offset = ${n} / (N - 1) * Math.max(0, band - w);`,
    "```",
    "",
    "That is the whole of the rule.",
  ].join("\n");
}

function deckShape() {
  const pane = (id: string, slot: number, cardId: string) => ({
    id,
    position: { x: 40, y: 40 },
    size: { width: 800, height: 1100 },
    cardIds: [cardId],
    activeCardId: cardId,
    title: "",
    acceptsFamilies: ["standard"],
    slot,
  });
  return {
    cards: [
      ...SESSIONS.map((id) => ({
        id,
        componentId: "session",
        title: "",
        closable: true,
      })),
      { id: "L", componentId: "lens", title: "Lens", closable: true },
    ],
    panes: [
      ...SESSIONS.map((id, i) => pane(`p${i}`, i, id)),
      {
        id: "pLens",
        position: { x: 0, y: 0 },
        size: { width: 380, height: 1200 },
        cardIds: ["L"],
        activeCardId: "L",
        title: "Lens",
        acceptsFamilies: [],
      },
    ],
    activePaneId: "p0",
    imposition: { kind: "five-up", lens: "right" },
    hasFocus: true,
  };
}

/** How much document there is to walk — the number the timings should be read
 *  against. */
const WEIGHT = `(function () {
  return {
    nodes: document.getElementsByTagName("*").length,
    mdBlocks: document.querySelectorAll(".tugx-md-block").length,
    animations: document.getAnimations().length,
  };
})()`;

/** Price a set of bare DOM mutations: mutate, force a read, undo, force a
 *  read. A warm read before each rep flushes anything already pending, so
 *  `flush` prices exactly the mutation's own invalidation. */
const MUTATION_PROBES = `(function () {
  var out = {};
  function price(name, mutate, undo) {
    var reps = [];
    for (var i = 0; i < 3; i += 1) {
      void document.body.getBoundingClientRect();
      var t0 = performance.now();
      mutate();
      var t1 = performance.now();
      void document.body.getBoundingClientRect();
      var t2 = performance.now();
      undo();
      void document.body.getBoundingClientRect();
      reps.push(Math.round((t2 - t1) * 10) / 10);
      void t0; void t1;
    }
    out[name] = reps;
  }
  var lens = document.querySelector(".lens-content");
  var list = document.querySelector(".lens-snippets-list");
  var entry = document.querySelector(".tug-transcript-entry");
  var transcriptHost = entry === null ? null : entry.parentElement;
  var el = null;
  if (lens !== null) {
    price("plainDivInLens", function () {
      el = document.createElement("div");
      el.textContent = "probe";
      lens.appendChild(el);
    }, function () { el.remove(); });
  }
  if (list !== null) {
    price("editorClassDecoy", function () {
      el = document.createElement("div");
      el.className = "snippet-editor";
      el.textContent = "probe";
      list.appendChild(el);
    }, function () { el.remove(); });
  }
  if (transcriptHost !== null) {
    price("plainDivInTranscript", function () {
      el = document.createElement("div");
      el.textContent = "probe";
      transcriptHost.appendChild(el);
    }, function () { el.remove(); });
  }
  price("rootAttrFlip", function () {
    document.documentElement.setAttribute("data-perf-probe", "1");
  }, function () {
    document.documentElement.removeAttribute("data-perf-probe");
  });
  price("styleSheetInsert", function () {
    el = document.createElement("style");
    el.textContent = ".zz-perf-probe { color: red; }";
    document.head.appendChild(el);
  }, function () { el.remove(); });
  price("bodyPaddingToggle", function () {
    document.body.style.paddingBottom = "1px";
  }, function () {
    document.body.style.paddingBottom = "";
  });
  var cmStyle = null;
  var heads = document.head.querySelectorAll("style");
  for (var i2 = 0; i2 < heads.length; i2 += 1) {
    if (heads[i2].textContent.indexOf(".cm-") !== -1) { cmStyle = heads[i2]; break; }
  }
  if (cmStyle !== null) {
    var cmText = cmStyle.textContent;
    price("cmStyleIdenticalRewrite", function () {
      cmStyle.textContent = cmText;
    }, function () {});
  }
  return out;
})()`;

/** Delete :has() rules from every live stylesheet. Scope: "all" kills every
 *  rule whose selector mentions :has(, "md" only the markdown-view ones,
 *  "lens" only the lens-* ones. Returns how many rules died. */
function scrubScript(scope: string): string {
  return `(function () {
    var scope = ${JSON.stringify(scope)};
    var killed = 0;
    function wants(sel) {
      if (sel.indexOf(":has(") === -1) return false;
      if (scope === "md") return sel.indexOf("tugx-md-block") !== -1;
      if (scope === "lens") return sel.indexOf("lens-") !== -1;
      return true;
    }
    function scrub(owner) {
      var rules = owner.cssRules;
      for (var i = rules.length - 1; i >= 0; i -= 1) {
        var r = rules[i];
        if (r.cssRules !== undefined && r.cssRules !== null && r.cssRules.length > 0) {
          scrub(r);
        }
        if (typeof r.selectorText === "string" && wants(r.selectorText)) {
          owner.deleteRule(i);
          killed += 1;
        }
      }
    }
    for (var s = 0; s < document.styleSheets.length; s += 1) {
      try { scrub(document.styleSheets[s]); } catch (e) {}
    }
    return killed;
  })()`;
}

const ARM = `(function () {
  window.__p = { key: null, mount: null, paint: null, focus: null };
  var p = window.__p;
  if (window.__rectPatch === undefined) {
    var orig = Element.prototype.getBoundingClientRect;
    window.__rectPatch = { count: 0, ms: 0 };
    Element.prototype.getBoundingClientRect = function () {
      var lp = window.__p;
      if (lp === undefined || lp.key === null || lp.focus !== null) {
        return orig.apply(this, arguments);
      }
      var t = performance.now();
      var r = orig.apply(this, arguments);
      window.__rectPatch.ms += performance.now() - t;
      window.__rectPatch.count += 1;
      return r;
    };
  }
  window.__rectPatch.count = 0;
  window.__rectPatch.ms = 0;
  window.__mutLog = {};
  window.__cssOps = 0;
  if (window.__cssPatch === undefined) {
    window.__cssPatch = true;
    var ir = CSSStyleSheet.prototype.insertRule;
    var dr = CSSStyleSheet.prototype.deleteRule;
    CSSStyleSheet.prototype.insertRule = function () {
      var lp = window.__p;
      if (lp !== undefined && lp.key !== null && lp.focus === null) window.__cssOps += 1;
      return ir.apply(this, arguments);
    };
    CSSStyleSheet.prototype.deleteRule = function () {
      var lp = window.__p;
      if (lp !== undefined && lp.key !== null && lp.focus === null) window.__cssOps += 1;
      return dr.apply(this, arguments);
    };
  }
  window.addEventListener("keydown", function () {
    if (p.key === null) p.key = performance.now();
  }, true);
  var describe = function (n) {
    if (n.nodeType !== 1) return n.nodeName;
    var cls = typeof n.className === "string" ? n.className : "";
    return n.tagName + (cls === "" ? "" : "." + cls.split(" ").slice(0, 2).join("."));
  };
  var mo = new MutationObserver(function (records) {
    if (p.key === null || p.focus !== null) return;
    for (var i = 0; i < records.length; i += 1) {
      var m = records[i];
      var t = m.target;
      var inLens = t.nodeType === 1 && t.closest !== undefined &&
        t.closest(".lens-content") !== null;
      var what;
      if (m.type === "attributes") {
        what = describe(t) + " @" + m.attributeName;
      } else {
        var styleKids = 0;
        for (var k = 0; k < m.addedNodes.length; k += 1) {
          var nn = m.addedNodes[k].nodeName;
          if (nn === "STYLE" || nn === "LINK") styleKids += 1;
        }
        what = describe(t) + " +" + m.addedNodes.length + "/-" + m.removedNodes.length +
          (styleKids > 0 ? " STYLE!" : "");
      }
      var key = (inLens ? "lens: " : "OUT: ") + what;
      window.__mutLog[key] = (window.__mutLog[key] || 0) + 1;
    }
    if (p.mount === null &&
        document.querySelector(${JSON.stringify(EDITOR)}) !== null) {
      p.mount = performance.now();
    }
  });
  mo.observe(document.documentElement, {
    subtree: true, childList: true, attributes: true,
  });
  var tick = function () {
    if (p.key !== null) {
      if (p.mount !== null && p.paint === null) p.paint = performance.now();
      if (p.focus === null && document.activeElement !== null &&
          document.activeElement.closest(${JSON.stringify(EDITOR)}) !== null) {
        p.focus = performance.now();
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
})()`;

const READ = `(function () {
  var p = window.__p;
  if (p === undefined || p.key === null) return null;
  var d = function (v) { return v === null ? -1 : Math.round(v - p.key); };
  var rp = window.__rectPatch;
  return { mount: d(p.mount), paint: d(p.paint), focus: d(p.focus),
           rects: rp.count, rectMs: Math.round(rp.ms), cssOps: window.__cssOps };
})()`;

/** Top mutation-log entries recorded between keydown and focus, worst first.
 *  "OUT:" entries are mutations landing outside the Lens subtree. */
const READ_MUT = `(function () {
  var log = window.__mutLog || {};
  var keys = Object.keys(log);
  keys.sort(function (a, b) { return log[b] - log[a]; });
  var out = [];
  for (var i = 0; i < keys.length; i += 1) {
    var k = keys[i];
    if (k.indexOf("OUT: ") === 0 || k.indexOf("STYLE!") !== -1 || out.length < 12) {
      out.push(k + " ×" + log[k]);
    }
    if (out.length >= 40) break;
  }
  return out;
})()`;

/** Arrow baseline: keydown → the next two frames. */
const ARM_ARROW = `(function () {
  window.__a = { key: null, f1: null, f2: null };
  var a = window.__a;
  window.addEventListener("keydown", function () {
    if (a.key === null) {
      a.key = performance.now();
      requestAnimationFrame(function () {
        a.f1 = performance.now();
        requestAnimationFrame(function () { a.f2 = performance.now(); });
      });
    }
  }, true);
  return true;
})()`;

const READ_ARROW = `(function () {
  var a = window.__a;
  if (a === undefined || a.key === null || a.f2 === null) return null;
  return { f1: Math.round(a.f1 - a.key), f2: Math.round(a.f2 - a.key) };
})()`;

interface Timing {
  mount: number;
  paint: number;
  focus: number;
  rects: number;
  rectMs: number;
}

async function timeOpen(app: App): Promise<Timing> {
  await app.evalJS<boolean>(ARM);
  await app.nativeKey("Return");
  await app.waitForCondition<boolean>(
    `(function () { var r = ${READ}; return r !== null && r.focus >= 0; })()`,
    { timeoutMs: 25_000 },
  );
  return app.evalJS<Timing>(READ);
}

async function closeEditor(app: App): Promise<void> {
  await app.nativeKey("Escape");
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(EDITOR)}) === null`,
    { timeoutMs: 10_000 },
  );
  await app.waitForCondition<boolean>(
    `document.querySelector(${JSON.stringify(SNIPPETS_KBD)}) !== null`,
    { timeoutMs: 10_000 },
  );
}

async function openPass(app: App, tag: string): Promise<Timing[]> {
  const runs: Timing[] = [];
  for (let i = 0; i < 3; i += 1) {
    const t = await timeOpen(app);
    console.log(`[at9997] ${tag} open #${i + 1} → ${JSON.stringify(t)}`);
    if (i === 0) {
      const muts = await app.evalJS<string[]>(READ_MUT);
      console.log(`[at9997] ${tag} mutations →\n  ${muts.join("\n  ")}`);
    }
    runs.push(t);
    await closeEditor(app);
  }
  return runs;
}

describe.skipIf(!SHOULD_RUN)("at9997 — snippet open under a heavy deck", () => {
  test(
    "mutation pricing + :has() ablation on the loaded deck",
    async () => {
      const tugbankPath = mkTempTugbank();
      const dir = mkdtempSync(join(tmpdir(), "tug-at9997-"));
      const snippetsPath = join(dir, "snippets.json");
      writeFileSync(
        snippetsPath,
        `${JSON.stringify({
          version: 1,
          snippets: TEXTS.map((text, i) => ({ id: `s${i}`, text })),
        })}\n`,
      );
      seedTugbankForLaunch(tugbankPath);
      const app = await launchTugApp({
        testName: "at9997-scratch-snippet-heavy-deck",
        env: { TUGBANK_PATH: tugbankPath, TUG_SNIPPETS_PATH: snippetsPath },
        persistInTestMode: true,
      });
      try {
        await app.enableDeckTrace(true);
        await app.seedDeckState({ state: deckShape(), focusCardId: "A" });
        for (const id of SESSIONS) {
          await app.waitForCondition<boolean>(
            `window.__tug.assertHostRootRegistered(${JSON.stringify(id)})`,
            { timeoutMs: 8_000 },
          );
        }
        await app.waitForCondition<boolean>(`document.hasFocus()`, {
          timeoutMs: 10_000,
        });

        // Fill each session card with transcript.
        for (const id of SESSIONS) {
          const sid = `at9997-${id}`;
          await app.bindSession(id, { tugSessionId: sid });
          await app.awaitEngineReady(id);
          await app.driveSession(id, { op: "send", text: "go" });
          for (let n = 0; n < BLOCKS_PER_SESSION; n += 1) {
            await app.driveSession(id, {
              op: "ingestFrame",
              feedId: FEED_CODE_OUTPUT,
              decoded: {
                type: "assistant_text",
                tug_session_id: sid,
                msg_id: `${sid}-m${n}`,
                text: blockText(id, n),
                is_partial: false,
                rev: 0,
                seq: n,
              },
            });
          }
        }
        await app.waitForCondition<boolean>(
          `document.querySelectorAll(".tugx-md-block").length >= ${
            SESSIONS.length * BLOCKS_PER_SESSION
          }`,
          { timeoutMs: 30_000 },
        );

        const weight = await app.evalJS<Record<string, number>>(WEIGHT);
        console.log(`[at9997] weight → ${JSON.stringify(weight)}`);

        // Experiment 1+2: bare mutations on the settled deck, no gesture.
        const probes = await app.evalJS<Record<string, number[]>>(
          MUTATION_PROBES,
        );
        console.log(`[at9997] mutation probes → ${JSON.stringify(probes)}`);

        // Land the key view on the snippets list.
        await app.waitForCondition<boolean>(
          `document.querySelectorAll('.snippet-row-label').length === ${TEXTS.length}`,
          { timeoutMs: 10_000 },
        );
        await app.nativeClickAtElement(
          `.lens-section[data-lens-section="snippets"] [data-testid="lens-section-band"] .tool-call-header-name`,
        );
        await app.waitForCondition<boolean>(
          `document.querySelector(${JSON.stringify(SNIPPETS_KBD)}) !== null`,
          { timeoutMs: 8_000 },
        );

        // Arrow baseline in the same document.
        await app.evalJS<boolean>(ARM_ARROW);
        await app.nativeKey("ArrowDown");
        await app.waitForCondition<boolean>(
          `(function () { var r = ${READ_ARROW}; return r !== null; })()`,
          { timeoutMs: 8_000 },
        );
        const arrow = await app.evalJS<Record<string, number>>(READ_ARROW);
        console.log(`[at9997] ArrowDown → ${JSON.stringify(arrow)}`);

        // Experiment 3a: the real gesture, stylesheet intact.
        const before = await openPass(app, "baseline");

        // Scrub :has() rules and price the same mutations and gesture again.
        const killed = await app.evalJS<number>(scrubScript(SCRUB));
        console.log(`[at9997] scrubbed ${killed} :has() rules (scope=${SCRUB})`);
        const probes2 = await app.evalJS<Record<string, number[]>>(
          MUTATION_PROBES,
        );
        console.log(`[at9997] mutation probes post-scrub → ${JSON.stringify(probes2)}`);
        const after = await openPass(app, `scrub=${SCRUB}`);

        console.log(
          `[at9997] summary → baseline focus ${before
            .map((t) => t.focus)
            .join("/")}ms, post-scrub focus ${after
            .map((t) => t.focus)
            .join("/")}ms`,
        );
        expect(before[0].mount).toBeGreaterThanOrEqual(0);
      } finally {
        await app.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
