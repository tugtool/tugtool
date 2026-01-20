//! Symbol lookup utilities.
//!
//! Provides functions to find symbols and references at specific locations
//! in analyzed Python code. Used by all Python refactoring operations.

use tugtool_core::facts::{FactsStore, File as FactsFile, Symbol as FactsSymbol, SymbolKind};
use tugtool_core::output::Location;
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
    #[error("no symbol found at {file}:{line}:{col}")]
    SymbolNotFound { file: String, line: u32, col: u32 },

    /// Multiple symbols match at the location.
    #[error("ambiguous symbol, candidates: {}", candidates.join(", "))]
    AmbiguousSymbol { candidates: Vec<String> },

    /// File not found.
    #[error("file error: {0}")]
    File(#[from] FileError),
}

/// Result type for lookup operations.
pub type LookupResult<T> = Result<T, LookupError>;

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
        0 => Err(LookupError::SymbolNotFound {
            file: location.file.clone(),
            line: location.line,
            col: location.col,
        }),
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
    let imports_in_file = store.imports_in_file(import_symbol.decl_file_id);

    // Find the import that matches this symbol's span
    let matching_import = imports_in_file.iter().find(|imp| {
        // The import statement span should contain the symbol's declaration span
        // and the imported name should match
        imp.imported_name.as_deref() == Some(&import_symbol.name)
    })?;

    // Resolve module path to a file in the workspace
    // e.g., "x" -> "x.py" or "pkg.mod" -> "pkg/mod.py"
    let module_path = &matching_import.module_path;
    let resolved_file = resolve_module_to_file(store, module_path)?;

    // Find the original symbol with the same name in the resolved file
    let original_symbols = store.symbols_in_file(resolved_file.file_id);
    original_symbols
        .into_iter()
        .find(|s| s.name == import_symbol.name && s.kind != SymbolKind::Import)
}

/// Resolve a Python module path to a file in the workspace.
///
/// Checks for:
/// 1. `module_path.py` (e.g., "x" -> "x.py")
/// 2. `module_path/__init__.py` (e.g., "x" -> "x/__init__.py")
/// 3. Nested modules: `pkg/mod.py` or `pkg/mod/__init__.py`
fn resolve_module_to_file<'a>(store: &'a FactsStore, module_path: &str) -> Option<&'a tugtool_core::facts::File> {
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
        let err = LookupError::SymbolNotFound {
            file: "test.py".to_string(),
            line: 10,
            col: 5,
        };
        assert_eq!(err.to_string(), "no symbol found at test.py:10:5");

        let err = LookupError::AmbiguousSymbol {
            candidates: vec!["foo".to_string(), "bar".to_string()],
        };
        assert!(err.to_string().contains("foo"));
        assert!(err.to_string().contains("bar"));
    }
}
