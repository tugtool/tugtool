//! Plan file parsing
//!
//! Parses plan files (structured plans for multi-agent implementation) from Markdown content.
//! The parser extracts:
//! - Plan metadata (owner, status, target branch, etc.)
//! - Anchors for cross-referencing
//! - Design decisions and open questions
//! - Execution steps with tasks, tests, and checkpoints

use crate::error::TugError;
use crate::types::{
    Anchor, BeadsHints, Checkpoint, CheckpointKind, Decision, Question, Step, Substep, TugPlan,
};
use std::collections::HashMap;

/// Regex patterns for parsing (compiled once)
mod patterns {
    use std::sync::LazyLock;

    pub static ANCHOR: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"\{#([a-z0-9-]+)\}").unwrap());

    pub static PHASE_HEADER: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r"^##\s+Phase\s+[\d.]+:\s*(.+?)\s*(?:\{#([a-z0-9-]+)\})?\s*$").unwrap()
    });

    pub static STEP_HEADER: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(
            r"^#{3,5}\s+Step\s+(\d+(?:\.\d+)?):?\s*(.+?)\s*(?:\{#([a-z0-9-]+)\})?\s*$",
        )
        .unwrap()
    });

    pub static DECISION_HEADER: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(
            r"^####\s+\[([DQ]\d+)\]\s*(.+?)\s*(?:\((\w+)\))?\s*(?:\{#([a-z0-9-]+)\})?\s*$",
        )
        .unwrap()
    });

    pub static CHECKBOX: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"^-\s+\[([ xX])\]\s*(.+)$").unwrap());

    pub static METADATA_ROW: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|").unwrap());

    pub static DEPENDS_ON: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"^\*\*Depends on:\*\*\s*(.+)$").unwrap());

    pub static BEAD_LINE: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"^\*\*Bead:\*\*\s*`([^`]+)`").unwrap());

    pub static BEADS_HINTS: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"^\*\*Beads:\*\*\s*(.+)$").unwrap());

    pub static COMMIT_LINE: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"^\*\*Commit:\*\*\s*`([^`]+)`").unwrap());

    pub static REFERENCES_LINE: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"^\*\*References:\*\*\s*(.+)$").unwrap());

    pub static PURPOSE_LINE: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"^\*\*Purpose:\*\*\s*(.+)$").unwrap());

    pub static BEADS_ROOT_ROW: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"^\|\s*Beads\s+Root\s*\|\s*`([^`]+)`").unwrap());

    pub static ANCHOR_REF: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"#([a-z0-9-]+)").unwrap());

    pub static SECTION_HEADER: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r"^(#{1,6})\s+(.+?)\s*(?:\{#([a-z0-9-]+)\})?\s*$").unwrap()
    });

    // Near-miss patterns for diagnostics (relaxed versions of strict patterns)
    pub static NEAR_MISS_STEP: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"(?i)^#{1,6}\s+step\s+\d+").unwrap());

    pub static NEAR_MISS_DECISION: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"(?i)^\s*#{1,6}\s*\[[DQ]\d+\]").unwrap());

    pub static NEAR_MISS_PHASE: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"(?i)^#{1,6}\s+phase\s+[\d.]+:").unwrap());

    pub static NEAR_MISS_COMMIT: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"(?i)^\*?\*?commit\*?\*?:\s*").unwrap());

    // Broad anchor pattern for detecting invalid anchors
    pub static INVALID_ANCHOR: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"\{#([^}]+)\}").unwrap());

    // Valid anchor format for validation
    pub static VALID_ANCHOR: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"^[a-z0-9][a-z0-9-]*$").unwrap());
}

/// Known metadata field names (case-insensitive matching)
const KNOWN_METADATA_FIELDS: &[&str] = &[
    "owner",
    "status",
    "target branch",
    "tracking issue/pr",
    "tracking issue",
    "tracking",
    "last updated",
    "beads root",
];

