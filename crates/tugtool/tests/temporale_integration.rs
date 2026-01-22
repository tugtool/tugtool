//! Integration tests for Temporale sample code library.
//!
//! These tests verify that tugtool can analyze and refactor the Temporale
//! Python datetime library, validating:
//!
//! - All Python files parse successfully with tugtool-python-cst
//! - Symbol count meets success criteria (>100 symbols)
//! - Cross-module reference count meets criteria (>50 references)
//! - Refactoring operations produce syntactically valid Python
//! - Refactored code contains expected changes (verified via pattern assertions)
//!
//! Note: Refactoring tests exclude test files from the refactoring scope and
//! use syntax verification (compileall) rather than pytest verification. This
//! prevents the circular problem where renaming `Date` to `CalendarDate` would
//! also rename test assertions that check for `Date`, causing tests to fail.
//!
//! See Phase 5 plan for full Temporale specification.

mod support;

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use support::patterns::PatternAssertion;
use tempfile::TempDir;
use tugtool_core::facts::{FactsStore, SymbolKind};
use tugtool_core::types::Location;
use tugtool_python::analyzer::analyze_files;
use tugtool_python::files::{collect_python_files, collect_python_files_excluding};
use tugtool_python::ops::rename;
use tugtool_python::verification::VerificationMode;

/// Get the path to the Temporale sample code directory.
///
/// Resolution order:
/// 1. TUG_TEMPORALE_PATH environment variable (if set)
/// 2. Fetched fixture at .tug/fixtures/temporale/
/// 3. Vendored location at sample-code/python/temporale/ (transition period only)
/// 4. Panic with instructions
fn temporale_path() -> PathBuf {
    use support::fixtures;

    // Check env var first
    if let Ok(path) = std::env::var("TUG_TEMPORALE_PATH") {
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }

    let workspace_root = fixtures::workspace_root();

    // Check fetched fixture location
    let fixture_path = workspace_root.join(".tug").join("fixtures").join("temporale");
    if fixture_path.join("pyproject.toml").exists() {
        return fixture_path;
    }

    // TRANSITION: Check vendored location (remove in Step 7)
    let vendored_path = workspace_root.join("sample-code/python/temporale");
    if vendored_path.join("pyproject.toml").exists() {
        return vendored_path;
    }

    // Neither available - use get_fixture_path to get helpful error
    fixtures::get_fixture_path("temporale", "TUG_TEMPORALE_PATH")
}

/// Copy Temporale to a temp directory for safe mutation.
fn copy_temporale_to_temp() -> TempDir {
    let temp = TempDir::new().expect("create temp dir");
    let source = temporale_path();

    // Copy the entire temporale directory
    copy_dir_recursively(&source, temp.path()).expect("copy temporale");

    temp
}

/// Recursively copy a directory.
fn copy_dir_recursively(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let dest_path = dst.join(entry.file_name());

        if path.is_dir() {
            // Skip __pycache__ and hidden directories
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str == "__pycache__" || name_str.starts_with('.') {
                continue;
            }
            copy_dir_recursively(&path, &dest_path)?;
        } else {
            fs::copy(&path, &dest_path)?;
        }
    }

    Ok(())
}

// ============================================================================
// Analysis Tests
// ============================================================================

#[test]
fn temporale_all_files_parse_successfully() {
    let temporale_dir = temporale_path();
    let files = collect_python_files(&temporale_dir).expect("collect python files");

    // Verify we found a reasonable number of files
    assert!(
        files.len() >= 20,
        "Expected at least 20 Python files, found {}",
        files.len()
    );

    // Analyze all files
    let mut store = FactsStore::new();
    let bundle = analyze_files(&files, &mut store).expect("analyze files");

    // Verify all files parsed successfully
    assert!(
        bundle.is_complete(),
        "Expected all files to parse successfully, but {} failed: {:?}",
        bundle.failure_count(),
        bundle.failed_files
    );

    eprintln!(
        "Successfully parsed {} Temporale files",
        bundle.success_count()
    );
}

