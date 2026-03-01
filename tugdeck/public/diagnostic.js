// Diagnostic error display — catches uncaught errors and shows them visually.
// Loaded as a classic (non-module) script so it runs before any module code.
// Remove this file once rendering is fixed.
(function() {
  function showError(msg) {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;padding:12px 16px;background:#dc2626;color:white;font:13px/1.4 monospace;z-index:99999;white-space:pre-wrap;max-height:50vh;overflow:auto';
    el.textContent = msg;
    document.body.appendChild(el);
  }
  window.addEventListener('error', function(e) {
    showError('JS Error: ' + e.message + '\n' + (e.filename || '') + ':' + (e.lineno || '') + ':' + (e.colno || ''));
  });
  window.addEventListener('unhandledrejection', function(e) {
    showError('Unhandled Promise: ' + (e.reason && e.reason.stack ? e.reason.stack : e.reason));
  });
})();
