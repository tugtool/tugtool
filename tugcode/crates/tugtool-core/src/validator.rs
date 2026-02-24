//! Validation logic and rules
//!
//! Implements structural validation for plan documents per the skeleton format.
//! Validation rules are organized by severity (Error, Warning, Info) and can be
//! configured via validation levels (lenient, normal, strict).

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use crate::types::{ParseDiagnostic, TugPlan};

/// Regex for valid anchor format (only a-z, 0-9, - allowed)
static VALID_ANCHOR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-z0-9][a-z0-9-]*$").unwrap());

/// Regex for unfilled placeholder pattern (<...>)
static PLACEHOLDER_PATTERN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^<[^>]+>$").unwrap());

/// Regex to detect prose-style dependencies (e.g., "Step 0" instead of "#step-0")
static PROSE_DEPENDENCY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bstep\s+\d+").unwrap());

/// Regex for valid **References:** format - must contain [DNN] decision citations
/// Valid: "[D01] Decision name, [D02] Another"
/// Also valid: "Spec S01", "Table T01", "(#anchor)"
static DECISION_CITATION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[D\d{2}\]").unwrap());

/// Regex for extracting decision IDs from References lines (with capture group)
/// Pattern: \[(D\d{2,})\] - allows 2+ digits for forward compatibility
/// Note: distinct from DECISION_CITATION which is presence-only (no capture group)
static DECISION_ID_CAPTURE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[(D\d{2,})\]").unwrap());

/// Regex for anchor citations in References (must be in parentheses with # prefix)
static ANCHOR_CITATION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\(#[a-z0-9-]+(,\s*#[a-z0-9-]+)*\)").unwrap());

/// Result of validating a plan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    /// Whether the plan is valid (no errors)
    pub valid: bool,
    /// List of validation issues
    pub issues: Vec<ValidationIssue>,
    /// Parse diagnostics (near-miss patterns, code block issues)
    #[serde(default)]
    pub diagnostics: Vec<ParseDiagnostic>,
}

impl ValidationResult {
    /// Create a new empty validation result
    pub fn new() -> Self {
        Self {
            valid: true,
            issues: vec![],
            diagnostics: vec![],
        }
    }

    /// Add an issue and update validity
    pub fn add_issue(&mut self, issue: ValidationIssue) {
        if issue.severity == Severity::Error {
            self.valid = false;
        }
        self.issues.push(issue);
    }

    /// Count errors
    pub fn error_count(&self) -> usize {
        self.issues
            .iter()
            .filter(|i| i.severity == Severity::Error)
            .count()
    }

    /// Count warnings
    pub fn warning_count(&self) -> usize {
        self.issues
            .iter()
            .filter(|i| i.severity == Severity::Warning)
            .count()
    }

    /// Count info messages
    pub fn info_count(&self) -> usize {
        self.issues
            .iter()
            .filter(|i| i.severity == Severity::Info)
            .count()
    }

    /// Count diagnostics
    pub fn diagnostic_count(&self) -> usize {
        self.diagnostics.len()
    }
}

impl Default for ValidationResult {
    fn default() -> Self {
        Self::new()
    }
}

/// A single validation issue
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationIssue {
    /// Error/warning code (e.g., "E001", "W001")
    pub code: String,
    /// Severity level
    pub severity: Severity,
    /// Human-readable message
    pub message: String,
    /// Line number (if applicable)
    pub line: Option<usize>,
    /// Anchor reference (if applicable)
    pub anchor: Option<String>,
}

impl ValidationIssue {
    /// Create a new validation issue
    pub fn new(code: &str, severity: Severity, message: String) -> Self {
        Self {
            code: code.to_string(),
            severity,
            message,
            line: None,
            anchor: None,
        }
    }

    /// Set the line number
    pub fn at_line(mut self, line: usize) -> Self {
        self.line = Some(line);
        self
    }

    /// Set the anchor reference
    pub fn with_anchor(mut self, anchor: &str) -> Self {
        self.anchor = Some(format!("#{}", anchor));
        self
    }
}

/// Severity level for validation issues
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// Must fix
    Error,
    /// Should fix
    Warning,
    /// Optional/informational
    Info,
}

/// Validation level (strictness)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ValidationLevel {
    /// Lenient: Only report errors
    Lenient,
    /// Normal: Report errors and warnings (default)
    #[default]
    Normal,
    /// Strict: Report errors, warnings, and info
    Strict,
}

impl ValidationLevel {
    /// Parse from string representation
    pub fn parse(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "lenient" => ValidationLevel::Lenient,
            "strict" => ValidationLevel::Strict,
            _ => ValidationLevel::Normal,
        }
    }

    /// Check if this level includes warnings
    pub fn include_warnings(&self) -> bool {
        matches!(self, ValidationLevel::Normal | ValidationLevel::Strict)
    }

    /// Check if this level includes info messages
    pub fn include_info(&self) -> bool {
        matches!(self, ValidationLevel::Strict)
    }
}

/// Validation configuration
#[derive(Debug, Clone, Default)]
pub struct ValidationConfig {
    /// Validation strictness level
    pub level: ValidationLevel,
}

/// Validate a parsed plan
pub fn validate_tugplan(tugplan: &TugPlan) -> ValidationResult {
    validate_tugplan_with_config(tugplan, &ValidationConfig::default())
}

