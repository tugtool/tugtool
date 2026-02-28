/**
 * CardDropdownMenu — React component wrapping shadcn DropdownMenu.
 *
 * Maps CardMenuItem types to shadcn components:
 * - CardMenuAction    → DropdownMenuItem with onSelect callback
 * - CardMenuToggle    → DropdownMenuCheckboxItem with checked/onCheckedChange
 * - CardMenuSelect    → DropdownMenuLabel + DropdownMenuRadioGroup + DropdownMenuRadioItem
 * - CardMenuSeparator → DropdownMenuSeparator
 *
 * CardDropdownMenuBridge is a controlled variant used by vanilla bridges
 * (card-header.ts, dock.ts) during the Step 1–2 transition period. It renders
 * with open=true immediately and calls onClose when dismissed.
 *
 * [D01] shadcn DropdownMenu replaces vanilla card-menu.ts
 * Spec S01
 */

import React from "react";
import type { CardMenuItem, CardMenuSelect } from "@/cards/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// ---- Menu item rendering helpers ----

function SelectGroup({ item }: { item: CardMenuSelect }) {
  return (
    <>
      <DropdownMenuLabel>{item.label}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={item.value}
        onValueChange={(value) => item.action(value)}
      >
        {item.options.map((option) => (
          <DropdownMenuRadioItem key={option} value={option}>
            {option}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

function MenuItems({ items }: { items: CardMenuItem[] }) {
  return (
    <>
      {items.map((item, index) => {
        if (item.type === "action") {
          return (
            <DropdownMenuItem key={index} onSelect={() => item.action()}>
              {item.label}
            </DropdownMenuItem>
          );
        }
        if (item.type === "toggle") {
          return (
            <DropdownMenuCheckboxItem
              key={index}
              checked={item.checked}
              onCheckedChange={(checked) => item.action(checked)}
            >
              {item.label}
            </DropdownMenuCheckboxItem>
          );
        }
        if (item.type === "select") {
          return <SelectGroup key={index} item={item} />;
        }
        if (item.type === "separator") {
          return <DropdownMenuSeparator key={index} />;
        }
        return null;
      })}
    </>
  );
}

// ---- CardDropdownMenu: standard uncontrolled component for React consumers ----

export interface CardDropdownMenuProps {
  items: CardMenuItem[];
  trigger: React.ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
}

export function CardDropdownMenu({
  items,
  trigger,
  align = "end",
  side = "bottom",
}: CardDropdownMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side}>
        <MenuItems items={items} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---- CardDropdownMenuBridge: controlled variant for vanilla-to-React bridges ----
// Used by card-header.ts and dock.ts during the Step 1–2 transition.
// Renders open immediately; calls onClose when dismissed.
// This bridge component is removed in Step 2 (CardHeader → React) and
// Step 5 (Dock → React).

export interface CardDropdownMenuBridgeProps {
  items: CardMenuItem[];
  onClose: () => void;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
}

export function CardDropdownMenuBridge({
  items,
  onClose,
  align = "end",
  side = "bottom",
}: CardDropdownMenuBridgeProps) {
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  return (
    <DropdownMenu open={true} onOpenChange={handleOpenChange}>
      {/* Hidden zero-size trigger so Radix uses the container's position */}
      <DropdownMenuTrigger asChild>
        <span style={{ position: "absolute", width: 0, height: 0, display: "block" }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side}>
        <MenuItems items={items} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
