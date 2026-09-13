/**
 * Audit Auth Preload Helper
 * Secara otomatis menyuntikkan signed HMAC-SHA256 session token yang sah dari AuthManager
 * ke seluruh outbound HTTP/Fetch request pengujian audit lokal ke port 3000.
 *
 * Ini menjamin pengujian end-to-end berjalan mulus tanpa melonggarkan
 * sedikitpun pertahanan gerbang keamanan server.
 */

const http = require('http');
const https = require('https');
const authManager = require('../security/auth-manager');

// Buat session token yang valid dari AuthManager
const sessionObj = authManager.createSession('127.0.0.1', 'AuditRunner/1.0', true);
const auditSessionToken = sessionObj.token;

// 1. Intercept global.fetch
if (typeof global.fetch === 'function') {
  const originalFetch = global.fetch;
  global.fetch = function (url, options = {}) {
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (urlStr.includes('localhost:3000') || urlStr.includes('127.0.0.1:3000') || urlStr.startsWith('/api')) {
      const opts = { ...options };
      opts.headers = { ...(opts.headers || {}) };
      // Hanya inject jika belum ada Authorization
      if (!opts.headers['Authorization'] && !opts.headers['authorization']) {
        opts.headers['Authorization'] = `Bearer ${auditSessionToken}`;
      }
      return originalFetch.call(this, url, opts);
    }
    return originalFetch.call(this, url, options);
  };
}

// 2. Intercept http.request
const originalHttpRequest = http.request;
http.request = function (arg1, arg2, arg3) {
  let options = {};
  let callback = null;

  if (typeof arg1 === 'string' || arg1 instanceof URL) {
    // http.request(url[, options][, callback])
    if (typeof arg2 === 'function') {
      callback = arg2;
      options = {};
    } else {
      options = { ...(arg2 || {}) };
      callback = arg3;
    }
    const urlObj = typeof arg1 === 'string' ? new URL(arg1) : arg1;
    if (urlObj.port === '3000' || urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1') {
      options.headers = { ...(options.headers || {}) };
      if (!options.headers['Authorization'] && !options.headers['authorization']) {
        options.headers['Authorization'] = `Bearer ${auditSessionToken}`;
      }
    }
    return originalHttpRequest.call(http, arg1, options, callback);
  } else {
    // http.request(options[, callback])
    options = { ...(arg1 || {}) };
    callback = arg2;
    const isTarget = options.port === 3000 || options.port === '3000' ||
                     options.hostname === 'localhost' || options.hostname === '127.0.0.1' ||
                     options.host === 'localhost:3000' || options.host === '127.0.0.1:3000';
    if (isTarget) {
      options.headers = { ...(options.headers || {}) };
      if (!options.headers['Authorization'] && !options.headers['authorization']) {
        options.headers['Authorization'] = `Bearer ${auditSessionToken}`;
      }
    }
    return originalHttpRequest.call(http, options, callback);
  }
};

module.exports = { auditSessionToken };
