//! Integration tests for tug-core
//!
//! These tests validate the parser and validator against fixture files.

use std::fs;
use tugtool_core::{Severity, parse_tugplan, validate_tugplan};

const FIXTURES_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/fixtures");
const GOLDEN_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/fixtures/golden");

#[test]
fn test_valid_minimal_fixture() {
    let content = fs::read_to_string(format!("{}/valid/minimal.md", FIXTURES_DIR))
        .expect("Failed to read minimal.md fixture");

    let plan = parse_tugplan(&content).expect("Failed to parse minimal plan");
    let result = validate_tugplan(&plan);

    // Check no errors
    let errors: Vec<_> = result
        .issues
        .iter()
        .filter(|i| i.severity == Severity::Error)
        .collect();
    assert!(
        errors.is_empty(),
        "Valid minimal plan should have no errors, got: {:?}",
        errors
    );
}

#[test]
fn test_invalid_missing_metadata_fixture() {
    let content = fs::read_to_string(format!("{}/invalid/missing-metadata.md", FIXTURES_DIR))
        .expect("Failed to read missing-metadata.md fixture");

    let plan = parse_tugplan(&content).expect("Failed to parse plan");
    let result = validate_tugplan(&plan);

    // Should have E002 errors for missing metadata fields
    let e002_errors: Vec<_> = result
        .issues
        .iter()
        .filter(|i| i.code == "E002" && i.severity == Severity::Error)
        .collect();

    assert!(
        !e002_errors.is_empty(),
        "Missing metadata plan should have E002 errors"
    );
    assert!(
        !result.valid,
        "Plan with missing metadata should be invalid"
    );
}

#[test]
fn test_invalid_circular_deps_fixture() {
    let content = fs::read_to_string(format!("{}/invalid/circular-deps.md", FIXTURES_DIR))
        .expect("Failed to read circular-deps.md fixture");

    let plan = parse_tugplan(&content).expect("Failed to parse plan");
    let result = validate_tugplan(&plan);

    // Should have E011 error for circular dependency
    let e011_errors: Vec<_> = result
        .issues
        .iter()
        .filter(|i| i.code == "E011" && i.severity == Severity::Error)
        .collect();

    assert!(
        !e011_errors.is_empty(),
        "Circular deps plan should have E011 error"
    );
    assert!(!result.valid, "Plan with circular deps should be invalid");
}

#[test]
fn test_invalid_duplicate_anchors_fixture() {
    let content = fs::read_to_string(format!("{}/invalid/invalid-anchors.md", FIXTURES_DIR))
        .expect("Failed to read invalid-anchors.md fixture");

    let plan = parse_tugplan(&content).expect("Failed to parse plan");
    let result = validate_tugplan(&plan);

    // Should have E006 error for duplicate anchor
    let e006_errors: Vec<_> = result
        .issues
        .iter()
        .filter(|i| i.code == "E006" && i.severity == Severity::Error)
        .collect();

    assert!(
        !e006_errors.is_empty(),
        "Duplicate anchor plan should have E006 error"
    );
    assert!(
        !result.valid,
        "Plan with duplicate anchors should be invalid"
    );
}

#[test]
fn test_parser_handles_all_fixtures() {
    // Test that the parser doesn't panic on any fixture files
    let valid_dir = format!("{}/valid", FIXTURES_DIR);
    let invalid_dir = format!("{}/invalid", FIXTURES_DIR);

    for dir in [valid_dir, invalid_dir] {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|e| e == "md") {
                    let content = fs::read_to_string(&path)
                        .unwrap_or_else(|_| panic!("Failed to read {:?}", path));
                    let result = parse_tugplan(&content);
                    assert!(
                        result.is_ok(),
                        "Parser should not panic on {:?}: {:?}",
                        path,
                        result.err()
                    );
                }
            }
        }
    }
}

#[test]
fn test_valid_complete_fixture() {
    let content = fs::read_to_string(format!("{}/valid/complete.md", FIXTURES_DIR))
        .expect("Failed to read complete.md fixture");

    let plan = parse_tugplan(&content).expect("Failed to parse complete plan");
    let result = validate_tugplan(&plan);

    // Check no errors
    let errors: Vec<_> = result
        .issues
        .iter()
        .filter(|i| i.severity == Severity::Error)
        .collect();
    assert!(
        errors.is_empty(),
        "Valid complete plan should have no errors, got: {:?}",
        errors
    );

    // Verify structure was parsed correctly
    assert!(plan.phase_title.is_some(), "Should have phase title");
    assert!(plan.metadata.owner.is_some(), "Should have owner");
    assert!(!plan.decisions.is_empty(), "Should have decisions");
    assert!(!plan.steps.is_empty(), "Should have steps");
}

