/**
 * Typed error thrown by service layer functions.
 * Controllers catch this and map it to the correct HTTP status + response format.
 * Any unrecognised error that reaches a controller should be treated as 500.
 */
export class ServiceError extends Error {
  /**
   * @param {string} message      - Human-readable message forwarded to the client
   * @param {string} code         - Machine-readable code (e.g. 'COUPON_EXHAUSTED')
   * @param {number} statusCode   - HTTP status the controller should return (default 400)
   * @param {Array|null} details  - Optional structured details (field-level validation errors)
   */
  constructor(message, code = 'SERVICE_ERROR', statusCode = 400, details = null) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}
