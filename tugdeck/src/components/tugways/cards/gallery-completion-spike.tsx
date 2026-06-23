/**
 * gallery-completion-spike.tsx — design spike for slash-command and
 * file-completion atoms.
 *
 * A temporary gallery card that renders four candidate row treatments
 * (A glyph + path · B atom-chip rows · C grouped + trailing hint · D
 * two-column preview) against the current baseline, for the same static
 * sample data. A trigger toggle switches between the `/` command catalog
 * and the `@` file catalog; a query field filters and highlights matches.
 *
 * The baseline column reuses the genuine `.tug-completion-menu` classes
 * (and tokens, via the imported completion-menu CSS) so the comparison is
 * faithful; the alternatives only restyle the row anatomy.
 *
 * Not production code — this card exists to vet the direction before any
 * change lands in the real completion painter (`paintCompletionPopup` in
 * `tug-text-editor.tsx`) and `TugFileChooser`.
 *
 * @module components/tugways/cards/gallery-completion-spike
 */

import React, { useId, useMemo, useState } from "react";
import {
  Terminal,
  Folder,
  File as FileIcon,
  FileCode,
  FileText,
  CornerDownLeft,
} from "lucide-react";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import { TugInput } from "@/components/tugways/tug-input";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugAtomChip } from "@/lib/tug-atom-chip";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import "../tug-completion-menu.css";
import "./gallery-completion-spike.css";

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

type Trigger = "/" | "@";

interface CommandRow {
  kind: "command";
  /** Command name (no leading slash). */
  label: string;
  description: string;
  /** Provider group — drives alt C section headers. */
  group: "Local" | "Built-in";
  /** Argument hint shown in the trailing column (alt C) / preview (alt D). */
  args?: string;
}

interface FileRow {
  kind: "file" | "dir";
  /** Basename (with trailing slash for directories). */
  label: string;
  /** Directory the entry lives in — the part the current UI drops. */
  dir: string;
}

type Row = CommandRow | FileRow;

const COMMANDS: CommandRow[] = [
  { kind: "command", label: "rewind", description: "Rewind to a previous turn", group: "Local", args: "[n]" },
  { kind: "command", label: "review", description: "Review the current diff for bugs", group: "Local" },
  { kind: "command", label: "compact", description: "Summarize and compact the context", group: "Built-in" },
  { kind: "command", label: "clear", description: "Clear the transcript", group: "Built-in" },
  { kind: "command", label: "model", description: "Switch the active model", group: "Built-in", args: "<name>" },
  { kind: "command", label: "theme", description: "Change the color theme", group: "Built-in", args: "<name>" },
];

const FILES: FileRow[] = [
  { kind: "file", label: "gallery-theme-editor.tsx", dir: "tugdeck/src/components/tugways/cards/" },
  { kind: "file", label: "tug-text-editor.tsx", dir: "tugdeck/src/components/tugways/" },
  { kind: "file", label: "completion-extension.ts", dir: "tugdeck/src/components/tugways/tug-text-editor/" },
  { kind: "file", label: "tug-completion-menu.css", dir: "tugdeck/src/components/tugways/" },
  { kind: "file", label: "action-dispatch.ts", dir: "tugdeck/src/" },
  { kind: "dir", label: "tugways/", dir: "tugdeck/src/components/" },
  { kind: "file", label: "theme-engine.md", dir: "tuglaws/" },
];

// ---------------------------------------------------------------------------
// Matching helpers
// ---------------------------------------------------------------------------

type MatchRange = [number, number] | null;

/** Case-insensitive substring match over the basename / command name. */
function matchRange(label: string, query: string): MatchRange {
  if (!query) return null;
  const i = label.toLowerCase().indexOf(query.toLowerCase());
  return i < 0 ? null : [i, i + query.length];
}

interface Scored {
  row: Row;
  range: MatchRange;
  key: string;
}

