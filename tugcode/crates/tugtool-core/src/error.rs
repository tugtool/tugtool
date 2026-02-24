//! Error types for tug operations

use thiserror::Error;

/// Core error type for tug operations
#[derive(Error, Debug)]
pub enum TugError {
    // === Structural errors (E001-E006) ===
    /// E001: Missing required section
    #[error("E001: Missing required section: {section}")]
    MissingSection {
        section: String,
        line: Option<usize>,
    },

    /// E002: Missing or empty required metadata field
    #[error("E002: Missing or empty required metadata field: {field}")]
    MissingMetadataField { field: String, line: Option<usize> },

    /// E003: Invalid metadata Status value
    #[error("E003: Invalid metadata Status value: {value} (must be draft/active/done)")]
    InvalidStatus { value: String, line: Option<usize> },

    /// E004: Step missing References line
    #[error("E004: Step missing References line")]
    MissingReferences { step: String, line: Option<usize> },

    /// E005: Invalid anchor format
    #[error("E005: Invalid anchor format: {anchor}")]
    InvalidAnchor { anchor: String, line: Option<usize> },

    /// E006: Duplicate anchor
    #[error("E006: Duplicate anchor: {anchor}")]
    DuplicateAnchor {
        anchor: String,
        first_line: usize,
        second_line: usize,
    },

    // === Project errors (E009) ===
    /// E009: .tug directory not initialized
    #[error("E009: .tug directory not initialized")]
    NotInitialized,

    // === Dependency errors (E010-E011) ===
    /// E010: Dependency references non-existent step anchor
    #[error("E010: Dependency references non-existent step anchor: {anchor}")]
    InvalidDependency {
        anchor: String,
        step: String,
        line: Option<usize>,
    },

    /// E011: Circular dependency detected
    #[error("E011: Circular dependency detected: {cycle}")]
    CircularDependency { cycle: String },

    // === IO and system errors ===
    /// File not found or unreadable
    #[error("file not found or unreadable: {0}")]
    FileNotFound(String),

    /// IO error
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// Configuration error
    #[error("configuration error: {0}")]
    Config(String),

    /// Parse error (general markdown/structure issue)
    #[error("parse error: {message}")]
    Parse {
        message: String,
        line: Option<usize>,
    },

    /// Feature not implemented
    #[error("feature not implemented: {0}")]
    NotImplemented(String),

    /// Step anchor not found
    #[error("step anchor not found: {0}")]
    StepAnchorNotFound(String),

    // === Agent errors (E019-E021) ===
    /// E019: Claude CLI not installed
    #[error("E019: Claude CLI not installed. Install Claude Code from https://claude.ai/download")]
    ClaudeCliNotInstalled,

    /// E020: Agent invocation failed
    #[error("E020: Agent invocation failed: {reason}")]
    AgentInvocationFailed { reason: String },

    /// E021: Agent timeout
    #[error("E021: Agent timeout after {secs} seconds")]
    AgentTimeout { secs: u64 },

    // === Planning errors (E023-E024) ===
    /// E023: Created plan has validation warnings
    #[error("E023: Created plan has validation warnings")]
    PlanValidationWarnings { warning_count: usize },

    /// E024: User aborted planning loop
    #[error("E024: User aborted planning loop")]
    UserAborted,

    // === Execution errors (E022) ===
    /// E022: Monitor halted execution
    #[error("E022: Monitor halted execution: {reason}")]
    MonitorHalted { reason: String },

    // === Distribution errors (E025-E026) ===
    /// E025: Skills not found in share directory
    #[error("E025: Skills not found in share directory: {path}")]
    SkillsNotFound { path: String },

    /// E026: Required agents missing for command
    #[error("E026: Missing required agents for 'tug {command}': {}", missing.join(", "))]
    RequiredAgentsMissing {
        command: String,
        missing: Vec<String>,
        searched: Vec<String>,
    },

    // === Interaction errors (E027) ===
    /// E027: Interaction failed (non-TTY, timeout, etc.)
    #[error("E027: Interaction failed: {reason}")]
    InteractionFailed { reason: String },

