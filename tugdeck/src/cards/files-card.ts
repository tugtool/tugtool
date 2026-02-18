/**
 * Files card implementation
 *
 * Displays filesystem events as a scrolling log.
 */

import { createElement, FilePlus, FilePen, FileX, FileSymlink } from "lucide";
import { FeedId, FeedIdValue } from "../protocol";
import { TugCard, type TugCardMeta } from "./card";

/** FsEvent as serialized by tugcast-core (matches Spec S01) */
interface FsEvent {
  kind: "Created" | "Modified" | "Removed" | "Renamed";
  path?: string;
  from?: string;
  to?: string;
}

export class FilesCard implements TugCard {
  readonly feedIds: readonly FeedIdValue[] = [FeedId.FILESYSTEM];

  get meta(): TugCardMeta {
    return {
      title: "Files",
      icon: "FolderOpen",
      closable: true,
      menuItems: [
        {
          type: "action",
          label: "Clear History",
          action: () => {
            if (this.eventList) this.eventList.innerHTML = "";
          },
        },
        {
          type: "select",
          label: "Max Entries",
          options: ["50", "100", "200"],
          value: String(this.maxEntries),
          action: (value: string) => {
            this.maxEntries = parseInt(value, 10);
            // Immediately trim excess entries if needed
            if (this.eventList) {
              while (this.eventList.children.length > this.maxEntries) {
                this.eventList.removeChild(this.eventList.firstChild!);
              }
            }
          },
        },
      ],
    };
  }

  private maxEntries = 100;

  private container: HTMLElement | null = null;
  private eventList: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.container = container;
    this.container.classList.add("files-card");

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

    // Autoscroll: check if user is already at the bottom before appending
    const el = this.eventList;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;

    // Render each event, append to list (newest at bottom)
    for (const event of events) {
      const entry = document.createElement("div");
      entry.className = `event-entry event-${event.kind.toLowerCase()}`;

      const iconSpan = document.createElement("span");
      iconSpan.className = "event-icon";
      iconSpan.appendChild(this.iconForKind(event.kind));

      const labelSpan = document.createElement("span");
      labelSpan.className = "event-label";
      labelSpan.textContent = this.labelForEvent(event);

      entry.appendChild(iconSpan);
      entry.appendChild(labelSpan);
      el.appendChild(entry);
    }

    // Cap visible entries (remove oldest from top)
    while (el.children.length > this.maxEntries) {
      el.removeChild(el.firstChild!);
    }

    // Autoscroll if user was at the bottom
    if (atBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }

  onResize(_width: number, _height: number): void {
    // CSS handles scrolling, no action needed
  }

  destroy(): void {
    if (this.container) {
      this.container.innerHTML = "";
      this.container = null;
      this.eventList = null;
    }
  }

  private iconForKind(kind: string): Element {
    switch (kind) {
      case "Created":
        return createElement(FilePlus, { width: 14, height: 14 });
      case "Modified":
        return createElement(FilePen, { width: 14, height: 14 });
      case "Removed":
        return createElement(FileX, { width: 14, height: 14 });
      case "Renamed":
        return createElement(FileSymlink, { width: 14, height: 14 });
      default:
        return createElement(FileX, { width: 14, height: 14 });
    }
  }

  private labelForEvent(event: FsEvent): string {
    if (event.kind === "Renamed") {
      return `${event.from} → ${event.to}`;
    }
    return event.path ?? "";
  }
}
