//! Value enum and SQL column encoding/decoding for tugbank-core.

use crate::Error;

/// Maximum size in bytes for `Value::Bytes` payloads (10 MB).
pub const MAX_BLOB_SIZE: usize = 10_485_760;

/// SQL column encoding of a [`Value`]: `(value_kind, value_i64, value_f64, value_text, value_blob)`.
///
/// Used as the return type of [`encode_value`] and the parameter signature of
/// [`decode_value`] to keep function signatures readable.
pub(crate) type EncodedValue = (
    i32,
    Option<i64>,
    Option<f64>,
    Option<String>,
    Option<Vec<u8>>,
);

// value_kind discriminators (must match Table T01 in the plan)
const KIND_NULL: i32 = 0;
const KIND_BOOL: i32 = 1;
const KIND_I64: i32 = 2;
const KIND_F64: i32 = 3;
const KIND_STRING: i32 = 4;
const KIND_BYTES: i32 = 5;
const KIND_JSON: i32 = 6;

/// A typed value stored in a tugbank domain.
///
/// Values are stored using typed SQL columns with a discriminator integer
/// (`value_kind`). See Table T01 in the plan for the full mapping.
///
/// # Variants and SQL encoding
///
/// | Variant | `value_kind` | SQL column |
/// |---------|-------------|------------|
/// | `Null` | 0 | all payload columns NULL |
/// | `Bool` | 1 | `value_i64`: 0 = false, 1 = true |
/// | `I64` | 2 | `value_i64`: direct integer |
/// | `F64` | 3 | `value_f64`: direct real |
/// | `String` | 4 | `value_text`: direct text |
/// | `Bytes` | 5 | `value_blob`: direct blob (max 10 MB) |
/// | `Json` | 6 | `value_text`: JSON-serialized text |
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    /// Null / absent value.
    Null,
    /// Boolean value.
    Bool(bool),
    /// 64-bit signed integer.
    I64(i64),
    /// 64-bit floating-point number.
    F64(f64),
    /// UTF-8 string.
    String(String),
    /// Raw byte blob (limited to [`MAX_BLOB_SIZE`] bytes).
    Bytes(Vec<u8>),
    /// JSON value (arrays, objects, or any JSON type).
    Json(serde_json::Value),
}

/// Encode a [`Value`] into its SQL column representation.
///
/// Returns an [`EncodedValue`] tuple `(value_kind, value_i64, value_f64, value_text, value_blob)`.
/// Exactly one payload column will be `Some`; the rest will be `None`
/// (except `Null`, for which all payload columns are `None`).
pub(crate) fn encode_value(value: &Value) -> EncodedValue {
    match value {
        Value::Null => (KIND_NULL, None, None, None, None),
        Value::Bool(b) => (KIND_BOOL, Some(if *b { 1 } else { 0 }), None, None, None),
        Value::I64(n) => (KIND_I64, Some(*n), None, None, None),
        Value::F64(f) => (KIND_F64, None, Some(*f), None, None),
        Value::String(s) => (KIND_STRING, None, None, Some(s.clone()), None),
        Value::Bytes(b) => (KIND_BYTES, None, None, None, Some(b.clone())),
        Value::Json(j) => {
            // serde_json::to_string never fails for a valid Value
            let text = serde_json::to_string(j).unwrap_or_default();
            (KIND_JSON, None, None, Some(text), None)
        }
    }
}

/// Decode a SQL row back into a [`Value`].
///
/// `kind` is the `value_kind` discriminator integer from the database.
/// The payload arguments correspond to the four typed SQL columns.
pub(crate) fn decode_value(
    kind: i32,
    i64_val: Option<i64>,
    f64_val: Option<f64>,
    text_val: Option<String>,
    blob_val: Option<Vec<u8>>,
) -> Result<Value, Error> {
    match kind {
        KIND_NULL => Ok(Value::Null),
        KIND_BOOL => Ok(Value::Bool(i64_val.unwrap_or(0) != 0)),
        KIND_I64 => Ok(Value::I64(i64_val.unwrap_or(0))),
        KIND_F64 => Ok(Value::F64(f64_val.unwrap_or(0.0))),
        KIND_STRING => Ok(Value::String(text_val.unwrap_or_default())),
        KIND_BYTES => Ok(Value::Bytes(blob_val.unwrap_or_default())),
        KIND_JSON => {
            let text = text_val.unwrap_or_default();
            let json: serde_json::Value = serde_json::from_str(&text)?;
            Ok(Value::Json(json))
        }
        other => Err(Error::Sqlite(rusqlite::Error::FromSqlConversionFailure(
            0,
            rusqlite::types::Type::Integer,
            Box::new(UnknownValueKind(other)),
        ))),
    }
}