/// Validate a parsed plan with configuration
pub fn validate_tugplan_with_config(
    tugplan: &TugPlan,
    config: &ValidationConfig,
) -> ValidationResult {
    let mut result = ValidationResult::new();

    // Build anchor map for reference validation
    let anchor_map: HashMap<String, usize> = tugplan
        .anchors
        .iter()
        .filter(|a| !a.name.contains("(duplicate)"))
        .map(|a| (a.name.clone(), a.line))
        .collect();

    // === ERROR CHECKS ===

    // E001: Check for required sections
    check_required_sections(tugplan, &mut result);

    // E002: Check for required metadata fields
    check_required_metadata(tugplan, &mut result);

    // E003: Check metadata Status value
    check_metadata_status(tugplan, &mut result);

    // E004: Check steps have References line
    check_step_references(tugplan, &mut result);

    // E005: Check anchor format
    check_anchor_format(tugplan, &mut result);

    // E006: Check for duplicate anchors
    check_duplicate_anchors(tugplan, &mut result);

    // E010: Check dependency references
    check_dependency_references(tugplan, &anchor_map, &mut result);

    // E011: Check for circular dependencies
    check_circular_dependencies(tugplan, &mut result);

    // E017: Check **Depends on:** format (must use anchor refs like #step-N)
    check_depends_on_format(tugplan, &mut result);

    // E018: Check **References:** format (must have [DNN] decision citations)
    check_references_format(tugplan, &mut result);

    // === WARNING CHECKS ===
    if config.level.include_warnings() {
        // W001: Decisions without DECIDED/OPEN status
        check_decision_status(tugplan, &mut result);

        // W002: Questions without resolution status
        check_question_resolution(tugplan, &mut result);

        // W003: Steps without checkpoint items
        check_step_checkpoints(tugplan, &mut result);

        // W004: Steps without test items
        check_step_tests(tugplan, &mut result);

        // W005: References citing non-existent anchors (superseded by W013)
        // check_reference_anchors(tugplan, &anchor_map, &mut result);

        // W006: Metadata fields with unfilled placeholders
        check_metadata_placeholders(tugplan, &mut result);

        // W007: Step (other than Step 0) has no dependencies
        check_step_dependencies(tugplan, &mut result);

        // W009: Step missing Commit line
        check_commit_lines(tugplan, &mut result);

        // W010: Step missing Tasks
        check_step_tasks(tugplan, &mut result);

        // W011: Decision defined but never cited
        check_uncited_decisions(tugplan, &mut result);

        // W012: Decision cited but not defined
        check_undefined_cited_decisions(tugplan, &mut result);

        // W013: Anchor referenced but not defined (replaces W005)
        check_undefined_referenced_anchors(tugplan, &anchor_map, &mut result);
    }

    // === INFO CHECKS ===
    if config.level.include_info() {
        // I001: Document exceeds recommended size (2000+ lines)
        check_document_size(tugplan, &mut result);

        // I002: Deep dive sections exceed 50% of document
        // Note: This would require parsing deep dive sections, which we don't currently track
        // Skipping for now as it's informational
    }

    // Copy parse diagnostics from plan (filtered by validation level)
    if config.level.include_warnings() {
        result.diagnostics = tugplan.diagnostics.clone();
    }

    result
}

// === ERROR CHECK IMPLEMENTATIONS ===

/// E001: Check for required sections
fn check_required_sections(tugplan: &TugPlan, result: &mut ValidationResult) {
    let anchor_names: HashSet<&str> = tugplan
        .anchors
        .iter()
        .filter(|a| !a.name.contains("(duplicate)"))
        .map(|a| a.name.as_str())
        .collect();

    let required_sections = [
        ("plan-metadata", "TugPlan Metadata"),
        ("phase-overview", "Phase Overview"),
        ("design-decisions", "Design Decisions"),
        ("execution-steps", "Execution Steps"),
        ("deliverables", "Deliverables"),
    ];

    for (anchor, name) in required_sections {
        // Check if section exists by looking for the anchor or a variant
        let has_section = anchor_names.contains(anchor)
            || anchor_names
                .iter()
                .any(|a| a.ends_with(&format!("-{}", anchor)))
            || (anchor == "execution-steps" && !tugplan.steps.is_empty());

        if !has_section {
            result.add_issue(ValidationIssue::new(
                "E001",
                Severity::Error,
                format!("Missing required section: {}", name),
            ));
        }
    }
}

/// E002: Check for required metadata fields
fn check_required_metadata(tugplan: &TugPlan, result: &mut ValidationResult) {
    // Required fields: Owner, Status, Last updated
    if tugplan.metadata.owner.is_none() {
        result.add_issue(ValidationIssue::new(
            "E002",
            Severity::Error,
            "Missing or empty required metadata field: Owner".to_string(),
        ));
    }

    if tugplan.metadata.status.is_none() {
        result.add_issue(ValidationIssue::new(
            "E002",
            Severity::Error,
            "Missing or empty required metadata field: Status".to_string(),
        ));
    }

    if tugplan.metadata.last_updated.is_none() {
        result.add_issue(ValidationIssue::new(
            "E002",
            Severity::Error,
            "Missing or empty required metadata field: Last updated".to_string(),
        ));
    }
}

/// E003: Check metadata Status value
fn check_metadata_status(tugplan: &TugPlan, result: &mut ValidationResult) {
    if let Some(status) = &tugplan.metadata.status {
        if !tugplan.metadata.is_valid_status() {
            result.add_issue(ValidationIssue::new(
                "E003",
                Severity::Error,
                format!(
                    "Invalid metadata Status value: {} (must be draft/active/done)",
                    status
                ),
            ));
        }
    }
}

/// E004: Check steps have References line
fn check_step_references(tugplan: &TugPlan, result: &mut ValidationResult) {
    for step in &tugplan.steps {
        if step.references.is_none() {
            result.add_issue(
                ValidationIssue::new(
                    "E004",
                    Severity::Error,
                    format!("Step {} missing References line", step.number),
                )
                .at_line(step.line)
                .with_anchor(&step.anchor),
            );
        }

        // Also check substeps
        for substep in &step.substeps {
            if substep.references.is_none() {
                result.add_issue(
                    ValidationIssue::new(
                        "E004",
                        Severity::Error,
                        format!("Step {} missing References line", substep.number),
                    )
                    .at_line(substep.line)
                    .with_anchor(&substep.anchor),
                );
            }
        }
    }
}

/// E005: Check anchor format (only a-z, 0-9, - allowed)
fn check_anchor_format(tugplan: &TugPlan, result: &mut ValidationResult) {
    for anchor in &tugplan.anchors {
        // Skip duplicate markers
        if anchor.name.contains("(duplicate)") {
            continue;
        }

        if !VALID_ANCHOR.is_match(&anchor.name) {
            result.add_issue(
                ValidationIssue::new(
                    "E005",
                    Severity::Error,
                    format!("Invalid anchor format: {{{}}}", anchor.name),
                )
                .at_line(anchor.line),
            );
        }
    }
}