/// Parse a plan file from its contents
#[allow(unused_assignments)]
pub fn parse_tugplan(content: &str) -> Result<TugPlan, TugError> {
    let mut tugplan = TugPlan {
        raw_content: content.to_string(),
        ..Default::default()
    };

    let lines: Vec<&str> = content.lines().collect();

    // Track current parsing context
    let mut in_metadata_table = false;
    let mut in_step: Option<usize> = None; // Index into tugplan.steps
    let mut in_substep: Option<usize> = None; // Index into current step's substeps
    let mut current_section = CurrentSection::None;
    let mut anchor_locations: HashMap<String, usize> = HashMap::new();
    let mut in_code_block = false;

    for (line_num, line) in lines.iter().enumerate() {
        let line_number = line_num + 1; // 1-indexed

        // CRITICAL PLACEMENT: Code block toggle MUST be first, before anchor extraction
        // Toggle code block state when encountering fence markers
        if line.trim().starts_with("```") {
            in_code_block = !in_code_block;
            continue;
        }

        // Skip structural matching inside code blocks, emit P006 for structural content
        if in_code_block {
            // Test focused subset of high-value structural patterns (strict and near-miss)
            let mut found_structural = false;
            let mut pattern_name = "";

            // Check strict patterns first
            if patterns::STEP_HEADER.is_match(line) {
                found_structural = true;
                pattern_name = "step header";
            } else if patterns::DECISION_HEADER.is_match(line) {
                found_structural = true;
                pattern_name = "decision header";
            } else if patterns::PHASE_HEADER.is_match(line) {
                found_structural = true;
                pattern_name = "phase header";
            }
            // Also check near-miss patterns to catch malformed structural content
            else if patterns::NEAR_MISS_STEP.is_match(line) {
                found_structural = true;
                pattern_name = "step-like header";
            } else if patterns::NEAR_MISS_DECISION.is_match(line) {
                found_structural = true;
                pattern_name = "decision-like header";
            } else if patterns::NEAR_MISS_PHASE.is_match(line) {
                found_structural = true;
                pattern_name = "phase-like header";
            }

            if found_structural {
                tugplan.diagnostics.push(crate::types::ParseDiagnostic {
                    code: "P006".to_string(),
                    message: format!(
                        "Structural content ({}) found inside code block",
                        pattern_name
                    ),
                    line: line_number,
                    suggestion: Some(
                        "Move this content outside the code block or escape it as an example"
                            .to_string(),
                    ),
                });
            }

            continue; // Skip all structural matching for lines inside code blocks
        }

        // Track whether this line matched any strict pattern (prevents false near-miss diagnostics)
        let mut matched = false;

        // Extract anchors from any line
        for cap in patterns::ANCHOR.captures_iter(line) {
            let anchor_name = cap.get(1).unwrap().as_str().to_string();

            // Check for duplicates
            if let Some(&_first_line) = anchor_locations.get(&anchor_name) {
                // We'll collect this as a warning/error later, but still record it
                tugplan.anchors.push(Anchor {
                    name: format!("{} (duplicate)", anchor_name),
                    line: line_number,
                });
            } else {
                anchor_locations.insert(anchor_name.clone(), line_number);
                tugplan.anchors.push(Anchor {
                    name: anchor_name,
                    line: line_number,
                });
            }
        }

        // P005: Invalid anchor format (runs unconditionally before strict pattern matching,
        // because strict matches use `continue` and would skip this check. Invalid anchors
        // on step/decision/phase headers need to be flagged since the ANCHOR regex above
        // won't collect them and no other diagnostic would explain why.)
        for cap in patterns::INVALID_ANCHOR.captures_iter(line) {
            let anchor_content = cap.get(1).unwrap().as_str();
            if !patterns::VALID_ANCHOR.is_match(anchor_content) {
                let suggestion_anchor = anchor_content
                    .to_lowercase()
                    .replace(['_', ' '], "-")
                    .trim_start_matches('-')
                    .to_string();

                tugplan.diagnostics.push(crate::types::ParseDiagnostic {
                    code: "P005".to_string(),
                    message: format!("Invalid anchor format: {{#{}}}", anchor_content),
                    line: line_number,
                    suggestion: Some(format!(
                        "Use kebab-case: {{#{}}} (lowercase, hyphens only, must start with letter or digit)",
                        suggestion_anchor
                    )),
                });
            }
        }

        // Parse phase header
        if let Some(caps) = patterns::PHASE_HEADER.captures(line) {
            matched = true;
            tugplan.phase_title = Some(caps.get(1).unwrap().as_str().to_string());
            if let Some(anchor) = caps.get(2) {
                tugplan.phase_anchor = Some(anchor.as_str().to_string());
            }
            continue;
        }

        // Parse purpose line
        if let Some(caps) = patterns::PURPOSE_LINE.captures(line) {
            matched = true;
            tugplan.purpose = Some(caps.get(1).unwrap().as_str().to_string());
            continue;
        }

        // Detect metadata table start
        if line.contains("| Field | Value |") || line.contains("|------|-------|") {
            in_metadata_table = true;
            continue;
        }

        // Parse metadata table rows
        if in_metadata_table {
            if line.trim().is_empty() || !line.starts_with('|') {
                in_metadata_table = false;
            } else if let Some(caps) = patterns::METADATA_ROW.captures(line) {
                matched = true;
                let field = caps.get(1).unwrap().as_str().trim();
                let value = caps.get(2).unwrap().as_str().trim();

                // Skip header separator row
                if field.contains("---") {
                    continue;
                }

                let field_lower = field.to_lowercase();

                // P004: Check if field name is recognized
                if !KNOWN_METADATA_FIELDS.contains(&field_lower.as_str()) {
                    tugplan.diagnostics.push(crate::types::ParseDiagnostic {
                        code: "P004".to_string(),
                        message: format!("Unrecognized metadata field: {}", field),
                        line: line_number,
                        suggestion: Some(
                            "Known fields: Owner, Status, Target branch, Tracking issue/PR, Last updated, Beads Root".to_string()
                        ),
                    });
                }

                match field_lower.as_str() {
                    "owner" => tugplan.metadata.owner = non_empty_value(value),
                    "status" => tugplan.metadata.status = non_empty_value(value),
                    "target branch" => tugplan.metadata.target_branch = non_empty_value(value),
                    "tracking issue/pr" | "tracking issue" | "tracking" => {
                        tugplan.metadata.tracking = non_empty_value(value)
                    }
                    "last updated" => tugplan.metadata.last_updated = non_empty_value(value),
                    _ => {}
                }

                // Check for Beads Root in metadata
                if let Some(caps) = patterns::BEADS_ROOT_ROW.captures(line) {
                    tugplan.metadata.beads_root_id =
                        Some(caps.get(1).unwrap().as_str().to_string());
                }
                continue;
            }
        }

        // Note: SECTION_HEADER check moved to after near-miss detection to allow
        // near-miss patterns to fire on malformed step/decision/phase headers

        // Check for **Tasks:**, **Tests:**, **Checkpoint:**, **Artifacts:** bold markers
        if line.starts_with("**Tasks:**") {
            current_section = CurrentSection::Tasks;
            continue;
        }
        if line.starts_with("**Tests:**") {
            current_section = CurrentSection::Tests;
            continue;
        }
        if line.starts_with("**Checkpoint:**") || line.starts_with("**Checkpoints:**") {
            current_section = CurrentSection::Checkpoints;
            continue;
        }
        if line.starts_with("**Artifacts:**") {
            current_section = CurrentSection::Artifacts;
            continue;
        }

        // Parse decision/question headers
        if let Some(caps) = patterns::DECISION_HEADER.captures(line) {
            matched = true;
            let id = caps.get(1).unwrap().as_str();
            let title = caps.get(2).unwrap().as_str();
            let status = caps.get(3).map(|m| m.as_str().to_string());
            let anchor = caps.get(4).map(|m| m.as_str().to_string());

            if id.starts_with('D') {
                tugplan.decisions.push(Decision {
                    id: id.to_string(),
                    title: title.to_string(),
                    status,
                    anchor,
                    line: line_number,
                });
            } else if id.starts_with('Q') {
                tugplan.questions.push(Question {
                    id: id.to_string(),
                    title: title.to_string(),
                    resolution: status,
                    anchor,
                    line: line_number,
                });
            }
            continue;
        }

        // Parse step headers
        if let Some(caps) = patterns::STEP_HEADER.captures(line) {
            matched = true;
            let number = caps.get(1).unwrap().as_str();
            let title = caps.get(2).unwrap().as_str();
            let anchor = caps
                .get(3)
                .map(|m| m.as_str().to_string())
                .unwrap_or_else(|| format!("step-{}", number.replace('.', "-")));

            // Check if this is a substep (contains a dot)
            if number.contains('.') {
                // This is a substep
                let substep = Substep {
                    number: number.to_string(),
                    title: title.to_string(),
                    anchor: anchor.clone(),
                    line: line_number,
                    ..Default::default()
                };

                if let Some(step_idx) = in_step {
                    let substep_idx = tugplan.steps[step_idx].substeps.len();
                    tugplan.steps[step_idx].substeps.push(substep);
                    in_substep = Some(substep_idx);
                }
            } else {
                // This is a main step
                let step = Step {
                    number: number.to_string(),
                    title: title.to_string(),
                    anchor: anchor.clone(),
                    line: line_number,
                    ..Default::default()
                };
                tugplan.steps.push(step);
                in_step = Some(tugplan.steps.len() - 1);
                in_substep = None;
            }

            current_section = CurrentSection::None;
            continue;
        }

        // Parse step metadata lines (when inside a step)
        if in_step.is_some() {
            // Parse **Depends on:** line
            if let Some(caps) = patterns::DEPENDS_ON.captures(line) {
                matched = true;
                let deps_str = caps.get(1).unwrap().as_str();
                let deps: Vec<String> = patterns::ANCHOR_REF
                    .captures_iter(deps_str)
                    .map(|c| c.get(1).unwrap().as_str().to_string())
                    .collect();

                if let Some(substep_idx) = in_substep {
                    if let Some(step_idx) = in_step {
                        tugplan.steps[step_idx].substeps[substep_idx].depends_on = deps;
                    }
                } else if let Some(step_idx) = in_step {
                    tugplan.steps[step_idx].depends_on = deps;
                }
                continue;
            }

            // Parse **Bead:** line
            if let Some(caps) = patterns::BEAD_LINE.captures(line) {
                matched = true;
                let bead_id = caps.get(1).unwrap().as_str().to_string();

                if let Some(substep_idx) = in_substep {
                    if let Some(step_idx) = in_step {
                        tugplan.steps[step_idx].substeps[substep_idx].bead_id = Some(bead_id);
                    }
                } else if let Some(step_idx) = in_step {
                    tugplan.steps[step_idx].bead_id = Some(bead_id);
                }
                continue;
            }

            // Parse **Beads:** hints line
            if let Some(caps) = patterns::BEADS_HINTS.captures(line) {
                matched = true;
                let hints_str = caps.get(1).unwrap().as_str();
                let hints = parse_beads_hints(hints_str);

                if let Some(substep_idx) = in_substep {
                    if let Some(step_idx) = in_step {
                        tugplan.steps[step_idx].substeps[substep_idx].beads_hints = Some(hints);
                    }
                } else if let Some(step_idx) = in_step {
                    tugplan.steps[step_idx].beads_hints = Some(hints);
                }
                continue;
            }

            // Parse **Commit:** line
            if let Some(caps) = patterns::COMMIT_LINE.captures(line) {
                matched = true;
                let commit_msg = caps.get(1).unwrap().as_str().to_string();

                if let Some(substep_idx) = in_substep {
                    if let Some(step_idx) = in_step {
                        tugplan.steps[step_idx].substeps[substep_idx].commit_message =
                            Some(commit_msg);
                    }
                } else if let Some(step_idx) = in_step {
                    tugplan.steps[step_idx].commit_message = Some(commit_msg);
                }
                continue;
            }

            // Parse **References:** line
            if let Some(caps) = patterns::REFERENCES_LINE.captures(line) {
                matched = true;
                let refs = caps.get(1).unwrap().as_str().to_string();

                if let Some(substep_idx) = in_substep {
                    if let Some(step_idx) = in_step {
                        tugplan.steps[step_idx].substeps[substep_idx].references = Some(refs);
                    }
                } else if let Some(step_idx) = in_step {
                    tugplan.steps[step_idx].references = Some(refs);
                }
                continue;
            }

            // Parse checkbox items
            if let Some(caps) = patterns::CHECKBOX.captures(line) {
                matched = true;
                let checked = caps.get(1).unwrap().as_str() != " ";
                let text = caps.get(2).unwrap().as_str().to_string();

                // Special handling for Artifacts section: capture text as plain artifact item
                if current_section == CurrentSection::Artifacts {
                    if let Some(substep_idx) = in_substep {
                        if let Some(step_idx) = in_step {
                            tugplan.steps[step_idx].substeps[substep_idx]
                                .artifacts
                                .push(text);
                        }
                    } else if let Some(step_idx) = in_step {
                        tugplan.steps[step_idx].artifacts.push(text);
                    }
                    continue;
                }

                let kind = match current_section {
                    CurrentSection::Tasks => CheckpointKind::Task,
                    CurrentSection::Tests => CheckpointKind::Test,
                    CurrentSection::Checkpoints => CheckpointKind::Checkpoint,
                    _ => CheckpointKind::Task, // Default to task
                };

                let checkpoint = Checkpoint {
                    checked,
                    text,
                    kind,
                    line: line_number,
                };

                if let Some(substep_idx) = in_substep {
                    if let Some(step_idx) = in_step {
                        match kind {
                            CheckpointKind::Task => {
                                tugplan.steps[step_idx].substeps[substep_idx]
                                    .tasks
                                    .push(checkpoint);
                            }
                            CheckpointKind::Test => {
                                tugplan.steps[step_idx].substeps[substep_idx]
                                    .tests
                                    .push(checkpoint);
                            }
                            CheckpointKind::Checkpoint => {
                                tugplan.steps[step_idx].substeps[substep_idx]
                                    .checkpoints
                                    .push(checkpoint);
                            }
                        }
                    }
                } else if let Some(step_idx) = in_step {
                    match kind {
                        CheckpointKind::Task => {
                            tugplan.steps[step_idx].tasks.push(checkpoint);
                        }
                        CheckpointKind::Test => {
                            tugplan.steps[step_idx].tests.push(checkpoint);
                        }
                        CheckpointKind::Checkpoint => {
                            tugplan.steps[step_idx].checkpoints.push(checkpoint);
                        }
                    }
                }
                continue;
            }

            // Parse plain bullet items in Artifacts section
            if current_section == CurrentSection::Artifacts && line.trim_start().starts_with("- ") {
                matched = true;
                let text = line.trim_start().strip_prefix("- ").unwrap().to_string();
                if let Some(substep_idx) = in_substep {
                    if let Some(step_idx) = in_step {
                        tugplan.steps[step_idx].substeps[substep_idx]
                            .artifacts
                            .push(text);
                    }
                } else if let Some(step_idx) = in_step {
                    tugplan.steps[step_idx].artifacts.push(text);
                }
            }
        }

        // Near-miss detection section (runs only if no strict pattern matched)
        if !matched {
            // P001: Step header near-miss
            if patterns::NEAR_MISS_STEP.is_match(line) {
                tugplan.diagnostics.push(crate::types::ParseDiagnostic {
                    code: "P001".to_string(),
                    message: "Step header does not match strict format".to_string(),
                    line: line_number,
                    suggestion: Some("Use format: #### Step N: Title {#step-n} (with 3-5 # marks, capital S, optional colon)".to_string()),
                });
            }

            // P002: Decision header near-miss
            if patterns::NEAR_MISS_DECISION.is_match(line) {
                tugplan.diagnostics.push(crate::types::ParseDiagnostic {
                    code: "P002".to_string(),
                    message: "Decision/Question header does not match strict format".to_string(),
                    line: line_number,
                    suggestion: Some("Use format: #### [D01] Title (STATUS) {#d01-slug} (with #### exactly, capital D/Q)".to_string()),
                });
            }

            // P003: Phase header near-miss
            if patterns::NEAR_MISS_PHASE.is_match(line) {
                tugplan.diagnostics.push(crate::types::ParseDiagnostic {
                    code: "P003".to_string(),
                    message: "Phase header does not match strict format".to_string(),
                    line: line_number,
                    suggestion: Some("Use format: ## Phase N.N: Title {#phase-slug} (with ## exactly, capital P)".to_string()),
                });
            }

            // P007: Commit line near-miss
            if patterns::NEAR_MISS_COMMIT.is_match(line) {
                tugplan.diagnostics.push(crate::types::ParseDiagnostic {
                    code: "P007".to_string(),
                    message: "Commit line does not match strict format".to_string(),
                    line: line_number,
                    suggestion: Some(
                        "Use format: **Commit:** `message` (bold, backtick-wrapped message)"
                            .to_string(),
                    ),
                });
            }
        }

        // Parse section headers to track context (checked AFTER near-miss to allow diagnostics)
        // This is a catch-all for any remaining headers, so it doesn't set matched=true
        if let Some(caps) = patterns::SECTION_HEADER.captures(line) {
            let header_text = caps.get(2).unwrap().as_str();
            let header_lower = header_text.to_lowercase();

            if header_lower.contains("tasks:") || header_lower == "tasks" {
                current_section = CurrentSection::Tasks;
            } else if header_lower.contains("tests:") || header_lower == "tests" {
                current_section = CurrentSection::Tests;
            } else if header_lower.contains("checkpoint")
                || header_lower.contains("checkpoints:")
                || header_lower == "checkpoints"
            {
                current_section = CurrentSection::Checkpoints;
            } else if header_lower.contains("artifacts:") || header_lower == "artifacts" {
                current_section = CurrentSection::Artifacts;
            } else if header_lower.contains("references") || header_lower.contains("rollback") {
                current_section = CurrentSection::Other;
            }
        }
    }

    Ok(tugplan)
}