#[test]
fn test_valid_with_substeps_fixture() {
    let content = fs::read_to_string(format!("{}/valid/with-substeps.md", FIXTURES_DIR))
        .expect("Failed to read with-substeps.md fixture");

    let plan = parse_tugplan(&content).expect("Failed to parse with-substeps plan");
    let result = validate_tugplan(&plan);

    // Check no errors
    let errors: Vec<_> = result
        .issues
        .iter()
        .filter(|i| i.severity == Severity::Error)
        .collect();
    assert!(
        errors.is_empty(),
        "Valid with-substeps plan should have no errors, got: {:?}",
        errors
    );

    // Verify substeps were parsed
    let step_with_substeps = plan.steps.iter().find(|s| !s.substeps.is_empty());
    assert!(
        step_with_substeps.is_some(),
        "Should have at least one step with substeps"
    );

    let step = step_with_substeps.unwrap();
    assert!(
        step.substeps.len() >= 2,
        "Step with substeps should have multiple substeps"
    );
}

#[test]
fn test_valid_agent_output_example_fixture() {
    let content = fs::read_to_string(format!("{}/valid/agent-output-example.md", FIXTURES_DIR))
        .expect("Failed to read agent-output-example.md fixture");

    let plan = parse_tugplan(&content).expect("Failed to parse agent-output-example plan");
    let result = validate_tugplan(&plan);

    // Check no errors
    let errors: Vec<_> = result
        .issues
        .iter()
        .filter(|i| i.severity == Severity::Error)
        .collect();
    assert!(
        errors.is_empty(),
        "Valid agent-output-example plan should have no errors, got: {:?}",
        errors
    );

    // Verify some checkboxes are checked (showing progress)
    let checked_count: usize = plan
        .steps
        .iter()
        .flat_map(|s| {
            s.tasks
                .iter()
                .chain(s.tests.iter())
                .chain(s.checkpoints.iter())
        })
        .filter(|c| c.checked)
        .count();
    assert!(
        checked_count > 0,
        "Should have some checked items showing progress"
    );
}

#[test]
fn test_invalid_duplicate_anchors_dedicated_fixture() {
    let content = fs::read_to_string(format!("{}/invalid/duplicate-anchors.md", FIXTURES_DIR))
        .expect("Failed to read duplicate-anchors.md fixture");

    let plan = parse_tugplan(&content).expect("Failed to parse plan");
    let result = validate_tugplan(&plan);

    // Should have E006 error for duplicate anchor
    let e006_errors: Vec<_> = result
        .issues
        .iter()
        .filter(|i| i.code == "E006" && i.severity == Severity::Error)
        .collect();

    assert!(
        !e006_errors.is_empty(),
        "Duplicate anchor plan should have E006 error"
    );
    assert!(
        !result.valid,
        "Plan with duplicate anchors should be invalid"
    );
}

#[test]
fn test_invalid_missing_references_fixture() {
    let content = fs::read_to_string(format!("{}/invalid/missing-references.md", FIXTURES_DIR))
        .expect("Failed to read missing-references.md fixture");

    let plan = parse_tugplan(&content).expect("Failed to parse plan");
    let result = validate_tugplan(&plan);

    // Should have E010 error for broken references
    let e010_errors: Vec<_> = result
        .issues
        .iter()
        .filter(|i| i.code == "E010" && i.severity == Severity::Error)
        .collect();

    assert!(
        !e010_errors.is_empty(),
        "Missing references plan should have E010 errors, got issues: {:?}",
        result.issues
    );
    assert!(
        !result.valid,
        "Plan with missing references should be invalid"
    );
}

// Golden tests - compare validation output against expected JSON
mod golden_tests {
    use super::*;
    use serde_json::Value;