/// Check that a `Value::Bytes` payload does not exceed the 10 MB size limit.
///
/// Returns `Error::ValueTooLarge` if the bytes exceed [`MAX_BLOB_SIZE`].
/// Other value variants always pass.
pub(crate) fn check_blob_size(value: &Value) -> Result<(), Error> {
    if let Value::Bytes(bytes) = value {
        if bytes.len() > MAX_BLOB_SIZE {
            return Err(Error::ValueTooLarge { size: bytes.len() });
        }
    }
    Ok(())
}

/// Internal error type for unknown value_kind discriminators.
#[derive(Debug)]
struct UnknownValueKind(i32);

impl std::fmt::Display for UnknownValueKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "unknown value_kind: {}", self.0)
    }
}

impl std::error::Error for UnknownValueKind {}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(value: Value) -> Value {
        let (kind, i64_val, f64_val, text_val, blob_val) = encode_value(&value);
        decode_value(kind, i64_val, f64_val, text_val, blob_val).expect("decode should succeed")
    }

    #[test]
    fn test_null_roundtrip() {
        assert_eq!(roundtrip(Value::Null), Value::Null);
    }

    #[test]
    fn test_bool_true_roundtrip() {
        assert_eq!(roundtrip(Value::Bool(true)), Value::Bool(true));
    }

    #[test]
    fn test_bool_false_roundtrip() {
        assert_eq!(roundtrip(Value::Bool(false)), Value::Bool(false));
    }

    #[test]
    fn test_i64_max_roundtrip() {
        assert_eq!(roundtrip(Value::I64(i64::MAX)), Value::I64(i64::MAX));
    }

    #[test]
    fn test_i64_min_roundtrip() {
        assert_eq!(roundtrip(Value::I64(i64::MIN)), Value::I64(i64::MIN));
    }

    #[test]
    fn test_f64_pi_roundtrip() {
        assert_eq!(
            roundtrip(Value::F64(std::f64::consts::PI)),
            Value::F64(std::f64::consts::PI)
        );
    }

    #[test]
    fn test_string_empty_roundtrip() {
        assert_eq!(
            roundtrip(Value::String(String::new())),
            Value::String(String::new())
        );
    }

    #[test]
    fn test_string_unicode_roundtrip() {
        let s = "héllo wörld 🌍";
        assert_eq!(
            roundtrip(Value::String(s.to_owned())),
            Value::String(s.to_owned())
        );
    }

    #[test]
    fn test_bytes_empty_roundtrip() {
        assert_eq!(roundtrip(Value::Bytes(vec![])), Value::Bytes(vec![]));
    }

    #[test]
    fn test_bytes_1mb_roundtrip() {
        let payload = vec![0xABu8; 1024 * 1024];
        let result = roundtrip(Value::Bytes(payload.clone()));
        assert_eq!(result, Value::Bytes(payload));
    }

    #[test]
    fn test_json_nested_roundtrip() {
        let json = serde_json::json!({
            "key": "value",
            "nested": {"a": 1, "b": [true, null, 3.14]},
            "arr": [1, 2, 3]
        });
        assert_eq!(roundtrip(Value::Json(json.clone())), Value::Json(json));
    }

    #[test]
    fn test_check_blob_size_rejects_over_10mb() {
        let oversized = Value::Bytes(vec![0u8; MAX_BLOB_SIZE + 1]);
        let err = check_blob_size(&oversized).unwrap_err();
        match err {
            Error::ValueTooLarge { size } => assert_eq!(size, MAX_BLOB_SIZE + 1),
            other => panic!("expected ValueTooLarge, got {other:?}"),
        }
    }

    #[test]
    fn test_check_blob_size_accepts_exactly_10mb() {
        let exactly = Value::Bytes(vec![0u8; MAX_BLOB_SIZE]);
        assert!(check_blob_size(&exactly).is_ok());
    }

    #[test]
    fn test_check_blob_size_ignores_large_string() {
        // Strings are not size-limited in v1
        let large_string = Value::String("x".repeat(MAX_BLOB_SIZE + 1));
        assert!(check_blob_size(&large_string).is_ok());
    }
}
