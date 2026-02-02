//! Symbol lookup utilities.
//!
//! Provides functions to find symbols and references at specific locations
//! in analyzed Python code. Used by all Python refactoring operations.

use tugtool_core::facts::{FactsStore, File as FactsFile, Symbol as FactsSymbol, SymbolKind};
use tugtool_core::output::Location;
use tugtool_core::patch::Span;
use tugtool_core::text::position_to_byte_offset_str;

use crate::files::FileError;

use thiserror::Error;

// ============================================================================
// Error Types
// ============================================================================

/// Errors that can occur during symbol lookup.
#[derive(Debug, Error)]
pub enum LookupError {
    /// Symbol not found at the given location.
    ///
    /// Includes diagnostic fields to help debug location specification errors:
    /// - `byte_offset`: The computed byte offset from line:col
    /// - `char_at_offset`: The character at that byte offset (if valid)
    /// - `nearest_symbol`: The closest symbol within 10 bytes (if any)
    #[error("{}", format_symbol_not_found(.file, .line, .col, .byte_offset, .char_at_offset, .nearest_symbol))]
    SymbolNotFound {
        file: String,
        line: u32,
        col: u32,
        /// Computed byte offset from line:col
        byte_offset: usize,
        /// Character at the byte offset (None if offset is invalid)
        char_at_offset: Option<char>,
        /// Nearest symbol within 10 bytes: (name, span)
        nearest_symbol: Option<(String, Span)>,
    },

    /// Multiple symbols match at the location.
    #[error("ambiguous symbol, candidates: {}", candidates.join(", "))]
    AmbiguousSymbol { candidates: Vec<String> },

    /// File not found.
    #[error("file error: {0}")]
    File(#[from] FileError),
}

/// Format SymbolNotFound error message with diagnostics.
fn format_symbol_not_found(
    file: &str,
    line: &u32,
    col: &u32,
    byte_offset: &usize,
    char_at_offset: &Option<char>,
    nearest_symbol: &Option<(String, Span)>,
) -> String {
    let mut msg = format!("no symbol found at {file}:{line}:{col}");
    msg.push_str(&format!(" (byte offset: {byte_offset}"));

    if let Some(ch) = char_at_offset {
        let ch_repr = if ch.is_whitespace() {
            format!("whitespace {:?}", ch)
        } else {
            format!("'{ch}'")
        };
        msg.push_str(&format!(", char: {ch_repr}"));
    }
    msg.push(')');

    if let Some((name, span)) = nearest_symbol {
        msg.push_str(&format!(
            "; nearest symbol: '{}' at bytes {}..{}",
            name, span.start, span.end
        ));
    }

    msg
}

/// Find the nearest symbol to a byte offset within a distance threshold.
///
/// Returns the symbol name and span if found within `max_distance` bytes.
fn find_nearest_symbol<'a>(
    symbols: impl IntoIterator<Item = &'a FactsSymbol>,
    byte_offset: usize,
    max_distance: usize,
) -> Option<(String, Span)> {
    let mut nearest: Option<(String, Span, usize)> = None;

    for symbol in symbols {
        // Calculate distance to this symbol's span
        let distance = if byte_offset < symbol.decl_span.start {
            symbol.decl_span.start - byte_offset
        } else if byte_offset >= symbol.decl_span.end {
            byte_offset - symbol.decl_span.end + 1
        } else {
            // Inside span - shouldn't happen since we already checked, but handle it
            0
        };

        if distance <= max_distance {
            if nearest.is_none() || distance < nearest.as_ref().unwrap().2 {
                nearest = Some((
                    symbol.name.clone(),
                    Span::new(symbol.decl_span.start, symbol.decl_span.end),
                    distance,
                ));
            }
        }
    }

    nearest.map(|(name, span, _)| (name, span))
}

/// Result type for lookup operations.
pub type LookupResult<T> = Result<T, LookupError>;

// ============================================================================
// Lookup Tracing
// ============================================================================

/// A span containment check recorded during lookup tracing.
#[derive(Debug, Clone)]
pub struct SpanCheck {
    /// Symbol name being checked
    pub symbol_name: String,
    /// Symbol's span
    pub span: Span,
    /// Whether the byte offset was contained in the span
    pub contained: bool,
    /// Distance from the byte offset (0 if contained)
    pub distance: usize,
}

