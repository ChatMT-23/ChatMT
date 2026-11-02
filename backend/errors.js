/** An error that already carries the HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(code, message, details = null) {
  return new ApiError(400, code, message, details);
}

export function notFound(code, message) {
  return new ApiError(404, code, message);
}
