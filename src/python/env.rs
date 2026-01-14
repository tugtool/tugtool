//! Python environment resolution.
//!
//! This module implements Python interpreter discovery and validation.
//!
//! ## Resolution Order
//!
//! 1. Explicit `--python` flag (CLI override)
//! 2. `$TUG_PYTHON` environment variable
//! 3. Session cache (`.tug/python/config.json` if valid)
//! 4. `$VIRTUAL_ENV/bin/python` (user's active venv)
//! 5. `$CONDA_PREFIX/bin/python` (user's active conda)
//! 6. Managed venv at `.tug/venv` (bootstrapped by tug)
//! 7. `python3` from `$PATH` (fallback)
//!
//! ## Validation
//!
//! - Python version >= 3.9
//! - LibCST availability (when `require_libcst` is set)
//!
//! ## Session Persistence
//!
//! - Store resolved interpreter in `.tug/python/config.json`
//! - All subsequent calls use the persisted interpreter (if still valid)
//! - Config includes schema version for forward compatibility

use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;
use thiserror::Error;

// ============================================================================
// Error Types
// ============================================================================

/// A single step in the resolution process.
#[derive(Debug, Clone)]
pub struct ResolutionStep {
    /// Source being checked (e.g., "$TUG_PYTHON", "$PATH").
    pub source: String,
    /// What was found (if anything).
    pub found: Option<PathBuf>,
    /// Version found (if applicable).
    pub version: Option<String>,
    /// Why this step failed (if it failed).
    pub failure_reason: Option<String>,
}

impl ResolutionStep {
    /// Create a step that was not attempted (env var not set, etc).
    pub fn not_set(source: impl Into<String>) -> Self {
        ResolutionStep {
            source: source.into(),
            found: None,
            version: None,
            failure_reason: Some("not set".to_string()),
        }
    }

    /// Create a step where path was not found.
    pub fn not_found(source: impl Into<String>) -> Self {
        ResolutionStep {
            source: source.into(),
            found: None,
            version: None,
            failure_reason: Some("not found".to_string()),
        }
    }

    /// Create a step where Python was found but version was too old.
    pub fn version_too_old(
        source: impl Into<String>,
        path: PathBuf,
        version: impl Into<String>,
    ) -> Self {
        let version = version.into();
        ResolutionStep {
            source: source.into(),
            found: Some(path),
            version: Some(version.clone()),
            failure_reason: Some(format!("version {} is too old (need 3.9+)", version)),
        }
    }

    /// Create a step where Python was found but libcst was missing.
    pub fn libcst_missing(
        source: impl Into<String>,
        path: PathBuf,
        version: impl Into<String>,
    ) -> Self {
        ResolutionStep {
            source: source.into(),
            found: Some(path),
            version: Some(version.into()),
            failure_reason: Some("libcst not installed".to_string()),
        }
    }

    /// Create a successful step (not typically used, but for completeness).
    pub fn success(source: impl Into<String>, path: PathBuf, version: impl Into<String>) -> Self {
        ResolutionStep {
            source: source.into(),
            found: Some(path),
            version: Some(version.into()),
            failure_reason: None,
        }
    }
}

impl std::fmt::Display for ResolutionStep {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: ", self.source)?;
        if let Some(ref path) = self.found {
            write!(f, "found {}", path.display())?;
            if let Some(ref version) = self.version {
                write!(f, " ({})", version)?;
            }
            if let Some(ref reason) = self.failure_reason {
                write!(f, " - {}", reason)?;
            }
        } else if let Some(ref reason) = self.failure_reason {
            write!(f, "{}", reason)?;
        }
        Ok(())
    }
}

/// Trace of all resolution steps attempted.
#[derive(Debug, Clone, Default)]
pub struct ResolutionTrace {
    /// Steps attempted during resolution.
    pub steps: Vec<ResolutionStep>,
}

impl ResolutionTrace {
    /// Create a new empty trace.
    pub fn new() -> Self {
        ResolutionTrace { steps: Vec::new() }
    }

    /// Add a step to the trace.
    pub fn add(&mut self, step: ResolutionStep) {
        self.steps.push(step);
    }

    /// Format the trace for display.
    pub fn format_trace(&self) -> String {
        let mut output = String::new();
        for (i, step) in self.steps.iter().enumerate() {
            output.push_str(&format!("  {}. {}\n", i + 1, step));
        }
        output
    }
}

/// Errors that can occur during Python environment resolution.
#[derive(Debug, Error)]
pub enum PythonEnvError {
    /// No Python interpreter found.
    #[error("{}", format_python_not_found_error(.searched, .trace))]
    PythonNotFound {
        searched: Vec<String>,
        trace: Option<ResolutionTrace>,
    },

    /// Python version is too old.
    #[error("Python version {found} is too old (minimum: {minimum})")]
    VersionTooOld { found: String, minimum: String },

    /// LibCST is not installed.
    #[error("{}", format_libcst_not_available_error(.python_path))]
    LibCSTNotAvailable { python_path: PathBuf },

    /// Failed to execute Python.
    #[error("failed to execute Python at {path}: {reason}")]
    ExecutionFailed { path: PathBuf, reason: String },