#[test]
fn temporale_symbol_count_meets_criteria() {
    // Phase 5 success criteria: at least 100 distinct symbols
    let temporale_dir = temporale_path();
    let files = collect_python_files(&temporale_dir).expect("collect python files");

    let mut store = FactsStore::new();
    let _bundle = analyze_files(&files, &mut store).expect("analyze files");

    let symbol_count = store.symbols().count();

    // List some symbols for debugging
    let sample_symbols: Vec<String> = store
        .symbols()
        .take(20)
        .map(|s| format!("{} ({:?})", s.name, s.kind))
        .collect();
    eprintln!("Sample symbols: {:?}", sample_symbols);
    eprintln!("Total symbols: {}", symbol_count);

    assert!(
        symbol_count >= 100,
        "Expected at least 100 symbols, found {}. Phase 5 success criteria not met.",
        symbol_count
    );
}

#[test]
fn temporale_cross_module_reference_count_meets_criteria() {
    // Phase 5 success criteria: at least 50 cross-module references
    let temporale_dir = temporale_path();
    let files = collect_python_files(&temporale_dir).expect("collect python files");

    let mut store = FactsStore::new();
    let _bundle = analyze_files(&files, &mut store).expect("analyze files");

    // Count cross-module references (reference file != symbol definition file)
    let mut cross_module_refs = 0;
    let mut cross_module_details: Vec<String> = Vec::new();

    for reference in store.references() {
        if let Some(target_symbol) = store.symbol(reference.symbol_id) {
            if reference.file_id != target_symbol.decl_file_id {
                cross_module_refs += 1;
                if cross_module_details.len() < 10 {
                    cross_module_details.push(format!(
                        "{} in file {} -> symbol defined in file {}",
                        target_symbol.name, reference.file_id.0, target_symbol.decl_file_id.0
                    ));
                }
            }
        }
    }

    eprintln!("Sample cross-module references: {:?}", cross_module_details);
    eprintln!("Total cross-module references: {}", cross_module_refs);

    assert!(
        cross_module_refs >= 50,
        "Expected at least 50 cross-module references, found {}. Phase 5 success criteria not met.",
        cross_module_refs
    );
}

#[test]
fn temporale_has_expected_core_symbols() {
    // Verify specific symbols from the plan exist
    let temporale_dir = temporale_path();
    let files = collect_python_files(&temporale_dir).expect("collect python files");

    let mut store = FactsStore::new();
    let _bundle = analyze_files(&files, &mut store).expect("analyze files");

    let symbol_names: HashSet<String> = store.symbols().map(|s| s.name.clone()).collect();

    let expected_symbols = [
        "Date",
        "Time",
        "DateTime",
        "Duration",
        "Period",
        "Interval",
        "Era",
        "TimeUnit",
        "Timezone",
        "TemporaleError",
        "ValidationError",
        "ParseError",
        "parse_iso8601",
        "format_iso8601",
        "parse_fuzzy",
        "parse_relative",
        "InferOptions",
        "DateOrder",
    ];

    let mut missing = Vec::new();
    for name in expected_symbols {
        if !symbol_names.contains(name) {
            missing.push(name);
        }
    }

    assert!(
        missing.is_empty(),
        "Missing expected symbols: {:?}",
        missing
    );

    eprintln!("All {} expected core symbols found", expected_symbols.len());
}

// ============================================================================
// Refactoring Tests
// ============================================================================

