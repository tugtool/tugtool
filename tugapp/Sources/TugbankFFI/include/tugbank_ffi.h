/// tugbank_ffi.h — C declarations for the tugbank-ffi Rust static library.
///
/// All string parameters are NUL-terminated UTF-8 C strings.  String return
/// values are heap-allocated by the Rust library; the caller MUST free them
/// with tugbank_free_string().
///
/// The opaque handle returned by tugbank_open() must eventually be passed to
/// tugbank_close() to avoid a memory leak.

#ifndef TUGBANK_FFI_H
#define TUGBANK_FFI_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/// Open a TugbankClient backed by the SQLite database at `path`.
///
/// Returns an opaque handle on success, or NULL if `path` is NULL, not valid
/// UTF-8, or the database cannot be opened.  The handle must be closed with
/// tugbank_close() when no longer needed.
void *tugbank_open(const char *path);

/// Retrieve a value from the store as a JSON-encoded C string.
///
/// The returned string has the form {"type": "<kind>", "value": <payload>}.
/// Returns NULL if the handle, domain, or key is NULL, or if the key does not
/// exist.  The caller must free the returned string with tugbank_free_string().
char *tugbank_get(void *handle, const char *domain, const char *key);

/// Write a value to the store.
///
/// `value_json` must be a JSON-encoded value string (e.g. "42", "\"hello\"",
/// "true", "null").  Returns 0 on success and -1 on any error.
int tugbank_set(void *handle, const char *domain, const char *key, const char *value_json);

/// Return the current PRAGMA data_version for the underlying database.
///
/// Returns 0 on error or if `handle` is NULL.
uint64_t tugbank_data_version(void *handle);

/// Return all key-value pairs for `domain` as a JSON-encoded C string.
///
/// The returned string is a JSON object mapping key names to tagged value
/// objects (same format as tugbank_get).  Returns NULL on error.  The caller
/// must free the returned string with tugbank_free_string().
char *tugbank_read_domain(void *handle, const char *domain);

/// Return the list of all domain names as a JSON-encoded C string.
///
/// The returned string is a JSON array of domain name strings.  Returns NULL
/// on error.  The caller must free the returned string with
/// tugbank_free_string().
char *tugbank_list_domains(void *handle);

/// Close the client and free all associated resources.
///
/// After this call the handle is invalid and must not be used again.  Passing
/// NULL is safe and is a no-op.
void tugbank_close(void *handle);

/// Free a C string that was returned by this library.
///
/// Passing NULL is safe and is a no-op.  Do not call this function with
/// pointers that were not returned by this library.
void tugbank_free_string(char *ptr);

#ifdef __cplusplus
}
#endif

#endif /* TUGBANK_FFI_H */
