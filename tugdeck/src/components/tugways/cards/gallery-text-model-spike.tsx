/**
 * gallery-text-model-spike.tsx -- T3.0 Text Model Spike
 *
 * Prototype for tug-prompt-input using the thin contentEditable approach.
 * A contentEditable div with role="textbox" hosts plain text nodes
 * interspersed with inline non-editable atom pill spans.
 *
 * Features:
 *   - Text input with native cursor, selection, undo/redo
 *   - Inline atom pills (contentEditable=false spans)
 *   - Atom insertion via button, @-trigger with typeahead, and drag-and-drop
 *   - Two-step atomic backspace (select pill, then delete)
 *   - Undoable atom insertion via execCommand('insertHTML')
 *   - IME composition safety (never intercept during composing)
 *   - Auto-resize (1 row → maxRows)
 *   - Configurable Enter behavior
 *   - Cmd+A scoped to editor
 *
 * @module components/tugways/cards/gallery-text-model-spike
 */

import React, { useRef, useLayoutEffect, useCallback, useState } from "react";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
import "./gallery-text-model-spike.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ROWS = 8;
const LINE_HEIGHT = 21; // 14px font-size * 1.5 line-height
const PADDING_Y = 12 + 2; // 6px top + 6px bottom padding + 2px border
const MAX_HEIGHT = LINE_HEIGHT * MAX_ROWS + PADDING_Y;

/** Sample atoms for the spike — cycles through these on Insert Atom. */
const SAMPLE_ATOMS = [
  { type: "file", label: "src/main.ts", value: "/Users/dev/project/src/main.ts" },
  { type: "file", label: "README.md", value: "/Users/dev/project/README.md" },
  { type: "command", label: "/commit", value: "/commit" },
  { type: "file", label: "src/lib/feed-store.ts", value: "/Users/dev/project/src/lib/feed-store.ts" },
];

/** Fake file list for @-trigger typeahead. */
const TYPEAHEAD_FILES = [
  "src/main.ts",
  "src/main.tsx",
  "src/protocol.ts",
  "src/connection.ts",
  "src/lib/feed-store.ts",
  "src/lib/connection-singleton.ts",
  "src/deck-manager.ts",
  "src/settings-api.ts",
  "src/action-dispatch.ts",
  "README.md",
  "package.json",
  "tsconfig.json",
];

/** Enter behavior options for the choice group. */
const ENTER_CHOICES: TugChoiceItem[] = [
  { value: "enter-submits", label: "Enter submits" },
  { value: "enter-newline", label: "Enter = newline" },
];

// ---------------------------------------------------------------------------
// Atom DOM creation helper
// ---------------------------------------------------------------------------

/** Build an atom pill HTML string (for execCommand('insertHTML') — undoable). */
function atomHTML(type: string, label: string): string {
  const icon = type === "file" ? "\u{1F4C4}" : "\u{2F}";
  return `<span class="spike-atom" contenteditable="false" data-atom-type="${type}" data-atom-label="${label}" role="img" aria-label="${type}: ${label}"><span class="spike-atom-icon">${icon}</span><span>${label}</span></span>`;
}

/** Build an atom pill DOM element (for drag-and-drop where execCommand isn't usable). */
function createAtomElement(type: string, label: string): HTMLSpanElement {
  const atom = document.createElement("span");
  atom.className = "spike-atom";
  atom.contentEditable = "false";
  atom.setAttribute("data-atom-type", type);
  atom.setAttribute("data-atom-label", label);
  atom.setAttribute("role", "img");
  atom.setAttribute("aria-label", `${type}: ${label}`);

  const iconEl = document.createElement("span");
  iconEl.className = "spike-atom-icon";
  iconEl.textContent = type === "file" ? "\u{1F4C4}" : "\u{2F}";
  atom.appendChild(iconEl);

  const text = document.createElement("span");
  text.textContent = label;
  atom.appendChild(text);

  return atom;
}

// ---------------------------------------------------------------------------
// Typeahead state
// ---------------------------------------------------------------------------

interface TypeaheadState {
  active: boolean;
  query: string;
  anchorNode: Text | null;
  anchorOffset: number;
  selectedIndex: number;
  filtered: string[];
}

function initialTypeaheadState(): TypeaheadState {
  return { active: false, query: "", anchorNode: null, anchorOffset: 0, selectedIndex: 0, filtered: [] };
}

