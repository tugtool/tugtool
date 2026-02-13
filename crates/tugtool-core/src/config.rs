//! Configuration handling for tug

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::TugError;

/// Tug configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    /// Tugtool-specific settings
    #[serde(default, alias = "tug")]
    pub tugtool: TugConfig,
}

/// Core tug settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TugConfig {
    /// Validation strictness level
    #[serde(default = "default_validation_level")]
    pub validation_level: String,

    /// Include info-level messages in validation output
    #[serde(default)]
    pub show_info: bool,

    /// Naming settings
    #[serde(default)]
    pub naming: NamingConfig,

    /// Beads integration settings
    #[serde(default)]
    pub beads: BeadsConfig,
}

/// Naming configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NamingConfig {
    /// Plan file prefix
    #[serde(default = "default_prefix")]
    pub prefix: String,

    /// Allowed name pattern (regex)
    #[serde(default = "default_name_pattern")]
    pub name_pattern: String,
}

/// Beads integration configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BeadsConfig {
    /// Enable beads integration
    #[serde(default = "default_beads_enabled")]
    pub enabled: bool,

    /// Validate bead IDs when present
    #[serde(default = "default_validate_bead_ids")]
    pub validate_bead_ids: bool,

    /// Path to beads CLI binary
    #[serde(default = "default_bd_path")]
    pub bd_path: String,

    /// Update titles on sync
    #[serde(default)]
    pub update_title: bool,

    /// Update body on sync
    #[serde(default)]
    pub update_body: bool,

    /// Prune deps on sync
    #[serde(default)]
    pub prune_deps: bool,

    /// Root issue type
    #[serde(default = "default_root_issue_type")]
    pub root_issue_type: String,

    /// Substep mapping mode
    #[serde(default = "default_substeps")]
    pub substeps: String,

    /// Pull checkbox mode
    #[serde(default = "default_pull_checkbox_mode")]
    pub pull_checkbox_mode: String,

    /// Warn on conflict during pull
    #[serde(default = "default_pull_warn")]
    pub pull_warn_on_conflict: bool,
}

fn default_validation_level() -> String {
    "normal".to_string()
}

fn default_prefix() -> String {
    "tugplan-".to_string()
}

fn default_name_pattern() -> String {
    "^[a-z][a-z0-9-]{1,49}$".to_string()
}

fn default_beads_enabled() -> bool {
    true
}

fn default_validate_bead_ids() -> bool {
    true
}

fn default_bd_path() -> String {
    "bd".to_string()
}

fn default_root_issue_type() -> String {
    "epic".to_string()
}

fn default_substeps() -> String {
    "none".to_string()
}

fn default_pull_checkbox_mode() -> String {
    "checkpoints".to_string()
}

fn default_pull_warn() -> bool {
    true
}

impl Default for TugConfig {
    fn default() -> Self {
        Self {
            validation_level: default_validation_level(),
            show_info: false,
            naming: NamingConfig::default(),
            beads: BeadsConfig::default(),
        }
    }
}

impl Default for NamingConfig {
    fn default() -> Self {
        Self {
            prefix: default_prefix(),
            name_pattern: default_name_pattern(),
        }
    }
}

impl Default for BeadsConfig {
    fn default() -> Self {
        Self {
            enabled: default_beads_enabled(),
            validate_bead_ids: default_validate_bead_ids(),
            bd_path: default_bd_path(),
            update_title: false,
            update_body: false,
            prune_deps: false,
            root_issue_type: default_root_issue_type(),
            substeps: default_substeps(),
            pull_checkbox_mode: default_pull_checkbox_mode(),
            pull_warn_on_conflict: default_pull_warn(),
        }
    }
}

impl Config {
    /// Load configuration from a file
    pub fn load(path: &Path) -> Result<Self, TugError> {
        let content = fs::read_to_string(path)
            .map_err(|e| TugError::Config(format!("failed to read config file: {}", e)))?;
        toml::from_str(&content)
            .map_err(|e| TugError::Config(format!("failed to parse config file: {}", e)))
    }

