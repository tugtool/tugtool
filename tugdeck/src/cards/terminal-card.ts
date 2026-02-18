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

export class TerminalCard implements TugCard {
  readonly feedIds: readonly FeedIdValue[] = [FeedId.TERMINAL_OUTPUT];
  readonly collapsible = false;
  readonly meta: TugCardMeta = {
    title: "Terminal",
    icon: "Terminal",
    closable: true,
    menuItems: [],
  };

  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
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
        console.log("tugdeck: WebGL context lost, falling back to canvas");
      });
      this.terminal.loadAddon(webglAddon);
      console.log("tugdeck: WebGL renderer activated");
    } catch {
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

  onResize(_width: number, _height: number): void {
    // During active drag, suppress fit() entirely -- the single
    // handleResize() call on pointerup will trigger this method
    // with isDragging === false for the final fit.
    if (this.dragState?.isDragging) {
      return;
    }
    if (this.fitAddon && this.terminal) {
      this.fitAddon.fit();
      // Always send current size — fit may not trigger terminal.onResize
      // if the terminal dimensions haven't changed, but the server needs
      // to know the size (e.g. on WebSocket reconnect)
      const frame = resizeFrame(this.terminal.cols, this.terminal.rows);
      this.connection.send(frame.feedId, frame.payload);
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