    /// IO error.
    #[error("IO error: {0}")]
    Io(#[from] io::Error),

    /// JSON serialization/deserialization error.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    /// Python binary exists but is not executable.
    #[error("Python at {path} is not executable")]
    NotExecutable { path: PathBuf },

    /// Invalid Python version string.
    #[error("invalid Python version string: {version}")]
    InvalidVersion { version: String },
}

/// Format the "Python not found" error with actionable remediation.
fn format_python_not_found_error(searched: &[String], trace: &Option<ResolutionTrace>) -> String {
    let mut msg = String::from("no Python interpreter found\n\n");
    msg.push_str("tug requires Python 3.9+ with libcst installed.\n\n");

    if let Some(ref trace) = trace {
        msg.push_str("Resolution attempted:\n");
        msg.push_str(&trace.format_trace());
        msg.push('\n');
    } else if !searched.is_empty() {
        msg.push_str("Resolution attempted:\n");
        for (i, s) in searched.iter().enumerate() {
            msg.push_str(&format!("  {}. {}\n", i + 1, s));
        }
        msg.push('\n');
    }

    msg.push_str("Remediation:\n");
    msg.push_str("  a) Run: tug toolchain python setup\n");
    msg.push_str("  b) Install libcst: pip install libcst && export TUG_PYTHON=$(which python3)\n");
    msg.push_str("  c) Use specific Python: tug --toolchain python=/path/to/python3.11 ...\n");

    msg
}

/// Format the "libcst not available" error with actionable remediation.
fn format_libcst_not_available_error(python_path: &Path) -> String {
    let mut msg = format!(
        "libcst not installed in Python at {}\n\n",
        python_path.display()
    );

    msg.push_str("Remediation:\n");
    msg.push_str(&format!(
        "  {} -m pip install libcst\n\n",
        python_path.display()
    ));
    msg.push_str("Or let tug manage its own environment:\n");
    msg.push_str("  tug toolchain python setup\n");

    msg
}

/// Result type for Python environment operations.
pub type PythonEnvResult<T> = Result<T, PythonEnvError>;

// ============================================================================
// Python Version
// ============================================================================

/// Parsed Python version.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct PythonVersion {
    /// Major version (e.g., 3).
    pub major: u32,
    /// Minor version (e.g., 11).
    pub minor: u32,
    /// Patch version (e.g., 4).
    pub patch: u32,
}

impl PythonVersion {
    /// Create a new Python version.
    pub fn new(major: u32, minor: u32, patch: u32) -> Self {
        PythonVersion {
            major,
            minor,
            patch,
        }
    }

    /// Minimum required Python version (3.9.0).
    pub fn minimum() -> Self {
        PythonVersion::new(3, 9, 0)
    }

    /// Parse a version string like "3.11.4" or "Python 3.11.4".
    pub fn parse(version_str: &str) -> PythonEnvResult<Self> {
        // Strip "Python " prefix if present
        let version_str = version_str
            .strip_prefix("Python ")
            .unwrap_or(version_str)
            .trim();

        // Split on dots and parse
        let parts: Vec<&str> = version_str.split('.').collect();

        if parts.len() < 2 {
            return Err(PythonEnvError::InvalidVersion {
                version: version_str.to_string(),
            });
        }

        let major = parts[0]
            .parse::<u32>()
            .map_err(|_| PythonEnvError::InvalidVersion {
                version: version_str.to_string(),
            })?;

        let minor = parts[1]
            .parse::<u32>()
            .map_err(|_| PythonEnvError::InvalidVersion {
                version: version_str.to_string(),
            })?;

        // Patch might have additional suffix like "3.11.4+" or "3.11.4rc1"
        let patch_str = parts.get(2).unwrap_or(&"0");
        // Take only the leading digits
        let patch_digits: String = patch_str
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        let patch = patch_digits.parse::<u32>().unwrap_or(0);

        Ok(PythonVersion {
            major,
            minor,
            patch,
        })
    }

    /// Check if this version meets the minimum requirement.
    pub fn meets_minimum(&self) -> bool {
        *self >= Self::minimum()
    }
}

impl std::fmt::Display for PythonVersion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

// ============================================================================
// Resolution Source
// ============================================================================

/// Where the Python interpreter was resolved from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolutionSource {
    /// From explicit `--python` flag.
    CliFlag,
    /// From `$TUG_PYTHON` environment variable.
    EnvTugPython,
    /// Loaded from session config.
    SessionConfig,
    /// From `$VIRTUAL_ENV/bin/python`.
    VirtualEnv,
    /// From `$CONDA_PREFIX/bin/python`.
    CondaPrefix,
    /// From managed venv at `.tug/venv`.
    ManagedVenv,
    /// From `python3` in `$PATH`.
    Path,
}

impl std::fmt::Display for ResolutionSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ResolutionSource::CliFlag => write!(f, "--python flag"),
            ResolutionSource::EnvTugPython => write!(f, "$TUG_PYTHON"),
            ResolutionSource::SessionConfig => write!(f, "session config"),
            ResolutionSource::VirtualEnv => write!(f, "$VIRTUAL_ENV"),
            ResolutionSource::CondaPrefix => write!(f, "$CONDA_PREFIX"),
            ResolutionSource::ManagedVenv => write!(f, ".tug/venv"),
            ResolutionSource::Path => write!(f, "$PATH"),
        }
    }
}

// ============================================================================
// Python Config
// ============================================================================

/// Schema version for PythonConfig format.
pub const PYTHON_CONFIG_SCHEMA_VERSION: u32 = 2;

