import { ZodError, type ZodSchema } from "zod";
import type { ApiErrorDetail } from "@/lib/api/errors";

export type ParseJsonResult =
  | { success: true; data: unknown }
  | { success: false; details: ApiErrorDetail[] };

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; details: ApiErrorDetail[] };

// Bounds what one request can make the server buffer and echo back.
const maxJsonBodyBytes = 100_000;
const maxErrorDetails = 20;

export class RequestBodyTooLargeError extends Error {}

function zodErrorDetails(error: ZodError): ApiErrorDetail[] {
  return error.issues.slice(0, maxErrorDetails).map((issue) => ({
    path: issue.path.map((pathPart) => String(pathPart)),
    message: issue.message
  }));
}

// Reads at most maxBytes, stopping before buffering the rest.
async function readBody(request: Request, maxBytes: number) {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw new RequestBodyTooLargeError();
  let length = 0;
  const chunks: Uint8Array[] = [];
  if (request.body) {
    const reader = request.body.getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > maxBytes) {
          // Not awaited: on a clone, cancel only settles once the other branch is cancelled too.
          void reader.cancel().catch(() => undefined);
          throw new RequestBodyTooLargeError();
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// Bad JSON throws SyntaxError.
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  return JSON.parse(await readBody(request, maxBytes));
}

// For routes that need the body as text. Null when it's larger than maxBytes.
export function readBodyUpTo(request: Request, maxBytes: number): Promise<string | null> {
  return readBody(request, maxBytes).catch((error) => {
    if (error instanceof RequestBodyTooLargeError) return null;
    throw error;
  });
}

export async function parseJsonBody(request: Request): Promise<ParseJsonResult> {
  try {
    return { success: true, data: await readJsonBody(request, maxJsonBodyBytes) };
  } catch (error) {
    return {
      success: false,
      details: [{ message: error instanceof RequestBodyTooLargeError ? "Request body is too large" : "Request body must be valid JSON" }]
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
