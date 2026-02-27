/**
 * FilesCard — React functional component for the Files card.
 *
 * Renders filesystem events as a scrolling log using shadcn ScrollArea.
 * Uses useFeed to subscribe to FeedId.FILESYSTEM and useCardMeta to provide
 * dynamic meta with "Clear History" and "Max Entries" menu items.
 *
 * Replaces the vanilla FilesCard class (src/cards/files-card.ts),
 * which is retained until Step 10 bulk deletion.
 *
 * References: [D03] React content only, [D06] Replace tests,
 *             [D08] React adapter, Table T03
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { FilePlus, FilePen, FileX, FileSymlink } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFeed } from "../../hooks/use-feed";
import { useCardMeta } from "../../hooks/use-card-meta";
import { FeedId } from "../../protocol";
import type { TugCardMeta } from "../../cards/card";

// ---- Types ----

interface FsEvent {
  kind: "Created" | "Modified" | "Removed" | "Renamed";
  path?: string;
  from?: string;
  to?: string;
}

interface EventEntry {
  id: number;
  kind: FsEvent["kind"];
  label: string;
}

// ---- Icon for event kind ----

function EventIcon({ kind }: { kind: FsEvent["kind"] }) {
  const props = { size: 14, "aria-hidden": true } as const;
  switch (kind) {
    case "Created":
      return <FilePlus {...props} />;
    case "Modified":
      return <FilePen {...props} />;
    case "Removed":
      return <FileX {...props} />;
    case "Renamed":
      return <FileSymlink {...props} />;
    default:
      return <FileX {...props} />;
  }
}

function labelForEvent(event: FsEvent): string {
  if (event.kind === "Renamed") {
    return `${event.from} → ${event.to}`;
  }
  return event.path ?? "";
}

// ---- Max entries options ----

const MAX_ENTRIES_OPTIONS = ["50", "100", "200"] as const;
type MaxEntriesOption = (typeof MAX_ENTRIES_OPTIONS)[number];

// ---- Component ----

export function FilesCard() {
  const feedPayload = useFeed(FeedId.FILESYSTEM);
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [maxEntries, setMaxEntries] = useState(100);
  const idCounter = useRef(0);

  // ---- Clear history action ----

  const handleClearHistory = useCallback(() => {
    setEvents([]);
  }, []);

  // ---- Max entries select action ----

  const handleMaxEntriesChange = useCallback((value: string) => {
    const n = parseInt(value, 10);
    setMaxEntries(n);
    setEvents((prev) => (prev.length > n ? prev.slice(prev.length - n) : prev));
  }, []);

  // ---- Card meta with dynamic menu items ----

  const meta = useMemo<TugCardMeta>(
    () => ({
      title: "Files",
      icon: "FolderOpen",
      closable: true,
      menuItems: [
        {
          type: "action",
          label: "Clear History",
          action: handleClearHistory,
        },
        {
          type: "select",
          label: "Max Entries",
          options: [...MAX_ENTRIES_OPTIONS],
          value: String(maxEntries) as MaxEntriesOption,
          action: handleMaxEntriesChange,
        },
      ],
    }),
    [maxEntries, handleClearHistory, handleMaxEntriesChange]
  );

  useCardMeta(meta);

  // ---- Parse and append incoming feed frames ----

  useEffect(() => {
    if (!feedPayload || feedPayload.length === 0) return;

    const text = new TextDecoder().decode(feedPayload);
    let incoming: FsEvent[];
    try {
      incoming = JSON.parse(text);
    } catch {
      console.error("files-card: failed to parse FsEvent payload");
      return;
    }

    const newEntries: EventEntry[] = incoming.map((event) => ({
      id: ++idCounter.current,
      kind: event.kind,
      label: labelForEvent(event),
    }));

    setEvents((prev) => {
      const combined = [...prev, ...newEntries];
      // Cap to maxEntries (trim oldest from front)
      return combined.length > maxEntries
        ? combined.slice(combined.length - maxEntries)
        : combined;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedPayload]);

  // ---- Trim on maxEntries change ----

  useEffect(() => {
    setEvents((prev) =>
      prev.length > maxEntries ? prev.slice(prev.length - maxEntries) : prev
    );
  }, [maxEntries]);

  // ---- Render ----

  return (
    <ScrollArea className="h-full w-full">
      <div className="flex flex-col gap-0.5 p-2" aria-label="Filesystem events">
        {events.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No events yet
          </p>
        )}
        {events.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted/50"
            data-kind={entry.kind.toLowerCase()}
          >
            <span className="shrink-0 text-muted-foreground">
              <EventIcon kind={entry.kind} />
            </span>
            <span className="min-w-0 truncate font-mono">{entry.label}</span>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
