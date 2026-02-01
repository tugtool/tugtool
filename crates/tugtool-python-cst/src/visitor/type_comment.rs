// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Type comment parsing and collection infrastructure.
//!
//! Type comments (`# type: Foo`) are legacy PEP 484-style annotations used in
//! Python 2/3 compatible code. This module provides parsing and collection
//! infrastructure to support renaming type references in comments.
//!
//! # Supported Patterns
//!
//! - Variable annotations: `x = value  # type: Foo`
//! - Tuple unpacking: `x, y = value  # type: int, str`
//! - Function signatures: `def foo(x):  # type: (int) -> str`
//! - Type ignore: `x = value  # type: ignore`
//! - Type ignore with code: `x = value  # type: ignore[attr-defined]`
//!
//! # Example
//!
//! ```ignore
//! use tugtool_python_cst::visitor::{TypeCommentParser, ParsedTypeComment};
//!
//! // Parse a type comment
//! let parsed = TypeCommentParser::parse("# type: List[Handler]")?;
//! assert_eq!(parsed.refs.len(), 2);
//! assert_eq!(parsed.refs[0].name, "List");
//! assert_eq!(parsed.refs[1].name, "Handler");
//!
//! // Rename a type within a comment
//! let result = TypeCommentParser::rename(
//!     "# type: Handler",
//!     "Handler",
//!     "RequestHandler"
//! )?;
//! assert_eq!(result, "# type: RequestHandler");
//! ```

use tugtool_core::patch::Span;

/// The kind of type comment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TypeCommentKind {
    /// A variable type annotation: `# type: T` or `# type: T, U` for tuple unpacking.
    Variable,
    /// A function signature annotation: `# type: (...) -> T`
    FunctionSignature,
    /// A type ignore directive: `# type: ignore` or `# type: ignore[code]`
    Ignore,
}

/// A type comment extracted from source code.
#[derive(Debug, Clone)]
pub struct TypeComment {
    /// The kind of type comment.
    pub kind: TypeCommentKind,
    /// The content after `# type:` (trimmed).
    pub content: String,
    /// The span of the entire comment in the source.
    pub span: Span,
    /// The line number (0-based) where this comment appears.
    pub line: usize,
}

/// A reference to a type name within a type comment.
///
/// Similar to `AnnotationRef` in StringAnnotationParser.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeNameRef {
    /// The name referenced (e.g., "Handler", "List").
    pub name: String,
    /// Position within the comment content (after `# type: ` prefix).
    pub offset_in_content: usize,
    /// Length of the name in bytes.
    pub length: usize,
}

/// A parsed type comment with extracted type references.
#[derive(Debug, Clone)]
pub struct ParsedTypeComment {
    /// The kind of type comment.
    pub kind: TypeCommentKind,
    /// The content after `# type:` (trimmed).
    pub content: String,
    /// All type name references found in the content.
    pub refs: Vec<TypeNameRef>,
}

/// Error type for type comment parsing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeCommentError {
    /// The original comment text.
    pub comment: String,
    /// Description of the error.
    pub message: String,
}

impl std::fmt::Display for TypeCommentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Invalid type comment '{}': {}",
            self.comment, self.message
        )
    }
}

impl std::error::Error for TypeCommentError {}

/// Result type for type comment operations.
pub type TypeCommentResult<T> = Result<T, TypeCommentError>;

/// Internal token type for type comment parsing.
#[derive(Debug, Clone)]
#[allow(dead_code)] // Punct value is used structurally for parsing
enum CommentToken {
    /// An identifier (type name, module name).
    Name { value: String, offset: usize },
    /// A punctuation character.
    Punct(char),
    /// The arrow operator `->`.
    Arrow,
}

