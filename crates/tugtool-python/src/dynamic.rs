//! Dynamic pattern detection with structured warnings.
//!
//! This module detects patterns that cannot be statically analyzed:
//!
//! - `getattr(obj, "name")` — dynamic attribute access
//! - `setattr(obj, "name", value)` — dynamic attribute set
//! - `globals()["name"]` — dynamic global access
//! - `locals()["name"]` — dynamic local access
//! - `eval("code")` — dynamic code execution
//! - `exec("code")` — dynamic code execution
//! - `__getattr__` / `__setattr__` method definitions
//!
//! Per Table T14 (Dynamic Pattern Response Strategy):
//! - `safe` (default): Warn and skip these references; require explicit confirmation
//! - `aggressive`: Use heuristics (string matching) with explicit warnings

use serde::{Deserialize, Serialize};

use tugtool_core::patch::Span;

use crate::types::DynamicPatternInfo;

// ============================================================================
// Warning Types
// ============================================================================

/// Warning code for dynamic patterns.
///
/// Per the spec, warning codes are stable identifiers that tools can use
/// to filter or categorize warnings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DynamicWarningCode {
    /// W001: Dynamic attribute access (getattr/setattr)
    #[serde(rename = "W001")]
    DynamicAttributeAccess,
    /// W002: Dynamic global/local access (globals()/locals())
    #[serde(rename = "W002")]
    DynamicGlobalLocalAccess,
    /// W003: Dynamic code execution (eval/exec)
    #[serde(rename = "W003")]
    DynamicCodeExecution,
    /// W004: Custom attribute protocol (__getattr__/__setattr__)
    #[serde(rename = "W004")]
    CustomAttributeProtocol,
}

impl DynamicWarningCode {
    /// Get the string code for this warning.
    pub fn as_str(&self) -> &'static str {
        match self {
            DynamicWarningCode::DynamicAttributeAccess => "W001",
            DynamicWarningCode::DynamicGlobalLocalAccess => "W002",
            DynamicWarningCode::DynamicCodeExecution => "W003",
            DynamicWarningCode::CustomAttributeProtocol => "W004",
        }
    }

    /// Get a description for this warning code.
    pub fn description(&self) -> &'static str {
        match self {
            DynamicWarningCode::DynamicAttributeAccess => {
                "Dynamic attribute access may reference renamed symbol"
            }
            DynamicWarningCode::DynamicGlobalLocalAccess => {
                "Dynamic global/local access may reference renamed symbol"
            }
            DynamicWarningCode::DynamicCodeExecution => {
                "Dynamic code execution may reference renamed symbol"
            }
            DynamicWarningCode::CustomAttributeProtocol => {
                "Custom attribute protocol may intercept renamed symbol"
            }
        }
    }
}

impl std::fmt::Display for DynamicWarningCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Location for a dynamic pattern warning.
///
/// Per Spec S11 (DynamicReference Warning Format).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynamicWarningLocation {
    /// File path.
    pub file: String,
    /// Line number (1-indexed).
    pub line: u32,
    /// Column number (1-indexed).
    pub col: u32,
    /// Byte span.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<Span>,
}

/// Structured warning for dynamic patterns.
///
/// Per Spec S11 (DynamicReference Warning Format):
/// ```json
/// {
///   "code": "W001",
///   "message": "Dynamic attribute access may reference renamed symbol",
///   "location": {"file": "foo.py", "line": 42, "col": 8},
///   "pattern": "getattr(handler, method_name)",
///   "suggestion": "Review manually or use --aggressive mode"
/// }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynamicWarning {
    /// Warning code (e.g., "W001").
    pub code: String,
    /// Human-readable message.
    pub message: String,
    /// Location of the pattern.
    pub location: DynamicWarningLocation,
    /// String representation of the pattern.
    pub pattern: String,
    /// Suggestion for the user.
    pub suggestion: String,
    /// The literal name if detected (for aggressive mode).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub literal_name: Option<String>,
    /// Whether this pattern would be included in aggressive mode.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aggressive_match: Option<bool>,
}

