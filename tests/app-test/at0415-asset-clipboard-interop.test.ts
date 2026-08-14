/**
 * at0415-asset-clipboard-interop.test.ts — copying an attachment from one
 * document into another brings the file with it, whatever kind of file it is.
 *
 * ## What this pins
 *
 * A markdown link is relative to the document holding it, so a link copied into
 * a document in a different directory is a link to nothing unless the *file*
 * travels too. The copy therefore rides with a sidecar carrying each
 * attachment's absolute path, and the paste copies the bytes into the
 * destination's own `assets/` before rewriting the link.
 *
 * Two things had to be true for that to work at all, and both were false:
 *
 *   1. A ⌘C is a `routing: "native"` command, so what runs is the editor's DOM
 *      copy handler — and a custom MIME type set on `clipboardData` does not
 *      survive WebKit's pasteboard normalization. The sidecar has to be written
 *      to the native pasteboard from that handler or it never arrives.
 *   2. The paste reads the source file back over HTTP, and the route it used
 *      served only the handful of types a viewer card renders. A `.txt`
 *      attachment could be written and never read, so copying one did nothing
 *      and said nothing.
 *
 * So this drives the whole round trip against real files: a real selection made
 * with real keys, a real copy through the real pasteboard bridge, a real paste
 * in a second document in a different directory, and the bytes on disk at the
 * end compared to the bytes at the start.
 *
 * The gestures are the DOM `copy` / `paste` events rather than ⌘C / ⌘V because
 * those keystrokes are performed by AppKit against the web view — the DOM event
 * *is* the code path they run, and it is the one an editor in this harness can
 * be made to receive.
 *
 * @covers tugdeck/src/components/tugways/tug-text-card-editor/asset-clipboard.ts
 * @covers tugdeck/src/components/tugways/tug-text-editor/clipboard-filters.ts
 * @covers tugdeck/src/lib/file-kinds.ts
 * @covers tugdeck/src/lib/attachment-upload.ts
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { launchTugApp, type App } from "./_harness";

const SHOULD_RUN = process.env.TUGAPP_APP_TEST === "1";

const TEST_TIMEOUT_MS = 120_000;

/** A real PNG already in the tree — real bytes, not a canvas approximation. */
const REPO_PNG_FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "resources",
  "AppIcon-1024b.png",
);

/**
 * The attachments the source document carries — one of every shape that
 * matters. `notes.txt` and `bundle.zip` are the ones the old read route
 * refused; `shown.png` is the one that always worked, kept so a regression
 * that breaks images is caught by the same test.
 */
const ATTACHMENTS = [
  { name: "shown.png", markdown: "![shown](assets/shown.png)" },
  { name: "notes.txt", markdown: "[notes](assets/notes.txt)" },
  { name: "bundle.zip", markdown: "[bundle](assets/bundle.zip)" },
] as const;

function contentSelector(cardId: string): string {
  return `[data-card-id="${cardId}"] [data-slot="tug-text-card-editor"] .cm-content`;
}

function deckShape() {
  return {
    cards: [
      { id: "A", componentId: "text", title: "source.md", closable: true },
      { id: "B", componentId: "text", title: "target.md", closable: true },
    ],
    panes: [
      {
        id: "p1",
        position: { x: 20, y: 30 },
        size: { width: 600, height: 300 },
        cardIds: ["A"],
        activeCardId: "A",
        title: "",
        acceptsFamilies: ["standard"],
      },
      // Stacked rather than side by side: both editors have to be visible to
      // be clicked, and a stack fits a narrower window than a row does.
      {
        id: "p2",
        position: { x: 20, y: 360 },
        size: { width: 600, height: 300 },
        cardIds: ["B"],
        activeCardId: "B",
        title: "",
        acceptsFamilies: ["standard"],
      },
    ],
    activePaneId: "p1",
    hasFocus: true,
  };
}

/** The editor's whole document, read off CM6's rendered lines. */
function docText(app: App, cardId: string): Promise<string> {
  return app.evalJS<string>(
    `Array.from(document.querySelectorAll(${JSON.stringify(
      `${contentSelector(cardId)} .cm-line`,
    )})).map(function(l){ return l.textContent || ""; }).join("\\n")`,
  );
}

/**
 * Select the whole of `cardId`'s document with real keys.
 *
 * Deliberately not ⌘A: Select All is native-routed, and an editor cannot be
 * made the leaf of this harness's responder chain, so it never reaches CM6.
 * ⌘↑ / ⇧⌘↓ are ordinary CM6 keybindings and move CM6's own selection state —
 * which is the state the copy handler reads.
 */
async function selectAllByKeys(app: App, cardId: string): Promise<void> {
  await app.click(contentSelector(cardId));
  await app.nativeKey("ArrowUp", ["cmd"]);
  await app.nativeKey("ArrowDown", ["cmd", "shift"]);
}

/** Dispatch a DOM `copy` / `paste` on a card's editor — the real handler. */
async function dispatchClipboardEvent(
  app: App,
  cardId: string,
  type: "copy" | "paste",
): Promise<void> {
  await app.evalJS<null>(
    `(function(){
      var host = document.querySelector(${JSON.stringify(contentSelector(cardId))});
      host.dispatchEvent(new ClipboardEvent(${JSON.stringify(type)}, {
        bubbles: true,
        cancelable: true,
      }));
      return null;
    })()`,
  );
}