/// Parse beads hints from a hints string like "type=task, priority=1, labels=backend,api"
fn parse_beads_hints(hints_str: &str) -> BeadsHints {
    let mut hints = BeadsHints::default();

    // Split by comma followed by space and key= pattern to handle labels with commas
    // We need to find key=value pairs more carefully
    let mut remaining = hints_str.trim();

    while !remaining.is_empty() {
        // Find the next key=value pair
        if let Some(eq_pos) = remaining.find('=') {
            let key = remaining[..eq_pos].trim().to_lowercase();

            // Find the end of this value (next ", key=" pattern or end of string)
            let value_start = eq_pos + 1;
            let rest = &remaining[value_start..];

            // Look for next key= pattern (space + word + =)
            let value_end = find_next_key_start(rest);
            let value = rest[..value_end].trim().trim_end_matches(',').trim();

            match key.as_str() {
                "type" => hints.issue_type = Some(value.to_string()),
                "priority" => {
                    if let Ok(p) = value.parse::<u8>() {
                        hints.priority = Some(p);
                    }
                }
                "labels" => {
                    hints.labels = value.split(',').map(|s| s.trim().to_string()).collect();
                }
                "estimate_minutes" | "estimate" => {
                    if let Ok(e) = value.parse::<u32>() {
                        hints.estimate_minutes = Some(e);
                    }
                }
                _ => {}
            }

            remaining = rest[value_end..].trim().trim_start_matches(',').trim();
        } else {
            break;
        }
    }

    hints
}

