//! Devise-skeleton plan parsing and linting.
//!
//! The grammar a plan document is written in is line-oriented — headings with
//! explicit `{#anchor}` suffixes, bold `**Field:**` lines inside each step, and
//! one pipe table for the Step Status Ledger — so the scanner here is
//! hand-rolled and no markdown crate enters the workspace.
//!
//! The split between what this module checks and what a reviewer checks is
//! deliberate: everything here is mechanical conformance (section presence,
//! anchor uniqueness, label discipline, step field presence, dependency
//! resolution, ledger integrity, banned test shapes). Design soundness,
//! sequencing, and technical choice belong to the reviewer.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

/// How much a diagnostic matters. Only [`Severity::Error`] gates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    /// The document is wrong in a way that will mislead a reader or a tool.
    Error,
    /// Worth fixing, but the document still works.
    Warning,
}

impl Severity {
    /// The wire spelling, matching `JsonIssue`'s `severity` field.
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Error => "error",
            Severity::Warning => "warning",
        }
    }
}

impl fmt::Display for Severity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// One lint finding. Maps one-to-one onto `tugutil`'s `JsonIssue`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    /// Stable rule id, e.g. `"PL001"`.
    pub code: String,
    /// Error or warning.
    pub severity: Severity,
    /// One sentence naming what is wrong.
    pub message: String,
    /// 1-indexed source line, when the finding has one.
    pub line: Option<usize>,
    /// The anchor the finding is about, without the leading `#`.
    pub anchor: Option<String>,
}

impl Diagnostic {
    fn at(code: &str, severity: Severity, message: impl Into<String>, line: usize) -> Self {
        Diagnostic {
            code: code.to_string(),
            severity,
            message: message.into(),
            line: Some(line),
            anchor: None,
        }
    }

    fn whole_doc(code: &str, severity: Severity, message: impl Into<String>) -> Self {
        Diagnostic {
            code: code.to_string(),
            severity,
            message: message.into(),
            line: None,
            anchor: None,
        }
    }

    fn anchored(mut self, anchor: impl Into<String>) -> Self {
        self.anchor = Some(anchor.into());
        self
    }
}

/// A heading line, with its explicit anchor when it declared one.
#[derive(Debug, Clone)]
pub struct Heading {
    /// Number of leading `#` characters.
    pub level: usize,
    /// Heading text with the `{#anchor}` suffix removed.
    pub text: String,
    /// The declared anchor, without the leading `#`.
    pub anchor: Option<String>,
    /// 1-indexed source line.
    pub line: usize,
}

/// One `#### Step N:` section and the fields found inside it.
#[derive(Debug, Clone)]
pub struct Step {
    /// The `N` in `Step N`, when the heading spelled one.
    pub number: Option<usize>,
    /// The step title, with the step number prefix removed.
    pub title: String,
    /// The declared anchor, without the leading `#`.
    pub anchor: Option<String>,
    /// 1-indexed line of the step heading.
    pub line: usize,
    /// The `**Commit:**` line, when present.
    pub commit: Option<String>,
    /// The `**References:**` line and its text, when present.
    pub references: Option<(usize, String)>,
    /// Whether a `**Tasks:**` block was found.
    pub has_tasks: bool,
    /// The `**Tests:**` block's line and body lines, when present.
    pub tests: Option<(usize, Vec<String>)>,
    /// Whether a `**Checkpoint:**` block was found.
    pub has_checkpoint: bool,
    /// `(line, anchor)` for every anchor named on a `**Depends on:**` line.
    pub depends: Vec<(usize, String)>,
}

/// One row of the Step Status Ledger table.
#[derive(Debug, Clone)]
pub struct LedgerRow {
    /// The step anchor the row names, without the leading `#`.
    pub anchor: String,
    /// The step title as the ledger spells it.
    pub title: String,
    /// The status cell, lowercased and trimmed.
    pub status: String,
    /// The commit cell, `None` when it is a placeholder dash.
    pub commit: Option<String>,
    /// 1-indexed source line.
    pub line: usize,
}

/// A parsed plan document.
#[derive(Debug, Clone)]
pub struct PlanDoc {
    /// The `##` title line's text, when the document opened with one.
    pub title: Option<String>,
    /// Every heading, in source order.
    pub headings: Vec<Heading>,
    /// Every declared anchor, in source order, without the leading `#`.
    pub anchors: Vec<(String, usize)>,
    /// Every plan-local label declaration, e.g. `("P01", 174)`.
    pub labels: Vec<(String, usize)>,
    /// Label declarations whose number is not two digits.
    pub malformed_labels: Vec<(String, usize)>,
    /// Headings that declared a `[D##]` label, which belongs to `design-decisions.md`.
    pub design_decision_labels: Vec<(String, usize)>,
    /// Every `#### Step N:` section, in source order.
    pub steps: Vec<Step>,
    /// 1-indexed line of the `{#step-status-ledger}` heading, when present.
    pub ledger_line: Option<usize>,
    /// The ledger table's rows.
    pub ledger_rows: Vec<LedgerRow>,
}

