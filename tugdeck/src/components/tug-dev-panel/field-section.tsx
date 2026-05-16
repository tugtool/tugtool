/**
 * `FieldSection` — labeled container that groups `FieldRow`s.
 *
 * Header is a `TugSeparator` with a `label` prop — same visual vocabulary
 * other parts of the app use for delineated sections. The rows live in
 * a plain div underneath; future tabs with many sections may swap this
 * for `TugAccordion` for collapsibility.
 *
 * @module components/tug-dev-panel/field-section
 */

import React from "react";

import { cn } from "@/lib/utils";
import { TugSeparator } from "@/components/tugways/tug-separator";

export interface FieldSectionProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

export const FieldSection: React.FC<FieldSectionProps> = ({
  title,
  children,
  className,
}) => {
  return (
    <section className={cn("tug-devpanel-section", className)}>
      <TugSeparator
        label={title}
        capped
        className="tug-devpanel-section-title"
        decorative={false}
        aria-label={title}
      />
      <div className="tug-devpanel-section-body">{children}</div>
    </section>
  );
};
FieldSection.displayName = "FieldSection";
