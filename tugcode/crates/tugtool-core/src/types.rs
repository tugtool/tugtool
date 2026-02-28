//! Core data types for tugplans

use serde::{Deserialize, Serialize};

/// A diagnostic emitted during parsing (near-miss, code block content, etc.)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParseDiagnostic {
    /// Diagnostic code (e.g., "P001", "P006")
    pub code: String,
    /// Human-readable message
    pub message: String,
    /// Line number where the diagnostic was triggered
    pub line: usize,
    /// Optional suggestion for fixing the issue
    pub suggestion: Option<String>,
}

/// A parsed tugplan document
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TugPlan {
    /// The file path this tugplan was parsed from (if known)
    pub path: Option<String>,
    /// Phase title from the document header
    pub phase_title: Option<String>,
    /// Phase anchor (e.g., "phase-1")
    pub phase_anchor: Option<String>,
    /// Purpose statement
    pub purpose: Option<String>,
    /// TugPlan metadata section
    pub metadata: TugPlanMetadata,
    /// All anchors found in the document (for cross-reference validation)
    pub anchors: Vec<Anchor>,
    /// Design decisions
    pub decisions: Vec<Decision>,
    /// Open questions
    pub questions: Vec<Question>,
    /// Execution steps
    pub steps: Vec<Step>,
    /// Raw content (for line number lookups)
    pub raw_content: String,
    /// Parse diagnostics (near-miss patterns, code block issues)
    #[serde(default)]
    pub diagnostics: Vec<ParseDiagnostic>,
}

/// TugPlan metadata section from a tugplan document
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TugPlanMetadata {
    /// Owner of the tugplan
    pub owner: Option<String>,
    /// Status: draft, active, or done
    pub status: Option<String>,
    /// Target branch
    pub target_branch: Option<String>,
    /// Tracking issue or PR
    pub tracking: Option<String>,
    /// Last updated date
    pub last_updated: Option<String>,
}

impl TugPlanMetadata {
    /// Check if the status value is valid (draft, active, done)
    pub fn is_valid_status(&self) -> bool {
        match &self.status {
            Some(s) => {
                let lower = s.to_lowercase();
                lower == "draft" || lower == "active" || lower == "done"
            }
            None => false,
        }
    }
}

/// An anchor found in the document
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Anchor {
    /// The anchor name (without the #)
    pub name: String,
    /// Line number where the anchor was found
    pub line: usize,
}

/// A design decision
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Decision {
    /// Decision ID (e.g., "D01")
    pub id: String,
    /// Decision title
    pub title: String,
    /// Status (DECIDED, OPEN)
    pub status: Option<String>,
    /// Anchor name
    pub anchor: Option<String>,
    /// Line number
    pub line: usize,
}

/// An open question
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Question {
    /// Question ID (e.g., "Q01")
    pub id: String,
    /// Question title
    pub title: String,
    /// Resolution status (OPEN, DECIDED, DEFERRED)
    pub resolution: Option<String>,
    /// Anchor name
    pub anchor: Option<String>,
    /// Line number
    pub line: usize,
}

/// An execution step within a plan
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Step {
    /// Step number (e.g., "0", "1", "2")
    pub number: String,
    /// Step title
    pub title: String,
    /// Step anchor (e.g., "step-1", "step-2-1")
    pub anchor: String,
    /// Line number where the step starts
    pub line: usize,
    /// Dependencies (step anchors this step depends on)
    pub depends_on: Vec<String>,
    /// Commit message
    pub commit_message: Option<String>,
    /// References line content
    pub references: Option<String>,
    /// Task items
    pub tasks: Vec<Checkpoint>,
    /// Test items
    pub tests: Vec<Checkpoint>,
    /// Checkpoint/verification items
    pub checkpoints: Vec<Checkpoint>,
    /// Artifact items (deliverables from this step)
    #[serde(default)]
    pub artifacts: Vec<String>,
}