/// Parses and transforms type comments.
///
/// Type comments follow the PEP 484 format:
/// - `# type: <type>` for variable annotations
/// - `# type: (<args>) -> <return>` for function signatures
/// - `# type: ignore` or `# type: ignore[code]` for suppression
///
/// # Example
///
/// ```ignore
/// use tugtool_python_cst::visitor::TypeCommentParser;
///
/// // Parse a type comment
/// let parsed = TypeCommentParser::parse("# type: List[Handler]")?;
/// assert_eq!(parsed.refs.len(), 2);
///
/// // Rename a type
/// let result = TypeCommentParser::rename(
///     "# type: Handler",
///     "Handler",
///     "RequestHandler"
/// )?;
/// assert_eq!(result, "# type: RequestHandler");
///
/// // Check if a name appears
/// assert!(TypeCommentParser::contains_name("# type: List[Handler]", "Handler")?);
/// ```
pub struct TypeCommentParser;

impl TypeCommentParser {
    /// Parse a type comment and extract type references.
    ///
    /// # Arguments
    ///
    /// * `comment` - The full comment text (e.g., `# type: List[Handler]`)
    ///
    /// # Returns
    ///
    /// Parsed type comment info, or error if invalid syntax.
    ///
    /// # Example
    ///
    /// ```ignore
    /// let parsed = TypeCommentParser::parse("# type: List[Handler]")?;
    /// assert_eq!(parsed.kind, TypeCommentKind::Variable);
    /// assert_eq!(parsed.content, "List[Handler]");
    /// assert_eq!(parsed.refs.len(), 2);
    /// ```
    pub fn parse(comment: &str) -> TypeCommentResult<ParsedTypeComment> {
        // Verify and extract content after `# type:`
        let content = Self::extract_content(comment)?;

        // Check for type ignore
        if Self::is_ignore(content) {
            return Ok(ParsedTypeComment {
                kind: TypeCommentKind::Ignore,
                content: content.to_string(),
                refs: Vec::new(),
            });
        }

        // Tokenize the content
        let tokens = Self::tokenize(content)?;

        // Determine the kind based on content
        let kind = Self::determine_kind(&tokens);

        // Extract name references
        let refs = Self::extract_refs(&tokens);

        Ok(ParsedTypeComment {
            kind,
            content: content.to_string(),
            refs,
        })
    }

    /// Transform a type comment by renaming a symbol.
    ///
    /// Replaces all occurrences of `old_name` with `new_name` in the comment.
    ///
    /// # Arguments
    ///
    /// * `comment` - Original comment (e.g., `# type: Handler`)
    /// * `old_name` - Name to replace
    /// * `new_name` - Replacement name
    ///
    /// # Returns
    ///
    /// The transformed comment string.
    ///
    /// # Example
    ///
    /// ```ignore
    /// let result = TypeCommentParser::rename(
    ///     "# type: Handler",
    ///     "Handler",
    ///     "RequestHandler"
    /// )?;
    /// assert_eq!(result, "# type: RequestHandler");
    /// ```
    pub fn rename(comment: &str, old_name: &str, new_name: &str) -> TypeCommentResult<String> {
        let parsed = Self::parse(comment)?;

        // Type ignore comments have no refs to rename
        if parsed.kind == TypeCommentKind::Ignore {
            return Ok(comment.to_string());
        }

        // Find all occurrences of old_name and replace
        let mut result = parsed.content.clone();

        // Replace in reverse order to preserve offsets
        let mut replacements: Vec<_> = parsed.refs.iter().filter(|r| r.name == old_name).collect();
        replacements.sort_by(|a, b| b.offset_in_content.cmp(&a.offset_in_content));

        for r in replacements {
            result.replace_range(
                r.offset_in_content..r.offset_in_content + r.length,
                new_name,
            );
        }

        // Reconstruct the full comment
        // Find the content start position in the original comment
        let content_start = comment.find(':').map(|i| i + 1).unwrap_or(0);
        let prefix = &comment[..content_start];

        // Preserve whitespace between `:` and content
        let whitespace_len = comment[content_start..]
            .chars()
            .take_while(|c| c.is_whitespace())
            .count();
        let whitespace = &comment[content_start..content_start + whitespace_len];

        Ok(format!("{}{}{}", prefix, whitespace, result))
    }

