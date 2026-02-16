/**
 * Stats card implementation
 *
 * Displays process info, token usage, and build status with sparkline charts.
 */

import { createElement, Activity, Coins, Hammer } from "lucide";
import { FeedId, FeedIdValue } from "../protocol";
import { TugCard } from "./card";

/**
 * Helper function to read CSS token values
 */
function getCSSToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Sparkline chart renderer using Canvas 2D
 */
class Sparkline {
  private values: number[] = [];
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private color: string;
  private bufferSize: number;

  constructor(canvas: HTMLCanvasElement, bufferSize: number = 60, color: string) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.color = color;
    this.bufferSize = bufferSize;
  }

  push(value: number): void {
    this.values.push(value);
    if (this.values.length > this.bufferSize) {
      this.values.shift();
    }
    this.draw();
  }

  draw(): void {
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Clear canvas
    this.ctx.clearRect(0, 0, width, height);

    if (this.values.length < 2) {
      return;
    }

    // Calculate min/max for scaling
    let min = Math.min(...this.values);
    let max = Math.max(...this.values);

    // If all values are the same, draw horizontal line at mid-height
    if (max === min) {
      min = max - 0.5;
      max = max + 0.5;
    }

    const range = max - min;

    // Draw polyline
    this.ctx.beginPath();
    this.ctx.strokeStyle = this.color;
    this.ctx.lineWidth = 1.5;

    const xStep = width / (this.bufferSize - 1);

    for (let i = 0; i < this.values.length; i++) {
      const x = i * xStep;
      const y = height - ((this.values[i] - min) / range) * height;

      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }

    this.ctx.stroke();
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.draw();
  }
}

/**
 * Sub-card for displaying one stat with sparkline
 */
class SubCard {
  private container: HTMLDivElement;
  private nameSpan: HTMLSpanElement;
  private valueSpan: HTMLSpanElement;
  private sparkline: Sparkline;
  private canvas: HTMLCanvasElement;

  constructor(name: string, color: string, bufferSize: number = 60, icon?: object) {
    // Create container
    this.container = document.createElement("div");
    this.container.className = "stat-sub-card";

    // Create header
    const header = document.createElement("div");
    header.className = "stat-header";

    // Create name group (icon + name) to preserve two-child layout for space-between
    const nameGroup = document.createElement("span");
    nameGroup.style.display = "flex";
    nameGroup.style.alignItems = "center";
    nameGroup.style.gap = "4px";

    if (icon) {
      nameGroup.appendChild(createElement(icon as any, { width: 12, height: 12 }));
    }

    this.nameSpan = document.createElement("span");
    this.nameSpan.className = "stat-name";
    this.nameSpan.textContent = name;
    nameGroup.appendChild(this.nameSpan);

    this.valueSpan = document.createElement("span");
    this.valueSpan.className = "stat-value";
    this.valueSpan.textContent = "--";

    header.appendChild(nameGroup);
    header.appendChild(this.valueSpan);

    // Create sparkline canvas
    this.canvas = document.createElement("canvas");
    this.canvas.className = "sparkline-canvas";
    this.canvas.width = 300;
    this.canvas.height = 32;

    this.sparkline = new Sparkline(this.canvas, bufferSize, color);

    this.container.appendChild(header);
    this.container.appendChild(this.canvas);
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.container);
  }

  updateValue(text: string, isNA: boolean = false): void {
    this.valueSpan.textContent = text;
    if (isNA) {
      this.valueSpan.classList.add("stat-na");
    } else {
      this.valueSpan.classList.remove("stat-na");
    }
  }

  pushSparkline(value: number): void {
    this.sparkline.push(value);
  }

  resize(): void {
    const width = this.canvas.clientWidth;
    const height = 32;
    this.sparkline.resize(width, height);
  }

  getElement(): HTMLElement {
    return this.container;
  }
}

/**
 * Stats card with process info, token usage, and build status
 */