/// Persisted Python configuration (python/config.json).
///
/// This is stored in `.tug/python/config.json` and contains
/// the resolved Python interpreter and metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PythonConfig {
    /// Schema version for forward compatibility.
    /// Version 1: original format
    /// Version 2: added is_managed_venv, base_python_path
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    /// Absolute path to the Python interpreter.
    pub interpreter_path: PathBuf,
    /// Python version string (e.g., "3.11.4").
    pub version: String,
    /// Parsed Python version.
    pub parsed_version: PythonVersion,
    /// Whether LibCST is available.
    pub libcst_available: bool,
    /// LibCST version (if available).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub libcst_version: Option<String>,
    /// When the interpreter was resolved.
    pub resolved_at: String,
    /// Where the interpreter was found.
    pub resolution_source: ResolutionSource,
    /// Whether this is from a managed venv (.tug/venv).
    #[serde(default)]
    pub is_managed_venv: bool,
    /// Base Python used to create managed venv (if applicable).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_python_path: Option<PathBuf>,
}

fn default_schema_version() -> u32 {
    1 // Old configs without schema_version are v1
}

impl PythonConfig {
    /// Load Python config from session directory.
    pub fn load(session_dir: &Path) -> PythonEnvResult<Option<Self>> {
        let config_path = session_dir.join("python").join("config.json");

        if !config_path.exists() {
            return Ok(None);
        }

        let content = std::fs::read_to_string(&config_path)?;
        let config: PythonConfig = serde_json::from_str(&content)?;
        Ok(Some(config))
    }

    /// Save Python config to session directory.
    pub fn save(&self, session_dir: &Path) -> PythonEnvResult<()> {
        let python_dir = session_dir.join("python");
        std::fs::create_dir_all(&python_dir)?;

        let config_path = python_dir.join("config.json");
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(&config_path, content)?;

        Ok(())
    }

    /// Validate that the stored interpreter is still valid.
    pub fn validate(&self) -> PythonEnvResult<bool> {
        // Check interpreter still exists and is executable
        if !self.interpreter_path.exists() {
            return Ok(false);
        }

        // Quick version check
        if let Ok(version) = get_python_version(&self.interpreter_path) {
            Ok(version == self.parsed_version)
        } else {
            Ok(false)
        }
    }
}

// ============================================================================
// Python Environment
// ============================================================================

/// Resolved Python environment.
///
/// This represents a validated Python interpreter that can be used
/// for LibCST operations and verification.
#[derive(Debug, Clone)]
pub struct PythonEnv {
    /// Configuration (saved to disk).
    pub config: PythonConfig,
}

impl PythonEnv {
    /// Get the Python interpreter path.
    pub fn interpreter(&self) -> &Path {
        &self.config.interpreter_path
    }

    /// Get the Python version.
    pub fn version(&self) -> &PythonVersion {
        &self.config.parsed_version
    }

    /// Check if LibCST is available.
    pub fn has_libcst(&self) -> bool {
        self.config.libcst_available
    }

    /// Get LibCST version if available.
    pub fn libcst_version(&self) -> Option<&str> {
        self.config.libcst_version.as_deref()
    }

    /// Get where the interpreter was resolved from.
    pub fn source(&self) -> ResolutionSource {
        self.config.resolution_source
    }
}

// ============================================================================
// Resolution Options
// ============================================================================

/// Options for resolving Python environment.
#[derive(Debug, Clone, Default)]
pub struct ResolutionOptions {
    /// Explicit Python path (from --python flag).
    pub python_path: Option<PathBuf>,
    /// Require LibCST to be installed.
    pub require_libcst: bool,
}

impl ResolutionOptions {
    /// Create options with explicit Python path.
    pub fn with_python(path: impl Into<PathBuf>) -> Self {
        ResolutionOptions {
            python_path: Some(path.into()),
            require_libcst: false,
        }
    }

    /// Require LibCST to be installed.
    pub fn require_libcst(mut self) -> Self {
        self.require_libcst = true;
        self
    }
}

// ============================================================================
// Resolution Functions
// ============================================================================

/// Platform-specific Python binary names.
#[cfg(windows)]
pub(crate) const PYTHON_NAMES: &[&str] = &["python.exe", "python3.exe", "py.exe"];

#[cfg(not(windows))]
pub(crate) const PYTHON_NAMES: &[&str] = &["python3", "python"];

/// Platform-specific path separator for virtual environments.
#[cfg(windows)]
pub(crate) const VENV_BIN_DIR: &str = "Scripts";

#[cfg(not(windows))]
pub(crate) const VENV_BIN_DIR: &str = "bin";

/// Get the path to the managed venv Python interpreter.
///
/// The managed venv is stored at `<session_dir>/venv/bin/python` (Unix)
/// or `<session_dir>/venv/Scripts/python.exe` (Windows).
pub fn managed_venv_python_path(session_dir: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        session_dir
            .join("venv")
            .join(VENV_BIN_DIR)
            .join("python.exe")
    }
    #[cfg(not(windows))]
    {
        session_dir.join("venv").join(VENV_BIN_DIR).join("python")
    }
}

/// Get the path to the managed venv directory.
pub fn managed_venv_dir(session_dir: &Path) -> PathBuf {
    session_dir.join("venv")
}