function filterRows(rows: Row[], trigger: Trigger, query: string): Scored[] {
  const out: Scored[] = [];
  for (const row of rows) {
    const range = matchRange(row.label, query);
    if (query && !range) continue;
    out.push({ row, range, key: `${trigger}${row.label}` });
  }
  return out;
}

/** Render a label with the matched span wrapped in `matchClass`. */
function Highlighted(props: { text: string; range: MatchRange; matchClass: string }): React.ReactElement {
  const { text, range, matchClass } = props;
  if (!range) return <>{text}</>;
  const [s, e] = range;
  return (
    <>
      {text.slice(0, s)}
      <span className={matchClass}>{text.slice(s, e)}</span>
      {text.slice(e)}
    </>
  );
}

function fileGlyph(row: FileRow): React.ReactElement {
  if (row.kind === "dir") return <Folder size={15} />;
  if (row.label.endsWith(".md")) return <FileText size={15} />;
  if (/\.(tsx?|css|jsx?)$/.test(row.label)) return <FileCode size={15} />;
  return <FileIcon size={15} />;
}

/** Atom-chip type name for a row (file/command/doc — no folder type exists). */
function chipType(row: Row): string {
  if (row.kind === "command") return "command";
  if (row.kind === "file" && row.label.endsWith(".md")) return "doc";
  return "file";
}

// ---------------------------------------------------------------------------
// GalleryCompletionSpike
// ---------------------------------------------------------------------------

