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

/// Get the path to the Temporale fixture directory.
///
/// Resolution order:
/// 1. TUG_TEMPORALE_PATH environment variable (if set)
/// 2. Fetched fixture at .tug/fixtures/temporale/
/// 3. Panic with instructions
fn temporale_path() -> PathBuf {
    support::fixtures::get_fixture_path("temporale", "TUG_TEMPORALE_PATH")
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
    let result = rename::rename(
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
    let result = rename::rename(
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
    let result = rename::rename(
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
// Stage 1 New Operations Tests (Phase 14)
// ============================================================================

/// Test rename-param operation: reference_date -> ref_date in _get_next_weekday
///
/// This test verifies that the rename-param operation correctly updates
/// a function parameter and all its usages within the function body.
#[test]
fn temporale_refactor_rename_param_reference_date() {
    let python_env = support::python::get_python_env();
    let temp = copy_temporale_to_temp();

    // Collect files EXCLUDING tests
    let files =
        collect_python_files_excluding(temp.path(), &["tests/", "test_*.py", "conftest.py"])
            .expect("collect python files");

    // Find the _relative.py file path from the collected files
    let relative_path = files
        .iter()
        .find(|(p, _)| p.ends_with("infer/_relative.py"))
        .map(|(p, _)| p.clone())
        .expect("_relative.py file not found");

    // Position on "reference_date" parameter (line 31, col 23)
    // Line 31: def _get_next_weekday(reference_date: "Date", target_weekday: int) -> "Date":
    let location = Location::new(relative_path.clone(), 31, 23);

    // Run the rename-param operation with syntax verification
    let result = tugtool_python::ops::rename_param::rename_param(
        temp.path(),
        &files,
        &location,
        "ref_date",
        python_env.python_cmd(),
        VerificationMode::Syntax,
        true, // apply changes
    );

    assert!(
        result.is_ok(),
        "Rename reference_date -> ref_date failed: {:?}",
        result.err()
    );

    let output = result.unwrap();
    assert_eq!(output.status, "ok");
    assert!(output.summary.edits_count > 0, "Expected edits to be made");

    eprintln!(
        "Renamed reference_date -> ref_date: {} edits in {} files",
        output.summary.edits_count, output.summary.files_changed
    );

    // Verify expected changes via pattern assertions
    let assertions = vec![
        PatternAssertion::contains(
            &relative_path,
            "def _get_next_weekday(ref_date:",
            "Parameter should be renamed to ref_date",
        ),
        PatternAssertion::contains(
            &relative_path,
            "ref_date.day_of_week",
            "Usage in function body should be renamed",
        ),
        PatternAssertion::not_contains(
            &relative_path,
            "_get_next_weekday(reference_date:",
            "Old parameter name should be gone in signature",
        ),
    ];

    support::patterns::check_patterns(temp.path(), &assertions)
        .expect("Pattern assertions should pass");

    eprintln!("Syntax verification passed for reference_date -> ref_date rename-param");
}

/// Test extract-variable operation: extract expression to local variable
///
/// This test verifies that the extract-variable operation correctly extracts
/// an expression and inserts a variable assignment.
///
/// IGNORED: The extract-variable operation has a bug in expression boundary detection.
/// When pointing to `day_of_week` in `reference_date.day_of_week`, it extracts only
/// the attribute name (creating invalid code like `weekday = day_of_week`) instead of
/// the full attribute access. This is tracked for fixing in a future phase.
#[test]
#[ignore = "extract-variable expression boundary detection needs fixing"]
fn temporale_refactor_extract_variable_weekday_diff() {
    let python_env = support::python::get_python_env();
    let temp = copy_temporale_to_temp();

    // Collect files EXCLUDING tests
    let files =
        collect_python_files_excluding(temp.path(), &["tests/", "test_*.py", "conftest.py"])
            .expect("collect python files");

    // Find the _relative.py file from the collected files
    let (relative_path, content) = files
        .iter()
        .find(|(p, _)| p.ends_with("infer/_relative.py"))
        .map(|(p, c)| (p.clone(), c.as_str()))
        .expect("_relative.py file not found");

    // Find _get_this_weekday function, then find "reference_date.day_of_week" within it
    // This is on the line: current_weekday = reference_date.day_of_week
    let func_marker = "def _get_this_weekday";
    let func_offset = content.find(func_marker).expect("_get_this_weekday not found");

    // Find the attribute access expression within this function
    // We point to "day_of_week" to extract the full attribute access
    let target_expr = "reference_date.day_of_week";
    let expr_offset = content[func_offset..]
        .find(target_expr)
        .expect("target expression not found in _get_this_weekday")
        + func_offset;

    // Point to the attribute name "day_of_week" (after the dot)
    let attr_offset = expr_offset + "reference_date.".len();
    let (line, col) = byte_offset_to_line_col(content, attr_offset as u32);

    let location = Location::new(relative_path.clone(), line, col);

    // Run the extract-variable operation
    let result = tugtool_python::ops::extract_variable::extract_variable(
        temp.path(),
        &files,
        &location,
        "weekday",
        python_env.python_cmd(),
        VerificationMode::Syntax,
        true, // apply changes
    );

    assert!(
        result.is_ok(),
        "Extract variable failed: {:?}",
        result.err()
    );

    let output = result.unwrap();
    assert_eq!(output.status, "ok");
    assert!(output.summary.edits_count > 0, "Expected edits to be made");

    eprintln!(
        "Extracted variable weekday: {} edits",
        output.summary.edits_count
    );

    // Verify expected changes via pattern assertions
    // The extract should create: weekday = reference_date.day_of_week
    // and replace the original with: current_weekday = weekday
    let assertions = vec![
        PatternAssertion::contains(
            &relative_path,
            "weekday = reference_date.day_of_week",
            "New variable assignment should be added",
        ),
        PatternAssertion::contains(
            &relative_path,
            "current_weekday = weekday",
            "Original expression should be replaced with variable reference",
        ),
    ];

    support::patterns::check_patterns(temp.path(), &assertions)
        .expect("Pattern assertions should pass");

    eprintln!("Syntax verification passed for extract-variable");
}

/// Test extract-constant operation: extract magic number 7 to DAYS_IN_WEEK
///
/// This test verifies that the extract-constant operation correctly extracts
/// a literal and inserts a module-level constant.
#[test]
fn temporale_refactor_extract_constant_days_in_week() {
    let python_env = support::python::get_python_env();
    let temp = copy_temporale_to_temp();

    // Collect files EXCLUDING tests
    let files =
        collect_python_files_excluding(temp.path(), &["tests/", "test_*.py", "conftest.py"])
            .expect("collect python files");

    // Find the _relative.py file from the collected files
    let (relative_path, content) = files
        .iter()
        .find(|(p, _)| p.ends_with("infer/_relative.py"))
        .map(|(p, c)| (p.clone(), c.as_str()))
        .expect("_relative.py file not found");

    // Find "days_ahead = 7" in _get_next_weekday function (line ~51)
    // We want to extract the literal "7"
    let target_line = "days_ahead = 7";
    let line_offset = content.find(target_line).expect("target line not found");
    // Point to the "7" (the literal)
    let literal_offset = line_offset + target_line.len() - 1; // Position of "7"

    let (line, col) = byte_offset_to_line_col(content, literal_offset as u32);

    let location = Location::new(relative_path.clone(), line, col);

    // Run the extract-constant operation
    let result = tugtool_python::ops::extract_constant::extract_constant(
        temp.path(),
        &files,
        &location,
        "DAYS_IN_WEEK",
        python_env.python_cmd(),
        VerificationMode::Syntax,
        true, // apply changes
    );

    assert!(
        result.is_ok(),
        "Extract constant failed: {:?}",
        result.err()
    );

    let output = result.unwrap();
    assert_eq!(output.status, "ok");
    assert!(output.summary.edits_count > 0, "Expected edits to be made");

    eprintln!(
        "Extracted constant DAYS_IN_WEEK: {} edits",
        output.summary.edits_count
    );

    // Verify expected changes via pattern assertions
    let assertions = vec![
        PatternAssertion::contains(
            &relative_path,
            "DAYS_IN_WEEK = 7",
            "Module-level constant should be defined",
        ),
        PatternAssertion::contains(
            &relative_path,
            "days_ahead = DAYS_IN_WEEK",
            "Literal should be replaced with constant reference",
        ),
    ];

    support::patterns::check_patterns(temp.path(), &assertions)
        .expect("Pattern assertions should pass");

    eprintln!("Syntax verification passed for extract-constant");
}

/// Test extract-constant with string literal from error message
///
/// This test extracts an error message string into a module-level constant.
#[test]
fn temporale_refactor_extract_constant_error_message() {
    let python_env = support::python::get_python_env();
    let temp = copy_temporale_to_temp();

    // Collect files EXCLUDING tests
    let files =
        collect_python_files_excluding(temp.path(), &["tests/", "test_*.py", "conftest.py"])
            .expect("collect python files");

    // Find the _relative.py file from the collected files
    let (relative_path, content) = files
        .iter()
        .find(|(p, _)| p.ends_with("infer/_relative.py"))
        .map(|(p, c)| (p.clone(), c.as_str()))
        .expect("_relative.py file not found");

    // Find the "empty string" literal in ParseError
    let target = "\"empty string\"";
    let literal_offset = content.find(target).expect("target string not found");

    let (line, col) = byte_offset_to_line_col(content, literal_offset as u32);

    let location = Location::new(relative_path.clone(), line, col);

    // Run the extract-constant operation
    let result = tugtool_python::ops::extract_constant::extract_constant(
        temp.path(),
        &files,
        &location,
        "EMPTY_STRING_ERROR",
        python_env.python_cmd(),
        VerificationMode::Syntax,
        true, // apply changes
    );

    assert!(
        result.is_ok(),
        "Extract constant (string) failed: {:?}",
        result.err()
    );

    let output = result.unwrap();
    assert_eq!(output.status, "ok");
    assert!(output.summary.edits_count > 0, "Expected edits to be made");

    eprintln!(
        "Extracted string constant EMPTY_STRING_ERROR: {} edits",
        output.summary.edits_count
    );

    // Verify expected changes via pattern assertions
    let assertions = vec![
        PatternAssertion::contains(
            &relative_path,
            "EMPTY_STRING_ERROR = \"empty string\"",
            "Module-level string constant should be defined",
        ),
        PatternAssertion::contains(
            &relative_path,
            "raise ParseError(EMPTY_STRING_ERROR)",
            "String literal should be replaced with constant reference",
        ),
    ];

    support::patterns::check_patterns(temp.path(), &assertions)
        .expect("Pattern assertions should pass");

    eprintln!("Syntax verification passed for extract-constant (string)");
}

// ============================================================================
// Step 1.5 Collision Fix Tests (Phase 14)
// ============================================================================
//
// These tests verify that the symbol_lookup collision fix works correctly
// in real-world code. The _relative.py file has multiple functions with
// the same `reference_date` parameter - perfect for testing the collision fix.

/// Test collision fix: rename parameter in _get_next_weekday_strict
/// and verify OTHER functions with same-named parameters are NOT touched.
///
/// This is the critical collision fix test. Before the fix, renaming
/// `reference_date` in one function would incorrectly affect ALL functions
/// with that parameter name.
#[test]
fn temporale_collision_fix_rename_param_strict_only() {
    let python_env = support::python::get_python_env();
    let temp = copy_temporale_to_temp();

    let files =
        collect_python_files_excluding(temp.path(), &["tests/", "test_*.py", "conftest.py"])
            .expect("collect python files");

    let relative_path = files
        .iter()
        .find(|(p, _)| p.ends_with("infer/_relative.py"))
        .map(|(p, _)| p.clone())
        .expect("_relative.py file not found");

    // Find line number for _get_next_weekday_strict function
    let (_, content) = files
        .iter()
        .find(|(p, _)| p.ends_with("infer/_relative.py"))
        .map(|(p, c)| (p.clone(), c.as_str()))
        .expect("_relative.py file not found");

    // Find "def _get_next_weekday_strict(reference_date:"
    let target = "def _get_next_weekday_strict(reference_date:";
    let offset = content.find(target).expect("target function not found");
    let (line, _) = byte_offset_to_line_col(content, offset as u32);

    // Position on "reference_date" parameter (after "def _get_next_weekday_strict(")
    let param_col = "def _get_next_weekday_strict(".len() as u32 + 1;
    let location = Location::new(relative_path.clone(), line, param_col);

    let result = tugtool_python::ops::rename_param::rename_param(
        temp.path(),
        &files,
        &location,
        "ref_dt",
        python_env.python_cmd(),
        VerificationMode::Syntax,
        true,
    );

    assert!(
        result.is_ok(),
        "Rename reference_date -> ref_dt in _strict failed: {:?}",
        result.err()
    );

    let output = result.unwrap();
    assert_eq!(output.status, "ok");

    // Should have at least 2 edits: parameter + body usage
    assert!(
        output.summary.edits_count >= 2,
        "Expected at least 2 edits, got {}",
        output.summary.edits_count
    );

    eprintln!(
        "Renamed reference_date -> ref_dt in _strict: {} edits",
        output.summary.edits_count
    );

    // CRITICAL ASSERTIONS:
    // 1. _get_next_weekday_strict should have ref_dt
    // 2. OTHER functions should STILL have reference_date (collision fix!)
    let assertions = vec![
        // _get_next_weekday_strict should be renamed
        PatternAssertion::contains(
            &relative_path,
            "def _get_next_weekday_strict(ref_dt:",
            "_strict parameter should be renamed",
        ),
        PatternAssertion::contains(
            &relative_path,
            "ref_dt.day_of_week",
            "_strict body should use renamed parameter",
        ),
        // OTHER FUNCTIONS MUST NOT BE TOUCHED (collision fix!)
        PatternAssertion::contains(
            &relative_path,
            "def _get_next_weekday(reference_date:",
            "_get_next_weekday should still have reference_date",
        ),
        PatternAssertion::contains(
            &relative_path,
            "def _get_last_weekday(reference_date:",
            "_get_last_weekday should still have reference_date",
        ),
        PatternAssertion::contains(
            &relative_path,
            "def _get_this_weekday(reference_date:",
            "_get_this_weekday should still have reference_date",
        ),
    ];

    support::patterns::check_patterns(temp.path(), &assertions)
        .expect("Collision fix pattern assertions should pass");

    eprintln!("COLLISION FIX VERIFIED: Only _strict was renamed, others untouched");
}

/// Test collision fix: rename parameter in _get_last_weekday
/// and verify all other functions are unaffected.
#[test]
fn temporale_collision_fix_rename_param_last_only() {
    let python_env = support::python::get_python_env();
    let temp = copy_temporale_to_temp();

    let files =
        collect_python_files_excluding(temp.path(), &["tests/", "test_*.py", "conftest.py"])
            .expect("collect python files");

    let relative_path = files
        .iter()
        .find(|(p, _)| p.ends_with("infer/_relative.py"))
        .map(|(p, _)| p.clone())
        .expect("_relative.py file not found");

    let (_, content) = files
        .iter()
        .find(|(p, _)| p.ends_with("infer/_relative.py"))
        .map(|(p, c)| (p.clone(), c.as_str()))
        .expect("_relative.py file not found");

    // Find "def _get_last_weekday(reference_date:"
    let target = "def _get_last_weekday(reference_date:";
    let offset = content.find(target).expect("_get_last_weekday not found");
    let (line, _) = byte_offset_to_line_col(content, offset as u32);

    let param_col = "def _get_last_weekday(".len() as u32 + 1;
    let location = Location::new(relative_path.clone(), line, param_col);

    let result = tugtool_python::ops::rename_param::rename_param(
        temp.path(),
        &files,
        &location,
        "base_date",
        python_env.python_cmd(),
        VerificationMode::Syntax,
        true,
    );

    assert!(
        result.is_ok(),
        "Rename reference_date -> base_date in _last failed: {:?}",
        result.err()
    );

    let output = result.unwrap();
    assert_eq!(output.status, "ok");
    assert!(
        output.summary.edits_count >= 2,
        "Expected at least 2 edits, got {}",
        output.summary.edits_count
    );

    eprintln!(
        "Renamed reference_date -> base_date in _last: {} edits",
        output.summary.edits_count
    );

    let assertions = vec![
        // _get_last_weekday should be renamed
        PatternAssertion::contains(
            &relative_path,
            "def _get_last_weekday(base_date:",
            "_last parameter should be renamed",
        ),
        PatternAssertion::contains(
            &relative_path,
            "base_date.day_of_week",
            "_last body should use renamed parameter",
        ),
        // OTHER FUNCTIONS MUST NOT BE TOUCHED
        PatternAssertion::contains(
            &relative_path,
            "def _get_next_weekday(reference_date:",
            "_get_next_weekday should still have reference_date",
        ),
        PatternAssertion::contains(
            &relative_path,
            "def _get_next_weekday_strict(reference_date:",
            "_get_next_weekday_strict should still have reference_date",
        ),
        PatternAssertion::contains(
            &relative_path,
            "def _get_this_weekday(reference_date:",
            "_get_this_weekday should still have reference_date",
        ),
    ];

    support::patterns::check_patterns(temp.path(), &assertions)
        .expect("Collision fix pattern assertions should pass");

    eprintln!("COLLISION FIX VERIFIED: Only _last was renamed, others untouched");
}

/// Test that rename-param correctly updates body_references count
/// for Temporale's _get_this_weekday function.
#[test]
fn temporale_collision_fix_body_references_populated() {
    let _python_env = support::python::get_python_env();
    let temp = copy_temporale_to_temp();

    let files =
        collect_python_files_excluding(temp.path(), &["tests/", "test_*.py", "conftest.py"])
            .expect("collect python files");

    let relative_path = files
        .iter()
        .find(|(p, _)| p.ends_with("infer/_relative.py"))
        .map(|(p, _)| p.clone())
        .expect("_relative.py file not found");

    let (_, content) = files
        .iter()
        .find(|(p, _)| p.ends_with("infer/_relative.py"))
        .map(|(p, c)| (p.clone(), c.as_str()))
        .expect("_relative.py file not found");

    // Find "def _get_this_weekday(reference_date:"
    let target = "def _get_this_weekday(reference_date:";
    let offset = content.find(target).expect("_get_this_weekday not found");
    let (line, _) = byte_offset_to_line_col(content, offset as u32);

    let param_col = "def _get_this_weekday(".len() as u32 + 1;
    let location = Location::new(relative_path.clone(), line, param_col);

    // Use analyze (not apply) to check body_references
    let result = tugtool_python::ops::rename_param::analyze_param(
        temp.path(),
        &files,
        &location,
        "ref",
    );

    assert!(
        result.is_ok(),
        "Analyze rename-param failed: {:?}",
        result.err()
    );

    let output = result.unwrap();

    // CRITICAL: body_references should NOT be empty (the collision bug fix)
    assert!(
        !output.body_references.is_empty(),
        "body_references should be populated (collision fix!): got {:?}",
        output.body_references
    );

    // _get_this_weekday uses reference_date twice in its body:
    // 1. current_weekday = reference_date.day_of_week
    // 2. return reference_date + Duration(days=days_diff)
    // Plus the parameter declaration = at least 3 total
    assert!(
        output.body_references.len() >= 3,
        "Expected at least 3 body_references (decl + 2 usages), got {}",
        output.body_references.len()
    );

    eprintln!(
        "body_references correctly populated with {} references for _get_this_weekday",
        output.body_references.len()
    );
}

/// Test general rename on parameters works with collision fix
/// (using the general rename operation, not rename_param)
#[test]
fn temporale_collision_fix_general_rename_param() {
    let python_env = support::python::get_python_env();
    let temp = copy_temporale_to_temp();

    let files =
        collect_python_files_excluding(temp.path(), &["tests/", "test_*.py", "conftest.py"])
            .expect("collect python files");

    let relative_path = files
        .iter()
        .find(|(p, _)| p.ends_with("infer/_relative.py"))
        .map(|(p, _)| p.clone())
        .expect("_relative.py file not found");

    let (_, content) = files
        .iter()
        .find(|(p, _)| p.ends_with("infer/_relative.py"))
        .map(|(p, c)| (p.clone(), c.as_str()))
        .expect("_relative.py file not found");

    // Find the target_weekday parameter in _get_next_weekday (this is also duplicated!)
    let target = "def _get_next_weekday(reference_date: \"Date\", target_weekday:";
    let fn_offset = content.find(target).expect("_get_next_weekday not found");
    let param_offset = content[fn_offset..]
        .find("target_weekday")
        .expect("target_weekday not found");
    let (line, col) = byte_offset_to_line_col(content, (fn_offset + param_offset) as u32);

    let location = Location::new(relative_path.clone(), line, col);

    // Use general rename (not rename_param)
    let result = tugtool_python::ops::rename::rename(
        temp.path(),
        &files,
        &location,
        "day_of_week_target",
        python_env.python_cmd(),
        VerificationMode::Syntax,
        true,
    );

    assert!(
        result.is_ok(),
        "General rename target_weekday failed: {:?}",
        result.err()
    );

    let output = result.unwrap();
    assert_eq!(output.status, "ok");

    eprintln!(
        "General rename target_weekday -> day_of_week_target: {} edits",
        output.summary.edits_count
    );

    // Verify only _get_next_weekday was affected, not the other functions
    // that also have target_weekday parameters
    let assertions = vec![
        PatternAssertion::contains(
            &relative_path,
            "def _get_next_weekday(reference_date: \"Date\", day_of_week_target:",
            "_get_next_weekday should have renamed parameter",
        ),
        // Other functions should still have target_weekday
        PatternAssertion::contains(
            &relative_path,
            "def _get_next_weekday_strict(reference_date: \"Date\", target_weekday:",
            "_strict should still have target_weekday",
        ),
        PatternAssertion::contains(
            &relative_path,
            "def _get_last_weekday(reference_date: \"Date\", target_weekday:",
            "_last should still have target_weekday",
        ),
        PatternAssertion::contains(
            &relative_path,
            "def _get_this_weekday(reference_date: \"Date\", target_weekday:",
            "_this should still have target_weekday",
        ),
    ];

    support::patterns::check_patterns(temp.path(), &assertions)
        .expect("General rename collision fix should work");

    eprintln!("COLLISION FIX VERIFIED: General rename only affected _get_next_weekday");
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
