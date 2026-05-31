/**
 * local-commands.ts — slash-completion provider for the local-command
 * registry, plus a small provider-merge helper.
 *
 * The dev card's `/` completion comes from claude (skills, agents,
 * claude's own slash commands) via
 * `SessionMetadataStore.getCommandCompletionProvider()`. Locally-handled
 * commands ([D23], `lib/slash-commands.ts`) are *not* claude's, so they
 * are not in that set — the dev card merges them in at its composition
 * layer (where the `/` provider is already assembled and wrapped with
 * `wrapPositionZero`). Doing the merge here, not inside
 * `SessionMetadataStore`, keeps the store generic and keeps local
 * commands out of other hosts' popups (e.g. the gallery, which calls the
 * store provider directly).
 *
 * Pure: depends only on the shared text-engine types and the registry.
 *
 * @module components/tugways/cards/completion-providers/local-commands
 */

import type { CompletionItem, CompletionProvider } from "@/lib/tug-text-types";
import { LOCAL_SLASH_COMMANDS, type LocalCommandName } from "@/lib/slash-commands";

/** Options for {@link localCommandCompletionProvider}. */
export interface LocalCommandProviderOptions {
  /**
   * Per-command availability gate, evaluated fresh on every query so it can
   * read live state (e.g. `/rewind` is offered only once the session has a
   * rewind target — [#step-7-3] empty-state gating). Omitted ⇒ every
   * registered command is offered.
   */
  isOffered?: (name: LocalCommandName) => boolean;
}

/**
 * A `CompletionProvider` over {@link LOCAL_SLASH_COMMANDS}. Items are the same
 * shape as claude's slash-command completions (`atom.type = "command"`), so
 * accepting one inserts a command atom and dismisses the popup exactly like
 * any other slash command — the completion layer draws no local/remote
 * distinction. The split happens later, at submit: `performSubmit` recognizes
 * a *local* command atom and opens its surface; everything else is sent to
 * claude ([#step-1c] / [D23]). Filtered by case-insensitive substring on the
 * name.
 */
export function localCommandCompletionProvider(
  options: LocalCommandProviderOptions = {},
): CompletionProvider {
  const { isOffered } = options;
  return (query: string): CompletionItem[] => {
    const lower = query.toLowerCase();
    const items: CompletionItem[] = [];
    for (const cmd of LOCAL_SLASH_COMMANDS) {
      if (isOffered !== undefined && !isOffered(cmd.name)) continue;
      if (lower === "" || cmd.name.toLowerCase().includes(lower)) {
        items.push({
          label: cmd.name,
          atom: {
            kind: "atom",
            type: "command",
            label: cmd.name,
            value: cmd.name,
          },
        });
      }
    }
    return items;
  };
}

/**
 * Merge command providers into one, de-duplicating by command label
 * (first wins). List the local provider first so a name claude also
 * reports resolves to the local (graphical) entry rather than a
 * duplicate row.
 *
 * Synchronous only — command providers don't carry the async
 * `subscribe` hook that file completion uses.
 */
export function mergeCommandProviders(
  ...providers: readonly CompletionProvider[]
): CompletionProvider {
  return (query: string): CompletionItem[] => {
    const seen = new Set<string>();
    const merged: CompletionItem[] = [];
    for (const provider of providers) {
      for (const item of provider(query)) {
        if (seen.has(item.label)) continue;
        seen.add(item.label);
        merged.push(item);
      }
    }
    return merged;
  };
}
