/// <reference types="vite/client" />

/**
 * Raw contents of `capabilities/<LATEST>/system-metadata.jsonl`. Resolved at
 * build time by `capabilitiesVirtualModulePlugin` in `vite.config.ts` (D6.c)
 * and consumed by `completion-fixtures/system-metadata-fixture.ts` (D5).
 */
declare module "virtual:capabilities/system-metadata" {
  const content: string;
  export default content;
}

/**
 * The active theme's complete CSS, served from the dev server's in-memory
 * active-theme state by `activeThemeVirtualPlugin` in `vite.config.ts`. A
 * side-effect CSS module (imported for its stylesheet, no exports); see
 * `src/css-imports.ts`.
 */
declare module "virtual:tug-active-theme.css";
