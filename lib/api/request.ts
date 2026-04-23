import { ZodError, type ZodSchema } from "zod";
import type { ApiErrorDetail } from "@/lib/api/errors";

export type ParseJsonResult =
  | { success: true; data: unknown }
  | { success: false; details: ApiErrorDetail[] };

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; details: ApiErrorDetail[] };

function zodErrorDetails(error: ZodError): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((pathPart) => String(pathPart)),
    message: issue.message
  }));
}

export async function parseJsonBody(request: Request): Promise<ParseJsonResult> {
  try {
    return { success: true, data: await request.json() };
  } catch {
    return {
      success: false,
      details: [{ message: "Request body must be valid JSON" }]
    };
  }
}

export function validateInput<T>(
  input: unknown,
  schema: ZodSchema<T>
): ValidationResult<T> {
  try {
    return { success: true, data: schema.parse(input) };
  } catch (error) {
    if (error instanceof ZodError) {
      return { success: false, details: zodErrorDetails(error) };
    }

    return {
      success: false,
      details: [{ message: "Request body failed validation" }]
    };
  }
}

export async function validateJson<T>(
  request: Request,
  schema: ZodSchema<T>
): Promise<ValidationResult<T>> {
  const parsed = await parseJsonBody(request);

  if (!parsed.success) {
    return parsed;
  }

  return validateInput(parsed.data, schema);
}