/// Trace information captured during a symbol lookup.
///
/// This struct captures detailed information about the lookup process,
/// useful for debugging why a symbol lookup failed or succeeded.
#[derive(Debug, Clone)]
pub struct LookupTrace {
    /// The byte offset computed from line:col
    pub byte_offset: usize,
    /// Character at the byte offset
    pub char_at_offset: Option<char>,
    /// All span containment checks performed on symbols
    pub symbol_checks: Vec<SpanCheck>,
    /// All span containment checks performed on references
    pub reference_checks: Vec<SpanCheck>,
    /// Symbols found within 10 bytes of the offset
    pub nearby_symbols: Vec<(String, Span, usize)>,
}

// ============================================================================
// Lookup Functions
// ============================================================================

/// Find a symbol at a given file location.
///
/// This function looks up a symbol at the specified file:line:col location.
/// It first checks for symbol definitions at that location, then falls back
/// to checking references and returning the referenced symbol.
///
/// # Arguments
///
/// * `store` - The FactsStore containing analyzed symbols and references
/// * `location` - The file location to look up (file path, line, col)
/// * `files` - List of (path, content) tuples for file content lookup
///
/// # Returns
///
/// The symbol at the location, or an error if not found or ambiguous.
///
/// # Example
///
/// ```ignore
/// let symbol = find_symbol_at_location(&store, &location, &files)?;
/// println!("Found symbol: {}", symbol.name);
/// ```
pub fn find_symbol_at_location(
    store: &FactsStore,
    location: &Location,
    files: &[(String, String)],
) -> LookupResult<FactsSymbol> {
    // Find the file
    let file = store.file_by_path(&location.file).ok_or_else(|| {
        LookupError::File(FileError::NotFound {
            path: location.file.clone(),
        })
    })?;

    // Get file content to compute byte offset
    let content = files
        .iter()
        .find(|(p, _)| p == &location.file)
        .map(|(_, c)| c.as_str())
        .ok_or_else(|| {
            LookupError::File(FileError::NotFound {
                path: location.file.clone(),
            })
        })?;

    // Convert line:col to byte offset
    let byte_offset = position_to_byte_offset_str(content, location.line, location.col);

    // Find symbols at this location
    let symbols = store.symbols_in_file(file.file_id);
    let mut matching_symbols: Vec<_> = symbols
        .into_iter()
        .filter(|s| s.decl_span.start <= byte_offset && byte_offset < s.decl_span.end)
        .collect();

    if matching_symbols.is_empty() {
        // Try finding references at this location and getting their symbol
        let refs = store.refs_in_file(file.file_id);
        for reference in refs {
            if reference.span.start <= byte_offset && byte_offset < reference.span.end {
                if let Some(symbol) = store.symbol(reference.symbol_id) {
                    matching_symbols.push(symbol);
                    break;
                }
            }
        }
    }

    match matching_symbols.len() {
        0 => {
            // Collect diagnostic information for the error
            let char_at_offset = content[byte_offset..].chars().next();

            // Find nearest symbol within 10 bytes
            let symbols_for_nearest = store.symbols_in_file(file.file_id);
            let nearest_symbol = find_nearest_symbol(symbols_for_nearest, byte_offset, 10);

            Err(LookupError::SymbolNotFound {
                file: location.file.clone(),
                line: location.line,
                col: location.col,
                byte_offset,
                char_at_offset,
                nearest_symbol,
            })
        }
        1 => {
            let symbol = matching_symbols[0];
            // Per Contract C1: If this is an Import symbol, try to resolve to the original definition.
            // This ensures that clicking on `foo` in `from x import foo` returns the original `foo`
            // definition from x.py, not the import binding itself.
            if symbol.kind == SymbolKind::Import {
                if let Some(original) = resolve_import_to_original(store, symbol) {
                    return Ok(original.clone());
                }
            }
            Ok(symbol.clone())
        }
        _ => Err(LookupError::AmbiguousSymbol {
            candidates: matching_symbols
                .iter()
                .map(|s| format!("{} ({})", s.name, s.symbol_id))
                .collect(),
        }),
    }
}

