/**
 * SettingsCard — React functional component for the Settings card.
 *
 * Replaces the vanilla SettingsCard class (src/cards/settings-card.ts),
 * which is retained until Step 10 bulk deletion.
 *
 * Sections:
 *   1. Theme — RadioGroup for Brio / Bluenote / Harmony selection
 *   2. Source Tree — displays current path, "Choose..." button
 *   3. Developer Mode — Switch enabled only when a source tree is set
 *
 * Bridge pattern:
 *   - Sends commands via connection.sendControlFrame() (WebSocket → Swift)
 *   - Receives responses via window.__tugBridge callbacks (Swift → JS)
 *   - If webkit.messageHandlers.getSettings is unavailable, shows fallback
 *
 * References: [D03] React content only, [D04] CustomEvents, [D05] Token bridge,
 *             Table T01, Table T03
 */

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useConnection } from "../../hooks/use-connection";
import { useTheme } from "../../hooks/use-theme";
import type { ThemeName } from "../../hooks/use-theme";

// ---- Types ----

interface TugBridge {
  onSettingsLoaded?: (data: { devMode: boolean; sourceTree: string | null }) => void;
  onDevModeChanged?: (confirmed: boolean) => void;
  onDevModeError?: (message: string) => void;
  onSourceTreeSelected?: (path: string) => void;
  onSourceTreeCancelled?: () => void;
}

declare global {
  interface Window {
    __tugBridge?: TugBridge;
    webkit?: {
      messageHandlers?: {
        getSettings?: { postMessage: (msg: object) => void };
        setDevMode?: { postMessage: (msg: object) => void };
        chooseSourceTree?: { postMessage: (msg: object) => void };
      };
    };
  }
}

const THEMES: { value: ThemeName; label: string }[] = [
  { value: "brio", label: "Brio" },
  { value: "bluenote", label: "Bluenote" },
  { value: "harmony", label: "Harmony" },
];

const DEV_MODE_TIMEOUT_MS = 3000;

// ---- Component ----

export function SettingsCard() {
  const connection = useConnection();
  const [theme, setTheme] = useTheme();

  // Source tree state
  const [sourceTree, setSourceTree] = useState<string | null>(null);

  // Dev mode state
  const [devModeEnabled, setDevModeEnabled] = useState(false);
  const [devModeDisabled, setDevModeDisabled] = useState(true);
  const [devNote, setDevNote] = useState<string | null>(null);
  const devModeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bridge availability
  const [bridgeAvailable, setBridgeAvailable] = useState(false);

  // ---- Bridge lifecycle ----
  useEffect(() => {
    const webkit = window.webkit;

    if (!webkit?.messageHandlers?.getSettings) {
      // Bridge unavailable — browser-only mode
      setBridgeAvailable(false);
      setDevNote("Developer features require the Tug app");
      return;
    }

    setBridgeAvailable(true);

    // Ensure __tugBridge object exists
    if (!window.__tugBridge) {
      window.__tugBridge = {};
    }
    const bridge = window.__tugBridge;

    bridge.onSettingsLoaded = (data) => {
      setSourceTree(data.sourceTree);
      setDevModeDisabled(!data.sourceTree);
      if (data.sourceTree) {
        setDevModeEnabled(data.devMode);
      } else {
        setDevModeEnabled(false);
      }
    };

    bridge.onDevModeChanged = (confirmed) => {
      if (devModeTimerRef.current !== null) {
        clearTimeout(devModeTimerRef.current);
        devModeTimerRef.current = null;
      }
      setDevModeEnabled(confirmed);
      setDevModeDisabled(false);
      setDevNote(null);
    };

    bridge.onDevModeError = (message) => {
      if (devModeTimerRef.current !== null) {
        clearTimeout(devModeTimerRef.current);
        devModeTimerRef.current = null;
      }
      setDevModeEnabled(false);
      setDevModeDisabled(false);
      setDevNote(message);
    };

    bridge.onSourceTreeSelected = (path) => {
      setSourceTree(path);
      setDevModeDisabled(!path);
      if (!path) {
        setDevModeEnabled(false);
      }
    };

    bridge.onSourceTreeCancelled = () => {
      // No-op
    };

    // Request current settings from native
    webkit.messageHandlers.getSettings.postMessage({});

    return () => {
      // Clear all bridge callbacks on unmount
      if (window.__tugBridge) {
        window.__tugBridge.onSettingsLoaded = undefined;
        window.__tugBridge.onDevModeChanged = undefined;
        window.__tugBridge.onDevModeError = undefined;
        window.__tugBridge.onSourceTreeSelected = undefined;
        window.__tugBridge.onSourceTreeCancelled = undefined;
      }
      // Clear any pending confirmation timeout
      if (devModeTimerRef.current !== null) {
        clearTimeout(devModeTimerRef.current);
        devModeTimerRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Event handlers ----

  function handleThemeChange(value: string) {
    setTheme(value as ThemeName);
  }

  function handleDevModeToggle(checked: boolean) {
    // Disable switch during bridge round-trip
    setDevModeDisabled(true);
    // Optimistically update to reflect what the user tapped
    setDevModeEnabled(checked);

    // Start timeout — revert if bridge doesn't respond
    devModeTimerRef.current = setTimeout(() => {
      devModeTimerRef.current = null;
      setDevModeEnabled(!checked);
      setDevModeDisabled(false);
      setDevNote("dev mode toggle requires the Tug app");
    }, DEV_MODE_TIMEOUT_MS);

    connection?.sendControlFrame("set-dev-mode", { enabled: checked });
  }

  function handleChooseSourceTree() {
    connection?.sendControlFrame("choose-source-tree");
  }

  // ---- Render ----

  const sourceTreeDisplay = !bridgeAvailable
    ? "(source tree picker requires the Tug app)"
    : sourceTree
      ? sourceTree
      : "(not set)";

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Section 1: Theme */}
      <Card>
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm font-semibold">Theme</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <RadioGroup value={theme} onValueChange={handleThemeChange}>
            {THEMES.map(({ value, label }) => (
              <div key={value} className="flex items-center gap-2">
                <RadioGroupItem value={value} id={`theme-${value}`} />
                <label
                  htmlFor={`theme-${value}`}
                  className="cursor-pointer text-sm"
                >
                  {label}
                </label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Section 2: Source Tree */}
      <Card>
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm font-semibold">Source Tree</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate text-sm text-muted-foreground">
              {sourceTreeDisplay}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleChooseSourceTree}
              disabled={!bridgeAvailable}
            >
              Choose...
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Section 3: Developer Mode */}
      <Card>
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm font-semibold">Developer Mode</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Switch
                id="dev-mode-switch"
                checked={devModeEnabled}
                onCheckedChange={handleDevModeToggle}
                disabled={devModeDisabled}
              />
              <label htmlFor="dev-mode-switch" className="text-sm">
                {devModeDisabled && !devModeEnabled
                  ? "Tug source tree required for developer mode"
                  : "Enable developer mode"}
              </label>
            </div>
            {devNote && (
              <p className="text-xs text-muted-foreground">{devNote}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
