/**
 * Deck manager for card layout and frame dispatch
 *
 * Phase 2: CSS Grid multi-card layout with drag-handle resize
 */

import { FeedIdValue } from "./protocol";
import { TugCard } from "./cards/card";
import { TugConnection } from "./connection";

/** Card slot names matching CSS grid areas */
export type CardSlot = "terminal" | "git" | "files" | "stats";

/** Minimum card dimension in pixels */
const MIN_CARD_SIZE = 100;

/**
 * Manages card layout and frame dispatch.
 *
 * Creates a CSS Grid layout with named card slots and drag handles for resize.
 */
export class DeckManager {
  private cards: Map<CardSlot, TugCard> = new Map();
  private slots: Map<CardSlot, HTMLElement> = new Map();
  private gridContainer: HTMLElement;
  private connection: TugConnection;

  // Grid track state (in fr units, relative)
  private colSplit = 0.667; // 2fr / (2fr + 1fr) = 0.667
  private rowSplits = [1 / 3, 2 / 3]; // equal thirds

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

    // Update grid tracks from initial state
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
    }
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

    const row1 = (this.rowSplits[0] * 100).toFixed(2) + "%";
    const row2 = ((this.rowSplits[1] - this.rowSplits[0]) * 100).toFixed(2) + "%";
    const row3 = ((1 - this.rowSplits[1]) * 100).toFixed(2) + "%";
    this.gridContainer.style.gridTemplateRows = `${row1} ${row2} ${row3}`;

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

  private handleResize(): void {
    for (const [slot, card] of this.cards) {
      const slotEl = this.slots.get(slot);
      if (slotEl) {
        card.onResize(slotEl.clientWidth, slotEl.clientHeight);
      }
    }
  }

  destroy(): void {
    for (const card of this.cards.values()) {
      card.destroy();
    }
    this.cards.clear();
  }
}
