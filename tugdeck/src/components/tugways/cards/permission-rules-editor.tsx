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
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Trash2, FolderOpen } from "lucide-react";

import { TugInput } from "@/components/tugways/tug-input";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugListRow } from "@/components/tugways/tug-list-row";
import { TugTabBar } from "@/components/tugways/tug-tab-bar";
import { TugAccordion, TugAccordionItem } from "@/components/tugways/tug-accordion";
import { TugRadioGroup, TugRadioItem } from "@/components/tugways/tug-radio-group";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import type { CardState } from "@/layout-tree";
import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewCellRenderer,
  type TugListViewHandle,
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
  denialToMatcher,
  isValidRuleMatcher,
  RULE_BUCKETS,
  type BucketKey,
  type ResolvedRule,
  type RuleBucket,
  type RuleScope,
} from "@/lib/permission-rules";
import { TugConfirmPopover } from "@/components/tugways/tug-confirm-popover";
import { fetchDirectoryCompletions, type DirCompletion } from "@/lib/fs-complete";
import {
  isDirectoryPickerAvailable,
  pickDirectory,
} from "@/lib/native-directory-picker";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";
import type { SessionMetadataStore } from "@/lib/session-metadata-store";
import type { CodeSessionStore } from "@/lib/code-session-store";

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
          <TugPushButton
            emphasis="ghost"
            size="sm"
            aria-label={`Delete ${rule.raw}`}
            data-tug-focus="refuse"
            onClick={(event) => {
              if (event === undefined) return;
              event.stopPropagation();
              ctx.onRemoveRequest(rule, event.currentTarget);
            }}
          >
            <Trash2 aria-hidden="true" size={14} />
          </TugPushButton>
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
// Scope picker — where a new rule is saved (matches the terminal's choices)
// ---------------------------------------------------------------------------

interface ScopeOption {
  scope: RuleScope;
  label: string;
  description: string;
}

/** The three writable scopes, worded + ordered like the terminal's prompt. */
const SCOPE_OPTIONS: readonly ScopeOption[] = [
  { scope: "local", label: "Project settings (local)", description: "Saved in .claude/settings.local.json" },
  { scope: "project", label: "Project settings", description: "Checked in at .claude/settings.json" },
  { scope: "user", label: "User settings", description: "Saved at ~/.claude/settings.json" },
];

// ---------------------------------------------------------------------------
// Add-rule form — matcher input + scope radios + Add (inside an accordion)
// ---------------------------------------------------------------------------

/**
 * What an add-form entry is: a tool-matcher `rule` (Allow/Ask/Deny) or a
 * filesystem `directory` (Workspace). Directory mode validates permissively
 * (any non-empty path, like the terminal), offers Tab/click path completion,
 * and an OS "Browse…" picker.
 */
type AddEntryKind = "rule" | "directory";

interface AddRuleFormProps {
  placeholder: string;
  onAdd: (scope: RuleScope, rule: string) => void;
  /** Matcher rule vs filesystem directory — drives validation + completion. */
  kind: AddEntryKind;
  /** Session cwd — the base relative paths complete against (directory mode). */
  cwd?: string;
}

/**
 * The add form: an entry input, a {@link TugRadioGroup} choosing the save scope
 * (label + description, worded like the terminal), and an Add button. The radio
 * group dispatches `SELECT_VALUE` through the chain ([L11]); this form's
 * `useResponderForm` responder updates the scope.
 *
 * In `rule` mode the matcher must be syntactically valid
 * ({@link isValidRuleMatcher}) for Add to enable — unknown tool names pass
 * (matching the terminal), blatant garbage doesn't. In `directory` mode entry
 * is permissive (any non-empty path) and the field gains debounced directory
 * completion (`Tab` or click a suggestion to complete) plus an OS picker. Enter
 * adds; the value is stored verbatim.
 */