export function GalleryCompletionSpike(): React.ReactElement {
  const [trigger, setTrigger] = useState<Trigger>("/");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const triggerId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: {
      [triggerId]: (v: string) => {
        setTrigger(v as Trigger);
        setSelectedKey(null);
      },
    },
  });

  const rows: Row[] = trigger === "/" ? COMMANDS : FILES;
  const filtered = useMemo(() => filterRows(rows, trigger, query), [rows, trigger, query]);

  // Selection follows an explicit click; falls back to the first row so the
  // accent treatment and alt-D preview always have a subject.
  const selected =
    filtered.find((f) => f.key === selectedKey) ?? filtered[0] ?? null;
  const isSelected = (key: string): boolean => selected?.key === key;

  const isCommand = trigger === "/";

  // Grouping for alt C — preserve first-seen order of the group key.
  const grouped = useMemo(() => {
    const groups: { name: string; items: Scored[] }[] = [];
    for (const f of filtered) {
      const name = f.row.kind === "command" ? f.row.group : (f.row as FileRow).dir;
      let g = groups.find((x) => x.name === name);
      if (!g) {
        g = { name, items: [] };
        groups.push(g);
      }
      g.items.push(f);
    }
    return groups;
  }, [filtered]);

  const empty = filtered.length === 0;

  return (
    <ResponderScope>
      <div
        className="cg-content"
        data-testid="gallery-completion-spike"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        {/* ---- Controls ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Spike controls</TugLabel>
          <p className="cspike-note">
            Switch the trigger and type to filter. Every panel below renders the
            same filtered data — the baseline is the shipping look; A–D are the
            alternatives. Click a row to move the selection (and drive the alt-D
            preview).
          </p>
          <div className="cspike-controls">
            <TugChoiceGroup
              value={trigger}
              senderId={triggerId}
              aria-label="Completion trigger"
              items={[
                { value: "/", label: "/ commands", icon: <Terminal /> },
                { value: "@", label: "@ files", icon: <FileIcon /> },
              ]}
            />
            <TugInput
              size="sm"
              type="search"
              className="cspike-query"
              placeholder={isCommand ? "Filter commands…" : "Filter files…"}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedKey(null);
              }}
            />
          </div>
        </div>

        <TugSeparator />

        {/* ---- Baseline (current) ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Baseline — shipping look</TugLabel>
          <p className="cspike-note">
            What renders today: a fixed-width name column + muted description for
            commands; for files, the basename only — the directory is dropped, so
            two same-named files are indistinguishable, and nothing marks
            command vs file vs folder.
          </p>
          {empty ? (
            <div className="tug-completion-menu cspike-empty">No matches</div>
          ) : (
            <div className="tug-completion-menu" style={{ position: "static", maxHeight: "none" }}>
              {filtered.map((f) => (
                <div
                  key={f.key}
                  className={
                    "tug-completion-menu-item" +
                    (isSelected(f.key) ? " tug-completion-menu-item-selected" : "")
                  }
                  onMouseDown={() => setSelectedKey(f.key)}
                >
                  <span className="tug-completion-menu-label">
                    <Highlighted text={f.row.label} range={f.range} matchClass="tug-completion-match" />
                  </span>
                  {f.row.kind === "command" && (
                    <span className="tug-completion-menu-desc">{f.row.description}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <TugSeparator />

        {/* ---- Alt A — Glyph + path ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">A — Glyph + path</TugLabel>
          <p className="cspike-note">
            A leading type glyph distinguishes command / file / folder at a
            glance, and file rows regain the dimmed directory path (right-aligned)
            so same-named files disambiguate — VS Code's Ctrl-P lesson. Cheapest
            fix for the real ambiguity problems.
          </p>
          <AltPanel
            filtered={filtered}
            empty={empty}
            isSelected={isSelected}
            onSelect={setSelectedKey}
            renderRow={(f) => (
              <>
                <span className="cspike-glyph">
                  {f.row.kind === "command" ? <Terminal size={15} /> : fileGlyph(f.row)}
                </span>
                <span className="cspike-label">
                  <Highlighted text={f.row.label} range={f.range} matchClass="cspike-match" />
                </span>
                {f.row.kind === "command" ? (
                  <span className="cspike-desc">{f.row.description}</span>
                ) : (
                  <span className="cspike-path">{(f.row as FileRow).dir}</span>
                )}
              </>
            )}
          />
        </div>

        <TugSeparator />

        {/* ---- Alt B — Atom-chip rows ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">B — TugAtomChip rows</TugLabel>
          <p className="cspike-note">
            The leading element is the actual <code>TugAtomChip</code> that gets
            inserted, so a row previews its own result and the menu visually
            rhymes with the atoms already in the input. Match highlighting moves
            to the trailing description / path since the chip carries the name.
          </p>
          <AltPanel
            filtered={filtered}
            empty={empty}
            isSelected={isSelected}
            onSelect={setSelectedKey}
            renderRow={(f) => (
              <>
                <span className="cspike-chip">
                  <TugAtomChip
                    type={chipType(f.row)}
                    label={f.row.label}
                    value={f.row.kind === "command" ? `/${f.row.label}` : `${(f.row as FileRow).dir}${f.row.label}`}
                    fontSize={12}
                  />
                </span>
                {f.row.kind === "command" ? (
                  <span className="cspike-desc">{f.row.description}</span>
                ) : (
                  <span className="cspike-path">{(f.row as FileRow).dir}</span>
                )}
              </>
            )}
          />
        </div>

        <TugSeparator />

        {/* ---- Alt C — Grouped + trailing hint ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">C — Grouped + trailing hint</TugLabel>
          <p className="cspike-note">
            Section headers (Local / Built-in for commands; by directory for
            files) plus a trailing mono hint column — argument signature for
            commands, the ↵-to-insert / file-type cue otherwise. Closest to
            Linear / Raycast; earns its keep only if the catalog is long enough
            that grouping aids scanning.
          </p>
          {empty ? (
            <div className="cspike-panel cspike-empty">No matches</div>
          ) : (
            <div className="cspike-panel">
              {grouped.map((g) => (
                <React.Fragment key={g.name}>
                  <div className="cspike-group-header">{g.name}</div>
                  {g.items.map((f) => (
                    <div
                      key={f.key}
                      className="cspike-row"
                      data-selected={isSelected(f.key)}
                      onMouseDown={() => setSelectedKey(f.key)}
                    >
                      <span className="cspike-glyph">
                        {f.row.kind === "command" ? <Terminal size={15} /> : fileGlyph(f.row)}
                      </span>
                      <span className="cspike-label">
                        <Highlighted text={f.row.label} range={f.range} matchClass="cspike-match" />
                      </span>
                      {f.row.kind === "command" && (
                        <span className="cspike-desc">{f.row.description}</span>
                      )}
                      <span className="cspike-hint">
                        {f.row.kind === "command"
                          ? f.row.args ?? "↵"
                          : f.row.kind === "dir"
                            ? "dir"
                            : f.row.label.slice(f.row.label.lastIndexOf("."))}
                      </span>
                    </div>
                  ))}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>

        <TugSeparator />

        {/* ---- Alt D — Two-column preview ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">D — Two-column preview</TugLabel>
          <p className="cspike-note">
            A compact list on the left; the selected entry expands into a preview
            pane on the right — full description + argument signature for
            commands, full path + kind for files. The "rich content" palette
            variant; the most ambitious, and probably more than this input needs.
          </p>
          {empty ? (
            <div className="cspike-panel cspike-empty">No matches</div>
          ) : (
            <div className="cspike-split">
              <div className="cspike-split-list">
                {filtered.map((f) => (
                  <div
                    key={f.key}
                    className="cspike-row"
                    data-selected={isSelected(f.key)}
                    onMouseDown={() => setSelectedKey(f.key)}
                  >
                    <span className="cspike-glyph">
                      {f.row.kind === "command" ? <Terminal size={15} /> : fileGlyph(f.row)}
                    </span>
                    <span className="cspike-label">
                      <Highlighted text={f.row.label} range={f.range} matchClass="cspike-match" />
                    </span>
                  </div>
                ))}
              </div>
              <div className="cspike-split-preview">
                <PreviewPane selected={selected} />
              </div>
            </div>
          )}
        </div>
      </div>
    </ResponderScope>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-views
// ---------------------------------------------------------------------------

/** A flat completion panel that defers each row's body to `renderRow`. */
function AltPanel(props: {
  filtered: Scored[];
  empty: boolean;
  isSelected: (key: string) => boolean;
  onSelect: (key: string) => void;
  renderRow: (f: Scored) => React.ReactNode;
}): React.ReactElement {
  const { filtered, empty, isSelected, onSelect, renderRow } = props;
  if (empty) return <div className="cspike-panel cspike-empty">No matches</div>;
  return (
    <div className="cspike-panel">
      {filtered.map((f) => (
        <div
          key={f.key}
          className="cspike-row"
          data-selected={isSelected(f.key)}
          onMouseDown={() => onSelect(f.key)}
        >
          {renderRow(f)}
        </div>
      ))}
    </div>
  );
}

function PreviewPane(props: { selected: Scored | null }): React.ReactElement {
  const { selected } = props;
  if (!selected) return <div className="cspike-preview-body">Nothing selected.</div>;
  const row = selected.row;
  if (row.kind === "command") {
    return (
      <>
        <div className="cspike-preview-title">
          <Terminal size={16} />
          {`/${row.label}`}
        </div>
        <div className="cspike-preview-body">{row.description}</div>
        <dl className="cspike-preview-meta">
          <dt>Group</dt>
          <dd>{row.group}</dd>
          <dt>Usage</dt>
          <dd>{`/${row.label}${row.args ? ` ${row.args}` : ""}`}</dd>
        </dl>
      </>
    );
  }
  return (
    <>
      <div className="cspike-preview-title">
        {row.kind === "dir" ? <Folder size={16} /> : fileGlyph(row)}
        {row.label}
      </div>
      <dl className="cspike-preview-meta">
        <dt>Path</dt>
        <dd>{`${row.dir}${row.label}`}</dd>
        <dt>Kind</dt>
        <dd>{row.kind === "dir" ? "directory" : "file"}</dd>
        <dt>Inserts</dt>
        <dd>
          <CornerDownLeft size={11} style={{ verticalAlign: "-1px" }} /> atom
        </dd>
      </dl>
    </>
  );
}
