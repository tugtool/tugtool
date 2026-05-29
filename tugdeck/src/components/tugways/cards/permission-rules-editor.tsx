/**
 * permission-rules-editor.tsx — the `/permissions` rules editor.
 *
 * A card-scoped tabbed sheet ([D15]) over Claude Code's tool-permission
 * **rules**, matching the terminal's `/permissions` UI: tabs `Recently denied`
 * / `Allow` / `Ask` / `Deny` / `Workspace`, each rule a tool-matcher string,
 * with search + add-rule + remove. Distinct from the permission *mode* chip
 * ([permission-mode-chip.tsx]) — mode is session behavior, rules are the
 * allow/ask/deny matcher lists in the settings files.
 *
 * Data flows through {@link PermissionRulesStore} over tugcast's
 * `/api/permissions` endpoint (read every scope, mutate one rule at a time).
 * The store is the [L02] external source; rule lists window + filter through
 * `TugListView` + `useFilteredDataSource`. Writes take effect live (Claude Code
 * reloads `permissions` without a respawn — `transport-exploration.md`), so the
 * sheet stays open and the list reflects the change.
 *
 * `Recently denied` has no persisted feed yet — denials are runtime events the
 * dev card will surface when the `control_request_forward` UI lands ([#step-15])
 * — so it renders the terminal's empty-state. The promote-to-rule affordance
 * arrives with that feed.
 *
 * Compositional component — composes `TugSheet`, `TugListView`, `TugInput`,
 * `TugPushButton`; its only own CSS is the tab strip + panel layout. Composed
 * children keep their own tokens [L20].
 *
 * Laws: [L02] store subscription, [L06] no React state for appearance
 *       (tab highlight is a CSS `data-active` attribute; active tab is
 *       structural state — which panel mounts), [L11] controls emit / the body
 *       owns the handling, [L20] token sovereignty, [D15] card-scoped overlay.
 *
 * @module components/tugways/cards/permission-rules-editor
 */

import "./permission-rules-editor.css";

import React, {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { Trash2 } from "lucide-react";

import { TugInput } from "@/components/tugways/tug-input";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugListRow } from "@/components/tugways/tug-list-row";
import { TugTabBar } from "@/components/tugways/tug-tab-bar";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import type { CardState } from "@/layout-tree";
import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewCellRenderer,
} from "@/components/tugways/tug-list-view";
import {
  useFilteredDataSource,
  type FilteredTugListViewDataSource,
} from "@/components/tugways/use-filtered-data-source";
import { useTugSheet } from "@/components/tugways/tug-sheet";
import {
  BucketDataSource,
  PermissionRulesStore,
} from "@/lib/permission-rules-store";
import {
  type BucketKey,
  type ResolvedRule,
} from "@/lib/permission-rules";
import { TugConfirmPopover } from "@/components/tugways/tug-confirm-popover";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";

// ---------------------------------------------------------------------------
// Tab model
// ---------------------------------------------------------------------------

/** One editor tab. `recentlyDenied` carries no bucket (runtime feed). */
type TabId = "recentlyDenied" | "allow" | "ask" | "deny" | "workspace";

interface TabSpec {
  id: TabId;
  label: string;
  /** The settings bucket this tab edits, or null for the runtime feed. */
  bucket: BucketKey | null;
}

/**
 * Tabs in terminal order. The three rule buckets + Workspace edit settings
 * files; Recently-denied is the runtime feed (no bucket).
 */
const TABS: readonly TabSpec[] = [
  { id: "recentlyDenied", label: "Recently denied", bucket: null },
  { id: "allow", label: "Allow", bucket: "allow" },
  { id: "ask", label: "Ask", bucket: "ask" },
  { id: "deny", label: "Deny", bucket: "deny" },
  { id: "workspace", label: "Workspace", bucket: "additionalDirectories" },
];

/**
 * The tabs as `TugTabBar` cards: a fixed, non-closable set (`closable: false`
 * → no per-tab ×; the bar is rendered `addable={false}` → no `[+]`). The
 * `componentId` is a non-registered sentinel — these are panel tabs, not deck
 * cards, so the bar falls back to its default tab icon.
 */