/// Resolve Python environment from session or by discovery.
///
/// This function:
/// 1. Checks if Python config exists in session (returns cached if valid)
/// 2. Otherwise, resolves Python using the resolution order
/// 3. Validates version and LibCST availability
/// 4. Saves config to session
pub fn resolve_python(
    session_dir: &Path,
    options: &ResolutionOptions,
) -> PythonEnvResult<PythonEnv> {
    // Check for existing config in session
    if let Some(config) = PythonConfig::load(session_dir)? {
        // Validate the cached config is still valid
        if config.validate()? {
            // If we have an explicit --python, only use cache if it matches
            if let Some(ref explicit_path) = options.python_path {
                let canonical_explicit = explicit_path
                    .canonicalize()
                    .unwrap_or_else(|_| explicit_path.clone());
                let canonical_cached = config
                    .interpreter_path
                    .canonicalize()
                    .unwrap_or_else(|_| config.interpreter_path.clone());

                if canonical_explicit != canonical_cached {
                    // User specified different Python, resolve fresh
                    return resolve_python_fresh(session_dir, options);
                }
            }

            return Ok(PythonEnv { config });
        }
    }

    // Resolve fresh
    resolve_python_fresh(session_dir, options)
}

/// Resolve Python environment without checking session cache.
pub fn resolve_python_fresh(
    session_dir: &Path,
    options: &ResolutionOptions,
) -> PythonEnvResult<PythonEnv> {
    let mut trace = ResolutionTrace::new();

    // Resolution order per Table T03:
    // 1. Explicit --python flag
    if let Some(ref path) = options.python_path {
        let canonical = path
            .canonicalize()
            .map_err(|_| PythonEnvError::ExecutionFailed {
                path: path.clone(),
                reason: "path does not exist".to_string(),
            })?;

        return validate_and_create_env(canonical, ResolutionSource::CliFlag, session_dir, options);
    }
    trace.add(ResolutionStep::not_set("--python flag"));

    // 2. $TUG_PYTHON environment variable
    if let Ok(path_str) = std::env::var("TUG_PYTHON") {
        let path = PathBuf::from(&path_str);
        if !path.exists() {
            trace.add(ResolutionStep {
                source: "$TUG_PYTHON".to_string(),
                found: Some(path.clone()),
                version: None,
                failure_reason: Some("path does not exist".to_string()),
            });
        } else if let Ok(canonical) = path.canonicalize() {
            if !is_executable(&canonical) {
                trace.add(ResolutionStep {
                    source: "$TUG_PYTHON".to_string(),
                    found: Some(canonical),
                    version: None,
                    failure_reason: Some("not executable".to_string()),
                });
            } else {
                match try_validate_python(&canonical, session_dir, options) {
                    Ok(env) => return Ok(env),
                    Err(step) => trace.add(step),
                }
            }
        }
    } else {
        trace.add(ResolutionStep::not_set("$TUG_PYTHON"));
    }

    // 3. $VIRTUAL_ENV/bin/python
    if let Ok(venv_path) = std::env::var("VIRTUAL_ENV") {
        let venv_path = PathBuf::from(&venv_path);
        let mut found_any = false;

        for name in PYTHON_NAMES {
            let python_path = venv_path.join(VENV_BIN_DIR).join(name);
            if python_path.exists() {
                found_any = true;
                if let Ok(canonical) = python_path.canonicalize() {
                    if is_executable(&canonical) {
                        match try_validate_python(&canonical, session_dir, options) {
                            Ok(env) => return Ok(env),
                            Err(step) => trace.add(step),
                        }
                    }
                }
            }
        }

        if !found_any {
            trace.add(ResolutionStep::not_found("$VIRTUAL_ENV"));
        }
    } else {
        trace.add(ResolutionStep::not_set("$VIRTUAL_ENV"));
    }

    // 4. $CONDA_PREFIX/bin/python
    if let Ok(conda_path) = std::env::var("CONDA_PREFIX") {
        let conda_path = PathBuf::from(&conda_path);
        let mut found_any = false;

        for name in PYTHON_NAMES {
            let python_path = conda_path.join(VENV_BIN_DIR).join(name);
            if python_path.exists() {
                found_any = true;
                if let Ok(canonical) = python_path.canonicalize() {
                    if is_executable(&canonical) {
                        match try_validate_python(&canonical, session_dir, options) {
                            Ok(env) => return Ok(env),
                            Err(step) => trace.add(step),
                        }
                    }
                }
            }
        }

        if !found_any {
            trace.add(ResolutionStep::not_found("$CONDA_PREFIX"));
        }
    } else {
        trace.add(ResolutionStep::not_set("$CONDA_PREFIX"));
    }

    // 5. Managed venv at .tug/venv
    let managed_venv_path = managed_venv_python_path(session_dir);

    if managed_venv_path.exists() {
        if let Ok(canonical) = managed_venv_path.canonicalize() {
            if is_executable(&canonical) {
                match try_validate_python(&canonical, session_dir, options) {
                    Ok(env) => return Ok(env),
                    Err(step) => trace.add(step),
                }
            } else {
                trace.add(ResolutionStep {
                    source: ".tug/venv".to_string(),
                    found: Some(canonical),
                    version: None,
                    failure_reason: Some("not executable".to_string()),
                });
            }
        }
    } else {
        trace.add(ResolutionStep::not_found(".tug/venv"));
    }

    // 6. python3/python from $PATH
    let mut found_any_path = false;
    for name in PYTHON_NAMES {
        if let Ok(path) = which::which(name) {
            found_any_path = true;
            if let Ok(canonical) = path.canonicalize() {
                if is_executable(&canonical) {
                    match try_validate_python(&canonical, session_dir, options) {
                        Ok(env) => return Ok(env),
                        Err(step) => trace.add(step),
                    }
                }
            }
        }
    }

    if !found_any_path {
        trace.add(ResolutionStep::not_found("$PATH (python3/python)"));
    }

    Err(PythonEnvError::PythonNotFound {
        searched: trace.steps.iter().map(|s| s.to_string()).collect(),
        trace: Some(trace),
    })
}

