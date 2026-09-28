import { NextResponse } from "next/server";
import { logError } from "@/lib/ops/logger";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";

export type ApiErrorDetail = {
  path?: Array<string | number>;
  message: string;
};

type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    details: ApiErrorDetail[];
  };
};

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  details: ApiErrorDetail[] = []
) {
  return NextResponse.json<ApiErrorBody>(
    {
      error: {
        code,
        message,
        details
      }
    },
    { status }
  );
}

export function badRequest(message: string, details: ApiErrorDetail[] = []) {
  return apiError("BAD_REQUEST", message, 400, details);
}

export function validationError(details: ApiErrorDetail[]) {
  return apiError("VALIDATION_ERROR", "Invalid request body", 400, details);
}

export function unauthorized(message = "Authentication required") {
  return apiError("UNAUTHORIZED", message, 401);
}

export function forbidden(message = "Insufficient permissions") {
  return apiError("FORBIDDEN", message, 403);
}

export function notFound(message: string) {
  return apiError("NOT_FOUND", message, 404);
}

export function conflict(message: string) {
  return apiError("CONFLICT", message, 409);
}

export function tooManyRequests(message: string) {
  return apiError("RATE_LIMITED", message, 429);
}

export function internalError() {
  return apiError("INTERNAL_ERROR", "Internal server error", 500);
}

export function serviceUnavailable(message: string) {
  return apiError("SERVICE_UNAVAILABLE", message, 503);
}

export type RouteErrorRule = {
  matches(error: unknown): boolean;
  toResponse(error: Error): NextResponse;
};

type ErrorConstructor<T extends Error> = abstract new (...args: never[]) => T;

export function routeErrorRule<T extends Error>(
  errorType: ErrorConstructor<T>,
  toResponse: (error: T) => NextResponse
): RouteErrorRule {
  return {
    matches: (error) => error instanceof errorType,
    toResponse: (error) => toResponse(error as T)
  };
}

export function mapRouteError(
  error: unknown,
  {
    operation,
    request,
    rules = []
  }: {
    operation: string;
    request: Request;
    rules?: RouteErrorRule[];
  }
) {
  const rule = rules.find((candidate) => candidate.matches(error));

  if (rule) {
    return rule.toResponse(error as Error);
  }

  logError("api.request_failed", {
    operation,
    method: request.method,
    errorName: error instanceof Error ? error.name : "UnknownError"
  });
  return internalError();
}