/// Find the start of the next key=value pair in a hints string
fn find_next_key_start(s: &str) -> usize {
    // Look for patterns like ", key=" where key is a word
    let bytes = s.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        // Look for comma
        if bytes[i] == b',' {
            // Skip whitespace
            let mut j = i + 1;
            while j < bytes.len() && bytes[j] == b' ' {
                j += 1;
            }
            // Check if this looks like a key (word followed by =)
            let mut k = j;
            while k < bytes.len() && (bytes[k].is_ascii_alphanumeric() || bytes[k] == b'_') {
                k += 1;
            }
            if k < bytes.len() && bytes[k] == b'=' && k > j {
                // This is a new key
                return i;
            }
        }
        i += 1;
    }

    s.len()
}

/// Track which section we're currently parsing within a step
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CurrentSection {
    None,
    Tasks,
    Tests,
    Checkpoints,
    Artifacts,
    Other,
}

/// Convert a value to Option, returning None only if empty
/// Per spec: TBD is considered "present" for Owner and Tracking fields
/// Per spec: <...> placeholders are stored but generate a warning
fn non_empty_value(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        // Store all non-empty values including TBD and placeholders
        // Validation will handle warnings for placeholders
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_minimal_plan() {
        let content = r#"## Phase 1.0: Test Phase {#phase-1}

**Purpose:** Test purpose statement

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test Owner |
| Status | draft |
| Target branch | main |
| Tracking issue/PR | #123 |
| Last updated | 2026-02-03 |

---

### 1.0.5 Execution Steps {#execution-steps}

#### Step 0: Bootstrap {#step-0}

**Commit:** `feat: initial setup`

**References:** [D01] Test decision

**Tasks:**
- [ ] Task one
- [x] Task two

**Tests:**
- [ ] Test one

**Checkpoint:**
- [ ] Checkpoint one
- [x] Checkpoint two
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.phase_title, Some("Test Phase".to_string()));
        assert_eq!(tugplan.phase_anchor, Some("phase-1".to_string()));
        assert_eq!(tugplan.purpose, Some("Test purpose statement".to_string()));

        assert_eq!(tugplan.metadata.owner, Some("Test Owner".to_string()));
        assert_eq!(tugplan.metadata.status, Some("draft".to_string()));
        assert_eq!(tugplan.metadata.target_branch, Some("main".to_string()));
        assert_eq!(tugplan.metadata.tracking, Some("#123".to_string()));
        assert_eq!(
            tugplan.metadata.last_updated,
            Some("2026-02-03".to_string())
        );

        assert_eq!(tugplan.steps.len(), 1);
        let step = &tugplan.steps[0];
        assert_eq!(step.number, "0");
        assert_eq!(step.title, "Bootstrap");
        assert_eq!(step.anchor, "step-0");
        assert_eq!(step.commit_message, Some("feat: initial setup".to_string()));
        assert_eq!(step.references, Some("[D01] Test decision".to_string()));

        assert_eq!(step.tasks.len(), 2);
        assert!(!step.tasks[0].checked);
        assert!(step.tasks[1].checked);

        assert_eq!(step.tests.len(), 1);
        assert!(!step.tests[0].checked);

        assert_eq!(step.checkpoints.len(), 2);
        assert!(!step.checkpoints[0].checked);
        assert!(step.checkpoints[1].checked);
    }

    #[test]
    fn test_parse_depends_on() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### Step 0: First {#step-0}