/// Find a symbol at a given file location with detailed tracing.
///
/// This variant of `find_symbol_at_location` captures detailed trace information
/// about the lookup process, useful for debugging lookup failures.
///
/// # Arguments
///
/// * `store` - The FactsStore containing analyzed symbols and references
/// * `location` - The file location to look up (file path, line, col)
/// * `files` - List of (path, content) tuples for file content lookup
///
/// # Returns
///
/// A tuple of (result, trace) where result is the lookup result and trace
/// contains detailed information about the lookup process.
pub fn find_symbol_at_location_traced(
    store: &FactsStore,
    location: &Location,
    files: &[(String, String)],
) -> (LookupResult<FactsSymbol>, LookupTrace) {
    // Find the file
    let file = match store.file_by_path(&location.file) {
        Some(f) => f,
        None => {
            return (
                Err(LookupError::File(FileError::NotFound {
                    path: location.file.clone(),
                })),
                LookupTrace {
                    byte_offset: 0,
                    char_at_offset: None,
                    symbol_checks: vec![],
                    reference_checks: vec![],
                    nearby_symbols: vec![],
                },
            );
        }
    };

    // Get file content to compute byte offset
    let content = match files
        .iter()
        .find(|(p, _)| p == &location.file)
        .map(|(_, c)| c.as_str())
    {
        Some(c) => c,
        None => {
            return (
                Err(LookupError::File(FileError::NotFound {
                    path: location.file.clone(),
                })),
                LookupTrace {
                    byte_offset: 0,
                    char_at_offset: None,
                    symbol_checks: vec![],
                    reference_checks: vec![],
                    nearby_symbols: vec![],
                },
            );
        }
    };

    // Convert line:col to byte offset
    let byte_offset = position_to_byte_offset_str(content, location.line, location.col);
    let char_at_offset = content[byte_offset..].chars().next();

    // Collect symbol span checks
    let symbols = store.symbols_in_file(file.file_id);
    let mut symbol_checks = Vec::new();
    let mut matching_symbols = Vec::new();

    for symbol in &symbols {
        let contained = symbol.decl_span.start <= byte_offset && byte_offset < symbol.decl_span.end;
        let distance = if contained {
            0
        } else if byte_offset < symbol.decl_span.start {
            symbol.decl_span.start - byte_offset
        } else {
            byte_offset - symbol.decl_span.end + 1
        };

        symbol_checks.push(SpanCheck {
            symbol_name: symbol.name.clone(),
            span: Span::new(symbol.decl_span.start, symbol.decl_span.end),
            contained,
            distance,
        });

        if contained {
            matching_symbols.push(*symbol);
        }
    }

    // Collect reference checks if no symbols matched
    let mut reference_checks = Vec::new();
    if matching_symbols.is_empty() {
        let refs = store.refs_in_file(file.file_id);
        for reference in refs {
            let contained = reference.span.start <= byte_offset && byte_offset < reference.span.end;
            let distance = if contained {
                0
            } else if byte_offset < reference.span.start {
                reference.span.start - byte_offset
            } else {
                byte_offset - reference.span.end + 1
            };

            // Get the symbol name for this reference
            let ref_name = store
                .symbol(reference.symbol_id)
                .map(|s| s.name.clone())
                .unwrap_or_else(|| format!("ref:{}", reference.symbol_id));

            reference_checks.push(SpanCheck {
                symbol_name: ref_name,
                span: Span::new(reference.span.start, reference.span.end),
                contained,
                distance,
            });

            if contained {
                if let Some(symbol) = store.symbol(reference.symbol_id) {
                    matching_symbols.push(symbol);
                    break;
                }
            }
        }
    }

    // Collect nearby symbols (within 10 bytes)
    let nearby_symbols: Vec<_> = symbol_checks
        .iter()
        .filter(|c| c.distance <= 10)
        .map(|c| (c.symbol_name.clone(), c.span, c.distance))
        .collect();

    let trace = LookupTrace {
        byte_offset,
        char_at_offset,
        symbol_checks,
        reference_checks,
        nearby_symbols,
    };

    // Return result
    let result = match matching_symbols.len() {
        0 => {
            let symbols_for_nearest = store.symbols_in_file(file.file_id);
            let nearest_symbol = find_nearest_symbol(symbols_for_nearest, byte_offset, 10);
            Err(LookupError::SymbolNotFound {
                file: location.file.clone(),
                line: location.line,
                col: location.col,
                byte_offset,
                char_at_offset,
                nearest_symbol,
            })
        }
        1 => {
            let symbol = matching_symbols[0];
            if symbol.kind == SymbolKind::Import {
                if let Some(original) = resolve_import_to_original(store, symbol) {
                    return (Ok(original.clone()), trace);
                }
            }
            Ok(symbol.clone())
        }
        _ => Err(LookupError::AmbiguousSymbol {
            candidates: matching_symbols
                .iter()
                .map(|s| format!("{} ({})", s.name, s.symbol_id))
                .collect(),
        }),
    };

    (result, trace)
}

