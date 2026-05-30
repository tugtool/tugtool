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
}
