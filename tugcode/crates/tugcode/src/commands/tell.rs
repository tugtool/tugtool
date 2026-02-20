//! Implementation of the tugcode tell command

use crate::output::{JsonIssue, JsonResponse, TellData};
use serde_json::Value;

/// Coerce a string value to an appropriate JSON type
///
/// Rules (first match wins):
/// 1. exact "true" -> Bool(true), exact "false" -> Bool(false)
/// 2. exact "null" -> Null
/// 3. if parses as i64 AND no leading zeros -> Number(i64)
/// 4. if parses as f64 AND finite AND no leading zeros -> Number(f64)
/// 5. everything else -> String
fn coerce_value(s: &str) -> Value {
    // Rule 1: boolean
    if s == "true" {
        return Value::Bool(true);
    }
    if s == "false" {
        return Value::Bool(false);
    }

    // Rule 2: null
    if s == "null" {
        return Value::Null;
    }

    // Rule 3: integer (with leading zero check)
    if let Ok(n) = s.parse::<i64>() {
        // Reject leading zeros (except "-0" itself which is len 2)
        let has_leading_zero =
            (s.len() > 1 && s.starts_with('0')) || (s.len() > 2 && s.starts_with("-0"));
        if !has_leading_zero {
            return Value::Number(n.into());
        }
    }

    // Rule 4: float (with finite check and leading zero check)
    if let Ok(f) = s.parse::<f64>() {
        if f.is_finite() {
            // Check for leading zeros before decimal
            let stripped = s.strip_prefix('-').unwrap_or(s);
            // If first char is '0' and second char is a digit (not '.' or 'e'), reject
            if stripped.len() > 1 {
                let chars: Vec<char> = stripped.chars().collect();
                if chars[0] == '0' && chars[1].is_ascii_digit() {
                    return Value::String(s.to_string());
                }
            }
            // Valid float
            if let Some(num) = serde_json::Number::from_f64(f) {
                return Value::Number(num);
            }
        }
    }

    // Rule 5: string (fallback)
    Value::String(s.to_string())
}

/// Parse parameters from KEY=VALUE strings
fn parse_params(params: &[String]) -> Result<Vec<(String, Value)>, String> {
    let mut result = Vec::new();
    for param in params {
        let parts: Vec<&str> = param.splitn(2, '=').collect();
        if parts.len() != 2 {
            return Err(format!(
                "invalid parameter format: '{}', expected KEY=VALUE",
                param
            ));
        }
        let key = parts[0].to_string();
        let value = coerce_value(parts[1]);
        result.push((key, value));
    }
    Ok(result)
}

