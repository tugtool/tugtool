/**
 * AboutCard — React functional component for the About card.
 *
 * Renders the Tug logo SVG, app name, version, description, and copyright
 * using Tailwind utility classes with a shadcn Card container.
 *
 * Replaces the vanilla AboutCard class (src/cards/about-card.ts), which is
 * retained until Step 10 bulk deletion.
 *
 * References: [D03] React content only, Table T03
 */

import { Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const VERSION = "0.1.0";

/** Tug logo SVG — 48×48 rendered at card-body scale. */
function TugLogo() {
  return (
    <svg
      width="48"
      height="48"
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
}

export function AboutCard() {
  return (
    <Card className="m-3 flex flex-col items-center gap-3 p-6 text-center">
      <CardContent className="flex flex-col items-center gap-3 p-0">
        <TugLogo />
        <h2 className="text-lg font-semibold leading-none">Tug</h2>
        <p className="text-sm text-muted-foreground">Version {VERSION}</p>
        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          <Info size={12} aria-hidden="true" />
          AI-assisted software construction. Hi!
        </p>
        <p className="text-xs text-muted-foreground">
          Copyright 2026 Ken Kocienda. All rights reserved.
        </p>
      </CardContent>
    </Card>
  );
}
