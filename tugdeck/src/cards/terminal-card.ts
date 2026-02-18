/**
 * Terminal card implementation using xterm.js
 *
 * Displays terminal output and captures keyboard input.
 */

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";

import { FeedId, FeedIdValue, resizeFrame } from "../protocol";
import { TugConnection } from "../connection";
import { TugCard, type TugCardMeta } from "./card";
import type { IDragState } from "../drag-state";

/** Map from UI label to pixel size */
const FONT_SIZE_MAP: Record<string, number> = { Small: 12, Medium: 14, Large: 16 };
/** Map from pixel size back to UI label */
const FONT_SIZE_LABEL: Record<number, string> = { 12: "Small", 14: "Medium", 16: "Large" };

export class TerminalCard implements TugCard {
  readonly feedIds: readonly FeedIdValue[] = [FeedId.TERMINAL_OUTPUT];
  readonly collapsible = false;

  get meta(): TugCardMeta {
    return {
      title: "Terminal",
      icon: "Terminal",
      closable: true,
      menuItems: [
        {
          type: "select",
          label: "Font Size",
          options: ["Small", "Medium", "Large"],
          value: FONT_SIZE_LABEL[this.fontSize] ?? "Medium",
          action: (label: string) => {
            const size = FONT_SIZE_MAP[label] ?? 14;
            this.fontSize = size;
            if (this.terminal) {
              this.terminal.options.fontSize = size;
              if (this.fitAddon) this.fitAddon.fit();
            }
          },
        },
        {
          type: "action",
          label: "Clear Scrollback",
          action: () => {
            if (this.terminal) this.terminal.clear();
          },
        },
        {
          type: "toggle",
          label: "WebGL Renderer",
          checked: this.webglEnabled,
          action: (_checked: boolean) => {
            this.toggleWebGL();
          },
        },
      ],
    };
  }

  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private webglAddon: WebglAddon | null = null;
  private webglEnabled = true;
  private fontSize = 14;
  private resizeObserver: ResizeObserver | null = null;
  private connection: TugConnection;
  private resizeDebounceId: number | null = null;
  private dragState: IDragState | null = null;

  constructor(connection: TugConnection) {
    this.connection = connection;
  }

  setDragState(ds: IDragState): void {
    this.dragState = ds;
  }

  mount(container: HTMLElement): void {
    // Read CSS tokens for terminal theme
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
    const fg = getComputedStyle(document.documentElement).getPropertyValue("--foreground").trim();

    // Create terminal with theme matching the dark background
    this.terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
      fontSize: 14,
      theme: {
        background: bg,
        foreground: fg,
      },
    });

    // Load addons
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());

    // Open terminal in container
    this.terminal.open(container);

    // Attempt WebGL progressive enhancement
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
        this.webglAddon = null;
        this.webglEnabled = false;
        console.log("tugdeck: WebGL context lost, falling back to canvas");
      });
      this.terminal.loadAddon(webglAddon);
      this.webglAddon = webglAddon;
      this.webglEnabled = true;
      console.log("tugdeck: WebGL renderer activated");
    } catch {
      this.webglEnabled = false;
      console.log("tugdeck: WebGL not available, using canvas renderer");
    }

    // Use ResizeObserver to fit when the container gets dimensions
    // (fires on initial layout and on subsequent resizes)
    // Suppress fit during active drag to prevent flashing
    this.resizeObserver = new ResizeObserver(() => {
      // During active drag, suppress fit() entirely
      if (this.dragState?.isDragging) {
        return;
      }
      if (this.resizeDebounceId !== null) {
        cancelAnimationFrame(this.resizeDebounceId);
      }
      this.resizeDebounceId = requestAnimationFrame(() => {
        if (this.fitAddon) {
          this.fitAddon.fit();
        }
        this.resizeDebounceId = null;
      });
    });
    this.resizeObserver.observe(container);

    // Forward keyboard input to server
    this.terminal.onData((data: string) => {
      const encoded = new TextEncoder().encode(data);
      this.connection.send(FeedId.TERMINAL_INPUT, encoded);
    });

    // Forward resize events to server
    this.terminal.onResize(({ cols, rows }) => {
      const frame = resizeFrame(cols, rows);
      this.connection.send(frame.feedId, frame.payload);
    });
  }

  onFrame(feedId: FeedIdValue, payload: Uint8Array): void {
    if (feedId === FeedId.TERMINAL_OUTPUT && this.terminal) {
      this.terminal.write(payload);
    }
  }

  focus(): void {
    this.terminal?.focus();
  }

  onResize(_width: number, _height: number): void {
    if (this.dragState?.isDragging) {
      return;
    }
    // Debounce fit() to avoid flashing during continuous resize.
    // Shares the same timer as the ResizeObserver callback.
    if (this.resizeDebounceId !== null) {
      cancelAnimationFrame(this.resizeDebounceId);
    }
    this.resizeDebounceId = requestAnimationFrame(() => {
      this.resizeDebounceId = null;
      if (this.fitAddon && this.terminal) {
        this.fitAddon.fit();
        const frame = resizeFrame(this.terminal.cols, this.terminal.rows);
        this.connection.send(frame.feedId, frame.payload);
      }
    });
  }

  private toggleWebGL(): void {
    if (!this.terminal) return;

    if (this.webglEnabled && this.webglAddon) {
      // Turn off: dispose WebGL addon, fall back to canvas renderer
      try {
        this.webglAddon.dispose();
      } catch {
        // Dispose may throw if context is already lost
      }
      this.webglAddon = null;
      this.webglEnabled = false;
    } else {
      // Turn on: create and load a new WebglAddon instance
      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon.dispose();
          this.webglAddon = null;
          this.webglEnabled = false;
        });
        this.terminal.loadAddon(webglAddon);
        this.webglAddon = webglAddon;
        this.webglEnabled = true;
      } catch {
        this.webglEnabled = false;
        console.log("tugdeck: WebGL re-enable failed");
      }
    }
  }

  destroy(): void {
    if (this.resizeDebounceId !== null) {
      cancelAnimationFrame(this.resizeDebounceId);
      this.resizeDebounceId = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.terminal) {
      this.terminal.dispose();
      this.terminal = null;
      this.fitAddon = null;
    }
  }
}
