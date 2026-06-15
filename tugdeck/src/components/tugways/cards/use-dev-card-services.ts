/**
 * useDevCardServices — per-card services consumed by `DevCardContent`.
 *
 * Split out of `dev-card.tsx` so that file stays a component-only React Fast
 * Refresh boundary: a `.tsx` that exports a hook alongside its components is
 * "mixed" and non-accepting, so editing it (or anything it transitively
 * imports) full-reloads. This module owns the hook; `dev-card.tsx` imports it.
 *
 * **Laws:** [L02] — services enter React through `useSyncExternalStore` over
 * the module-scope `cardServicesStore` only; the store owns construction and
 * disposal in response to `cardSessionBindingStore` events. React only reads.
 * The hook never holds services in `useState` or tears them down from an
 * effect (an earlier shape that did so violated [L02] and sent stray
 * `close_session` frames).
 *
 * @module components/tugways/cards/use-dev-card-services
 */

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { cardServicesStore, type CardServices } from "@/lib/card-services-store";
import { PromptHistoryStore } from "@/lib/prompt-history-store";
import type { CompletionProvider } from "@/lib/tug-text-types";
import type { ArgumentHintResolver } from "@/components/tugways/tug-text-editor/argument-hint-extension";
import { resolveArgumentHint } from "@/lib/slash-argument-hint";
import { LOCAL_SLASH_COMMANDS, type LocalSlashCommandSpec } from "@/lib/slash-commands";
import { isHiddenSlashCommand } from "@/lib/slash-supported";
import { wrapPositionZero } from "./completion-providers/position-zero";
import {
  filterCommandProvider,
  localCommandCompletionProvider,
  mergeCommandProviders,
} from "./completion-providers/local-commands";
import type { TugPromptEntryDelegate } from "../tug-prompt-entry";
import type { DevCardServices } from "./dev-card";

/** Stable empty `@` provider used while services aren't ready. */
const EMPTY_FILE_COMPLETION_PROVIDER = ((_q: string) => []) as CompletionProvider;

// Lazily-constructed singleton prompt-history store shared across dev cards.
// The store is internally keyed by session id (see `lib/prompt-history-store.ts`);
// per-session persistence via `getPromptHistory` / `putPromptHistory` is baked
// in and runs on every `push()`. Cross-card reuse of history for the same
// project arrives once a stable per-workspace session id exists.
let _devPromptHistoryStore: PromptHistoryStore | null = null;
function getDevPromptHistoryStore(): PromptHistoryStore {
  if (_devPromptHistoryStore === null) {
    _devPromptHistoryStore = new PromptHistoryStore();
  }
  return _devPromptHistoryStore;
}

export function useDevCardServices(cardId: string): DevCardServices | null {
  // Read services from the module-scope `cardServicesStore` via
  // `useSyncExternalStore` ([L02]). The store handles all lifecycle:
  // it subscribes to `cardSessionBindingStore` and constructs/disposes
  // services in response to binding events. React only reads.
  //
  // Earlier this hook stored services in `useState` and populated them
  // via `useLayoutEffect` keyed on the binding. That violated [L02]
  // and produced a class of bugs where any React-side dep change tore
  // services down, sent a stray `close_session` frame, and remounted
  // the picker mid-session. The wire close is now sent only by
  // explicit `cardServicesStore.closeCard(cardId)` calls from the
  // deck-canvas's user-close handler.
  const services = useSyncExternalStore<CardServices | null>(
    cardServicesStore.subscribe,
    useCallback(() => cardServicesStore.getServices(cardId), [cardId]),
  );

  // True ref: the delegate instance arrives after the child
  // TugPromptEntry commits, so it cannot be initialized eagerly. Kept
  // here so the `/` position-0 gate (in `completionProviders`) reads
  // the same identity the component passes to `<TugPromptEntry ref>`.
  const entryDelegateRef = useRef<TugPromptEntryDelegate | null>(null);

  // Completion providers. Null-safe on `services` so this can be
  // memoized unconditionally (rules of hooks); the caller only reads
  // it when `services` is non-null. The `@` provider falls back to
  // an empty stable closure when services aren't ready, so the
  // trigger stays wired regardless of timing. The `/` provider is
  // wrapped with the position-0 gate so `/` mid-text yields an empty
  // popup.
  const completionProviders = useMemo<Record<string, CompletionProvider>>(
    () => ({
      "@": services?.fileCompletionProvider ?? EMPTY_FILE_COMPLETION_PROVIDER,
      // Local (graphical) slash commands are merged in here at the
      // composition layer — listed first so a name claude also reports
      // resolves to the local entry. The store stays generic; the gallery
      // (which calls the store provider directly) never sees them.
      "/": services
        ? wrapPositionZero(
            entryDelegateRef,
            mergeCommandProviders(
              // Every local command is always offered. `/rewind` in particular
              // is NOT gated on having a rewind target: the command must always
              // be discoverable, and opening it with nothing to rewind to shows
              // an explanatory empty-state sheet rather than silently no-opping.
              localCommandCompletionProvider(),
              // Apply the [D14] allowlist over claude's reported commands:
              // drop the known-unsupported `hidden` tier from the popup.
              // Local commands need no filter — every registry entry is
              // supported by construction.
              filterCommandProvider(
                services.sessionMetadataStore.getCommandCompletionProvider(),
                (name) => !isHiddenSlashCommand(name),
              ),
            ),
          )
        : EMPTY_FILE_COMPLETION_PROVIDER,
    }),
    [services],
  );

  // Argument-hint resolver: maps an accepted command atom's value to its
  // placeholder by reading the LIVE command catalog (skill/agent category +
  // any explicit hint the emitter shipped) and the local registry (its
  // `takesArgs` flag), deferring the decision to the pure `resolveArgumentHint`.
  // Read live so a hint that lands after the `initialize` handshake takes
  // effect without rebuilding the editor.
  const argumentHintResolver = useMemo<ArgumentHintResolver>(() => {
    if (services === null) return () => null;
    const store = services.sessionMetadataStore;
    return (value: string): string | null => {
      const catalogHit = store
        .getSnapshot()
        .slashCommands.find((c) => c.name === value);
      const local: LocalSlashCommandSpec | undefined = LOCAL_SLASH_COMMANDS.find(
        (c) => c.name === value,
      );
      return resolveArgumentHint({
        name: value,
        category: catalogHit?.category,
        argumentHint: catalogHit?.argumentHint,
        takesArgs: local?.takesArgs,
      });
    };
  }, [services]);

  return useMemo<DevCardServices | null>(() => {
    if (services === null) return null;
    return {
      codeSessionStore: services.codeSessionStore,
      sessionMetadataStore: services.sessionMetadataStore,
      historyStore: getDevPromptHistoryStore(),
      completionProviders,
      argumentHintResolver,
      editorStore: services.editorStore,
      responseStore: services.responseStore,
      gitDiffStore: services.gitDiffStore,
      skillsInventoryStore: services.skillsInventoryStore,
      hooksInventoryStore: services.hooksInventoryStore,
      entryDelegateRef,
    };
  }, [services, completionProviders, argumentHintResolver]);
}
