/**
 * Terminal card implementation using xterm.js
 *
 * Displays terminal output and captures keyboard input.
 */

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

import { FeedId, FeedIdValue, resizeFrame } from "../protocol";
import { TugConnection } from "../connection";
import { TugCard } from "./card";

export class TerminalCard implements TugCard {
  readonly feedIds: readonly FeedIdValue[] = [FeedId.TERMINAL_OUTPUT];

  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private connection: TugConnection;

  constructor(connection: TugConnection) {
    this.connection = connection;
  }

  mount(container: HTMLElement): void {
    // Create terminal with theme matching the dark background
    this.terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
      fontSize: 14,
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
      },
    });

    // Load addons
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());

    // Open terminal in container
    this.terminal.open(container);

    // Use ResizeObserver to fit when the container gets dimensions
    // (fires on initial layout and on subsequent resizes)
    this.resizeObserver = new ResizeObserver(() => {
      if (this.fitAddon) {
        this.fitAddon.fit();
      }
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