    /// Check if a type comment contains a reference to a given name.
    ///
    /// # Arguments
    ///
    /// * `comment` - The full comment text
    /// * `name` - The name to search for
    ///
    /// # Returns
    ///
    /// `true` if the comment contains a reference to the name.
    ///
    /// # Example
    ///
    /// ```ignore
    /// assert!(TypeCommentParser::contains_name("# type: List[Handler]", "Handler")?);
    /// assert!(!TypeCommentParser::contains_name("# type: List[Handler]", "Dict")?);
    /// ```
    pub fn contains_name(comment: &str, name: &str) -> TypeCommentResult<bool> {
        let parsed = Self::parse(comment)?;
        Ok(parsed.refs.iter().any(|r| r.name == name))
    }

    /// Check if a string is a type comment (starts with `#` followed by `type:`).
    pub fn is_type_comment(text: &str) -> bool {
        let trimmed = text.trim();
        if !trimmed.starts_with('#') {
            return false;
        }
        let after_hash = trimmed[1..].trim_start();
        after_hash.starts_with("type:")
    }

    /// Extract the content after the `# type:` prefix (allowing variable whitespace).
    fn extract_content(comment: &str) -> TypeCommentResult<&str> {
        let trimmed = comment.trim();

        // Must start with #
        if !trimmed.starts_with('#') {
            return Err(TypeCommentError {
                comment: comment.to_string(),
                message: "Not a type comment (must start with '#')".to_string(),
            });
        }

        // Find "type:" after the #, allowing whitespace between # and type
        let after_hash = &trimmed[1..];
        let after_hash_trimmed = after_hash.trim_start();

        if !after_hash_trimmed.starts_with("type:") {
            return Err(TypeCommentError {
                comment: comment.to_string(),
                message: "Not a type comment (must contain 'type:' after '#')".to_string(),
            });
        }

        // Extract content after "type:"
        Ok(after_hash_trimmed["type:".len()..].trim())
    }

    /// Check if the content is a type ignore directive.
    fn is_ignore(content: &str) -> bool {
        // Match "ignore" or "ignore[...]"
        content == "ignore" || content.starts_with("ignore[")
    }

    /// Determine the kind of type comment from tokens.
    fn determine_kind(tokens: &[CommentToken]) -> TypeCommentKind {
        // Check for arrow `->` which indicates function signature
        for token in tokens {
            if matches!(token, CommentToken::Arrow) {
                return TypeCommentKind::FunctionSignature;
            }
        }
        TypeCommentKind::Variable
    }

    /// Tokenize type comment content into names and punctuation.
    fn tokenize(content: &str) -> TypeCommentResult<Vec<CommentToken>> {
        let mut tokens = Vec::new();
        let mut chars = content.char_indices().peekable();

        while let Some((i, ch)) = chars.next() {
            match ch {
                // Identifier start
                'a'..='z' | 'A'..='Z' | '_' => {
                    let start = i;
                    while let Some(&(_, c)) = chars.peek() {
                        if c.is_alphanumeric() || c == '_' {
                            chars.next();
                        } else {
                            break;
                        }
                    }
                    let end = chars.peek().map(|(idx, _)| *idx).unwrap_or(content.len());
                    tokens.push(CommentToken::Name {
                        value: content[start..end].to_string(),
                        offset: start,
                    });
                }
                // Arrow operator
                '-' => {
                    if let Some(&(_, '>')) = chars.peek() {
                        chars.next();
                        tokens.push(CommentToken::Arrow);
                    }
                    // else: Just a minus sign - might be in a number or invalid
                    // For type comments, we skip it
                }
                // Operators and delimiters
                '[' | ']' | ',' | '|' | '.' | '(' | ')' => {
                    tokens.push(CommentToken::Punct(ch));
                }
                // Whitespace - skip
                ' ' | '\t' | '\n' | '\r' => continue,
                // Digits (might be in type like Tuple[int, ...])
                '0'..='9' => {
                    // Skip numeric literals
                    while let Some(&(_, c)) = chars.peek() {
                        if c.is_alphanumeric() || c == '_' || c == '.' {
                            chars.next();
                        } else {
                            break;
                        }
                    }
                }
                // Other characters - skip silently for robustness
                // (type comments in the wild can have unusual content)
                _ => continue,
            }
        }

        Ok(tokens)
    }