describe.skipIf(!SHOULD_RUN)(
  "at0415: an attachment copied between documents brings its file along",
  () => {
    test(
      "every attachment kind survives the copy, and the bytes match",
      async () => {
        const root = fs.realpathSync(
          fs.mkdtempSync(path.join(os.tmpdir(), "at0415-")),
        );
        // Two documents in DIFFERENT directories — the whole point. A relative
        // link that happened to resolve in both would prove nothing.
        const sourceDir = path.join(root, "source");
        const targetDir = path.join(root, "target");
        fs.mkdirSync(path.join(sourceDir, "assets"), { recursive: true });
        fs.mkdirSync(targetDir, { recursive: true });

        fs.copyFileSync(
          REPO_PNG_FIXTURE,
          path.join(sourceDir, "assets", "shown.png"),
        );
        fs.writeFileSync(
          path.join(sourceDir, "assets", "notes.txt"),
          "Plain text, which the read route used to refuse.\n",
          "utf8",
        );
        // Real binary bytes, including a NUL and a high byte — anything that
        // round-tripped through a text writer would come back mangled.
        const zipBytes = Buffer.from([
          0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x10, 0x00, 0x41, 0x42, 0x00,
          0xfe, 0x7f, 0x80, 0x01,
        ]);
        fs.writeFileSync(path.join(sourceDir, "assets", "bundle.zip"), zipBytes);

        const sourceDoc = path.join(sourceDir, "source.md");
        const targetDoc = path.join(targetDir, "target.md");
        fs.writeFileSync(
          sourceDoc,
          `SEEDED ${ATTACHMENTS.map((a) => a.markdown).join(" ")}\n`,
          "utf8",
        );
        fs.writeFileSync(targetDoc, "TARGET\n", "utf8");

        try {
          const app = await launchTugApp({ testName: "at0415-asset-interop" });
          try {
            await app.seedDeckState({
              state: deckShape(),
              cardStates: {
                A: {
                  content: {
                    path: sourceDoc,
                    anchor: { line: 1, ch: 0 },
                    scrollTop: 0,
                  },
                },
                B: {
                  content: {
                    path: targetDoc,
                    anchor: { line: 1, ch: 0 },
                    scrollTop: 0,
                  },
                },
              },
              focusCardId: "A",
            });
            for (const [cardId, marker] of [
              ["A", "SEEDED"],
              ["B", "TARGET"],
            ] as const) {
              await app.waitForCondition<boolean>(
                `(function(){
                  var el = document.querySelector(${JSON.stringify(contentSelector(cardId))});
                  return el !== null && el.innerText.indexOf(${JSON.stringify(marker)}) !== -1;
                })()`,
                { timeoutMs: 15_000 },
              );
            }

            // ── Copy the source document, attachments and all ──────────────
            await selectAllByKeys(app, "A");
            await dispatchClipboardEvent(app, "A", "copy");

            // Nothing asserts on the pasteboard directly, and nothing needs
            // to: the paste below reads the sidecar *only* through the native
            // bridge. If the copy handler had left it on `clipboardData` — the
            // bug — there would be nothing there to find, and the paste would
            // fall through to plain text. A passing paste is the proof.

            // ── Paste it into the document next door ───────────────────────
            await app.click(contentSelector("B"));
            await app.nativeKey("ArrowDown", ["cmd"]);
            await dispatchClipboardEvent(app, "B", "paste");

            // Every attachment lands beside the TARGET document, under its own
            // name — not the source's path, and not a UUID.
            const targetAssets = path.join(targetDir, "assets");
            const landedPaths = ATTACHMENTS.map((a) =>
              path.join(targetAssets, a.name),
            );
            // The write is a real HTTP round trip per file, so wait for the
            // whole set rather than asserting into the middle of it.
            const deadline = Date.now() + 30_000;
            while (
              !landedPaths.every((p) => fs.existsSync(p)) &&
              Date.now() < deadline
            ) {
              await new Promise((resolve) => setTimeout(resolve, 200));
            }

            for (const attachment of ATTACHMENTS) {
              const landed = path.join(targetAssets, attachment.name);
              expect(
                fs.existsSync(landed),
                `${attachment.name} must land in the target's assets`,
              ).toBe(true);

              // Byte-identical. A read that went through a text route, or that
              // stored the strip's downsample instead of the original, would
              // produce a file that looks fine and is not the user's.
              expect(
                fs
                  .readFileSync(landed)
                  .equals(
                    fs.readFileSync(
                      path.join(sourceDir, "assets", attachment.name),
                    ),
                  ),
                `${attachment.name} must be byte-identical to the original`,
              ).toBe(true);
            }

            // ── And the document says so ───────────────────────────────────
            const pasted = await docText(app, "B");
            // Rewritten to the destination's own relative links, and labelled
            // with the name the file actually got.
            expect(pasted).toContain("![shown.png](assets/shown.png)");
            expect(pasted).toContain("[notes.txt](assets/notes.txt)");
            expect(pasted).toContain("[bundle.zip](assets/bundle.zip)");

            // The source is untouched — a copy is not a move.
            for (const attachment of ATTACHMENTS) {
              expect(
                fs.existsSync(path.join(sourceDir, "assets", attachment.name)),
              ).toBe(true);
            }
          } finally {
            await app.close();
          }
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      },
      TEST_TIMEOUT_MS,
    );
  },
);
