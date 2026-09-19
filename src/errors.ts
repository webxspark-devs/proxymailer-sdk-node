export class ProxyMailerError extends Error {
  readonly statusCode: number;
  readonly context: Record<string, unknown>;

  constructor(
    message: string,
    statusCode = 0,
    context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ProxyMailerError";
    this.statusCode = statusCode;
    this.context = context;
  }
}

export class AuthenticationError extends ProxyMailerError {
  constructor(message: string, statusCode = 401, context: Record<string, unknown> = {}) {
    super(message, statusCode, context);
    this.name = "AuthenticationError";
  }
}

export class ValidationError extends ProxyMailerError {
  readonly errors: Record<string, string[]>;

  constructor(
    message: string,
    errors: Record<string, string[]> = {},
    statusCode = 422,
  ) {
    super(message, statusCode, { errors });
    this.name = "ValidationError";
    this.errors = errors;
  }
}

export class RateLimitError extends ProxyMailerError {
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    retryAfterSeconds: number | null = null,
    statusCode = 429,
  ) {
    super(message, statusCode, { retry_after: retryAfterSeconds });
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ApiError extends ProxyMailerError {
  constructor(message: string, statusCode = 0, context: Record<string, unknown> = {}) {
    super(message, statusCode, context);
    this.name = "ApiError";
  }
}
