//! HTTP handlers for `/api/defaults` endpoints.
//!
//! Provides the tagged-object JSON wire format (`TaggedValue`) and conversion
//! functions between `tugbank_core::Value` and the wire format. HTTP handlers
//! are added in a later step.

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tugbank_core::Value;

// ── Tagged wire format ─────────────────────────────────────────────────────

/// Tagged JSON representation of a `tugbank_core::Value`.
///
/// The wire format uses `{"kind":"<type>","value":<payload>}` for all value
/// representations in both PUT request bodies and GET responses. See Table T01
/// in the plan for the full kind-string mapping.
///
/// - `Null` serializes as `{"kind":"null"}` — no `value` field.
/// - `Bytes` serializes the raw bytes as a standard base64 string.
/// - `Json` embeds the JSON value directly in the `value` field.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub(crate) struct TaggedValue {
    pub(crate) kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) value: Option<serde_json::Value>,
}

// ── Conversion: Value → TaggedValue ───────────────────────────────────────

/// Convert a `tugbank_core::Value` to its tagged wire representation.
///
/// `Bytes` payloads are encoded using standard base64. All other variants
/// map directly to their JSON counterparts per Table T01.
#[allow(dead_code)]
pub(crate) fn value_to_tagged(value: &Value) -> TaggedValue {
    match value {
        Value::Null => TaggedValue {
            kind: "null".to_owned(),
            value: None,
        },
        Value::Bool(b) => TaggedValue {
            kind: "bool".to_owned(),
            value: Some(serde_json::json!(b)),
        },
        Value::I64(n) => TaggedValue {
            kind: "i64".to_owned(),
            value: Some(serde_json::json!(n)),
        },
        Value::F64(f) => TaggedValue {
            kind: "f64".to_owned(),
            value: Some(serde_json::json!(f)),
        },
        Value::String(s) => TaggedValue {
            kind: "string".to_owned(),
            value: Some(serde_json::json!(s)),
        },
        Value::Bytes(b) => TaggedValue {
            kind: "bytes".to_owned(),
            value: Some(serde_json::json!(
                base64::engine::general_purpose::STANDARD.encode(b)
            )),
        },
        Value::Json(j) => TaggedValue {
            kind: "json".to_owned(),
            value: Some(j.clone()),
        },
    }
}

// ── Conversion: TaggedValue → Value ───────────────────────────────────────

/// Convert a tagged wire representation back to a `tugbank_core::Value`.
///
/// Returns `Err(String)` if the `kind` field is unrecognised, the `value`
/// field is missing or has the wrong JSON type, or the base64 payload for
/// `"bytes"` is invalid.
#[allow(dead_code)]
pub(crate) fn tagged_to_value(tagged: &TaggedValue) -> Result<Value, String> {
    match tagged.kind.as_str() {
        "null" => Ok(Value::Null),
        "bool" => {
            let b = tagged
                .value
                .as_ref()
                .and_then(|v| v.as_bool())
                .ok_or_else(|| "\"bool\" value must be a JSON boolean".to_owned())?;
            Ok(Value::Bool(b))
        }
        "i64" => {
            let n = tagged
                .value
                .as_ref()
                .and_then(|v| v.as_i64())
                .ok_or_else(|| "\"i64\" value must be a JSON integer".to_owned())?;
            Ok(Value::I64(n))
        }
        "f64" => {
            let f = tagged
                .value
                .as_ref()
                .and_then(|v| v.as_f64())
                .ok_or_else(|| "\"f64\" value must be a JSON number".to_owned())?;
            Ok(Value::F64(f))
        }
        "string" => {
            let s = tagged
                .value
                .as_ref()
                .and_then(|v| v.as_str())
                .ok_or_else(|| "\"string\" value must be a JSON string".to_owned())?;
            Ok(Value::String(s.to_owned()))
        }
        "bytes" => {
            let encoded = tagged
                .value
                .as_ref()
                .and_then(|v| v.as_str())
                .ok_or_else(|| "\"bytes\" value must be a base64-encoded JSON string".to_owned())?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .map_err(|e| format!("invalid base64 for \"bytes\": {e}"))?;
            Ok(Value::Bytes(bytes))
        }
        "json" => {
            let j = tagged
                .value
                .clone()
                .ok_or_else(|| "\"json\" value must be present".to_owned())?;
            Ok(Value::Json(j))
        }
        other => Err(format!("unknown kind: \"{other}\"")),
    }
}