function AddRuleForm({ placeholder, onAdd, kind, cwd }: AddRuleFormProps): React.ReactElement {
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<RuleScope>("local");
  const [completions, setCompletions] = useState<readonly DirCompletion[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isDir = kind === "directory";
  const trimmed = draft.trim();
  const valid = isDir ? trimmed !== "" : isValidRuleMatcher(draft);
  const showPicker = isDir && isDirectoryPickerAvailable();

  const radioId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: { [radioId]: (next: string) => setScope(next as RuleScope) },
  });

  // Directory mode: debounced completion fetch against the session cwd. An
  // empty draft lists the cwd's child directories, so the field opens browsable.
  useEffect(() => {
    if (!isDir || cwd === undefined) return;
    const handle = setTimeout(() => {
      void fetchDirectoryCompletions(cwd, draft).then(setCompletions);
    }, 120);
    return () => clearTimeout(handle);
  }, [isDir, cwd, draft]);

  const submit = useCallback(() => {
    const entry = draft.trim();
    if (isDir ? entry === "" : !isValidRuleMatcher(entry)) return;
    onAdd(scope, entry);
    setDraft("");
    setCompletions([]);
  }, [draft, scope, onAdd, isDir]);

  const complete = useCallback((value: string) => {
    setDraft(value);
    inputRef.current?.focus();
  }, []);

  const browse = useCallback(() => {
    void pickDirectory(draft.trim() !== "" ? draft.trim() : cwd).then((path) => {
      if (path !== null) setDraft(path);
    });
  }, [draft, cwd]);

  return (
    <ResponderScope>
      <div
        className="permission-rules-add"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        <div className="permission-rules-add-entry">
          <TugInput
            ref={inputRef}
            size="sm"
            value={draft}
            placeholder={placeholder}
            aria-label={isDir ? "New directory path" : "New rule matcher"}
            validation={trimmed !== "" && !valid ? "invalid" : "default"}
            className="permission-rules-add-input"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
                return;
              }
              // Tab completes to the first suggestion (terminal parity),
              // falling back to normal focus movement when there's nothing
              // to complete.
              if (event.key === "Tab" && isDir && completions.length > 0) {
                event.preventDefault();
                complete(completions[0].value);
              }
            }}
          />
          {showPicker && (
            <TugPushButton
              size="sm"
              emphasis="ghost"
              aria-label="Browse for a directory"
              data-slot="permission-rules-browse"
              onClick={browse}
            >
              <FolderOpen aria-hidden="true" size={14} />
            </TugPushButton>
          )}
        </div>
        {isDir && (
          // Always rendered at a fixed height so the accordion's content height
          // is stable from the first open frame — populating it later never
          // grows the box, so the radios below don't hop. ([L06] no reflow.)
          <ul className="permission-rules-completions" data-slot="dir-completions">
            {completions.length === 0 ? (
              <li className="permission-rules-completions-empty" aria-disabled="true">
                No matching directories
              </li>
            ) : (
              completions.map((c) => (
                <li key={c.value}>
                  <TugPushButton
                    size="sm"
                    emphasis="ghost"
                    className="permission-rules-completion"
                    onClick={() => complete(c.value)}
                  >
                    {c.label}
                  </TugPushButton>
                </li>
              ))
            )}
          </ul>
        )}
        <TugRadioGroup
          value={scope}
          senderId={radioId}
          size="md"
          orientation="vertical"
          aria-label={isDir ? "Where to save the directory" : "Where to save the rule"}
          className="permission-rules-scope"
        >
          {SCOPE_OPTIONS.map((opt) => (
            <TugRadioItem key={opt.scope} value={opt.scope} description={opt.description}>
              {opt.label}
            </TugRadioItem>
          ))}
        </TugRadioGroup>
        <div className="permission-rules-add-actions">
          <TugPushButton
            size="sm"
            emphasis="filled"
            data-slot="permission-rules-add-submit"
            disabled={!valid}
            onClick={submit}
          >
            Add
          </TugPushButton>
        </div>
      </div>
    </ResponderScope>
  );
}

// ---------------------------------------------------------------------------
// Rule-bucket panel — search + add accordion + windowed list
// ---------------------------------------------------------------------------

