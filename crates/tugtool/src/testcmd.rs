//! Test command parsing and detection.
//!
//! Provides utilities for parsing test commands from CLI flags and
//! auto-detecting test runners from project configuration files.
//!
//! ## Test Command Format
//!
//! Test commands are specified as JSON arrays with template variables:
//! ```json
//! ["{python}", "-m", "pytest", "-x"]
//! ```
//!
//! ## Template Variables
//!
//! - `{python}` - Resolved Python interpreter path
//! - `{workspace}` - Workspace root path
//!
//! ## Detection Order
//!
//! Per \[D11\], test runner detection follows this order:
//! 1. `--test-command` flag (explicit override)
//! 2. `pyproject.toml` `[tool.tug].test_command`
//! 3. `pyproject.toml` has `[tool.pytest]` section → use `pytest`
//! 4. `pytest.ini` exists → use `pytest`
//! 5. `setup.cfg` has `[pytest]` section → use `pytest`
//! 6. Nothing found → skip tests (syntax check only)

use std::path::Path;
use thiserror::Error;

/// Errors from test command parsing and detection.
#[derive(Debug, Error)]
pub enum TestCommandError {
    /// Invalid JSON format.
    #[error("invalid test command JSON: {message}")]
    InvalidJson { message: String },

    /// Template variable not provided.
    #[error("template variable '{variable}' not provided")]
    MissingVariable { variable: String },

    /// IO error reading config files.
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Result type for test command operations.
pub type TestCommandResult<T> = Result<T, TestCommandError>;

/// Parsed and expanded test command ready for execution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TestCommand {
    /// Command arguments (first element is the program).
    pub args: Vec<String>,
    /// Source of this test command.
    pub source: TestCommandSource,
}

/// Source of the test command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TestCommandSource {
    /// Provided via `--test-command` CLI flag.
    CliFlag,
    /// From `pyproject.toml` `[tool.tug]` section.
    PyprojectTug,
    /// Auto-detected from `pyproject.toml` `[tool.pytest]`.
    PyprojectPytest,
    /// Auto-detected from `pytest.ini`.
    PytestIni,
    /// Auto-detected from `setup.cfg` `[pytest]`.
    SetupCfgPytest,
    /// Default pytest command (tests/ directory exists).
    DefaultPytest,
}

impl std::fmt::Display for TestCommandSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TestCommandSource::CliFlag => write!(f, "--test-command flag"),
            TestCommandSource::PyprojectTug => write!(f, "pyproject.toml [tool.tug]"),
            TestCommandSource::PyprojectPytest => write!(f, "pyproject.toml [tool.pytest]"),
            TestCommandSource::PytestIni => write!(f, "pytest.ini"),
            TestCommandSource::SetupCfgPytest => write!(f, "setup.cfg [pytest]"),
            TestCommandSource::DefaultPytest => write!(f, "default (tests/ directory)"),
        }
    }
}

/// Template variables for test command expansion.
#[derive(Debug, Clone)]
pub struct TemplateVars {
    /// Python interpreter path.
    pub python: Option<String>,
    /// Workspace root path.
    pub workspace: Option<String>,
}

impl TemplateVars {
    /// Create template vars with the given values.
    pub fn new(python: Option<String>, workspace: Option<String>) -> Self {
        TemplateVars { python, workspace }
    }
}

/// Parse a test command from a JSON array string.
///
/// The input should be a JSON array of strings, e.g.:
/// `["{python}", "-m", "pytest", "-x"]`
///
/// # Errors
///
/// Returns `InvalidJson` if the input is not a valid JSON array of strings.
pub fn parse_test_command(json_str: &str) -> TestCommandResult<Vec<String>> {
    let args: Vec<String> =
        serde_json::from_str(json_str).map_err(|e| TestCommandError::InvalidJson {
            message: format!("expected JSON array of strings: {}", e),
        })?;

    if args.is_empty() {
        return Err(TestCommandError::InvalidJson {
            message: "test command array cannot be empty".to_string(),
        });
    }

    Ok(args)
}