/// E006: Check for duplicate anchors
fn check_duplicate_anchors(tugplan: &TugPlan, result: &mut ValidationResult) {
    let mut seen: HashMap<&str, usize> = HashMap::new();

    for anchor in &tugplan.anchors {
        // Extract original name from "(duplicate)" marker
        let name = if anchor.name.contains("(duplicate)") {
            anchor
                .name
                .split(" (duplicate)")
                .next()
                .unwrap_or(&anchor.name)
        } else {
            &anchor.name
        };

        if let Some(&first_line) = seen.get(name) {
            result.add_issue(
                ValidationIssue::new(
                    "E006",
                    Severity::Error,
                    format!("Duplicate anchor: {}", name),
                )
                .at_line(anchor.line)
                .with_anchor(name),
            );
            // Add note about first occurrence
            result.issues.last_mut().unwrap().message =
                format!("Duplicate anchor: {} (first at line {})", name, first_line);
        } else {
            seen.insert(name, anchor.line);
        }
    }
}

/// E010: Check dependency references point to existing step anchors
fn check_dependency_references(
    tugplan: &TugPlan,
    anchor_map: &HashMap<String, usize>,
    result: &mut ValidationResult,
) {
    // Collect all step anchors
    let step_anchors: HashSet<&str> = tugplan
        .steps
        .iter()
        .flat_map(|s| {
            std::iter::once(s.anchor.as_str()).chain(s.substeps.iter().map(|ss| ss.anchor.as_str()))
        })
        .collect();

    for step in &tugplan.steps {
        for dep in &step.depends_on {
            if !step_anchors.contains(dep.as_str()) && !anchor_map.contains_key(dep) {
                result.add_issue(
                    ValidationIssue::new(
                        "E010",
                        Severity::Error,
                        format!("Dependency references non-existent step anchor: {}", dep),
                    )
                    .at_line(step.line)
                    .with_anchor(&step.anchor),
                );
            }
        }

        for substep in &step.substeps {
            for dep in &substep.depends_on {
                if !step_anchors.contains(dep.as_str()) && !anchor_map.contains_key(dep) {
                    result.add_issue(
                        ValidationIssue::new(
                            "E010",
                            Severity::Error,
                            format!("Dependency references non-existent step anchor: {}", dep),
                        )
                        .at_line(substep.line)
                        .with_anchor(&substep.anchor),
                    );
                }
            }
        }
    }
}

/// E011: Check for circular dependencies using DFS
fn check_circular_dependencies(tugplan: &TugPlan, result: &mut ValidationResult) {
    // Build dependency graph
    let mut deps: HashMap<&str, Vec<&str>> = HashMap::new();

    for step in &tugplan.steps {
        deps.insert(
            step.anchor.as_str(),
            step.depends_on.iter().map(|s| s.as_str()).collect(),
        );

        for substep in &step.substeps {
            deps.insert(
                substep.anchor.as_str(),
                substep.depends_on.iter().map(|s| s.as_str()).collect(),
            );
        }
    }

    // DFS to detect cycles
    let mut visited: HashSet<&str> = HashSet::new();
    let mut rec_stack: HashSet<&str> = HashSet::new();
    let mut path: Vec<&str> = Vec::new();

    for start in deps.keys() {
        if !visited.contains(start) {
            if let Some(cycle) = detect_cycle(start, &deps, &mut visited, &mut rec_stack, &mut path)
            {
                result.add_issue(ValidationIssue::new(
                    "E011",
                    Severity::Error,
                    format!("Circular dependency detected: {}", cycle),
                ));
            }
        }
    }
}

/// Helper for cycle detection
fn detect_cycle<'a>(
    node: &'a str,
    deps: &HashMap<&'a str, Vec<&'a str>>,
    visited: &mut HashSet<&'a str>,
    rec_stack: &mut HashSet<&'a str>,
    path: &mut Vec<&'a str>,
) -> Option<String> {
    visited.insert(node);
    rec_stack.insert(node);
    path.push(node);

    if let Some(neighbors) = deps.get(node) {
        for &neighbor in neighbors {
            if !visited.contains(neighbor) {
                if let Some(cycle) = detect_cycle(neighbor, deps, visited, rec_stack, path) {
                    return Some(cycle);
                }
            } else if rec_stack.contains(neighbor) {
                // Found a cycle - construct cycle string
                let cycle_start = path.iter().position(|&n| n == neighbor).unwrap();
                let cycle_nodes: Vec<&str> = path[cycle_start..].to_vec();
                return Some(format!("{} -> {}", cycle_nodes.join(" -> "), neighbor));
            }
        }
    }

    path.pop();
    rec_stack.remove(node);
    None
}

/// E017: Check **Depends on:** format
/// Must use anchor references like #step-0, not prose like "Step 0"
fn check_depends_on_format(tugplan: &TugPlan, result: &mut ValidationResult) {
    for step in &tugplan.steps {
        // Check if step has dependencies declared but in wrong format
        if !step.depends_on.is_empty() {
            // Dependencies should be anchor refs - check if any look like prose
            for dep in &step.depends_on {
                // Valid: "step-0", "step-1-2"
                // Invalid: "Step 0", "step 0", etc.
                if !dep.starts_with("step-") && !dep.contains('-') {
                    result.add_issue(
                        ValidationIssue::new(
                            "E017",
                            Severity::Error,
                            format!(
                                "Invalid dependency format: '{}' (must be anchor ref like 'step-0', not prose)",
                                dep
                            ),
                        )
                        .at_line(step.line)
                        .with_anchor(&step.anchor),
                    );
                }
            }
        }

        // Also check substeps
        for substep in &step.substeps {
            for dep in &substep.depends_on {
                if !dep.starts_with("step-") && !dep.contains('-') {
                    result.add_issue(
                        ValidationIssue::new(
                            "E017",
                            Severity::Error,
                            format!(
                                "Invalid dependency format: '{}' (must be anchor ref like 'step-0', not prose)",
                                dep
                            ),
                        )
                        .at_line(substep.line)
                        .with_anchor(&substep.anchor),
                    );
                }
            }
        }
    }
}