**Tasks:**
- [ ] Task

#### Step 1: Second {#step-1}

**Depends on:** #step-0

**Tasks:**
- [ ] Task

#### Step 2: Third {#step-2}

**Depends on:** #step-0, #step-1

**Tasks:**
- [ ] Task
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.steps.len(), 3);
        assert!(tugplan.steps[0].depends_on.is_empty());
        assert_eq!(tugplan.steps[1].depends_on, vec!["step-0"]);
        assert_eq!(tugplan.steps[2].depends_on, vec!["step-0", "step-1"]);
    }

    #[test]
    fn test_parse_bead_line() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |
| Beads Root | `bd-root123` |

#### Step 0: First {#step-0}

**Bead:** `bd-step0`

**Tasks:**
- [ ] Task
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(
            tugplan.metadata.beads_root_id,
            Some("bd-root123".to_string())
        );
        assert_eq!(tugplan.steps[0].bead_id, Some("bd-step0".to_string()));
    }

    #[test]
    fn test_parse_beads_hints() {
        let hints =
            parse_beads_hints("type=task, priority=2, labels=backend,api, estimate_minutes=60");

        assert_eq!(hints.issue_type, Some("task".to_string()));
        assert_eq!(hints.priority, Some(2));
        assert_eq!(hints.labels, vec!["backend", "api"]);
        assert_eq!(hints.estimate_minutes, Some(60));
    }

    #[test]
    fn test_parse_substeps() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### Step 2: Big Step {#step-2}

