//! Smoke test for Python test infrastructure.
//!
//! This test verifies that the Python + pytest setup works.
//! It should pass in CI and on any dev machine with Python 3.10+ and pytest.

mod support;

#[test]
fn pytest_available_in_ci() {
    // In CI, pytest MUST be available (we install it in ci.yml)
    // Locally, this test will skip gracefully if pytest is missing
    if std::env::var("CI").is_ok() {
        let python = support::python::find_python()
            .expect("Python 3.10+ must be available in CI");
        assert!(
            support::python::pytest_available(&python),
            "pytest must be available in CI (pip install pytest)"
        );
    } else {
        // Local: just report status
        match support::python::pytest_ready() {
            Some(python) => eprintln!("Python test env ready: {}", python),
            None => eprintln!("SKIPPED: pytest not available locally"),
        }
    }
}

#[test]
fn can_run_pytest_on_simple_test() {
    let python = skip_if_no_pytest!();

    // Create a minimal test in a temp directory
    let temp = tempfile::TempDir::new().unwrap();
    let test_file = temp.path().join("test_smoke.py");
    std::fs::write(&test_file, "def test_passes(): assert True\n").unwrap();

    let result = support::python::run_pytest(&python, temp.path(), &["-v"]);

    assert!(
        result.success,
        "pytest should pass on trivial test: {}",
        result.stderr
    );
    assert!(
        result.stdout.contains("1 passed"),
        "Should report 1 passed test"
    );
}
