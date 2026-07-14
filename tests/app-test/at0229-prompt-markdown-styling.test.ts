/**
 * at0229-prompt-markdown-styling — light markdown text styling in the
 * prompt entry, driven through the real app.
 *
 * Exercises the shared `markdownTextStyling` capability on `TugTextEditor`
 * as it reaches `TugPromptEntry`:
 *
 *   1. On the `❯` (Code / prose) route, markdown tokens are subtly styled
 *      — heading and strong render bold, emphasis italic, inline code
 *      recolored — while every raw marker (`#`, `**`, `*`, `` ` ``) stays
 *      in the document and on screen. Styling only; syntax is never
 *      removed.
 *   2. A markdown list line carries the hanging-indent line decoration
 *      (`text-indent`/`padding-left`), bundled with the grammar so it is
 *      present whenever markdown styling is on (visible under soft wrap).
 *   3. Switching to the `$` (Shell) route drops the styling entirely: the
 *      same text renders plain, and the list line's indent decoration is
 *      gone. Shell input is not markdown.
 *   4. The excluded markdown editing keymap never installs: on the `❯`
 *      route (Return = newline), `- item` + Return yields `"- item\n"`,
 *      NOT `"- item\n- "`. This proves `insertNewlineContinueMarkup` from
 *      the default `markdown()` bundle is absent — verified session-free
 *      (no submit route is driven, so no real turn is dispatched).
 *
 * Surface: `gallery-prompt-entry` (composes the real `TugPromptEntry`), so
 * no live Claude session is needed. Gating: `describe.skipIf(!SHOULD_RUN)`.
 */

import { describe, expect, test } from "bun:test";
import { launchTugApp, type App } from "./_harness";
import {
  mkTempTugbank,
  rmTempTugbank,
  seedTugbankForLaunch,
} from "./_harness/tugbank-helpers";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const TEST_TIMEOUT_MS = 90_000;

