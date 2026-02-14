//! Agent integration tests
//!
//! These tests verify the agent definitions and their contracts.
//! Since agents are markdown files invoked by Claude Code, we test:
//! - Agent definitions exist and have correct frontmatter
//! - Agent contracts (inputs/outputs) are documented
//! - Inter-agent protocols are consistent
//!
//! Note: As of Phase 4.0, the architecture changed to:
//! - 3 orchestrator SKILLS (plan, implement, merge) in skills/
//! - 9 sub-AGENTS invoked via Task tool in agents/

use std::fs;
use std::path::PathBuf;

/// Get the path to the agents directory
fn agents_dir() -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.pop(); // crates
    path.pop(); // repo root
    path.push("agents");
    path
}

/// Parse agent frontmatter from markdown
fn parse_agent_frontmatter(content: &str) -> Option<(String, String, String)> {
    // Agent files have YAML frontmatter between --- markers
    let lines: Vec<&str> = content.lines().collect();
    if lines.first() != Some(&"---") {
        return None;
    }

    let mut name = String::new();
    let mut description = String::new();
    let mut tools = String::new();

    for line in lines.iter().skip(1) {
        if *line == "---" {
            break;
        }
        if let Some(value) = line.strip_prefix("name: ") {
            name = value.to_string();
        } else if let Some(value) = line.strip_prefix("description: ") {
            description = value.to_string();
        } else if let Some(value) = line.strip_prefix("tools: ") {
            tools = value.to_string();
        }
    }

    if name.is_empty() {
        None
    } else {
        Some((name, description, tools))
    }
}

/// List of all sub-agents (7 agents invoked via Task)
/// Per plan-4.md and plan-5.md, these are the sub-agents.
/// Note: planner-setup-agent was removed — its work is now a pre-hook.
/// Note: implement-setup-agent was removed — worktree creation is now a direct CLI call.
const ALL_AGENTS: &[&str] = &[
    "clarifier-agent",
    "author-agent",
    "critic-agent",
    "architect-agent",
    "coder-agent",
    "reviewer-agent",
    "committer-agent",
];

/// Read-only agents (no Write/Edit, but may have Bash for specific commands like validate)
/// Note: critic-agent has Bash for running tug validate as a hard gate
const READONLY_AGENTS: &[&str] = &[];

/// Core agents with full documentation structure (Input/Output contracts, Your Role, etc.)
/// Setup agents have simpler structure and are excluded.
const CORE_AGENTS: &[&str] = &[
    "clarifier-agent",
    "author-agent",
    "critic-agent",
    "architect-agent",
    "coder-agent",
    "reviewer-agent",
    "committer-agent",
];

// =============================================================================
// Agent Definition Tests
// =============================================================================

#[test]
fn test_all_agent_definitions_exist() {
    let dir = agents_dir();
    for agent in ALL_AGENTS {
        let path = dir.join(format!("{}.md", agent));
        assert!(
            path.exists(),
            "Agent definition missing: {}",
            path.display()
        );
    }
}

#[test]
fn test_agent_definitions_have_valid_frontmatter() {
    let dir = agents_dir();
    for agent in ALL_AGENTS {
        let path = dir.join(format!("{}.md", agent));
        let content = fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("Failed to read agent: {}", path.display()));

        let frontmatter = parse_agent_frontmatter(&content);
        assert!(
            frontmatter.is_some(),
            "Agent {} has invalid frontmatter",
            agent
        );

        let (name, description, tools) = frontmatter.unwrap();
        assert_eq!(name, *agent, "Agent name mismatch for {}", agent);
        assert!(
            !description.is_empty(),
            "Agent {} missing description",
            agent
        );
        assert!(!tools.is_empty(), "Agent {} missing tools", agent);
    }
}

#[test]
fn test_only_expected_agents_exist() {
    let dir = agents_dir();
    let entries: Vec<_> = fs::read_dir(&dir)
        .expect("Failed to read agents directory")
        .filter_map(|e| e.ok())
        .filter(|e| {
            let path = e.path();
            path.is_file() && path.extension().is_some_and(|ext| ext == "md")
        })
        .collect();

    assert_eq!(
        entries.len(),
        9,
        "Expected exactly 9 agent files, found {}",
        entries.len()
    );

    // Verify all files end with -agent.md
    for entry in &entries {
        let filename = entry.file_name().to_string_lossy().to_string();
        assert!(
            filename.ends_with("-agent.md"),
            "Agent file {} should end with -agent.md",
            filename
        );
    }
}