/// Expand template variables in a test command.
///
/// Replaces:
/// - `{python}` with the Python interpreter path
/// - `{workspace}` with the workspace root path
///
/// # Errors
///
/// Returns `MissingVariable` if a template variable is used but not provided.
pub fn expand_template_vars(
    args: &[String],
    vars: &TemplateVars,
) -> TestCommandResult<Vec<String>> {
    args.iter()
        .map(|arg| expand_single_var(arg, vars))
        .collect()
}

fn expand_single_var(s: &str, vars: &TemplateVars) -> TestCommandResult<String> {
    let mut result = s.to_string();

    if result.contains("{python}") {
        let python = vars
            .python
            .as_ref()
            .ok_or_else(|| TestCommandError::MissingVariable {
                variable: "python".to_string(),
            })?;
        result = result.replace("{python}", python);
    }

    if result.contains("{workspace}") {
        let workspace =
            vars.workspace
                .as_ref()
                .ok_or_else(|| TestCommandError::MissingVariable {
                    variable: "workspace".to_string(),
                })?;
        result = result.replace("{workspace}", workspace);
    }

    Ok(result)
}

/// Detect test runner from project configuration files.
///
/// Detection order per \[D11\]:
/// 1. `pyproject.toml` `[tool.tug].test_command`
/// 2. `pyproject.toml` has `[tool.pytest]` section
/// 3. `pytest.ini` exists
/// 4. `setup.cfg` has `[pytest]` section
/// 5. `tests/` directory exists → default pytest
/// 6. Nothing found → None
///
/// Returns the detected test command and its source, or None if not found.
pub fn detect_test_runner(
    workspace_root: &Path,
) -> TestCommandResult<Option<(Vec<String>, TestCommandSource)>> {
    // Check pyproject.toml
    let pyproject_path = workspace_root.join("pyproject.toml");
    if pyproject_path.exists() {
        let content = std::fs::read_to_string(&pyproject_path)?;

        // Check [tool.tug].test_command first
        if let Some(cmd) = parse_toml_tug_test_command(&content) {
            return Ok(Some((cmd, TestCommandSource::PyprojectTug)));
        }

        // Check for [tool.pytest] section
        if content.contains("[tool.pytest") {
            return Ok(Some((
                default_pytest_command(),
                TestCommandSource::PyprojectPytest,
            )));
        }
    }

    // Check pytest.ini
    let pytest_ini_path = workspace_root.join("pytest.ini");
    if pytest_ini_path.exists() {
        return Ok(Some((
            default_pytest_command(),
            TestCommandSource::PytestIni,
        )));
    }

    // Check setup.cfg for [pytest] section
    let setup_cfg_path = workspace_root.join("setup.cfg");
    if setup_cfg_path.exists() {
        let content = std::fs::read_to_string(&setup_cfg_path)?;
        if content.contains("[pytest]") || content.contains("[tool:pytest]") {
            return Ok(Some((
                default_pytest_command(),
                TestCommandSource::SetupCfgPytest,
            )));
        }
    }

    // Check for tests/ directory
    let tests_dir = workspace_root.join("tests");
    if tests_dir.is_dir() {
        return Ok(Some((
            default_pytest_command(),
            TestCommandSource::DefaultPytest,
        )));
    }

    // Nothing found
    Ok(None)
}

/// Parse test_command from [tool.tug] section in pyproject.toml.
///
/// Looks for:
/// ```toml
/// [tool.tug]
/// test_command = ["{python}", "-m", "pytest"]
/// ```
fn parse_toml_tug_test_command(content: &str) -> Option<Vec<String>> {
    // Simple parsing: look for test_command = [...] after [tool.tug]
    let tool_section = content.find("[tool.tug]")?;
    let after_section = &content[tool_section..];

    // Find test_command line
    for line in after_section.lines().skip(1) {
        let trimmed = line.trim();

        // Stop if we hit another section
        if trimmed.starts_with('[') && !trimmed.starts_with("[[") {
            break;
        }

        if trimmed.starts_with("test_command") {
            // Extract the array value
            if let Some(eq_pos) = trimmed.find('=') {
                let value = trimmed[eq_pos + 1..].trim();
                // Parse as JSON array (TOML arrays are compatible with JSON for simple cases)
                if let Ok(args) = serde_json::from_str::<Vec<String>>(value) {
                    if !args.is_empty() {
                        return Some(args);
                    }
                }
            }
        }
    }

    None
}