/// Resolve an Import symbol to its original definition.
///
/// For `from x import foo`, this finds the `foo` symbol in x.py.
/// Returns None if the import cannot be resolved (external module, not found, etc.).
fn resolve_import_to_original<'a>(
    store: &'a FactsStore,
    import_symbol: &FactsSymbol,
) -> Option<&'a FactsSymbol> {
    // Import symbols have the imported name as their name (e.g., "foo" for "from x import foo")
    // We need to find the module path from the imports table
    // Find the import that matches this symbol's span
    let matching_import = store
        .imports_in_file(import_symbol.decl_file_id)
        .find(|imp| {
            // The import statement span should contain the symbol's declaration span
            // and the imported name should match
            imp.imported_name.as_deref() == Some(&import_symbol.name)
        })?;

    // Look up the module's file in the FactsStore
    // e.g., "x" -> "x.py" or "pkg.mod" -> "pkg/mod.py"
    let module_path = &matching_import.module_path;
    let resolved_file = lookup_module_file(store, module_path)?;

    // Find the original symbol with the same name in the resolved file
    let original_symbols = store.symbols_in_file(resolved_file.file_id);
    original_symbols
        .into_iter()
        .find(|s| s.name == import_symbol.name && s.kind != SymbolKind::Import)
}

/// Look up a module's file in the FactsStore (post-analysis query).
///
/// This is a **lookup** function, not a **resolution** function:
/// - It queries the already-built FactsStore for files
/// - It does NOT handle namespace packages (they have no File)
/// - Use `resolve_module_to_file` in analyzer.rs for during-analysis resolution
///
/// Checks for:
/// 1. `module_path.py` (e.g., "x" -> "x.py")
/// 2. `module_path/__init__.py` (e.g., "x" -> "x/__init__.py")
/// 3. Nested modules: `pkg/mod.py` or `pkg/mod/__init__.py`
fn lookup_module_file<'a>(
    store: &'a FactsStore,
    module_path: &str,
) -> Option<&'a tugtool_core::facts::File> {
    // Convert module path to file path candidates
    // "x" -> "x.py", "x/__init__.py"
    // "pkg.mod" -> "pkg/mod.py", "pkg/mod/__init__.py"
    let path_base = module_path.replace('.', "/");
    let candidates = [
        format!("{path_base}.py"),
        format!("{path_base}/__init__.py"),
    ];

    // Try each candidate in order (module file preferred over __init__.py)
    for candidate in &candidates {
        if let Some(file) = store.file_by_path(candidate) {
            return Some(file);
        }
    }

    None
}

