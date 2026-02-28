/**
 * Dock — React component for the 48px vertical rail on the right viewport edge.
 *
 * Replaces the vanilla Dock class (dock.ts) with a React component that:
 * - Renders icon buttons via lucide-react components
 * - Uses CardDropdownMenu (shadcn-based) for the settings dropdown
 * - Reads and sets theme state via useTheme hook (eliminates MutationObserver)
 * - Listens for td-dev-badge CustomEvents via useEffect for badge display
 *   TODO: Step 9 replaces with DevNotificationContext
 * - Styles applied via Tailwind utilities (dock.css deleted in this step)
 *
 * CSS class names (.dock, .dock-icon-btn, .dock-spacer, .dock-logo, .dock-badge)
 * are preserved on elements for test selector compatibility.
 *
 * Spec S07, [D01] shadcn DropdownMenu, [D06] Delete vanilla test files,
 * [D07] lucide-react replaces vanilla lucide
 */

import React, { useEffect, useState } from "react";
import {
  MessageSquare,
  Terminal,
  GitBranch,
  FolderOpen,
  Activity,
  Code,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CardDropdownMenu } from "@/components/chrome/card-dropdown-menu";
import type { CardMenuItem } from "@/cards/card";
import { useTheme } from "@/hooks/use-theme";
import type { ThemeName } from "@/hooks/use-theme";

// ---- Tug logo SVG ----

const TugLogoSVG = React.memo(function TugLogoSVG() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect
        x="2"
        y="2"
        width="20"
        height="20"
        rx="4"
        fill="currentColor"
        opacity="0.15"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fontFamily="IBM Plex Sans, Inter, Segoe UI, system-ui, -apple-system, sans-serif"
        fontSize="12"
        fontWeight="700"
        fill="currentColor"
      >
        T
      </text>
    </svg>
  );
});

// ---- Callbacks interface ----

/**
 * Callback props for the Dock React component.
 * Replaces the vanilla Dock's direct calls to DeckManager methods.
 */
export interface DockCallbacks {
  /** Show/toggle/focus a card by type (code, terminal, git, files, stats, developer, about). */
  onShowCard: (cardType: string) => void;
  /** Reset the canvas layout to default positions. */
  onResetLayout: () => void;
  /** Send restart control frame to the server. */
  onRestartServer: () => void;
  /** Clear localStorage and send reset control frame. */
  onResetEverything: () => void;
  /** Send reload_frontend control frame. */
  onReloadFrontend: () => void;
}

// ---- Card type button config ----

interface CardButtonConfig {
  Icon: LucideIcon;
  cardType: string;
  label: string;
}

const CARD_BUTTONS: CardButtonConfig[] = [
  { Icon: MessageSquare, cardType: "code", label: "Add code card" },
  { Icon: Terminal, cardType: "terminal", label: "Add terminal card" },
  { Icon: GitBranch, cardType: "git", label: "Add git card" },
  { Icon: FolderOpen, cardType: "files", label: "Add files card" },
  { Icon: Activity, cardType: "stats", label: "Add stats card" },
  { Icon: Code, cardType: "developer", label: "Add developer card" },
];

// ---- Icon button sub-component ----

interface IconButtonProps {
  Icon: LucideIcon;
  label: string;
  onClick: () => void;
  badgeCount?: number;
}

function IconButton({ Icon, label, onClick, badgeCount }: IconButtonProps) {
  return (
    // Tailwind utilities replace dock.css .dock-icon-btn rules:
    // inline-flex items-center justify-center w-8 h-8 border border-[var(--td-border-soft)]
    // rounded-[var(--td-radius-sm)] cursor-pointer text-[var(--td-text-soft)]
    <div
      className="dock-icon-btn inline-flex items-center justify-center w-8 h-8 rounded cursor-pointer relative"
      role="button"
      aria-label={label}
      onClick={onClick}
    >
      <Icon width={16} height={16} />
      {badgeCount !== undefined && badgeCount > 0 && (
        // dock-badge: absolute positioned badge count indicator
        <div
          className="dock-badge absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center text-[9px] font-bold rounded-full bg-[var(--td-accent)] text-white px-0.5"
        >
          {badgeCount}
        </div>
      )}
    </div>
  );
}