**Depends on:** #step-1

**Tasks:**
- [ ] Parent task

##### Step 2.1: First Substep {#step-2-1}

**Commit:** `feat: substep 1`

**Tasks:**
- [ ] Substep task

##### Step 2.2: Second Substep {#step-2-2}

**Depends on:** #step-2-1

**Tasks:**
- [x] Another substep task
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.steps.len(), 1);
        let step = &tugplan.steps[0];
        assert_eq!(step.number, "2");
        assert_eq!(step.substeps.len(), 2);

        assert_eq!(step.substeps[0].number, "2.1");
        assert_eq!(step.substeps[0].title, "First Substep");
        assert_eq!(
            step.substeps[0].commit_message,
            Some("feat: substep 1".to_string())
        );

        assert_eq!(step.substeps[1].number, "2.2");
        assert_eq!(step.substeps[1].depends_on, vec!["step-2-1"]);
        assert!(step.substeps[1].tasks[0].checked);
    }

    #[test]
    fn test_parse_decisions() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | draft |
| Last updated | 2026-02-03 |

### Design Decisions {#design-decisions}

#### [D01] Use Rust (DECIDED) {#d01-use-rust}

**Decision:** Build in Rust.

#### [D02] Use clap (OPEN) {#d02-use-clap}

**Decision:** Consider clap for CLI.
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.decisions.len(), 2);
        assert_eq!(tugplan.decisions[0].id, "D01");
        assert_eq!(tugplan.decisions[0].title, "Use Rust");
        assert_eq!(tugplan.decisions[0].status, Some("DECIDED".to_string()));
        assert_eq!(
            tugplan.decisions[0].anchor,
            Some("d01-use-rust".to_string())
        );

        assert_eq!(tugplan.decisions[1].id, "D02");
        assert_eq!(tugplan.decisions[1].status, Some("OPEN".to_string()));
    }

    #[test]
    fn test_parse_questions() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | draft |
| Last updated | 2026-02-03 |

### Open Questions {#open-questions}

#### [Q01] Distribution strategy (DEFERRED) {#q01-distribution}

**Question:** How to distribute?
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.questions.len(), 1);
        assert_eq!(tugplan.questions[0].id, "Q01");
        assert_eq!(tugplan.questions[0].title, "Distribution strategy");
        assert_eq!(
            tugplan.questions[0].resolution,
            Some("DEFERRED".to_string())
        );
    }

    #[test]
    fn test_parse_anchors() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

### Section One {#section-one}

### Section Two {#section-two}

#### Subsection {#subsection}
"#;

        let tugplan = parse_tugplan(content).unwrap();

        let anchor_names: Vec<&str> = tugplan.anchors.iter().map(|a| a.name.as_str()).collect();
        assert!(anchor_names.contains(&"phase-1"));
        assert!(anchor_names.contains(&"plan-metadata"));
        assert!(anchor_names.contains(&"section-one"));
        assert!(anchor_names.contains(&"section-two"));
        assert!(anchor_names.contains(&"subsection"));
    }

    #[test]
    fn test_checkbox_states() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### Step 0: Test {#step-0}

**Tasks:**
- [ ] Unchecked lowercase
- [x] Checked lowercase
- [X] Checked uppercase
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.steps[0].tasks.len(), 3);
        assert!(!tugplan.steps[0].tasks[0].checked);
        assert!(tugplan.steps[0].tasks[1].checked);
        assert!(tugplan.steps[0].tasks[2].checked);
    }

    #[test]
    fn test_malformed_markdown_graceful() {
        // Parser should not panic on malformed content
        let content = "This is not a valid plan at all\n\nJust random text";
        let result = parse_tugplan(content);
        assert!(result.is_ok());

        let tugplan = result.unwrap();
        assert!(tugplan.steps.is_empty());
        assert!(tugplan.metadata.owner.is_none());
    }

    #[test]
    fn test_parse_artifacts_bold_marker() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### Step 0: Test {#step-0}

**Tasks:**
- [ ] Task one

**Artifacts:**
- [ ] New file: src/main.rs
- [ ] Modified: Cargo.toml

**Tests:**
- [ ] Test one
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.steps.len(), 1);
        let step = &tugplan.steps[0];
        assert_eq!(step.artifacts.len(), 2);
        assert_eq!(step.artifacts[0], "New file: src/main.rs");
        assert_eq!(step.artifacts[1], "Modified: Cargo.toml");
    }

    #[test]
    fn test_parse_artifacts_heading_style() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### Step 0: Test {#step-0}

##### Tasks

- [ ] Task one

##### Artifacts

- New file: src/main.rs
- Modified: Cargo.toml

##### Tests