/// Returned when a document is not a plan at all — a brief, a note, or a
/// program plan that carries no execution steps.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotAPlan;

impl fmt::Display for NotAPlan {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("not a plan document")
    }
}

impl std::error::Error for NotAPlan {}

/// Sections a plan must carry, by anchor.
const REQUIRED_SECTIONS: &[&str] = &[
    "plan-metadata",
    "phase-overview",
    "execution-steps",
    "step-status-ledger",
    "deliverables",
];

/// Statuses the Step Status Ledger accepts.
const LEDGER_STATUSES: &[&str] = &["pending", "in progress", "done"];

/// Test shapes this codebase bans outright.
const BANNED_TEST_SHAPES: &[(&str, &str)] = &[
    ("happy-dom", "happy-dom"),
    ("jsdom", "jsdom"),
    ("@testing-library/react", "@testing-library/react"),
    ("mock-store", "mock-store assertion tests"),
    ("mock store", "mock-store assertion tests"),
];

/// Letters that introduce a plan-local label.
const LABEL_LETTERS: &[char] = &['P', 'Q', 'S', 'T', 'L', 'R', 'M'];

/// Parse a plan document.
///
/// Detection is positive: a document is a plan when it declares an
/// `{#execution-steps}` section. `roadmap/` also holds briefs, notes, and a
/// program plan that carries ratified decisions and phases but no steps —
/// none of those are plans, and none of them should be linted as one.
pub fn parse(source: &str) -> Result<PlanDoc, NotAPlan> {
    let headings = collect_headings(source);
    if !headings
        .iter()
        .any(|h| h.anchor.as_deref() == Some("execution-steps"))
    {
        return Err(NotAPlan);
    }

    let mut doc = PlanDoc {
        title: headings
            .iter()
            .find(|h| h.level == 2)
            .map(|h| h.text.clone()),
        anchors: headings
            .iter()
            .filter_map(|h| h.anchor.clone().map(|a| (a, h.line)))
            .collect(),
        headings: headings.clone(),
        labels: Vec::new(),
        malformed_labels: Vec::new(),
        design_decision_labels: Vec::new(),
        steps: Vec::new(),
        ledger_line: None,
        ledger_rows: Vec::new(),
    };

    // Labels are declared either by a heading (`#### [P01] …`) or by a bold
    // lead-in (`**Spec S01: …**`, `**Table T01: …**`, `**Risk R01: …**`).
    for heading in &headings {
        match read_label(&heading.text) {
            Some(Label::Plan { id, two_digits }) => {
                doc.labels.push((id.clone(), heading.line));
                if !two_digits {
                    doc.malformed_labels.push((id, heading.line));
                }
            }
            Some(Label::DesignDecision { id }) => {
                doc.design_decision_labels.push((id, heading.line));
            }
            None => {}
        }
    }

    let mut current_step: Option<Step> = None;
    let mut current_field: Option<String> = None;
    let mut in_ledger = false;
    let mut in_fence = false;

    for (index, raw) in source.lines().enumerate() {
        let line_no = index + 1;
        let line = raw.trim_end();

        // A fenced block is a sample, not structure — a spec that shows the
        // Review Record's markdown must not declare its heading.
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }

        if let Some(level) = heading_level(line) {
            if let Some(step) = current_step.take() {
                if level <= 4 {
                    doc.steps.push(step);
                } else {
                    current_step = Some(step);
                }
            }
            current_field = None;

            let heading = headings
                .iter()
                .find(|h| h.line == line_no)
                .expect("every heading line was collected");
            in_ledger = heading.anchor.as_deref() == Some("step-status-ledger");
            if in_ledger {
                doc.ledger_line = Some(line_no);
            }
            if let Some((number, title)) = read_step_heading(&heading.text) {
                current_step = Some(Step {
                    number,
                    title,
                    anchor: heading.anchor.clone(),
                    line: line_no,
                    commit: None,
                    references: None,
                    has_tasks: false,
                    tests: None,
                    has_checkpoint: false,
                    depends: Vec::new(),
                });
            }
            continue;
        }

        if in_ledger && line.trim_start().starts_with('|') {
            if let Some(row) = read_ledger_row(line, line_no) {
                doc.ledger_rows.push(row);
            }
            continue;
        }

        if line.trim_start().starts_with("**") {
            if let Some(Label::Plan { id, two_digits }) = read_label(line.trim_start()) {
                doc.labels.push((id.clone(), line_no));
                if !two_digits {
                    doc.malformed_labels.push((id, line_no));
                }
            }
        }

        let Some(step) = current_step.as_mut() else {
            continue;
        };

        if let Some((field, rest)) = read_bold_field(line) {
            current_field = Some(field.clone());
            match field.as_str() {
                "Commit" => step.commit = Some(rest.trim().to_string()),
                "References" => step.references = Some((line_no, rest.trim().to_string())),
                "Tasks" => step.has_tasks = true,
                "Tests" => step.tests = Some((line_no, Vec::new())),
                "Checkpoint" => step.has_checkpoint = true,
                "Depends on" => {
                    for anchor in read_dependency_entries(rest) {
                        step.depends.push((line_no, anchor));
                    }
                }
                _ => {}
            }
            continue;
        }

        if current_field.as_deref() == Some("Tests")
            && let Some((_, body)) = step.tests.as_mut()
        {
            body.push(line.to_string());
        }
    }

    if let Some(step) = current_step.take() {
        doc.steps.push(step);
    }

    Ok(doc)
}

