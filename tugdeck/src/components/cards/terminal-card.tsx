/**
 * TerminalCard — React functional component wrapping xterm.js.
 *
 * Uses a ref-based xterm.js integration:
 *   - useRef for the terminal container DOM element
 *   - useEffect for xterm.js initialization and cleanup
 *   - useFeed for terminal output feed subscription
 *   - useConnection for sending terminal input back via WebSocket
 *   - useContext(CardContext) for dimensions/dragState for resize handling
 *   - useCardMeta for dynamic menu items (font size, clear scrollback, WebGL toggle)
 *   - useTheme for reactive theme updates (replaces td-theme-change CustomEvent listener)
 *
 * xterm.js manages its own internal DOM within the container ref. The component
 * owns lifecycle (mount/unmount) and delegates all rendering to xterm.js.
 *
 * Replaces vanilla TerminalCard class (src/cards/terminal-card.ts), which is
 * retained until Step 10 bulk deletion.
 *
 * References: [D03] React content only, [D06] Replace tests, Table T03, (#strategy)
 */

import { useRef, useEffect, useCallback, useContext, useState, useMemo } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";

import { FeedId, resizeFrame } from "../../protocol";
import { useFeed } from "../../hooks/use-feed";
import { useConnection } from "../../hooks/use-connection";
import { useCardMeta } from "../../hooks/use-card-meta";
import { useTheme } from "../../hooks/use-theme";
import { CardContext } from "../../cards/card-context";
import type { TugCardMeta } from "../../cards/card";
import { CARD_TITLES } from "../../card-titles";

/** Map from UI label to pixel font size */
const FONT_SIZE_MAP: Record<string, number> = { Small: 12, Medium: 14, Large: 16 };
/** Map from pixel size back to UI label */
const FONT_SIZE_LABEL: Record<number, string> = { 12: "Small", 14: "Medium", 16: "Large" };