- [ ] Test one
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.steps.len(), 1);
        let step = &tugplan.steps[0];
        assert_eq!(step.artifacts.len(), 2);
        assert_eq!(step.artifacts[0], "New file: src/main.rs");
        assert_eq!(step.artifacts[1], "Modified: Cargo.toml");
    }

    #[test]
    fn test_parse_artifacts_with_checkboxes() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### Step 0: Test {#step-0}

**Artifacts:**
- [ ] New file: src/main.rs
- Modified: Cargo.toml
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.steps.len(), 1);
        let step = &tugplan.steps[0];
        assert_eq!(step.artifacts.len(), 2);
        assert_eq!(step.artifacts[0], "New file: src/main.rs");
        assert_eq!(step.artifacts[1], "Modified: Cargo.toml");
    }

    #[test]
    fn test_code_block_step_header_not_parsed() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

Here's an example:

```
#### Step 0: Example {#step-0}
```

#### Step 1: Real Step {#step-1}

**Tasks:**
- [ ] Task one
"#;

        let tugplan = parse_tugplan(content).unwrap();

        // Only Step 1 should be parsed, not Step 0 inside code block
        assert_eq!(tugplan.steps.len(), 1);
        assert_eq!(tugplan.steps[0].number, "1");
        assert_eq!(tugplan.steps[0].title, "Real Step");
    }

    #[test]
    fn test_code_block_step_header_emits_p006() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

Example step header:

```
#### Step 0: Example {#step-0}
```
"#;

        let tugplan = parse_tugplan(content).unwrap();

        // Should emit P006 diagnostic
        assert_eq!(tugplan.diagnostics.len(), 1);
        assert_eq!(tugplan.diagnostics[0].code, "P006");
        assert_eq!(tugplan.diagnostics[0].line, 14);
        assert!(tugplan.diagnostics[0].message.contains("step header"));
    }

    #[test]
    fn test_code_block_decision_header_not_parsed() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

Example decision:

```
#### [D01] Example Decision (DECIDED) {#d01-example}
```

#### [D02] Real Decision (DECIDED) {#d02-real}
"#;

        let tugplan = parse_tugplan(content).unwrap();

        // Only D02 should be parsed
        assert_eq!(tugplan.decisions.len(), 1);
        assert_eq!(tugplan.decisions[0].id, "D02");
        assert_eq!(tugplan.decisions[0].title, "Real Decision");
    }

    #[test]
    fn test_code_block_anchor_not_collected() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

Example with anchor:

```
### Section {#code-block-anchor}
```

### Real Section {#real-anchor}
"#;

        let tugplan = parse_tugplan(content).unwrap();

        // Should have phase-1, plan-metadata, and real-anchor, but NOT code-block-anchor
        let anchor_names: Vec<&str> = tugplan.anchors.iter().map(|a| a.name.as_str()).collect();
        assert!(anchor_names.contains(&"phase-1"));
        assert!(anchor_names.contains(&"plan-metadata"));
        assert!(anchor_names.contains(&"real-anchor"));
        assert!(!anchor_names.contains(&"code-block-anchor"));
    }

    #[test]
    fn test_code_block_no_diagnostics_without_structural_content() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

Example code:

```
fn main() {
    println!("Hello");
}
```
"#;

        let tugplan = parse_tugplan(content).unwrap();

        // No diagnostics should be emitted
        assert_eq!(tugplan.diagnostics.len(), 0);
    }

    #[test]
    fn test_content_after_code_block_parsed_normally() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

Example:

```
#### Step 0: Inside block {#step-0}
```

#### Step 1: After block {#step-1}

**Tasks:**
- [ ] Task one
"#;

        let tugplan = parse_tugplan(content).unwrap();

        // Step 1 should be parsed normally
        assert_eq!(tugplan.steps.len(), 1);
        assert_eq!(tugplan.steps[0].number, "1");
        assert_eq!(tugplan.steps[0].title, "After block");
        assert_eq!(tugplan.steps[0].tasks.len(), 1);
    }

    #[test]
    fn test_empty_diagnostics_by_default() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### Step 0: Simple {#step-0}

**Tasks:**
- [ ] Task one
"#;

        let tugplan = parse_tugplan(content).unwrap();

        // Diagnostics should be empty vec
        assert_eq!(tugplan.diagnostics.len(), 0);
    }

    // Near-miss detection tests
    #[test]
    fn test_p001_step_header_lowercase() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

### step 0: lowercase
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.diagnostics.len(), 1);
        assert_eq!(tugplan.diagnostics[0].code, "P001");
        assert!(tugplan.diagnostics[0].message.contains("Step header"));
    }

    #[test]
    fn test_p001_step_header_wrong_level() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

## Step 1: Wrong heading level
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.diagnostics.len(), 1);
        assert_eq!(tugplan.diagnostics[0].code, "P001");
    }

    #[test]
    fn test_p002_decision_lowercase() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### [d01] lowercase decision (DECIDED)
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.diagnostics.len(), 1);
        assert_eq!(tugplan.diagnostics[0].code, "P002");
        assert!(tugplan.diagnostics[0].message.contains("Decision"));
    }

    #[test]
    fn test_p003_phase_header_lowercase() {
        let content = r#"## phase 1.0: lowercase

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.diagnostics.len(), 1);
        assert_eq!(tugplan.diagnostics[0].code, "P003");
        assert!(tugplan.diagnostics[0].message.contains("Phase header"));
    }

    #[test]
    fn test_p003_not_triggered_by_section_header() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

### Phase Overview {#phase-overview}

