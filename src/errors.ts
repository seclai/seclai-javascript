/** Base error class for the Seclai SDK. */
export class SeclaiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeclaiError";
  }
}

/** Thrown when the SDK is misconfigured (for example, missing API key). */
export class SeclaiConfigurationError extends SeclaiError {
  constructor(message: string) {
    super(message);
    this.name = "SeclaiConfigurationError";
  }
}

/**
 * Thrown when the API returns a non-success status code.
 *
 * @remarks
 * Use {@link SeclaiAPIValidationError} for HTTP 422 validation errors.
 */
export class SeclaiAPIStatusError extends SeclaiError {
  /** HTTP status code returned by the API. */
  public readonly statusCode: number;
  /** HTTP method used for the request. */
  public readonly method: string;
  /** Full request URL. */
  public readonly url: string;
  /** Best-effort response body text (if available). */
  public readonly responseText: string | undefined;

  constructor(opts: {
    /** Human-readable error message. */
    message: string;
    statusCode: number;
    method: string;
    url: string;
    responseText: string | undefined;
  }) {
    super(opts.message);
    this.name = "SeclaiAPIStatusError";
    this.statusCode = opts.statusCode;
    this.method = opts.method;
    this.url = opts.url;
    this.responseText = opts.responseText;
  }
}

/**
 * Thrown when the API returns a validation error response (typically HTTP 422).
 *
 * The `validationError` field contains the decoded validation payload when available.
 */
export class SeclaiAPIValidationError extends SeclaiAPIStatusError {
  /** Parsed validation error payload (best-effort). */
  public readonly validationError: unknown;

  constructor(opts: {
    message: string;
    statusCode: number;
    method: string;
    url: string;
    responseText: string | undefined;
    validationError: unknown;
  }) {
    super(opts);
    this.name = "SeclaiAPIValidationError";
    this.validationError = opts.validationError;
  }
}
