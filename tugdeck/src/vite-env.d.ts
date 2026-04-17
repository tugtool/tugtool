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
