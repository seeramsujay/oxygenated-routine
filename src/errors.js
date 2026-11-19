/** Error that is safe to show to API clients (status + stable code + message). */
export class AppError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code machine-readable code
   * @param {string} message human-readable, safe to expose
   * @param {unknown} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(400, 'bad_request', message, details);
export const notFound = (message) => new AppError(404, 'not_found', message);
export const upstream = (message) => new AppError(502, 'upstream_error', message);
