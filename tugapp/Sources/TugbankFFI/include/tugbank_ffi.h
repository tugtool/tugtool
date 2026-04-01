#ifndef TUGBANK_FFI_H
#define TUGBANK_FFI_H

#include <stdint.h>

/// Open a TugbankClient backed by the SQLite database at `path`.
/// Returns an opaque handle, or NULL on error.
/// The caller must eventually call tugbank_close() to free the handle.
void *tugbank_open(const char *path);

/// Retrieve a value as a JSON-encoded C string: {"type":"...","value":...}
/// Returns NULL if the key does not exist or on error.
/// The caller must free the returned string with tugbank_free_string().
char *tugbank_get(void *handle, const char *domain, const char *key);

/// Write a value. value_json is a plain JSON literal (e.g. "\"hello\"", "true", "42").
/// Returns 0 on success, -1 on error.
int32_t tugbank_set(void *handle, const char *domain, const char *key, const char *value_json);

/// Return the current PRAGMA data_version. Returns 0 on error.
uint64_t tugbank_data_version(void *handle);

/// Read all entries for a domain as a JSON object: {"key":{"type":"...","value":...},...}
/// Returns NULL on error. Caller must free with tugbank_free_string().
char *tugbank_read_domain(void *handle, const char *domain);

/// List all domains as a JSON array: ["domain1","domain2",...]
/// Returns NULL on error. Caller must free with tugbank_free_string().
char *tugbank_list_domains(void *handle);

/// Close the handle and free all resources. Safe to call with NULL.
void tugbank_close(void *handle);

/// Free a string returned by tugbank_get, tugbank_read_domain, or tugbank_list_domains.
/// Safe to call with NULL.
void tugbank_free_string(char *ptr);

#endif /* TUGBANK_FFI_H */