/// Response mode for dynamic patterns.
///
/// Per Table T14 (Dynamic Pattern Response Strategy).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DynamicMode {
    /// Warn and skip these references; require explicit confirmation.
    #[default]
    Safe,
    /// Use heuristics (string matching) with explicit warnings.
    Aggressive,
}

// ============================================================================
// Analysis Functions
// ============================================================================

/// Analyze dynamic patterns and generate warnings.
///
/// This function takes the dynamic patterns detected by the CST analysis and converts
/// them to structured warnings with location information.
///
/// # Arguments
///
/// * `patterns` - Dynamic patterns from the CST analysis
/// * `file_path` - Path to the file being analyzed
/// * `symbol_name` - Optional symbol name being renamed (for aggressive mode matching)
/// * `mode` - Response mode (safe or aggressive)
///
/// # Returns
///
/// A list of warnings for patterns that may reference the symbol being renamed.
pub fn analyze_dynamic_patterns(
    patterns: &[DynamicPatternInfo],
    file_path: &str,
    symbol_name: Option<&str>,
    mode: DynamicMode,
) -> Vec<DynamicWarning> {
    let mut warnings = Vec::new();

    for pattern in patterns {
        let warning_code = match pattern.kind.as_str() {
            "getattr" | "setattr" => DynamicWarningCode::DynamicAttributeAccess,
            "globals" | "locals" => DynamicWarningCode::DynamicGlobalLocalAccess,
            "eval" | "exec" => DynamicWarningCode::DynamicCodeExecution,
            "__getattr__" | "__setattr__" => DynamicWarningCode::CustomAttributeProtocol,
            _ => continue,
        };

        // Check if this pattern might reference the symbol being renamed
        let aggressive_match = symbol_name.map(|sym| {
            // Per List L12 (Aggressive Mode Heuristics):
            // - getattr(obj, "literal") where literal matches symbol → include in rename
            pattern.literal_name.as_deref() == Some(sym)
        });

        // In safe mode, we warn about all patterns
        // In aggressive mode, we still warn but mark patterns that would be included
        let suggestion = match (mode, aggressive_match) {
            (DynamicMode::Safe, _) => "Review manually or use --aggressive mode".to_string(),
            (DynamicMode::Aggressive, Some(true)) => {
                "Included in rename (aggressive mode)".to_string()
            }
            (DynamicMode::Aggressive, _) => {
                "Dynamic pattern - manual review recommended".to_string()
            }
        };

        let location = DynamicWarningLocation {
            file: file_path.to_string(),
            line: pattern.line.unwrap_or(0),
            col: pattern.col.unwrap_or(0),
            span: pattern
                .span
                .as_ref()
                .map(|s| Span::new(s.start as u64, s.end as u64)),
        };

        let warning = DynamicWarning {
            code: warning_code.as_str().to_string(),
            message: warning_code.description().to_string(),
            location,
            pattern: pattern
                .pattern_text
                .clone()
                .unwrap_or_else(|| pattern.kind.clone()),
            suggestion,
            literal_name: pattern.literal_name.clone(),
            aggressive_match,
        };

        warnings.push(warning);
    }

    warnings
}

/// Filter warnings to only those that might affect a specific symbol.
///
/// In aggressive mode, this returns patterns where the literal name matches
/// the symbol name. In safe mode, it returns all patterns (since we can't
/// be sure which ones are relevant).
pub fn filter_warnings_for_symbol<'a>(
    warnings: &'a [DynamicWarning],
    symbol_name: &str,
    mode: DynamicMode,
) -> Vec<&'a DynamicWarning> {
    match mode {
        DynamicMode::Safe => {
            // In safe mode, all patterns are potentially relevant
            warnings.iter().collect()
        }
        DynamicMode::Aggressive => {
            // In aggressive mode, only patterns with matching literal names are relevant
            warnings
                .iter()
                .filter(|w| w.literal_name.as_deref() == Some(symbol_name))
                .collect()
        }
    }
}

