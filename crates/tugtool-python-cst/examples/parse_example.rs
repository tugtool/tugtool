// Copyright (c) Ken Kocienda and other contributors.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Example demonstrating version-aware Python parsing.
//!
//! Run with: `cargo run --example parse_example`

use tugtool_python_cst::{
    parse_module, parse_module_with_options, prettify_error, Codegen, CodegenState, ParseOptions,
    PythonVersion,
};

fn main() {
    println!("=== tugtool-python-cst Version-Aware Parsing Example ===\n");

    // 1. Simple parsing with permissive mode (default)
    println!("1. Permissive Mode Parsing");
    println!("   -----------------------");
    let source = "def greet(name):\n    return f'Hello, {name}!'";
    match parse_module(source, None) {
        Ok(module) => {
            let mut state = CodegenState::default();
            module.codegen(&mut state);
            println!("   Parsed successfully!");
            println!("   Round-trip output matches: {}", state.to_string() == source);
        }
        Err(e) => println!("   Error: {}", prettify_error(e, "example")),
    }
    println!();

    // 2. Version-aware parsing with Python 3.10 (match statements)
    println!("2. Python 3.10 Targeting (Match Statements)");
    println!("   ----------------------------------------");
    let match_source = r#"match command:
    case "quit":
        return False
    case "help":
        show_help()
    case _:
        print("Unknown command")"#;

    let options = ParseOptions::new(PythonVersion::V3_10);
    println!("   Target version: {}", options.version);
    println!("   has_match_statements(): {}", options.version.has_match_statements());

    match parse_module_with_options(match_source, options) {
        Ok(module) => {
            let mut state = CodegenState::default();
            module.codegen(&mut state);
            println!("   Parsed match statement successfully!");
            println!("   Round-trip preserved: {}", state.to_string() == match_source);
        }
        Err(e) => println!("   Error: {}", prettify_error(e, "match_example")),
    }
    println!();

    // 3. Version feature queries
    println!("3. Version Feature Queries");
    println!("   -----------------------");
    for version in [
        PythonVersion::V3_8,
        PythonVersion::V3_9,
        PythonVersion::V3_10,
        PythonVersion::V3_11,
        PythonVersion::V3_12,
        PythonVersion::Permissive,
    ] {
        println!(
            "   {} - match: {}, walrus_comp: {}, except*: {}, type_param: {}",
            version,
            version.has_match_statements(),
            version.has_walrus_in_comprehension_iterable(),
            version.has_exception_groups(),
            version.has_type_parameter_syntax()
        );
    }
    println!();

    // 4. Parse with encoding hint
    println!("4. Parsing with Encoding Hint");
    println!("   --------------------------");
    let options = ParseOptions::new(PythonVersion::V3_9).with_encoding("utf-8");
    let unicode_source = "message = 'Hello, 世界!'";
    match parse_module_with_options(unicode_source, options) {
        Ok(_) => println!("   Parsed Unicode source successfully!"),
        Err(e) => println!("   Error: {}", prettify_error(e, "unicode_example")),
    }
    println!();

    // 5. Error handling example
    println!("5. Error Handling");
    println!("   --------------");
    let invalid_source = "def broken(";
    match parse_module(invalid_source, None) {
        Ok(_) => println!("   Unexpected success!"),
        Err(e) => {
            println!("   Parse error caught (expected):");
            println!("{}", prettify_error(e, "invalid.py"));
        }
    }

    println!("\n=== Example Complete ===");
}