/// Run every rule over a parsed plan. Diagnostics come back in source order.
pub fn lint(doc: &PlanDoc) -> Vec<Diagnostic> {
    let mut out = Vec::new();

    let declared: BTreeSet<&str> = doc.anchors.iter().map(|(a, _)| a.as_str()).collect();

    // PL001 — required sections.
    for required in REQUIRED_SECTIONS {
        if !declared.contains(required) {
            out.push(Diagnostic::whole_doc(
                "PL001",
                Severity::Error,
                format!("required section `#{required}` is missing"),
            ));
        }
    }

    // PL002 / PL003 — anchor uniqueness and spelling.
    let mut first_seen: BTreeMap<&str, usize> = BTreeMap::new();
    for (anchor, line) in &doc.anchors {
        match first_seen.get(anchor.as_str()) {
            Some(first) => out.push(
                Diagnostic::at(
                    "PL002",
                    Severity::Error,
                    format!("anchor `#{anchor}` is already declared on line {first}"),
                    *line,
                )
                .anchored(anchor.clone()),
            ),
            None => {
                first_seen.insert(anchor.as_str(), *line);
            }
        }
        if !anchor
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
            || anchor.is_empty()
        {
            out.push(
                Diagnostic::at(
                    "PL003",
                    Severity::Error,
                    format!("anchor `#{anchor}` uses characters outside `[a-z0-9-]`"),
                    *line,
                )
                .anchored(anchor.clone()),
            );
        }
    }

    // PL004 — a section heading with no explicit anchor.
    for heading in &doc.headings {
        if (heading.level == 3 || heading.level == 4) && heading.anchor.is_none() {
            out.push(Diagnostic::at(
                "PL004",
                Severity::Warning,
                format!("heading `{}` declares no `{{#anchor}}`", heading.text),
                heading.line,
            ));
        }
    }

    // PL005 — `[D##]` is the design-decisions namespace, not a plan's.
    for (id, line) in &doc.design_decision_labels {
        out.push(Diagnostic::at(
            "PL005",
            Severity::Error,
            format!(
                "`[{id}]` names a decision in `tuglaws/design-decisions.md`; a plan-local decision is `[P##]`"
            ),
            *line,
        ));
    }

    // PL006 / PL007 — label discipline.
    let mut label_first: BTreeMap<&str, usize> = BTreeMap::new();
    for (id, line) in &doc.labels {
        match label_first.get(id.as_str()) {
            Some(first) => out.push(Diagnostic::at(
                "PL006",
                Severity::Error,
                format!("label `[{id}]` is already declared on line {first}"),
                *line,
            )),
            None => {
                label_first.insert(id.as_str(), *line);
            }
        }
    }
    for (id, line) in &doc.malformed_labels {
        out.push(Diagnostic::at(
            "PL007",
            Severity::Warning,
            format!("label `[{id}]` should carry a two-digit number"),
            *line,
        ));
    }

    // PL015 / PL016 / PL017 / PL018 — the ledger.
    if doc.ledger_line.is_some() && doc.ledger_rows.is_empty() {
        out.push(Diagnostic::at(
            "PL015",
            Severity::Error,
            "the Step Status Ledger section carries no table rows",
            doc.ledger_line.unwrap_or(1),
        ));
    }
    if !doc.ledger_rows.is_empty() {
        let ledger_anchors: BTreeSet<&str> =
            doc.ledger_rows.iter().map(|r| r.anchor.as_str()).collect();
        let step_anchors: BTreeSet<&str> = doc
            .steps
            .iter()
            .filter_map(|s| s.anchor.as_deref())
            .collect();
        for missing in step_anchors.difference(&ledger_anchors) {
            out.push(
                Diagnostic::at(
                    "PL016",
                    Severity::Error,
                    format!("step `#{missing}` has no Step Status Ledger row"),
                    doc.ledger_line.unwrap_or(1),
                )
                .anchored(missing.to_string()),
            );
        }
        for extra in ledger_anchors.difference(&step_anchors) {
            let line = doc
                .ledger_rows
                .iter()
                .find(|r| r.anchor == *extra)
                .map(|r| r.line)
                .unwrap_or(1);
            out.push(
                Diagnostic::at(
                    "PL016",
                    Severity::Error,
                    format!("ledger row `#{extra}` names no step in this plan"),
                    line,
                )
                .anchored(extra.to_string()),
            );
        }
    }
    for row in &doc.ledger_rows {
        if !LEDGER_STATUSES.contains(&row.status.as_str()) {
            out.push(
                Diagnostic::at(
                    "PL017",
                    Severity::Error,
                    format!(
                        "ledger status `{}` is not one of pending / in progress / done",
                        row.status
                    ),
                    row.line,
                )
                .anchored(row.anchor.clone()),
            );
        }
        if row.status == "done" && row.commit.is_none() {
            out.push(
                Diagnostic::at(
                    "PL018",
                    Severity::Warning,
                    format!("ledger row `#{}` is done with no commit recorded", row.anchor),
                    row.line,
                )
                .anchored(row.anchor.clone()),
            );
        }
    }

    // Per-step rules.
    let step_number_by_anchor: BTreeMap<&str, usize> = doc
        .steps
        .iter()
        .filter_map(|s| Some((s.anchor.as_deref()?, s.number?)))
        .collect();

    for step in &doc.steps {
        let anchor_of = |d: Diagnostic| match &step.anchor {
            Some(a) => d.anchored(a.clone()),
            None => d,
        };
        let label = step
            .number
            .map(|n| format!("Step {n}"))
            .unwrap_or_else(|| step.title.clone());

        if step.commit.is_none() {
            out.push(anchor_of(Diagnostic::at(
                "PL008",
                Severity::Error,
                format!("{label} has no `**Commit:**` line"),
                step.line,
            )));
        }
        if step.references.is_none() {
            out.push(anchor_of(Diagnostic::at(
                "PL009",
                Severity::Error,
                format!("{label} has no `**References:**` line"),
                step.line,
            )));
        }
        if !step.has_tasks {
            out.push(anchor_of(Diagnostic::at(
                "PL010",
                Severity::Error,
                format!("{label} has no Tasks block"),
                step.line,
            )));
        }
        if step.tests.is_none() {
            out.push(anchor_of(Diagnostic::at(
                "PL011",
                Severity::Warning,
                format!("{label} has no Tests block"),
                step.line,
            )));
        }
        if !step.has_checkpoint {
            out.push(anchor_of(Diagnostic::at(
                "PL012",
                Severity::Error,
                format!("{label} has no Checkpoint block"),
                step.line,
            )));
        }

        for (line, dep) in &step.depends {
            if !declared.contains(dep.as_str()) {
                out.push(Diagnostic::at(
                    "PL013",
                    Severity::Error,
                    format!("{label} depends on `#{dep}`, which this plan does not declare"),
                    *line,
                ));
                continue;
            }
            if let (Some(own), Some(other)) = (step.number, step_number_by_anchor.get(dep.as_str()))
                && *other >= own
            {
                out.push(Diagnostic::at(
                    "PL014",
                    Severity::Error,
                    format!("{label} depends on `#{dep}`, which comes later in the plan"),
                    *line,
                ));
            }
        }

        if let Some((line, text)) = &step.references {
            if cites_line_numbers(text) {
                out.push(Diagnostic::at(
                    "PL019",
                    Severity::Warning,
                    format!("{label}'s references cite line numbers, which go stale"),
                    *line,
                ));
            }
            if !carries_citation(text) {
                out.push(Diagnostic::at(
                    "PL021",
                    Severity::Warning,
                    format!("{label}'s references carry no citation"),
                    *line,
                ));
            }
        }

        if let Some((line, body)) = &step.tests {
            for (needle, name) in BANNED_TEST_SHAPES {
                if body
                    .iter()
                    .any(|l| l.to_ascii_lowercase().contains(needle))
                {
                    out.push(Diagnostic::at(
                        "PL020",
                        Severity::Error,
                        format!("{label}'s Tests block proposes {name}, which this codebase bans"),
                        *line,
                    ));
                }
            }
        }

        if let (Some(number), Some(anchor)) = (step.number, step.anchor.as_deref())
            && anchor != format!("step-{number}")
        {
            out.push(Diagnostic::at(
                "PL022",
                Severity::Warning,
                format!("{label}'s anchor `#{anchor}` does not match its number"),
                step.line,
            ));
        }
    }

    // PL023 — the Review Record.
    if !declared.contains("review-record") {
        out.push(Diagnostic::whole_doc(
            "PL023",
            Severity::Warning,
            "no `{#review-record}` section — a reviewed plan records what the review found",
        ));
    }

    out.sort_by_key(|d| (d.line.unwrap_or(0), d.code.clone()));
    out
}