const TAB_CARDS: readonly CardState[] = TABS.map((spec) => ({
  id: spec.id,
  componentId: "permission-rules-tab",
  title: spec.label,
  closable: false,
}));

/** One-line description under the tab strip, matching the terminal copy. */
const TAB_DESCRIPTIONS: Record<TabId, string> = {
  recentlyDenied: "Commands denied by the auto mode classifier will appear here.",
  allow: "Claude won't ask before using allowed tools.",
  ask: "Claude will always ask for confirmation before using these tools.",
  deny: "Claude will always reject requests to use denied tools.",
  workspace:
    "Claude can read files in the workspace, and make edits when Accept Edits is on.",
};

/** Add-row input placeholder per editable bucket. */
const ADD_PLACEHOLDER: Record<BucketKey, string> = {
  allow: "Add an allow rule, e.g. Bash(npm run test:*)",
  ask: "Add an ask rule, e.g. Bash(git push:*)",
  deny: "Add a deny rule, e.g. Read(./.env)",
  additionalDirectories: "Add a directory, e.g. ../shared",
};

// ---------------------------------------------------------------------------
// Rule cell — one matcher row with a remove affordance
// ---------------------------------------------------------------------------

interface RuleRowContextValue {
  /** Base (unfiltered) data source — the cell reads the rule through it. */
  baseDataSource: BucketDataSource;
  /**
   * Request removal of this rule — opens a confirm popover anchored to the
   * clicked trash button. Removal only happens after the user confirms.
   */
  onRemoveRequest: (rule: ResolvedRule, anchorEl: HTMLElement) => void;
}

const RuleRowContext = React.createContext<RuleRowContextValue | null>(null);

/**
 * One rule row: the full matcher string, with a hover-revealed remove button.
 * The list-view cell wrapper handles focus; the trash button requests removal
 * (clicks stop propagation so they don't read as a row select), which opens a
 * danger confirm popover — removal takes a deliberate second click.
 */
const RuleCell: TugListViewCellRenderer<FilteredTugListViewDataSource> =
  function RuleCell({
    index,
    dataSource,
  }: TugListViewCellProps<FilteredTugListViewDataSource>): React.ReactElement | null {
    const ctx = useContext(RuleRowContext);
    if (ctx === null) return null;
    const baseIndex = dataSource.baseIndexFor(index);
    const rule = ctx.baseDataSource.ruleAt(baseIndex);
    return (
      <TugListRow
        variant="flush"
        trailingReveal="hover"
        trailing={
          <button
            type="button"
            className="permission-rule-remove"
            aria-label={`Remove ${rule.raw}`}
            data-tug-focus="refuse"
            onClick={(event) => {
              event.stopPropagation();
              ctx.onRemoveRequest(rule, event.currentTarget);
            }}
          >
            <Trash2 aria-hidden="true" size={14} />
          </button>
        }
      >
        <span className="permission-rule-matcher" title={rule.raw}>
          {rule.raw}
        </span>
      </TugListRow>
    );
  };

const RULE_CELL_RENDERERS: Record<
  string,
  TugListViewCellRenderer<FilteredTugListViewDataSource>
> = { rule: RuleCell };

// ---------------------------------------------------------------------------
// Add-rule row — pattern input + Add
// ---------------------------------------------------------------------------

interface AddRuleRowProps {
  placeholder: string;
  onAdd: (rule: string) => void;
}

/**
 * The add-rule control: a matcher input and an Add button (Enter in the input
 * also adds). The matcher is stored verbatim; Claude Code validates it on
 * reload. New rules land in the project's local scope alongside the existing
 * ones (the owning `RulePanel` picks the scope).
 */