    /// Load configuration from .tug/config.toml in the given project root
    pub fn load_from_project(project_root: &Path) -> Result<Self, TugError> {
        let config_path = project_root.join(".tugtool").join("config.toml");
        if config_path.exists() {
            Self::load(&config_path)
        } else {
            Ok(Config::default())
        }
    }
}

/// Reserved file names that are not treated as plan files
pub const RESERVED_FILES: &[&str] = &["tugplan-skeleton.md", "tugplan-implementation-log.md"];

/// Check if a filename is reserved (not a plan file)
pub fn is_reserved_file(filename: &str) -> bool {
    RESERVED_FILES.contains(&filename)
}

/// Find the project root by searching upward for `.tug/` directory
///
/// Per [D07], commands search upward from current working directory to find
/// `.tug/` directory, stopping at filesystem root.
pub fn find_project_root() -> Result<PathBuf, TugError> {
    find_project_root_from(
        std::env::current_dir()
            .map_err(|e| TugError::Config(format!("failed to get current directory: {}", e)))?,
    )
}

/// Find the project root starting from a specific directory
pub fn find_project_root_from(start: PathBuf) -> Result<PathBuf, TugError> {
    let mut current = start;
    loop {
        let tugtool_dir = current.join(".tugtool");
        if tugtool_dir.is_dir() {
            return Ok(current);
        }
        match current.parent() {
            Some(parent) => current = parent.to_path_buf(),
            None => return Err(TugError::NotInitialized),
        }
    }
}

/// Find all plan files in the project plan directory
///
/// Per [D03], plan files match the configured prefix (e.g. plan-*.md) except reserved files.
pub fn find_tugplans(project_root: &Path) -> Result<Vec<PathBuf>, TugError> {
    let tugplan_dir = project_root.join(".tugtool");
    if !tugplan_dir.is_dir() {
        return Err(TugError::NotInitialized);
    }

    let mut tugplans = Vec::new();
    let entries = fs::read_dir(&tugplan_dir).map_err(TugError::Io)?;

    for entry in entries {
        let entry = entry.map_err(TugError::Io)?;
        let path = entry.path();
        if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
            // Check if it matches tugplan-*.md pattern and is not reserved
            if filename.starts_with("tugplan-")
                && filename.ends_with(".md")
                && !is_reserved_file(filename)
            {
                tugplans.push(path);
            }
        }
    }

    // Sort by filename for consistent ordering
    tugplans.sort();
    Ok(tugplans)
}

/// Extract plan name from filename (remove prefix and extension)
///
/// e.g., "tugplan-1.md" -> "1", "plan-feature-x.md" -> "feature-x"
pub fn tugplan_name_from_path(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|n| n.to_str())
        .and_then(|filename| {
            if filename.starts_with("tugplan-") && filename.ends_with(".md") {
                let name = &filename[8..filename.len() - 3]; // Remove "tugplan-" and ".md"
                if !name.is_empty() {
                    return Some(name.to_string());
                }
            }
            None
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_reserved_file() {
        assert!(is_reserved_file("tugplan-skeleton.md"));
        assert!(is_reserved_file("tugplan-implementation-log.md"));
        assert!(!is_reserved_file("tugplan-1.md"));
        assert!(!is_reserved_file("tugplan-feature.md"));
    }

    #[test]
    fn test_tugplan_name_from_path() {
        assert_eq!(
            tugplan_name_from_path(Path::new("tugplan-1.md")),
            Some("1".to_string())
        );
        assert_eq!(
            tugplan_name_from_path(Path::new("tugplan-feature-x.md")),
            Some("feature-x".to_string())
        );
        assert_eq!(
            tugplan_name_from_path(Path::new(".tugtool/tugplan-refactor.md")),
            Some("refactor".to_string())
        );
        assert_eq!(tugplan_name_from_path(Path::new("other.md")), None);
        assert_eq!(tugplan_name_from_path(Path::new("tugplan-.md")), None);
    }

    #[test]
    fn test_default_config() {
        let config = Config::default();
        assert_eq!(config.tugtool.validation_level, "normal");
        assert!(!config.tugtool.show_info);
        assert_eq!(config.tugtool.naming.prefix, "tugplan-");
        assert!(config.tugtool.beads.enabled);
    }
}