// ---------------------------------------------------------------------------
// Helpers: find adjacent atom
// ---------------------------------------------------------------------------

/** Return the atom element immediately before the cursor, or null. */
function atomBeforeCursor(el: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || !sel.anchorNode) return null;
  const node = sel.anchorNode;
  const offset = sel.anchorOffset;

  // Cursor at start of text node → check previous sibling
  if (node.nodeType === Node.TEXT_NODE && offset === 0) {
    const prev = node.previousSibling;
    if (prev instanceof HTMLElement && prev.classList.contains("spike-atom")) return prev;
  }
  // Cursor inside the editor element itself → child before offset
  if (node === el && offset > 0) {
    const prev = el.childNodes[offset - 1];
    if (prev instanceof HTMLElement && prev.classList.contains("spike-atom")) return prev;
  }
  return null;
}

/** Return the atom element immediately after the cursor, or null. */
function atomAfterCursor(el: HTMLElement): HTMLElement | null {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || !sel.anchorNode) return null;
  const node = sel.anchorNode;
  const offset = sel.anchorOffset;

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || "";
    if (offset === text.length) {
      const next = node.nextSibling;
      if (next instanceof HTMLElement && next.classList.contains("spike-atom")) return next;
    }
  }
  if (node === el) {
    const next = el.childNodes[offset];
    if (next instanceof HTMLElement && next.classList.contains("spike-atom")) return next;
  }
  return null;
}

// ---------------------------------------------------------------------------
// SpikeEditor
// ---------------------------------------------------------------------------

