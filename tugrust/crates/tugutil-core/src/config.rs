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

fn default_validation_level() -> String {
    "normal".to_string()
}

fn default_prefix() -> String {
    "tugplan-".to_string()
}

fn default_name_pattern() -> String {
    "^[a-z][a-z0-9-]{1,49}$".to_string()
}

impl Default for TugConfig {
    fn default() -> Self {
        Self {
            validation_level: default_validation_level(),
            show_info: false,
            naming: NamingConfig::default(),
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
pub const RESERVED_FILES: &[&str] = &["tugplan-implementation-log.md"];

/// Directories searched for plan files, in priority order.
///
/// `.tugtool/` is the canonical directory (and also marks the project root).
/// `roadmap/` is searched as a secondary location for longer-lived or
/// proposed plans. Lookups try directories in this order, so an entry in
/// `.tugtool/` takes precedence over an entry with the same filename in
/// `roadmap/`.
pub const PLAN_SEARCH_DIRS: &[&str] = &[".tugtool", "roadmap"];

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

/// Find all plan files in the project plan directories
///
/// Per [D03], plan files match the configured prefix (e.g. plan-*.md) except reserved files.
/// Searches every directory listed in [`PLAN_SEARCH_DIRS`]. `.tugtool/` must exist (it
/// defines the project root); secondary directories like `roadmap/` are scanned only if
/// present.
pub fn find_tugplans(project_root: &Path) -> Result<Vec<PathBuf>, TugError> {
    let primary_dir = project_root.join(PLAN_SEARCH_DIRS[0]);
    if !primary_dir.is_dir() {
        return Err(TugError::NotInitialized);
    }

    let mut tugplans = Vec::new();
    for search_dir in PLAN_SEARCH_DIRS {
        let dir = project_root.join(search_dir);
        if !dir.is_dir() {
            continue;
        }
        tugplans.extend(find_tugplans_in_dir(&dir)?);
    }

    // Sort by full path for consistent ordering
    tugplans.sort();
    Ok(tugplans)
}

/// Enumerate plan files in a single directory. Returns only files matching
/// `tugplan-*.md` and not in [`RESERVED_FILES`].
fn find_tugplans_in_dir(dir: &Path) -> Result<Vec<PathBuf>, TugError> {
    let mut tugplans = Vec::new();
    let entries = fs::read_dir(dir).map_err(TugError::Io)?;

    for entry in entries {
        let entry = entry.map_err(TugError::Io)?;
        let path = entry.path();
        if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
            if filename.starts_with("tugplan-")
                && filename.ends_with(".md")
                && !is_reserved_file(filename)
            {
                tugplans.push(path);
            }
        }
    }

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
    }
}