impl Step {
    /// Count total checkbox items (tasks + tests + checkpoints)
    pub fn total_items(&self) -> usize {
        self.tasks.len() + self.tests.len() + self.checkpoints.len()
    }

    /// Count completed checkbox items
    pub fn completed_items(&self) -> usize {
        self.tasks.iter().filter(|c| c.checked).count()
            + self.tests.iter().filter(|c| c.checked).count()
            + self.checkpoints.iter().filter(|c| c.checked).count()
    }

    /// Render the step description as markdown (Tasks, Artifacts, Commit Template)
    pub fn render_description(&self) -> String {
        let mut sections = Vec::new();

        // Tasks section
        if !self.tasks.is_empty() {
            let mut task_lines = vec!["## Tasks".to_string()];
            for task in &self.tasks {
                let check = if task.checked { "x" } else { " " };
                task_lines.push(format!("- [{}] {}", check, task.text));
            }
            sections.push(task_lines.join("\n"));
        }

        // Artifacts section
        if !self.artifacts.is_empty() {
            let mut artifact_lines = vec!["## Artifacts".to_string()];
            for artifact in &self.artifacts {
                artifact_lines.push(format!("- {}", artifact));
            }
            sections.push(artifact_lines.join("\n"));
        }

        // Commit Template section
        if let Some(ref commit) = self.commit_message {
            sections.push(format!("## Commit Template\n{}", commit));
        }

        sections.join("\n\n")
    }

    /// Render the acceptance criteria as markdown (Tests, Checkpoints)
    pub fn render_acceptance_criteria(&self) -> String {
        let mut sections = Vec::new();

        // Tests section
        if !self.tests.is_empty() {
            let mut test_lines = vec!["## Tests".to_string()];
            for test in &self.tests {
                let check = if test.checked { "x" } else { " " };
                test_lines.push(format!("- [{}] {}", check, test.text));
            }
            sections.push(test_lines.join("\n"));
        }

        // Checkpoints section
        if !self.checkpoints.is_empty() {
            let mut checkpoint_lines = vec!["## Checkpoints".to_string()];
            for checkpoint in &self.checkpoints {
                let check = if checkpoint.checked { "x" } else { " " };
                checkpoint_lines.push(format!("- [{}] {}", check, checkpoint.text));
            }
            sections.push(checkpoint_lines.join("\n"));
        }

        sections.join("\n\n")
    }
}

/// A checkbox item (task, test, or checkpoint)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    /// Whether the checkbox is checked
    pub checked: bool,
    /// The text content of the checkbox item
    pub text: String,
    /// Type of checkpoint item
    pub kind: CheckpointKind,
    /// Line number where this item appears
    pub line: usize,
}

/// Kind of checkpoint item
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum CheckpointKind {
    /// Task item
    #[default]
    Task,
    /// Test item
    Test,
    /// Checkpoint/verification item
    Checkpoint,
}

/// Status of a tugplan based on metadata and completion
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TugPlanStatus {
    /// Metadata Status = "draft"
    Draft,
    /// Metadata Status = "active", completion < 100%
    Active,
    /// Metadata Status = "done" OR completion = 100%
    Done,
}

impl std::fmt::Display for TugPlanStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TugPlanStatus::Draft => write!(f, "draft"),
            TugPlanStatus::Active => write!(f, "active"),
            TugPlanStatus::Done => write!(f, "done"),
        }
    }
}

impl TugPlan {
    /// Get the computed status based on metadata and completion
    pub fn computed_status(&self) -> TugPlanStatus {
        let declared = self.metadata.status.as_deref().map(|s| s.to_lowercase());

        match declared.as_deref() {
            Some("draft") => TugPlanStatus::Draft,
            Some("done") => TugPlanStatus::Done,
            Some("active") => {
                if self.completion_percentage() >= 100.0 {
                    TugPlanStatus::Done
                } else {
                    TugPlanStatus::Active
                }
            }
            _ => TugPlanStatus::Draft, // Default to draft if unknown
        }
    }

