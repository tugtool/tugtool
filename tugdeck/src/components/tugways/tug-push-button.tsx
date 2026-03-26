/**
 * TugPushButton — standalone action button for app code.
 *
 * Uppercase, letter-spaced styling for clear call-to-action buttons
 * ("Save", "Cancel", "Delete"). Wraps TugButton with the .tug-push-button CSS class.
 *
 * Laws: [L06] appearance via CSS, [L19] component authoring guide
 * Decisions: [D02] emphasis x role system
 */

import React from "react";
import { cn } from "@/lib/utils";
import { TugButton } from "./internal/tug-button";
import type { TugButtonProps } from "./internal/tug-button";

// Re-export types that app code needs
export type { TugButtonEmphasis, TugButtonRole, TugButtonSize } from "./internal/tug-button";

export interface TugPushButtonProps extends TugButtonProps {}

export const TugPushButton = React.forwardRef<HTMLButtonElement, TugPushButtonProps>(
  function TugPushButton({ className, ...props }: TugPushButtonProps, ref) {
    return (
      <TugButton
        ref={ref}
        className={cn("tug-push-button", className)}
        {...props}
      />
    );
  }
);