function SpikeEditor() {
  const editorRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const nextAtomIdx = useRef(0);
  const composingRef = useRef(false);
  const typeaheadRef = useRef<TypeaheadState>(initialTypeaheadState());
  /** "enter-submits" or "enter-newline" — ref for event handlers, state for UI */
  const enterBehaviorRef = useRef("enter-submits");
  const [enterBehavior, setEnterBehavior] = useState("enter-submits");

  // ---- Logging ----
  const log = useCallback((msg: string) => {
    const el = logRef.current;
    if (!el) return;
    const line = document.createElement("div");
    line.textContent = msg;
    el.appendChild(line);
    while (el.childNodes.length > 20) el.removeChild(el.firstChild!);
    el.scrollTop = el.scrollHeight;
  }, []);

  // ---- Status update ----
  const updateStatus = useCallback(() => {
    const el = editorRef.current;
    if (!el || !statusRef.current) return;
    const text = el.textContent || "";
    const atomCount = el.querySelectorAll(".spike-atom").length;
    statusRef.current.textContent =
      `chars: ${text.length} | atoms: ${atomCount} | height: ${el.offsetHeight}px` +
      (composingRef.current ? " | IME: composing" : "");
  }, []);

  // ---- Auto-resize ----
  const autoResize = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > MAX_HEIGHT) {
      el.style.height = `${MAX_HEIGHT}px`;
      el.style.overflowY = "auto";
    } else {
      el.style.overflowY = "hidden";
    }
  }, []);

  // ---- Typeahead popup rendering ----
  const renderPopup = useCallback(() => {
    const popup = popupRef.current;
    if (!popup) return;
    const ta = typeaheadRef.current;

    if (!ta.active || ta.filtered.length === 0) {
      popup.style.display = "none";
      return;
    }

    popup.style.display = "block";
    popup.innerHTML = "";
    ta.filtered.forEach((item, i) => {
      const div = document.createElement("div");
      div.className = "spike-typeahead-item" + (i === ta.selectedIndex ? " spike-typeahead-selected" : "");
      div.textContent = item;
      div.setAttribute("data-index", String(i));
      popup.appendChild(div);
    });

    // Position near cursor
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const editorRect = editorRef.current?.getBoundingClientRect();
      if (editorRect) {
        popup.style.left = `${rect.left - editorRect.left}px`;
        popup.style.bottom = `${editorRect.bottom - rect.top + 4}px`;
      }
    }
  }, []);

  const updateTypeahead = useCallback((query: string) => {
    const ta = typeaheadRef.current;
    ta.query = query;
    const q = query.toLowerCase();
    ta.filtered = q.length === 0
      ? TYPEAHEAD_FILES.slice(0, 8)
      : TYPEAHEAD_FILES.filter(f => f.toLowerCase().includes(q)).slice(0, 8);
    ta.selectedIndex = 0;
    renderPopup();
  }, [renderPopup]);

  // ---- Accept typeahead: delete @query, insert atom via execCommand ----
  const acceptTypeahead = useCallback(() => {
    const ta = typeaheadRef.current;
    const el = editorRef.current;
    if (!ta.active || ta.filtered.length === 0 || !el) return;

    const selected = ta.filtered[ta.selectedIndex];
    const anchorNode = ta.anchorNode;
    const anchorOffset = ta.anchorOffset;

    // Close typeahead
    ta.active = false;
    if (popupRef.current) popupRef.current.style.display = "none";

    if (!anchorNode || !anchorNode.parentNode) return;

    // Select the @query text so execCommand replaces it
    const queryLen = 1 + ta.query.length; // @ + query
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.setStart(anchorNode, anchorOffset);
      range.setEnd(anchorNode, anchorOffset + queryLen);
      sel.removeAllRanges();
      sel.addRange(range);

      // Insert atom via execCommand — goes through browser undo stack
      document.execCommand("insertHTML", false, atomHTML("file", selected));
    }

    log(`atom: @${selected}`);
    autoResize();
    updateStatus();
  }, [log, autoResize, updateStatus]);

  const cancelTypeahead = useCallback(() => {
    typeaheadRef.current.active = false;
    if (popupRef.current) popupRef.current.style.display = "none";
  }, []);

  // ---- Main event wiring ----
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;

    // --- IME composition tracking ---
    const onCompositionStart = () => {
      composingRef.current = true;
      log("IME: composing start");
      updateStatus();
    };
    const onCompositionEnd = () => {
      composingRef.current = false;
      log("IME: composing end");
      updateStatus();
    };

    // --- input: resize + status + typeahead ---
    const onInput = () => {
      autoResize();
      updateStatus();

      const ta = typeaheadRef.current;
      if (ta.active && ta.anchorNode) {
        const text = ta.anchorNode.textContent || "";
        const sel = window.getSelection();
        if (sel && sel.isCollapsed && sel.anchorNode === ta.anchorNode) {
          const query = text.slice(ta.anchorOffset + 1, sel.anchorOffset);
          updateTypeahead(query);
        } else {
          cancelTypeahead();
        }
      }
    };

    // --- keydown ---
    const onKeydown = (e: KeyboardEvent) => {
      // Never intercept during IME composition
      if (composingRef.current || e.isComposing) return;

      // --- Cmd+A: select all within editor only ---
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        e.stopPropagation();
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        return;
      }

      // --- Typeahead navigation ---
      const ta = typeaheadRef.current;
      if (ta.active) {
        if (e.key === "Tab" || e.key === "Enter") {
          e.preventDefault();
          acceptTypeahead();
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          ta.selectedIndex = Math.min(ta.selectedIndex + 1, ta.filtered.length - 1);
          renderPopup();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          ta.selectedIndex = Math.max(ta.selectedIndex - 1, 0);
          renderPopup();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          cancelTypeahead();
          return;
        }
      }

      // --- Enter behavior ---
      if (e.key === "Enter") {
        const enterSubmits = enterBehaviorRef.current === "enter-submits";
        const wantsSubmit = enterSubmits ? !e.shiftKey : (e.metaKey || e.ctrlKey);
        const wantsNewline = !wantsSubmit;

        if (wantsSubmit) {
          e.preventDefault();
          const text = el.textContent || "";
          const atoms = Array.from(el.querySelectorAll(".spike-atom")).map(
            a => a.getAttribute("data-atom-label") || ""
          );
          log(`submit: "${text.trim()}" atoms=[${atoms.join(", ")}]`);
          el.innerHTML = "";
          autoResize();
          updateStatus();
          return;
        }
        // wantsNewline: let the browser insert a <br> / newline
        if (wantsNewline) {
          // Default behavior handles it
        }
      }

      // --- Backspace: two-step atom delete ---
      if (e.key === "Backspace") {
        // Check if an atom is currently selected (has spike-atom-selected class)
        const selected = el.querySelector(".spike-atom-selected");
        if (selected) {
          e.preventDefault();
          const label = selected.getAttribute("data-atom-label") || "?";
          // Place cursor where the atom was
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            const parent = selected.parentNode!;
            const idx = Array.from(parent.childNodes).indexOf(selected);
            range.setStart(parent, idx);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          }
          selected.remove();
          log(`delete atom: ${label}`);
          updateStatus();
          return;
        }

        // Step 1: cursor adjacent to atom → select it (visual highlight)
        const atomBefore = atomBeforeCursor(el);
        if (atomBefore) {
          e.preventDefault();
          // Clear any previous selection highlight
          el.querySelectorAll(".spike-atom-selected").forEach(a => a.classList.remove("spike-atom-selected"));
          atomBefore.classList.add("spike-atom-selected");
          log(`select atom: ${atomBefore.getAttribute("data-atom-label")}`);
          return;
        }
      }

      // --- Delete (forward): two-step ---
      if (e.key === "Delete") {
        const selected = el.querySelector(".spike-atom-selected");
        if (selected) {
          e.preventDefault();
          const label = selected.getAttribute("data-atom-label") || "?";
          selected.remove();
          log(`delete atom: ${label}`);
          updateStatus();
          return;
        }

        const atomAfter = atomAfterCursor(el);
        if (atomAfter) {
          e.preventDefault();
          el.querySelectorAll(".spike-atom-selected").forEach(a => a.classList.remove("spike-atom-selected"));
          atomAfter.classList.add("spike-atom-selected");
          log(`select atom: ${atomAfter.getAttribute("data-atom-label")}`);
          return;
        }
      }

      // Any other key clears atom selection highlight
      if (e.key !== "Backspace" && e.key !== "Delete") {
        el.querySelectorAll(".spike-atom-selected").forEach(a => a.classList.remove("spike-atom-selected"));
      }
    };

    // --- beforeinput: detect @ trigger ---
    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType === "insertText" && e.data === "@" && !composingRef.current) {
        requestAnimationFrame(() => {
          const sel = window.getSelection();
          if (!sel || !sel.isCollapsed || !sel.anchorNode) return;
          if (sel.anchorNode.nodeType !== Node.TEXT_NODE) return;

          const ta = typeaheadRef.current;
          ta.active = true;
          ta.anchorNode = sel.anchorNode as Text;
          ta.anchorOffset = sel.anchorOffset - 1;
          ta.query = "";
          ta.selectedIndex = 0;
          updateTypeahead("");
          log("typeahead: @-trigger");
        });
      }
    };

    // --- paste: plain text only ---
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") || "";
      document.execCommand("insertText", false, text);
    };

    // --- click: clear atom selection, close typeahead on click outside ---
    const onClick = () => {
      el.querySelectorAll(".spike-atom-selected").forEach(a => a.classList.remove("spike-atom-selected"));
      // If click landed outside typeahead anchor area, close it
      const ta = typeaheadRef.current;
      if (ta.active) {
        const sel = window.getSelection();
        if (!sel || sel.anchorNode !== ta.anchorNode) {
          cancelTypeahead();
        }
      }
    };

    el.addEventListener("compositionstart", onCompositionStart);
    el.addEventListener("compositionend", onCompositionEnd);
    el.addEventListener("input", onInput);
    el.addEventListener("keydown", onKeydown);
    el.addEventListener("beforeinput", onBeforeInput);
    el.addEventListener("paste", onPaste);
    el.addEventListener("click", onClick);

    return () => {
      el.removeEventListener("compositionstart", onCompositionStart);
      el.removeEventListener("compositionend", onCompositionEnd);
      el.removeEventListener("input", onInput);
      el.removeEventListener("keydown", onKeydown);
      el.removeEventListener("beforeinput", onBeforeInput);
      el.removeEventListener("paste", onPaste);
      el.removeEventListener("click", onClick);
    };
  }, [autoResize, updateStatus, updateTypeahead, acceptTypeahead, cancelTypeahead, renderPopup, log]);

  // ---- Insert atom (from button) — uses execCommand for undo support ----
  const insertAtomFromButton = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const atom = SAMPLE_ATOMS[nextAtomIdx.current % SAMPLE_ATOMS.length];
    nextAtomIdx.current++;

    el.focus();
    // execCommand('insertHTML') integrates with the browser undo stack
    document.execCommand("insertHTML", false, atomHTML(atom.type, atom.label));

    log(`atom: ${atom.label} (button)`);
    autoResize();
    updateStatus();
  }, [log, autoResize, updateStatus]);

  // ---- Clear ----
  const clearEditor = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    // Select all + delete via execCommand so it's undoable
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand("delete", false);
    }
    el.focus();
    autoResize();
    updateStatus();
    log("cleared");
  }, [log, autoResize, updateStatus]);

  // ---- Drop handler ----
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length === 0) return;
    const el = editorRef.current;
    if (!el) return;

    el.focus();
    for (let i = 0; i < files.length; i++) {
      const fileName = files[i].name;
      document.execCommand("insertHTML", false, atomHTML("file", fileName));
      log(`drop: ${fileName}`);
    }
    autoResize();
    updateStatus();
  }, [log, autoResize, updateStatus]);

  // ---- Enter behavior toggle ----
  const handleEnterBehavior = useCallback((value: string) => {
    enterBehaviorRef.current = value;
    setEnterBehavior(value);
    log(`enter behavior: ${value === "enter-submits" ? "Enter submits, Shift+Enter newline" : "Enter newline, Cmd+Enter submits"}`);
  }, [log]);

  return (
    <div className="cg-content" data-testid="gallery-text-model-spike">

      <div className="cg-section">
        <div className="cg-section-title">T3.0 Text Model Spike — Thin contentEditable</div>
        <div className="spike-approach-desc">
          contentEditable div with role=&quot;textbox&quot;. Plain text nodes +
          inline non-editable atom spans. Native cursor flow, selection, and undo.
          IME-safe via compositionstart/end + isComposing check.
        </div>
      </div>

      <div className="cg-divider" />

      <div className="cg-section">
        <div className="cg-section-title">Editor</div>
        <div className="spike-toolbar">
          <TugPushButton size="sm" onClick={insertAtomFromButton}>Insert Atom</TugPushButton>
          <TugPushButton size="sm" emphasis="outlined" onClick={clearEditor}>Clear</TugPushButton>
          <span className="spike-status" ref={statusRef}>chars: 0 | atoms: 0</span>
        </div>
        <div className="spike-editor-container">
          <div
            ref={editorRef}
            className="spike-input spike-contenteditable"
            contentEditable
            role="textbox"
            aria-multiline="true"
            aria-label="Text model spike editor"
            data-placeholder="Type here... @ for file completion, Enter to submit, Shift+Enter for newline"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            suppressContentEditableWarning
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          />
          <div ref={popupRef} className="spike-typeahead-popup" />
        </div>
        <div className="spike-toolbar">
          <TugChoiceGroup
            items={ENTER_CHOICES}
            value={enterBehavior}
            size="sm"
            onValueChange={handleEnterBehavior}
          />
        </div>
      </div>

      <div className="cg-divider" />

      <div className="cg-section">
        <div className="cg-section-title">Test Matrix</div>
        <div className="spike-approach-desc">
          <strong>1. Typing:</strong> Type, arrow keys, Shift+arrow select, click+drag select.<br />
          <strong>2. Atoms:</strong> Click &quot;Insert Atom&quot; or type <code>@</code> then filter + Tab/Enter.<br />
          <strong>3. Backspace:</strong> Cursor after atom → first Backspace selects (highlights), second deletes.<br />
          <strong>4. Undo:</strong> Cmd+Z undoes atom insertion, typing, and clear.<br />
          <strong>5. IME:</strong> Japanese/Chinese input. Enter during composition goes to IME, not submit.<br />
          <strong>6. VoiceOver:</strong> Arrow into atom — label announced.<br />
          <strong>7. Resize:</strong> Content past 8 lines → caps height, scrolls.<br />
          <strong>8. Drop:</strong> Drag file from Finder → creates file atom.<br />
          <strong>9. Enter:</strong> Toggle behavior below. Both modes: Cmd+Enter always submits.<br />
          <strong>10. Cmd+A:</strong> Selects editor content only, not the entire card.<br />
          <strong>11. Paste:</strong> Rich text stripped to plain text.
        </div>
      </div>

      <div className="cg-divider" />

      <div className="cg-section">
        <div className="cg-section-title">Event Log</div>
        <div ref={logRef} className="spike-log" />
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryTextModelSpike (exported)
// ---------------------------------------------------------------------------

export function GalleryTextModelSpike() {
  return <SpikeEditor />;
}