/// Test renaming Date -> CalendarDate (List L01 scenario #2)
///
/// This test verifies the rename operation produces syntactically valid Python
/// and that expected changes are made. Uses syntax verification (compileall)
/// and pattern assertions rather than pytest.
#[test]
fn temporale_refactor_rename_date_class() {
    let python_env = support::python::get_python_env();
    let temp = copy_temporale_to_temp();

    // Collect files from temp directory, EXCLUDING tests
    // This prevents test files from being renamed, which would break pytest verification
    let files =
        collect_python_files_excluding(temp.path(), &["tests/", "test_*.py", "conftest.py"])
            .expect("collect python files");

    // Find the Date class definition location
    let mut store = FactsStore::new();
    let _bundle = analyze_files(&files, &mut store).expect("analyze files");

    // Find the Date symbol (class type)
    let date_symbol = store
        .symbols()
        .find(|s| s.name == "Date" && s.kind == SymbolKind::Class)
        .expect("Date class symbol not found");

    // Get the file path for the Date symbol
    let file = store.file(date_symbol.decl_file_id).expect("file");
    let file_path = file.path.clone();

    // Calculate line/col from byte offset
    let content = files
        .iter()
        .find(|(p, _)| p == &file_path)
        .map(|(_, c)| c.as_str())
        .expect("file content");

    let (line, col) = byte_offset_to_line_col(content, date_symbol.decl_span.start as u32);

    let location = Location::new(file_path.clone(), line, col);

    // Run the rename operation with syntax verification (compileall)
    let result = rename::run(
        temp.path(),
        &files,
        &location,
        "CalendarDate",
        python_env.python_cmd(),
        VerificationMode::Syntax,
        true, // apply changes
    );

    assert!(
        result.is_ok(),
        "Rename Date -> CalendarDate failed: {:?}",
        result.err()
    );

    let output = result.unwrap();
    assert_eq!(output.status, "ok");
    assert!(output.summary.edits_count > 0, "Expected edits to be made");

    // Verify a meaningful number of edits were made (class + usages + __all__ exports)
    assert!(
        output.summary.edits_count >= 50,
        "Expected at least 50 edits for Date rename, got {}",
        output.summary.edits_count
    );

    eprintln!(
        "Renamed Date -> CalendarDate: {} edits in {} files",
        output.summary.edits_count, output.summary.files_changed
    );

    // Verify expected changes via pattern assertions
    let assertions = vec![
        PatternAssertion::contains(
            &file_path,
            "class CalendarDate",
            "Class should be renamed to CalendarDate",
        ),
        PatternAssertion::not_contains(
            &file_path,
            "class Date:",
            "Old class name should be removed",
        ),
        // Verify __all__ export was updated (positive check - docstrings won't have this)
        PatternAssertion::contains(
            &file_path,
            "\"CalendarDate\"",
            "__all__ should contain the new name",
        ),
    ];

    support::patterns::check_patterns(temp.path(), &assertions)
        .expect("Pattern assertions should pass");

    eprintln!("Syntax verification passed for Date -> CalendarDate rename");
}

/// Test renaming ValidationError -> InvalidInputError (List L01 scenario #7)
///
/// This test verifies the rename operation produces syntactically valid Python
/// and that expected changes are made. Uses syntax verification (compileall)
/// and pattern assertions rather than pytest.
#[test]
fn temporale_refactor_rename_validation_error() {
    let python_env = support::python::get_python_env();
    let temp = copy_temporale_to_temp();

    // Collect files EXCLUDING tests
    let files =
        collect_python_files_excluding(temp.path(), &["tests/", "test_*.py", "conftest.py"])
            .expect("collect python files");

    let mut store = FactsStore::new();
    let _bundle = analyze_files(&files, &mut store).expect("analyze files");

    // Find the ValidationError symbol
    let validation_error_symbol = store
        .symbols()
        .find(|s| s.name == "ValidationError" && s.kind == SymbolKind::Class)
        .expect("ValidationError class symbol not found");

    let file = store
        .file(validation_error_symbol.decl_file_id)
        .expect("file");
    let file_path = file.path.clone();

    let content = files
        .iter()
        .find(|(p, _)| p == &file_path)
        .map(|(_, c)| c.as_str())
        .expect("file content");

    let (line, col) =
        byte_offset_to_line_col(content, validation_error_symbol.decl_span.start as u32);

    let location = Location::new(file_path.clone(), line, col);

    // Run rename with syntax verification
    let result = rename::run(
        temp.path(),
        &files,
        &location,
        "InvalidInputError",
        python_env.python_cmd(),
        VerificationMode::Syntax,
        true,
    );

    assert!(
        result.is_ok(),
        "Rename ValidationError -> InvalidInputError failed: {:?}",
        result.err()
    );

    let output = result.unwrap();
    assert_eq!(output.status, "ok");
    assert!(output.summary.edits_count > 0, "Expected edits to be made");

    eprintln!(
        "Renamed ValidationError -> InvalidInputError: {} edits in {} files",
        output.summary.edits_count, output.summary.files_changed
    );

    // Verify expected changes via pattern assertions
    let assertions = vec![
        PatternAssertion::contains(
            &file_path,
            "class InvalidInputError",
            "Class should be renamed to InvalidInputError",
        ),
        PatternAssertion::not_contains(
            &file_path,
            "class ValidationError",
            "Old class name should be removed",
        ),
        // Verify __all__ export was updated (positive check)
        PatternAssertion::contains(
            &file_path,
            "\"InvalidInputError\"",
            "__all__ should contain the new name",
        ),
    ];

    support::patterns::check_patterns(temp.path(), &assertions)
        .expect("Pattern assertions should pass");

    eprintln!("Syntax verification passed for ValidationError -> InvalidInputError rename");
}