interface RulePanelProps {
  store: PermissionRulesStore;
  bucket: BucketKey;
  /** Session cwd — completion base + scope resolution root (Workspace tab). */
  cwd?: string;
  /** Optional fixed header (the Workspace tab's read-only cwd row). */
  header?: React.ReactNode;
}

/**
 * A panel over one editable bucket: a filter field, a collapsible add-rule
 * form, and a windowed, filtered list of the scope-labeled rule union. A freshly
 * added rule is scrolled into view so the user sees it landed.
 */
function RulePanel({ store, bucket, cwd, header }: RulePanelProps): React.ReactElement {
  const isDir = bucket === "additionalDirectories";
  const [query, setQuery] = useState("");
  // The rule whose removal is awaiting confirmation, plus the trash button it
  // anchors the confirm popover to. `null` when no confirm is pending.
  const [pendingRemoval, setPendingRemoval] = useState<{
    rule: ResolvedRule;
    anchorEl: HTMLElement;
  } | null>(null);

  const listRef = useRef<TugListViewHandle | null>(null);
  // Raw matcher of a just-added rule, scrolled into view once it lands in the
  // list (cleared after the scroll). A ref, not state — it must not re-render.
  const pendingScrollRef = useRef<string | null>(null);

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

  // Re-render when the store changes so the scroll effect below can run after
  // an add lands the new rule in the (already-recomputed) filtered projection.
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    const raw = pendingScrollRef.current;
    if (raw === null) return;
    const count = filtered.numberOfItems();
    for (let i = 0; i < count; i += 1) {
      if (baseDataSource.ruleAt(filtered.baseIndexFor(i)).raw === raw) {
        listRef.current?.scrollToIndex(i, { block: "nearest" });
        pendingScrollRef.current = null;
        return;
      }
    }
  }, [snapshot, filtered, baseDataSource]);

  const rowContext = useMemo<RuleRowContextValue>(
    () => ({
      baseDataSource,
      onRemoveRequest: (rule, anchorEl) => setPendingRemoval({ rule, anchorEl }),
    }),
    [baseDataSource],
  );

  const onAdd = useCallback(
    (scope: RuleScope, rule: string) => {
      pendingScrollRef.current = rule;
      void store.mutate(scope, bucket, "add", rule);
    },
    [store, bucket],
  );

  const addLabel = bucket === "additionalDirectories" ? "Add a directory" : "Add a rule";

  // Finder-style count under the list. `total` is the whole bucket; `shown` is
  // the filtered subset. The `snapshot` subscription above re-renders this on
  // every load/mutation, so these reads stay current.
  const total = baseDataSource.numberOfItems();
  const shown = filtered.numberOfItems();
  const noun = (n: number): string => (n === 1 ? "item" : "items");
  const countText =
    query.trim() !== ""
      ? `Showing ${shown} of ${total} ${noun(total)}`
      : `${total} ${noun(total)}`;

  return (
    <div className="permission-rules-panel">
      {header}
      <TugAccordion type="single" collapsible variant="outline">
        <TugAccordionItem value="add" trigger={addLabel}>
          <AddRuleForm
            placeholder={ADD_PLACEHOLDER[bucket]}
            onAdd={onAdd}
            kind={isDir ? "directory" : "rule"}
            cwd={cwd}
          />
        </TugAccordionItem>
      </TugAccordion>
      <TugInput
        size="sm"
        value={query}
        placeholder={isDir ? "Filter directories" : "Filter rules"}
        aria-label={isDir ? "Filter directories" : "Filter rules"}
        className="permission-rules-search"
        onChange={(event) => setQuery(event.target.value)}
      />
      <RuleRowContext.Provider value={rowContext}>
        <div
          className={
            isDir ? "permission-rules-list permission-rules-list--dirs" : "permission-rules-list"
          }
        >
          <TugListView<FilteredTugListViewDataSource>
            ref={listRef}
            dataSource={filtered}
            cellRenderers={RULE_CELL_RENDERERS}
            rowLayout="flush"
          />
        </div>
      </RuleRowContext.Provider>
      <TugLabel
        size="2xs"
        emphasis="calm"
        align="center"
        className="permission-rules-count"
      >
        {countText}
      </TugLabel>
      <TugConfirmPopover
        open={pendingRemoval !== null}
        anchorEl={pendingRemoval?.anchorEl ?? null}
        message={isDir ? "Delete this directory?" : "Delete this rule?"}
        confirmLabel="Delete"
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
// Recently-denied panel — session denial feed with promote-to-rule
// ---------------------------------------------------------------------------

/** Capitalized button label per bucket. */
const BUCKET_BUTTON_LABEL: Record<RuleBucket, string> = {
  allow: "Allow",
  ask: "Ask",
  deny: "Deny",
};

/**
 * The Recently-denied tab: the session's accumulated tool-call denials (rule or
 * auto-mode classifier), newest last, each with one-click promote to a local
 * Allow/Ask/Deny rule (matcher via `denialToMatcher`). Empty-state matches the
 * terminal until a denial lands. Sourced from the code-session store's
 * `permissionDenials` ([L02]) — runtime-only, never persisted.
 */
function RecentlyDeniedPanel({
  codeSessionStore,
  rulesStore,
}: {
  codeSessionStore: CodeSessionStore;
  rulesStore: PermissionRulesStore;
}): React.ReactElement {
  const denials = useSyncExternalStore(
    codeSessionStore.subscribe,
    useCallback(
      () => codeSessionStore.getSnapshot().permissionDenials,
      [codeSessionStore],
    ),
  );

  if (denials.length === 0) {
    return (
      <TugLabel
        size="lg"
        emphasis="calm"
        align="center"
        className="permission-rules-empty"
        data-slot="recently-denied-empty"
      >
        No recent denials.
      </TugLabel>
    );
  }

  return (
    <div className="permission-rules-denied-list" data-slot="recently-denied-list">
      {denials.map((denial) => {
        const matcher = denialToMatcher(denial.toolName, denial.toolInput);
        return (
          <TugListRow
            key={denial.toolUseId}
            variant="flush"
            trailing={
              <span className="permission-rules-denied-actions">
                {RULE_BUCKETS.map((bucket) => (
                  <TugPushButton
                    key={bucket}
                    emphasis="ghost"
                    size="sm"
                    data-tug-focus="refuse"
                    onClick={(event) => {
                      if (event === undefined) return;
                      event.stopPropagation();
                      void rulesStore.mutate("local", bucket, "add", matcher);
                    }}
                  >
                    {BUCKET_BUTTON_LABEL[bucket]}
                  </TugPushButton>
                ))}
              </span>
            }
          >
            <span className="permission-rule-matcher" title={matcher}>
              {matcher}
            </span>
          </TugListRow>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheet body
// ---------------------------------------------------------------------------

interface PermissionRulesSheetBodyProps {
  /** Session working directory — the project root scopes resolve under. */
  cwd: string;
  /** Code-session store supplying the session's accumulated denials. */
  codeSessionStore: CodeSessionStore;
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
  codeSessionStore,
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
          className="permission-rules-tabs"
        />

        <TugLabel
        size="md"
        emphasis="normal"
        className="permission-rules-description"
      >
        {TAB_DESCRIPTIONS[active.id]}
      </TugLabel>

        {active.bucket === null ? (
          <RecentlyDeniedPanel codeSessionStore={codeSessionStore} rulesStore={store} />
        ) : (
          <RulePanel
            store={store}
            bucket={active.bucket}
            cwd={cwd}
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
  /** Code-session store supplying the session's accumulated denials (Recently-denied tab). */
  codeSessionStore: CodeSessionStore;
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
  codeSessionStore,
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
        <PermissionRulesSheetBody
          cwd={cwd}
          codeSessionStore={codeSessionStore}
          onDone={() => close()}
        />
      ),
    });
  }, [showSheet, sessionMetadataStore, codeSessionStore, cardId]);

  return { openRulesSheet, renderRulesSheet: renderSheet };
}