    // === Worktree errors (E028-E034) ===
    /// E028: Worktree already exists for this plan
    #[error("E028: Worktree already exists for this plan")]
    WorktreeAlreadyExists,

    /// E029: Git version insufficient (need 2.15+)
    #[error("E029: Git version insufficient (need 2.15+ for worktree support)")]
    GitVersionInsufficient,

    /// E030: Not in a git repository
    #[error("E030: Not in a git repository")]
    NotAGitRepository,

    /// E031: Base branch not found
    #[error("E031: Base branch not found: {branch}")]
    BaseBranchNotFound { branch: String },

    /// E032: Plan has no execution steps
    #[error("E032: Plan has no execution steps")]
    PlanHasNoSteps,

    /// E033: Worktree creation failed
    #[error("E033: Worktree creation failed: {reason}")]
    WorktreeCreationFailed { reason: String },

    /// E034: Worktree cleanup failed
    #[error("E034: Worktree cleanup failed: {reason}")]
    WorktreeCleanupFailed { reason: String },

    /// E037: Init failed during worktree creation
    #[error("E037: Init failed: {reason}")]
    InitFailed { reason: String },

    // === State errors (E046-E053) ===
    /// E046: Failed to open state.db
    #[error("E046: Failed to open state database: {reason}")]
    StateDbOpen { reason: String },

    /// E047: SQL query failed
    #[error("E047: State database query failed: {reason}")]
    StateDbQuery { reason: String },

    /// E048: Plan file changed since init
    #[error("E048: Plan hash mismatch: plan file has changed since state init")]
    StatePlanHashMismatch { plan_path: String },

    /// E049: Worktree does not match claimed_by
    #[error("E049: Ownership violation: step {anchor} is claimed by {claimed_by}, not {worktree}")]
    StateOwnershipViolation {
        anchor: String,
        claimed_by: String,
        worktree: String,
    },

    /// E050: Step not in expected status for operation
    #[error(
        "E050: Step {anchor} is not in expected status for this operation (current: {current_status})"
    )]
    StateStepNotClaimed {
        anchor: String,
        current_status: String,
    },

    /// E051: Cannot complete step with incomplete checklist items
    #[error(
        "E051: Cannot complete step {anchor}: {incomplete_count} checklist items not completed"
    )]
    StateIncompleteChecklist {
        anchor: String,
        incomplete_count: usize,
    },

    /// E052: Cannot complete step with incomplete substeps
    #[error("E052: Cannot complete step {anchor}: {incomplete_count} substeps not completed")]
    StateIncompleteSubsteps {
        anchor: String,
        incomplete_count: usize,
    },

    /// E053: No steps ready for claiming
    #[error("E053: No steps ready for claiming")]
    StateNoReadySteps,
}