export class StatsCard implements TugCard {
  readonly feedIds: readonly FeedIdValue[] = [
    FeedId.STATS,
    FeedId.STATS_PROCESS_INFO,
    FeedId.STATS_TOKEN_USAGE,
    FeedId.STATS_BUILD_STATUS,
  ];

  private container: HTMLElement | null = null;
  private content: HTMLDivElement | null = null;
  private processInfo: SubCard | null = null;
  private tokenUsage: SubCard | null = null;
  private buildStatus: SubCard | null = null;

  mount(container: HTMLElement): void {
    this.container = container;
    this.container.classList.add("stats-card");

    // Create header
    const header = document.createElement("div");
    header.className = "card-header";
    header.textContent = "Stats";
    this.container.appendChild(header);

    // Create content container
    this.content = document.createElement("div");
    this.content.className = "stats-content";
    this.container.appendChild(this.content);

    // Create sub-cards
    this.processInfo = new SubCard("CPU / Memory", getCSSToken("--chart-1"), 60, Activity);
    this.processInfo.mount(this.content);

    this.tokenUsage = new SubCard("Token Usage", getCSSToken("--chart-2"), 60, Coins);
    this.tokenUsage.mount(this.content);

    this.buildStatus = new SubCard("Build Status", getCSSToken("--chart-3"), 60, Hammer);
    this.buildStatus.mount(this.content);
  }

  onFrame(feedId: FeedIdValue, payload: Uint8Array): void {
    if (payload.length === 0) {
      return;
    }

    // Decode payload as JSON text
    const text = new TextDecoder().decode(payload);
    let data: any;

    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("Stats card: failed to parse JSON payload", e);
      return;
    }

    // Handle different feed types
    switch (feedId) {
      case FeedId.STATS_PROCESS_INFO:
        this.handleProcessInfo(data);
        break;

      case FeedId.STATS_TOKEN_USAGE:
        this.handleTokenUsage(data);
        break;

      case FeedId.STATS_BUILD_STATUS:
        this.handleBuildStatus(data);
        break;

      case FeedId.STATS:
        // Aggregate feed - can be used as fallback but skip for now
        break;
    }
  }

  private handleProcessInfo(data: any): void {
    if (!this.processInfo) return;

    const cpuPercent = data.cpu_percent?.toFixed(1) ?? "0.0";
    const memoryMb = data.memory_mb?.toFixed(0) ?? "0";

    this.processInfo.updateValue(`CPU: ${cpuPercent}%  Mem: ${memoryMb}MB`);
    this.processInfo.pushSparkline(data.cpu_percent ?? 0);
  }

  private handleTokenUsage(data: any): void {
    if (!this.tokenUsage) return;

    // Handle null value (parse failure)
    if (data === null || data.total_tokens === null) {
      this.tokenUsage.updateValue("N/A", true);
      this.tokenUsage.pushSparkline(0);
      return;
    }

    const totalTokens = data.total_tokens ?? 0;
    const contextPercent = data.context_window_percent?.toFixed(1) ?? "0.0";

    this.tokenUsage.updateValue(`${totalTokens} tokens (${contextPercent}%)`, false);
    this.tokenUsage.pushSparkline(totalTokens);
  }

  private handleBuildStatus(data: any): void {
    if (!this.buildStatus) return;

    const status = data.status ?? "idle";
    this.buildStatus.updateValue(status, false);

    // Push 1 for "building", 0 for "idle"
    this.buildStatus.pushSparkline(status === "building" ? 1 : 0);
  }

  onResize(_width: number, _height: number): void {
    if (this.processInfo) this.processInfo.resize();
    if (this.tokenUsage) this.tokenUsage.resize();
    if (this.buildStatus) this.buildStatus.resize();
  }

  destroy(): void {
    if (this.container) {
      this.container.innerHTML = "";
      this.container = null;
    }
    this.content = null;
    this.processInfo = null;
    this.tokenUsage = null;
    this.buildStatus = null;
  }
}