/// Try to validate a Python interpreter and return the env or a detailed step on failure.
fn try_validate_python(
    path: &Path,
    session_dir: &Path,
    options: &ResolutionOptions,
) -> Result<PythonEnv, ResolutionStep> {
    // Determine source name from path
    let source = if path.to_string_lossy().contains(".tug/venv") {
        ".tug/venv"
    } else if std::env::var("VIRTUAL_ENV")
        .map(|v| path.starts_with(&v))
        .unwrap_or(false)
    {
        "$VIRTUAL_ENV"
    } else if std::env::var("CONDA_PREFIX")
        .map(|v| path.starts_with(&v))
        .unwrap_or(false)
    {
        "$CONDA_PREFIX"
    } else if std::env::var("TUG_PYTHON")
        .map(|v| path == Path::new(&v))
        .unwrap_or(false)
    {
        "$TUG_PYTHON"
    } else {
        "$PATH"
    };

    // Get version
    let version = match get_python_version(path) {
        Ok(v) => v,
        Err(_) => {
            return Err(ResolutionStep {
                source: source.to_string(),
                found: Some(path.to_path_buf()),
                version: None,
                failure_reason: Some("failed to get version".to_string()),
            });
        }
    };

    let version_str = version.to_string();

    // Check minimum version
    if !version.meets_minimum() {
        return Err(ResolutionStep::version_too_old(
            source,
            path.to_path_buf(),
            &version_str,
        ));
    }

    // Check LibCST availability if required
    if options.require_libcst {
        let (libcst_available, _) = check_libcst(path).unwrap_or((false, None));
        if !libcst_available {
            return Err(ResolutionStep::libcst_missing(
                source,
                path.to_path_buf(),
                &version_str,
            ));
        }
    }

    // All checks passed, create the environment
    // Determine resolution source properly
    let resolution_source = if path.to_string_lossy().contains(".tug/venv") {
        ResolutionSource::ManagedVenv
    } else if std::env::var("VIRTUAL_ENV")
        .map(|v| path.starts_with(&v))
        .unwrap_or(false)
    {
        ResolutionSource::VirtualEnv
    } else if std::env::var("CONDA_PREFIX")
        .map(|v| path.starts_with(&v))
        .unwrap_or(false)
    {
        ResolutionSource::CondaPrefix
    } else if std::env::var("TUG_PYTHON")
        .map(|v| path == Path::new(&v))
        .unwrap_or(false)
    {
        ResolutionSource::EnvTugPython
    } else {
        ResolutionSource::Path
    };

    validate_and_create_env(path.to_path_buf(), resolution_source, session_dir, options).map_err(
        |e| ResolutionStep {
            source: source.to_string(),
            found: Some(path.to_path_buf()),
            version: Some(version_str),
            failure_reason: Some(e.to_string()),
        },
    )
}

/// Validate Python interpreter and create environment.
fn validate_and_create_env(
    path: PathBuf,
    source: ResolutionSource,
    session_dir: &Path,
    options: &ResolutionOptions,
) -> PythonEnvResult<PythonEnv> {
    // Get version
    let version = get_python_version(&path)?;
    let version_str = version.to_string();

    // Check minimum version
    if !version.meets_minimum() {
        return Err(PythonEnvError::VersionTooOld {
            found: version_str,
            minimum: PythonVersion::minimum().to_string(),
        });
    }

    // Check LibCST availability
    let (libcst_available, libcst_version) = check_libcst(&path)?;

    if options.require_libcst && !libcst_available {
        return Err(PythonEnvError::LibCSTNotAvailable {
            python_path: path.clone(),
        });
    }

    // Determine if this is a managed venv
    let is_managed_venv = source == ResolutionSource::ManagedVenv;

    // Create config
    let config = PythonConfig {
        schema_version: PYTHON_CONFIG_SCHEMA_VERSION,
        interpreter_path: path,
        version: version_str,
        parsed_version: version,
        libcst_available,
        libcst_version,
        resolved_at: format_timestamp(SystemTime::now()),
        resolution_source: source,
        is_managed_venv,
        base_python_path: None, // Set by bootstrap when creating managed venv
    };

    // Save to session
    config.save(session_dir)?;

    Ok(PythonEnv { config })
}

/// Get Python version by running `python --version`.
pub fn get_python_version(python_path: &Path) -> PythonEnvResult<PythonVersion> {
    let output = Command::new(python_path)
        .arg("--version")
        .output()
        .map_err(|e| PythonEnvError::ExecutionFailed {
            path: python_path.to_path_buf(),
            reason: e.to_string(),
        })?;

    if !output.status.success() {
        return Err(PythonEnvError::ExecutionFailed {
            path: python_path.to_path_buf(),
            reason: String::from_utf8_lossy(&output.stderr).to_string(),
        });
    }

    // Python --version outputs to stdout (3.4+) or stderr (older)
    let version_output = if output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stderr)
    } else {
        String::from_utf8_lossy(&output.stdout)
    };

    PythonVersion::parse(version_output.trim())
}