/// E018: Check **References:** format
/// Must contain decision citations in [DNN] format (e.g., [D01], [D02])
fn check_references_format(tugplan: &TugPlan, result: &mut ValidationResult) {
    for step in &tugplan.steps {
        if let Some(refs) = &step.references {
            // Check for decision citations [DNN]
            let has_decision_citation = DECISION_CITATION.is_match(refs);

            // Check for anchor citations (#anchor) in parentheses
            let has_anchor_citation = ANCHOR_CITATION.is_match(refs);

            // Check for vague references
            let is_vague = refs.to_lowercase().contains("see above")
                || refs.to_lowercase().contains("n/a")
                || refs.to_lowercase().contains("see below")
                || refs.to_lowercase().contains("see design")
                || refs.trim().is_empty();

            // References should have decision citations OR anchor citations, not be vague
            if is_vague && !has_decision_citation && !has_anchor_citation {
                result.add_issue(
                    ValidationIssue::new(
                        "E018",
                        Severity::Error,
                        format!(
                            "Step {} has vague References '{}' (must cite [DNN] decisions or (#anchor) refs)",
                            step.number, refs
                        ),
                    )
                    .at_line(step.line)
                    .with_anchor(&step.anchor),
                );
            }

            // Check for prose-style dependency mentions in References (should be in Depends on)
            if PROSE_DEPENDENCY.is_match(refs) && !has_decision_citation {
                result.add_issue(
                    ValidationIssue::new(
                        "E018",
                        Severity::Error,
                        format!(
                            "Step {} References contains prose step reference '{}' (use [DNN] format for decisions, (#anchor) for section refs)",
                            step.number, refs
                        ),
                    )
                    .at_line(step.line)
                    .with_anchor(&step.anchor),
                );
            }
        }

        // Also check substeps
        for substep in &step.substeps {
            if let Some(refs) = &substep.references {
                let has_decision_citation = DECISION_CITATION.is_match(refs);
                let has_anchor_citation = ANCHOR_CITATION.is_match(refs);
                let is_vague = refs.to_lowercase().contains("see above")
                    || refs.to_lowercase().contains("n/a")
                    || refs.to_lowercase().contains("see below")
                    || refs.trim().is_empty();

                if is_vague && !has_decision_citation && !has_anchor_citation {
                    result.add_issue(
                        ValidationIssue::new(
                            "E018",
                            Severity::Error,
                            format!(
                                "Step {} has vague References '{}' (must cite [DNN] decisions or (#anchor) refs)",
                                substep.number, refs
                            ),
                        )
                        .at_line(substep.line)
                        .with_anchor(&substep.anchor),
                    );
                }
            }
        }
    }
}

// === WARNING CHECK IMPLEMENTATIONS ===

/// W001: Decisions without DECIDED/OPEN status
fn check_decision_status(tugplan: &TugPlan, result: &mut ValidationResult) {
    for decision in &tugplan.decisions {
        if decision.status.is_none() {
            result.add_issue(
                ValidationIssue::new(
                    "W001",
                    Severity::Warning,
                    format!("Decision {} missing status", decision.id),
                )
                .at_line(decision.line),
            );
        }
    }
}

/// W002: Questions without resolution status
fn check_question_resolution(tugplan: &TugPlan, result: &mut ValidationResult) {
    for question in &tugplan.questions {
        if question.resolution.is_none() {
            result.add_issue(
                ValidationIssue::new(
                    "W002",
                    Severity::Warning,
                    format!("Question {} missing resolution", question.id),
                )
                .at_line(question.line),
            );
        }
    }
}

/// W003: Steps without checkpoint items
fn check_step_checkpoints(tugplan: &TugPlan, result: &mut ValidationResult) {
    for step in &tugplan.steps {
        if step.checkpoints.is_empty() {
            result.add_issue(
                ValidationIssue::new(
                    "W003",
                    Severity::Warning,
                    format!("Step {} has no checkpoint items", step.number),
                )
                .at_line(step.line)
                .with_anchor(&step.anchor),
            );
        }
    }
}

/// W004: Steps without test items
fn check_step_tests(tugplan: &TugPlan, result: &mut ValidationResult) {
    for step in &tugplan.steps {
        if step.tests.is_empty() {
            result.add_issue(
                ValidationIssue::new(
                    "W004",
                    Severity::Warning,
                    format!("Step {} has no test items", step.number),
                )
                .at_line(step.line)
                .with_anchor(&step.anchor),
            );
        }
    }
}

/// W005: References citing non-existent anchors
/// W005: References citing non-existent anchors (superseded by W013 check_undefined_referenced_anchors)
/// This function is kept for backwards compatibility but is no longer called.
/// W013 expands W005 to cover substeps which were previously missed.
#[allow(dead_code)]
fn check_reference_anchors(
    tugplan: &TugPlan,
    anchor_map: &HashMap<String, usize>,
    result: &mut ValidationResult,
) {
    let anchor_ref_pattern = Regex::new(r"#([a-z0-9-]+)").unwrap();

    for step in &tugplan.steps {
        if let Some(refs) = &step.references {
            for cap in anchor_ref_pattern.captures_iter(refs) {
                let ref_anchor = cap.get(1).unwrap().as_str();
                if !anchor_map.contains_key(ref_anchor) {
                    result.add_issue(
                        ValidationIssue::new(
                            "W005",
                            Severity::Warning,
                            format!("Reference to non-existent anchor: #{}", ref_anchor),
                        )
                        .at_line(step.line)
                        .with_anchor(&step.anchor),
                    );
                }
            }
        }
    }
}

/// W006: Metadata fields with unfilled placeholders
fn check_metadata_placeholders(tugplan: &TugPlan, result: &mut ValidationResult) {
    let fields = [
        ("Owner", &tugplan.metadata.owner),
        ("Status", &tugplan.metadata.status),
        ("Target branch", &tugplan.metadata.target_branch),
        ("Tracking issue/PR", &tugplan.metadata.tracking),
        ("Last updated", &tugplan.metadata.last_updated),
    ];

    for (name, value) in fields {
        if let Some(v) = value {
            if PLACEHOLDER_PATTERN.is_match(v) {
                result.add_issue(ValidationIssue::new(
                    "W006",
                    Severity::Warning,
                    format!("Unfilled placeholder in metadata: {} contains {}", name, v),
                ));
            }
        }
    }
}

/// W007: Step (other than Step 0) has no dependencies
fn check_step_dependencies(tugplan: &TugPlan, result: &mut ValidationResult) {
    for step in &tugplan.steps {
        // Step 0 is allowed to have no dependencies
        if step.number != "0" && step.depends_on.is_empty() {
            result.add_issue(
                ValidationIssue::new(
                    "W007",
                    Severity::Warning,
                    format!("Step {} has no dependencies", step.number),
                )
                .at_line(step.line)
                .with_anchor(&step.anchor),
            );
        }
    }
}