// =============================================================================
// Agent Contract Tests
// =============================================================================

#[test]
fn test_core_agents_have_input_contract() {
    let dir = agents_dir();
    for agent in CORE_AGENTS {
        let path = dir.join(format!("{}.md", agent));
        let content = fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("Failed to read agent: {}", path.display()));

        assert!(
            content.contains("## Input Contract"),
            "Agent {} missing Input Contract section",
            agent
        );
    }
}

#[test]
fn test_core_agents_have_output_contract() {
    let dir = agents_dir();
    for agent in CORE_AGENTS {
        let path = dir.join(format!("{}.md", agent));
        let content = fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("Failed to read agent: {}", path.display()));

        assert!(
            content.contains("## Output Contract"),
            "Agent {} missing Output Contract section",
            agent
        );
    }
}

#[test]
fn test_core_agents_document_role() {
    let dir = agents_dir();
    for agent in CORE_AGENTS {
        let path = dir.join(format!("{}.md", agent));
        let content = fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("Failed to read agent: {}", path.display()));

        assert!(
            content.contains("## Your Role"),
            "Agent {} missing 'Your Role' section",
            agent
        );
    }
}

// =============================================================================
// Read-Only Agent Tests
// =============================================================================

#[test]
fn test_readonly_agents_have_read_only_tools() {
    let dir = agents_dir();
    for agent in READONLY_AGENTS {
        let path = dir.join(format!("{}.md", agent));
        let content = fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("Failed to read agent: {}", path.display()));

        let frontmatter = parse_agent_frontmatter(&content)
            .unwrap_or_else(|| panic!("Agent {} has invalid frontmatter", agent));
        let tools = frontmatter.2;

        // Read-only agents should only have Read, Grep, Glob
        assert!(
            !tools.contains("Write"),
            "Read-only agent {} should not have Write tool",
            agent
        );
        assert!(
            !tools.contains("Edit"),
            "Read-only agent {} should not have Edit tool",
            agent
        );
        assert!(
            !tools.contains("Bash"),
            "Read-only agent {} should not have Bash tool",
            agent
        );
    }
}

// =============================================================================
// Coder Agent Tests
// =============================================================================

#[test]
fn test_coder_has_required_tools() {
    let path = agents_dir().join("coder-agent.md");
    let content = fs::read_to_string(&path).expect("Failed to read coder-agent");

    let frontmatter = parse_agent_frontmatter(&content).expect("Failed to parse frontmatter");
    let tools = frontmatter.2;

    // Coder must have Write, Edit, and Bash tools for code modification
    assert!(tools.contains("Write"), "Coder must have Write tool");
    assert!(tools.contains("Edit"), "Coder must have Edit tool");
    assert!(tools.contains("Bash"), "Coder must have Bash tool");
}

#[test]
fn test_coder_documents_drift_detection() {
    let path = agents_dir().join("coder-agent.md");
    let content = fs::read_to_string(&path).expect("Failed to read coder-agent");

    // Coder must document drift detection
    assert!(
        content.contains("drift") || content.contains("Drift"),
        "Coder agent must document drift detection"
    );

    // Coder should document self-halt behavior
    assert!(
        content.contains("self-halt")
            || content.contains("Self-halt")
            || content.contains("halted_for_drift"),
        "Coder agent must document self-halt behavior"
    );
}

#[test]
fn test_coder_documents_drift_budget() {
    let path = agents_dir().join("coder-agent.md");
    let content = fs::read_to_string(&path).expect("Failed to read coder-agent");

    // Coder must document drift budget
    assert!(
        content.contains("yellow") && content.contains("red"),
        "Coder agent must document yellow/red file categories"
    );

    assert!(
        content.contains("drift_budget") || content.contains("Drift Budget"),
        "Coder agent must document drift budget"
    );
}

// =============================================================================
// Architect Agent Tests
// =============================================================================