/// Whether any diagnostic in a run is error-severity.
pub fn has_errors(diagnostics: &[Diagnostic]) -> bool {
    diagnostics.iter().any(|d| d.severity == Severity::Error)
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

fn collect_headings(source: &str) -> Vec<Heading> {
    let mut out = Vec::new();
    let mut in_fence = false;
    for (index, raw) in source.lines().enumerate() {
        let line = raw.trim_end();
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let Some(level) = heading_level(line) else {
            continue;
        };
        let text = line[level..].trim();
        let (text, anchor) = split_anchor(text);
        out.push(Heading {
            level,
            text: text.to_string(),
            anchor,
            line: index + 1,
        });
    }
    out
}

fn heading_level(line: &str) -> Option<usize> {
    if !line.starts_with('#') {
        return None;
    }
    let level = line.chars().take_while(|c| *c == '#').count();
    if level < 2 || level > 6 {
        return None;
    }
    if line[level..].starts_with(' ') {
        Some(level)
    } else {
        None
    }
}

fn split_anchor(text: &str) -> (&str, Option<String>) {
    let Some(open) = text.rfind("{#") else {
        return (text, None);
    };
    if !text.ends_with('}') {
        return (text, None);
    }
    let anchor = &text[open + 2..text.len() - 1];
    (text[..open].trim_end(), Some(anchor.to_string()))
}

fn read_step_heading(text: &str) -> Option<(Option<usize>, String)> {
    let rest = text.strip_prefix("Step ")?;
    let colon = rest.find(':')?;
    let number = rest[..colon].trim().parse::<usize>().ok();
    Some((number, rest[colon + 1..].trim().to_string()))
}

/// `**Field:** rest` → `("Field", "rest")`.
fn read_bold_field(line: &str) -> Option<(String, &str)> {
    let trimmed = line.trim_start();
    let body = trimmed.strip_prefix("**")?;
    let close = body.find(":**")?;
    let name = &body[..close];
    if name.is_empty() || name.contains("**") {
        return None;
    }
    Some((name.to_string(), &body[close + 3..]))
}

/// The anchors a `**Depends on:**` line declares, without the leading `#`.
///
/// A dependency is a comma-separated entry that is *entirely* an anchor. Plans
/// also write prose on this line — "parallel to #step-1 … it does not wait on
/// #step-4" — and an anchor mentioned inside a sentence is a reference, not a
/// declared dependency. Reading those as edges would report a cycle a careful
/// author deliberately explained they do not have.
fn read_dependency_entries(text: &str) -> Vec<String> {
    text.split(',')
        .filter_map(|entry| {
            let entry = entry.trim().trim_matches('`').trim();
            let anchor = entry.strip_prefix('#')?;
            let valid = !anchor.is_empty()
                && anchor
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
            valid.then(|| anchor.to_string())
        })
        .collect()
}

fn read_ledger_row(line: &str, line_no: usize) -> Option<LedgerRow> {
    let cells: Vec<&str> = line
        .trim()
        .trim_start_matches('|')
        .trim_end_matches('|')
        .split('|')
        .map(str::trim)
        .collect();
    if cells.len() < 3 {
        return None;
    }
    let anchor = cells[0].strip_prefix('#')?;
    if anchor.is_empty() {
        return None;
    }
    let commit = cells
        .get(3)
        .map(|c| c.trim_matches('`').trim())
        .filter(|c| !c.is_empty() && *c != "—" && *c != "-" && *c != "–");
    Some(LedgerRow {
        anchor: anchor.to_string(),
        title: cells[1].to_string(),
        status: cells[2].to_ascii_lowercase(),
        commit: commit.map(str::to_string),
        line: line_no,
    })
}

enum Label {
    Plan { id: String, two_digits: bool },
    DesignDecision { id: String },
}

/// Read a label declaration from a heading or a bold lead-in.
///
/// Two spellings declare one: `[P01] …` (decisions and questions) and
/// `**Spec S01: …` / `**Table T01: …` / `**Risk R01: …` (the bold forms).
fn read_label(text: &str) -> Option<Label> {
    let text = text.trim_start_matches('*').trim_start();
    if let Some(rest) = text.strip_prefix('[') {
        let close = rest.find(']')?;
        return classify_label(&rest[..close]);
    }
    // `Spec S01:` / `Table T01:` / `Risk R01:` — the label is the second token.
    let mut tokens = text.split_whitespace();
    let first = tokens.next()?;
    if !matches!(first, "Spec" | "Table" | "Risk" | "Mitigation" | "Metric") {
        return None;
    }
    let second = tokens.next()?.trim_end_matches(':');
    classify_label(second)
}

fn classify_label(id: &str) -> Option<Label> {
    let mut chars = id.chars();
    let letter = chars.next()?;
    let digits: String = chars.collect();
    if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    if letter == 'D' {
        return Some(Label::DesignDecision { id: id.to_string() });
    }
    if !LABEL_LETTERS.contains(&letter) {
        return None;
    }
    Some(Label::Plan {
        id: id.to_string(),
        two_digits: digits.len() == 2,
    })
}

/// Whether a references line cites a `path:line` pair.
fn cites_line_numbers(text: &str) -> bool {
    text.split_whitespace().any(|token| {
        let token = token.trim_matches(|c: char| !c.is_alphanumeric() && c != '.' && c != '/' && c != ':');
        let Some((path, tail)) = token.rsplit_once(':') else {
            return false;
        };
        !tail.is_empty()
            && tail.chars().all(|c| c.is_ascii_digit())
            && (path.contains('.') || path.contains('/'))
    })
}

/// Whether a references line cites anything at all — a label, an anchor, or a path.
fn carries_citation(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("n/a") {
        return false;
    }
    trimmed.contains('[') || trimmed.contains("(#") || trimmed.contains('`')
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A plan carrying every required section and one clean step.
    const MINIMAL: &str = r#"## A Minimal Plan {#minimal-plan}

### Plan Metadata {#plan-metadata}

| Field | Value |
|---|---|
| Owner | Someone |

### Review Record {#review-record}

**Round 1 — 2026-08-13, opus.** Lint: 0 errors.

### Phase Overview {#phase-overview}

Some context.

### Execution Steps {#execution-steps}

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | The only step | pending | — |

#### Step 1: The only step {#step-1}

**Commit:** `thing(scope): do it`

**References:** [P01] the decision, (#phase-overview)

**Tasks:**
- [ ] Do the thing.

**Tests:**
- [ ] Unit: the thing works.

**Checkpoint:**
- [ ] `cargo nextest run`

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** the thing.
"#;

    fn diagnose(source: &str) -> Vec<Diagnostic> {
        lint(&parse(source).expect("fixture parses as a plan"))
    }

    fn codes(source: &str) -> Vec<String> {
        diagnose(source).into_iter().map(|d| d.code).collect()
    }

    fn find(source: &str, code: &str) -> Diagnostic {
        let diags = diagnose(source);
        diags
            .iter()
            .find(|d| d.code == code)
            .unwrap_or_else(|| panic!("expected a {code} diagnostic, got {diags:#?}"))
            .clone()
    }

    #[test]
    fn minimal_plan_is_clean() {
        assert_eq!(diagnose(MINIMAL), Vec::new());
    }

    #[test]
    fn a_brief_is_not_a_plan() {
        let brief = "## How we got here\n\nSome prose.\n\n## What I'd want decided\n\nMore prose.\n";
        assert!(parse(brief).is_err(), "a brief is not a plan");
    }

    #[test]
    fn a_program_plan_without_steps_is_not_a_plan() {
        let program = "## Plan Metadata {#plan-metadata}\n\n## Phases {#phases}\n\n### Phase 1 {#phase-1}\n";
        assert!(parse(program).is_err(), "a program plan carries no steps");
    }

    #[test]
    fn pl001_missing_required_section() {
        let source = MINIMAL.replace(
            "### Deliverables and Checkpoints {#deliverables}",
            "### Deliverables and Checkpoints {#delivery}",
        );
        let d = find(&source, "PL001");
        assert_eq!(d.severity, Severity::Error);
        assert!(d.message.contains("#deliverables"), "{}", d.message);
    }

    #[test]
    fn pl002_duplicate_anchor() {
        let source = MINIMAL.replace(
            "### Phase Overview {#phase-overview}",
            "### Phase Overview {#phase-overview}\n\n#### Again {#plan-metadata}",
        );
        let d = find(&source, "PL002");
        assert_eq!(d.severity, Severity::Error);
        assert_eq!(d.anchor.as_deref(), Some("plan-metadata"));
    }

    #[test]
    fn pl003_anchor_charset() {
        let source = MINIMAL.replace("{#minimal-plan}", "{#Minimal_Plan}");
        let d = find(&source, "PL003");
        assert_eq!(d.severity, Severity::Error);
        assert_eq!(d.line, Some(1));
    }

    #[test]
    fn pl004_heading_without_anchor() {
        let source = MINIMAL.replace("### Phase Overview {#phase-overview}", "### Phase Overview {#phase-overview}\n\n#### Bare Heading");
        let d = find(&source, "PL004");
        assert_eq!(d.severity, Severity::Warning);
        assert!(d.message.contains("Bare Heading"), "{}", d.message);
    }

    #[test]
    fn pl005_design_decision_label_in_a_plan() {
        let source = MINIMAL.replace(
            "### Phase Overview {#phase-overview}",
            "### Design Decisions {#design-decisions}\n\n#### [D01] A borrowed decision {#d01-borrowed}\n\n### Phase Overview {#phase-overview}",
        );
        let d = find(&source, "PL005");
        assert_eq!(d.severity, Severity::Error);
        assert!(d.message.contains("[P##]"), "{}", d.message);
    }

    #[test]
    fn pl006_duplicate_label() {
        let source = MINIMAL.replace(
            "### Phase Overview {#phase-overview}",
            "### Design Decisions {#design-decisions}\n\n#### [P01] First {#p01-first}\n\n#### [P01] Second {#p01-second}\n\n### Phase Overview {#phase-overview}",
        );
        let d = find(&source, "PL006");
        assert_eq!(d.severity, Severity::Error);
        assert!(d.message.contains("[P01]"), "{}", d.message);
    }

    #[test]
    fn pl007_label_is_not_two_digits() {
        let source = MINIMAL.replace(
            "### Phase Overview {#phase-overview}",
            "### Design Decisions {#design-decisions}\n\n#### [P1] One digit {#p1-one}\n\n### Phase Overview {#phase-overview}",
        );
        let d = find(&source, "PL007");
        assert_eq!(d.severity, Severity::Warning);
    }

    #[test]
    fn pl008_missing_commit() {
        let source = MINIMAL.replace("**Commit:** `thing(scope): do it`\n\n", "");
        let d = find(&source, "PL008");
        assert_eq!(d.severity, Severity::Error);
        assert_eq!(d.anchor.as_deref(), Some("step-1"));
    }

    #[test]
    fn pl009_missing_references() {
        let source = MINIMAL.replace("**References:** [P01] the decision, (#phase-overview)\n\n", "");
        assert_eq!(find(&source, "PL009").severity, Severity::Error);
    }

    #[test]
    fn pl010_missing_tasks() {
        let source = MINIMAL.replace("**Tasks:**\n- [ ] Do the thing.\n\n", "");
        assert_eq!(find(&source, "PL010").severity, Severity::Error);
    }

    #[test]
    fn pl011_missing_tests_is_a_warning() {
        // Calibration: an integration-checkpoint step legitimately carries its
        // gates in Tasks and has no Tests block, so this cannot gate.
        let source = MINIMAL.replace("**Tests:**\n- [ ] Unit: the thing works.\n\n", "");
        assert_eq!(find(&source, "PL011").severity, Severity::Warning);
    }

    #[test]
    fn pl012_missing_checkpoint() {
        let source = MINIMAL.replace("**Checkpoint:**\n- [ ] `cargo nextest run`\n", "");
        assert_eq!(find(&source, "PL012").severity, Severity::Error);
    }

    #[test]
    fn pl013_dependency_on_an_unknown_anchor() {
        let source = MINIMAL.replace(
            "#### Step 1: The only step {#step-1}\n",
            "#### Step 1: The only step {#step-1}\n\n**Depends on:** #step-9\n",
        );
        let d = find(&source, "PL013");
        assert_eq!(d.severity, Severity::Error);
        assert!(d.message.contains("#step-9"), "{}", d.message);
    }

    #[test]
    fn pl014_dependency_on_a_later_step() {
        let source = TWO_STEPS.replace(
            "#### Step 1: First {#step-1}\n",
            "#### Step 1: First {#step-1}\n\n**Depends on:** #step-2\n",
        );
        let d = find(&source, "PL014");
        assert_eq!(d.severity, Severity::Error);
        assert!(d.message.contains("later"), "{}", d.message);
    }

    #[test]
    fn pl015_ledger_section_with_no_table() {
        let source = MINIMAL.replace(
            "| Step | Title | Status | Commit |\n|---|---|---|---|\n| #step-1 | The only step | pending | — |\n",
            "",
        );
        assert_eq!(find(&source, "PL015").severity, Severity::Error);
    }

    #[test]
    fn pl016_ledger_and_steps_disagree() {
        let source = MINIMAL.replace("| #step-1 | The only step | pending | — |", "| #step-2 | Some other step | pending | — |");
        let codes: Vec<&str> = diagnose(&source)
            .iter()
            .filter(|d| d.code == "PL016")
            .map(|_| "PL016")
            .collect();
        assert_eq!(codes.len(), 2, "one for the orphan step, one for the orphan row");
    }

    #[test]
    fn pl017_unknown_ledger_status() {
        let source = MINIMAL.replace("| #step-1 | The only step | pending | — |", "| #step-1 | The only step | started | — |");
        let d = find(&source, "PL017");
        assert_eq!(d.severity, Severity::Error);
        assert!(d.message.contains("started"), "{}", d.message);
    }

    #[test]
    fn pl018_done_with_no_commit() {
        let source = MINIMAL.replace("| #step-1 | The only step | pending | — |", "| #step-1 | The only step | done | — |");
        assert_eq!(find(&source, "PL018").severity, Severity::Warning);
    }

    #[test]
    fn pl018_silent_when_the_commit_is_recorded() {
        let source = MINIMAL.replace("| #step-1 | The only step | pending | — |", "| #step-1 | The only step | done | `95effa736` |");
        assert!(!codes(&source).contains(&"PL018".to_string()));
    }

    #[test]
    fn pl019_references_citing_line_numbers() {
        let source = MINIMAL.replace(
            "**References:** [P01] the decision, (#phase-overview)",
            "**References:** [P01] the decision, `tugcode/src/session.ts:7071`",
        );
        let d = find(&source, "PL019");
        assert_eq!(d.severity, Severity::Warning);
    }

    #[test]
    fn pl020_banned_test_shape() {
        let source = MINIMAL.replace(
            "- [ ] Unit: the thing works.",
            "- [ ] Render the row with @testing-library/react and assert the text.",
        );
        let d = find(&source, "PL020");
        assert_eq!(d.severity, Severity::Error);
        assert!(d.message.contains("@testing-library/react"), "{}", d.message);
    }

    #[test]
    fn pl020_does_not_fire_outside_the_tests_block() {
        // A plan that names the ban in order to enforce it must lint clean.
        let source = MINIMAL.replace(
            "**Tasks:**\n- [ ] Do the thing.",
            "**Tasks:**\n- [ ] Delete the last jsdom render test and the happy-dom dependency.",
        );
        assert!(!codes(&source).contains(&"PL020".to_string()));
    }

    #[test]
    fn pl021_references_with_no_citation() {
        let source = MINIMAL.replace(
            "**References:** [P01] the decision, (#phase-overview)",
            "**References:** N/A",
        );
        assert_eq!(find(&source, "PL021").severity, Severity::Warning);
    }

    #[test]
    fn pl022_step_anchor_does_not_match_its_number() {
        let source = MINIMAL
            .replace("#### Step 1: The only step {#step-1}", "#### Step 1: The only step {#step-one}")
            .replace("| #step-1 |", "| #step-one |");
        let d = find(&source, "PL022");
        assert_eq!(d.severity, Severity::Warning);
    }

    #[test]
    fn pl023_missing_review_record() {
        let source = MINIMAL.replace(
            "### Review Record {#review-record}\n\n**Round 1 — 2026-08-13, opus.** Lint: 0 errors.\n\n",
            "",
        );
        assert_eq!(find(&source, "PL023").severity, Severity::Warning);
    }

    #[test]
    fn labels_are_read_from_bold_lead_ins() {
        let doc = parse(&MINIMAL.replace(
            "### Phase Overview {#phase-overview}",
            "### Specification {#specification}\n\n**Spec S01: The model** {#s01-model}\n\n**Table T01: The rules** {#t01-rules}\n\n**Risk R01: It breaks** {#r01-breaks}\n\n### Phase Overview {#phase-overview}",
        ))
        .expect("parses");
        let ids: Vec<&str> = doc.labels.iter().map(|(id, _)| id.as_str()).collect();
        assert!(ids.contains(&"S01"), "{ids:?}");
        assert!(ids.contains(&"T01"), "{ids:?}");
        assert!(ids.contains(&"R01"), "{ids:?}");
    }

    #[test]
    fn has_errors_ignores_warnings() {
        let warnings = vec![Diagnostic::whole_doc("PL023", Severity::Warning, "no record")];
        assert!(!has_errors(&warnings));
        let errors = vec![Diagnostic::whole_doc("PL001", Severity::Error, "missing")];
        assert!(has_errors(&errors));
    }

    const TWO_STEPS: &str = r#"## Two Steps {#two-steps}

### Plan Metadata {#plan-metadata}

| Field | Value |
|---|---|
| Owner | Someone |

### Review Record {#review-record}

**Round 1 — 2026-08-13, opus.** Lint: 0 errors.

### Phase Overview {#phase-overview}

Some context.

### Execution Steps {#execution-steps}

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | First | pending | — |
| #step-2 | Second | pending | — |

#### Step 1: First {#step-1}

**Commit:** `thing(scope): first`

**References:** [P01] the decision

**Tasks:**
- [ ] Do the first thing.

**Tests:**
- [ ] Unit: the first thing works.

**Checkpoint:**
- [ ] `cargo nextest run`

#### Step 2: Second {#step-2}

**Depends on:** #step-1

**Commit:** `thing(scope): second`

**References:** [P01] the decision

**Tasks:**
- [ ] Do the second thing.

**Tests:**
- [ ] Unit: the second thing works.

**Checkpoint:**
- [ ] `cargo nextest run`

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** the things.
"#;

    #[test]
    fn a_forward_dependency_is_clean() {
        assert_eq!(diagnose(TWO_STEPS), Vec::new());
    }

    /// The rules must stay honest against the documents people actually write.
    /// Resolve `roadmap/` from the crate manifest and skip cleanly when it is
    /// absent, so the crate stays testable outside this repository.
    #[test]
    fn the_real_corpus_carries_no_errors() {
        let roadmap = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../roadmap")
            .canonicalize();
        let Ok(roadmap) = roadmap else {
            return;
        };
        let Ok(entries) = std::fs::read_dir(&roadmap) else {
            return;
        };
        let mut linted = 0usize;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let Ok(source) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Ok(doc) = parse(&source) else {
                continue;
            };
            linted += 1;
            let diagnostics = lint(&doc);
            let errors: Vec<&Diagnostic> = diagnostics
                .iter()
                .filter(|d| d.severity == Severity::Error)
                .collect();
            assert!(
                errors.is_empty(),
                "{} carries error diagnostics: {errors:#?}",
                path.display()
            );
        }
        assert!(linted >= 5, "expected the roadmap corpus to hold plans");
    }
}
