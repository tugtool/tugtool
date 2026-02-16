/**
 * Deck manager for card layout and frame dispatch
 *
 * Phase 2: CSS Grid multi-card layout with drag-handle resize
 * Phase 3: Card collapse/expand and layout persistence
 */

import { createElement, ChevronUp, ChevronDown } from "lucide";
import { FeedIdValue } from "./protocol";
import { TugCard } from "./cards/card";
import { TugConnection } from "./connection";

/** Card slot names matching CSS grid areas */
export type CardSlot = "terminal" | "git" | "files" | "stats";

/** Minimum card dimension in pixels */
const MIN_CARD_SIZE = 100;

/** localStorage key for layout persistence */
const LAYOUT_STORAGE_KEY = "tugdeck-layout";

/** Layout state version for schema migration */
const LAYOUT_VERSION = 1;

/** Debounce delay for saving layout */
const SAVE_DEBOUNCE_MS = 500;

/** Layout state persisted to localStorage */
interface LayoutState {
  version: number;
  colSplit: number;
  rowSplits: number[];
  collapsed: string[]; // CardSlot names of collapsed cards
}

/**
 * Manages card layout and frame dispatch.
 *
 * Creates a CSS Grid layout with named card slots and drag handles for resize.
 * Supports card collapse/expand and persists layout to localStorage.
 */
export class DeckManager {
  private cards: Map<CardSlot, TugCard> = new Map();
  private slots: Map<CardSlot, HTMLElement> = new Map();
  private gridContainer: HTMLElement;
  private connection: TugConnection;

  // Grid track state (in fr units, relative)
  private colSplit = 0.667; // 2fr / (2fr + 1fr) = 0.667
  private rowSplits = [1 / 3, 2 / 3]; // equal thirds

  // Collapse/expand state
  private collapsedSlots: Set<CardSlot> = new Set();
  private saveTimer: number | null = null;

  constructor(container: HTMLElement, connection: TugConnection) {
    this.connection = connection;

    // Create grid container
    this.gridContainer = document.createElement("div");
    this.gridContainer.className = "deck-grid";
    container.appendChild(this.gridContainer);

    // Create named card slot elements
    for (const name of ["terminal", "git", "files", "stats"] as CardSlot[]) {
      const slot = document.createElement("div");
      slot.className = `card-slot card-slot-${name}`;
      this.gridContainer.appendChild(slot);
      this.slots.set(name, slot);
    }

    // Create drag handles
    this.createDragHandles();

    // Load saved layout state
    this.loadLayout();

    // Update grid tracks from loaded or initial state
    this.updateGridTracks();

    // Listen for window resize
    window.addEventListener("resize", () => this.handleResize());
    connection.onOpen(() => this.handleResize());
  }

  /**
   * Register a card with the deck in a named slot
   */
  addCard(card: TugCard, slot: CardSlot): void {
    this.cards.set(slot, card);

    // Register connection callbacks for this card's feed IDs
    for (const feedId of card.feedIds) {
      this.connection.onFrame(feedId, (payload: Uint8Array) => {
        card.onFrame(feedId, payload);
      });
    }

    // Mount card into its slot
    const slotEl = this.slots.get(slot);
    if (slotEl) {
      card.mount(slotEl);

      // Add collapse button if card is collapsible
      if (card.collapsible !== false) {
        const header = slotEl.querySelector(".card-header");
        if (header) {
          const btn = document.createElement("button");
          btn.className = "collapse-btn";
          const icon = this.collapsedSlots.has(slot)
            ? createElement(ChevronDown, { width: 14, height: 14 })
            : createElement(ChevronUp, { width: 14, height: 14 });
          btn.appendChild(icon);
          btn.addEventListener("click", () => this.toggleCollapse(slot));
          header.appendChild(btn);

          // Apply collapsed state if this slot was collapsed on load
          if (this.collapsedSlots.has(slot)) {
            this.applyCollapse(slot);
          }
        }
      }
    }
  }

  private toggleCollapse(slot: CardSlot): void {
    if (this.collapsedSlots.has(slot)) {
      this.expandCard(slot);
    } else {
      this.collapseCard(slot);
    }
    this.scheduleSave();
  }

  private collapseCard(slot: CardSlot): void {
    this.collapsedSlots.add(slot);
    this.applyCollapse(slot);
  }

