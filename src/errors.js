/**
 * @fileoverview Application error types and structured response factories.
 *
 * Provides safe, machine-readable HTTP error envelopes. Ensures stack traces and
 * sensitive internal diagnostics are never leaked to external API consumers.
 */

/**
 * Standard structured error safe for serializing to API clients.
 */
export class AppError extends Error {
  /**
   * @param {number} status - HTTP status code (e.g. 400, 404, 413, 415, 429, 502).
   * @param {string} code - Machine-readable snake_case error code.
   * @param {string} message - Human-readable, user-friendly explanation.
   * @param {unknown} [details] - Optional structured validation field details.
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Creates a 400 Bad Request error. */
export const badRequest = (message, details) => new AppError(400, 'bad_request', message, details);

/** Creates a 404 Not Found error. */
export const notFound = (message) => new AppError(404, 'not_found', message);

/** Creates a 502 Bad Gateway upstream service error. */
export const upstream = (message) => new AppError(502, 'upstream_error', message);
