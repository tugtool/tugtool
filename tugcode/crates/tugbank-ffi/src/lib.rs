//! `tugbank-ffi` — C ABI wrappers around [`TugbankClient`].
//!
//! This crate exposes a set of `extern "C"` functions that allow Swift (and
//! other C-compatible languages) to open, read, write, and close a
//! [`TugbankClient`] database without any Rust-specific types crossing the
//! language boundary.
//!
//! # Ownership and lifecycle
//!
//! - [`tugbank_open`] allocates a [`TugbankClient`] on the heap and returns an
//!   opaque `*mut c_void` handle.
//! - The caller is responsible for eventually passing that handle to
//!   [`tugbank_close`], which drops the client and frees the memory.
//! - String values returned from [`tugbank_get`], [`tugbank_read_domain`], and
//!   [`tugbank_list_domains`] are heap-allocated C strings. The caller must
//!   free them with [`tugbank_free_string`].
//!
//! # Thread safety
//!
//! [`TugbankClient`] is `Send + Sync`, so the handle may be used from multiple
//! threads as long as the caller ensures the handle is not closed while another
//! thread is using it.

use std::ffi::{CStr, CString, c_char, c_void};
use std::time::Duration;

use tugbank_core::{TugbankClient, Value};

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Serialize `s` into a heap-allocated C string and return a raw pointer.
///
/// Returns `null` if the string contains interior null bytes (after replacing
/// them would produce silent data corruption). The caller must free the
/// returned pointer with [`tugbank_free_string`].
fn string_to_c(s: String) -> *mut c_char {
    match CString::new(s) {
        Ok(cs) => cs.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Convert a `serde_json::Value` into a `tugbank_core::Value`.
///
/// The mapping follows the natural JSON-to-Rust type correspondence:
/// - `null` → [`Value::Null`]
/// - `bool` → [`Value::Bool`]
/// - integer-valued numbers → [`Value::I64`]
/// - other numbers → [`Value::F64`]
/// - strings → [`Value::String`]
/// - arrays and objects → [`Value::Json`]
fn json_to_value(json: serde_json::Value) -> Value {
    match json {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Bool(b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::I64(i)
            } else if let Some(f) = n.as_f64() {
                Value::F64(f)
            } else {
                Value::Null
            }
        }
        serde_json::Value::String(s) => Value::String(s),
        other @ (serde_json::Value::Array(_) | serde_json::Value::Object(_)) => Value::Json(other),
    }
}

/// Serialize a [`Value`] into a tagged JSON object suitable for round-tripping.
///
/// Returns a JSON object of the form `{"type": "<kind>", "value": <payload>}`.
fn value_to_json(value: &Value) -> serde_json::Value {
    match value {
        Value::Null => serde_json::json!({"type": "null", "value": null}),
        Value::Bool(b) => serde_json::json!({"type": "bool", "value": b}),
        Value::I64(n) => serde_json::json!({"type": "i64", "value": n}),
        Value::F64(f) => serde_json::json!({"type": "f64", "value": f}),
        Value::String(s) => serde_json::json!({"type": "string", "value": s}),
        Value::Bytes(b) => {
            // Encode bytes as a base64-like hex string for JSON transport.
            let hex: String = b.iter().map(|byte| format!("{byte:02x}")).collect();
            serde_json::json!({"type": "bytes", "value": hex})
        }
        Value::Json(j) => serde_json::json!({"type": "json", "value": j}),
    }
}

// ── Public FFI surface ────────────────────────────────────────────────────────

/// Open a [`TugbankClient`] backed by the SQLite database at `path`.
///
/// # Safety
///
/// `path` must be a valid, non-null, NUL-terminated C string. The returned
/// handle must eventually be passed to [`tugbank_close`] to avoid a memory
/// leak. Returns `null` if `path` is null, not valid UTF-8, or the database
/// cannot be opened.
#[unsafe(no_mangle)]
pub extern "C" fn tugbank_open(path: *const c_char) -> *mut c_void {
    if path.is_null() {
        return std::ptr::null_mut();
    }
    let path_str = unsafe {
        match CStr::from_ptr(path).to_str() {
            Ok(s) => s,
            Err(_) => return std::ptr::null_mut(),
        }
    };
    match TugbankClient::open(path_str, Duration::from_millis(500)) {
        Ok(client) => Box::into_raw(Box::new(client)) as *mut c_void,
        Err(_) => std::ptr::null_mut(),
    }
}

/// Retrieve a value from the store and return it as a JSON-encoded C string.
///
/// The returned string has the form `{"type": "<kind>", "value": <payload>}`.
/// Returns `null` if `handle`, `domain`, or `key` is null, or if the key does
/// not exist in the domain.
///
/// # Safety
///
/// `handle` must be a valid pointer previously returned by [`tugbank_open`]
/// and not yet closed. `domain` and `key` must be valid, non-null,
/// NUL-terminated C strings. The caller must free the returned string with
/// [`tugbank_free_string`].
#[unsafe(no_mangle)]
pub extern "C" fn tugbank_get(
    handle: *mut c_void,
    domain: *const c_char,
    key: *const c_char,
) -> *mut c_char {
    if handle.is_null() || domain.is_null() || key.is_null() {
        return std::ptr::null_mut();
    }
    let client = unsafe { &*(handle as *const TugbankClient) };
    let domain_str = unsafe {
        match CStr::from_ptr(domain).to_str() {
            Ok(s) => s,
            Err(_) => return std::ptr::null_mut(),
        }
    };
    let key_str = unsafe {
        match CStr::from_ptr(key).to_str() {
            Ok(s) => s,
            Err(_) => return std::ptr::null_mut(),
        }
    };
    match client.get(domain_str, key_str) {
        Ok(Some(value)) => {
            let json = value_to_json(&value);
            match serde_json::to_string(&json) {
                Ok(s) => string_to_c(s),
                Err(_) => std::ptr::null_mut(),
            }
        }
        _ => std::ptr::null_mut(),
    }
}

/// Write a value to the store.
///
/// `value_json` must be a JSON string. Plain JSON types are mapped to
/// [`Value`] variants: `null` → `Null`, `true`/`false` → `Bool`, integers →
/// `I64`, other numbers → `F64`, strings → `String`, arrays/objects → `Json`.
///
/// Returns `0` on success and `-1` on any error.
///
/// # Safety
///
/// `handle` must be a valid pointer previously returned by [`tugbank_open`]
/// and not yet closed. `domain`, `key`, and `value_json` must be valid,
/// non-null, NUL-terminated C strings containing valid UTF-8.
#[unsafe(no_mangle)]
pub extern "C" fn tugbank_set(
    handle: *mut c_void,
    domain: *const c_char,
    key: *const c_char,
    value_json: *const c_char,
) -> i32 {
    if handle.is_null() || domain.is_null() || key.is_null() || value_json.is_null() {
        return -1;
    }
    let client = unsafe { &*(handle as *const TugbankClient) };
    let domain_str = unsafe {
        match CStr::from_ptr(domain).to_str() {
            Ok(s) => s,
            Err(_) => return -1,
        }
    };
    let key_str = unsafe {
        match CStr::from_ptr(key).to_str() {
            Ok(s) => s,
            Err(_) => return -1,
        }
    };
    let value_str = unsafe {
        match CStr::from_ptr(value_json).to_str() {
            Ok(s) => s,
            Err(_) => return -1,
        }
    };
    let json: serde_json::Value = match serde_json::from_str(value_str) {
        Ok(j) => j,
        Err(_) => return -1,
    };
    let value = json_to_value(json);
    match client.set(domain_str, key_str, value) {
        Ok(()) => 0,
        Err(_) => -1,
    }
}

/// Return the current `PRAGMA data_version` for the underlying database.
///
/// Returns `0` on error or if `handle` is null.
///
/// # Safety
///
/// `handle` must be a valid pointer previously returned by [`tugbank_open`]
/// and not yet closed.
#[unsafe(no_mangle)]
pub extern "C" fn tugbank_data_version(handle: *mut c_void) -> u64 {
    if handle.is_null() {
        return 0;
    }
    let client = unsafe { &*(handle as *const TugbankClient) };
    client.data_version().unwrap_or(0)
}

/// Return all key-value pairs for `domain` as a JSON-encoded C string.
///
/// The returned string is a JSON object mapping key names to tagged value
/// objects (same format as [`tugbank_get`]). Returns `null` on error.
///
/// # Safety
///
/// `handle` must be a valid pointer previously returned by [`tugbank_open`]
/// and not yet closed. `domain` must be a valid, non-null, NUL-terminated C
/// string. The caller must free the returned string with
/// [`tugbank_free_string`].
#[unsafe(no_mangle)]
pub extern "C" fn tugbank_read_domain(
    handle: *mut c_void,
    domain: *const c_char,
) -> *mut c_char {
    if handle.is_null() || domain.is_null() {
        return std::ptr::null_mut();
    }
    let client = unsafe { &*(handle as *const TugbankClient) };
    let domain_str = unsafe {
        match CStr::from_ptr(domain).to_str() {
            Ok(s) => s,
            Err(_) => return std::ptr::null_mut(),
        }
    };
    match client.read_domain(domain_str) {
        Ok(snapshot) => {
            let obj: serde_json::Map<String, serde_json::Value> = snapshot
                .into_iter()
                .map(|(k, v)| (k, value_to_json(&v)))
                .collect();
            let json = serde_json::Value::Object(obj);
            match serde_json::to_string(&json) {
                Ok(s) => string_to_c(s),
                Err(_) => std::ptr::null_mut(),
            }
        }
        Err(_) => std::ptr::null_mut(),
    }
}

/// Return the list of all domain names as a JSON-encoded C string.
///
/// The returned string is a JSON array of domain name strings. Returns `null`
/// on error.
///
/// # Safety
///
/// `handle` must be a valid pointer previously returned by [`tugbank_open`]
/// and not yet closed. The caller must free the returned string with
/// [`tugbank_free_string`].
#[unsafe(no_mangle)]
pub extern "C" fn tugbank_list_domains(handle: *mut c_void) -> *mut c_char {
    if handle.is_null() {
        return std::ptr::null_mut();
    }
    let client = unsafe { &*(handle as *const TugbankClient) };
    match client.list_domains() {
        Ok(domains) => {
            let json = serde_json::json!(domains);
            match serde_json::to_string(&json) {
                Ok(s) => string_to_c(s),
                Err(_) => std::ptr::null_mut(),
            }
        }
        Err(_) => std::ptr::null_mut(),
    }
}

/// Close the client and free all associated resources.
///
/// After this call the handle is invalid and must not be used again. Passing
/// `null` is safe and is a no-op.
///
/// # Safety
///
/// `handle` must be a valid pointer previously returned by [`tugbank_open`],
/// or `null`. After this call the handle must never be used again.
#[unsafe(no_mangle)]
pub extern "C" fn tugbank_close(handle: *mut c_void) {
    if handle.is_null() {
        return;
    }
    let _ = unsafe { Box::from_raw(handle as *mut TugbankClient) };
}

/// Free a C string that was returned by this library.
///
/// Passing `null` is safe and is a no-op. Do not call this function with
/// pointers that were not returned by this library.
///
/// # Safety
///
/// `ptr` must be either `null` or a pointer previously returned by
/// [`tugbank_get`], [`tugbank_read_domain`], or [`tugbank_list_domains`].
/// After this call the pointer is invalid and must not be used again.
#[unsafe(no_mangle)]
pub extern "C" fn tugbank_free_string(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    let _ = unsafe { CString::from_raw(ptr) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;
    use tempfile::NamedTempFile;

    fn make_cstr(s: &str) -> CString {
        CString::new(s).expect("CString::new failed")
    }

    fn open_temp() -> (*mut c_void, NamedTempFile) {
        let tmp = NamedTempFile::new().expect("temp file");
        let path = make_cstr(tmp.path().to_str().expect("path to str"));
        let handle = tugbank_open(path.as_ptr());
        assert!(!handle.is_null(), "tugbank_open should return non-null handle");
        (handle, tmp)
    }

    // ── test_open_close ───────────────────────────────────────────────────────

    #[test]
    fn test_open_close() {
        let (handle, _tmp) = open_temp();
        assert!(!handle.is_null());
        tugbank_close(handle);
    }

    // ── test_set_and_get ──────────────────────────────────────────────────────

    #[test]
    fn test_set_and_get() {
        let (handle, _tmp) = open_temp();

        let domain = make_cstr("com.test.domain");
        let key = make_cstr("answer");
        let value_json = make_cstr("42");

        let rc = tugbank_set(handle, domain.as_ptr(), key.as_ptr(), value_json.as_ptr());
        assert_eq!(rc, 0, "tugbank_set should return 0 on success");

        let result = tugbank_get(handle, domain.as_ptr(), key.as_ptr());
        assert!(!result.is_null(), "tugbank_get should return non-null for existing key");

        let result_str = unsafe { CStr::from_ptr(result).to_str().expect("valid utf8") };
        let parsed: serde_json::Value =
            serde_json::from_str(result_str).expect("valid JSON from tugbank_get");
        assert_eq!(parsed["type"], "i64");
        assert_eq!(parsed["value"], 42);

        tugbank_free_string(result);
        tugbank_close(handle);
    }

    // ── test_read_domain ──────────────────────────────────────────────────────

    #[test]
    fn test_read_domain() {
        let (handle, _tmp) = open_temp();

        let domain = make_cstr("com.test.multi");
        let key_a = make_cstr("alpha");
        let key_b = make_cstr("beta");
        let val_a = make_cstr("\"hello\"");
        let val_b = make_cstr("true");

        tugbank_set(handle, domain.as_ptr(), key_a.as_ptr(), val_a.as_ptr());
        tugbank_set(handle, domain.as_ptr(), key_b.as_ptr(), val_b.as_ptr());

        let result = tugbank_read_domain(handle, domain.as_ptr());
        assert!(!result.is_null(), "tugbank_read_domain should return non-null");

        let result_str = unsafe { CStr::from_ptr(result).to_str().expect("valid utf8") };
        let parsed: serde_json::Value =
            serde_json::from_str(result_str).expect("valid JSON from tugbank_read_domain");

        assert!(parsed.get("alpha").is_some(), "domain should contain 'alpha'");
        assert!(parsed.get("beta").is_some(), "domain should contain 'beta'");

        tugbank_free_string(result);
        tugbank_close(handle);
    }

    // ── test_list_domains ─────────────────────────────────────────────────────

    #[test]
    fn test_list_domains() {
        let (handle, _tmp) = open_temp();

        let domain_a = make_cstr("com.example.first");
        let domain_b = make_cstr("com.example.second");
        let key = make_cstr("k");
        let val = make_cstr("1");

        tugbank_set(handle, domain_a.as_ptr(), key.as_ptr(), val.as_ptr());
        tugbank_set(handle, domain_b.as_ptr(), key.as_ptr(), val.as_ptr());

        let result = tugbank_list_domains(handle);
        assert!(!result.is_null(), "tugbank_list_domains should return non-null");

        let result_str = unsafe { CStr::from_ptr(result).to_str().expect("valid utf8") };
        let parsed: serde_json::Value =
            serde_json::from_str(result_str).expect("valid JSON from tugbank_list_domains");

        let domains: Vec<&str> = parsed
            .as_array()
            .expect("should be an array")
            .iter()
            .filter_map(|v| v.as_str())
            .collect();

        assert!(
            domains.contains(&"com.example.first"),
            "should contain first domain"
        );
        assert!(
            domains.contains(&"com.example.second"),
            "should contain second domain"
        );

        tugbank_free_string(result);
        tugbank_close(handle);
    }

    // ── test_data_version ─────────────────────────────────────────────────────

    #[test]
    fn test_data_version() {
        let (handle, _tmp) = open_temp();

        // After opening an empty database the data_version pragma should be
        // zero or a small positive value — either way non-negative. The key
        // assertion is that the call does not crash.
        let version = tugbank_data_version(handle);
        // Write something so the version is guaranteed non-zero.
        let domain = make_cstr("com.test.version");
        let key = make_cstr("v");
        let val = make_cstr("99");
        tugbank_set(handle, domain.as_ptr(), key.as_ptr(), val.as_ptr());

        let version_after = tugbank_data_version(handle);
        // After a write the version should be >= the initial version.
        assert!(
            version_after >= version,
            "data_version should be non-decreasing after a write"
        );

        tugbank_close(handle);
    }

    // ── test_null_safety ──────────────────────────────────────────────────────

    #[test]
    fn test_null_safety() {
        // tugbank_close(null) must not crash.
        tugbank_close(std::ptr::null_mut());

        // tugbank_free_string(null) must not crash.
        tugbank_free_string(std::ptr::null_mut());

        // tugbank_open(null) must return null without crashing.
        let handle = tugbank_open(std::ptr::null());
        assert!(handle.is_null(), "tugbank_open(null) should return null");

        // Other functions with null handle must return null / -1 / 0.
        let domain = make_cstr("d");
        let key = make_cstr("k");
        let val = make_cstr("1");

        let rc = tugbank_set(std::ptr::null_mut(), domain.as_ptr(), key.as_ptr(), val.as_ptr());
        assert_eq!(rc, -1);

        let ptr = tugbank_get(std::ptr::null_mut(), domain.as_ptr(), key.as_ptr());
        assert!(ptr.is_null());

        let ptr2 = tugbank_read_domain(std::ptr::null_mut(), domain.as_ptr());
        assert!(ptr2.is_null());

        let ptr3 = tugbank_list_domains(std::ptr::null_mut());
        assert!(ptr3.is_null());

        let v = tugbank_data_version(std::ptr::null_mut());
        assert_eq!(v, 0);
    }
}
