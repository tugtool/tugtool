/**
 * POC: 7-Role Semantic Color System — mock cards.
 *
 * Five card types demonstrating how the expanded 7-role color model
 * creates distinct visual zones in an AI coding IDE:
 *
 *   1. poc-chat          — AI chat (ACCENT domain — user's home base)
 *   2. poc-agent-feed    — Background agent stream (neutral — status signals only)
 *   3. poc-telemetry     — Metrics sparklines (DATA domain)
 *   4. poc-git-status    — File states (ACTIVE domain + signals)
 *   5. poc-phase-progress — Plan step tracker (mixed domains)
 *
 * All content is static/mocked. Color tokens from poc-seven-role.css.
 *
 * @module components/tugways/cards/poc-seven-role-cards
 */

import React from "react";
import { registerCard } from "@/card-registry";

// ---------------------------------------------------------------------------
// 1. Chat Card (ACCENT domain — user's home base, warm orange identity)
//    Violet appears ONLY on the live "Thinking…" indicator.
// ---------------------------------------------------------------------------

function PocChatContent() {
  return (
    <div className="poc-card" data-role="accent" data-testid="poc-chat">
      <div className="poc-tabs">
        <div className="poc-tab poc-tab-accent" data-active="true">Feature design</div>
        <div className="poc-tab">Bug triage</div>
        <div className="poc-tab">Refactor</div>
      </div>
      <div className="poc-card-body" style={{ gap: "8px" }}>
        <div className="poc-chat-user">
          Add a sparkline component that supports area, line, and bar variants.
          It should use tug-base tokens and respond to theme changes.
        </div>
        <div className="poc-chat-ai-subtle">
          I&apos;ll create <code>TugSparkline</code> with three variants. The
          component will use an inline SVG with paths computed from a numeric
          data array. Colors will reference <code>--tug-base-tone-*</code>{" "}
          tokens so theme switching works automatically.
          <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
            <span className="poc-badge poc-badge-outlined" data-role="agent">Opus 4</span>
            <span className="poc-metric">1,247 tokens</span>
          </div>
        </div>
        <div className="poc-chat-user">
          Sounds good. Also add threshold lines for caution and danger levels.
        </div>
        <div className="poc-chat-ai-subtle">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="poc-spinner" />
            <span style={{ color: "var(--poc-agent)", fontSize: 12 }}>Thinking…</span>
          </div>
        </div>
      </div>
      <div className="poc-chat-input-row">
        <input className="poc-chat-input" placeholder="Ask a question…" readOnly />
        <button className="poc-btn poc-btn-filled" data-role="accent">Send</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Agent Feed Card (neutral domain — status signals carry the meaning)
//    Violet appears ONLY on the one actively-running item (spinner).
//    Agent names are plain muted text, not colored badges.
// ---------------------------------------------------------------------------

function PocAgentFeedContent() {
  const items: { icon: string; role: string; agent: string; msg: string; time: string; active?: boolean }[] = [
    { icon: "✓", role: "success", agent: "Reviewer",  msg: "Approved step 3 — all checkpoints pass", time: "2s ago" },
    { icon: "▸", role: "agent",   agent: "Coder",     msg: "Implementing step 4: TugSparkline component", time: "12s ago", active: true },
    { icon: "✓", role: "success", agent: "Coder",     msg: "Completed step 3: TugLinearGauge + tests", time: "1m ago" },
    { icon: "✓", role: "success", agent: "Architect", msg: "Strategy ready for step 4 — 6 files, 3 risks", time: "2m ago" },
    { icon: "✗", role: "danger",  agent: "Coder",     msg: "Build failed: unused import in gauge.ts", time: "3m ago" },
    { icon: "✓", role: "success", agent: "Coder",     msg: "Fixed lint error, build passes", time: "3m ago" },
    { icon: "✓", role: "success", agent: "Reviewer",  msg: "Approved step 2 — 4/4 tasks, 3/3 checkpoints", time: "5m ago" },
    { icon: "→", role: "success", agent: "Committer", msg: "Committed: feat(gauge): add TugLinearGauge", time: "5m ago" },
  ];

  return (
    <div className="poc-card" data-testid="poc-agent-feed">
      <div className="poc-card-body">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="poc-section-label">Agent Activity</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className="poc-badge" data-role="accent">tugplan-phase-8</span>
            <span className="poc-metric">Step 4 of 7</span>
          </div>
        </div>
        {items.map((item, i) => (
          <div className="poc-feed-item" key={i}>
            <div className="poc-feed-icon">
              {item.active
                ? <span className="poc-spinner" />
                : <span style={{ color: `var(--poc-${item.role})` }}>{item.icon}</span>
              }
            </div>
            <div className="poc-feed-body">
              <span className={item.active ? "poc-badge" : "poc-badge poc-badge-outlined"} data-role="agent">{item.agent}</span>
              <span>{item.msg}</span>
            </div>
            <div className="poc-feed-time">{item.time}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Telemetry Card (DATA domain — teal accents)
// ---------------------------------------------------------------------------

/** Generate a simple SVG polyline from mock data points. */
function Sparkline({ data, color, threshold }: { data: number[]; color: string; threshold?: { value: number; role: string } }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 200;
  const h = 28;
  const points = data.map((v, i) =>
    `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 2) - 1}`
  ).join(" ");

  const thresholdY = threshold
    ? h - ((threshold.value - min) / range) * (h - 2) - 1
    : null;

  return (
    <svg className="poc-sparkline-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {thresholdY !== null && (
        <line
          x1="0" y1={thresholdY} x2={w} y2={thresholdY}
          stroke={`var(--poc-${threshold!.role})`}
          strokeWidth="1"
          strokeDasharray="3 2"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

function PocTelemetryContent() {
  const tokenData  = [120, 340, 280, 510, 890, 1200, 1450, 980, 1100, 1350, 1600, 1420, 1750, 2100];
  const filesData  = [2, 5, 3, 8, 12, 6, 15, 9, 11, 18, 7, 14, 22, 19];
  const commitData = [1, 1, 2, 1, 3, 2, 4, 2, 3, 5, 2, 4, 3, 6];
  const branchData = [1, 1, 1, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5];

  return (
    <div className="poc-card" data-role="data" data-testid="poc-telemetry">
      <div className="poc-card-body">
        <div className="poc-section-label">Session Telemetry</div>

        {/* Summary row */}
        <div style={{ display: "flex", gap: 20 }}>
          {[
            { label: "Tokens", value: "14.2k" },
            { label: "Files", value: "22" },
            { label: "Commits", value: "6" },
            { label: "Branches", value: "5" },
          ].map((m) => (
            <div key={m.label} style={{ textAlign: "center" }}>
              <div className="poc-metric-lg">{m.value}</div>
              <div className="poc-metric-label">{m.label}</div>
            </div>
          ))}
        </div>

        {/* Sparklines */}
        <div className="poc-sparkline-row">
          <div className="poc-sparkline-label">Tokens / min</div>
          <Sparkline data={tokenData} color="var(--poc-data)" threshold={{ value: 1800, role: "caution" }} />
          <div className="poc-sparkline-value">2,100</div>
        </div>
        <div className="poc-sparkline-row">
          <div className="poc-sparkline-label">Files changed</div>
          <Sparkline data={filesData} color="var(--poc-data)" />
          <div className="poc-sparkline-value">19</div>
        </div>
        <div className="poc-sparkline-row">
          <div className="poc-sparkline-label">Commits</div>
          <Sparkline data={commitData} color="var(--poc-data)" />
          <div className="poc-sparkline-value">6</div>
        </div>
        <div className="poc-sparkline-row">
          <div className="poc-sparkline-label">Active branches</div>
          <Sparkline data={branchData} color="var(--poc-data)" />
          <div className="poc-sparkline-value">5</div>
        </div>

        {/* Cost readout */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
          <span className="poc-section-label">Estimated cost</span>
          <span className="poc-metric" style={{ fontSize: 13 }}>$0.47</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Git Status Card (ACTIVE domain + signal colors)
// ---------------------------------------------------------------------------

function PocGitStatusContent() {
  const files = [
    { status: "A", role: "success", path: "src/components/tugways/tug-sparkline.tsx" },
    { status: "A", role: "success", path: "src/components/tugways/tug-sparkline.css" },
    { status: "A", role: "success", path: "src/__tests__/tug-sparkline.test.tsx" },
    { status: "M", role: "caution", path: "src/components/tugways/cards/gallery-card.tsx" },
    { status: "M", role: "caution", path: "src/components/tugways/theme-derivation-engine.ts" },
    { status: "M", role: "caution", path: "src/components/tugways/fg-bg-pairing-map.ts" },
    { status: "D", role: "danger",  path: "src/components/tugways/legacy-chart.tsx" },
    { status: "R", role: "active",  path: "src/components/tugways/mini-chart.tsx → tug-sparkline.tsx" },
  ];

  const counts = { A: 3, M: 3, D: 1, R: 1 };

  return (
    <div className="poc-card" data-role="active" data-testid="poc-git-status">
      <div className="poc-card-body">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="poc-section-label">Git Status</div>
          <div style={{ display: "flex", gap: 8 }}>
            <span className="poc-badge" data-role="success">{counts.A} added</span>
            <span className="poc-badge" data-role="caution">{counts.M} modified</span>
            <span className="poc-badge" data-role="danger">{counts.D} deleted</span>
            <span className="poc-badge" data-role="active">{counts.R} renamed</span>
          </div>
        </div>

        <div className="poc-section-label" style={{ marginTop: 4 }}>
          Branch: <span style={{ color: "var(--poc-active)", textTransform: "none", letterSpacing: 0 }}>tugplan/phase-8-sparkline</span>
        </div>

        {files.map((f, i) => (
          <div className="poc-file-row" key={i}>
            <span className="poc-dot" data-role={f.role} />
            <span className="poc-file-status" style={{ color: `var(--poc-${f.role})` }}>{f.status}</span>
            <span className="poc-file-path">{f.path}</span>
          </div>
        ))}

        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <button className="poc-btn poc-btn-outlined" data-role="active">Stage All</button>
          <button className="poc-btn poc-btn-ghost" data-role="active">Diff</button>
          <button className="poc-btn poc-btn-filled" data-role="accent">Commit</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Phase Progress Card (mixed domains)
// ---------------------------------------------------------------------------

function PocPhaseProgressContent() {
  const steps = [
    { n: 1, state: "complete",    title: "TugBadge + TugStatusIndicator",      detail: "2 components, 8 tests — 4m 12s", tokens: "3,200" },
    { n: 2, state: "complete",    title: "TugProgress + TugSeparator",          detail: "2 components, 6 tests — 3m 45s", tokens: "2,800" },
    { n: 3, state: "complete",    title: "TugLinearGauge + thresholds",         detail: "1 component, 5 tests — 5m 30s",  tokens: "4,100" },
    { n: 4, state: "in-progress", title: "TugSparkline (area, line, bar)",      detail: "Coder implementing…",            tokens: "1,200" },
    { n: 5, state: "pending",     title: "TugArcGauge + center readout",        detail: "Blocked on step 4",              tokens: "—" },
    { n: 6, state: "pending",     title: "TugTable + sortable columns",         detail: "Not started",                    tokens: "—" },
    { n: 7, state: "pending",     title: "TugStatCard + trend indicators",      detail: "Not started",                    tokens: "—" },
  ];

  const complete = steps.filter(s => s.state === "complete").length;

  return (
    <div className="poc-card" data-testid="poc-phase-progress">
      <div className="poc-card-body">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="poc-section-label">Phase 8 — Data Visualization</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="poc-badge" data-role="success">{complete}/7 complete</span>
            <span className="poc-metric">11.3k tokens</span>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 4, borderRadius: 2, background: "oklch(0.3 0 0)", overflow: "hidden" }}>
          <div style={{
            width: `${(complete / steps.length) * 100}%`,
            height: "100%",
            background: "var(--poc-success)",
            borderRadius: 2,
            transition: "width 0.3s",
          }} />
        </div>

        {steps.map((step) => (
          <div className="poc-step" key={step.n} data-state={step.state}>
            <div className="poc-step-marker" data-state={step.state}>
              {step.state === "complete" ? "✓" : step.state === "in-progress" ? "▸" : step.n}
            </div>
            <div className="poc-step-body">
              <div className="poc-step-title">{step.title}</div>
              <div className="poc-step-detail">
                {step.state === "in-progress" && <span className="poc-spinner" style={{ marginRight: 4, verticalAlign: "middle" }} />}
                {step.detail}
              </div>
            </div>
            <div className="poc-metric" style={{ alignSelf: "center" }}>{step.tokens}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all 5 POC card types.
 * Call before DeckManager construction in main.tsx.
 */
export function registerPocCards(): void {
  registerCard({
    componentId: "poc-chat",
    contentFactory: () => <PocChatContent />,
    defaultMeta: { title: "AI Chat", closable: true },
    family: "developer",
  });

  registerCard({
    componentId: "poc-agent-feed",
    contentFactory: () => <PocAgentFeedContent />,
    defaultMeta: { title: "Agent Activity", closable: true },
    family: "developer",
  });

  registerCard({
    componentId: "poc-telemetry",
    contentFactory: () => <PocTelemetryContent />,
    defaultMeta: { title: "Telemetry", closable: true },
    family: "developer",
  });

  registerCard({
    componentId: "poc-git-status",
    contentFactory: () => <PocGitStatusContent />,
    defaultMeta: { title: "Git Status", closable: true },
    family: "developer",
  });

  registerCard({
    componentId: "poc-phase-progress",
    contentFactory: () => <PocPhaseProgressContent />,
    defaultMeta: { title: "Phase Progress", closable: true },
    family: "developer",
  });
}

/** The 5 POC card componentIds, for bulk creation by the action handler. */
export const POC_CARD_IDS = [
  "poc-chat",
  "poc-agent-feed",
  "poc-telemetry",
  "poc-git-status",
  "poc-phase-progress",
] as const;