/// Run the tell command
pub fn run_tell(
    action: String,
    port: u16,
    params: Vec<String>,
    json_output: bool,
) -> Result<i32, String> {
    // Parse parameters
    let parsed_params = match parse_params(&params) {
        Ok(p) => p,
        Err(e) => {
            if json_output {
                let response = JsonResponse::error(
                    "tell",
                    TellData {
                        server_status: "error".to_string(),
                    },
                    vec![JsonIssue {
                        code: "E099".to_string(),
                        severity: "error".to_string(),
                        message: e.clone(),
                        file: None,
                        line: None,
                        anchor: None,
                    }],
                );
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
                return Ok(1);
            } else {
                return Err(e);
            }
        }
    };

    // Build JSON body
    let mut body = serde_json::json!({ "action": action });
    for (key, value) in parsed_params {
        body[key] = value;
    }

    // Build URL
    let url = format!("http://127.0.0.1:{}/api/tell", port);

    // POST request (ureq 3.x uses default timeouts)
    let response_result = ureq::post(&url).send_json(body);
    match response_result {
        Ok(response) => {
            let status_code = response.status().as_u16();
            if status_code == 200 {
                // Success
                if json_output {
                    let response = JsonResponse::ok(
                        "tell",
                        TellData {
                            server_status: "ok".to_string(),
                        },
                    );
                    println!("{}", serde_json::to_string_pretty(&response).unwrap());
                } else {
                    println!("ok");
                }
                Ok(0)
            } else {
                // HTTP error
                let msg = format!("server returned status {}", status_code);
                if json_output {
                    let response = JsonResponse::error(
                        "tell",
                        TellData {
                            server_status: "error".to_string(),
                        },
                        vec![JsonIssue {
                            code: "E099".to_string(),
                            severity: "error".to_string(),
                            message: msg,
                            file: None,
                            line: None,
                            anchor: None,
                        }],
                    );
                    println!("{}", serde_json::to_string_pretty(&response).unwrap());
                } else {
                    eprintln!("Error: {}", msg);
                }
                Ok(1)
            }
        }
        Err(e) => {
            // Transport error (connection refused, timeout, etc.)
            let msg = format!("connection failed: {}", e);
            if json_output {
                let response = JsonResponse::error(
                    "tell",
                    TellData {
                        server_status: "error".to_string(),
                    },
                    vec![JsonIssue {
                        code: "E099".to_string(),
                        severity: "error".to_string(),
                        message: msg.clone(),
                        file: None,
                        line: None,
                        anchor: None,
                    }],
                );
                println!("{}", serde_json::to_string_pretty(&response).unwrap());
                Ok(1)
            } else {
                Err(msg)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_coerce_true() {
        assert_eq!(coerce_value("true"), Value::Bool(true));
    }

    #[test]
    fn test_coerce_false() {
        assert_eq!(coerce_value("false"), Value::Bool(false));
    }

    #[test]
    fn test_coerce_null() {
        assert_eq!(coerce_value("null"), Value::Null);
    }

    #[test]
    fn test_coerce_integer() {
        assert_eq!(coerce_value("42"), serde_json::json!(42));
        assert_eq!(coerce_value("-42"), serde_json::json!(-42));
        assert_eq!(coerce_value("0"), serde_json::json!(0));
    }

    #[test]
    fn test_coerce_float() {
        assert_eq!(coerce_value("2.5"), serde_json::json!(2.5));
        assert_eq!(coerce_value("1e5"), serde_json::json!(100000.0));
        assert_eq!(coerce_value("-0.5"), serde_json::json!(-0.5));
    }

    #[test]
    fn test_coerce_string() {
        assert_eq!(coerce_value("hello"), Value::String("hello".to_string()));
        assert_eq!(coerce_value("TRUE"), Value::String("TRUE".to_string()));
    }

    #[test]
    fn test_coerce_leading_zero() {
        assert_eq!(coerce_value("01"), Value::String("01".to_string()));
        assert_eq!(coerce_value("007"), Value::String("007".to_string()));
        assert_eq!(coerce_value("01.5"), Value::String("01.5".to_string()));
    }

    #[test]
    fn test_coerce_empty() {
        assert_eq!(coerce_value(""), Value::String("".to_string()));
    }

    #[test]
    fn test_coerce_no_trim() {
        assert_eq!(coerce_value(" true "), Value::String(" true ".to_string()));
    }

    #[test]
    fn test_coerce_nan() {
        assert_eq!(coerce_value("NaN"), Value::String("NaN".to_string()));
    }

    #[test]
    fn test_coerce_infinity() {
        assert_eq!(
            coerce_value("Infinity"),
            Value::String("Infinity".to_string())
        );
    }

    #[test]
    fn test_coerce_negative_zero() {
        // "-0" has len 2, so the check (s.len() > 2 && s.starts_with("-0")) is false
        // It parses as i64 0
        assert_eq!(coerce_value("-0"), serde_json::json!(0));
    }

    #[test]
    fn test_parse_params_valid() {
        let params = vec!["component=about".to_string(), "enabled=true".to_string()];
        let result = parse_params(&params).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].0, "component");
        assert_eq!(result[0].1, Value::String("about".to_string()));
        assert_eq!(result[1].0, "enabled");
        assert_eq!(result[1].1, Value::Bool(true));
    }

    #[test]
    fn test_parse_params_value_with_equals() {
        let params = vec!["path=/foo/bar=baz".to_string()];
        let result = parse_params(&params).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].0, "path");
        assert_eq!(result[0].1, Value::String("/foo/bar=baz".to_string()));
    }

    #[test]
    fn test_parse_params_missing_equals() {
        let params = vec!["noequalssign".to_string()];
        let result = parse_params(&params);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("invalid parameter format"));
    }
}