/// Check if LibCST is available and get its version.
pub fn check_libcst(python_path: &Path) -> PythonEnvResult<(bool, Option<String>)> {
    // Try to import libcst and get version
    let output = Command::new(python_path)
        .args(["-c", "import libcst; print(libcst.__version__)"])
        .output()
        .map_err(|e| PythonEnvError::ExecutionFailed {
            path: python_path.to_path_buf(),
            reason: e.to_string(),
        })?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok((true, Some(version)))
    } else {
        // Try just importing (might not have __version__)
        let output = Command::new(python_path)
            .args(["-c", "import libcst"])
            .output()
            .map_err(|e| PythonEnvError::ExecutionFailed {
                path: python_path.to_path_buf(),
                reason: e.to_string(),
            })?;

        if output.status.success() {
            Ok((true, None))
        } else {
            Ok((false, None))
        }
    }
}

/// Check if a path is executable.
fn is_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(path) {
            let permissions = metadata.permissions();
            permissions.mode() & 0o111 != 0
        } else {
            false
        }
    }

    #[cfg(windows)]
    {
        // On Windows, check if file exists with executable extension
        path.exists()
            && path
                .extension()
                .map(|ext| {
                    let ext = ext.to_string_lossy().to_lowercase();
                    ext == "exe" || ext == "bat" || ext == "cmd"
                })
                .unwrap_or(false)
    }

    #[cfg(not(any(unix, windows)))]
    {
        path.exists()
    }
}