    /// Extract name references from tokens.
    fn extract_refs(tokens: &[CommentToken]) -> Vec<TypeNameRef> {
        tokens
            .iter()
            .filter_map(|t| {
                if let CommentToken::Name { value, offset } = t {
                    Some(TypeNameRef {
                        name: value.clone(),
                        offset_in_content: *offset,
                        length: value.len(),
                    })
                } else {
                    None
                }
            })
            .collect()
    }
}

/// Collector for type comments in Python source.
///
/// This visitor collects all type comments from Python source code,
/// parsing them and tracking their positions.
#[derive(Debug, Default)]
pub struct TypeCommentCollector {
    /// Collected type comments.
    comments: Vec<TypeComment>,
}

impl TypeCommentCollector {
    /// Create a new collector.
    pub fn new() -> Self {
        Self::default()
    }

    /// Collect type comments from source code.
    ///
    /// This scans the source text for `# type:` comments and parses them.
    /// This is a text-based scan since comments are not part of the CST.
    ///
    /// # Arguments
    ///
    /// * `source` - The Python source code
    ///
    /// # Returns
    ///
    /// A vector of collected type comments.
    pub fn collect(source: &str) -> Vec<TypeComment> {
        let mut collector = Self::new();
        collector.scan_source(source);
        collector.comments
    }

    /// Scan source text for type comments.
    fn scan_source(&mut self, source: &str) {
        for (line_num, line) in source.lines().enumerate() {
            // Find `# type:` in this line
            if let Some(comment_start) = line.find("# type:") {
                let comment_text = &line[comment_start..];

                // Try to parse the type comment
                if let Ok(parsed) = TypeCommentParser::parse(comment_text) {
                    // Calculate the span
                    // Find the byte offset of this line in the source
                    let line_start = source
                        .lines()
                        .take(line_num)
                        .map(|l| l.len() + 1) // +1 for newline
                        .sum::<usize>();
                    let comment_byte_start = line_start + comment_start;
                    let comment_byte_end = comment_byte_start + comment_text.len();

                    self.comments.push(TypeComment {
                        kind: parsed.kind,
                        content: parsed.content,
                        span: Span {
                            start: comment_byte_start,
                            end: comment_byte_end,
                        },
                        line: line_num,
                    });
                }
            }
        }
    }