    /// Calculate completion percentage based on checkboxes in execution steps
    pub fn completion_percentage(&self) -> f64 {
        let (done, total) = self.completion_counts();
        if total == 0 {
            0.0
        } else {
            (done as f64 / total as f64) * 100.0
        }
    }

    /// Get (completed, total) counts for checkboxes in execution steps
    pub fn completion_counts(&self) -> (usize, usize) {
        let mut done = 0;
        let mut total = 0;

        for step in &self.steps {
            done += step.completed_items();
            total += step.total_items();
        }

        (done, total)
    }

    /// Extract content from a section by its anchor
    /// Returns the markdown content between the heading with {#anchor} and the next same-or-higher level heading
    pub fn extract_section_by_anchor(&self, anchor: &str) -> Option<String> {
        let lines: Vec<&str> = self.raw_content.lines().collect();
        let anchor_pattern = format!("{{#{}}}", anchor);

        // Find the line with the anchor
        let start_idx = lines
            .iter()
            .position(|line| line.contains(&anchor_pattern))?;

        // Determine the heading level of the anchor line
        let anchor_line = lines[start_idx];
        let anchor_level = anchor_line.chars().take_while(|&c| c == '#').count();

        // Find the end of this section (next heading at same or higher level)
        let mut end_idx = lines.len();
        for (idx, line) in lines.iter().enumerate().skip(start_idx + 1) {
            if line.starts_with('#') {
                let level = line.chars().take_while(|&c| c == '#').count();
                if level <= anchor_level {
                    end_idx = idx;
                    break;
                }
            }
        }

        // Extract the content between start and end (excluding the heading line itself)
        if start_idx + 1 < end_idx {
            let content_lines: Vec<&str> = lines[(start_idx + 1)..end_idx].to_vec();
            let content = content_lines.join("\n").trim().to_string();
            if content.is_empty() {
                None
            } else {
                Some(content)
            }
        } else {
            None
        }
    }

    /// Render the plan root description (Purpose + Strategy + Success Criteria)
    pub fn render_root_description(&self) -> String {
        let mut sections = Vec::new();

        // Purpose section
        if let Some(ref purpose) = self.purpose {
            sections.push(format!("## Purpose\n{}", purpose));
        }

        // Strategy section
        if let Some(strategy) = self.extract_section_by_anchor("strategy") {
            sections.push(format!("## Strategy\n{}", strategy));
        }

        // Success Criteria section
        if let Some(criteria) = self.extract_section_by_anchor("success-criteria") {
            sections.push(format!("## Success Criteria\n{}", criteria));
        }

        sections.join("\n\n")
    }

    /// Render the plan root design (summary of design decisions)
    pub fn render_root_design(&self) -> String {
        if self.decisions.is_empty() {
            return String::new();
        }

        let mut lines = vec!["## References".to_string()];
        for decision in &self.decisions {
            lines.push(format!("- [{}] {}", decision.id, decision.title));
        }

        lines.join("\n")
    }