This is content.
"#;

        let tugplan = parse_tugplan(content).unwrap();

        // Should NOT trigger P003 because SECTION_HEADER matched and set matched=true
        assert_eq!(tugplan.diagnostics.len(), 0);
    }

    #[test]
    fn test_p004_unknown_metadata_field() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Author | Test User |
| Status | active |
| Last updated | 2026-02-03 |
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.diagnostics.len(), 1);
        assert_eq!(tugplan.diagnostics[0].code, "P004");
        assert!(tugplan.diagnostics[0].message.contains("Author"));
        assert!(
            tugplan.diagnostics[0]
                .suggestion
                .as_ref()
                .unwrap()
                .contains("Owner")
        );
    }

    #[test]
    fn test_p005_anchor_uppercase() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

### Section {#MyAnchor}
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.diagnostics.len(), 1);
        assert_eq!(tugplan.diagnostics[0].code, "P005");
        assert!(tugplan.diagnostics[0].message.contains("MyAnchor"));
        assert!(
            tugplan.diagnostics[0]
                .suggestion
                .as_ref()
                .unwrap()
                .contains("myanchor")
        );
    }

    #[test]
    fn test_p005_anchor_underscore() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

### Section {#my_anchor}
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.diagnostics.len(), 1);
        assert_eq!(tugplan.diagnostics[0].code, "P005");
        assert!(tugplan.diagnostics[0].message.contains("my_anchor"));
        assert!(
            tugplan.diagnostics[0]
                .suggestion
                .as_ref()
                .unwrap()
                .contains("my-anchor")
        );
    }

    #[test]
    fn test_p005_anchor_space() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

### Section {#my anchor}
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.diagnostics.len(), 1);
        assert_eq!(tugplan.diagnostics[0].code, "P005");
        assert!(tugplan.diagnostics[0].message.contains("my anchor"));
    }

    #[test]
    fn test_p005_anchor_leading_hyphen() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

### Section {#-leading-hyphen}
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.diagnostics.len(), 1);
        assert_eq!(tugplan.diagnostics[0].code, "P005");
        assert!(tugplan.diagnostics[0].message.contains("-leading-hyphen"));
        assert!(
            tugplan.diagnostics[0]
                .suggestion
                .as_ref()
                .unwrap()
                .contains("leading-hyphen")
        );
    }

    #[test]
    fn test_p005_valid_anchor_no_diagnostic() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

### Section {#valid-anchor}
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.diagnostics.len(), 0);
    }

    #[test]
    fn test_p007_commit_no_backticks() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### Step 0: Test {#step-0}

**Commit:** message without backticks
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.diagnostics.len(), 1);
        assert_eq!(tugplan.diagnostics[0].code, "P007");
        assert!(tugplan.diagnostics[0].message.contains("Commit"));
    }

    #[test]
    fn test_p007_commit_no_bold() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### Step 0: Test {#step-0}

Commit: message
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.diagnostics.len(), 1);
        assert_eq!(tugplan.diagnostics[0].code, "P007");
    }

    #[test]
    fn test_correct_step_header_no_p001() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### Step 0: Correct format {#step-0}

**Tasks:**
- [ ] Task one
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.diagnostics.len(), 0);
    }

    #[test]
    fn test_correct_commit_no_p007() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### Step 0: Test {#step-0}

**Commit:** `feat: add feature`

**Tasks:**
- [ ] Task one
"#;

        let tugplan = parse_tugplan(content).unwrap();

        assert_eq!(tugplan.diagnostics.len(), 0);
    }

    #[test]
    fn test_near_miss_in_code_block_only_p006() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

Example:

```
### step 0: this is in a code block
#### [d01] also in code block
**Commit:** not backticked
{#MyAnchor}
```
"#;

        let tugplan = parse_tugplan(content).unwrap();

        // Should only get P006 for structural content in code block, not P001/P002/P005/P007
        let p006_count = tugplan
            .diagnostics
            .iter()
            .filter(|d| d.code == "P006")
            .count();
        let non_p006_count = tugplan
            .diagnostics
            .iter()
            .filter(|d| d.code != "P006")
            .count();

        assert!(p006_count > 0);
        assert_eq!(non_p006_count, 0);
    }

    #[test]
    fn test_p005_fires_on_matched_step_header_with_bad_anchor() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### Step 0: Test Step {#Step-0}

**Commit:** `feat: test`

**Tasks:**
- [ ] Task one
"#;

        let tugplan = parse_tugplan(content).unwrap();

        // Step should be parsed (strict STEP_HEADER matches)
        assert_eq!(tugplan.steps.len(), 1);

        // P005 should fire for the uppercase anchor even though the line matched a strict pattern
        let p005: Vec<_> = tugplan
            .diagnostics
            .iter()
            .filter(|d| d.code == "P005")
            .collect();
        assert_eq!(
            p005.len(),
            1,
            "P005 should fire for invalid anchor on matched step header"
        );
        assert!(p005[0].message.contains("Step-0"));
        assert!(p005[0].suggestion.as_ref().unwrap().contains("step-0"));
    }

    #[test]
    fn test_p005_does_not_fire_on_valid_anchor_of_matched_line() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### Step 0: Test Step {#step-0}

**Commit:** `feat: test`

**Tasks:**
- [ ] Task one
"#;

        let tugplan = parse_tugplan(content).unwrap();

        // No P005 should fire for valid anchors
        let p005_count = tugplan
            .diagnostics
            .iter()
            .filter(|d| d.code == "P005")
            .count();
        assert_eq!(p005_count, 0, "P005 should not fire for valid anchors");
    }
}
