import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
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

export function internalError() {
  return apiError("INTERNAL_ERROR", "Internal server error", 500);
}

export function serviceUnavailable(message: string) {
  return apiError("SERVICE_UNAVAILABLE", message, 503);
}
