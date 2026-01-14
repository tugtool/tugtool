//! Python language validation utilities.
//!
//! Provides validation functions for Python identifiers and names.

use thiserror::Error;

/// Error for validation failures.
#[derive(Debug, Error)]
pub enum ValidationError {
    /// Invalid Python identifier name.
    #[error("invalid name '{name}': {reason}")]
    InvalidName { name: String, reason: String },
}

/// Result type for validation operations.
pub type ValidationResult<T> = Result<T, ValidationError>;

/// Python keywords that cannot be used as identifiers.
pub const PYTHON_KEYWORDS: &[&str] = &[
    "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue",
    "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import",
    "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while",
    "with", "yield",
];

/// Check if a name is a Python keyword.
pub fn is_python_keyword(name: &str) -> bool {
    PYTHON_KEYWORDS.contains(&name)
}

/// Validate that a string is a valid Python identifier.
///
/// Checks:
/// - Non-empty
/// - Starts with letter or underscore
/// - Contains only alphanumeric and underscore
/// - Not a Python keyword
///
/// # Examples
///
/// ```
/// use tugtool::python::validation::validate_python_identifier;
///
/// assert!(validate_python_identifier("foo").is_ok());
/// assert!(validate_python_identifier("_private").is_ok());
/// assert!(validate_python_identifier("CamelCase").is_ok());
/// assert!(validate_python_identifier("").is_err());
/// assert!(validate_python_identifier("123foo").is_err());
/// assert!(validate_python_identifier("class").is_err());
/// ```
pub fn validate_python_identifier(name: &str) -> ValidationResult<()> {
    if name.is_empty() {
        return Err(ValidationError::InvalidName {
            name: name.to_string(),
            reason: "name cannot be empty".to_string(),
        });
    }

    // First character must be letter or underscore
    let first = name.chars().next().unwrap();
    if !first.is_alphabetic() && first != '_' {
        return Err(ValidationError::InvalidName {
            name: name.to_string(),
            reason: "must start with letter or underscore".to_string(),
        });
    }

    // Rest must be alphanumeric or underscore
    for ch in name.chars().skip(1) {
        if !ch.is_alphanumeric() && ch != '_' {
            return Err(ValidationError::InvalidName {
                name: name.to_string(),
                reason: format!("invalid character: '{}'", ch),
            });
        }
    }

    // Check for Python keywords
    if is_python_keyword(name) {
        return Err(ValidationError::InvalidName {
            name: name.to_string(),
            reason: "cannot use Python keyword as identifier".to_string(),
        });
    }

    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    mod valid_identifiers {
        use super::*;

        #[test]
        fn simple_names() {
            assert!(validate_python_identifier("foo").is_ok());
            assert!(validate_python_identifier("bar").is_ok());
            assert!(validate_python_identifier("x").is_ok());
        }

        #[test]
        fn underscore_names() {
            assert!(validate_python_identifier("_private").is_ok());
            assert!(validate_python_identifier("_").is_ok());
            assert!(validate_python_identifier("__dunder__").is_ok());
            assert!(validate_python_identifier("__private").is_ok());
        }

        #[test]
        fn case_variations() {
            assert!(validate_python_identifier("CamelCase").is_ok());
            assert!(validate_python_identifier("snake_case").is_ok());
            assert!(validate_python_identifier("SCREAMING_SNAKE").is_ok());
        }

        #[test]
        fn with_numbers() {
            assert!(validate_python_identifier("foo123").is_ok());
            assert!(validate_python_identifier("x1").is_ok());
            assert!(validate_python_identifier("_2").is_ok());
        }
    }

    mod invalid_identifiers {
        use super::*;

        #[test]
        fn empty_name() {
            let err = validate_python_identifier("").unwrap_err();
            assert!(matches!(err, ValidationError::InvalidName { .. }));
        }

        #[test]
        fn starts_with_number() {
            assert!(validate_python_identifier("123foo").is_err());
            assert!(validate_python_identifier("1").is_err());
        }

        #[test]
        fn invalid_characters() {
            assert!(validate_python_identifier("foo-bar").is_err());
            assert!(validate_python_identifier("foo bar").is_err());
            assert!(validate_python_identifier("foo.bar").is_err());
            assert!(validate_python_identifier("foo@bar").is_err());
        }
    }

    mod keywords {
        use super::*;

        #[test]
        fn keywords_rejected() {
            assert!(validate_python_identifier("class").is_err());
            assert!(validate_python_identifier("def").is_err());
            assert!(validate_python_identifier("if").is_err());
            assert!(validate_python_identifier("return").is_err());
            assert!(validate_python_identifier("None").is_err());
            assert!(validate_python_identifier("True").is_err());
            assert!(validate_python_identifier("False").is_err());
        }

        #[test]
        fn is_python_keyword_function() {
            assert!(is_python_keyword("class"));
            assert!(is_python_keyword("None"));
            assert!(!is_python_keyword("foo"));
            assert!(!is_python_keyword("Class")); // Case sensitive
        }
    }
}