// ── Unit tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // T04: Null produces {"kind":"null"} with no value field
    #[test]
    fn test_value_to_tagged_null() {
        let t = value_to_tagged(&Value::Null);
        assert_eq!(t.kind, "null");
        assert_eq!(t.value, None);
        let serialized = serde_json::to_string(&t).unwrap();
        assert_eq!(serialized, r#"{"kind":"null"}"#);
    }

    // T05: Bool(true) produces {"kind":"bool","value":true}
    #[test]
    fn test_value_to_tagged_bool_true() {
        let t = value_to_tagged(&Value::Bool(true));
        assert_eq!(t.kind, "bool");
        assert_eq!(t.value, Some(json!(true)));
        let serialized = serde_json::to_string(&t).unwrap();
        assert_eq!(serialized, r#"{"kind":"bool","value":true}"#);
    }

    // T05 (false variant): Bool(false) serializes correctly
    #[test]
    fn test_value_to_tagged_bool_false() {
        let t = value_to_tagged(&Value::Bool(false));
        assert_eq!(t.kind, "bool");
        assert_eq!(t.value, Some(json!(false)));
    }

    // T06: I64(42) produces {"kind":"i64","value":42}
    #[test]
    fn test_value_to_tagged_i64() {
        let t = value_to_tagged(&Value::I64(42));
        assert_eq!(t.kind, "i64");
        assert_eq!(t.value, Some(json!(42i64)));
        let serialized = serde_json::to_string(&t).unwrap();
        assert_eq!(serialized, r#"{"kind":"i64","value":42}"#);
    }

    // T07: F64(3.14) produces {"kind":"f64","value":3.14}
    #[test]
    fn test_value_to_tagged_f64() {
        let t = value_to_tagged(&Value::F64(3.14));
        assert_eq!(t.kind, "f64");
        // JSON number comparison via serialization
        let serialized = serde_json::to_string(&t).unwrap();
        assert_eq!(serialized, r#"{"kind":"f64","value":3.14}"#);
    }

    // T08: String("dark") produces {"kind":"string","value":"dark"}
    #[test]
    fn test_value_to_tagged_string() {
        let t = value_to_tagged(&Value::String("dark".into()));
        assert_eq!(t.kind, "string");
        assert_eq!(t.value, Some(json!("dark")));
        let serialized = serde_json::to_string(&t).unwrap();
        assert_eq!(serialized, r#"{"kind":"string","value":"dark"}"#);
    }

    // T09: Bytes([1,2,3]) produces {"kind":"bytes","value":"AQID"}
    #[test]
    fn test_value_to_tagged_bytes() {
        let t = value_to_tagged(&Value::Bytes(vec![1, 2, 3]));
        assert_eq!(t.kind, "bytes");
        assert_eq!(t.value, Some(json!("AQID")));
        let serialized = serde_json::to_string(&t).unwrap();
        assert_eq!(serialized, r#"{"kind":"bytes","value":"AQID"}"#);
    }

    // T10: Json({"a":1}) produces {"kind":"json","value":{"a":1}}
    #[test]
    fn test_value_to_tagged_json() {
        let t = value_to_tagged(&Value::Json(json!({"a": 1})));
        assert_eq!(t.kind, "json");
        assert_eq!(t.value, Some(json!({"a": 1})));
        let serialized = serde_json::to_string(&t).unwrap();
        assert_eq!(serialized, r#"{"kind":"json","value":{"a":1}}"#);
    }

    // T11: Round-trip for all seven variants
    fn roundtrip(v: Value) -> Value {
        let tagged = value_to_tagged(&v);
        tagged_to_value(&tagged).expect("round-trip should not fail")
    }

    #[test]
    fn test_roundtrip_null() {
        assert_eq!(roundtrip(Value::Null), Value::Null);
    }

    #[test]
    fn test_roundtrip_bool_true() {
        assert_eq!(roundtrip(Value::Bool(true)), Value::Bool(true));
    }

    #[test]
    fn test_roundtrip_bool_false() {
        assert_eq!(roundtrip(Value::Bool(false)), Value::Bool(false));
    }

    #[test]
    fn test_roundtrip_i64() {
        assert_eq!(roundtrip(Value::I64(i64::MAX)), Value::I64(i64::MAX));
        assert_eq!(roundtrip(Value::I64(i64::MIN)), Value::I64(i64::MIN));
        assert_eq!(roundtrip(Value::I64(0)), Value::I64(0));
    }

    #[test]
    fn test_roundtrip_f64() {
        assert_eq!(
            roundtrip(Value::F64(std::f64::consts::PI)),
            Value::F64(std::f64::consts::PI)
        );
        assert_eq!(roundtrip(Value::F64(0.0)), Value::F64(0.0));
    }

    #[test]
    fn test_roundtrip_string() {
        assert_eq!(
            roundtrip(Value::String("dark".into())),
            Value::String("dark".into())
        );
        assert_eq!(
            roundtrip(Value::String(String::new())),
            Value::String(String::new())
        );
    }

    #[test]
    fn test_roundtrip_bytes() {
        assert_eq!(
            roundtrip(Value::Bytes(vec![1, 2, 3])),
            Value::Bytes(vec![1, 2, 3])
        );
        assert_eq!(roundtrip(Value::Bytes(vec![])), Value::Bytes(vec![]));
    }

    #[test]
    fn test_roundtrip_json() {
        let j = json!({"a": 1, "b": [true, null, 1.5]});
        assert_eq!(roundtrip(Value::Json(j.clone())), Value::Json(j));
    }

    // T12: unknown kind string returns Err
    #[test]
    fn test_tagged_to_value_unknown_kind_returns_error() {
        let tagged = TaggedValue {
            kind: "bogus".to_owned(),
            value: None,
        };
        let result = tagged_to_value(&tagged);
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(msg.contains("unknown kind"), "error message: {msg}");
    }

    // Additional: wrong value field type for bool returns Err
    #[test]
    fn test_tagged_to_value_bool_wrong_type_returns_error() {
        let tagged = TaggedValue {
            kind: "bool".to_owned(),
            value: Some(json!("not-a-bool")),
        };
        assert!(tagged_to_value(&tagged).is_err());
    }

    // Additional: invalid base64 for bytes returns Err
    #[test]
    fn test_tagged_to_value_bytes_invalid_base64_returns_error() {
        let tagged = TaggedValue {
            kind: "bytes".to_owned(),
            value: Some(json!("!!!not-base64!!!")),
        };
        let result = tagged_to_value(&tagged);
        assert!(result.is_err());
    }
}
