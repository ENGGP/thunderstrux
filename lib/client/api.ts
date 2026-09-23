export type ApiErrorPayload = {
  state?: string;
  message?: string;
  actionRequired?: string;
  actionUrl?: string;
  error?: {
    code?: string;
    message?: string;
    details?: Array<{
      path?: string[];
      message: string;
    }>;
  };
};

export class ClientApiError extends Error {
  status: number;
  payload: ApiErrorPayload | null;

  constructor(message: string, status: number, payload: ApiErrorPayload | null) {
    super(message);
    this.name = "ClientApiError";
    this.status = status;
    this.payload = payload;
  }
}

function isSafeServerMessage(message: string) {
  const trimmed = message.trim();

  return (
    trimmed.length > 0 &&
    trimmed.length <= 200 &&
    !/internal server error/i.test(trimmed)
  );
}

export function getClientErrorMessage(
  error: unknown,
  fallback: string,
  overrides: Record<string, string> = {}
) {
  if (error instanceof ClientApiError) {
    const serverMessage =
      error.payload?.error?.details?.[0]?.message ??
      error.payload?.error?.message ??
      error.payload?.message ??
      error.message;

    if (serverMessage && overrides[serverMessage]) {
      return overrides[serverMessage];
    }

    if (serverMessage && isSafeServerMessage(serverMessage)) {
      return serverMessage;
    }

    return fallback;
  }

  if (error instanceof TypeError) {
    return "Network error. Check your connection and try again.";
  }

  if (error instanceof Error && isSafeServerMessage(error.message)) {
    return error.message;
  }

  return fallback;
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function fetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetchWithCsrf(url, init);
  const data = await parseJsonSafely(response);

  if (!response.ok) {
    const payload = data && typeof data === "object" ? (data as ApiErrorPayload) : null;
    throw new ClientApiError(
      payload?.error?.message ??
        payload?.message ??
        "Request failed. Please try again.",
      response.status,
      payload
    );
  }

  return data as T;
}

export async function fetchWithCsrf(url: string, init?: RequestInit) {
  const method = (init?.method ?? "GET").toUpperCase();
  if (!["POST", "PATCH", "DELETE", "PUT"].includes(method) || url === "/api/auth/signup") {
    return fetch(url, init);
  }
  async function attempt() {
    const csrfResponse = await fetch("/api/security/csrf", {
      credentials: "same-origin",
      cache: "no-store"
    });
    if (!csrfResponse.ok) return csrfResponse;
    const payload = (await csrfResponse.json()) as { token: string };
    const headers = new Headers(init?.headers);
    headers.set("x-thunderstrux-csrf-token", payload.token);
    return fetch(url, { ...init, headers, credentials: "same-origin" });
  }

  const response = await attempt();
  if (response.status !== 403 || init?.body instanceof ReadableStream) return response;
  const error = await response.clone().json().catch(() => null) as ApiErrorPayload | null;
  // Auth.js can rotate its cookie between token retrieval and the mutation.
  // The guard rejects before route execution; retry once only for that exact error.
  if (error?.error?.code !== "FORBIDDEN" || error.error.message !== "Invalid CSRF token") {
    return response;
  }
  return attempt();
}