/// Get patterns that should be included in a rename operation (aggressive mode only).
///
/// Per List L12 (Aggressive Mode Heuristics):
/// - `getattr(obj, "literal")` where literal matches symbol → include in rename
///
/// Returns the patterns with their spans for inclusion in the rename.
pub fn get_aggressive_rename_patterns<'a>(
    patterns: &'a [DynamicPatternInfo],
    symbol_name: &str,
) -> Vec<&'a DynamicPatternInfo> {
    patterns
        .iter()
        .filter(|p| {
            // Only include getattr patterns with matching literal names
            // setattr is excluded because renaming the second arg alone is risky
            p.kind == "getattr" && p.literal_name.as_deref() == Some(symbol_name)
        })
        .collect()
}

/// Collect dynamic pattern warnings from all files.
///
/// This function iterates over a list of files, parses each one,
/// and collects warnings for dynamic patterns that may reference
/// the given symbol name.
///
/// # Arguments
///
/// * `files` - List of file paths to analyze
/// * `symbol_name` - The symbol name being analyzed (for matching in aggressive mode)
/// * `mode` - The dynamic pattern response mode (safe or aggressive)
///
/// # Returns
///
/// A list of warnings for dynamic patterns found in the files.
///
/// # Example
///
/// ```ignore
/// let warnings = collect_dynamic_warnings(&file_paths, "process_data", DynamicMode::Safe)?;
/// for warning in warnings {
///     println!("{}: {}", warning.code, warning.message);
/// }
/// ```
pub fn collect_dynamic_warnings(
    files: &[std::path::PathBuf],
    symbol_name: &str,
    mode: DynamicMode,
) -> Result<Vec<DynamicWarning>, std::io::Error> {
    use tugtool_cst::{parse_module, DynamicPatternDetector};

    let mut all_warnings = Vec::new();

    for file_path in files {
        // Read file content
        let content = match std::fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(_) => continue, // Skip files we can't read
        };

        // Parse the file using native CST
        let module = match parse_module(&content, None) {
            Ok(m) => m,
            Err(_) => continue, // Skip files with parse errors
        };

        // Get dynamic patterns using native detector
        let cst_patterns = DynamicPatternDetector::collect(&module, &content);

        // Convert CST patterns to our types
        let patterns: Vec<DynamicPatternInfo> = cst_patterns
            .into_iter()
            .map(|p| {
                // Map CST kind to our string format
                let kind = match p.kind.as_str() {
                    "globals_subscript" => "globals".to_string(),
                    "locals_subscript" => "locals".to_string(),
                    other => other.to_string(),
                };
                DynamicPatternInfo {
                    kind,
                    scope_path: p.scope_path,
                    literal_name: p.attribute_name,
                    pattern_text: Some(p.description),
                    span: p.span.map(|s| crate::types::SpanInfo {
                        start: s.start as usize,
                        end: s.end as usize,
                    }),
                    line: p.line,
                    col: p.col,
                }
            })
            .collect();

        // Analyze patterns and generate warnings
        let file_path_str = file_path.to_string_lossy();
        let warnings = analyze_dynamic_patterns(&patterns, &file_path_str, Some(symbol_name), mode);
        all_warnings.extend(warnings);
    }

    Ok(all_warnings)
}

