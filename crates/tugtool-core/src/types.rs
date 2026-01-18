//! Common types shared between error and output modules.
//!
//! This module contains types that are used by both the error and output modules,
//! avoiding circular dependencies.

use serde::{Deserialize, Serialize};

// ============================================================================
// Location Type
// ============================================================================

/// Location in a source file.
///
/// Per 26.0.7 spec #type-location:
/// - `file`: Workspace-relative path (required)
/// - `line`: 1-indexed line number (required)
/// - `col`: 1-indexed column, UTF-8 bytes (required)
/// - `byte_start`: Byte offset from file start (optional)
/// - `byte_end`: Byte offset end, exclusive (optional)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Location {
    /// File path (workspace-relative).
    pub file: String,
    /// Line number (1-indexed).
    pub line: u32,
    /// Column number (1-indexed, UTF-8 bytes).
    pub col: u32,
    /// Byte offset from file start (optional).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_start: Option<u64>,
    /// Byte offset end, exclusive (optional).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_end: Option<u64>,
}

impl Location {
    /// Create a new location without byte offsets.
    pub fn new(file: impl Into<String>, line: u32, col: u32) -> Self {
        Location {
            file: file.into(),
            line,
            col,
            byte_start: None,
            byte_end: None,
        }
    }

    /// Create a location with byte start offset (byte_end computed from name length).
    pub fn with_byte_start(file: impl Into<String>, line: u32, col: u32, byte_start: u64) -> Self {
        Location {
            file: file.into(),
            line,
            col,
            byte_start: Some(byte_start),
            byte_end: None,
        }
    }

    /// Create a location with full byte span.
    pub fn with_span(
        file: impl Into<String>,
        line: u32,
        col: u32,
        byte_start: u64,
        byte_end: u64,
    ) -> Self {
        Location {
            file: file.into(),
            line,
            col,
            byte_start: Some(byte_start),
            byte_end: Some(byte_end),
        }
    }

    /// Parse a location from "path:line:col" format.
    ///
    /// This parsing is robust against paths containing colons (e.g., Windows paths).
    pub fn parse(s: &str) -> Option<Self> {
        let parts: Vec<&str> = s.rsplitn(3, ':').collect();
        if parts.len() != 3 {
            return None;
        }
        let col: u32 = parts[0].parse().ok()?;
        let line: u32 = parts[1].parse().ok()?;
        let file = parts[2].to_string();
        Some(Location::new(file, line, col))
    }

    /// Comparison key for deterministic sorting: (file, line, col).
    fn sort_key(&self) -> (&str, u32, u32) {
        (&self.file, self.line, self.col)
    }
}

impl PartialOrd for Location {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Location {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.sort_key().cmp(&other.sort_key())
    }
}

// ============================================================================
// SymbolInfo Type
// ============================================================================

/// Symbol information for JSON output.
///
/// Named `SymbolInfo` to distinguish from `facts::Symbol` (internal graph type).
/// The "Info" suffix indicates this is an information carrier for serialization.
///
/// Per 26.0.7 spec #type-symbol:
/// - `id`: Stable symbol ID within snapshot (required)
/// - `name`: Symbol name (required)
/// - `kind`: One of: function, class, method, variable, parameter, module, import (required)
/// - `location`: Definition location (required)
/// - `container`: Parent symbol ID for methods in classes (optional)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolInfo {
    /// Symbol ID (stable within snapshot).
    pub id: String,
    /// Symbol name.
    pub name: String,
    /// Symbol kind (function, class, method, variable, parameter, module, import).
    pub kind: String,
    /// Definition location.
    pub location: Location,
    /// Parent symbol ID (for methods in classes).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub container: Option<String>,
}

impl SymbolInfo {
    /// Create a Symbol from internal FactsStore types.
    ///
    /// This is the primary constructor used during rename analysis.
    /// The `container` field is populated when the symbol is a method inside a class.
    #[allow(clippy::too_many_arguments)]
    pub fn from_facts(
        symbol_id: &str,
        name: &str,
        kind: &str,
        file: &str,
        line: u32,
        col: u32,
        byte_start: u64,
        byte_end: u64,
        container: Option<String>,
    ) -> Self {
        SymbolInfo {
            id: symbol_id.to_string(),
            name: name.to_string(),
            kind: kind.to_string(),
            location: Location::with_span(file, line, col, byte_start, byte_end),
            container,
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod location_tests {
        use super::*;

        #[test]
        fn location_new_serializes_without_byte_offsets() {
            let loc = Location::new("test.py", 42, 8);
            let json = serde_json::to_string(&loc).unwrap();
            // Should NOT include byte_start or byte_end when None
            assert!(!json.contains("byte_start"));
            assert!(!json.contains("byte_end"));
            assert!(json.contains("\"file\":\"test.py\""));
            assert!(json.contains("\"line\":42"));
            assert!(json.contains("\"col\":8"));
        }

        #[test]
        fn location_with_span_serializes_all_fields() {
            let loc = Location::with_span("src/main.py", 42, 8, 1234, 1245);
            let json = serde_json::to_string(&loc).unwrap();
            assert!(json.contains("\"byte_start\":1234"));
            assert!(json.contains("\"byte_end\":1245"));
        }

        #[test]
        fn location_parse_valid() {
            let loc = Location::parse("src/utils.py:42:5").unwrap();
            assert_eq!(loc.file, "src/utils.py");
            assert_eq!(loc.line, 42);
            assert_eq!(loc.col, 5);
            assert_eq!(loc.byte_start, None);
            assert_eq!(loc.byte_end, None);
        }

        #[test]
        fn location_parse_windows_path() {
            // Windows paths have colons - rsplitn should handle this
            let loc = Location::parse("C:/Users/foo/src/utils.py:10:3").unwrap();
            assert_eq!(loc.file, "C:/Users/foo/src/utils.py");
            assert_eq!(loc.line, 10);
            assert_eq!(loc.col, 3);
        }

        #[test]
        fn location_parse_invalid() {
            assert!(Location::parse("src/utils.py").is_none());
            assert!(Location::parse("src/utils.py:42").is_none());
            assert!(Location::parse("src/utils.py:abc:5").is_none());
        }
    }

    mod symbol_info_tests {
        use super::*;

        #[test]
        fn symbol_without_container() {
            let sym = SymbolInfo::from_facts(
                "sym_abc123",
                "process_data",
                "function",
                "src/utils.py",
                42,
                4,
                1000,
                1012,
                None,
            );
            let json = serde_json::to_string(&sym).unwrap();
            // Should NOT include container when None
            assert!(!json.contains("container"));
            assert!(json.contains("\"id\":\"sym_abc123\""));
            assert!(json.contains("\"name\":\"process_data\""));
            assert!(json.contains("\"kind\":\"function\""));
        }

        #[test]
        fn symbol_with_container() {
            let sym = SymbolInfo::from_facts(
                "sym_method",
                "do_work",
                "method",
                "src/utils.py",
                50,
                8,
                1500,
                1507,
                Some("sym_class".to_string()),
            );
            let json = serde_json::to_string(&sym).unwrap();
            assert!(json.contains("\"container\":\"sym_class\""));
        }
    }
}