/// W009: Step missing Commit line
fn check_commit_lines(tugplan: &TugPlan, result: &mut ValidationResult) {
    for step in &tugplan.steps {
        if step.commit_message.is_none() {
            result.add_issue(
                ValidationIssue::new(
                    "W009",
                    Severity::Warning,
                    format!("Step {} missing **Commit:** line", step.number),
                )
                .at_line(step.line)
                .with_anchor(&step.anchor),
            );
        }

        for substep in &step.substeps {
            if substep.commit_message.is_none() {
                result.add_issue(
                    ValidationIssue::new(
                        "W009",
                        Severity::Warning,
                        format!("Step {} missing **Commit:** line", substep.number),
                    )
                    .at_line(substep.line)
                    .with_anchor(&substep.anchor),
                );
            }
        }
    }
}

/// W010: Step missing Tasks
fn check_step_tasks(tugplan: &TugPlan, result: &mut ValidationResult) {
    for step in &tugplan.steps {
        if step.tasks.is_empty() {
            result.add_issue(
                ValidationIssue::new(
                    "W010",
                    Severity::Warning,
                    format!("Step {} has no task items", step.number),
                )
                .at_line(step.line)
                .with_anchor(&step.anchor),
            );
        }

        for substep in &step.substeps {
            if substep.tasks.is_empty() {
                result.add_issue(
                    ValidationIssue::new(
                        "W010",
                        Severity::Warning,
                        format!("Step {} has no task items", substep.number),
                    )
                    .at_line(substep.line)
                    .with_anchor(&substep.anchor),
                );
            }
        }
    }
}

/// W011: Decision defined but never cited
fn check_uncited_decisions(tugplan: &TugPlan, result: &mut ValidationResult) {
    // Collect all DECIDED decisions (ignore OPEN/DEFERRED)
    let decided_decisions: Vec<&crate::types::Decision> = tugplan
        .decisions
        .iter()
        .filter(|d| {
            d.status
                .as_ref()
                .map(|s| s != "OPEN" && s != "DEFERRED")
                .unwrap_or(true) // No status means it should be cited
        })
        .collect();

    // Collect all cited decision IDs from References lines
    let mut cited_ids = HashSet::new();
    for step in &tugplan.steps {
        if let Some(refs) = &step.references {
            for cap in DECISION_ID_CAPTURE.captures_iter(refs) {
                cited_ids.insert(cap.get(1).unwrap().as_str().to_string());
            }
        }

        for substep in &step.substeps {
            if let Some(refs) = &substep.references {
                for cap in DECISION_ID_CAPTURE.captures_iter(refs) {
                    cited_ids.insert(cap.get(1).unwrap().as_str().to_string());
                }
            }
        }
    }

    // Emit W011 for decisions never cited
    for decision in decided_decisions {
        if !cited_ids.contains(&decision.id) {
            result.add_issue(
                ValidationIssue::new(
                    "W011",
                    Severity::Warning,
                    format!(
                        "Decision [{}] ({}) is never cited in any step References",
                        decision.id, decision.title
                    ),
                )
                .at_line(decision.line)
                .with_anchor(decision.anchor.as_deref().unwrap_or("")),
            );
        }
    }
}

/// W012: Decision cited but not defined
fn check_undefined_cited_decisions(tugplan: &TugPlan, result: &mut ValidationResult) {
    // Build set of all defined decision IDs
    let defined_ids: HashSet<String> = tugplan.decisions.iter().map(|d| d.id.clone()).collect();

    // Check all cited decision IDs
    for step in &tugplan.steps {
        if let Some(refs) = &step.references {
            for cap in DECISION_ID_CAPTURE.captures_iter(refs) {
                let cited_id = cap.get(1).unwrap().as_str();
                if !defined_ids.contains(cited_id) {
                    result.add_issue(
                        ValidationIssue::new(
                            "W012",
                            Severity::Warning,
                            format!(
                                "Step {} references decision [{}] which is not defined",
                                step.number, cited_id
                            ),
                        )
                        .at_line(step.line)
                        .with_anchor(&step.anchor),
                    );
                }
            }
        }

        for substep in &step.substeps {
            if let Some(refs) = &substep.references {
                for cap in DECISION_ID_CAPTURE.captures_iter(refs) {
                    let cited_id = cap.get(1).unwrap().as_str();
                    if !defined_ids.contains(cited_id) {
                        result.add_issue(
                            ValidationIssue::new(
                                "W012",
                                Severity::Warning,
                                format!(
                                    "Step {} references decision [{}] which is not defined",
                                    substep.number, cited_id
                                ),
                            )
                            .at_line(substep.line)
                            .with_anchor(&substep.anchor),
                        );
                    }
                }
            }
        }
    }
}

/// W013: Anchor referenced but not defined (replaces W005)
/// Checks References lines only (not Depends on - those are E010)
fn check_undefined_referenced_anchors(
    tugplan: &TugPlan,
    anchor_map: &HashMap<String, usize>,
    result: &mut ValidationResult,
) {
    let anchor_ref_pattern = Regex::new(r"#([a-z0-9-]+)").unwrap();

    for step in &tugplan.steps {
        if let Some(refs) = &step.references {
            for cap in anchor_ref_pattern.captures_iter(refs) {
                let ref_anchor = cap.get(1).unwrap().as_str();
                if !anchor_map.contains_key(ref_anchor) {
                    result.add_issue(
                        ValidationIssue::new(
                            "W013",
                            Severity::Warning,
                            format!("Reference to non-existent anchor: #{}", ref_anchor),
                        )
                        .at_line(step.line)
                        .with_anchor(&step.anchor),
                    );
                }
            }
        }

        // Check substeps (this was missing in W005)
        for substep in &step.substeps {
            if let Some(refs) = &substep.references {
                for cap in anchor_ref_pattern.captures_iter(refs) {
                    let ref_anchor = cap.get(1).unwrap().as_str();
                    if !anchor_map.contains_key(ref_anchor) {
                        result.add_issue(
                            ValidationIssue::new(
                                "W013",
                                Severity::Warning,
                                format!("Reference to non-existent anchor: #{}", ref_anchor),
                            )
                            .at_line(substep.line)
                            .with_anchor(&substep.anchor),
                        );
                    }
                }
            }
        }
    }
}