    /// Render the plan root acceptance criteria (phase exit criteria)
    pub fn render_root_acceptance(&self) -> String {
        // Try "exit-criteria" first, then "deliverables"
        if let Some(criteria) = self.extract_section_by_anchor("exit-criteria") {
            format!("## Exit Criteria\n{}", criteria)
        } else if let Some(deliverables) = self.extract_section_by_anchor("deliverables") {
            format!("## Deliverables\n{}", deliverables)
        } else {
            String::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_status() {
        let mut meta = TugPlanMetadata::default();
        assert!(!meta.is_valid_status());

        meta.status = Some("draft".to_string());
        assert!(meta.is_valid_status());

        meta.status = Some("ACTIVE".to_string());
        assert!(meta.is_valid_status());

        meta.status = Some("Done".to_string());
        assert!(meta.is_valid_status());

        meta.status = Some("invalid".to_string());
        assert!(!meta.is_valid_status());
    }

    #[test]
    fn test_step_counts() {
        let step = Step {
            tasks: vec![
                Checkpoint {
                    checked: true,
                    text: "Task 1".to_string(),
                    kind: CheckpointKind::Task,
                    line: 1,
                },
                Checkpoint {
                    checked: false,
                    text: "Task 2".to_string(),
                    kind: CheckpointKind::Task,
                    line: 2,
                },
            ],
            tests: vec![Checkpoint {
                checked: true,
                text: "Test 1".to_string(),
                kind: CheckpointKind::Test,
                line: 3,
            }],
            checkpoints: vec![Checkpoint {
                checked: false,
                text: "Check 1".to_string(),
                kind: CheckpointKind::Checkpoint,
                line: 4,
            }],
            ..Default::default()
        };

        assert_eq!(step.total_items(), 4);
        assert_eq!(step.completed_items(), 2);
    }

    #[test]
    fn test_plan_completion() {
        let mut tugplan = TugPlan::default();
        tugplan.metadata.status = Some("active".to_string());
        tugplan.steps.push(Step {
            tasks: vec![
                Checkpoint {
                    checked: true,
                    text: "Task 1".to_string(),
                    kind: CheckpointKind::Task,
                    line: 1,
                },
                Checkpoint {
                    checked: true,
                    text: "Task 2".to_string(),
                    kind: CheckpointKind::Task,
                    line: 2,
                },
            ],
            ..Default::default()
        });

        assert_eq!(tugplan.completion_counts(), (2, 2));
        assert_eq!(tugplan.completion_percentage(), 100.0);
        assert_eq!(tugplan.computed_status(), TugPlanStatus::Done);
    }

    #[test]
    fn test_step_render_description() {
        let step = Step {
            tasks: vec![
                Checkpoint {
                    checked: false,
                    text: "Task 1".to_string(),
                    kind: CheckpointKind::Task,
                    line: 1,
                },
                Checkpoint {
                    checked: true,
                    text: "Task 2".to_string(),
                    kind: CheckpointKind::Task,
                    line: 2,
                },
            ],
            artifacts: vec![
                "New file: src/api/client.rs".to_string(),
                "Modified: Cargo.toml".to_string(),
            ],
            commit_message: Some("feat(api): add client".to_string()),
            ..Default::default()
        };

        let desc = step.render_description();
        assert!(desc.contains("## Tasks"));
        assert!(desc.contains("- [ ] Task 1"));
        assert!(desc.contains("- [x] Task 2"));
        assert!(desc.contains("## Artifacts"));
        assert!(desc.contains("- New file: src/api/client.rs"));
        assert!(desc.contains("- Modified: Cargo.toml"));
        assert!(desc.contains("## Commit Template"));
        assert!(desc.contains("feat(api): add client"));
    }

    #[test]
    fn test_step_render_description_omits_empty_sections() {
        let step = Step {
            tasks: vec![Checkpoint {
                checked: false,
                text: "Task 1".to_string(),
                kind: CheckpointKind::Task,
                line: 1,
            }],
            ..Default::default()
        };

        let desc = step.render_description();
        assert!(desc.contains("## Tasks"));
        assert!(!desc.contains("## Artifacts"));
        assert!(!desc.contains("## Commit Template"));
    }

    #[test]
    fn test_step_render_acceptance_criteria() {
        let step = Step {
            tests: vec![Checkpoint {
                checked: false,
                text: "Unit test: retry logic".to_string(),
                kind: CheckpointKind::Test,
                line: 1,
            }],
            checkpoints: vec![
                Checkpoint {
                    checked: true,
                    text: "cargo test passes".to_string(),
                    kind: CheckpointKind::Checkpoint,
                    line: 2,
                },
                Checkpoint {
                    checked: false,
                    text: "cargo clippy clean".to_string(),
                    kind: CheckpointKind::Checkpoint,
                    line: 3,
                },
            ],
            ..Default::default()
        };

        let acceptance = step.render_acceptance_criteria();
        assert!(acceptance.contains("## Tests"));
        assert!(acceptance.contains("- [ ] Unit test: retry logic"));
        assert!(acceptance.contains("## Checkpoints"));
        assert!(acceptance.contains("- [x] cargo test passes"));
        assert!(acceptance.contains("- [ ] cargo clippy clean"));
    }

    #[test]
    fn test_plan_extract_section_by_anchor() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Strategy {#strategy}

This is the strategy content.
With multiple lines.

### Success Criteria {#success-criteria}

- Criterion 1
- Criterion 2

### Next Section {#next-section}

Other content.
"#;

        let tugplan = TugPlan {
            raw_content: content.to_string(),
            ..Default::default()
        };

        let strategy = tugplan.extract_section_by_anchor("strategy").unwrap();
        assert!(strategy.contains("This is the strategy content."));
        assert!(strategy.contains("With multiple lines."));
        assert!(!strategy.contains("### Success Criteria"));

        let criteria = tugplan
            .extract_section_by_anchor("success-criteria")
            .unwrap();
        assert!(criteria.contains("- Criterion 1"));
        assert!(criteria.contains("- Criterion 2"));
        assert!(!criteria.contains("### Next Section"));
    }

    #[test]
    fn test_plan_extract_section_by_anchor_missing() {
        let content = "## Phase 1.0: Test {#phase-1}\n";
        let tugplan = TugPlan {
            raw_content: content.to_string(),
            ..Default::default()
        };

        assert!(tugplan.extract_section_by_anchor("nonexistent").is_none());
    }

    #[test]
    fn test_plan_extract_section_last_in_document() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Last Section {#last-section}

This is the last section.
It goes to the end of the document.
"#;

        let tugplan = TugPlan {
            raw_content: content.to_string(),
            ..Default::default()
        };

        let last = tugplan.extract_section_by_anchor("last-section").unwrap();
        assert!(last.contains("This is the last section."));
        assert!(last.contains("It goes to the end of the document."));
    }

    #[test]
    fn test_plan_extract_section_with_nested_headings() {
        let content = r#"## Phase 1.0: Test {#phase-1}

### Section {#section}

Content here.

#### Subsection

Nested content.

### Next Section {#next}

Other.
"#;

        let tugplan = TugPlan {
            raw_content: content.to_string(),
            ..Default::default()
        };

        let section = tugplan.extract_section_by_anchor("section").unwrap();
        assert!(section.contains("Content here."));
        assert!(section.contains("#### Subsection"));
        assert!(section.contains("Nested content."));
        assert!(!section.contains("### Next Section"));
    }

    #[test]
    fn test_plan_render_root_description() {
        let content = r#"## Phase 1.0: Test {#phase-1}

**Purpose:** Build a test feature.

### Strategy {#strategy}

- Step 1
- Step 2

### Success Criteria {#success-criteria}

- All tests pass
- Feature works
"#;

        let tugplan = TugPlan {
            raw_content: content.to_string(),
            purpose: Some("Build a test feature.".to_string()),
            ..Default::default()
        };

        let desc = tugplan.render_root_description();
        assert!(desc.contains("## Purpose"));
        assert!(desc.contains("Build a test feature."));
        assert!(desc.contains("## Strategy"));
        assert!(desc.contains("- Step 1"));
        assert!(desc.contains("## Success Criteria"));
        assert!(desc.contains("- All tests pass"));
    }

    #[test]
    fn test_plan_render_root_design() {
        let mut tugplan = TugPlan::default();
        tugplan.decisions.push(Decision {
            id: "D01".to_string(),
            title: "Use Rust".to_string(),
            status: Some("DECIDED".to_string()),
            anchor: Some("d01-use-rust".to_string()),
            line: 1,
        });
        tugplan.decisions.push(Decision {
            id: "D02".to_string(),
            title: "Use clap".to_string(),
            status: Some("DECIDED".to_string()),
            anchor: Some("d02-use-clap".to_string()),
            line: 2,
        });

        let design = tugplan.render_root_design();
        assert!(design.contains("## References"));
        assert!(design.contains("- [D01] Use Rust"));
        assert!(design.contains("- [D02] Use clap"));
    }
}