// ---- Main Dock component ----

export interface DockProps {
  callbacks: DockCallbacks;
}

export function Dock({ callbacks }: DockProps) {
  const [theme, setTheme] = useTheme();
  // Badge counts keyed by componentId
  // TODO: Step 9 replaces with DevNotificationContext
  const [badgeCounts, setBadgeCounts] = useState<Map<string, number>>(
    new Map()
  );

  // Listen for td-dev-badge CustomEvents (same mechanism as deleted vanilla Dock)
  // TODO: Step 9 replaces with DevNotificationContext
  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { componentId, count } = customEvent.detail as {
        componentId?: string;
        count?: number;
      };
      if (componentId && typeof count === "number") {
        setBadgeCounts((prev) => {
          const next = new Map(prev);
          if (count > 0) {
            next.set(componentId, count);
          } else {
            next.delete(componentId);
          }
          return next;
        });
      }
    };
    document.addEventListener("td-dev-badge", handler);
    return () => {
      document.removeEventListener("td-dev-badge", handler);
    };
  }, []);

  // Build settings menu items from callbacks
  const settingsMenuItems: CardMenuItem[] = [
    {
      type: "action",
      label: "Add Code",
      action: () => callbacks.onShowCard("code"),
    },
    {
      type: "action",
      label: "Add Terminal",
      action: () => callbacks.onShowCard("terminal"),
    },
    {
      type: "action",
      label: "Add Git",
      action: () => callbacks.onShowCard("git"),
    },
    {
      type: "action",
      label: "Add Files",
      action: () => callbacks.onShowCard("files"),
    },
    {
      type: "action",
      label: "Add Stats",
      action: () => callbacks.onShowCard("stats"),
    },
    { type: "separator" },
    {
      type: "action",
      label: "Reset Layout",
      action: () => callbacks.onResetLayout(),
    },
    { type: "separator" },
    {
      type: "select",
      label: "Theme",
      options: ["Brio", "Bluenote", "Harmony"],
      value: theme.charAt(0).toUpperCase() + theme.slice(1),
      action: (selected: string) =>
        setTheme(selected.toLowerCase() as ThemeName),
    },
    { type: "separator" },
    {
      type: "action",
      label: "Restart Server",
      action: () => callbacks.onRestartServer(),
    },
    {
      type: "action",
      label: "Reset Everything",
      action: () => callbacks.onResetEverything(),
    },
    {
      type: "action",
      label: "Reload Frontend",
      action: () => callbacks.onReloadFrontend(),
    },
    { type: "separator" },
    {
      type: "action",
      label: "About tugdeck",
      action: () => callbacks.onShowCard("about"),
    },
  ];

  return (
    // Tailwind utilities replace dock.css .dock rules:
    // fixed top-0 right-0 bottom-0 w-12 flex flex-col items-center
    // py-[var(--td-space-4)] gap-[var(--td-space-3)] bg-[var(--td-surface)]
    // border-l border-[var(--td-border-soft)] z-[9980] box-border
    <div
      className="dock fixed top-0 right-0 bottom-0 w-12 flex flex-col items-center box-border"
      style={{ zIndex: 9980 }}
    >
      {CARD_BUTTONS.map(({ Icon, cardType, label }) => (
        <IconButton
          key={cardType}
          Icon={Icon}
          label={label}
          onClick={() => callbacks.onShowCard(cardType)}
          badgeCount={badgeCounts.get(cardType)}
        />
      ))}

      {/* Spacer pushes settings and logo to bottom */}
      <div className="dock-spacer flex-1" />

      <CardDropdownMenu
        items={settingsMenuItems}
        trigger={
          // Settings button uses same Tailwind utilities as IconButton
          <button
            className="dock-icon-btn inline-flex items-center justify-center w-8 h-8 rounded cursor-pointer"
            aria-label="Settings"
            type="button"
          >
            <Settings width={16} height={16} />
          </button>
        }
        align="end"
        side="left"
      />

      {/* Tug logo at bottom */}
      <div
        className="dock-logo inline-flex items-center justify-center w-8 h-8"
        aria-label="tugdeck"
      >
        <TugLogoSVG />
      </div>
    </div>
  );
}
