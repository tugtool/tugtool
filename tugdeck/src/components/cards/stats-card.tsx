/**
 * StatsCard — React functional component for the Stats card.
 *
 * Renders process info (CPU/Memory), token usage, and build status sections,
 * each with a sparkline (Canvas 2D). Subscribes to STATS_PROCESS_INFO,
 * STATS_TOKEN_USAGE, and STATS_BUILD_STATUS feeds.
 *
 * Replaces the vanilla StatsCard class (src/cards/stats-card.ts),
 * which is retained until Step 10 bulk deletion.
 *
 * References: [D03] React content only, [D06] Replace tests, Table T03
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Activity, Coins, Hammer } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFeed } from "../../hooks/use-feed";
import { useCardMeta } from "../../hooks/use-card-meta";
import { FeedId } from "../../protocol";
import type { TugCardMeta } from "../../cards/card";

// ---- Types ----

interface ProcessInfoData {
  cpu_percent?: number;
  memory_mb?: number;
}

interface TokenUsageData {
  total_tokens?: number | null;
  context_window_percent?: number | null;
}

interface BuildStatusData {
  status?: string;
}

// ---- Sparkline ----

interface SparklineProps {
  values: number[];
  color: string;
  width: number;
  height: number;
}

function Sparkline({ values, color, width, height }: SparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    if (values.length < 2) return;

    let min = Math.min(...values);
    let max = Math.max(...values);

    if (max === min) {
      min = max - 0.5;
      max = max + 0.5;
    }

    const range = max - min;
    const xStep = width / (values.length - 1);

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;

    for (let i = 0; i < values.length; i++) {
      const x = i * xStep;
      const y = height - ((values[i] - min) / range) * height;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
  }, [values, color, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="sparkline-canvas w-full"
      aria-hidden
    />
  );
}

// ---- Sub-card ----

interface StatSubCardProps {
  name: string;
  value: string;
  isNA?: boolean;
  sparklineValues: number[];
  sparklineColor: string;
  icon: React.ReactNode;
  visible: boolean;
}

function StatSubCard({
  name,
  value,
  isNA,
  sparklineValues,
  sparklineColor,
  icon,
  visible,
}: StatSubCardProps) {
  if (!visible) return null;

  return (
    <div className="stat-sub-card flex flex-col gap-1 rounded border p-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {icon}
          <span>{name}</span>
        </span>
        <span
          className={`text-xs font-medium ${isNA ? "text-muted-foreground" : ""}`}
          aria-label={`${name} value`}
        >
          {value}
        </span>
      </div>
      <Sparkline
        values={sparklineValues}
        color={sparklineColor}
        width={300}
        height={32}
      />
    </div>
  );
}

// ---- Main component ----

const BUFFER_SIZE_OPTIONS = ["30", "60", "120"] as const;

export function StatsCard() {
  const processInfoPayload = useFeed(FeedId.STATS_PROCESS_INFO);
  const tokenUsagePayload = useFeed(FeedId.STATS_TOKEN_USAGE);
  const buildStatusPayload = useFeed(FeedId.STATS_BUILD_STATUS);

  // Process info state
  const [processInfoValue, setProcessInfoValue] = useState("--");
  const [processInfoSpark, setProcessInfoSpark] = useState<number[]>([]);

  // Token usage state
  const [tokenUsageValue, setTokenUsageValue] = useState("--");
  const [tokenUsageIsNA, setTokenUsageIsNA] = useState(false);
  const [tokenUsageSpark, setTokenUsageSpark] = useState<number[]>([]);

  // Build status state
  const [buildStatusValue, setBuildStatusValue] = useState("--");
  const [buildStatusSpark, setBuildStatusSpark] = useState<number[]>([]);

  // Visibility state
  const [showProcessInfo, setShowProcessInfo] = useState(true);
  const [showTokenUsage, setShowTokenUsage] = useState(true);
  const [showBuildStatus, setShowBuildStatus] = useState(true);

  // Buffer size (sparkline timeframe)
  const [bufferSize, setBufferSize] = useState(60);

  // ---- Feed processing ----

  useEffect(() => {
    if (!processInfoPayload || processInfoPayload.length === 0) return;
    try {
      const data = JSON.parse(
        new TextDecoder().decode(processInfoPayload)
      ) as ProcessInfoData;
      const cpuPercent = (data.cpu_percent ?? 0).toFixed(1);
      const memoryMb = (data.memory_mb ?? 0).toFixed(0);
      setProcessInfoValue(`CPU: ${cpuPercent}%  Mem: ${memoryMb}MB`);
      setProcessInfoSpark((prev) => {
        const next = [...prev, data.cpu_percent ?? 0];
        return next.length > bufferSize ? next.slice(next.length - bufferSize) : next;
      });
    } catch {
      console.error("stats-card: failed to parse STATS_PROCESS_INFO payload");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processInfoPayload]);

  useEffect(() => {
    if (!tokenUsagePayload || tokenUsagePayload.length === 0) return;
    try {
      const data = JSON.parse(
        new TextDecoder().decode(tokenUsagePayload)
      ) as TokenUsageData | null;
      if (data === null || data?.total_tokens === null || data?.total_tokens === undefined) {
        setTokenUsageValue("N/A");
        setTokenUsageIsNA(true);
        setTokenUsageSpark((prev) => {
          const next = [...prev, 0];
          return next.length > bufferSize ? next.slice(next.length - bufferSize) : next;
        });
      } else {
        const total = data.total_tokens ?? 0;
        const contextPct = (data.context_window_percent ?? 0).toFixed(1);
        setTokenUsageValue(`${total} tokens (${contextPct}%)`);
        setTokenUsageIsNA(false);
        setTokenUsageSpark((prev) => {
          const next = [...prev, total];
          return next.length > bufferSize ? next.slice(next.length - bufferSize) : next;
        });
      }
    } catch {
      console.error("stats-card: failed to parse STATS_TOKEN_USAGE payload");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenUsagePayload]);

  useEffect(() => {
    if (!buildStatusPayload || buildStatusPayload.length === 0) return;
    try {
      const data = JSON.parse(
        new TextDecoder().decode(buildStatusPayload)
      ) as BuildStatusData;
      const status = data.status ?? "idle";
      setBuildStatusValue(status);
      setBuildStatusSpark((prev) => {
        const next = [...prev, status === "building" ? 1 : 0];
        return next.length > bufferSize ? next.slice(next.length - bufferSize) : next;
      });
    } catch {
      console.error("stats-card: failed to parse STATS_BUILD_STATUS payload");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildStatusPayload]);

  // ---- Menu actions ----

  const handleToggleProcessInfo = useCallback(() => {
    setShowProcessInfo((prev) => !prev);
  }, []);

  const handleToggleTokenUsage = useCallback(() => {
    setShowTokenUsage((prev) => !prev);
  }, []);

  const handleToggleBuildStatus = useCallback(() => {
    setShowBuildStatus((prev) => !prev);
  }, []);

  const handleSparklineTimeframe = useCallback((value: string) => {
    const seconds = parseInt(value, 10);
    setBufferSize(seconds);
    // Reset sparkline buffers when timeframe changes
    setProcessInfoSpark([]);
    setTokenUsageSpark([]);
    setBuildStatusSpark([]);
  }, []);

  // ---- Card meta ----

  const meta = useMemo<TugCardMeta>(
    () => ({
      title: "Stats",
      icon: "Activity",
      closable: true,
      menuItems: [
        {
          type: "select",
          label: "Sparkline Timeframe",
          options: [...BUFFER_SIZE_OPTIONS].map((s) => `${s}s`),
          value: `${bufferSize}s`,
          action: (value: string) => handleSparklineTimeframe(value.replace("s", "")),
        },
        {
          type: "toggle",
          label: "Show CPU / Memory",
          checked: showProcessInfo,
          action: handleToggleProcessInfo,
        },
        {
          type: "toggle",
          label: "Show Token Usage",
          checked: showTokenUsage,
          action: handleToggleTokenUsage,
        },
        {
          type: "toggle",
          label: "Show Build Status",
          checked: showBuildStatus,
          action: handleToggleBuildStatus,
        },
      ],
    }),
    [
      bufferSize,
      showProcessInfo,
      showTokenUsage,
      showBuildStatus,
      handleSparklineTimeframe,
      handleToggleProcessInfo,
      handleToggleTokenUsage,
      handleToggleBuildStatus,
    ]
  );

  useCardMeta(meta);

  // Sparkline colors derived from CSS custom properties
  const colors = {
    processInfo: "var(--chart-1, #3b82f6)",
    tokenUsage: "var(--chart-2, #10b981)",
    buildStatus: "var(--chart-3, #f59e0b)",
  };

  return (
    <ScrollArea className="h-full w-full">
      <div className="flex flex-col gap-2 p-2">
        <StatSubCard
          name="CPU / Memory"
          value={processInfoValue}
          sparklineValues={processInfoSpark}
          sparklineColor={colors.processInfo}
          icon={<Activity size={12} aria-hidden />}
          visible={showProcessInfo}
        />
        <StatSubCard
          name="Token Usage"
          value={tokenUsageValue}
          isNA={tokenUsageIsNA}
          sparklineValues={tokenUsageSpark}
          sparklineColor={colors.tokenUsage}
          icon={<Coins size={12} aria-hidden />}
          visible={showTokenUsage}
        />
        <StatSubCard
          name="Build Status"
          value={buildStatusValue}
          sparklineValues={buildStatusSpark}
          sparklineColor={colors.buildStatus}
          icon={<Hammer size={12} aria-hidden />}
          visible={showBuildStatus}
        />
      </div>
    </ScrollArea>
  );
}