  private expandCard(slot: CardSlot): void {
    this.collapsedSlots.delete(slot);
    this.applyExpand(slot);
  }

  private applyCollapse(slot: CardSlot): void {
    const slotEl = this.slots.get(slot);
    if (!slotEl) return;

    slotEl.classList.add("collapsed");

    // Update button icon
    const btn = slotEl.querySelector(".collapse-btn");
    if (btn) {
      btn.innerHTML = "";
      btn.appendChild(createElement(ChevronDown, { width: 14, height: 14 }));
    }

    this.updateGridTracks();
  }

  private applyExpand(slot: CardSlot): void {
    const slotEl = this.slots.get(slot);
    if (!slotEl) return;

    slotEl.classList.remove("collapsed");

    // Update button icon
    const btn = slotEl.querySelector(".collapse-btn");
    if (btn) {
      btn.innerHTML = "";
      btn.appendChild(createElement(ChevronUp, { width: 14, height: 14 }));
    }

    this.updateGridTracks();
    this.handleResize();
  }

  private createDragHandles(): void {
    // Column drag handle (between terminal and right column)
    const colHandle = document.createElement("div");
    colHandle.className = "drag-handle drag-handle-col";
    this.gridContainer.appendChild(colHandle);
    this.setupColDrag(colHandle);

    // Row drag handles (between git/files and files/stats)
    const rowHandle1 = document.createElement("div");
    rowHandle1.className = "drag-handle drag-handle-row";
    rowHandle1.dataset.index = "0";
    this.gridContainer.appendChild(rowHandle1);
    this.setupRowDrag(rowHandle1, 0);

    const rowHandle2 = document.createElement("div");
    rowHandle2.className = "drag-handle drag-handle-row";
    rowHandle2.dataset.index = "1";
    this.gridContainer.appendChild(rowHandle2);
    this.setupRowDrag(rowHandle2, 1);
  }

  private setupColDrag(handle: HTMLElement): void {
    let startX = 0;
    let startSplit = 0;

    handle.addEventListener("pointerdown", (e: PointerEvent) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("active");
      startX = e.clientX;
      startSplit = this.colSplit;

      const onMove = (e: PointerEvent) => {
        const dx = e.clientX - startX;
        const totalWidth = this.gridContainer.clientWidth;
        let newSplit = startSplit + dx / totalWidth;

        // Enforce minimums
        const minFraction = MIN_CARD_SIZE / totalWidth;
        newSplit = Math.max(minFraction, Math.min(1 - minFraction, newSplit));

        this.colSplit = newSplit;
        this.updateGridTracks();
        this.handleResize();
      };

      const onUp = (e: PointerEvent) => {
        handle.releasePointerCapture(e.pointerId);
        handle.classList.remove("active");
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        this.scheduleSave();
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
    });
  }

  private setupRowDrag(handle: HTMLElement, index: number): void {
    let startY = 0;
    let startSplits: number[] = [];

    handle.addEventListener("pointerdown", (e: PointerEvent) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("active");
      startY = e.clientY;
      startSplits = [...this.rowSplits];

      const onMove = (e: PointerEvent) => {
        const dy = e.clientY - startY;
        const totalHeight = this.gridContainer.clientHeight;
        const delta = dy / totalHeight;

        const newSplits = [...startSplits];
        const minFraction = MIN_CARD_SIZE / totalHeight;

        if (index === 0) {
          // Moving boundary between row 0 (git) and row 1 (files)
          newSplits[0] = Math.max(
            minFraction,
            Math.min(newSplits[1] - minFraction, startSplits[0] + delta)
          );
        } else {
          // Moving boundary between row 1 (files) and row 2 (stats)
          newSplits[1] = Math.max(
            newSplits[0] + minFraction,
            Math.min(1 - minFraction, startSplits[1] + delta)
          );
        }

        this.rowSplits = newSplits;
        this.updateGridTracks();
        this.handleResize();
      };

      const onUp = (e: PointerEvent) => {
        handle.releasePointerCapture(e.pointerId);
        handle.classList.remove("active");
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        this.scheduleSave();
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
    });
  }