/// Test renaming Era.BCE -> Era.BEFORE_COMMON_ERA (List L01 scenario #5)
///
/// This test verifies the rename operation produces syntactically valid Python
/// and that expected changes are made. Uses syntax verification (compileall)
/// and pattern assertions rather than pytest.
#[test]
fn temporale_refactor_rename_era_bce() {
    let python_env = support::python::get_python_env();
    let temp = copy_temporale_to_temp();

    // Collect files EXCLUDING tests
    let files =
        collect_python_files_excluding(temp.path(), &["tests/", "test_*.py", "conftest.py"])
            .expect("collect python files");

    let mut store = FactsStore::new();
    let _bundle = analyze_files(&files, &mut store).expect("analyze files");

    // Find the BCE enum member
    // Note: In Python, enum members are typically represented as class-level assignments
    let bce_symbol = store.symbols().find(|s| s.name == "BCE").expect(
        "BCE symbol not found - may need to check how enum members are represented in analysis",
    );

    let file = store.file(bce_symbol.decl_file_id).expect("file");
    let file_path = file.path.clone();

    let content = files
        .iter()
        .find(|(p, _)| p == &file_path)
        .map(|(_, c)| c.as_str())
        .expect("file content");

    let (line, col) = byte_offset_to_line_col(content, bce_symbol.decl_span.start as u32);

    let location = Location::new(file_path.clone(), line, col);

    // Run rename with syntax verification
    let result = rename::run(
        temp.path(),
        &files,
        &location,
        "BEFORE_COMMON_ERA",
        python_env.python_cmd(),
        VerificationMode::Syntax,
        true,
    );

    assert!(
        result.is_ok(),
        "Rename Era.BCE -> Era.BEFORE_COMMON_ERA failed: {:?}",
        result.err()
    );

    let output = result.unwrap();
    assert_eq!(output.status, "ok");
    assert!(output.summary.edits_count > 0, "Expected edits to be made");

    eprintln!(
        "Renamed BCE -> BEFORE_COMMON_ERA: {} edits in {} files",
        output.summary.edits_count, output.summary.files_changed
    );

    // Verify expected changes via pattern assertions
    let assertions = vec![
        PatternAssertion::contains(
            &file_path,
            "BEFORE_COMMON_ERA",
            "Enum member should be renamed to BEFORE_COMMON_ERA",
        ),
        PatternAssertion::not_contains(&file_path, "BCE =", "Old enum member name should be gone"),
    ];

    support::patterns::check_patterns(temp.path(), &assertions)
        .expect("Pattern assertions should pass");

    eprintln!("Syntax verification passed for BCE -> BEFORE_COMMON_ERA rename");
}

// ============================================================================
// Full Test Suite Verification
// ============================================================================

#[test]
fn temporale_pytest_passes_on_original() {
    // Verify the original Temporale code passes pytest (baseline check)
    let python_env = support::python::get_python_env();
    let temporale_dir = temporale_path();

    let pytest_result =
        support::python::run_pytest(python_env, &temporale_dir, &["tests/", "-v", "--tb=short"]);

    assert!(
        pytest_result.success,
        "pytest should pass on original Temporale code:\nstdout: {}\nstderr: {}",
        pytest_result.stdout, pytest_result.stderr
    );

    // Extract test count from output
    if let Some(line) = pytest_result.stdout.lines().find(|l| l.contains("passed")) {
        eprintln!("pytest result: {}", line.trim());
    }
}

// ============================================================================
// Helpers
// ============================================================================

/// Convert byte offset to (line, col) 1-indexed.
fn byte_offset_to_line_col(content: &str, offset: u32) -> (u32, u32) {
    let offset = offset as usize;
    let mut line = 1u32;
    let mut col = 1u32;
    let mut current_offset = 0usize;

    for ch in content.chars() {
        if current_offset >= offset {
            break;
        }
        if ch == '\n' {
            line += 1;
            col = 1;
        } else {
            col += 1;
        }
        current_offset += ch.len_utf8();
    }

    (line, col)
}
