/**
 * Stats card implementation (stub)
 *
 * Placeholder for Phase 3 stats dashboard.
 */

import { FeedIdValue } from "../protocol";
import { TugCard } from "./card";

export class StatsCard implements TugCard {
  readonly feedIds: readonly FeedIdValue[] = [];

  private container: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.container = container;
    this.container.classList.add("stats-card");

    // Create header
    const header = document.createElement("div");
    header.className = "card-header";
    header.textContent = "Stats";
    this.container.appendChild(header);

    // Create placeholder
    const placeholder = document.createElement("div");
    placeholder.className = "placeholder";
    placeholder.textContent = "Coming soon";
    this.container.appendChild(placeholder);
  }

  onFrame(_feedId: FeedIdValue, _payload: Uint8Array): void {
    // No-op: stub card has no feed subscription
  }

  onResize(_width: number, _height: number): void {
    // No-op
  }

  destroy(): void {
    if (this.container) {
      this.container.innerHTML = "";
      this.container = null;
    }
  }
}
