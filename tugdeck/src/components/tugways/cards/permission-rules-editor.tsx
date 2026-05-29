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
  useMemo,
  useState,
} from "react";
import { Trash2 } from "lucide-react";

import { TugInput } from "@/components/tugways/tug-input";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugListRow } from "@/components/tugways/tug-list-row";
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
  SCOPE_LABELS,
  SCOPE_PRECEDENCE,
  type BucketKey,
  type ResolvedRule,
  type RuleScope,
} from "@/lib/permission-rules";
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
  /** Remove this rule from its scope's bucket. */
  onRemove: (rule: ResolvedRule) => void;
}

const RuleRowContext = React.createContext<RuleRowContextValue | null>(null);

/**
 * One rule row: the full matcher string over its scope label, with a hover-
 * revealed remove button. The list-view cell wrapper handles focus; removal is
 * the trailing button (clicks stop propagation so they don't read as a row
 * select).
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
        subtitle={SCOPE_LABELS[rule.scope]}
        trailing={
          <button
            type="button"
            className="permission-rule-remove"
            aria-label={`Remove ${rule.raw}`}
            data-tug-focus="refuse"
            onClick={(event) => {
              event.stopPropagation();
              ctx.onRemove(rule);
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
// Add-rule row — pattern input + scope selector + Add
// ---------------------------------------------------------------------------

interface AddRuleRowProps {
  placeholder: string;
  onAdd: (scope: RuleScope, rule: string) => void;
}

/**
 * The add-rule control: a matcher input, a scope selector (defaulting to Local
 * — the gitignored personal file, matching where rules typically land), and an
 * Add button. Enter in the input also adds. The matcher is stored verbatim;
 * Claude Code validates it on reload.
 */
function AddRuleRow({ placeholder, onAdd }: AddRuleRowProps): React.ReactElement {
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<RuleScope>("local");

  const submit = useCallback(() => {
    const rule = draft.trim();
    if (rule === "") return;
    onAdd(scope, rule);
    setDraft("");
  }, [draft, scope, onAdd]);

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
      <div className="permission-rules-scope" role="group" aria-label="Rule scope">
        {SCOPE_PRECEDENCE.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className="permission-rules-scope-option"
            data-active={candidate === scope ? "true" : undefined}
            onClick={() => setScope(candidate)}
          >
            {SCOPE_LABELS[candidate]}
          </button>
        ))}
      </div>
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
      onRemove: (rule) => {
        void store.mutate(rule.scope, bucket, "remove", rule.raw);
      },
    }),
    [baseDataSource, store, bucket],
  );

  const onAdd = useCallback(
    (scope: RuleScope, rule: string) => {
      void store.mutate(scope, bucket, "add", rule);
    },
    [store, bucket],
  );

  return (
    <div className="permission-rules-panel">
      {header}
      <TugInput
        size="sm"
        value={query}
        placeholder="Search rules…"
        aria-label="Search rules"
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
 * The editor body: a tab strip, the active tab's panel, and a Done button.
 * Owns the store (one per open, loaded on mount) and the active tab (structural
 * state — which panel mounts; the tab *highlight* is a CSS `data-active`
 * attribute per [L06]).
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

  const workspaceHeader = (
    <div className="permission-rules-cwd" data-slot="workspace-cwd">
      <span className="permission-rule-matcher">{cwd}</span>
      <span className="permission-rules-cwd-tag">Working directory</span>
    </div>
  );

  return (
    <div className="permission-rules-sheet">
      <div className="permission-rules-tabs" role="tablist" aria-label="Permission rules">
        {TABS.map((spec) => (
          <button
            key={spec.id}
            type="button"
            role="tab"
            className="permission-rules-tab"
            data-tab={spec.id}
            data-active={spec.id === tab ? "true" : undefined}
            aria-selected={spec.id === tab}
            onClick={() => setTab(spec.id)}
          >
            {spec.label}
          </button>
        ))}
      </div>

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
      content: (close) => (
        <PermissionRulesSheetBody cwd={cwd} onDone={() => close()} />
      ),
    });
  }, [showSheet, sessionMetadataStore, cardId]);

  return { openRulesSheet, renderRulesSheet: renderSheet };
}
