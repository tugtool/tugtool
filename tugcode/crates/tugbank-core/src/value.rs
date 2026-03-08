//! Value enum and SQL column encoding/decoding for tugbank-core.

use crate::Error;

/// Maximum size in bytes for `Value::Bytes` payloads (10 MB).
pub const MAX_BLOB_SIZE: usize = 10_485_760;

/// A typed value stored in a tugbank domain.
///
/// Values are stored using typed SQL columns with a discriminator integer.
/// See the value_kind mapping for details.
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
    /// Raw byte blob (limited to 10 MB).
    Bytes(Vec<u8>),
    /// JSON value (arrays, objects, or any JSON type).
    Json(serde_json::Value),
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