  private updateGridTracks(): void {
    // Convert split fractions to CSS percentages
    const colLeft = (this.colSplit * 100).toFixed(2) + "%";
    const colRight = ((1 - this.colSplit) * 100).toFixed(2) + "%";
    this.gridContainer.style.gridTemplateColumns = `${colLeft} ${colRight}`;

    // Right column slots in order
    const rightSlots: CardSlot[] = ["git", "files", "stats"];

    // Calculate row tracks, accounting for collapsed cards
    const hasCollapsed = rightSlots.some((s) => this.collapsedSlots.has(s));

    if (hasCollapsed) {
      // Use fixed height for collapsed, 1fr for expanded
      const rowTracks = rightSlots.map((slot) => {
        return this.collapsedSlots.has(slot) ? "28px" : "1fr";
      });
      this.gridContainer.style.gridTemplateRows = rowTracks.join(" ");
    } else {
      // Use percentage-based splits when all expanded
      const row1 = (this.rowSplits[0] * 100).toFixed(2) + "%";
      const row2 = ((this.rowSplits[1] - this.rowSplits[0]) * 100).toFixed(2) + "%";
      const row3 = ((1 - this.rowSplits[1]) * 100).toFixed(2) + "%";
      this.gridContainer.style.gridTemplateRows = `${row1} ${row2} ${row3}`;
    }

    // Position drag handles
    this.positionHandles();
  }

  private positionHandles(): void {
    const handles = this.gridContainer.querySelectorAll(".drag-handle");
    const colHandle = handles[0] as HTMLElement;
    const rowHandle1 = handles[1] as HTMLElement;
    const rowHandle2 = handles[2] as HTMLElement;

    if (colHandle) {
      colHandle.style.left = `calc(${(this.colSplit * 100).toFixed(2)}% - 3px)`;
    }
    if (rowHandle1) {
      // Only spans the right column
      rowHandle1.style.top = `calc(${(this.rowSplits[0] * 100).toFixed(2)}% - 3px)`;
      rowHandle1.style.left = `${(this.colSplit * 100).toFixed(2)}%`;
    }
    if (rowHandle2) {
      rowHandle2.style.top = `calc(${(this.rowSplits[1] * 100).toFixed(2)}% - 3px)`;
      rowHandle2.style.left = `${(this.colSplit * 100).toFixed(2)}%`;
    }
  }

  private saveLayout(): void {
    try {
      const state: LayoutState = {
        version: LAYOUT_VERSION,
        colSplit: this.colSplit,
        rowSplits: this.rowSplits,
        collapsed: Array.from(this.collapsedSlots),
      };
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("tugdeck: failed to save layout to localStorage", e);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveLayout();
      this.saveTimer = null;
    }, SAVE_DEBOUNCE_MS);
  }

  private loadLayout(): void {
    try {
      const json = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (!json) {
        return; // Use defaults
      }

      const state = JSON.parse(json) as LayoutState;

      // Verify version
      if (state.version !== LAYOUT_VERSION) {
        console.warn("tugdeck: layout version mismatch, using defaults");
        return;
      }

      // Validate and apply colSplit
      if (
        typeof state.colSplit === "number" &&
        state.colSplit >= 0.1 &&
        state.colSplit <= 0.9
      ) {
        this.colSplit = state.colSplit;
      }

      // Validate and apply rowSplits
      if (
        Array.isArray(state.rowSplits) &&
        state.rowSplits.length === 2 &&
        state.rowSplits[0] >= 0.1 &&
        state.rowSplits[1] >= state.rowSplits[0] + 0.1 &&
        state.rowSplits[1] <= 0.9
      ) {
        this.rowSplits = state.rowSplits;
      }

      // Validate and apply collapsed state
      if (Array.isArray(state.collapsed)) {
        const validSlots: CardSlot[] = ["git", "files", "stats"];
        const filtered = state.collapsed.filter((s) => validSlots.includes(s as CardSlot));
        this.collapsedSlots = new Set(filtered as CardSlot[]);
      }
    } catch (e) {
      console.warn("tugdeck: failed to load layout from localStorage", e);
    }
  }

  private handleResize(): void {
    for (const [slot, card] of this.cards) {
      const slotEl = this.slots.get(slot);
      if (slotEl) {
        card.onResize(slotEl.clientWidth, slotEl.clientHeight);
      }
    }
  }

  destroy(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    for (const card of this.cards.values()) {
      card.destroy();
    }
    this.cards.clear();
  }
}