/// Create a SymbolInfo from FactsStore types.
///
/// This helper converts internal facts types to output types suitable
/// for JSON serialization. It computes line/col from byte offsets.
///
/// # Arguments
///
/// * `symbol` - The facts Symbol to convert
/// * `file` - The facts File containing the symbol
/// * `content` - The file content for position computation
///
/// # Returns
///
/// A SymbolInfo suitable for JSON output.
pub fn symbol_to_info(
    symbol: &FactsSymbol,
    file: &FactsFile,
    content: &str,
) -> tugtool_core::output::SymbolInfo {
    let (line, col) =
        tugtool_core::text::byte_offset_to_position_str(content, symbol.decl_span.start);
    tugtool_core::output::SymbolInfo::from_facts(
        &symbol.symbol_id.to_string(),
        &symbol.name,
        // Use spec-compliant kind mapping (Constant → "variable", TypeAlias → "variable")
        symbol.kind.to_output_kind(),
        &file.path,
        line,
        col,
        symbol.decl_span.start,
        symbol.decl_span.end,
        None, // container is populated for methods inside classes
    )
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_error_display() {
        // Basic SymbolNotFound without nearest symbol
        let err = LookupError::SymbolNotFound {
            file: "test.py".to_string(),
            line: 10,
            col: 5,
            byte_offset: 42,
            char_at_offset: Some('x'),
            nearest_symbol: None,
        };
        let msg = err.to_string();
        assert!(msg.contains("test.py:10:5"), "Should contain location");
        assert!(
            msg.contains("byte offset: 42"),
            "Should contain byte offset"
        );
        assert!(msg.contains("'x'"), "Should contain character");

        // SymbolNotFound with whitespace character
        let err = LookupError::SymbolNotFound {
            file: "test.py".to_string(),
            line: 1,
            col: 1,
            byte_offset: 0,
            char_at_offset: Some(' '),
            nearest_symbol: None,
        };
        let msg = err.to_string();
        assert!(msg.contains("whitespace"), "Should indicate whitespace");

        // SymbolNotFound with nearest symbol
        let err = LookupError::SymbolNotFound {
            file: "test.py".to_string(),
            line: 10,
            col: 5,
            byte_offset: 42,
            char_at_offset: Some('('),
            nearest_symbol: Some(("foo".to_string(), Span::new(45, 48))),
        };
        let msg = err.to_string();
        assert!(
            msg.contains("nearest symbol: 'foo'"),
            "Should show nearest symbol"
        );
        assert!(msg.contains("45..48"), "Should show nearest symbol span");

        // AmbiguousSymbol
        let err = LookupError::AmbiguousSymbol {
            candidates: vec!["foo".to_string(), "bar".to_string()],
        };
        assert!(err.to_string().contains("foo"));
        assert!(err.to_string().contains("bar"));
    }

    #[test]
    fn test_symbol_not_found_error_includes_diagnostics() {
        // Verify that SymbolNotFound errors include all diagnostic fields
        let err = LookupError::SymbolNotFound {
            file: "example.py".to_string(),
            line: 4,
            col: 36,
            byte_offset: 69,
            char_at_offset: Some('('),
            nearest_symbol: Some(("y".to_string(), Span::new(70, 71))),
        };

        let msg = err.to_string();

        // All diagnostic info should be present
        assert!(msg.contains("example.py:4:36"), "location");
        assert!(msg.contains("byte offset: 69"), "byte offset");
        assert!(msg.contains("'('"), "char at offset");
        assert!(msg.contains("nearest symbol: 'y'"), "nearest symbol name");
        assert!(msg.contains("70..71"), "nearest symbol span");
    }

    #[test]
    fn test_lookup_trace_captures_checks() {
        // Test that LookupTrace struct captures span containment information
        let trace = LookupTrace {
            byte_offset: 42,
            char_at_offset: Some('x'),
            symbol_checks: vec![
                SpanCheck {
                    symbol_name: "foo".to_string(),
                    span: Span::new(40, 43),
                    contained: true,
                    distance: 0,
                },
                SpanCheck {
                    symbol_name: "bar".to_string(),
                    span: Span::new(50, 53),
                    contained: false,
                    distance: 8,
                },
            ],
            reference_checks: vec![],
            nearby_symbols: vec![
                ("foo".to_string(), Span::new(40, 43), 0),
                ("bar".to_string(), Span::new(50, 53), 8),
            ],
        };

        // Verify trace captures information correctly
        assert_eq!(trace.byte_offset, 42);
        assert_eq!(trace.char_at_offset, Some('x'));
        assert_eq!(trace.symbol_checks.len(), 2);
        assert!(trace.symbol_checks[0].contained);
        assert!(!trace.symbol_checks[1].contained);
        assert_eq!(trace.nearby_symbols.len(), 2);
    }

    #[test]
    fn test_span_check_fields() {
        // Test SpanCheck struct
        let check = SpanCheck {
            symbol_name: "my_func".to_string(),
            span: Span::new(100, 107),
            contained: true,
            distance: 0,
        };

        assert_eq!(check.symbol_name, "my_func");
        assert_eq!(check.span.start, 100);
        assert_eq!(check.span.end, 107);
        assert!(check.contained);
        assert_eq!(check.distance, 0);
    }
}