export function TerminalCard() {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const resizeDebounceIdRef = useRef<number | null>(null);

  const feedPayload = useFeed(FeedId.TERMINAL_OUTPUT);
  const connection = useConnection();
  const [theme] = useTheme();
  const { dimensions, dragState } = useContext(CardContext);

  // ---- Menu state ----

  const [fontSize, setFontSize] = useState(14);
  const [webglEnabled, setWebglEnabled] = useState(false);

  // ---- Card meta with dynamic menu items ----

  const handleFontSizeChange = useCallback((label: string) => {
    const size = FONT_SIZE_MAP[label] ?? 14;
    setFontSize(size);
    if (terminalRef.current) {
      terminalRef.current.options.fontSize = size;
      fitAddonRef.current?.fit();
    }
  }, []);

  const handleClearScrollback = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  const handleWebGLToggle = useCallback((_checked: boolean) => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    if (webglEnabled && webglAddonRef.current) {
      // Turn off: dispose WebGL addon, fall back to canvas renderer
      try {
        webglAddonRef.current.dispose();
      } catch {
        // Dispose may throw if context is already lost
      }
      webglAddonRef.current = null;
      setWebglEnabled(false);
    } else {
      // Turn on: create and load a new WebglAddon instance
      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon.dispose();
          webglAddonRef.current = null;
          setWebglEnabled(false);
        });
        terminal.loadAddon(webglAddon);
        webglAddonRef.current = webglAddon;
        setWebglEnabled(true);
      } catch {
        setWebglEnabled(false);
        console.log("tugdeck: WebGL re-enable failed");
      }
    }
  }, [webglEnabled]);

  const meta = useMemo<TugCardMeta>(
    () => ({
      title: CARD_TITLES.terminal,
      icon: "Terminal",
      closable: true,
      menuItems: [
        {
          type: "select",
          label: "Font Size",
          options: ["Small", "Medium", "Large"],
          value: FONT_SIZE_LABEL[fontSize] ?? "Medium",
          action: handleFontSizeChange,
        },
        {
          type: "action",
          label: "Clear Scrollback",
          action: handleClearScrollback,
        },
        {
          type: "toggle",
          label: "WebGL Renderer",
          checked: webglEnabled,
          action: handleWebGLToggle,
        },
      ],
    }),
    [fontSize, webglEnabled, handleFontSizeChange, handleClearScrollback, handleWebGLToggle]
  );

  useCardMeta(meta);

  // ---- xterm.js initialization and cleanup ----

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Read CSS tokens for terminal theme
    const styles = getComputedStyle(document.body);
    const bg = styles.getPropertyValue("--td-surface-content").trim();
    const fg = styles.getPropertyValue("--td-text").trim();
    const accent = styles.getPropertyValue("--tl-accent-2").trim();
    const fontFamily = styles.getPropertyValue("--td-font-mono").trim();

    // Create terminal with theme matching the dark background
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily:
        fontFamily ||
        "'Hack', 'JetBrains Mono', 'SFMono-Regular', 'Menlo', monospace",
      fontSize: 14,
      theme: {
        background: bg,
        foreground: fg,
        green: accent,
      },
    });

    // Load addons
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    // Open terminal in container
    terminal.open(container);

    // Attempt WebGL progressive enhancement
    let initialWebglEnabled = false;
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
        webglAddonRef.current = null;
        setWebglEnabled(false);
        console.log("tugdeck: WebGL context lost, falling back to canvas");
      });
      terminal.loadAddon(webglAddon);
      webglAddonRef.current = webglAddon;
      initialWebglEnabled = true;
      console.log("tugdeck: WebGL renderer activated");
    } catch {
      console.log("tugdeck: WebGL not available, using canvas renderer");
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    setWebglEnabled(initialWebglEnabled);

    // Forward keyboard input to server
    const dataDisposable = terminal.onData((data: string) => {
      if (!connection) return;
      const encoded = new TextEncoder().encode(data);
      connection.send(FeedId.TERMINAL_INPUT, encoded);
    });

    // Forward resize events to server
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (!connection) return;
      const frame = resizeFrame(cols, rows);
      connection.send(frame.feedId, frame.payload);
    });

    return () => {
      dataDisposable.dispose();
      resizeDisposable.dispose();
      if (resizeDebounceIdRef.current !== null) {
        cancelAnimationFrame(resizeDebounceIdRef.current);
        resizeDebounceIdRef.current = null;
      }
      if (webglAddonRef.current) {
        try {
          webglAddonRef.current.dispose();
        } catch {
          // Ignore
        }
        webglAddonRef.current = null;
      }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount; connection ref is stable

  // ---- Update xterm colors when theme changes (via useTheme hook) ----

  useEffect(() => {
    if (!terminalRef.current) return;
    requestAnimationFrame(() => {
      if (!terminalRef.current) return;
      const s = getComputedStyle(document.body);
      const newBg = s.getPropertyValue("--td-surface-content").trim();
      const newFg = s.getPropertyValue("--td-text").trim();
      const newAccent = s.getPropertyValue("--tl-accent-2").trim();
      const newFont = s.getPropertyValue("--td-font-mono").trim();
      terminalRef.current.options.theme = {
        background: newBg,
        foreground: newFg,
        green: newAccent,
      };
      if (newFont) terminalRef.current.options.fontFamily = newFont;
      terminalRef.current.refresh(0, terminalRef.current.rows - 1);
    });
  }, [theme]);

  // ---- Write incoming terminal output ----

  useEffect(() => {
    if (feedPayload && terminalRef.current) {
      terminalRef.current.write(feedPayload);
    }
  }, [feedPayload]);

  // ---- Handle resize events from CardContext dimensions ----

  useEffect(() => {
    if (!terminalRef.current || !fitAddonRef.current) return;

    // During active drag, suppress fit() entirely
    if (dragState?.isDragging) return;

    // Debounce fit() to avoid flashing during continuous resize
    if (resizeDebounceIdRef.current !== null) {
      cancelAnimationFrame(resizeDebounceIdRef.current);
    }
    resizeDebounceIdRef.current = requestAnimationFrame(() => {
      resizeDebounceIdRef.current = null;
      if (fitAddonRef.current && terminalRef.current) {
        fitAddonRef.current.fit();
        const frame = resizeFrame(
          terminalRef.current.cols,
          terminalRef.current.rows
        );
        connection?.send(frame.feedId, frame.payload);
      }
    });
  }, [dimensions, dragState, connection]);

  // ---- Render ----

  return (
    <div
      className="terminal-card h-full w-full"
      style={{ overflow: "hidden" }}
    >
      <div
        ref={containerRef}
        className="terminal-container h-full w-full"
        data-testid="terminal-container"
      />
    </div>
  );
}