/// Format warnings as a human-readable string.
pub fn format_warnings(warnings: &[DynamicWarning]) -> String {
    if warnings.is_empty() {
        return String::new();
    }

    let mut output = String::new();
    output.push_str(&format!("Found {} dynamic pattern(s):\n", warnings.len()));

    for warning in warnings {
        output.push_str(&format!(
            "  {} at {}:{}:{}: {}\n",
            warning.code,
            warning.location.file,
            warning.location.line,
            warning.location.col,
            warning.pattern
        ));
        output.push_str(&format!("    → {}\n", warning.suggestion));
    }

    output
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SpanInfo;

    fn make_pattern(
        kind: &str,
        literal_name: Option<&str>,
        pattern_text: Option<&str>,
    ) -> DynamicPatternInfo {
        DynamicPatternInfo {
            kind: kind.to_string(),
            scope_path: vec!["<module>".to_string()],
            literal_name: literal_name.map(|s| s.to_string()),
            pattern_text: pattern_text.map(|s| s.to_string()),
            span: Some(SpanInfo { start: 0, end: 10 }),
            line: Some(1),
            col: Some(1),
        }
    }

    #[test]
    fn test_warning_code_strings() {
        assert_eq!(DynamicWarningCode::DynamicAttributeAccess.as_str(), "W001");
        assert_eq!(
            DynamicWarningCode::DynamicGlobalLocalAccess.as_str(),
            "W002"
        );
        assert_eq!(DynamicWarningCode::DynamicCodeExecution.as_str(), "W003");
        assert_eq!(DynamicWarningCode::CustomAttributeProtocol.as_str(), "W004");
    }

    #[test]
    fn test_analyze_getattr_pattern() {
        let patterns = vec![make_pattern(
            "getattr",
            Some("method"),
            Some("getattr(obj, \"method\")"),
        )];

        let warnings =
            analyze_dynamic_patterns(&patterns, "test.py", Some("method"), DynamicMode::Safe);

        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].code, "W001");
        assert!(warnings[0].pattern.contains("getattr"));
        assert_eq!(warnings[0].literal_name, Some("method".to_string()));
        assert_eq!(warnings[0].aggressive_match, Some(true));
    }

    #[test]
    fn test_analyze_setattr_pattern() {
        let patterns = vec![make_pattern(
            "setattr",
            Some("attr"),
            Some("setattr(obj, \"attr\", value)"),
        )];

        let warnings = analyze_dynamic_patterns(&patterns, "test.py", None, DynamicMode::Safe);

        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].code, "W001");
    }

    #[test]
    fn test_analyze_globals_pattern() {
        let patterns = vec![make_pattern(
            "globals",
            Some("var"),
            Some("globals()[\"var\"]"),
        )];

        let warnings = analyze_dynamic_patterns(&patterns, "test.py", None, DynamicMode::Safe);

        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].code, "W002");
    }

    #[test]
    fn test_analyze_locals_pattern() {
        let patterns = vec![make_pattern("locals", Some("x"), Some("locals()[\"x\"]"))];

        let warnings = analyze_dynamic_patterns(&patterns, "test.py", None, DynamicMode::Safe);

        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].code, "W002");
    }

    #[test]
    fn test_analyze_eval_pattern() {
        let patterns = vec![make_pattern("eval", None, Some("eval(code)"))];

        let warnings = analyze_dynamic_patterns(&patterns, "test.py", None, DynamicMode::Safe);

        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].code, "W003");
    }

    #[test]
    fn test_analyze_exec_pattern() {
        let patterns = vec![make_pattern("exec", None, Some("exec(code)"))];

        let warnings = analyze_dynamic_patterns(&patterns, "test.py", None, DynamicMode::Safe);

        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].code, "W003");
    }

    #[test]
    fn test_analyze_dunder_getattr_pattern() {
        let patterns = vec![make_pattern(
            "__getattr__",
            None,
            Some("def __getattr__(...)"),
        )];

        let warnings = analyze_dynamic_patterns(&patterns, "test.py", None, DynamicMode::Safe);

        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].code, "W004");
    }

    #[test]
    fn test_analyze_dunder_setattr_pattern() {
        let patterns = vec![make_pattern(
            "__setattr__",
            None,
            Some("def __setattr__(...)"),
        )];

        let warnings = analyze_dynamic_patterns(&patterns, "test.py", None, DynamicMode::Safe);

        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].code, "W004");
    }

    #[test]
    fn test_aggressive_mode_matching() {
        let patterns = vec![
            make_pattern(
                "getattr",
                Some("process"),
                Some("getattr(obj, \"process\")"),
            ),
            make_pattern("getattr", Some("other"), Some("getattr(obj, \"other\")")),
        ];

        let warnings = analyze_dynamic_patterns(
            &patterns,
            "test.py",
            Some("process"),
            DynamicMode::Aggressive,
        );

        assert_eq!(warnings.len(), 2);
        // First pattern matches the symbol
        assert_eq!(warnings[0].aggressive_match, Some(true));
        assert!(warnings[0].suggestion.contains("Included in rename"));
        // Second pattern doesn't match
        assert_eq!(warnings[1].aggressive_match, Some(false));
        assert!(warnings[1].suggestion.contains("manual review"));
    }

    #[test]
    fn test_filter_warnings_safe_mode() {
        let patterns = vec![
            make_pattern("getattr", Some("foo"), None),
            make_pattern("getattr", Some("bar"), None),
        ];
        let warnings = analyze_dynamic_patterns(&patterns, "test.py", None, DynamicMode::Safe);

        // In safe mode, all warnings are returned
        let filtered = filter_warnings_for_symbol(&warnings, "foo", DynamicMode::Safe);
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn test_filter_warnings_aggressive_mode() {
        let patterns = vec![
            make_pattern("getattr", Some("foo"), None),
            make_pattern("getattr", Some("bar"), None),
        ];
        let warnings = analyze_dynamic_patterns(&patterns, "test.py", None, DynamicMode::Safe);

        // In aggressive mode, only matching warnings are returned
        let filtered = filter_warnings_for_symbol(&warnings, "foo", DynamicMode::Aggressive);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].literal_name, Some("foo".to_string()));
    }

    #[test]
    fn test_get_aggressive_rename_patterns() {
        let patterns = vec![
            make_pattern(
                "getattr",
                Some("process"),
                Some("getattr(obj, \"process\")"),
            ),
            make_pattern(
                "setattr",
                Some("process"),
                Some("setattr(obj, \"process\", v)"),
            ),
            make_pattern("getattr", Some("other"), Some("getattr(obj, \"other\")")),
        ];

        // Only getattr with matching literal is included
        let aggressive = get_aggressive_rename_patterns(&patterns, "process");
        assert_eq!(aggressive.len(), 1);
        assert_eq!(aggressive[0].kind, "getattr");
        assert_eq!(aggressive[0].literal_name, Some("process".to_string()));
    }

    #[test]
    fn test_format_warnings() {
        let patterns = vec![make_pattern(
            "getattr",
            Some("method"),
            Some("getattr(obj, \"method\")"),
        )];
        let warnings = analyze_dynamic_patterns(&patterns, "test.py", None, DynamicMode::Safe);

        let formatted = format_warnings(&warnings);
        assert!(formatted.contains("1 dynamic pattern"));
        assert!(formatted.contains("W001"));
        assert!(formatted.contains("test.py:1:1"));
        assert!(formatted.contains("getattr"));
    }

    #[test]
    fn test_format_no_warnings() {
        let formatted = format_warnings(&[]);
        assert!(formatted.is_empty());
    }

    #[test]
    fn test_warning_location() {
        let patterns = vec![DynamicPatternInfo {
            kind: "getattr".to_string(),
            scope_path: vec!["<module>".to_string(), "MyClass".to_string()],
            literal_name: Some("method".to_string()),
            pattern_text: Some("getattr(self, \"method\")".to_string()),
            span: Some(SpanInfo {
                start: 100,
                end: 123,
            }),
            line: Some(10),
            col: Some(5),
        }];

        let warnings = analyze_dynamic_patterns(&patterns, "src/utils.py", None, DynamicMode::Safe);

        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].location.file, "src/utils.py");
        assert_eq!(warnings[0].location.line, 10);
        assert_eq!(warnings[0].location.col, 5);
        assert_eq!(warnings[0].location.span, Some(Span::new(100, 123)));
    }
}
