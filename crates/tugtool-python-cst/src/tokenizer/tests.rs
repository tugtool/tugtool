// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

/// Tests for the functionality in `tokenize::core`. These tests are not part of the `core` module
/// because they're not a derivative work of CPython, and are therefore not subject to the PSF
/// license.
use crate::tokenizer::core::{TokConfig, TokError, TokState, TokType};

fn default_config() -> TokConfig {
    TokConfig {
        async_hacks: false,
        split_ftstring: false,
    }
}

fn tokenize_with_end_marker<'t>(
    text: &'t str,
    config: &TokConfig,
) -> Result<Vec<(TokType, &'t str)>, TokError<'t>> {
    let mut result = Vec::new();
    let mut state = TokState::new(text, config);
    while let Some(tok_type) = state.next() {
        result.push((
            tok_type?,
            state.text_pos.slice_from_start_pos(&state.start_pos),
        ));
    }
    Ok(result)
}

fn tokenize_all<'t>(
    text: &'t str,
    config: &TokConfig,
) -> Result<Vec<(TokType, &'t str)>, TokError<'t>> {
    let mut result = tokenize_with_end_marker(text, config)?;
    // Remove the EndMarker, since it's on every non-error token stream.
    assert_eq!(result.pop().expect("EndMarker").0, TokType::EndMarker);
    // Also remove fake newline at the end
    if let Some((TokType::Newline, "")) = result.last() {
        result.pop();
    }
    Ok(result)
}

#[test]
fn test_indentifier() {
    assert_eq!(
        tokenize_all("test input", &default_config()),
        Ok(vec![(TokType::Name, "test"), (TokType::Name, "input")])
    );

    assert_eq!(
        tokenize_all("__with_underscores", &default_config()),
        Ok(vec![(TokType::Name, "__with_underscores")])
    );

    assert_eq!(
        tokenize_all("{ends_with_op}", &default_config()),
        Ok(vec![
            (TokType::Op, "{"),
            (TokType::Name, "ends_with_op"),
            (TokType::Op, "}")
        ])
    );

    assert_eq!(
        tokenize_all("\u{0100}\u{0101}\u{0102}unicode", &default_config()),
        Ok(vec![(TokType::Name, "\u{0100}\u{0101}\u{0102}unicode")])
    );
}

#[test]
fn test_async_await() {
    // normally async/await are keywords
    assert_eq!(
        tokenize_all("async await", &default_config()),
        Ok(vec![(TokType::Async, "async"), (TokType::Await, "await")])
    );

    // with async_hacks, async/await are handled as identifiers by default
    assert_eq!(
        tokenize_all(
            "async await",
            &TokConfig {
                async_hacks: true,
                ..default_config()
            }
        ),
        Ok(vec![(TokType::Name, "async"), (TokType::Name, "await")])
    );

    // with async_hacks, async/await are handled as keywords in functions
    assert_eq!(
        tokenize_all(
            "async def fn():\n  await foo\nawait bar",
            &TokConfig {
                async_hacks: true,
                ..default_config()
            }
        ),
        Ok(vec![
            // this async is followed by a def, so it's converted to an Async
            (TokType::Async, "async"),
            (TokType::Name, "def"),
            (TokType::Name, "fn"),
            (TokType::Op, "("),
            (TokType::Op, ")"),
            (TokType::Op, ":"),
            (TokType::Newline, "\n"),
            (TokType::Indent, ""),
            // this await is inside a function, and is converted into an Await
            (TokType::Await, "await"),
            (TokType::Name, "foo"),
            (TokType::Newline, "\n"),
            (TokType::Dedent, ""),
            // this await is outside the function, and is turned into an identifier
            (TokType::Name, "await"),
            (TokType::Name, "bar")
        ])
    );
}

#[test]
fn test_blankline() {
    assert_eq!(
        tokenize_all("\n    \n\t\n\x0c\n\n", &default_config()),
        Ok(vec![])
    );
}

#[test]
fn test_newline() {
    assert_eq!(
        tokenize_all("a\nb\rc\r\n", &default_config()),
        Ok(vec![
            (TokType::Name, "a"),
            (TokType::Newline, "\n"),
            (TokType::Name, "b"),
            (TokType::Newline, "\r"),
            (TokType::Name, "c"),
            (TokType::Newline, "\r\n")
        ])
    );
}

#[test]
fn test_indent_dedent() {
    assert_eq!(
        tokenize_all("one\n  two\n  sameindent\n", &default_config()),
        Ok(vec![
            (TokType::Name, "one"),
            (TokType::Newline, "\n"),
            (TokType::Indent, ""),
            (TokType::Name, "two"),
            (TokType::Newline, "\n"),
            (TokType::Name, "sameindent"),
            (TokType::Newline, "\n"),
            (TokType::Dedent, "")
        ])
    );

    assert_eq!(
        tokenize_all("one\n  two\n  \tthree\n", &default_config()),
        Ok(vec![
            (TokType::Name, "one"),
            (TokType::Newline, "\n"),
            (TokType::Indent, ""),
            (TokType::Name, "two"),
            (TokType::Newline, "\n"),
            (TokType::Indent, ""),
            (TokType::Name, "three"),
            (TokType::Newline, "\n"),
            (TokType::Dedent, ""),
            (TokType::Dedent, "")
        ])
    );

    // indentation decreases to a new (smaller) indentation level that wasn't on the stack
    assert_eq!(
        tokenize_all("    one\n  two", &default_config()),
        Err(TokError::Dedent),
    );

    // TabSpace error without change in indentation
    assert_eq!(
        tokenize_all("        one\n\ttwo\n", &default_config()),
        Err(TokError::TabSpace),
    );

    // TabSpace error with increase in indentation
    assert_eq!(
        tokenize_all("        one\n\t\ttwo\n", &default_config()),
        Err(TokError::TabSpace),
    );

    // TabSpace error with decrease in indentation
    assert_eq!(
        tokenize_all("        one\n        \ttwo\n\tthree\n", &default_config()),
        Err(TokError::TabSpace),
    );

    // this looks like a TabSpace error, but CPython allows it, so we should too
    assert!(tokenize_all("        \tone\n\t        two\n", &default_config()).is_ok());
}

#[test]
fn test_integer_decimal() {
    assert_eq!(
        tokenize_all("123456789", &default_config()),
        Ok(vec![(TokType::Number, "123456789")])
    );

    assert_eq!(
        tokenize_all("1_2_3", &default_config()),
        Ok(vec![(TokType::Number, "1_2_3")])
    );

    // doesn't consume trailing underscores
    assert_eq!(
        tokenize_all("123_", &default_config()),
        Err(TokError::BadDecimal),
    );
}

#[test]
fn test_integer_leading_zeros() {
    assert_eq!(
        tokenize_all("000", &default_config()),
        Ok(vec![(TokType::Number, "000")])
    );

    assert_eq!(
        tokenize_all("0_0_0", &default_config()),
        Ok(vec![(TokType::Number, "0_0_0")])
    );

    assert_eq!(
        tokenize_all("00123", &default_config()),
        Err(TokError::BadDecimalLeadingZeros)
    );
}

#[test]
fn test_integer_hexadecimal() {
    assert_eq!(
        tokenize_all("0x00Aa12Ff", &default_config()),
        Ok(vec![(TokType::Number, "0x00Aa12Ff")]),
    );

    assert_eq!(
        tokenize_all("0x_1_2_3", &default_config()),
        Ok(vec![(TokType::Number, "0x_1_2_3")]),
    );

    assert_eq!(
        tokenize_all("0x123_", &default_config()),
        Err(TokError::BadHexadecimal),
    );
}

#[test]
fn test_integer_octal() {
    assert_eq!(
        tokenize_all("0o001234567", &default_config()),
        Ok(vec![(TokType::Number, "0o001234567")]),
    );

    assert_eq!(
        tokenize_all("0o_1_2_3", &default_config()),
        Ok(vec![(TokType::Number, "0o_1_2_3")]),
    );

    assert_eq!(
        tokenize_all("0o123_", &default_config()),
        Err(TokError::BadOctal),
    );

    assert_eq!(
        tokenize_all("0o789", &default_config()),
        Err(TokError::BadOctalDigit('8')),
    );
}

#[test]
fn test_integer_binary() {
    assert_eq!(
        tokenize_all("0b00101011", &default_config()),
        Ok(vec![(TokType::Number, "0b00101011")]),
    );

    assert_eq!(
        tokenize_all("0b_0_1_0_1", &default_config()),
        Ok(vec![(TokType::Number, "0b_0_1_0_1")]),
    );

    assert_eq!(
        tokenize_all("0b0101_", &default_config()),
        Err(TokError::BadBinary),
    );

    assert_eq!(
        tokenize_all("0b0123", &default_config()),
        Err(TokError::BadBinaryDigit('2')),
    );
}

#[test]
fn test_fraction() {
    // fraction starting with a dot
    assert_eq!(
        tokenize_all(".5", &default_config()),
        Ok(vec![(TokType::Number, ".5")])
    );

    // fraction starting with a dot using E
    assert_eq!(
        tokenize_all(".5e9", &default_config()),
        Ok(vec![(TokType::Number, ".5e9")])
    );

    // fraction starting with a dot using J
    assert_eq!(
        tokenize_all(".5j", &default_config()),
        Ok(vec![(TokType::Number, ".5j")])
    );

    // fraction starting with a zero
    assert_eq!(
        tokenize_all("0.5", &default_config()),
        Ok(vec![(TokType::Number, "0.5")])
    );

    // fraction starting with a zero using E
    assert_eq!(
        tokenize_all("0.5e9", &default_config()),
        Ok(vec![(TokType::Number, "0.5e9")])
    );

    // fraction starting with a zero using J
    assert_eq!(
        tokenize_all("0.5j", &default_config()),
        Ok(vec![(TokType::Number, "0.5j")])
    );

    // fraction with underscores
    assert_eq!(
        tokenize_all("1_0.2_5", &default_config()),
        Ok(vec![(TokType::Number, "1_0.2_5")])
    );

    // underscores after the fraction are an error
    assert_eq!(
        tokenize_all(".5_", &default_config()),
        Err(TokError::BadDecimal),
    );

    // doesn't consume underscores around the dot
    assert_eq!(
        tokenize_all("1_.25", &default_config()),
        Err(TokError::BadDecimal),
    );

    // doesn't consume underscores around the dot
    assert_eq!(
        tokenize_all("1._25", &default_config()),
        Ok(vec![(TokType::Number, "1."), (TokType::Name, "_25")])
    );
}

#[test]
fn test_string() {
    // empty, single quote
    assert_eq!(
        tokenize_all("''", &default_config()),
        Ok(vec![(TokType::String, "''")]),
    );

    // empty, double quote
    assert_eq!(
        tokenize_all(r#""""#, &default_config()),
        Ok(vec![(TokType::String, r#""""#)]),
    );

    // simple string
    assert_eq!(
        tokenize_all("'test'", &default_config()),
        Ok(vec![(TokType::String, "'test'")]),
    );

    // mixed quotes
    assert_eq!(
        tokenize_all(r#""test'"#, &default_config()),
        Err(TokError::UnterminatedString),
    );

    // single quoted strings can contain double quotes, double quoted strings can contain single
    // quotes
    assert_eq!(
        tokenize_all(
            r#"'she said "hey"' "but he'd ignored her""#,
            &default_config()
        ),
        Ok(vec![
            (TokType::String, r#"'she said "hey"'"#),
            (TokType::String, r#""but he'd ignored her""#)
        ]),
    );

    // escape characters
    assert_eq!(
        tokenize_all("'a\\b\\c\\d\\e\\'\\f\\g'", &default_config()),
        Ok(vec![(TokType::String, "'a\\b\\c\\d\\e\\'\\f\\g'"),]),
    );

    // newline in the middle of a string causes an unterminated string
    assert_eq!(
        tokenize_all("'first\nsecond'", &default_config()),
        Err(TokError::UnterminatedString),
    );

    // newlines can be escaped and are preserved in the output
    assert_eq!(
        tokenize_all("'first\\\nsecond\\\r\nthird\\\r'", &default_config()),
        Ok(vec![(TokType::String, "'first\\\nsecond\\\r\nthird\\\r'"),]),
    );
}

#[test]
fn test_string_triple_quoted() {
    // empty, single quote
    assert_eq!(
        tokenize_all("''''''", &default_config()),
        Ok(vec![(TokType::String, "''''''")]),
    );

    // empty, double quote
    assert_eq!(
        tokenize_all(r#""""""""#, &default_config()),
        Ok(vec![(TokType::String, r#""""""""#)]),
    );

    // simple string with newlines
    assert_eq!(
        tokenize_all("'''\nmulti\rline\r\n'''", &default_config()),
        Ok(vec![(TokType::String, "'''\nmulti\rline\r\n'''")]),
    );

    // unterminated string
    assert_eq!(
        tokenize_all(
            "'''hey'there's''quotes'here, but not '' three'",
            &default_config()
        ),
        Err(TokError::UnterminatedTripleQuotedString),
    );
}

#[test]
fn test_string_prefix() {
    // works with double-quoted string
    assert_eq!(
        tokenize_all(r#"b"""#, &default_config()),
        Ok(vec![(TokType::String, r#"b"""#)]),
    );

    // works with triple-quoted string
    assert_eq!(
        tokenize_all("b'''test'''", &default_config()),
        Ok(vec![(TokType::String, "b'''test'''")]),
    );

    // prefix can be capitalized
    assert_eq!(
        tokenize_all("B'' R'' U'' F''", &default_config()),
        Ok(vec![
            (TokType::String, "B''"),
            (TokType::String, "R''"),
            (TokType::String, "U''"),
            (TokType::String, "F''"),
        ]),
    );

    // valid prefixes
    assert_eq!(
        tokenize_all("b'' r'' u'' f'' br'' fr'' rb'' rf''", &default_config()),
        Ok(vec![
            (TokType::String, "b''"),
            (TokType::String, "r''"),
            (TokType::String, "u''"),
            (TokType::String, "f''"),
            (TokType::String, "br''"),
            (TokType::String, "fr''"),
            (TokType::String, "rb''"),
            (TokType::String, "rf''"),
        ]),
    );

    // invalid prefixes
    assert_eq!(
        tokenize_all("bb'' rr'' uu'' ff'' ur'' ub'' uf'' fb''", &default_config()),
        Ok(vec![
            (TokType::Name, "bb"),
            (TokType::String, "''"),
            (TokType::Name, "rr"),
            (TokType::String, "''"),
            (TokType::Name, "uu"),
            (TokType::String, "''"),
            (TokType::Name, "ff"),
            (TokType::String, "''"),
            (TokType::Name, "ur"),
            (TokType::String, "''"),
            (TokType::Name, "ub"),
            (TokType::String, "''"),
            (TokType::Name, "uf"),
            (TokType::String, "''"),
            (TokType::Name, "fb"),
            (TokType::String, "''"),
        ]),
    );

    // raw string escapes
    assert_eq!(
        tokenize_all("r'\\''", &default_config()),
        Ok(vec![(TokType::String, "r'\\''")]),
    );
    assert_eq!(
        tokenize_all(r#"r"\"""#, &default_config()),
        Ok(vec![(TokType::String, r#"r"\"""#)]),
    );
    assert_eq!(
        tokenize_all(r#"r'\\'"#, &default_config()),
        Ok(vec![(TokType::String, r#"r'\\'"#)]),
    );
    let config = TokConfig {
        split_ftstring: true,
        ..default_config()
    };
    assert_eq!(
        tokenize_all("rf'\\''", &config),
        Ok(vec![
            (TokType::FStringStart, "rf'"),
            (TokType::FStringString, "\\'"),
            (TokType::FStringEnd, "'"),
        ]),
    );
    assert_eq!(
        tokenize_all(r#"rf"\"""#, &config),
        Ok(vec![
            (TokType::FStringStart, "rf\""),
            (TokType::FStringString, r#"\""#),
            (TokType::FStringEnd, "\""),
        ]),
    );
    assert_eq!(
        tokenize_all(r#"rf'\\'"#, &config),
        Ok(vec![
            (TokType::FStringStart, "rf'"),
            (TokType::FStringString, r#"\\"#),
            (TokType::FStringEnd, "'"),
        ]),
    );
}

#[test]
fn test_split_ftstring() {
    let config = TokConfig {
        split_ftstring: true,
        ..default_config()
    };

    assert_eq!(
        tokenize_all("f''", &config),
        Ok(vec![
            (TokType::FStringStart, "f'"),
            (TokType::FStringEnd, "'"),
        ]),
    );

    assert_eq!(
        tokenize_all("f'{value}'", &config),
        Ok(vec![
            (TokType::FStringStart, "f'"),
            (TokType::Op, "{"),
            (TokType::Name, "value"),
            (TokType::Op, "}"),
            (TokType::FStringEnd, "'"),
        ]),
    );

    assert_eq!(
        tokenize_all("f'{{just a string}}'", &config),
        Ok(vec![
            (TokType::FStringStart, "f'"),
            (TokType::FStringString, r"{{just a string}}"),
            (TokType::FStringEnd, "'"),
        ]),
    );

    assert_eq!(
        tokenize_all(r"f'\N{Latin Small Letter A}'", &config),
        Ok(vec![
            (TokType::FStringStart, "f'"),
            (TokType::FStringString, r"\N{Latin Small Letter A}"),
            (TokType::FStringEnd, "'"),
        ]),
    );

    // format specifier
    assert_eq!(
        tokenize_all("f'result: {value:{width}.{precision}}'", &config),
        Ok(vec![
            (TokType::FStringStart, "f'"),
            (TokType::FStringString, "result: "),
            (TokType::Op, "{"),
            (TokType::Name, "value"),
            (TokType::Op, ":"),
            (TokType::Op, "{"),
            (TokType::Name, "width"),
            (TokType::Op, "}"),
            (TokType::FStringString, "."),
            (TokType::Op, "{"),
            (TokType::Name, "precision"),
            (TokType::Op, "}"),
            (TokType::Op, "}"),
            (TokType::FStringEnd, "'"),
        ]),
    );

    // the walrus operator isn't valid unless parenthesized
    assert_eq!(
        tokenize_all("f'{a := b}'", &config),
        Ok(vec![
            (TokType::FStringStart, "f'"),
            (TokType::Op, "{"),
            (TokType::Name, "a"),
            (TokType::Op, ":"),
            (TokType::FStringString, "= b"),
            (TokType::Op, "}"),
            (TokType::FStringEnd, "'"),
        ]),
    );

    // once parenthesized, this is recognized as the walrus operator
    assert_eq!(
        tokenize_all("f'{(a := b)}'", &config),
        Ok(vec![
            (TokType::FStringStart, "f'"),
            (TokType::Op, "{"),
            (TokType::Op, "("),
            (TokType::Name, "a"),
            (TokType::Op, ":="),
            (TokType::Name, "b"),
            (TokType::Op, ")"),
            (TokType::Op, "}"),
            (TokType::FStringEnd, "'"),
        ]),
    );
}

#[test]
fn test_fstring_escapes() {
    let config = TokConfig {
        split_ftstring: true,
        ..default_config()
    };
    assert_eq!(
        tokenize_all("f'\\{{\\}}'", &config),
        Ok(vec![
            (TokType::FStringStart, "f'"),
            (TokType::FStringString, "\\{{\\}}"),
            (TokType::FStringEnd, "'"),
        ])
    );
    assert_eq!(
        tokenize_all(r#"f"regexp_like(path, '.*\{file_type}$')""#, &config),
        Ok(vec![
            (TokType::FStringStart, "f\""),
            (TokType::FStringString, "regexp_like(path, '.*\\"),
            (TokType::Op, "{"),
            (TokType::Name, "file_type"),
            (TokType::Op, "}"),
            (TokType::FStringString, "$')"),
            (TokType::FStringEnd, "\""),
        ])
    );
}

#[test]
fn test_operator() {
    assert_eq!(
        tokenize_all("= == * ** **= -> . .. ...", &default_config()),
        Ok(vec![
            (TokType::Op, "="),
            (TokType::Op, "=="),
            (TokType::Op, "*"),
            (TokType::Op, "**"),
            (TokType::Op, "**="),
            (TokType::Op, "->"),
            (TokType::Op, "."),
            (TokType::Op, "."),
            (TokType::Op, "."),
            (TokType::Op, "...")
        ]),
    );
}

#[test]
fn test_fake_newline() {
    assert_eq!(
        tokenize_with_end_marker("foo", &default_config()),
        Ok(vec![
            (TokType::Name, "foo"),
            (TokType::Newline, ""),
            (TokType::EndMarker, "")
        ])
    );
}

#[test]
fn test_fake_newline_when_at_bol() {
    assert_eq!(
        tokenize_with_end_marker("(\n \\\n)", &default_config()),
        Ok(vec![
            (TokType::Op, "("),
            (TokType::Op, ")"),
            (TokType::Newline, ""),
            (TokType::EndMarker, "")
        ])
    )
}

#[test]
fn test_no_fake_newline_for_empty_input() {
    assert_eq!(
        tokenize_with_end_marker("", &default_config()),
        Ok(vec![(TokType::EndMarker, "")])
    );
}

#[test]
fn test_no_fake_newline_for_only_whitespaces() {
    assert_eq!(
        tokenize_with_end_marker("   ", &default_config()),
        Ok(vec![(TokType::EndMarker, "")])
    );
}

#[test]
fn test_add_dedents_after_fake_newline() {
    assert_eq!(
        tokenize_with_end_marker("if 1:\n  if 2:\n    foo", &default_config()),
        Ok(vec![
            (TokType::Name, "if"),
            (TokType::Number, "1"),
            (TokType::Op, ":"),
            (TokType::Newline, "\n"),
            (TokType::Indent, ""),
            (TokType::Name, "if"),
            (TokType::Number, "2"),
            (TokType::Op, ":"),
            (TokType::Newline, "\n"),
            (TokType::Indent, ""),
            (TokType::Name, "foo"),
            (TokType::Newline, ""),
            (TokType::Dedent, ""),
            (TokType::Dedent, ""),
            (TokType::EndMarker, "")
        ])
    );
}

#[test]
fn test_add_dedents_for_dangling_indent() {
    assert_eq!(
        tokenize_with_end_marker("if 1:\n  if 2:\n    ", &default_config()),
        Ok(vec![
            (TokType::Name, "if"),
            (TokType::Number, "1"),
            (TokType::Op, ":"),
            (TokType::Newline, "\n"),
            (TokType::Indent, ""),
            (TokType::Name, "if"),
            (TokType::Number, "2"),
            (TokType::Op, ":"),
            (TokType::Newline, "\n"),
            (TokType::Dedent, ""),
            (TokType::EndMarker, "")
        ])
    );
}

#[test]
fn test_add_dedents_for_dangling_indent_with_comment() {
    assert_eq!(
        tokenize_with_end_marker("if 1:\n  if 2:\n    # foo", &default_config()),
        Ok(vec![
            (TokType::Name, "if"),
            (TokType::Number, "1"),
            (TokType::Op, ":"),
            (TokType::Newline, "\n"),
            (TokType::Indent, ""),
            (TokType::Name, "if"),
            (TokType::Number, "2"),
            (TokType::Op, ":"),
            (TokType::Newline, "\n"),
            (TokType::Dedent, ""),
            (TokType::EndMarker, "")
        ])
    );
}

#[test]
fn test_inconsistent_indentation_at_eof() {
    assert_eq!(
        tokenize_all("if 1:\n  pass\n ", &default_config()),
        Ok(vec![
            (TokType::Name, "if"),
            (TokType::Number, "1"),
            (TokType::Op, ":"),
            (TokType::Newline, "\n"),
            (TokType::Indent, ""),
            (TokType::Name, "pass"),
            (TokType::Newline, "\n"),
            (TokType::Dedent, ""),
        ])
    )
}

#[test]
fn test_nested_f_string_specs() {
    let config = TokConfig {
        split_ftstring: true,
        ..default_config()
    };
    assert_eq!(
        tokenize_all("f'{_:{_:}{_}}'", &config),
        Ok(vec![
            (TokType::FStringStart, "f'"),
            (TokType::Op, "{"),
            (TokType::Name, "_"),
            (TokType::Op, ":"),
            (TokType::Op, "{"),
            (TokType::Name, "_"),
            (TokType::Op, ":"),
            (TokType::Op, "}"),
            (TokType::Op, "{"),
            (TokType::Name, "_"),
            (TokType::Op, "}"),
            (TokType::Op, "}"),
            (TokType::FStringEnd, "'")
        ])
    )
}

#[test]
fn test_nested_f_strings() {
    let config = TokConfig {
        split_ftstring: true,
        ..default_config()
    };
    assert_eq!(
        tokenize_all("f'{f'{2}'}'", &config),
        Ok(vec![
            (TokType::FStringStart, "f'"),
            (TokType::Op, "{"),
            (TokType::FStringStart, "f'"),
            (TokType::Op, "{"),
            (TokType::Number, "2"),
            (TokType::Op, "}"),
            (TokType::FStringEnd, "'"),
            (TokType::Op, "}"),
            (TokType::FStringEnd, "'")
        ])
    )
}
#[test]
fn test_can_tokenize_t_string_basic() {
    let config = TokConfig {
        split_ftstring: true,
        ..default_config()
    };
    assert_eq!(
        tokenize_all("t'Nothing to see here, move along'", &config),
        Ok(vec![
            (TokType::TStringStart, "t'"),
            (TokType::TStringString, "Nothing to see here, move along"),
            (TokType::TStringEnd, "'")
        ])
    )
}
#[test]
fn test_can_tokenize_f_and_t_strings() {
    let config = TokConfig {
        split_ftstring: true,
        ..default_config()
    };
    assert_eq!(
        tokenize_all("t\"TMiddle{f'FMiddle{t'{2}'}'}\"", &config),
        Ok(vec![
            (TokType::TStringStart, "t\""),
            (TokType::TStringString, "TMiddle"),
            (TokType::Op, "{"),
            (TokType::FStringStart, "f'"),
            (TokType::FStringString, "FMiddle"),
            (TokType::Op, "{"),
            (TokType::TStringStart, "t'"),
            (TokType::Op, "{"),
            (TokType::Number, "2"),
            (TokType::Op, "}"),
            (TokType::TStringEnd, "'"),
            (TokType::Op, "}"),
            (TokType::FStringEnd, "'"),
            (TokType::Op, "}"),
            (TokType::TStringEnd, "\"")
        ])
    )
}

/// Phase 4 Audit: Verify that Token has accurate start_pos and end_pos byte positions.
/// This test validates the position data infrastructure that Phase 4 relies on.
#[test]
fn test_token_position_data_availability() {
    use crate::tokenize;

    // Simple input: "x = 1"
    // Byte positions:
    //   'x' at byte 0
    //   ' ' at byte 1
    //   '=' at byte 2
    //   ' ' at byte 3
    //   '1' at byte 4
    let source = "x = 1";
    let tokens = tokenize(source).expect("tokenize should succeed");

    // Find the Name token 'x'
    let x_token = tokens.iter().find(|t| t.string == "x").expect("should find 'x' token");
    assert_eq!(x_token.start_pos.byte_idx(), 0, "'x' should start at byte 0");
    assert_eq!(x_token.end_pos.byte_idx(), 1, "'x' should end at byte 1");

    // Find the '=' operator token
    let eq_token = tokens.iter().find(|t| t.string == "=").expect("should find '=' token");
    assert_eq!(eq_token.start_pos.byte_idx(), 2, "'=' should start at byte 2");
    assert_eq!(eq_token.end_pos.byte_idx(), 3, "'=' should end at byte 3");

    // Find the Number token '1'
    let one_token = tokens.iter().find(|t| t.string == "1").expect("should find '1' token");
    assert_eq!(one_token.start_pos.byte_idx(), 4, "'1' should start at byte 4");
    assert_eq!(one_token.end_pos.byte_idx(), 5, "'1' should end at byte 5");
}

/// Phase 4 Audit: Verify position data for multi-byte UTF-8 characters.
/// Byte offsets must be accurate for non-ASCII source code.
#[test]
fn test_token_position_with_utf8() {
    use crate::tokenize;

    // "café = 1" where 'é' is 2 bytes (0xC3 0xA9)
    // Byte positions:
    //   'c' at byte 0
    //   'a' at byte 1
    //   'f' at byte 2
    //   'é' at bytes 3-4 (2 bytes)
    //   ' ' at byte 5
    //   '=' at byte 6
    //   ' ' at byte 7
    //   '1' at byte 8
    let source = "café = 1";
    let tokens = tokenize(source).expect("tokenize should succeed");

    // Find the Name token 'café'
    let cafe_token = tokens.iter().find(|t| t.string == "café").expect("should find 'café' token");
    assert_eq!(cafe_token.start_pos.byte_idx(), 0, "'café' should start at byte 0");
    assert_eq!(cafe_token.end_pos.byte_idx(), 5, "'café' should end at byte 5 (4 chars, 5 bytes)");

    // Find the '=' operator token
    let eq_token = tokens.iter().find(|t| t.string == "=").expect("should find '=' token");
    assert_eq!(eq_token.start_pos.byte_idx(), 6, "'=' should start at byte 6");
    assert_eq!(eq_token.end_pos.byte_idx(), 7, "'=' should end at byte 7");

    // Find the Number token '1'
    let one_token = tokens.iter().find(|t| t.string == "1").expect("should find '1' token");
    assert_eq!(one_token.start_pos.byte_idx(), 8, "'1' should start at byte 8");
    assert_eq!(one_token.end_pos.byte_idx(), 9, "'1' should end at byte 9");
}

/// Phase 4 Audit: Verify position data for function definitions.
/// This validates that def_tok, open_paren_tok, etc. have correct positions.
#[test]
fn test_token_position_function_def() {
    use crate::tokenize;

    // "def foo():"
    // Byte positions:
    //   'def' at bytes 0-2
    //   ' ' at byte 3
    //   'foo' at bytes 4-6
    //   '(' at byte 7
    //   ')' at byte 8
    //   ':' at byte 9
    let source = "def foo():";
    let tokens = tokenize(source).expect("tokenize should succeed");

    let def_token = tokens.iter().find(|t| t.string == "def").expect("should find 'def' token");
    assert_eq!(def_token.start_pos.byte_idx(), 0, "'def' should start at byte 0");
    assert_eq!(def_token.end_pos.byte_idx(), 3, "'def' should end at byte 3");

    let foo_token = tokens.iter().find(|t| t.string == "foo").expect("should find 'foo' token");
    assert_eq!(foo_token.start_pos.byte_idx(), 4, "'foo' should start at byte 4");
    assert_eq!(foo_token.end_pos.byte_idx(), 7, "'foo' should end at byte 7");

    let open_paren = tokens.iter().find(|t| t.string == "(").expect("should find '(' token");
    assert_eq!(open_paren.start_pos.byte_idx(), 7, "'(' should start at byte 7");
    assert_eq!(open_paren.end_pos.byte_idx(), 8, "'(' should end at byte 8");

    let close_paren = tokens.iter().find(|t| t.string == ")").expect("should find ')' token");
    assert_eq!(close_paren.start_pos.byte_idx(), 8, "')' should start at byte 8");
    assert_eq!(close_paren.end_pos.byte_idx(), 9, "')' should end at byte 9");

    let colon = tokens.iter().find(|t| t.string == ":").expect("should find ':' token");
    assert_eq!(colon.start_pos.byte_idx(), 9, "':' should start at byte 9");
    assert_eq!(colon.end_pos.byte_idx(), 10, "':' should end at byte 10");
}