    fn load_golden(name: &str) -> Value {
        let path = format!("{}/{}.validated.json", GOLDEN_DIR, name);
        let content = fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("Failed to read golden file: {}", path));
        serde_json::from_str(&content).expect("Failed to parse golden JSON")
    }

    #[test]
    fn test_golden_minimal_valid() {
        let content = fs::read_to_string(format!("{}/valid/minimal.md", FIXTURES_DIR))
            .expect("Failed to read minimal.md fixture");

        let plan = parse_tugplan(&content).expect("Failed to parse plan");
        let result = validate_tugplan(&plan);

        let golden = load_golden("minimal");

        assert_eq!(
            golden["status"].as_str().unwrap(),
            "ok",
            "Golden expects ok status"
        );
        assert!(result.valid, "Validation should pass");
        assert_eq!(
            result
                .issues
                .iter()
                .filter(|i| i.severity == Severity::Error)
                .count(),
            0,
            "Should have no errors"
        );
    }

    #[test]
    fn test_golden_complete_valid() {
        let content = fs::read_to_string(format!("{}/valid/complete.md", FIXTURES_DIR))
            .expect("Failed to read complete.md fixture");

        let plan = parse_tugplan(&content).expect("Failed to parse plan");
        let result = validate_tugplan(&plan);

        let golden = load_golden("complete");

        assert_eq!(
            golden["status"].as_str().unwrap(),
            "ok",
            "Golden expects ok status"
        );
        assert!(result.valid, "Validation should pass");
    }

    #[test]
    fn test_golden_missing_metadata_invalid() {
        let content = fs::read_to_string(format!("{}/invalid/missing-metadata.md", FIXTURES_DIR))
            .expect("Failed to read missing-metadata.md fixture");

        let plan = parse_tugplan(&content).expect("Failed to parse plan");
        let result = validate_tugplan(&plan);

        let golden = load_golden("missing-metadata");

        assert_eq!(
            golden["status"].as_str().unwrap(),
            "error",
            "Golden expects error status"
        );
        assert!(!result.valid, "Validation should fail");

        // Check error count matches golden
        let golden_error_count = golden["data"]["files"][0]["error_count"]
            .as_u64()
            .unwrap_or(0) as usize;
        let actual_error_count = result
            .issues
            .iter()
            .filter(|i| i.severity == Severity::Error)
            .count();
        assert_eq!(
            actual_error_count, golden_error_count,
            "Error count should match golden"
        );
    }

    #[test]
    fn test_golden_duplicate_anchors_invalid() {
        let content = fs::read_to_string(format!("{}/invalid/duplicate-anchors.md", FIXTURES_DIR))
            .expect("Failed to read duplicate-anchors.md fixture");

        let plan = parse_tugplan(&content).expect("Failed to parse plan");
        let result = validate_tugplan(&plan);

        let golden = load_golden("duplicate-anchors");

        assert_eq!(
            golden["status"].as_str().unwrap(),
            "error",
            "Golden expects error status"
        );
        assert!(!result.valid, "Validation should fail");

        // Verify E006 error code matches
        let golden_codes: Vec<&str> = golden["issues"]
            .as_array()
            .map(|arr| arr.iter().filter_map(|i| i["code"].as_str()).collect())
            .unwrap_or_default();
        assert!(
            golden_codes.contains(&"E006"),
            "Golden should contain E006 error code"
        );

        let has_e006 = result.issues.iter().any(|i| i.code == "E006");
        assert!(has_e006, "Result should have E006 error");
    }
}

// Golden tests for content rendering
mod content_rendering_tests {
    use super::*;

    fn normalize_newlines(s: &str) -> String {
        s.replace("\r\n", "\n").trim().to_string()
    }

    #[test]
    fn test_golden_step_description() {
        let content = fs::read_to_string(format!("{}/valid/enrichment-test.md", FIXTURES_DIR))
            .expect("Failed to read enrichment-test.md fixture");

        let plan = parse_tugplan(&content).expect("Failed to parse enrichment-test plan");
        let result = validate_tugplan(&plan);

        // Plan should be valid
        assert!(result.valid, "enrichment-test.md should be valid");

        // Render step 0 description
        let step = plan.steps.first().expect("Should have step 0");
        let rendered = step.render_description();

        // Load golden output
        let golden = fs::read_to_string(format!("{}/step-description.md", GOLDEN_DIR))
            .expect("Failed to read step-description.md golden file");

        assert_eq!(
            normalize_newlines(&rendered),
            normalize_newlines(&golden),
            "Step description should match golden output"
        );
    }

