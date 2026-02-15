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

    // Fit to container size
    this.fitAddon.fit();

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
    if (this.fitAddon) {
      this.fitAddon.fit();
    }
  }

  destroy(): void {
    if (this.terminal) {
      this.terminal.dispose();
      this.terminal = null;
      this.fitAddon = null;
    }
  }
}