function AddRuleRow({ placeholder, onAdd }: AddRuleRowProps): React.ReactElement {
  const [draft, setDraft] = useState("");

  const submit = useCallback(() => {
    const rule = draft.trim();
    if (rule === "") return;
    onAdd(rule);
    setDraft("");
  }, [draft, onAdd]);

  return (
    <div className="permission-rules-add">
      <TugInput
        size="sm"
        value={draft}
        placeholder={placeholder}
        aria-label="New rule matcher"
        className="permission-rules-add-input"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
      />
      <TugPushButton
        size="sm"
        emphasis="filled"
        data-slot="permission-rules-add-submit"
        disabled={draft.trim() === ""}
        onClick={submit}
      >
        Add
      </TugPushButton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rule-bucket panel — search + add + windowed list
// ---------------------------------------------------------------------------

interface RulePanelProps {
  store: PermissionRulesStore;
  bucket: BucketKey;
  /** Optional fixed header (the Workspace tab's read-only cwd row). */
  header?: React.ReactNode;
}

/**
 * A panel over one editable bucket: a search field, the add-rule row, and a
 * windowed, filtered list of the scope-labeled rule union.
 */
function RulePanel({ store, bucket, header }: RulePanelProps): React.ReactElement {
  const [query, setQuery] = useState("");
  // The rule whose removal is awaiting confirmation, plus the trash button it
  // anchors the confirm popover to. `null` when no confirm is pending.
  const [pendingRemoval, setPendingRemoval] = useState<{
    rule: ResolvedRule;
    anchorEl: HTMLElement;
  } | null>(null);

  const baseDataSource = useMemo(
    () => new BucketDataSource(store, bucket),
    [store, bucket],
  );

  const filtered = useFilteredDataSource(
    baseDataSource,
    (baseIndex, base) => {
      const needle = query.trim().toLowerCase();
      if (needle === "") return true;
      return (base as BucketDataSource).ruleAt(baseIndex).raw
        .toLowerCase()
        .includes(needle);
    },
    query,
  );

  const rowContext = useMemo<RuleRowContextValue>(
    () => ({
      baseDataSource,
      onRemoveRequest: (rule, anchorEl) => setPendingRemoval({ rule, anchorEl }),
    }),
    [baseDataSource],
  );

  // New rules land in the project's local scope (`.claude/settings.local.json`)
  // — where the existing rules live and where Claude Code's own `/permissions`
  // add defaults ([#step-1-5]).
  const onAdd = useCallback(
    (rule: string) => {
      void store.mutate("local", bucket, "add", rule);
    },
    [store, bucket],
  );

  return (
    <div className="permission-rules-panel">
      {header}
      <TugInput
        size="sm"
        value={query}
        placeholder="Filter rules"
        aria-label="Filter rules"
        className="permission-rules-search"
        onChange={(event) => setQuery(event.target.value)}
      />
      <AddRuleRow placeholder={ADD_PLACEHOLDER[bucket]} onAdd={onAdd} />
      <RuleRowContext.Provider value={rowContext}>
        <div className="permission-rules-list">
          <TugListView<FilteredTugListViewDataSource>
            dataSource={filtered}
            cellRenderers={RULE_CELL_RENDERERS}
            rowLayout="flush"
          />
        </div>
      </RuleRowContext.Provider>
      <TugConfirmPopover
        open={pendingRemoval !== null}
        anchorEl={pendingRemoval?.anchorEl ?? null}
        message="Remove this rule?"
        confirmLabel="Remove"
        confirmRole="danger"
        cancelLabel="Cancel"
        side="left"
        onConfirm={() => {
          if (pendingRemoval !== null) {
            void store.mutate(pendingRemoval.rule.scope, bucket, "remove", pendingRemoval.rule.raw);
          }
          setPendingRemoval(null);
        }}
        onCancel={() => setPendingRemoval(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheet body
// ---------------------------------------------------------------------------

interface PermissionRulesSheetBodyProps {
  /** Session working directory — the project root scopes resolve under. */
  cwd: string;
  /** Dismiss the sheet. */
  onDone: () => void;
}

/**
 * The editor body: a `TugTabBar`, the active tab's panel, and a Done button.
 * Owns the store (one per open, loaded on mount) and the active tab.
 *
 * The tab bar is a fixed set ([TAB_CARDS], non-closable, `addable={false}`).
 * Per [L11] it emits `selectTab` through the chain; the body's
 * `useResponderForm` responder handles it and updates the active tab
 * (structural state — which panel mounts). The selected-tab highlight is the
 * bar's own CSS `data-active` treatment [L06].
 */
function PermissionRulesSheetBody({
  cwd,
  onDone,
}: PermissionRulesSheetBodyProps): React.ReactElement {
  const store = useMemo(() => new PermissionRulesStore(cwd), [cwd]);
  useEffect(() => {
    void store.load();
  }, [store]);

  const [tab, setTab] = useState<TabId>("allow");
  const active = TABS.find((t) => t.id === tab) ?? TABS[1];

  // TugTabBar dispatches `selectTab` through the chain to this responder.
  const tabBarId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    selectTab: { [tabBarId]: (id: string) => setTab(id as TabId) },
  });

  const workspaceHeader = (
    <div className="permission-rules-cwd" data-slot="workspace-cwd">
      <span className="permission-rule-matcher">{cwd}</span>
      <span className="permission-rules-cwd-tag">Working directory</span>
    </div>
  );

  return (
    <ResponderScope>
      <div
        className="permission-rules-sheet"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        <TugTabBar
          stackId="permission-rules"
          cards={TAB_CARDS}
          activeCardId={tab}
          senderId={tabBarId}
          addable={false}
        />

        <p className="permission-rules-description">{TAB_DESCRIPTIONS[active.id]}</p>

        {active.bucket === null ? (
          <div className="permission-rules-empty" data-slot="recently-denied-empty">
            No recent denials.
          </div>
        ) : (
          <RulePanel
            store={store}
            bucket={active.bucket}
            header={active.id === "workspace" ? workspaceHeader : undefined}
          />
        )}

        <div className="tug-sheet-actions">
          <TugPushButton emphasis="filled" onClick={onDone}>
            Done
          </TugPushButton>
        </div>
      </div>
    </ResponderScope>
  );
}

// ---------------------------------------------------------------------------
// usePermissionRulesSheet — the card-hosted editor
// ---------------------------------------------------------------------------

/** Args for {@link usePermissionRulesSheet}. */
export interface UsePermissionRulesSheetArgs {
  /** Card whose session binding supplies the project root before metadata lands. */
  cardId: string;
  /** Metadata store supplying the live session `cwd` (preferred when present). */
  sessionMetadataStore: SessionMetadataStore;
}

/** Imperative handle to the single, card-hosted rules editor. */
export interface PermissionRulesSheetController {
  /** Open the editor (no-op when the session `cwd` is not yet known). */
  openRulesSheet: () => void;
  /** Render the sheet portal — call once in the card's content region. */
  renderRulesSheet: () => React.ReactNode;
}

/**
 * Own the rules editor once, at the card level, so the `/permissions` slash
 * command opens it card-scoped ([D15]). The dev card calls this hook, routes
 * its `RUN_SLASH_COMMAND` handler for `permissions` to `openRulesSheet`, and
 * renders `renderRulesSheet` in its content region.
 *
 * The `cwd` is resolved fresh at open time ([L07]): the card's bind-time
 * `projectDir` — the project root this dev card is rooted at, known from the
 * moment the session binds (so `/permissions` works before claude's first
 * metadata frame) — falling back to the live `system_metadata` cwd. With
 * neither known the open is a no-op — there's no project root to resolve the
 * scope files under.
 */
export function usePermissionRulesSheet({
  cardId,
  sessionMetadataStore,
}: UsePermissionRulesSheetArgs): PermissionRulesSheetController {
  const { showSheet, renderSheet } = useTugSheet();

  const openRulesSheet = useCallback(() => {
    const binding = cardSessionBindingStore.getBinding(cardId);
    const projectDir = binding?.projectDir ?? "";
    const cwd =
      projectDir !== ""
        ? projectDir
        : sessionMetadataStore.getSnapshot().cwd ?? null;
    if (cwd === null || cwd === "") return;
    void showSheet({
      title: "Permissions",
      displayWidth: "wide",
      content: (close) => (
        <PermissionRulesSheetBody cwd={cwd} onDone={() => close()} />
      ),
    });
  }, [showSheet, sessionMetadataStore, cardId]);

  return { openRulesSheet, renderRulesSheet: renderSheet };
}
