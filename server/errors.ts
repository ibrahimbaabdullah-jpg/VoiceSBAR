import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** An error that is safe to show to the user. Anything else becomes a generic 500. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(
    status: ContentfulStatusCode,
    code: string,
    message: string,
    opts: { retryable?: boolean; details?: unknown; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.details = opts.details;
    this.headers = opts.headers;
  }

  toBody() {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export const unauthorized = () =>
  new ApiError(401, 'unauthorized', 'Please sign in to continue.');

export const forbidden = (message = 'You do not have permission to do that.') =>
  new ApiError(403, 'forbidden', message);

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'invalid_request', message, { details });

export const tooManyRequests = (retryAfterSeconds: number, message?: string) =>
  new ApiError(
    429,
    'rate_limited',
    message ?? `Too many requests. Please wait ${retryAfterSeconds} seconds and try again.`,
    { retryable: true, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