// === INFO CHECK IMPLEMENTATIONS ===

/// I001: Document exceeds recommended size (2000+ lines)
fn check_document_size(tugplan: &TugPlan, result: &mut ValidationResult) {
    let line_count = tugplan.raw_content.lines().count();
    if line_count >= 2000 {
        result.add_issue(ValidationIssue::new(
            "I001",
            Severity::Info,
            format!("Document exceeds recommended size ({} lines)", line_count),
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::parse_tugplan;

    #[test]
    fn test_validate_minimal_valid_plan() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test Owner |
| Status | draft |
| Target branch | main |
| Last updated | 2026-02-03 |

### Phase Overview {#phase-overview}

Overview text.

### Design Decisions {#design-decisions}

#### [D01] Test Decision (DECIDED) {#d01-test}

Decision text.

### 1.0.5 Execution Steps {#execution-steps}

#### Step 0: Bootstrap {#step-0}

**References:** [D01] Test decision

**Tasks:**
- [ ] Task one

**Tests:**
- [ ] Test one

**Checkpoint:**
- [ ] Check one

### Deliverables {#deliverables}

Deliverable text.
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        assert!(
            result.valid,
            "Expected valid plan, got issues: {:?}",
            result.issues
        );
    }

    #[test]
    fn test_e001_missing_section() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test Owner |
| Status | draft |
| Last updated | 2026-02-03 |

### 1.0.5 Execution Steps {#execution-steps}

#### Step 0: Test {#step-0}

**References:** Test

**Tasks:**
- [ ] Task
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        assert!(!result.valid);
        let e001_issues: Vec<_> = result.issues.iter().filter(|i| i.code == "E001").collect();
        assert!(
            !e001_issues.is_empty(),
            "Expected E001 errors for missing sections"
        );
    }

    #[test]
    fn test_e002_missing_metadata() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | |
| Status | draft |
| Last updated | 2026-02-03 |
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let e002_issues: Vec<_> = result.issues.iter().filter(|i| i.code == "E002").collect();
        assert!(
            !e002_issues.is_empty(),
            "Expected E002 error for missing Owner"
        );
    }

    #[test]
    fn test_e003_invalid_status() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | invalid |
| Last updated | 2026-02-03 |
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let e003_issues: Vec<_> = result.issues.iter().filter(|i| i.code == "E003").collect();
        assert_eq!(e003_issues.len(), 1);
        assert!(e003_issues[0].message.contains("invalid"));
    }

    #[test]
    fn test_e004_missing_references() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | draft |
| Last updated | 2026-02-03 |

#### Step 0: Test {#step-0}

**Tasks:**
- [ ] Task without references
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let e004_issues: Vec<_> = result.issues.iter().filter(|i| i.code == "E004").collect();
        assert_eq!(e004_issues.len(), 1);
    }

    #[test]
    fn test_e006_duplicate_anchors() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Section One {#duplicate-anchor}

### Section Two {#duplicate-anchor}
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let e006_issues: Vec<_> = result.issues.iter().filter(|i| i.code == "E006").collect();
        assert_eq!(e006_issues.len(), 1);
    }

    #[test]
    fn test_e010_invalid_dependency() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | draft |
| Last updated | 2026-02-03 |

#### Step 0: First {#step-0}

**References:** Test

**Tasks:**
- [ ] Task

#### Step 1: Second {#step-1}

**Depends on:** #nonexistent-step

**References:** Test

**Tasks:**
- [ ] Task
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let e010_issues: Vec<_> = result.issues.iter().filter(|i| i.code == "E010").collect();
        assert_eq!(e010_issues.len(), 1);
        assert!(e010_issues[0].message.contains("nonexistent-step"));
    }

    #[test]
    fn test_e011_circular_dependency() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | draft |
| Last updated | 2026-02-03 |

#### Step 1: First {#step-1}

**Depends on:** #step-2

**References:** Test

**Tasks:**
- [ ] Task

#### Step 2: Second {#step-2}

**Depends on:** #step-1

**References:** Test

**Tasks:**
- [ ] Task
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let e011_issues: Vec<_> = result.issues.iter().filter(|i| i.code == "E011").collect();
        assert_eq!(e011_issues.len(), 1);
        assert!(e011_issues[0].message.contains("Circular dependency"));
    }

    #[test]
    fn test_w001_decision_missing_status() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | draft |
| Last updated | 2026-02-03 |

### Design Decisions {#design-decisions}

#### [D01] Test Decision {#d01-test}

Decision without status.
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let w001_issues: Vec<_> = result.issues.iter().filter(|i| i.code == "W001").collect();
        assert_eq!(w001_issues.len(), 1);
    }

    #[test]
    fn test_w002_question_missing_resolution() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | draft |
| Last updated | 2026-02-03 |

### Open Questions {#open-questions}

#### [Q01] Test Question {#q01-test}

Question without resolution.
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let w002_issues: Vec<_> = result.issues.iter().filter(|i| i.code == "W002").collect();
        assert_eq!(w002_issues.len(), 1);
    }

    #[test]
    fn test_w003_step_missing_checkpoints() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | draft |
| Last updated | 2026-02-03 |

#### Step 0: Test {#step-0}

**References:** Test

**Tasks:**
- [ ] Task only, no checkpoint
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let w003_issues: Vec<_> = result.issues.iter().filter(|i| i.code == "W003").collect();
        assert_eq!(w003_issues.len(), 1);
    }

    #[test]
    fn test_w004_step_missing_tests() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | draft |
| Last updated | 2026-02-03 |

#### Step 0: Test {#step-0}

**References:** Test

**Tasks:**
- [ ] Task only, no tests
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let w004_issues: Vec<_> = result.issues.iter().filter(|i| i.code == "W004").collect();
        assert_eq!(w004_issues.len(), 1);
    }

    #[test]
    fn test_w006_placeholder_in_metadata() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | <your name> |
| Status | draft |
| Last updated | 2026-02-03 |
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let w006_issues: Vec<_> = result.issues.iter().filter(|i| i.code == "W006").collect();
        assert_eq!(w006_issues.len(), 1);
        assert!(w006_issues[0].message.contains("<your name>"));
    }

    #[test]
    fn test_w007_step_no_dependencies() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | draft |