    /// Get the collected type comments.
    pub fn into_comments(self) -> Vec<TypeComment> {
        self.comments
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // =======================================================================
    // TypeCommentParser::parse tests
    // =======================================================================

    #[test]
    fn test_type_comment_parse_simple() {
        let parsed = TypeCommentParser::parse("# type: Foo").unwrap();
        assert_eq!(parsed.kind, TypeCommentKind::Variable);
        assert_eq!(parsed.content, "Foo");
        assert_eq!(parsed.refs.len(), 1);
        assert_eq!(parsed.refs[0].name, "Foo");
        assert_eq!(parsed.refs[0].offset_in_content, 0);
        assert_eq!(parsed.refs[0].length, 3);
    }

    #[test]
    fn test_type_comment_parse_qualified() {
        let parsed = TypeCommentParser::parse("# type: module.Class").unwrap();
        assert_eq!(parsed.kind, TypeCommentKind::Variable);
        assert_eq!(parsed.content, "module.Class");
        assert_eq!(parsed.refs.len(), 2);
        assert_eq!(parsed.refs[0].name, "module");
        assert_eq!(parsed.refs[1].name, "Class");
    }

    #[test]
    fn test_type_comment_parse_generic() {
        let parsed = TypeCommentParser::parse("# type: List[Foo]").unwrap();
        assert_eq!(parsed.kind, TypeCommentKind::Variable);
        assert_eq!(parsed.content, "List[Foo]");
        assert_eq!(parsed.refs.len(), 2);
        assert_eq!(parsed.refs[0].name, "List");
        assert_eq!(parsed.refs[1].name, "Foo");
    }

    #[test]
    fn test_type_comment_parse_union() {
        let parsed = TypeCommentParser::parse("# type: Union[A, B]").unwrap();
        assert_eq!(parsed.kind, TypeCommentKind::Variable);
        assert_eq!(parsed.refs.len(), 3);
        assert_eq!(parsed.refs[0].name, "Union");
        assert_eq!(parsed.refs[1].name, "A");
        assert_eq!(parsed.refs[2].name, "B");
    }

    #[test]
    fn test_type_comment_parse_pipe_union() {
        let parsed = TypeCommentParser::parse("# type: A | B").unwrap();
        assert_eq!(parsed.kind, TypeCommentKind::Variable);
        assert_eq!(parsed.refs.len(), 2);
        assert_eq!(parsed.refs[0].name, "A");
        assert_eq!(parsed.refs[1].name, "B");
    }

    #[test]
    fn test_type_comment_parse_function_sig() {
        let parsed = TypeCommentParser::parse("# type: (int) -> str").unwrap();
        assert_eq!(parsed.kind, TypeCommentKind::FunctionSignature);
        assert_eq!(parsed.content, "(int) -> str");
        assert_eq!(parsed.refs.len(), 2);
        assert_eq!(parsed.refs[0].name, "int");
        assert_eq!(parsed.refs[1].name, "str");
    }

    #[test]
    fn test_type_comment_parse_ignore() {
        let parsed = TypeCommentParser::parse("# type: ignore").unwrap();
        assert_eq!(parsed.kind, TypeCommentKind::Ignore);
        assert_eq!(parsed.content, "ignore");
        assert!(parsed.refs.is_empty());
    }

    #[test]
    fn test_type_comment_parse_ignore_code() {
        let parsed = TypeCommentParser::parse("# type: ignore[attr-defined]").unwrap();
        assert_eq!(parsed.kind, TypeCommentKind::Ignore);
        assert_eq!(parsed.content, "ignore[attr-defined]");
        assert!(parsed.refs.is_empty());
    }

    #[test]
    fn test_type_comment_parse_complex_generic() {
        let parsed = TypeCommentParser::parse("# type: Dict[str, List[int]]").unwrap();
        assert_eq!(parsed.kind, TypeCommentKind::Variable);
        assert_eq!(parsed.refs.len(), 4);
        assert_eq!(parsed.refs[0].name, "Dict");
        assert_eq!(parsed.refs[1].name, "str");
        assert_eq!(parsed.refs[2].name, "List");
        assert_eq!(parsed.refs[3].name, "int");
    }

    #[test]
    fn test_type_comment_parse_tuple_unpack() {
        let parsed = TypeCommentParser::parse("# type: int, str").unwrap();
        assert_eq!(parsed.kind, TypeCommentKind::Variable);
        assert_eq!(parsed.refs.len(), 2);
        assert_eq!(parsed.refs[0].name, "int");
        assert_eq!(parsed.refs[1].name, "str");
    }

    #[test]
    fn test_type_comment_parse_optional() {
        let parsed = TypeCommentParser::parse("# type: Optional[Handler]").unwrap();
        assert_eq!(parsed.kind, TypeCommentKind::Variable);
        assert_eq!(parsed.refs.len(), 2);
        assert_eq!(parsed.refs[0].name, "Optional");
        assert_eq!(parsed.refs[1].name, "Handler");
    }

    #[test]
    fn test_type_comment_parse_callable() {
        let parsed = TypeCommentParser::parse("# type: Callable[[int, str], bool]").unwrap();
        assert_eq!(parsed.kind, TypeCommentKind::Variable);
        assert_eq!(parsed.refs.len(), 4);
        assert_eq!(parsed.refs[0].name, "Callable");
        assert_eq!(parsed.refs[1].name, "int");
        assert_eq!(parsed.refs[2].name, "str");
        assert_eq!(parsed.refs[3].name, "bool");
    }

    #[test]
    fn test_type_comment_parse_not_type_comment() {
        let result = TypeCommentParser::parse("# just a regular comment");
        assert!(result.is_err());
    }

    #[test]
    fn test_type_comment_parse_with_extra_spaces() {
        let parsed = TypeCommentParser::parse("#  type:   Foo  ").unwrap();
        assert_eq!(parsed.kind, TypeCommentKind::Variable);
        assert_eq!(parsed.content, "Foo");
        assert_eq!(parsed.refs.len(), 1);
        assert_eq!(parsed.refs[0].name, "Foo");
    }

    // =======================================================================
    // TypeCommentParser::rename tests
    // =======================================================================

    #[test]
    fn test_type_comment_rename_simple() {
        let result =
            TypeCommentParser::rename("# type: Handler", "Handler", "RequestHandler").unwrap();
        assert_eq!(result, "# type: RequestHandler");
    }

    #[test]
    fn test_type_comment_rename_generic() {
        let result =
            TypeCommentParser::rename("# type: List[Handler]", "Handler", "RequestHandler")
                .unwrap();
        assert_eq!(result, "# type: List[RequestHandler]");
    }

    #[test]
    fn test_type_comment_rename_multiple() {
        let result = TypeCommentParser::rename(
            "# type: Dict[Handler, Handler]",
            "Handler",
            "RequestHandler",
        )
        .unwrap();
        assert_eq!(result, "# type: Dict[RequestHandler, RequestHandler]");
    }

    #[test]
    fn test_type_comment_rename_qualified() {
        let result =
            TypeCommentParser::rename("# type: module.Handler", "Handler", "RequestHandler")
                .unwrap();
        assert_eq!(result, "# type: module.RequestHandler");
    }

    #[test]
    fn test_type_comment_rename_function_sig() {
        let result =
            TypeCommentParser::rename("# type: (Handler) -> Handler", "Handler", "RequestHandler")
                .unwrap();
        assert_eq!(result, "# type: (RequestHandler) -> RequestHandler");
    }

    #[test]
    fn test_type_comment_rename_ignore_unchanged() {
        let result =
            TypeCommentParser::rename("# type: ignore", "Handler", "RequestHandler").unwrap();
        assert_eq!(result, "# type: ignore");
    }

    #[test]
    fn test_type_comment_rename_not_found() {
        let result =
            TypeCommentParser::rename("# type: List[int]", "Handler", "RequestHandler").unwrap();
        assert_eq!(result, "# type: List[int]");
    }

    #[test]
    fn test_type_comment_rename_preserves_spacing() {
        let result =
            TypeCommentParser::rename("#type:Handler", "Handler", "RequestHandler").unwrap();
        assert_eq!(result, "#type:RequestHandler");
    }

    // =======================================================================
    // TypeCommentParser::contains_name tests
    // =======================================================================

    #[test]
    fn test_type_comment_contains_name_true() {
        assert!(TypeCommentParser::contains_name("# type: List[Handler]", "Handler").unwrap());
        assert!(TypeCommentParser::contains_name("# type: List[Handler]", "List").unwrap());
    }

    #[test]
    fn test_type_comment_contains_name_false() {
        assert!(!TypeCommentParser::contains_name("# type: List[Handler]", "Dict").unwrap());
        assert!(!TypeCommentParser::contains_name("# type: Handler", "RequestHandler").unwrap());
    }

    #[test]
    fn test_type_comment_contains_name_ignore() {
        assert!(!TypeCommentParser::contains_name("# type: ignore", "ignore").unwrap());
    }

    // =======================================================================
    // TypeCommentParser::is_type_comment tests
    // =======================================================================

    #[test]
    fn test_is_type_comment_true() {
        assert!(TypeCommentParser::is_type_comment("# type: Foo"));
        assert!(TypeCommentParser::is_type_comment("  # type: Foo  "));
        assert!(TypeCommentParser::is_type_comment("#type:Foo"));
    }

    #[test]
    fn test_is_type_comment_false() {
        assert!(!TypeCommentParser::is_type_comment("# not a type comment"));
        assert!(!TypeCommentParser::is_type_comment("# typing: Foo"));
        assert!(!TypeCommentParser::is_type_comment("x = 1  # type Foo")); // missing colon
    }

    // =======================================================================
    // TypeCommentCollector tests
    // =======================================================================

    #[test]
    fn test_type_comment_collector_basic() {
        let source = r#"
x = 1  # type: int
y = "hello"  # type: str
"#;
        let comments = TypeCommentCollector::collect(source);
        assert_eq!(comments.len(), 2);
        assert_eq!(comments[0].kind, TypeCommentKind::Variable);
        assert_eq!(comments[0].content, "int");
        assert_eq!(comments[0].line, 1);
        assert_eq!(comments[1].kind, TypeCommentKind::Variable);
        assert_eq!(comments[1].content, "str");
        assert_eq!(comments[1].line, 2);
    }

    #[test]
    fn test_type_comment_collector_multiple() {
        let source = r#"
def foo(x):  # type: (int) -> str
    y = x  # type: int
    z = str(y)  # type: str
    return z
"#;
        let comments = TypeCommentCollector::collect(source);
        assert_eq!(comments.len(), 3);
        assert_eq!(comments[0].kind, TypeCommentKind::FunctionSignature);
        assert_eq!(comments[0].line, 1);
        assert_eq!(comments[1].kind, TypeCommentKind::Variable);
        assert_eq!(comments[1].line, 2);
        assert_eq!(comments[2].kind, TypeCommentKind::Variable);
        assert_eq!(comments[2].line, 3);
    }

    #[test]
    fn test_type_comment_collector_with_ignore() {
        let source = r#"
x = foo()  # type: ignore
y = bar()  # type: ignore[attr-defined]
z = baz()  # type: Handler
"#;
        let comments = TypeCommentCollector::collect(source);
        assert_eq!(comments.len(), 3);
        assert_eq!(comments[0].kind, TypeCommentKind::Ignore);
        assert_eq!(comments[1].kind, TypeCommentKind::Ignore);
        assert_eq!(comments[2].kind, TypeCommentKind::Variable);
    }

    #[test]
    fn test_type_comment_collector_empty() {
        let source = r#"
x = 1
y = 2
# just a regular comment
"#;
        let comments = TypeCommentCollector::collect(source);
        assert!(comments.is_empty());
    }

    #[test]
    fn test_type_comment_collector_span_calculation() {
        let source = "x = 1  # type: int\n";
        let comments = TypeCommentCollector::collect(source);
        assert_eq!(comments.len(), 1);
        let comment = &comments[0];
        // "# type: int" starts at position 7
        assert_eq!(comment.span.start, 7);
        assert_eq!(comment.span.end, 18); // "# type: int".len() = 11, 7 + 11 = 18
    }

    #[test]
    fn test_type_comment_collector_generic_types() {
        let source = r#"
handlers = []  # type: List[Handler]
mapping = {}  # type: Dict[str, Handler]
"#;
        let comments = TypeCommentCollector::collect(source);
        assert_eq!(comments.len(), 2);
        assert_eq!(comments[0].content, "List[Handler]");
        assert_eq!(comments[1].content, "Dict[str, Handler]");
    }
}
