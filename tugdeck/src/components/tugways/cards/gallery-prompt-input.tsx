/**
 * gallery-prompt-input.tsx -- TugPromptInput gallery card.
 *
 * Testing surface for the tug-prompt-input component. Includes:
 * - Interactive editor with diagnostics and event log
 * - IMG atom spike (read-only reference for new architecture)
 * - Key configuration for Return/Enter
 *
 * Laws of Tug compliance:
 *   [L01] One root.render() at mount — component manages engine internally
 *   [L06] Diagnostics and log are direct DOM writes, no React state
 */

import React, { useRef, useLayoutEffect, useCallback, useState } from "react";
import { TugPromptInput } from "@/components/tugways/tug-prompt-input";
import type { TugTextInputDelegate } from "@/components/tugways/tug-prompt-input";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
import type { AtomSegment, InputAction, CompletionItem } from "@/lib/tug-text-engine";
import "./gallery-prompt-input.css";

// ===================================================================
// Atom-as-image builder (spike)
// ===================================================================

/** Lucide-style icon paths (24x24 viewBox) for atom types */
const ATOM_ICON_PATHS: Record<string, string> = {
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  command: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  doc: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
};

/** Shared canvas for text measurement */
let _measureCanvas: HTMLCanvasElement | null = null;
function measureTextWidth(text: string, font: string): number {
  if (!_measureCanvas) _measureCanvas = document.createElement("canvas");
  const ctx = _measureCanvas.getContext("2d")!;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** Create an atom <img> element with SVG data URI */
function createAtomImgElement(type: string, label: string, value: string): HTMLImageElement {
  const fontSize = 12;
  const fontFamily = "system-ui, sans-serif";
  const textWidth = measureTextWidth(label, `${fontSize}px ${fontFamily}`);
  const iconSize = 12;
  const padding = 6;
  const gap = 4;
  const w = padding + iconSize + gap + Math.ceil(textWidth) + padding;
  const h = 22;

  const iconPath = ATOM_ICON_PATHS[type] ?? ATOM_ICON_PATHS.file;
  const icon = `<g transform="translate(${padding},${(h - iconSize) / 2}) scale(${iconSize / 24})" fill="none" stroke="#8899aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</g>`;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="3" fill="#2a2f3a" stroke="#4a5568" stroke-width="1"/>`,
    icon,
    `<text x="${padding + iconSize + gap}" y="${h / 2 + fontSize * 0.36}" font-size="${fontSize}" font-family="${fontFamily}" fill="#c8d0dc">${label}</text>`,
    `</svg>`,
  ].join("");

  const img = document.createElement("img");
  img.src = "data:image/svg+xml," + encodeURIComponent(svg);
  img.height = h;
  img.style.verticalAlign = "-5px";
  img.dataset.atomType = type;
  img.dataset.atomLabel = label;
  img.dataset.atomValue = value;
  return img;
}

/** Create atom img as HTML string (for initial content / insertHTML) */
function atomImgHTML(type: string, label: string, value?: string): string {
  const el = createAtomImgElement(type, label, value ?? label);
  const wrapper = document.createElement("div");
  wrapper.appendChild(el);
  return wrapper.innerHTML;
}

// ===================================================================
// Sample data
// ===================================================================

const SAMPLE_ATOMS: AtomSegment[] = [
  { kind: "atom", type: "file", label: "src/main.ts", value: "/project/src/main.ts" },
  { kind: "atom", type: "file", label: "README.md", value: "/project/README.md" },
  { kind: "atom", type: "command", label: "/commit", value: "/commit" },
  { kind: "atom", type: "file", label: "src/lib/feed-store.ts", value: "/project/src/lib/feed-store.ts" },
];

const TYPEAHEAD_FILES = [
  "src/main.ts", "src/main.tsx", "src/protocol.ts", "src/connection.ts",
  "src/lib/feed-store.ts", "src/lib/connection-singleton.ts",
  "src/deck-manager.ts", "src/settings-api.ts", "src/action-dispatch.ts",
  "README.md", "package.json", "tsconfig.json",
];

function galleryCompletionProvider(query: string): CompletionItem[] {
  const q = query.toLowerCase();
  const files = q.length === 0
    ? TYPEAHEAD_FILES.slice(0, 8)
    : TYPEAHEAD_FILES.filter(f => f.toLowerCase().includes(q)).slice(0, 8);
  return files.map(f => ({
    label: f,
    atom: { kind: "atom" as const, type: "file", label: f, value: f },
  }));
}

function galleryDropHandler(files: FileList): AtomSegment[] {
  const atoms: AtomSegment[] = [];
  for (let i = 0; i < files.length; i++) {
    const name = files[i].name;
    atoms.push({ kind: "atom", type: "file", label: name, value: name });
  }
  return atoms;
}

const RETURN_CHOICES: TugChoiceItem[] = [
  { value: "submit", label: "Return submits" },
  { value: "newline", label: "Return = newline" },
];

const ENTER_CHOICES: TugChoiceItem[] = [
  { value: "submit", label: "Enter submits" },
  { value: "newline", label: "Enter = newline" },
];



// ===================================================================
// Gallery component
// ===================================================================

export function GalleryPromptInput() {
  const inputRef = useRef<TugTextInputDelegate>(null);
  const diagRef = useRef<HTMLPreElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const nextAtomIdx = useRef(0);
  const [returnAction, setReturnAction] = useState<InputAction>("submit");
  const [enterAction, setEnterAction] = useState<InputAction>("submit");

  // Log — direct DOM write [L06]
  const appendLog = useCallback((msg: string) => {
    const el = logRef.current;
    if (!el) return;
    const line = document.createElement("div");
    line.textContent = msg;
    el.appendChild(line);
    while (el.childNodes.length > 30) el.removeChild(el.firstChild!);
    el.scrollTop = el.scrollHeight;
  }, []);

  const clearLog = useCallback(() => {
    const el = logRef.current;
    if (el) el.textContent = "";
  }, []);

  const copyLog = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    const text = Array.from(el.children).map(c => c.textContent).join("\n");
    navigator.clipboard.writeText(text);
  }, []);

  // Diagnostics — direct DOM write [L06]
  const updateDiagnostics = useCallback(() => {
    const delegate = inputRef.current;
    const el = diagRef.current;
    if (!delegate || !el) return;

    const range = delegate.getSelectedRange();
    const rangeStr = range
      ? (range.start === range.end
        ? `{${range.start}}` : `{${range.start}, ${range.end}}`)
      : "null";
    const collapsed = range ? range.start === range.end : false;
    const atoms = delegate.getAtoms();
    const text = delegate.getText();

    el.textContent = [
      `selectedRange: ${rangeStr}${collapsed ? " (collapsed)" : ""}`,
      `hasMarkedText: ${delegate.hasMarkedText}`,
      `length: ${text.length} | atoms: ${atoms.length} | empty: ${delegate.isEmpty()}`,
    ].join("\n");
  }, []);

  useLayoutEffect(() => {
    const onSelChange = () => {
      if (inputRef.current) updateDiagnostics();
    };
    document.addEventListener("selectionchange", onSelChange);
    return () => document.removeEventListener("selectionchange", onSelChange);
  }, [updateDiagnostics]);

  const handleSubmit = useCallback(() => {
    const delegate = inputRef.current;
    if (!delegate) return;
    const text = delegate.getText().trim();
    const atoms = delegate.getAtoms().map(a => a.label);
    appendLog(`submit: "${text}" atoms=[${atoms.join(", ")}]`);
    delegate.clear();
  }, [appendLog]);

  const handleChange = useCallback(() => {
    updateDiagnostics();
  }, [updateDiagnostics]);

  const handleInsertAtom = useCallback(() => {
    const delegate = inputRef.current;
    if (!delegate) return;
    const atom = SAMPLE_ATOMS[nextAtomIdx.current % SAMPLE_ATOMS.length];
    nextAtomIdx.current++;
    delegate.focus();
    delegate.insertAtom(atom);
  }, []);

  const handleClear = useCallback(() => {
    const delegate = inputRef.current;
    if (!delegate) return;
    delegate.clear();
    delegate.focus();
    clearLog();
  }, [clearLog]);

  const handleReturnAction = useCallback((value: string) => {
    setReturnAction(value as InputAction);
    appendLog(`return: ${value}, shift+return: ${value === "submit" ? "newline" : "submit"}`);
  }, [appendLog]);

  const handleEnterAction = useCallback((value: string) => {
    setEnterAction(value as InputAction);
    appendLog(`numpad enter: ${value}, shift+enter: ${value === "submit" ? "newline" : "submit"}`);
  }, [appendLog]);

  // --- Test harness ---

  return (
    <div className="cg-content" data-testid="gallery-prompt-input">

      {/* ---- IMG Atom Spike ---- */}
      <style dangerouslySetInnerHTML={{ __html: `
        .spike-editor ::selection, .spike-editor::selection {
          background-color: Highlight;
          color: HighlightText;
        }
        .spike-editor::highlight(card-selection),
        .spike-editor ::highlight(card-selection) {
          background-color: transparent !important;
          color: inherit !important;
        }
        .spike-editor::highlight(inactive-selection),
        .spike-editor ::highlight(inactive-selection) {
          background-color: transparent !important;
          color: inherit !important;
        }
      `}} />
      <div className="cg-section">
        <div className="cg-section-title">IMG Atom Spike</div>
        <div className="prompt-input-toolbar">
          <TugPushButton size="sm" onClick={() => {
            const spikeEl = document.getElementById("spike-editor");
            if (!spikeEl) return;
            spikeEl.focus();
            const atoms = [
              { type: "file", label: "src/main.ts" },
              { type: "file", label: "README.md" },
              { type: "file", label: "feed-store.ts" },
              { type: "command", label: "/commit" },
              { type: "doc", label: "design-doc.md" },
              { type: "link", label: "https://example.com" },
            ];
            const atom = atoms[Math.floor(Math.random() * atoms.length)];
            const img = createAtomImgElement(atom.type, atom.label, atom.label);
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
              const range = sel.getRangeAt(0);
              range.deleteContents();
              range.insertNode(img);
              range.setStartAfter(img);
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }}>Insert Atom</TugPushButton>
        </div>
        <div
          id="spike-editor"
          data-return-action={returnAction}
          data-enter-action={enterAction}
          ref={(el) => {
            if (!el || (el as any).__spikeSetup) return;
            (el as any).__spikeSetup = true;

            // Return/Enter: submit or newline based on key config.
            // Reads current action from data attributes (set by React).
            el.addEventListener("keydown", (e) => {
              if (e.key !== "Enter") return;
              if (e.isComposing) return; // IME gets the key

              e.preventDefault();
              const isNumpad = e.code === "NumpadEnter";
              const baseAction = isNumpad
                ? el.dataset.enterAction
                : el.dataset.returnAction;
              // Shift inverts
              const action = e.shiftKey
                ? (baseAction === "submit" ? "newline" : "submit")
                : baseAction;

              if (action === "submit") {
                // For the spike, just log it
                console.log("SPIKE: submit");
              } else {
                document.execCommand("insertLineBreak");
              }
            });

            // Click on atom: select the entire image
            el.addEventListener("click", (e) => {
              const target = e.target as HTMLElement;
              if (target.tagName === "IMG" && target.dataset.atomLabel) {
                const sel = window.getSelection();
                if (!sel) return;
                const range = document.createRange();
                range.selectNode(target);
                sel.removeAllRanges();
                sel.addRange(range);
              }
            });

            // Option+Arrow: treat atoms as word boundaries.
            // Let the browser do the word move, then check if we jumped
            // over an atom. If so, clamp to the first atom boundary crossed.
            el.addEventListener("keydown", (e) => {
              if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.altKey && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                const sel = window.getSelection();
                if (!sel || !sel.focusNode) return;

                const forward = e.key === "ArrowRight";
                const method = e.shiftKey ? "extend" : "move";
                const dir = forward ? "forward" : "backward";

                // Create a range marking the caret position BEFORE the move
                const beforeRange = document.createRange();
                beforeRange.setStart(sel.focusNode, sel.focusOffset);
                beforeRange.collapse(true);

                // Let browser do the word move
                sel.modify(method, dir, "word");

                // Create a range marking the caret position AFTER the move
                const afterRange = document.createRange();
                afterRange.setStart(sel.focusNode, sel.focusOffset);
                afterRange.collapse(true);

                // Check each atom: is it between before and after?
                const atoms = el.querySelectorAll("img[data-atom-label]");
                let clampAtom: HTMLImageElement | null = null;
                for (let i = 0; i < atoms.length; i++) {
                  const atomRange = document.createRange();
                  if (forward) {
                    // For forward: check if atom's leading edge is between before and after
                    atomRange.setStartBefore(atoms[i]);
                    atomRange.collapse(true);
                    const afterBefore = beforeRange.compareBoundaryPoints(Range.START_TO_START, atomRange) <= 0;
                    const beforeAfter = afterRange.compareBoundaryPoints(Range.START_TO_START, atomRange) >= 0;
                    if (afterBefore && beforeAfter) {
                      // This atom is in the crossed range — clamp to its trailing edge
                      if (!clampAtom) clampAtom = atoms[i] as HTMLImageElement;
                    }
                  } else {
                    // For backward: check if atom's trailing edge is between after and before
                    atomRange.setStartAfter(atoms[i]);
                    atomRange.collapse(true);
                    const afterAfter = afterRange.compareBoundaryPoints(Range.START_TO_START, atomRange) <= 0;
                    const beforeBefore = beforeRange.compareBoundaryPoints(Range.START_TO_START, atomRange) >= 0;
                    if (afterAfter && beforeBefore) {
                      clampAtom = atoms[i] as HTMLImageElement; // keep last (closest to before)
                    }
                  }
                }

                if (clampAtom) {
                  // Clamp: position at the atom's far edge (the side we approached from)
                  const parent = clampAtom.parentNode!;
                  const idx = Array.from(parent.childNodes).indexOf(clampAtom);
                  if (forward) {
                    // Stop after the atom
                    sel.collapse(parent, idx + 1);
                  } else {
                    // Stop before the atom
                    sel.collapse(parent, idx);
                  }
                }
              }
            });

            // Copy/Cut: write atom HTML + plain text to clipboard
            el.addEventListener("copy", (e) => {
              const sel = window.getSelection();
              if (!sel || sel.rangeCount === 0) return;
              const range = sel.getRangeAt(0);
              const fragment = range.cloneContents();

              // Build HTML representation (preserves atom img tags with data attributes)
              const wrapper = document.createElement("div");
              wrapper.appendChild(fragment);
              const html = wrapper.innerHTML;

              // Build plain text: replace atom imgs with their label
              const plainWrapper = wrapper.cloneNode(true) as HTMLElement;
              plainWrapper.querySelectorAll("img[data-atom-label]").forEach((img) => {
                const text = document.createTextNode((img as HTMLImageElement).dataset.atomLabel || "");
                img.parentNode?.replaceChild(text, img);
              });
              const plain = plainWrapper.textContent || "";

              e.clipboardData?.setData("text/html", html);
              e.clipboardData?.setData("text/plain", plain);
              e.preventDefault();
            });

            el.addEventListener("cut", (e) => {
              // Write to clipboard (same as copy)
              const sel = window.getSelection();
              if (!sel || sel.rangeCount === 0) return;
              const range = sel.getRangeAt(0);
              const fragment = range.cloneContents();
              const wrapper = document.createElement("div");
              wrapper.appendChild(fragment);
              const html = wrapper.innerHTML;
              const plainWrapper = wrapper.cloneNode(true) as HTMLElement;
              plainWrapper.querySelectorAll("img[data-atom-label]").forEach((img) => {
                const text = document.createTextNode((img as HTMLImageElement).dataset.atomLabel || "");
                img.parentNode?.replaceChild(text, img);
              });
              e.clipboardData?.setData("text/html", html);
              e.clipboardData?.setData("text/plain", plainWrapper.textContent || "");
              e.preventDefault();
              // Delete via execCommand so it's on the undo stack
              document.execCommand("delete");
            });

            // Paste: if clipboard has our atoms, insert them via insertHTML
            // (undoable). Otherwise let browser handle natively.
            el.addEventListener("paste", (e) => {
              console.log("SPIKE PASTE FIRED");
              console.log("  types:", Array.from(e.clipboardData?.types || []));
              const html = e.clipboardData?.getData("text/html") || "";
              const plain = e.clipboardData?.getData("text/plain") || "";
              console.log("  html length:", html.length, "has atom:", html.includes("data-atom-label"));
              console.log("  html:", html.slice(0, 300));
              console.log("  plain:", plain);
              if (!html.includes("data-atom-label")) {
                console.log("  → no atoms, letting browser handle");
                return;
              }
              e.preventDefault();
              const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
              const content = match ? match[1] : html;
              // Try inserting the atom HTML directly (no blob conversion)
              document.execCommand("insertHTML", false, content);
            }, true);

            // Drag & drop: create atoms from dropped files
            el.addEventListener("dragover", (e) => {
              e.preventDefault();
              e.dataTransfer!.dropEffect = "copy";
            });

            el.addEventListener("drop", (e) => {
              e.preventDefault();
              const files = e.dataTransfer?.files;
              if (!files || files.length === 0) return;

              // Position caret at drop point
              const range = document.caretRangeFromPoint(e.clientX, e.clientY);
              if (range) {
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
              }

              // Build atom HTML for all dropped files and insert via insertHTML (undoable)
              let html = "";
              for (let i = 0; i < files.length; i++) {
                const name = files[i].name;
                // Guess type from extension
                const ext = name.split(".").pop()?.toLowerCase() || "";
                const imgExts = ["png", "jpg", "jpeg", "gif", "svg", "webp"];
                const type = imgExts.includes(ext) ? "image" : "file";
                const wrapper = document.createElement("div");
                wrapper.appendChild(createAtomImgElement(type, name, name));
                html += wrapper.innerHTML;
              }
              document.execCommand("insertHTML", false, html);
            });
          }}
          contentEditable
          suppressContentEditableWarning
          className="spike-editor"
          style={{ padding: "12px", fontSize: "14px", lineHeight: "24px", outline: "none", background: "#252a34", color: "#c8d0dc", borderRadius: "6px", border: "1px solid #4a5568" }}
          dangerouslySetInnerHTML={{ __html:
            `hello ${atomImgHTML("file", "src/main.ts")} world<br>line two ${atomImgHTML("file", "feed-store.ts")}<br>line three ${atomImgHTML("command", "/commit")}`
          }}
        />
      </div>

      <div className="cg-divider" />

      {/* ---- Interactive Editor ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Editor</div>
        <div className="prompt-input-toolbar">
          <TugPushButton size="sm" onClick={handleInsertAtom}>Insert Atom</TugPushButton>
          <TugPushButton size="sm" emphasis="outlined" onClick={handleClear}>Clear</TugPushButton>
        </div>
        <TugPromptInput
          ref={inputRef}
          placeholder="Type here... @ for file completion, drag files, test IME, Return vs Enter"
          maxRows={8}
          returnAction={returnAction}
          numpadEnterAction={enterAction}
          onSubmit={handleSubmit}
          onChange={handleChange}
          onLog={appendLog}
          completionProvider={galleryCompletionProvider}
          dropHandler={galleryDropHandler}
        />
        <pre ref={diagRef} className="prompt-input-diagnostics" />
      </div>

      <div className="cg-divider" />

      {/* ---- Key Configuration ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Key Configuration</div>
        <div className="prompt-input-key-config">
          <div className="prompt-input-key-config-row">
            <span className="prompt-input-key-config-label">Return (main keyboard):</span>
            <TugChoiceGroup items={RETURN_CHOICES} value={returnAction} size="sm" onValueChange={handleReturnAction} />
          </div>
          <div className="prompt-input-key-config-row">
            <span className="prompt-input-key-config-label">Enter (numpad):</span>
            <TugChoiceGroup items={ENTER_CHOICES} value={enterAction} size="sm" onValueChange={handleEnterAction} />
          </div>
          <div className="prompt-input-desc">
            Shift always inverts. hasMarkedText=true → key goes to IME.
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Event Log ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Event Log</div>
        <div className="prompt-input-toolbar" style={{ marginBottom: "4px" }}>
          <TugPushButton size="sm" emphasis="ghost" onClick={clearLog}>Clear Log</TugPushButton>
          <TugPushButton size="sm" emphasis="ghost" onClick={copyLog}>Copy Log</TugPushButton>
        </div>
        <div ref={logRef} className="prompt-input-log" />
      </div>

    </div>
  );
}
