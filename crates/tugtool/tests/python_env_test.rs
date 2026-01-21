//! Tests for Python test infrastructure.
//!
//! These tests verify that the Python + pytest environment works.
//! They will FAIL if Python/pytest is not available - install uv to fix.

mod support;

#[test]
fn python_env_is_available() {
    // This test verifies we can get a Python environment.
    // If uv is not installed, this will panic with instructions.
    let python_env = support::python::get_python_env();
    eprintln!("Python environment: {}", python_env.python_path.display());
    if let Some(venv) = &python_env.venv_path {
        eprintln!("  venv: {}", venv.display());
    }
}

#[test]
fn can_run_pytest_on_simple_test() {
    let python_env = support::python::get_python_env();

    // Create a minimal test in a temp directory
    let temp = tempfile::TempDir::new().unwrap();
    let test_file = temp.path().join("test_smoke.py");
    std::fs::write(&test_file, "def test_passes(): assert True\n").unwrap();

    let result = support::python::run_pytest(python_env, temp.path(), &["-v"]);

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

#[test]
fn python_env_is_cached() {
    // Verify that get_python_env() returns the same cached result
    let env1 = support::python::get_python_env();
    let env2 = support::python::get_python_env();

    assert_eq!(
        env1.python_path, env2.python_path,
        "Python env should be cached and reused"
    );
}
