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
export type CardSlot = "conversation" | "terminal" | "git" | "files" | "stats";

/** Minimum card dimension in pixels */
const MIN_CARD_SIZE = 100;

/** localStorage key for layout persistence */
const LAYOUT_STORAGE_KEY = "tugdeck-layout";

/** Layout state version for schema migration */
const LAYOUT_VERSION = 2;

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
  private rowSplits = [0.25, 0.5, 0.75]; // equal quarters for 4 rows

  // Collapse/expand state
  private collapsedSlots: Set<CardSlot> = new Set();
  private saveTimer: number | null = null;

  // Drag state for resize debounce coordination
  private _isDragging = false;

  constructor(container: HTMLElement, connection: TugConnection) {
    this.connection = connection;

    // Create grid container
    this.gridContainer = document.createElement("div");
    this.gridContainer.className = "deck-grid";
    container.appendChild(this.gridContainer);

    // Create named card slot elements (conversation first)
    for (const name of ["conversation", "terminal", "git", "files", "stats"] as CardSlot[]) {
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
   * Public accessor for drag state
   */
  get isDragging(): boolean {
    return this._isDragging;
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
    // Column drag handle (between conversation and right column)
    const colHandle = document.createElement("div");
    colHandle.className = "drag-handle drag-handle-col";
    this.gridContainer.appendChild(colHandle);
    this.setupColDrag(colHandle);

    // Row drag handles (between terminal/git, git/files, files/stats)
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

    const rowHandle3 = document.createElement("div");
    rowHandle3.className = "drag-handle drag-handle-row";
    rowHandle3.dataset.index = "2";
    this.gridContainer.appendChild(rowHandle3);
    this.setupRowDrag(rowHandle3, 2);
  }

  private setupColDrag(handle: HTMLElement): void {
    let startX = 0;
    let startSplit = 0;

    handle.addEventListener("pointerdown", (e: PointerEvent) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("active");
      this._isDragging = true;
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
      };

      const onUp = (e: PointerEvent) => {
        this._isDragging = false;
        handle.releasePointerCapture(e.pointerId);
        handle.classList.remove("active");
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        this.handleResize();
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
      this._isDragging = true;
      startY = e.clientY;
      startSplits = [...this.rowSplits];

      const onMove = (e: PointerEvent) => {
        const dy = e.clientY - startY;
        const totalHeight = this.gridContainer.clientHeight;
        const delta = dy / totalHeight;

        const newSplits = [...startSplits];
        const minFraction = MIN_CARD_SIZE / totalHeight;

        if (index === 0) {
          // Moving boundary between row 0 (terminal) and row 1 (git)
          newSplits[0] = Math.max(
            minFraction,
            Math.min(newSplits[1] - minFraction, startSplits[0] + delta)
          );
        } else if (index === 1) {
          // Moving boundary between row 1 (git) and row 2 (files)
          newSplits[1] = Math.max(
            newSplits[0] + minFraction,
            Math.min(newSplits[2] - minFraction, startSplits[1] + delta)
          );
        } else {
          // Moving boundary between row 2 (files) and row 3 (stats)
          newSplits[2] = Math.max(
            newSplits[1] + minFraction,
            Math.min(1 - minFraction, startSplits[2] + delta)
          );
        }

        this.rowSplits = newSplits;
        this.updateGridTracks();
      };

      const onUp = (e: PointerEvent) => {
        this._isDragging = false;
        handle.releasePointerCapture(e.pointerId);
        handle.classList.remove("active");
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        this.handleResize();
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

    // Right column slots in order (4 rows now)
    const rightSlots: CardSlot[] = ["terminal", "git", "files", "stats"];

    // Calculate row tracks, accounting for collapsed cards
    const hasCollapsed = rightSlots.some((s) => this.collapsedSlots.has(s));

    if (hasCollapsed) {
      // Use fixed height for collapsed, 1fr for expanded
      const rowTracks = rightSlots.map((slot) => {
        return this.collapsedSlots.has(slot) ? "28px" : "1fr";
      });
      this.gridContainer.style.gridTemplateRows = rowTracks.join(" ");
    } else {
      // Use percentage-based splits when all expanded (4 rows)
      const row1 = (this.rowSplits[0] * 100).toFixed(2) + "%";
      const row2 = ((this.rowSplits[1] - this.rowSplits[0]) * 100).toFixed(2) + "%";
      const row3 = ((this.rowSplits[2] - this.rowSplits[1]) * 100).toFixed(2) + "%";
      const row4 = ((1 - this.rowSplits[2]) * 100).toFixed(2) + "%";
      this.gridContainer.style.gridTemplateRows = `${row1} ${row2} ${row3} ${row4}`;
    }

    // Position drag handles
    this.positionHandles();
  }

  private positionHandles(): void {
    const handles = this.gridContainer.querySelectorAll(".drag-handle");
    const colHandle = handles[0] as HTMLElement;
    const rowHandle1 = handles[1] as HTMLElement;
    const rowHandle2 = handles[2] as HTMLElement;
    const rowHandle3 = handles[3] as HTMLElement;

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
    if (rowHandle3) {
      rowHandle3.style.top = `calc(${(this.rowSplits[2] * 100).toFixed(2)}% - 3px)`;
      rowHandle3.style.left = `${(this.colSplit * 100).toFixed(2)}%`;
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

      // Migrate v1 to v2
      if (state.version === 1) {
        console.info("tugdeck: migrating layout from v1 to v2");
        // v1 had 2-element rowSplits for git/files/stats (3 rows)
        // v2 has 3-element rowSplits for terminal/git/files/stats (4 rows)
        // Prepend 0.25 and scale existing into remaining 75%
        const oldSplits = state.rowSplits || [1/3, 2/3];
        this.rowSplits = [
          0.25,
          0.25 + oldSplits[0] * 0.75,
          0.25 + oldSplits[1] * 0.75
        ];
        this.colSplit = state.colSplit || 0.667;
        // Keep collapsed state if valid
        if (Array.isArray(state.collapsed)) {
          const validSlots: CardSlot[] = ["conversation", "terminal", "git", "files", "stats"];
          const filtered = state.collapsed.filter((s) => validSlots.includes(s as CardSlot));
          this.collapsedSlots = new Set(filtered as CardSlot[]);
        }
        // Save migrated layout
        this.scheduleSave();
        return;
      }

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

      // Validate and apply rowSplits (3 elements for v2)
      if (
        Array.isArray(state.rowSplits) &&
        state.rowSplits.length === 3 &&
        state.rowSplits[0] >= 0.1 &&
        state.rowSplits[1] >= state.rowSplits[0] + 0.1 &&
        state.rowSplits[2] >= state.rowSplits[1] + 0.1 &&
        state.rowSplits[2] <= 0.9
      ) {
        this.rowSplits = state.rowSplits;
      }

      // Validate and apply collapsed state
      if (Array.isArray(state.collapsed)) {
        const validSlots: CardSlot[] = ["conversation", "terminal", "git", "files", "stats"];
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
