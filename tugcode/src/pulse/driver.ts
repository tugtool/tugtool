/**
 * HaikuDriver — the daemon's claude subprocess, driven through the
 * minimal surface the voice spike proved sufficient: spawn with the
 * pinned posture, write user messages, read result frames. No
 * initialize handshake, no control traffic, no permission handling.
 *
 * Result pairing is by SEQUENCE: ask N pairs with result frame N.
 * The spike's first harness paired "next result after send" and a
 * single timed-out beat shifted every later reply one beat off —
 * sequence pairing makes a timeout consume its own slot.
 *
 * The inner session restarts every ~`restartAfterBeats` asks with a
 * one-line carryover, bounding the conversation's context growth.
 * Restart and startup seeding ride the same mechanism: a priming
 * message the model acknowledges with PASS.
 *
 * @module pulse/driver
 */

import { pulseClaudeArgs, pulseClaudeEnv } from "./posture";

const DEFAULT_RESTART_AFTER_BEATS = 100;

export interface HaikuDriverOptions {
  /** Override the claude binary (tests point this at a fake child). */
  claudePath?: string;
  /** Ledger-tail lines to prime a fresh session with, oldest first. */
  seedLines?: string[];
  /** Inner-session restart threshold in asks. */
  restartAfterBeats?: number;
  /** Diagnostics sink (defaults to process.stderr via console.error). */
  log?: (message: string) => void;
}

interface PendingAsk {
  index: number;
  resolve: (text: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class HaikuDriver {
  private readonly claudePath: string;
  private readonly restartAfterBeats: number;
  private readonly log: (message: string) => void;
  private seedLines: string[];

  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private stdoutBuf = "";
  /** Result frames seen since spawn (sequence-pairing counter). */
  private resultsSeen = 0;
  /** Asks issued since spawn (sequence-pairing counter). */
  private asksSent = 0;
  private pendingAsks: PendingAsk[] = [];
  private lastEmittedLine: string | null = null;
  private shuttingDown = false;

  constructor(options: HaikuDriverOptions = {}) {
    const resolved = options.claudePath ?? Bun.which("claude");
    if (!resolved) throw new Error("claude CLI not found on PATH");
    this.claudePath = resolved;
    this.restartAfterBeats = options.restartAfterBeats ?? DEFAULT_RESTART_AFTER_BEATS;
    this.log = options.log ?? ((m) => console.error(m));
    this.seedLines = options.seedLines ?? [];
  }

  /** Spawn the inner session and prime it (seed or restart carryover). */
  async start(): Promise<void> {
    this.spawnChild();
    await this.prime();
  }

  /**
   * Send a beat digest; resolves with the raw reply text, or null on
   * timeout (the scheduler's stale handling owns what happens next).
   */
  ask(digest: string, timeoutMs: number): Promise<string | null> {
    if (this.proc === null) return Promise.resolve(null);
    const index = this.asksSent++;
    this.writeUserMessage(digest);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingAsks = this.pendingAsks.filter((p) => p.index !== index);
        resolve(null);
      }, timeoutMs);
      this.pendingAsks.push({ index, resolve, timer });
    });
  }

  /** Record the line a beat actually emitted (restart carryover). */
  noteEmitted(line: string): void {
    this.lastEmittedLine = line;
  }

  /** Asks issued on the current inner session. */
  beatsSinceSpawn(): number {
    return this.asksSent;
  }

  /**
   * Restart the inner session when it has narrated long enough that
   * context growth starts costing latency. Call between beats.
   */
  async maybeRestart(): Promise<void> {
    if (this.asksSent < this.restartAfterBeats) return;
    this.log(`[tugpulse] restarting inner session after ${this.asksSent} beats`);
    this.seedLines = this.lastEmittedLine !== null ? [this.lastEmittedLine] : [];
    this.killChild();
    this.spawnChild();
    await this.prime();
  }

  shutdown(): void {
    this.shuttingDown = true;
    this.killChild();
  }

  // -------------------------------------------------------------------------

  private spawnChild(): void {
    this.stdoutBuf = "";
    this.resultsSeen = 0;
    this.asksSent = 0;
    for (const pending of this.pendingAsks) {
      clearTimeout(pending.timer);
      pending.resolve(null);
    }
    this.pendingAsks = [];

    this.proc = Bun.spawn([this.claudePath, ...pulseClaudeArgs()], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
      env: pulseClaudeEnv(process.env as Record<string, string | undefined>),
    });
    void this.readStdout();
    void this.proc.exited.then((code) => {
      if (!this.shuttingDown) {
        this.log(`[tugpulse] inner claude exited (${code}); respawning on next ask`);
        // A dead child fails pending asks; the next prime path respawns.
        for (const pending of this.pendingAsks) {
          clearTimeout(pending.timer);
          pending.resolve(null);
        }
        this.pendingAsks = [];
        this.proc = null;
      }
    });
  }

  /**
   * Prime a fresh inner session. Seed lines restore narrative memory
   * (ledger tail at startup, carryover line after a restart); the
   * model acknowledges with PASS, consuming ask slot 0.
   */
  private async prime(): Promise<void> {
    const seed =
      this.seedLines.length > 0
        ? `Context: your most recent lines (oldest first) were:\n${this.seedLines
            .map((l) => `- ${l}`)
            .join("\n")}\nDo not repeat their information. Reply with exactly: PASS`
        : "Session start. No prior lines. Reply with exactly: PASS";
    await this.ask(seed, 30_000);
  }

  private writeUserMessage(text: string): void {
    if (this.proc === null || this.proc.stdin === null) return;
    const frame =
      JSON.stringify({
        type: "user",
        message: { role: "user", content: [{ type: "text", text }] },
      }) + "\n";
    const stdin = this.proc.stdin as unknown as {
      write(chunk: string): void;
      flush?: () => void;
    };
    stdin.write(frame);
    stdin.flush?.();
  }

  private async readStdout(): Promise<void> {
    const proc = this.proc;
    if (proc === null || proc.stdout === null) return;
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.stdoutBuf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = this.stdoutBuf.indexOf("\n")) !== -1) {
          const line = this.stdoutBuf.slice(0, nl);
          this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
          if (line.trim().length === 0) continue;
          this.handleLine(line);
        }
      }
    } catch {
      // Stream torn down mid-read (shutdown / restart) — pending asks
      // are resolved by the exit handler.
    }
  }

  private handleLine(line: string): void {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (ev.type !== "result") return;
    const index = this.resultsSeen++;
    const hit = this.pendingAsks.find((p) => p.index === index);
    if (hit === undefined) return; // timed-out slot's straggler
    this.pendingAsks = this.pendingAsks.filter((p) => p.index !== index);
    clearTimeout(hit.timer);
    const text = typeof ev.result === "string" ? ev.result : null;
    hit.resolve(text);
  }

  private killChild(): void {
    if (this.proc !== null) {
      try {
        this.proc.kill();
      } catch {
        // already dead
      }
      this.proc = null;
    }
  }
}
