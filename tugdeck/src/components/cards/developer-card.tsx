/**
 * DeveloperCard — React functional component for the Developer card.
 *
 * Shows dev mode status for 3 file categories:
 *   Styles  (CSS/HTML in tugdeck/)
 *   Code    (TS/TSX in tugdeck/src/, RS/Cargo.toml in tugcode/)
 *   App     (.swift in tugapp/Sources/)
 *
 * Each row has a status dot, label, status text, and optional action button.
 * Row state machine: Clean (green) → Edited (yellow) → Stale (amber, shows button)
 *
 * Bridge events:
 *   Listens for  "td-dev-notification" CustomEvent on document
 *   Dispatches   "td-dev-badge" CustomEvent with total stale count
 *
 * Replaces the vanilla DeveloperCard class (src/cards/developer-card.ts),
 * which is retained until Step 10 bulk deletion.
 *
 * References: [D03] React content only, [D04] CustomEvents, [D06] Replace tests,
 *             [D08] React adapter, Table T03
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useFeed } from "../../hooks/use-feed";
import { useConnection } from "../../hooks/use-connection";
import { FeedId } from "../../protocol";

/**
 * Categorize a file path into one of three developer-card categories.
 *
 * Moved from vanilla developer-card.ts (deleted in Step 10).
 * Exported so developer-card.test.tsx can import it from the same module path.
 *
 * @returns "styles" | "code" | "app" | null
 */
export function categorizeFile(path: string): "styles" | "code" | "app" | null {
  // tugapp Swift source
  if (path.startsWith("tugapp/") && path.endsWith(".swift")) {
    return "app";
  }
  // tugdeck CSS/HTML (check before code patterns so tugdeck/src/styles.css → styles)
  if (path.startsWith("tugdeck/") && (path.endsWith(".css") || path.endsWith(".html"))) {
    return "styles";
  }
  // tugdeck TypeScript source
  if (path.startsWith("tugdeck/") && (path.endsWith(".ts") || path.endsWith(".tsx"))) {
    return "code";
  }
  // tugcode Rust source or Cargo.toml
  if (path.startsWith("tugcode/") && (path.endsWith(".rs") || path.endsWith("Cargo.toml"))) {
    return "code";
  }
  return null;
}

// ---- Types ----

interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: { path: string; status: string }[];
  unstaged: { path: string; status: string }[];
  untracked: string[];
  head_sha: string;
  head_message: string;
}

interface DevNotificationEvent {
  type: "reloaded" | "restart_available" | "relaunch_available";
  count?: number;
  timestamp?: number;
}

type DotColor = "green" | "yellow" | "amber";

interface RowState {
  editedCount: number;
  lastCleanTs: number | null;
  firstDirtySinceTs: number | null;
  isStale: boolean;
  staleCount: number;
}

// ---- Helpers ----

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function cleanLabel(ts: number | null): string {
  return ts !== null ? `Clean -- ${formatTime(ts)}` : "Clean";
}

function dirtyLabel(count: number, sinceTs: number | null): string {
  const countPart = count === 1 ? "1 change" : `${count} changes`;
  return sinceTs !== null ? `${countPart} -- since ${formatTime(sinceTs)}` : countPart;
}

function editedLabel(count: number, ts: number | null): string {
  const plural = count === 1 ? "file" : "files";
  const base = `Edited (${count} ${plural})`;
  return ts !== null ? `${base} -- ${formatTime(ts)}` : base;
}

// ---- Row sub-component ----

interface DevRowProps {
  label: string;
  statusText: string;
  dotColor: DotColor;
  showActionBtn: boolean;
  actionLabel: string;
  onAction: () => void;
  hidden?: boolean;
}