impl TugError {
    /// Get the error code (e.g., "E001", "E002")
    pub fn code(&self) -> &'static str {
        match self {
            TugError::MissingSection { .. } => "E001",
            TugError::MissingMetadataField { .. } => "E002",
            TugError::InvalidStatus { .. } => "E003",
            TugError::MissingReferences { .. } => "E004",
            TugError::InvalidAnchor { .. } => "E005",
            TugError::DuplicateAnchor { .. } => "E006",
            TugError::NotInitialized => "E009",
            TugError::InvalidDependency { .. } => "E010",
            TugError::CircularDependency { .. } => "E011",
            TugError::FileNotFound(_) => "E002", // Reuse for file errors
            TugError::Io(_) => "E002",
            TugError::Config(_) => "E004", // Config errors
            TugError::Parse { .. } => "E001",
            TugError::NotImplemented(_) => "E003", // Feature not implemented
            TugError::StepAnchorNotFound(_) => "E017", // Step anchor not found
            TugError::ClaudeCliNotInstalled => "E019",
            TugError::AgentInvocationFailed { .. } => "E020",
            TugError::AgentTimeout { .. } => "E021",
            TugError::MonitorHalted { .. } => "E022",
            TugError::PlanValidationWarnings { .. } => "E023",
            TugError::UserAborted => "E024",
            TugError::SkillsNotFound { .. } => "E025",
            TugError::RequiredAgentsMissing { .. } => "E026",
            TugError::InteractionFailed { .. } => "E027",
            TugError::WorktreeAlreadyExists => "E028",
            TugError::GitVersionInsufficient => "E029",
            TugError::NotAGitRepository => "E030",
            TugError::BaseBranchNotFound { .. } => "E031",
            TugError::PlanHasNoSteps => "E032",
            TugError::WorktreeCreationFailed { .. } => "E033",
            TugError::WorktreeCleanupFailed { .. } => "E034",
            TugError::InitFailed { .. } => "E037",
            TugError::StateDbOpen { .. } => "E046",
            TugError::StateDbQuery { .. } => "E047",
            TugError::StatePlanHashMismatch { .. } => "E048",
            TugError::StateOwnershipViolation { .. } => "E049",
            TugError::StateStepNotClaimed { .. } => "E050",
            TugError::StateIncompleteChecklist { .. } => "E051",
            TugError::StateIncompleteSubsteps { .. } => "E052",
            TugError::StateNoReadySteps => "E053",
        }
    }

    /// Get the line number associated with this error, if any
    pub fn line(&self) -> Option<usize> {
        match self {
            TugError::MissingSection { line, .. } => *line,
            TugError::MissingMetadataField { line, .. } => *line,
            TugError::InvalidStatus { line, .. } => *line,
            TugError::MissingReferences { line, .. } => *line,
            TugError::InvalidAnchor { line, .. } => *line,
            TugError::DuplicateAnchor { second_line, .. } => Some(*second_line),
            TugError::InvalidDependency { line, .. } => *line,
            TugError::Parse { line, .. } => *line,
            _ => None,
        }
    }

    /// Get the exit code for this error type
    pub fn exit_code(&self) -> i32 {
        match self {
            TugError::MissingSection { .. }
            | TugError::MissingMetadataField { .. }
            | TugError::InvalidStatus { .. }
            | TugError::MissingReferences { .. }
            | TugError::InvalidAnchor { .. }
            | TugError::DuplicateAnchor { .. }
            | TugError::InvalidDependency { .. }
            | TugError::CircularDependency { .. } => 1, // Validation errors

            TugError::FileNotFound(_) | TugError::Io(_) => 2, // File errors

            TugError::NotImplemented(_) => 3, // Feature not implemented

            TugError::Config(_) => 4, // Configuration error

            TugError::StepAnchorNotFound(_) => 2, // Step anchor not found

            TugError::NotInitialized => 9, // .tug not initialized

            TugError::Parse { .. } => 1, // Parse errors are validation errors

            TugError::ClaudeCliNotInstalled => 6, // Claude CLI not installed

            TugError::AgentInvocationFailed { .. } | TugError::AgentTimeout { .. } => 1, // Agent errors

            TugError::MonitorHalted { .. } => 4, // Monitor halted execution

            TugError::PlanValidationWarnings { .. } => 0, // Warnings are not failures

            TugError::UserAborted => 5, // User aborted planning loop

            TugError::SkillsNotFound { .. } => 7, // Skills not found

            TugError::RequiredAgentsMissing { .. } => 8, // Required agents missing

            TugError::InteractionFailed { .. } => 1, // Interaction errors

            TugError::WorktreeAlreadyExists => 3, // Worktree already exists (exit code 3 per T02)
            TugError::GitVersionInsufficient => 4, // Git version insufficient (exit code 4 per T02)
            TugError::NotAGitRepository => 5,     // Not a git repository (exit code 5 per T02)
            TugError::BaseBranchNotFound { .. } => 6, // Base branch not found (exit code 6 per T02)
            TugError::PlanHasNoSteps => 8,        // Plan has no steps (exit code 8 per T02)
            TugError::WorktreeCreationFailed { .. } => 1, // Worktree creation failed
            TugError::WorktreeCleanupFailed { .. } => 1, // Worktree cleanup failed
            TugError::InitFailed { .. } => 12,    // Init failed (exit code 12)
            TugError::StateDbOpen { .. } => 14,   // State DB open failed
            TugError::StateDbQuery { .. } => 14,  // State DB query failed
            TugError::StatePlanHashMismatch { .. } => 14, // Plan hash mismatch
            TugError::StateOwnershipViolation { .. } => 14, // Ownership violation
            TugError::StateStepNotClaimed { .. } => 14, // Step not claimed
            TugError::StateIncompleteChecklist { .. } => 14, // Incomplete checklist
            TugError::StateIncompleteSubsteps { .. } => 14, // Incomplete substeps
            TugError::StateNoReadySteps => 14,    // No ready steps
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_codes() {
        let err = TugError::MissingSection {
            section: "Plan Metadata".to_string(),
            line: Some(10),
        };
        assert_eq!(err.code(), "E001");
        assert_eq!(err.line(), Some(10));
        assert_eq!(err.exit_code(), 1);

        let err = TugError::NotInitialized;
        assert_eq!(err.code(), "E009");
        assert_eq!(err.exit_code(), 9);
    }

    #[test]
    fn test_error_display() {
        let err = TugError::InvalidStatus {
            value: "invalid".to_string(),
            line: Some(5),
        };
        assert_eq!(
            err.to_string(),
            "E003: Invalid metadata Status value: invalid (must be draft/active/done)"
        );
    }

    #[test]
    fn test_agent_error_codes() {
        let err = TugError::ClaudeCliNotInstalled;
        assert_eq!(err.code(), "E019");
        assert_eq!(err.exit_code(), 6);

        let err = TugError::AgentInvocationFailed {
            reason: "test failure".to_string(),
        };
        assert_eq!(err.code(), "E020");
        assert_eq!(err.exit_code(), 1);
        assert!(err.to_string().contains("test failure"));

        let err = TugError::AgentTimeout { secs: 300 };
        assert_eq!(err.code(), "E021");
        assert_eq!(err.exit_code(), 1);
        assert!(err.to_string().contains("300 seconds"));
    }

    #[test]
    fn test_planning_error_codes() {
        let err = TugError::PlanValidationWarnings { warning_count: 3 };
        assert_eq!(err.code(), "E023");
        assert_eq!(err.exit_code(), 0); // Warnings don't cause failure
        assert!(err.to_string().contains("validation warnings"));

        let err = TugError::UserAborted;
        assert_eq!(err.code(), "E024");
        assert_eq!(err.exit_code(), 5);
        assert!(err.to_string().contains("aborted"));
    }

    #[test]
    fn test_skills_not_found_error() {
        let err = TugError::SkillsNotFound {
            path: "/some/path".to_string(),
        };
        assert_eq!(err.code(), "E025");
        assert_eq!(err.exit_code(), 7);
        assert!(err.to_string().contains("/some/path"));
        assert!(err.to_string().contains("Skills not found"));
    }

    #[test]
    fn test_monitor_halted_error() {
        let err = TugError::MonitorHalted {
            reason: "drift detected".to_string(),
        };
        assert_eq!(err.code(), "E022");
        assert_eq!(err.exit_code(), 4);
        assert!(err.to_string().contains("drift detected"));
        assert!(err.to_string().contains("Monitor halted"));
    }

    #[test]
    fn test_required_agents_missing_error() {
        let err = TugError::RequiredAgentsMissing {
            command: "plan".to_string(),
            missing: vec!["clarifier-agent".to_string(), "critic-agent".to_string()],
            searched: vec![
                "./agents/".to_string(),
                "/opt/homebrew/share/tug/agents/".to_string(),
            ],
        };
        assert_eq!(err.code(), "E026");
        assert_eq!(err.exit_code(), 8);
        assert!(err.to_string().contains("tug plan"));
        assert!(err.to_string().contains("clarifier-agent"));
        assert!(err.to_string().contains("critic-agent"));
    }

    #[test]
    fn test_interaction_failed_error() {
        let err = TugError::InteractionFailed {
            reason: "stdin is not a TTY".to_string(),
        };
        assert_eq!(err.code(), "E027");
        assert_eq!(err.exit_code(), 1);
        assert!(err.to_string().contains("Interaction failed"));
        assert!(err.to_string().contains("stdin is not a TTY"));
    }
}