#[test]
fn test_architect_documents_expected_touch_set() {
    let path = agents_dir().join("architect-agent.md");
    let content = fs::read_to_string(&path).expect("Failed to read architect-agent");

    // Architect must document expected_touch_set
    assert!(
        content.contains("expected_touch_set"),
        "Architect must document expected_touch_set in output"
    );
}

// =============================================================================
// Critic Agent Tests
// =============================================================================

#[test]
fn test_critic_documents_skeleton_compliance() {
    let path = agents_dir().join("critic-agent.md");
    let content = fs::read_to_string(&path).expect("Failed to read critic-agent");

    // Critic must document skeleton compliance as hard gate
    assert!(
        content.contains("skeleton") && content.contains("HARD GATE"),
        "Critic must document skeleton compliance as hard gate"
    );
}

#[test]
fn test_critic_documents_recommendations() {
    let path = agents_dir().join("critic-agent.md");
    let content = fs::read_to_string(&path).expect("Failed to read critic-agent");

    // Critic must document all recommendation types
    assert!(
        content.contains("APPROVE") && content.contains("REVISE") && content.contains("REJECT"),
        "Critic must document APPROVE, REVISE, REJECT recommendations"
    );
}

#[test]
fn test_critic_has_bash_tool_for_validation() {
    let path = agents_dir().join("critic-agent.md");
    let content = fs::read_to_string(&path).expect("Failed to read critic-agent");

    let frontmatter = parse_agent_frontmatter(&content).expect("Failed to parse frontmatter");
    let tools = frontmatter.2;

    // Critic must have Bash tool for running tugtool validate
    assert!(
        tools.contains("Bash"),
        "Critic must have Bash tool for tugtool validate"
    );
}

#[test]
fn test_critic_documents_validation_workflow() {
    let path = agents_dir().join("critic-agent.md");
    let content = fs::read_to_string(&path).expect("Failed to read critic-agent");

    // Critic must document tugtool validate as first action
    assert!(
        content.contains("tugtool validate"),
        "Critic must document tugtool validate command"
    );

    // Critic must document immediate REJECT on validation failure
    assert!(
        content.contains("REJECT") && content.contains("validate"),
        "Critic must document REJECT on validation failure"
    );
}

#[test]
fn test_critic_documents_bash_restriction() {
    let path = agents_dir().join("critic-agent.md");
    let content = fs::read_to_string(&path).expect("Failed to read critic-agent");

    // Critic must document Bash restriction to only tugtool validate
    // Use case-insensitive check for "ONLY" or "only"
    let lowercase_content = content.to_lowercase();
    assert!(
        (lowercase_content.contains("only") || lowercase_content.contains("restriction"))
            && lowercase_content.contains("tugtool validate"),
        "Critic must document Bash tool restriction to tugtool validate only"
    );
}

// =============================================================================
// Committer Agent Tests
// =============================================================================

#[test]
fn test_committer_has_bash_tool() {
    let path = agents_dir().join("committer-agent.md");
    let content = fs::read_to_string(&path).expect("Failed to read committer-agent");

    let frontmatter = parse_agent_frontmatter(&content).expect("Failed to parse frontmatter");
    let tools = frontmatter.2;

    // Committer needs Bash for git operations
    assert!(tools.contains("Bash"), "Committer must have Bash tool");
}

#[test]
fn test_committer_documents_beads_integration() {
    let path = agents_dir().join("committer-agent.md");
    let content = fs::read_to_string(&path).expect("Failed to read committer-agent");

    // Committer must document bead closing
    assert!(
        content.contains("bead") || content.contains("Bead"),
        "Committer must document beads integration"
    );
}

// =============================================================================
// Reviewer Agent Tests
// =============================================================================

#[test]
fn test_reviewer_documents_recommendations() {
    let path = agents_dir().join("reviewer-agent.md");
    let content = fs::read_to_string(&path).expect("Failed to read reviewer-agent");

    // Reviewer must document all recommendation types
    assert!(
        content.contains("APPROVE") && content.contains("REVISE") && content.contains("ESCALATE"),
        "Reviewer must document APPROVE, REVISE, ESCALATE recommendations"
    );
}