    #[test]
    fn test_golden_step_acceptance() {
        let content = fs::read_to_string(format!("{}/valid/enrichment-test.md", FIXTURES_DIR))
            .expect("Failed to read enrichment-test.md fixture");

        let plan = parse_tugplan(&content).expect("Failed to parse enrichment-test plan");

        // Render step 0 acceptance criteria
        let step = plan.steps.first().expect("Should have step 0");
        let rendered = step.render_acceptance_criteria();

        // Load golden output
        let golden = fs::read_to_string(format!("{}/step-acceptance.md", GOLDEN_DIR))
            .expect("Failed to read step-acceptance.md golden file");

        assert_eq!(
            normalize_newlines(&rendered),
            normalize_newlines(&golden),
            "Step acceptance criteria should match golden output"
        );
    }

    #[test]
    fn test_golden_root_description() {
        let content = fs::read_to_string(format!("{}/valid/enrichment-test.md", FIXTURES_DIR))
            .expect("Failed to read enrichment-test.md fixture");

        let plan = parse_tugplan(&content).expect("Failed to parse enrichment-test plan");

        // Render root description
        let rendered = plan.render_root_description();

        // Load golden output
        let golden = fs::read_to_string(format!("{}/root-description.md", GOLDEN_DIR))
            .expect("Failed to read root-description.md golden file");

        assert_eq!(
            normalize_newlines(&rendered),
            normalize_newlines(&golden),
            "Root description should match golden output"
        );
    }

    #[test]
    fn test_valid_enrichment_test_fixture() {
        let content = fs::read_to_string(format!("{}/valid/enrichment-test.md", FIXTURES_DIR))
            .expect("Failed to read enrichment-test.md fixture");

        let plan = parse_tugplan(&content).expect("Failed to parse enrichment-test plan");
        let result = validate_tugplan(&plan);

        // Check no errors
        let errors: Vec<_> = result
            .issues
            .iter()
            .filter(|i| i.severity == Severity::Error)
            .collect();
        assert!(
            errors.is_empty(),
            "Valid enrichment-test plan should have no errors, got: {:?}",
            errors
        );

        // Verify structure was parsed correctly
        assert_eq!(
            plan.metadata.owner.as_deref(),
            Some("Test Owner"),
            "Should have correct owner"
        );
        assert!(!plan.decisions.is_empty(), "Should have decisions");
        assert!(!plan.steps.is_empty(), "Should have steps");

        // Verify step 0 has all expected sections
        let step = plan.steps.first().expect("Should have step 0");
        assert!(!step.tasks.is_empty(), "Step should have tasks");
        assert!(!step.artifacts.is_empty(), "Step should have artifacts");
        assert!(!step.tests.is_empty(), "Step should have tests");
        assert!(!step.checkpoints.is_empty(), "Step should have checkpoints");
    }
}

// Full workflow integration test
#[test]
fn test_full_validation_workflow() {
    // Test the complete workflow: parse -> validate -> check results for all fixtures
    let valid_fixtures = [
        "minimal",
        "complete",
        "with-substeps",
        "agent-output-example",
        "enrichment-test",
    ];
    let invalid_fixtures = [
        "missing-metadata",
        "circular-deps",
        "invalid-anchors",
        "duplicate-anchors",
        "missing-references",
        "bad-anchors",
    ];

    // All valid fixtures should pass validation (no errors)
    for name in valid_fixtures {
        let path = format!("{}/valid/{}.md", FIXTURES_DIR, name);
        if let Ok(content) = fs::read_to_string(&path) {
            let plan =
                parse_tugplan(&content).unwrap_or_else(|_| panic!("Failed to parse {}", name));
            let result = validate_tugplan(&plan);

            let errors: Vec<_> = result
                .issues
                .iter()
                .filter(|i| i.severity == Severity::Error)
                .collect();

            assert!(
                errors.is_empty(),
                "Valid fixture {} should have no errors, got: {:?}",
                name,
                errors
            );
        }
    }

    // All invalid fixtures should fail validation (have errors)
    for name in invalid_fixtures {
        let path = format!("{}/invalid/{}.md", FIXTURES_DIR, name);
        if let Ok(content) = fs::read_to_string(&path) {
            let plan =
                parse_tugplan(&content).unwrap_or_else(|_| panic!("Failed to parse {}", name));
            let result = validate_tugplan(&plan);

            assert!(
                !result.valid || result.issues.iter().any(|i| i.severity == Severity::Error),
                "Invalid fixture {} should have errors or be marked invalid",
                name
            );
        }
    }
}
