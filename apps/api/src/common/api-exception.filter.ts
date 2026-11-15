import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { ApiException } from "./api-exception.js";

interface ErrorResponseBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  timestamp: string;
  path: string;
}

const codeForStatus = (status: number): string => {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return "VALIDATION_ERROR";
    case HttpStatus.UNAUTHORIZED:
      return "UNAUTHENTICATED";
    case HttpStatus.FORBIDDEN:
      return "FORBIDDEN";
    case HttpStatus.NOT_FOUND:
      return "NOT_FOUND";
    case HttpStatus.CONFLICT:
      return "CONFLICT";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "RATE_LIMITED";
    default:
      return status >= 500 ? "INTERNAL_ERROR" : "REQUEST_FAILED";
  }
};

/**
 * One response shape for every error.
 *
 * Unexpected exceptions are logged with their stack and returned as a generic
 * 500: leaking driver errors or SQL fragments to clients is an information
 * disclosure bug, and clients cannot act on them anyway.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const body = (statusCode: number): ErrorResponseBody => ({
      statusCode,
      code: codeForStatus(statusCode),
      message: "Internal server error",
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    });

    if (exception instanceof ApiException) {
      const payload = exception.getResponse() as {
        code: string;
        message: string;
        details?: unknown;
      };
      response.status(exception.getStatus()).json({
        statusCode: exception.getStatus(),
        code: payload.code,
        message: payload.message,
        ...(payload.details === undefined ? {} : { details: payload.details }),
        timestamp: new Date().toISOString(),
        path: request.originalUrl,
      } satisfies ErrorResponseBody);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      let message = exception.message;
      let details: unknown;

      if (typeof raw === "string") {
        message = raw;
      } else if (raw && typeof raw === "object") {
        const record = raw as { message?: unknown; error?: unknown };
        if (Array.isArray(record.message)) {
          message = "Validation failed";
          details = record.message;
        } else if (typeof record.message === "string") {
          message = record.message;
        } else if (typeof record.error === "string") {
          message = record.error;
        }
      }

      response.status(status).json({
        ...body(status),
        message,
        ...(details === undefined ? {} : { details }),
      });
      return;
    }

    this.logger.error(
      `Unhandled exception on ${request.method} ${request.originalUrl}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body(500));
  }
}