| Last updated | 2026-02-03 |

#### Step 0: First {#step-0}

**References:** Test

**Tasks:**
- [ ] Task

#### Step 1: Second no deps {#step-1}

**References:** Test

**Tasks:**
- [ ] Task without depends on
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let w007_issues: Vec<_> = result.issues.iter().filter(|i| i.code == "W007").collect();
        assert_eq!(w007_issues.len(), 1);
        assert!(w007_issues[0].message.contains("Step 1"));
    }

    #[test]
    fn test_i001_document_size() {
        // Create a plan with 2000+ lines
        let mut content = String::from(
            r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | draft |
| Last updated | 2026-02-03 |

"#,
        );

        for i in 0..2000 {
            content.push_str(&format!("Line {}\n", i));
        }

        let plan = parse_tugplan(&content).unwrap();
        let config = ValidationConfig {
            level: ValidationLevel::Strict,
            ..Default::default()
        };
        let result = validate_tugplan_with_config(&plan, &config);

        let i001_issues: Vec<_> = result.issues.iter().filter(|i| i.code == "I001").collect();
        assert_eq!(i001_issues.len(), 1);
    }

    #[test]
    fn test_validation_levels() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | draft |
| Last updated | 2026-02-03 |

#### Step 0: Test {#step-0}

**References:** Test

**Tasks:**
- [ ] Task only
"#;

        let plan = parse_tugplan(content).unwrap();

        // Lenient: Only errors
        let lenient_config = ValidationConfig {
            level: ValidationLevel::Lenient,
            ..Default::default()
        };
        let lenient_result = validate_tugplan_with_config(&plan, &lenient_config);
        let lenient_warnings: Vec<_> = lenient_result
            .issues
            .iter()
            .filter(|i| i.severity == Severity::Warning)
            .collect();
        assert!(
            lenient_warnings.is_empty(),
            "Lenient should not include warnings"
        );

        // Normal: Errors + warnings
        let normal_config = ValidationConfig {
            level: ValidationLevel::Normal,
            ..Default::default()
        };
        let normal_result = validate_tugplan_with_config(&plan, &normal_config);
        let normal_warnings: Vec<_> = normal_result
            .issues
            .iter()
            .filter(|i| i.severity == Severity::Warning)
            .collect();
        assert!(
            !normal_warnings.is_empty(),
            "Normal should include warnings"
        );
    }

    #[test]
    fn test_validation_result_counts() {
        let mut result = ValidationResult::new();

        result.add_issue(ValidationIssue::new(
            "E001",
            Severity::Error,
            "Error 1".to_string(),
        ));
        result.add_issue(ValidationIssue::new(
            "E002",
            Severity::Error,
            "Error 2".to_string(),
        ));
        result.add_issue(ValidationIssue::new(
            "W001",
            Severity::Warning,
            "Warning 1".to_string(),
        ));
        result.add_issue(ValidationIssue::new(
            "I001",
            Severity::Info,
            "Info 1".to_string(),
        ));

        assert_eq!(result.error_count(), 2);
        assert_eq!(result.warning_count(), 1);
        assert_eq!(result.info_count(), 1);
        assert!(!result.valid);
    }

    #[test]
    fn test_e018_vague_references() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | draft |
| Last updated | 2026-02-03 |

#### Step 0: Test {#step-0}

**References:** See above

**Tasks:**
- [ ] Task
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let e018_issues: Vec<_> = result.issues.iter().filter(|i| i.code == "E018").collect();
        assert_eq!(
            e018_issues.len(),
            1,
            "Expected E018 error for vague reference"
        );
        assert!(e018_issues[0].message.contains("vague"));
    }

    #[test]
    fn test_e018_valid_references() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | draft |
| Last updated | 2026-02-03 |

### Design Decisions {#design-decisions}

#### [D01] Test Decision (DECIDED) {#d01-test}

Decision text.

#### Step 0: Test {#step-0}

