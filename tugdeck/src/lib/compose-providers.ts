import React from "react";

export type ProviderEntry = readonly [
  component: React.ComponentType<any>,
  props: Record<string, unknown> | null,
];

export function composeProviders(
  entries: readonly ProviderEntry[],
  leaf: React.ReactNode,
): React.ReactElement {
  return entries.reduceRight<React.ReactNode>(
    (children, [Component, props]) =>
      React.createElement(Component, props, children),
    leaf,
  ) as React.ReactElement;
}