function DevRow({
  label,
  statusText,
  dotColor,
  showActionBtn,
  actionLabel,
  onAction,
  hidden,
}: DevRowProps) {
  if (hidden) return null;

  const dotStyle: React.CSSProperties = {
    backgroundColor:
      dotColor === "green"
        ? "var(--td-success, #22c55e)"
        : dotColor === "yellow"
          ? "var(--td-info, #3b82f6)"
          : "var(--td-warning, #f59e0b)",
  };

  return (
    <div className="dev-row flex items-center gap-2 px-2 py-1.5">
      <span
        className="dev-dot h-2.5 w-2.5 shrink-0 rounded-full"
        style={dotStyle}
        aria-hidden
      />
      <span className="dev-label w-14 shrink-0 text-xs font-medium">{label}</span>
      <span className="dev-status min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {statusText}
      </span>
      {showActionBtn && (
        <Button
          size="sm"
          variant="outline"
          className="dev-action-btn h-6 px-2 text-xs"
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

// ---- Component ----

export function DeveloperCard() {
  const feedPayload = useFeed(FeedId.GIT);
  const connection = useConnection();

  // Per-row state
  const [stylesRow, setStylesRow] = useState<RowState>({
    editedCount: 0,
    lastCleanTs: null,
    firstDirtySinceTs: null,
    isStale: false,
    staleCount: 0,
  });
  const [codeRow, setCodeRow] = useState<RowState>({
    editedCount: 0,
    lastCleanTs: null,
    firstDirtySinceTs: null,
    isStale: false,
    staleCount: 0,
  });
  const [appRow, setAppRow] = useState<RowState>({
    editedCount: 0,
    lastCleanTs: null,
    firstDirtySinceTs: null,
    isStale: false,
    staleCount: 0,
  });

  // Styles "Reloaded" flash state
  const [stylesFlashing, setStylesFlashing] = useState(false);
  const [stylesFlashText, setStylesFlashText] = useState<string | null>(null);
  const reloadedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pending-flag refs for restart/relaunch confirmation pattern.
  // Refs (not state) so that changes do not trigger re-renders.
  const restartPendingRef = useRef<boolean>(false);
  const relaunchPendingRef = useRef<boolean>(false);

  // Build progress state
  const [buildProgress, setBuildProgress] = useState<{
    stage: string;
    status: string;
    error?: string;
  } | null>(null);

  // WebKit bridge availability
  const hasWebKit = typeof (window as any).webkit !== "undefined";

  // ---- Dispatch badge count on mount and on stale changes ----

  const dispatchBadge = useCallback((count: number) => {
    document.dispatchEvent(
      new CustomEvent("td-dev-badge", { detail: { count } })
    );
  }, []);

  // Clear badge on mount
  useEffect(() => {
    dispatchBadge(0);
  }, [dispatchBadge]);

  // Dispatch badge when stale counts change
  useEffect(() => {
    const total = (codeRow.isStale ? codeRow.staleCount : 0) +
      (appRow.isStale ? appRow.staleCount : 0);
    dispatchBadge(total);
  }, [
    codeRow.isStale,
    codeRow.staleCount,
    appRow.isStale,
    appRow.staleCount,
    dispatchBadge,
  ]);

  // ---- Parse git feed ----

  useEffect(() => {
    if (!feedPayload || feedPayload.length === 0) return;

    const text = new TextDecoder().decode(feedPayload);
    let status: GitStatus;
    try {
      status = JSON.parse(text);
    } catch {
      console.error("developer-card: failed to parse GitStatus payload");
      return;
    }

    // Collect unique paths from staged and unstaged (ignore untracked)
    const paths = new Set<string>();
    for (const f of status.staged) paths.add(f.path);
    for (const f of status.unstaged) paths.add(f.path);

    let stylesCount = 0;
    let codeCount = 0;
    let appCount = 0;

    for (const path of paths) {
      const cat = categorizeFile(path);
      if (cat === "styles") stylesCount++;
      else if (cat === "code") codeCount++;
      else if (cat === "app") appCount++;
    }

    setStylesRow((prev) => ({ ...prev, editedCount: stylesCount }));
    setCodeRow((prev) => ({ ...prev, editedCount: codeCount }));
    setAppRow((prev) => ({ ...prev, editedCount: appCount }));
  }, [feedPayload]);

  // ---- Listen for td-dev-notification ----

  useEffect(() => {
    function handleDevNotification(e: Event) {
      const payload = (e as CustomEvent<DevNotificationEvent>).detail;
      const { type, count, timestamp } = payload;

      // Pending-flag confirmation pattern: clear stale state for the row that was
      // restarted/relaunched when any dev_notification arrives from the new instance.
      // Any notification proves the new tugcast instance is running.
      if (restartPendingRef.current) {
        restartPendingRef.current = false;
        setCodeRow((prev) => ({
          ...prev,
          isStale: false,
          staleCount: 0,
          firstDirtySinceTs: null,
          lastCleanTs: timestamp ?? Date.now(),
        }));
      }
      if (relaunchPendingRef.current) {
        relaunchPendingRef.current = false;
        setAppRow((prev) => ({
          ...prev,
          isStale: false,
          staleCount: 0,
          firstDirtySinceTs: null,
          lastCleanTs: timestamp ?? Date.now(),
        }));
      }

      if (type === "reloaded") {
        if (timestamp !== undefined) {
          setStylesRow((prev) => ({ ...prev, lastCleanTs: timestamp }));
        }
        // Start "Reloaded" flash
        setStylesFlashing(true);
        setStylesFlashText("Reloaded");
        if (reloadedTimerRef.current) clearTimeout(reloadedTimerRef.current);
        reloadedTimerRef.current = setTimeout(() => {
          reloadedTimerRef.current = null;
          setStylesFlashing(false);
          setStylesFlashText(null);
        }, 2000);
      } else if (type === "restart_available") {
        setCodeRow((prev) => {
          const firstDirty =
            prev.firstDirtySinceTs === null && timestamp !== undefined
              ? timestamp
              : prev.firstDirtySinceTs;
          return {
            ...prev,
            isStale: true,
            staleCount: count ?? 0,
            firstDirtySinceTs: firstDirty,
          };
        });
      } else if (type === "relaunch_available") {
        setAppRow((prev) => {
          const firstDirty =
            prev.firstDirtySinceTs === null && timestamp !== undefined
              ? timestamp
              : prev.firstDirtySinceTs;
          return {
            ...prev,
            isStale: true,
            staleCount: count ?? 0,
            firstDirtySinceTs: firstDirty,
          };
        });
      }
    }

    document.addEventListener("td-dev-notification", handleDevNotification);
    return () => {
      document.removeEventListener("td-dev-notification", handleDevNotification);
    };
  }, []);

  // ---- Listen for td-dev-build-progress ----

  useEffect(() => {
    function handleBuildProgress(e: Event) {
      const payload = (e as CustomEvent<{
        stage?: string;
        status?: string;
        error?: string;
      }>).detail;
      if (payload.stage && payload.status) {
        setBuildProgress({
          stage: payload.stage,
          status: payload.status,
          error: payload.error,
        });
      } else {
        setBuildProgress(null);
      }
    }

    document.addEventListener("td-dev-build-progress", handleBuildProgress);
    return () => {
      document.removeEventListener("td-dev-build-progress", handleBuildProgress);
    };
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (reloadedTimerRef.current) {
        clearTimeout(reloadedTimerRef.current);
        reloadedTimerRef.current = null;
      }
    };
  }, []);

  // ---- Action handlers ----

  const handleRestart = useCallback(() => {
    restartPendingRef.current = true;
    connection?.sendControlFrame("restart");
  }, [connection]);

  const handleRelaunch = useCallback(() => {
    relaunchPendingRef.current = true;
    connection?.sendControlFrame("relaunch");
  }, [connection]);

  const handleReset = useCallback(() => {
    localStorage.clear();
    dispatchBadge(0);
    connection?.sendControlFrame("reset");
  }, [connection, dispatchBadge]);

  // ---- Compute row display values ----

  function getRowDisplay(
    row: RowState,
    isStyles: boolean
  ): { statusText: string; dotColor: DotColor; showBtn: boolean } {
    // Flash guard for styles row
    if (isStyles && stylesFlashing && stylesFlashText) {
      return { statusText: stylesFlashText, dotColor: "green", showBtn: false };
    }

    if (!isStyles && row.isStale) {
      return {
        statusText: dirtyLabel(row.staleCount, row.firstDirtySinceTs),
        dotColor: "amber",
        showBtn: true,
      };
    }

    if (row.editedCount > 0) {
      return {
        statusText: editedLabel(row.editedCount, row.lastCleanTs),
        dotColor: "yellow",
        showBtn: false,
      };
    }

    return {
      statusText: cleanLabel(row.lastCleanTs),
      dotColor: "green",
      showBtn: false,
    };
  }

  const stylesDisplay = getRowDisplay(stylesRow, true);
  const codeDisplay = getRowDisplay(codeRow, false);
  const appDisplay = getRowDisplay(appRow, false);

  // ---- Render ----

  return (
    <div className="developer-card flex h-full flex-col">
      <div className="developer-content flex flex-col gap-0.5 py-2">
        <DevRow
          label="Styles"
          statusText={stylesDisplay.statusText}
          dotColor={stylesDisplay.dotColor}
          showActionBtn={false}
          actionLabel=""
          onAction={() => {}}
        />
        <DevRow
          label="Code"
          statusText={codeDisplay.statusText}
          dotColor={codeDisplay.dotColor}
          showActionBtn={codeDisplay.showBtn}
          actionLabel="Restart"
          onAction={handleRestart}
        />
        <DevRow
          label="App"
          statusText={appDisplay.statusText}
          dotColor={appDisplay.dotColor}
          showActionBtn={appDisplay.showBtn}
          actionLabel="Relaunch"
          onAction={handleRelaunch}
          hidden={!hasWebKit}
        />

        {/* Reset section */}
        <div className="developer-reset-section mt-2 flex items-center gap-2 px-2">
          <Button
            size="sm"
            variant="outline"
            className="dev-reset-btn h-6 px-2 text-xs"
            onClick={handleReset}
          >
            Reset
          </Button>
          <span className="dev-reset-note text-xs text-muted-foreground">
            Clear localStorage and restart
          </span>
        </div>

        {/* Build progress */}
        {buildProgress && (
          <div className="developer-build-progress mt-1 px-2 text-xs text-muted-foreground">
            {buildProgress.stage}: {buildProgress.status}
            {buildProgress.error ? ` (${buildProgress.error})` : ""}
          </div>
        )}
      </div>
    </div>
  );
}