**References:** [D01] Test Decision, (#context, #strategy)

**Tasks:**
- [ ] Task

**Checkpoint:**
- [ ] Check
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let e018_issues: Vec<_> = result.issues.iter().filter(|i| i.code == "E018").collect();
        assert!(
            e018_issues.is_empty(),
            "Expected no E018 errors for valid references: {:?}",
            e018_issues
        );
    }

    #[test]
    fn test_decision_citation_regex() {
        assert!(DECISION_CITATION.is_match("[D01] Test"));
        assert!(DECISION_CITATION.is_match("[D99] Another"));
        assert!(DECISION_CITATION.is_match("Some text [D01] more text"));
        assert!(!DECISION_CITATION.is_match("D01 Test")); // Missing brackets
        assert!(!DECISION_CITATION.is_match("[D1] Test")); // Single digit
    }

    #[test]
    fn test_anchor_citation_regex() {
        assert!(ANCHOR_CITATION.is_match("(#context)"));
        assert!(ANCHOR_CITATION.is_match("(#context, #strategy)"));
        assert!(ANCHOR_CITATION.is_match("(#step-0, #step-1, #step-2)"));
        assert!(!ANCHOR_CITATION.is_match("#context")); // Missing parens
        assert!(!ANCHOR_CITATION.is_match("(context)")); // Missing #
    }

    // W009 tests
    #[test]
    fn test_w009_missing_commit() {
        use crate::parser::parse_tugplan;

        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### Step 0: Test {#step-0}

**Tasks:**
- [ ] Task one
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let w009_issues: Vec<&ValidationIssue> =
            result.issues.iter().filter(|i| i.code == "W009").collect();
        assert_eq!(w009_issues.len(), 1);
        assert!(w009_issues[0].message.contains("Step 0"));
    }

    #[test]
    fn test_w009_with_commit_no_warning() {
        use crate::parser::parse_tugplan;

        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

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

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let w009_issues: Vec<&ValidationIssue> =
            result.issues.iter().filter(|i| i.code == "W009").collect();
        assert_eq!(w009_issues.len(), 0);
    }

    // W010 tests
    #[test]
    fn test_w010_missing_tasks() {
        use crate::parser::parse_tugplan;

        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### Step 0: Test {#step-0}

**Commit:** `feat: add feature`
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let w010_issues: Vec<&ValidationIssue> =
            result.issues.iter().filter(|i| i.code == "W010").collect();
        assert_eq!(w010_issues.len(), 1);
        assert!(w010_issues[0].message.contains("Step 0"));
    }

    #[test]
    fn test_w010_with_tasks_no_warning() {
        use crate::parser::parse_tugplan;

        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

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

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let w010_issues: Vec<&ValidationIssue> =
            result.issues.iter().filter(|i| i.code == "W010").collect();
        assert_eq!(w010_issues.len(), 0);
    }

    // W011 tests
    #[test]
    fn test_w011_uncited_decided_decision() {
        use crate::parser::parse_tugplan;

        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

### Design Decisions {#design-decisions}

#### [D01] Decision One (DECIDED) {#d01-one}

This is decided but never cited.

#### Step 0: Test {#step-0}

**Commit:** `feat: add feature`

**References:** (#context)

**Tasks:**
- [ ] Task one
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let w011_issues: Vec<&ValidationIssue> =
            result.issues.iter().filter(|i| i.code == "W011").collect();
        assert_eq!(w011_issues.len(), 1);
        assert!(w011_issues[0].message.contains("[D01]"));
    }

    #[test]
    fn test_w011_open_decision_no_warning() {
        use crate::parser::parse_tugplan;

        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

### Design Decisions {#design-decisions}

#### [D01] Decision One (OPEN) {#d01-one}

This is open, so not required to be cited.

#### Step 0: Test {#step-0}

**Commit:** `feat: add feature`

**References:** (#context)

**Tasks:**
- [ ] Task one
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let w011_issues: Vec<&ValidationIssue> =
            result.issues.iter().filter(|i| i.code == "W011").collect();
        assert_eq!(w011_issues.len(), 0);
    }

    #[test]
    fn test_w011_deferred_decision_no_warning() {
        use crate::parser::parse_tugplan;

        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

### Design Decisions {#design-decisions}

#### [D01] Decision One (DEFERRED) {#d01-one}

This is deferred, so not required to be cited.

#### Step 0: Test {#step-0}

**Commit:** `feat: add feature`

**References:** (#context)

**Tasks:**
- [ ] Task one
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let w011_issues: Vec<&ValidationIssue> =
            result.issues.iter().filter(|i| i.code == "W011").collect();
        assert_eq!(w011_issues.len(), 0);
    }

    // W012 tests
    #[test]
    fn test_w012_undefined_cited_decision() {
        use crate::parser::parse_tugplan;

        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### Step 0: Test {#step-0}

**Commit:** `feat: add feature`

**References:** [D03] Nonexistent decision

**Tasks:**
- [ ] Task one
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let w012_issues: Vec<&ValidationIssue> =
            result.issues.iter().filter(|i| i.code == "W012").collect();
        assert_eq!(w012_issues.len(), 1);
        assert!(w012_issues[0].message.contains("[D03]"));
    }

    #[test]
    fn test_w012_defined_decision_no_warning() {
        use crate::parser::parse_tugplan;

        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

### Design Decisions {#design-decisions}

#### [D01] Decision One (DECIDED) {#d01-one}

This decision exists.

#### Step 0: Test {#step-0}

**Commit:** `feat: add feature`

**References:** [D01] Decision One

**Tasks:**
- [ ] Task one
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let w012_issues: Vec<&ValidationIssue> =
            result.issues.iter().filter(|i| i.code == "W012").collect();
        assert_eq!(w012_issues.len(), 0);
    }

    // W013 tests
    #[test]
    fn test_w013_undefined_anchor_in_references() {
        use crate::parser::parse_tugplan;

        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### Step 0: Test {#step-0}

**Commit:** `feat: add feature`

**References:** (#nonexistent-anchor)

**Tasks:**
- [ ] Task one
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let w013_issues: Vec<&ValidationIssue> =
            result.issues.iter().filter(|i| i.code == "W013").collect();
        assert_eq!(w013_issues.len(), 1);
        assert!(w013_issues[0].message.contains("nonexistent-anchor"));
    }

    #[test]
    fn test_w013_substep_references() {
        use crate::parser::parse_tugplan;

        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### Step 2: Main Step {#step-2}

**Commit:** `feat: add parent`

**References:** (#plan-metadata)

**Tasks:**
- [ ] Parent task

##### Step 2.1: Substep {#step-2-1}

**Commit:** `feat: add substep`

**References:** (#undefined-in-substep)

**Tasks:**
- [ ] Substep task
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let w013_issues: Vec<&ValidationIssue> =
            result.issues.iter().filter(|i| i.code == "W013").collect();
        assert_eq!(w013_issues.len(), 1);
        assert!(w013_issues[0].message.contains("undefined-in-substep"));
    }

    #[test]
    fn test_w013_depends_on_not_checked() {
        use crate::parser::parse_tugplan;

        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

#### Step 0: First {#step-0}

**Commit:** `feat: add first`

**References:** (#plan-metadata)

**Tasks:**
- [ ] Task one

#### Step 1: Second {#step-1}

**Depends on:** #nonexistent-dependency

**Commit:** `feat: add second`

**References:** (#plan-metadata)

**Tasks:**
- [ ] Task two
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        // Depends on broken references should be E010, not W013
        let w013_issues: Vec<&ValidationIssue> =
            result.issues.iter().filter(|i| i.code == "W013").collect();
        assert_eq!(w013_issues.len(), 0);

        let e010_issues: Vec<&ValidationIssue> =
            result.issues.iter().filter(|i| i.code == "E010").collect();
        assert_eq!(e010_issues.len(), 1);
    }

    #[test]
    fn test_w013_defined_anchor_no_warning() {
        use crate::parser::parse_tugplan;

        let content = r#"## Phase 1.0: Test {#phase-1}

### TugPlan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Test |
| Status | active |
| Last updated | 2026-02-03 |

### Context {#context}

Some context here.

#### Step 0: Test {#step-0}

**Commit:** `feat: add feature`

**References:** (#context, #plan-metadata)

**Tasks:**
- [ ] Task one
"#;

        let plan = parse_tugplan(content).unwrap();
        let result = validate_tugplan(&plan);

        let w013_issues: Vec<&ValidationIssue> =
            result.issues.iter().filter(|i| i.code == "W013").collect();
        assert_eq!(w013_issues.len(), 0);
    }
}
