import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Every expected failure carries a stable machine-readable code.
 *
 * Clients should switch on `code`, not on the human message: messages are
 * allowed to change, codes are part of the API contract. `details` is optional
 * structured context (missing permissions, conflicting field, ...).
 */
export class ApiException extends HttpException {
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: HttpStatus,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super({ statusCode: status, code, message, details }, status);
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (
  code: string,
  message: string,
  details?: unknown,
): ApiException => new ApiException(HttpStatus.BAD_REQUEST, code, message, details);

export const unauthorized = (code: string, message: string): ApiException =>
  new ApiException(HttpStatus.UNAUTHORIZED, code, message);

export const forbidden = (
  code: string,
  message: string,
  details?: unknown,
): ApiException =>
  new ApiException(HttpStatus.FORBIDDEN, code, message, details);

export const notFound = (code: string, message: string): ApiException =>
  new ApiException(HttpStatus.NOT_FOUND, code, message);

export const conflict = (code: string, message: string, details?: unknown): ApiException =>
  new ApiException(HttpStatus.CONFLICT, code, message, details);
