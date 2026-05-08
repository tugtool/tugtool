/**
 * DefaultToolWrapper — scaffold fallback for `tool_use` events whose
 * `tool_name` is not in the wrapper registry, and for audit-confirmed
 * long-tail tools that route here by design.
 *
 * This is a SCAFFOLD: it renders only the tool name plus a "(default)"
 * marker so the dispatch wiring can be exercised in isolation. The full
 * implementation — JsonTreeBlock over `input`, smart-pick body for
 * output, inline caution badge — lands later in this phase alongside
 * the dispatch's drift-detection wiring.
 *
 * Laws: [L06] appearance via CSS / DOM, [L19] component authoring guide,
 *       [L20] component-token sovereignty (no tokens introduced here;
 *       full slot vocabulary lands with the body composition step).
 *
 * @module components/tugways/cards/tool-wrappers/default-tool-wrapper
 */

import "./default-tool-wrapper.css";

import React from "react";

import { cn } from "@/lib/utils";

import type { ToolWrapperProps } from "./types";

export const DefaultToolWrapper: React.FC<ToolWrapperProps> = ({
  toolName,
  caution,
}) => {
  return (
    <div
      data-slot="default-tool-wrapper"
      data-caution={caution?.reason ?? undefined}
      className={cn("default-tool-wrapper")}
    >
      <span className="default-tool-wrapper-name">{toolName}</span>
      <span className="default-tool-wrapper-marker">(default)</span>
    </div>
  );
};