const EDITOR_SELECTOR = '[data-slot="tug-text-editor"] .cm-content';
const CONTENT_SELECTOR = `[data-card-id="A"] ${EDITOR_SELECTOR}`;

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "gallery-prompt-entry", title: "Prompt A", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 40, y: 40 },
        size: { width: 720, height: 540 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["maker"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

async function focusEditor(app: App): Promise<void> {
  await app.nativeClickAtElement(CONTENT_SELECTOR);
  await app.waitForCondition<boolean>(
    `document.activeElement !== null && document.activeElement.matches(${JSON.stringify(CONTENT_SELECTOR)})`,
    { timeoutMs: 2000 },
  );
  await new Promise((r) => setTimeout(r, 100));
}

async function typeChunked(app: App, text: string): Promise<void> {
  const TYPING_CHUNK_SIZE = 8;
  const TYPING_CHUNK_DELAY_MS = 60;
  for (let offset = 0; offset < text.length; offset += TYPING_CHUNK_SIZE) {
    await app.nativeType(text.slice(offset, offset + TYPING_CHUNK_SIZE));
    await new Promise((r) => setTimeout(r, TYPING_CHUNK_DELAY_MS));
  }
}

// ---- Route popup mechanics (mirrors at0050) ----

const ROUTE_TRIGGER_SELECTOR =
  '[data-card-id="A"] .tug-prompt-entry-toolbar button[aria-label="Route"]';
const ROUTE_LABEL_SELECTOR = `${ROUTE_TRIGGER_SELECTOR} [data-tug-stable="active"]`;

const LABEL_BY_ROUTE: Record<string, string> = {
  "❯": "Code",
  $: "Shell",
};

/** Open the route popup and pick `routeValue`, waiting until the label takes. */
async function selectRoute(app: App, routeValue: string): Promise<void> {
  const label = LABEL_BY_ROUTE[routeValue];
  expect(label, `unknown route value ${routeValue}`).toBeDefined();
  await app.click(ROUTE_TRIGGER_SELECTOR);
  await app.click(`.tug-menu-item[data-item-id="${routeValue}"]`);
  await app.waitForCondition<boolean>(
    `(function(){
      var lbl = document.querySelector(${JSON.stringify(ROUTE_LABEL_SELECTOR)});
      return lbl !== null && lbl.textContent.trim() === ${JSON.stringify(label!)};
    })()`,
    { timeoutMs: 4000 },
  );
}

// ---- Token style inspection ----

interface TokenStyle {
  fontWeight: string;
  fontStyle: string;
  color: string;
}

/**
 * Computed style of the innermost `.cm-content` element whose text contains
 * `needle`. Returns null if not found (e.g. before the grammar loads and
 * the token spans are minted).
 */
async function tokenStyle(app: App, needle: string): Promise<TokenStyle | null> {
  return app.evalJS<TokenStyle | null>(
    `(function(){
      var content = document.querySelector(${JSON.stringify(CONTENT_SELECTOR)});
      if (!content) return null;
      var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walker.nextNode())) {
        if (node.textContent.indexOf(${JSON.stringify(needle)}) !== -1) {
          var el = node.parentElement;
          if (!el) return null;
          var cs = getComputedStyle(el);
          return { fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, color: cs.color };
        }
      }
      return null;
    })()`,
  );
}

/** Inline `style` attribute of the `.cm-line` whose text starts with `prefix`. */
async function lineStyle(app: App, prefix: string): Promise<string | null> {
  return app.evalJS<string | null>(
    `(function(){
      var content = document.querySelector(${JSON.stringify(CONTENT_SELECTOR)});
      if (!content) return null;
      var lines = content.querySelectorAll(".cm-line");
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].textContent.indexOf(${JSON.stringify(prefix)}) === 0) {
          return lines[i].getAttribute("style");
        }
      }
      return null;
    })()`,
  );
}

/** Live document text straight from the engine ([Q07] single-draft shape). */
async function docText(app: App): Promise<string | null> {
  return app.evalJS<string | null>(
    `(function(){
      var s = window.__tug.getEmCardState("A");
      return s !== null && typeof s.text === "string" ? s.text : null;
    })()`,
  );
}

function weight(w: string): number {
  return w === "normal" ? 400 : w === "bold" ? 700 : parseInt(w, 10) || 400;
}

// Unique needles so a TreeWalker lands on exactly one token run.
const HEAD = "HeadingZ";
const STRONG = "boldZ";
const EM = "emZ";
const CODE = "codeZ";
const PLAIN = "betaQ";
const LIST_PREFIX = "- itemZ";

describe.skipIf(!SHOULD_RUN)(
  "at0229: prompt-entry markdown text styling",
  () => {
    test(
      "prose route styles markdown (syntax preserved); shell route plain; no continue-list keymap",
      async () => {
        const tugbankPath = mkTempTugbank();
        try {
          seedTugbankForLaunch(tugbankPath);

          const app = await launchTugApp({
            testName: "at0229-prompt-markdown-styling",
            env: { TUGBANK_PATH: tugbankPath },
            persistInTestMode: true,
          });

          try {
            await app.enableDeckTrace(true);
            await app.seedDeckState({
              state: deckShape(),
              cardStates: {},
              focusCardId: "A",
            });
            await app.waitForCondition<boolean>(
              `(typeof window.__tug !== "undefined") && window.__tug.assertHostRootRegistered("A")`,
            );
            await app.awaitEngineReady("A");
            await focusEditor(app);

            // ---- Phase 1: prose route (❯) styles markdown tokens ----
            // Heading on its own line; strong / emphasis / inline-code on a
            // second line with a plain word (betaQ) as the unstyled baseline.
            // Return = newline on the ❯ route.
            await typeChunked(app, `# ${HEAD}`);
            await app.nativeKey("Return");
            await typeChunked(app, `${PLAIN} **${STRONG}** *${EM}* \`${CODE}\``);

            // Grammar lazy-loads; wait until the strong token actually paints
            // bold (proves the chunk resolved AND the compartment reconfigured).
            await app.waitForCondition<boolean>(
              `(function(){
                var content = document.querySelector(${JSON.stringify(CONTENT_SELECTOR)});
                if (!content) return false;
                var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null);
                var node;
                while ((node = walker.nextNode())) {
                  if (node.textContent.indexOf(${JSON.stringify(STRONG)}) !== -1) {
                    var w = getComputedStyle(node.parentElement).fontWeight;
                    return w === "bold" || parseInt(w, 10) >= 600;
                  }
                }
                return false;
              })()`,
              { timeoutMs: 8000 },
            );

            const headStyled = await tokenStyle(app, HEAD);
            const strongStyled = await tokenStyle(app, STRONG);
            const emStyled = await tokenStyle(app, EM);
            const plainStyled = await tokenStyle(app, PLAIN);
            const codeStyled = await tokenStyle(app, CODE);

            expect(headStyled, "heading token found").not.toBeNull();
            expect(weight(headStyled!.fontWeight)).toBeGreaterThanOrEqual(600);
            expect(weight(strongStyled!.fontWeight)).toBeGreaterThanOrEqual(600);
            expect(emStyled!.fontStyle).toBe("italic");
            // Plain word stays a normal-weight, upright baseline.
            expect(weight(plainStyled!.fontWeight)).toBe(400);
            expect(plainStyled!.fontStyle).toBe("normal");
            // Inline code is recolored away from the plain text color.
            expect(codeStyled!.color).not.toBe(plainStyled!.color);

            // Syntax is never removed: raw markers live in the document...
            const styledDoc = await docText(app);
            expect(styledDoc).toContain(`# ${HEAD}`);
            expect(styledDoc).toContain(`**${STRONG}**`);
            expect(styledDoc).toContain(`*${EM}*`);
            expect(styledDoc).toContain(`\`${CODE}\``);
            // ...and on screen (the `.cm-content` renders them verbatim).
            const visibleMarkers = await app.evalJS<boolean>(
              `(function(){
                var content = document.querySelector(${JSON.stringify(CONTENT_SELECTOR)});
                var t = content ? content.textContent : "";
                return t.indexOf("**${STRONG}**") !== -1 && t.indexOf("# ${HEAD}") !== -1;
              })()`,
            );
            expect(visibleMarkers, "raw markdown markers stay visible").toBe(true);

            // ---- Phase 2: markdown list hanging indent ----
            // Blank line first so the bullet opens its own list block
            // (a bullet abutting the paragraph above is parsed as lazy
            // paragraph text, not a ListItem, so no ListMark node).
            await app.nativeKey("Return");
            await app.nativeKey("Return");
            await typeChunked(app, `${LIST_PREFIX} one two three`);
            await app.waitForCondition<boolean>(
              `(function(){
                var content = document.querySelector(${JSON.stringify(CONTENT_SELECTOR)});
                if (!content) return false;
                var lines = content.querySelectorAll(".cm-line");
                for (var i = 0; i < lines.length; i++) {
                  if (lines[i].textContent.indexOf(${JSON.stringify(LIST_PREFIX)}) === 0) {
                    // WebKit normalizes the style attribute with spaces
                    // (\`text-indent: -2ch\`); strip whitespace before matching.
                    var st = (lines[i].getAttribute("style") || "").replace(/\\s/g, "");
                    return st.indexOf("text-indent:-") !== -1;
                  }
                }
                return false;
              })()`,
              { timeoutMs: 4000 },
            );
            const listStyled = (await lineStyle(app, LIST_PREFIX)) ?? "";
            const listStyledNorm = listStyled.replace(/\s/g, "");
            expect(listStyledNorm, "list line carries a hanging-indent decoration").toContain(
              "text-indent:-",
            );
            expect(listStyledNorm).toContain("padding-left:");

            // ---- Phase 3: shell route ($) drops styling ----
            await selectRoute(app, "$");
            await app.waitForCondition<boolean>(
              `(function(){
                var content = document.querySelector(${JSON.stringify(CONTENT_SELECTOR)});
                if (!content) return false;
                var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null);
                var node;
                while ((node = walker.nextNode())) {
                  if (node.textContent.indexOf(${JSON.stringify(STRONG)}) !== -1) {
                    var w = getComputedStyle(node.parentElement).fontWeight;
                    return !(w === "bold" || parseInt(w, 10) >= 600);
                  }
                }
                return false;
              })()`,
              { timeoutMs: 4000 },
            );
            const strongPlain = await tokenStyle(app, STRONG);
            const headPlain = await tokenStyle(app, HEAD);
            expect(weight(strongPlain!.fontWeight)).toBe(400);
            expect(weight(headPlain!.fontWeight)).toBe(400);
            // The hanging-indent decoration is gone with the grammar.
            const listPlain = await lineStyle(app, LIST_PREFIX);
            const listPlainNorm = (listPlain ?? "").replace(/\s/g, "");
            expect(listPlainNorm.includes("text-indent:-")).toBe(false);

            // ---- Phase 4: no continue-list keymap (session-free) ----
            // Back on ❯ (Return = newline). Clear, type a list line, press
            // Return. If the excluded markdownKeymap were installed,
            // insertNewlineContinueMarkup would append "- "; it must not.
            await selectRoute(app, "❯");
            await focusEditor(app);
            await app.nativeKey("a", ["cmd"]);
            await app.nativeKey("Delete");
            await app.waitForCondition<boolean>(
              `(function(){ var s = window.__tug.getEmCardState("A"); return s !== null && s.text === ""; })()`,
              { timeoutMs: 2000 },
            );
            await typeChunked(app, "- item");
            await app.nativeKey("Return");
            await app.waitForCondition<boolean>(
              `(function(){ var s = window.__tug.getEmCardState("A"); return s !== null && s.text === "- item\\n"; })()`,
              { timeoutMs: 2000 },
            );
            const afterReturn = await docText(app);
            expect(afterReturn, "Return is a plain newline — no list continuation").toBe(
              "- item\n",
            );
          } finally {
            await app.close();
          }
        } finally {
          rmTempTugbank(tugbankPath);
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