/// Default pytest command.
fn default_pytest_command() -> Vec<String> {
    vec![
        "{python}".to_string(),
        "-m".to_string(),
        "pytest".to_string(),
    ]
}

/// Resolve a test command from CLI flag or auto-detection.
///
/// This is the main entry point for test command resolution.
///
/// # Arguments
///
/// * `cli_test_command` - Test command from `--test-command` flag
/// * `workspace_root` - Workspace root path
/// * `vars` - Template variables for expansion
///
/// # Returns
///
/// Returns the resolved and expanded test command, or None if:
/// - No test command provided and none detected
/// - Detection should be skipped
pub fn resolve_test_command(
    cli_test_command: Option<&str>,
    workspace_root: &Path,
    vars: &TemplateVars,
) -> TestCommandResult<Option<TestCommand>> {
    // Priority 1: CLI flag
    if let Some(json_str) = cli_test_command {
        let args = parse_test_command(json_str)?;
        let expanded = expand_template_vars(&args, vars)?;
        return Ok(Some(TestCommand {
            args: expanded,
            source: TestCommandSource::CliFlag,
        }));
    }

    // Priority 2-6: Auto-detection
    if let Some((args, source)) = detect_test_runner(workspace_root)? {
        let expanded = expand_template_vars(&args, vars)?;
        return Ok(Some(TestCommand {
            args: expanded,
            source,
        }));
    }

    // Nothing found
    Ok(None)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    mod parse_test_command_tests {
        use super::*;

        #[test]
        fn parses_valid_json_array() {
            let result = parse_test_command(r#"["{python}", "-m", "pytest", "-x"]"#).unwrap();
            assert_eq!(result, vec!["{python}", "-m", "pytest", "-x"]);
        }

        #[test]
        fn parses_simple_command() {
            let result = parse_test_command(r#"["pytest"]"#).unwrap();
            assert_eq!(result, vec!["pytest"]);
        }

        #[test]
        fn rejects_empty_array() {
            let result = parse_test_command("[]");
            assert!(result.is_err());
            assert!(result.unwrap_err().to_string().contains("cannot be empty"));
        }

        #[test]
        fn rejects_invalid_json() {
            let result = parse_test_command("not json");
            assert!(result.is_err());
            assert!(result
                .unwrap_err()
                .to_string()
                .contains("invalid test command JSON"));
        }

        #[test]
        fn rejects_non_array() {
            let result = parse_test_command(r#"{"cmd": "pytest"}"#);
            assert!(result.is_err());
        }

        #[test]
        fn rejects_non_string_array() {
            let result = parse_test_command("[1, 2, 3]");
            assert!(result.is_err());
        }
    }

    mod expand_template_vars_tests {
        use super::*;

        #[test]
        fn expands_python_variable() {
            let args = vec![
                "{python}".to_string(),
                "-m".to_string(),
                "pytest".to_string(),
            ];
            let vars = TemplateVars::new(Some("/usr/bin/python3".to_string()), None);

            let result = expand_template_vars(&args, &vars).unwrap();
            assert_eq!(result, vec!["/usr/bin/python3", "-m", "pytest"]);
        }

        #[test]
        fn expands_workspace_variable() {
            let args = vec![
                "test".to_string(),
                "--cwd".to_string(),
                "{workspace}".to_string(),
            ];
            let vars = TemplateVars::new(None, Some("/home/user/project".to_string()));

            let result = expand_template_vars(&args, &vars).unwrap();
            assert_eq!(result, vec!["test", "--cwd", "/home/user/project"]);
        }

        #[test]
        fn expands_both_variables() {
            let args = vec![
                "{python}".to_string(),
                "-m".to_string(),
                "pytest".to_string(),
                "{workspace}/tests".to_string(),
            ];
            let vars = TemplateVars::new(
                Some("/usr/bin/python3".to_string()),
                Some("/project".to_string()),
            );

            let result = expand_template_vars(&args, &vars).unwrap();
            assert_eq!(
                result,
                vec!["/usr/bin/python3", "-m", "pytest", "/project/tests"]
            );
        }

        #[test]
        fn error_on_missing_python_variable() {
            let args = vec!["{python}".to_string()];
            let vars = TemplateVars::new(None, None);

            let result = expand_template_vars(&args, &vars);
            assert!(result.is_err());
            assert!(result.unwrap_err().to_string().contains("python"));
        }

        #[test]
        fn error_on_missing_workspace_variable() {
            let args = vec!["{workspace}".to_string()];
            let vars = TemplateVars::new(None, None);

            let result = expand_template_vars(&args, &vars);
            assert!(result.is_err());
            assert!(result.unwrap_err().to_string().contains("workspace"));
        }

        #[test]
        fn no_expansion_needed() {
            let args = vec!["pytest".to_string(), "-x".to_string()];
            let vars = TemplateVars::new(None, None);

            let result = expand_template_vars(&args, &vars).unwrap();
            assert_eq!(result, vec!["pytest", "-x"]);
        }
    }

    mod detect_test_runner_tests {
        use super::*;

        fn create_workspace() -> TempDir {
            TempDir::new().unwrap()
        }

        #[test]
        fn detects_pyproject_tug_section() {
            let workspace = create_workspace();
            std::fs::write(
                workspace.path().join("pyproject.toml"),
                r#"
[tool.tug]
test_command = ["{python}", "-m", "pytest", "--custom"]
"#,
            )
            .unwrap();

            let result = detect_test_runner(workspace.path()).unwrap();
            assert!(result.is_some());
            let (cmd, source) = result.unwrap();
            assert_eq!(cmd, vec!["{python}", "-m", "pytest", "--custom"]);
            assert_eq!(source, TestCommandSource::PyprojectTug);
        }

        #[test]
        fn detects_pyproject_pytest_section() {
            let workspace = create_workspace();
            std::fs::write(
                workspace.path().join("pyproject.toml"),
                r#"
[tool.pytest.ini_options]
testpaths = ["tests"]
"#,
            )
            .unwrap();

            let result = detect_test_runner(workspace.path()).unwrap();
            assert!(result.is_some());
            let (cmd, source) = result.unwrap();
            assert_eq!(cmd, default_pytest_command());
            assert_eq!(source, TestCommandSource::PyprojectPytest);
        }

        #[test]
        fn detects_pytest_ini() {
            let workspace = create_workspace();
            std::fs::write(
                workspace.path().join("pytest.ini"),
                "[pytest]\ntestpaths = tests\n",
            )
            .unwrap();

            let result = detect_test_runner(workspace.path()).unwrap();
            assert!(result.is_some());
            let (_, source) = result.unwrap();
            assert_eq!(source, TestCommandSource::PytestIni);
        }

        #[test]
        fn detects_setup_cfg_pytest() {
            let workspace = create_workspace();
            std::fs::write(
                workspace.path().join("setup.cfg"),
                "[pytest]\naddopts = -v\n",
            )
            .unwrap();

            let result = detect_test_runner(workspace.path()).unwrap();
            assert!(result.is_some());
            let (_, source) = result.unwrap();
            assert_eq!(source, TestCommandSource::SetupCfgPytest);
        }

        #[test]
        fn detects_setup_cfg_tool_pytest() {
            let workspace = create_workspace();
            std::fs::write(
                workspace.path().join("setup.cfg"),
                "[tool:pytest]\naddopts = -v\n",
            )
            .unwrap();

            let result = detect_test_runner(workspace.path()).unwrap();
            assert!(result.is_some());
            let (_, source) = result.unwrap();
            assert_eq!(source, TestCommandSource::SetupCfgPytest);
        }

        #[test]
        fn detects_tests_directory() {
            let workspace = create_workspace();
            std::fs::create_dir(workspace.path().join("tests")).unwrap();

            let result = detect_test_runner(workspace.path()).unwrap();
            assert!(result.is_some());
            let (_, source) = result.unwrap();
            assert_eq!(source, TestCommandSource::DefaultPytest);
        }

        #[test]
        fn returns_none_when_nothing_found() {
            let workspace = create_workspace();

            let result = detect_test_runner(workspace.path()).unwrap();
            assert!(result.is_none());
        }

        #[test]
        fn priority_order_tug_over_pytest_section() {
            let workspace = create_workspace();
            std::fs::write(
                workspace.path().join("pyproject.toml"),
                r#"
[tool.tug]
test_command = ["custom", "test"]

[tool.pytest.ini_options]
testpaths = ["tests"]
"#,
            )
            .unwrap();

            let result = detect_test_runner(workspace.path()).unwrap();
            assert!(result.is_some());
            let (cmd, source) = result.unwrap();
            assert_eq!(cmd, vec!["custom", "test"]);
            assert_eq!(source, TestCommandSource::PyprojectTug);
        }
    }

    mod resolve_test_command_tests {
        use super::*;

        fn create_workspace() -> TempDir {
            TempDir::new().unwrap()
        }

        #[test]
        fn cli_flag_takes_priority() {
            let workspace = create_workspace();
            // Create pyproject.toml with pytest section
            std::fs::write(
                workspace.path().join("pyproject.toml"),
                "[tool.pytest.ini_options]\n",
            )
            .unwrap();

            let vars = TemplateVars::new(
                Some("/usr/bin/python3".to_string()),
                Some(workspace.path().to_string_lossy().to_string()),
            );

            let result =
                resolve_test_command(Some(r#"["custom", "test"]"#), workspace.path(), &vars)
                    .unwrap();

            assert!(result.is_some());
            let cmd = result.unwrap();
            assert_eq!(cmd.args, vec!["custom", "test"]);
            assert_eq!(cmd.source, TestCommandSource::CliFlag);
        }

        #[test]
        fn falls_back_to_detection() {
            let workspace = create_workspace();
            std::fs::write(workspace.path().join("pytest.ini"), "[pytest]\n").unwrap();

            let vars = TemplateVars::new(Some("/usr/bin/python3".to_string()), None);

            let result = resolve_test_command(None, workspace.path(), &vars).unwrap();

            assert!(result.is_some());
            let cmd = result.unwrap();
            assert_eq!(cmd.args, vec!["/usr/bin/python3", "-m", "pytest"]);
            assert_eq!(cmd.source, TestCommandSource::PytestIni);
        }

        #[test]
        fn returns_none_when_nothing_found() {
            let workspace = create_workspace();

            let vars = TemplateVars::new(None, None);

            let result = resolve_test_command(None, workspace.path(), &vars).unwrap();
            assert!(result.is_none());
        }
    }

    mod test_command_source_display {
        use super::*;

        #[test]
        fn display_all_sources() {
            assert_eq!(
                format!("{}", TestCommandSource::CliFlag),
                "--test-command flag"
            );
            assert_eq!(
                format!("{}", TestCommandSource::PyprojectTug),
                "pyproject.toml [tool.tug]"
            );
            assert_eq!(
                format!("{}", TestCommandSource::PyprojectPytest),
                "pyproject.toml [tool.pytest]"
            );
            assert_eq!(format!("{}", TestCommandSource::PytestIni), "pytest.ini");
            assert_eq!(
                format!("{}", TestCommandSource::SetupCfgPytest),
                "setup.cfg [pytest]"
            );
            assert_eq!(
                format!("{}", TestCommandSource::DefaultPytest),
                "default (tests/ directory)"
            );
        }
    }
}
