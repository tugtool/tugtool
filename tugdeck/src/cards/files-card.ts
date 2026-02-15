/**
 * Files card implementation
 *
 * Displays filesystem events as a scrolling log.
 */

import { FeedId, FeedIdValue } from "../protocol";
import { TugCard } from "./card";

/** FsEvent as serialized by tugcast-core (matches Spec S01) */
interface FsEvent {
  kind: "Created" | "Modified" | "Removed" | "Renamed";
  path?: string;
  from?: string;
  to?: string;
}

/** Maximum number of visible event entries */
const MAX_VISIBLE_ENTRIES = 100;

export class FilesCard implements TugCard {
  readonly feedIds: readonly FeedIdValue[] = [FeedId.FILESYSTEM];

  private container: HTMLElement | null = null;
  private header: HTMLElement | null = null;
  private eventList: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.container = container;
    this.container.classList.add("files-card");

    // Create header
    this.header = document.createElement("div");
    this.header.className = "card-header";
    this.header.textContent = "Files";
    this.container.appendChild(this.header);

    // Create scrollable event list
    this.eventList = document.createElement("div");
    this.eventList.className = "event-list";
    this.container.appendChild(this.eventList);
  }

  onFrame(feedId: FeedIdValue, payload: Uint8Array): void {
    if (feedId !== FeedId.FILESYSTEM || !this.eventList) return;
    if (payload.length === 0) return;

    const text = new TextDecoder().decode(payload);
    let events: FsEvent[];
    try {
      events = JSON.parse(text);
    } catch {
      console.error("files-card: failed to parse FsEvent payload");
      return;
    }

    // Render each event, prepend to list (newest first)
    for (const event of events) {
      const entry = document.createElement("div");
      entry.className = `event-entry event-${event.kind.toLowerCase()}`;

      const icon = this.iconForKind(event.kind);
      const label = this.labelForEvent(event);

      entry.innerHTML = `<span class="event-icon">${icon}</span><span class="event-label">${label}</span>`;
      this.eventList.prepend(entry);
    }

    // Cap visible entries
    while (this.eventList.children.length > MAX_VISIBLE_ENTRIES) {
      this.eventList.removeChild(this.eventList.lastChild!);
    }
  }

  onResize(_width: number, _height: number): void {
    // CSS handles scrolling, no action needed
  }

  destroy(): void {
    if (this.container) {
      this.container.innerHTML = "";
      this.container = null;
      this.header = null;
      this.eventList = null;
    }
  }

  private iconForKind(kind: string): string {
    switch (kind) {
      case "Created":
        return "+";
      case "Modified":
        return "~";
      case "Removed":
        return "-";
      case "Renamed":
        return ">";
      default:
        return "?";
    }
  }

  private labelForEvent(event: FsEvent): string {
    if (event.kind === "Renamed") {
      return `${event.from} → ${event.to}`;
    }
    return event.path ?? "";
  }
}