/// Format a timestamp for JSON output (ISO 8601).
fn format_timestamp(time: SystemTime) -> String {
    use chrono::{DateTime, Utc};

    let datetime: DateTime<Utc> = time.into();
    datetime.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_version_parse() {
        let v = PythonVersion::parse("3.11.4").unwrap();
        assert_eq!(v.major, 3);
        assert_eq!(v.minor, 11);
        assert_eq!(v.patch, 4);

        let v = PythonVersion::parse("Python 3.9.0").unwrap();
        assert_eq!(v.major, 3);
        assert_eq!(v.minor, 9);
        assert_eq!(v.patch, 0);

        let v = PythonVersion::parse("3.12.0rc1").unwrap();
        assert_eq!(v.major, 3);
        assert_eq!(v.minor, 12);
        assert_eq!(v.patch, 0);

        let v = PythonVersion::parse("3.11").unwrap();
        assert_eq!(v.major, 3);
        assert_eq!(v.minor, 11);
        assert_eq!(v.patch, 0);
    }

    #[test]
    fn test_version_comparison() {
        let v39 = PythonVersion::new(3, 9, 0);
        let v310 = PythonVersion::new(3, 10, 0);
        let v311 = PythonVersion::new(3, 11, 4);

        assert!(v39 < v310);
        assert!(v310 < v311);
        assert!(v311 > v39);

        assert!(v39.meets_minimum());
        assert!(v310.meets_minimum());
        assert!(v311.meets_minimum());

        let v38 = PythonVersion::new(3, 8, 0);
        assert!(!v38.meets_minimum());
    }

    #[test]
    fn test_version_display() {
        let v = PythonVersion::new(3, 11, 4);
        assert_eq!(v.to_string(), "3.11.4");
    }

    #[test]
    fn test_config_save_load() {
        let temp = TempDir::new().unwrap();
        let session_dir = temp.path();

        // Create python subdir
        std::fs::create_dir_all(session_dir.join("python")).unwrap();

        let config = PythonConfig {
            schema_version: PYTHON_CONFIG_SCHEMA_VERSION,
            interpreter_path: PathBuf::from("/usr/bin/python3"),
            version: "3.11.4".to_string(),
            parsed_version: PythonVersion::new(3, 11, 4),
            libcst_available: true,
            libcst_version: Some("1.1.0".to_string()),
            resolved_at: "2024-01-15T10:30:00Z".to_string(),
            resolution_source: ResolutionSource::Path,
            is_managed_venv: false,
            base_python_path: None,
        };

        // Save
        config.save(session_dir).unwrap();

        // Load
        let loaded = PythonConfig::load(session_dir).unwrap();
        assert!(loaded.is_some());

        let loaded = loaded.unwrap();
        assert_eq!(loaded.schema_version, PYTHON_CONFIG_SCHEMA_VERSION);
        assert_eq!(loaded.interpreter_path, PathBuf::from("/usr/bin/python3"));
        assert_eq!(loaded.version, "3.11.4");
        assert_eq!(loaded.parsed_version.major, 3);
        assert_eq!(loaded.parsed_version.minor, 11);
        assert!(loaded.libcst_available);
        assert_eq!(loaded.libcst_version, Some("1.1.0".to_string()));
        assert_eq!(loaded.resolution_source, ResolutionSource::Path);
        assert!(!loaded.is_managed_venv);
        assert!(loaded.base_python_path.is_none());
    }

    #[test]
    fn test_config_save_load_managed_venv() {
        let temp = TempDir::new().unwrap();
        let session_dir = temp.path();

        // Create python subdir
        std::fs::create_dir_all(session_dir.join("python")).unwrap();

        let config = PythonConfig {
            schema_version: PYTHON_CONFIG_SCHEMA_VERSION,
            interpreter_path: PathBuf::from("/workspace/.tug/venv/bin/python"),
            version: "3.11.4".to_string(),
            parsed_version: PythonVersion::new(3, 11, 4),
            libcst_available: true,
            libcst_version: Some("1.5.0".to_string()),
            resolved_at: "2024-01-15T10:30:00Z".to_string(),
            resolution_source: ResolutionSource::ManagedVenv,
            is_managed_venv: true,
            base_python_path: Some(PathBuf::from("/usr/bin/python3")),
        };

        // Save
        config.save(session_dir).unwrap();

        // Load
        let loaded = PythonConfig::load(session_dir).unwrap().unwrap();
        assert_eq!(loaded.schema_version, PYTHON_CONFIG_SCHEMA_VERSION);
        assert!(loaded.is_managed_venv);
        assert_eq!(loaded.resolution_source, ResolutionSource::ManagedVenv);
        assert_eq!(
            loaded.base_python_path,
            Some(PathBuf::from("/usr/bin/python3"))
        );
    }

    #[test]
    fn test_config_backward_compatibility() {
        // Test loading a v1 config (without new fields)
        let temp = TempDir::new().unwrap();
        let session_dir = temp.path();
        std::fs::create_dir_all(session_dir.join("python")).unwrap();

        // Write a v1-style config (no schema_version, is_managed_venv, base_python_path)
        let v1_config = r#"{
            "interpreter_path": "/usr/bin/python3",
            "version": "3.10.0",
            "parsed_version": {"major": 3, "minor": 10, "patch": 0},
            "libcst_available": true,
            "libcst_version": "1.0.0",
            "resolved_at": "2023-01-01T00:00:00Z",
            "resolution_source": "path"
        }"#;

        std::fs::write(session_dir.join("python").join("config.json"), v1_config).unwrap();

        // Load should succeed with defaults
        let loaded = PythonConfig::load(session_dir).unwrap().unwrap();
        assert_eq!(loaded.schema_version, 1); // Default
        assert!(!loaded.is_managed_venv); // Default
        assert!(loaded.base_python_path.is_none()); // Not in v1 config
    }

    #[test]
    fn test_config_load_nonexistent() {
        let temp = TempDir::new().unwrap();
        let result = PythonConfig::load(temp.path()).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_resolution_source_display() {
        assert_eq!(ResolutionSource::CliFlag.to_string(), "--python flag");
        assert_eq!(ResolutionSource::EnvTugPython.to_string(), "$TUG_PYTHON");
        assert_eq!(
            ResolutionSource::SessionConfig.to_string(),
            "session config"
        );
        assert_eq!(ResolutionSource::VirtualEnv.to_string(), "$VIRTUAL_ENV");
        assert_eq!(ResolutionSource::CondaPrefix.to_string(), "$CONDA_PREFIX");
        assert_eq!(ResolutionSource::ManagedVenv.to_string(), ".tug/venv");
        assert_eq!(ResolutionSource::Path.to_string(), "$PATH");
    }

    #[test]
    fn test_managed_venv_python_path() {
        let session_dir = PathBuf::from("/workspace/.tug");
        let python_path = managed_venv_python_path(&session_dir);

        #[cfg(windows)]
        assert_eq!(
            python_path,
            PathBuf::from("/workspace/.tug/venv/Scripts/python.exe")
        );

        #[cfg(not(windows))]
        assert_eq!(
            python_path,
            PathBuf::from("/workspace/.tug/venv/bin/python")
        );
    }

    #[test]
    fn test_managed_venv_dir() {
        let session_dir = PathBuf::from("/workspace/.tug");
        let venv_dir = managed_venv_dir(&session_dir);
        assert_eq!(venv_dir, PathBuf::from("/workspace/.tug/venv"));
    }

    // Integration tests that actually run Python
    // These are conditional on having Python available

    #[test]
    fn test_get_python_version_integration() {
        // Try to find python3 in PATH
        if let Ok(python_path) = which::which("python3") {
            let version = get_python_version(&python_path);
            assert!(version.is_ok(), "Should be able to get Python version");

            let version = version.unwrap();
            assert_eq!(version.major, 3, "Should be Python 3");
            assert!(version.minor >= 8, "Should be Python 3.8+");
        }
    }

    #[test]
    fn test_check_libcst_integration() {
        // Try to find python3 in PATH
        if let Ok(python_path) = which::which("python3") {
            let result = check_libcst(&python_path);
            assert!(result.is_ok(), "Should be able to check for LibCST");
            // Note: LibCST may or may not be installed, both are valid
        }
    }

    #[test]
    fn test_resolve_python_with_explicit_path_integration() {
        // Try to find python3 in PATH
        if let Ok(python_path) = which::which("python3") {
            let temp = TempDir::new().unwrap();
            let session_dir = temp.path();
            std::fs::create_dir_all(session_dir.join("python")).unwrap();

            let options = ResolutionOptions::with_python(&python_path);
            let result = resolve_python(session_dir, &options);

            assert!(result.is_ok(), "Should resolve Python with explicit path");

            let env = result.unwrap();
            assert_eq!(env.source(), ResolutionSource::CliFlag);
            assert!(env.version().meets_minimum());
        }
    }

    #[test]
    fn test_resolve_python_from_path_integration() {
        let temp = TempDir::new().unwrap();
        let session_dir = temp.path();
        std::fs::create_dir_all(session_dir.join("python")).unwrap();

        let options = ResolutionOptions::default();
        let result = resolve_python(session_dir, &options);

        // This might fail if no Python is installed, which is okay
        if let Ok(env) = result {
            assert!(env.version().meets_minimum());
        }
    }

    #[test]
    fn test_session_persistence_integration() {
        // Try to find python3 in PATH
        if let Ok(python_path) = which::which("python3") {
            let temp = TempDir::new().unwrap();
            let session_dir = temp.path();
            std::fs::create_dir_all(session_dir.join("python")).unwrap();

            // First resolution
            let options = ResolutionOptions::with_python(&python_path);
            let env1 = resolve_python(session_dir, &options).unwrap();

            // Second resolution should use cached config
            let options2 = ResolutionOptions::default();
            let env2 = resolve_python(session_dir, &options2).unwrap();

            // Should get the same interpreter (from cache)
            assert_eq!(env1.interpreter(), env2.interpreter());
        }
    }

    #[test]
    fn test_version_too_old() {
        // Create a fake version string for an old Python
        let version = PythonVersion::parse("2.7.18").unwrap();
        assert!(!version.meets_minimum());

        let version = PythonVersion::parse("3.7.0").unwrap();
        assert!(!version.meets_minimum());

        let version = PythonVersion::parse("3.8.19").unwrap();
        assert!(!version.meets_minimum());

        let version = PythonVersion::parse("3.9.0").unwrap();
        assert!(version.meets_minimum());
    }

    #[test]
    fn test_invalid_version_parse() {
        // Not enough components
        assert!(PythonVersion::parse("3").is_err());

        // Non-numeric
        assert!(PythonVersion::parse("abc.def").is_err());

        // Empty string
        assert!(PythonVersion::parse("").is_err());
    }

    // Error message formatting tests

    #[test]
    fn test_resolution_step_display_not_set() {
        let step = ResolutionStep::not_set("$VIRTUAL_ENV");
        let display = step.to_string();
        assert!(display.contains("$VIRTUAL_ENV"));
        assert!(display.contains("not set"));
    }

    #[test]
    fn test_resolution_step_display_not_found() {
        let step = ResolutionStep::not_found(".tug/venv");
        let display = step.to_string();
        assert!(display.contains(".tug/venv"));
        assert!(display.contains("not found"));
    }

    #[test]
    fn test_resolution_step_display_version_too_old() {
        let step =
            ResolutionStep::version_too_old("$PATH", PathBuf::from("/usr/bin/python3"), "3.8.10");
        let display = step.to_string();
        assert!(display.contains("$PATH"));
        assert!(display.contains("/usr/bin/python3"));
        assert!(display.contains("3.8.10"));
        assert!(display.contains("too old"));
    }

    #[test]
    fn test_resolution_step_display_libcst_missing() {
        let step = ResolutionStep::libcst_missing(
            "$VIRTUAL_ENV",
            PathBuf::from("/venv/bin/python"),
            "3.11.0",
        );
        let display = step.to_string();
        assert!(display.contains("$VIRTUAL_ENV"));
        assert!(display.contains("/venv/bin/python"));
        assert!(display.contains("3.11.0"));
        assert!(display.contains("libcst"));
    }

    #[test]
    fn test_resolution_trace_format() {
        let mut trace = ResolutionTrace::new();
        trace.add(ResolutionStep::not_set("--python flag"));
        trace.add(ResolutionStep::not_set("$TUG_PYTHON"));
        trace.add(ResolutionStep::version_too_old(
            "$PATH",
            PathBuf::from("/usr/bin/python3"),
            "3.8.10",
        ));

        let formatted = trace.format_trace();

        // Check that steps are numbered
        assert!(formatted.contains("1."));
        assert!(formatted.contains("2."));
        assert!(formatted.contains("3."));

        // Check content
        assert!(formatted.contains("--python flag"));
        assert!(formatted.contains("$TUG_PYTHON"));
        assert!(formatted.contains("3.8.10"));
    }

    #[test]
    fn test_python_not_found_error_includes_remediation() {
        let trace = ResolutionTrace::new();
        let error = PythonEnvError::PythonNotFound {
            searched: vec!["$PATH".to_string()],
            trace: Some(trace),
        };

        let msg = error.to_string();

        // Check main message
        assert!(msg.contains("no Python interpreter found"));

        // Check remediation suggestions
        assert!(msg.contains("Remediation"));
        assert!(msg.contains("tug toolchain python setup"));
        assert!(msg.contains("pip install libcst"));
        assert!(msg.contains("--toolchain python="));
    }

    #[test]
    fn test_libcst_not_available_error_includes_remediation() {
        let error = PythonEnvError::LibCSTNotAvailable {
            python_path: PathBuf::from("/usr/bin/python3"),
        };

        let msg = error.to_string();

        // Check main message
        assert!(msg.contains("libcst not installed"));
        assert!(msg.contains("/usr/bin/python3"));

        // Check remediation suggestions
        assert!(msg.contains("Remediation"));
        assert!(msg.contains("-m pip install libcst"));
        assert!(msg.contains("tug toolchain python setup"));
    }
}
