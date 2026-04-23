export type ApiErrorPayload = {
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
  const response = await fetch(url, init);
  const data = await parseJsonSafely(response);

  if (!response.ok) {
    const payload = data && typeof data === "object" ? (data as ApiErrorPayload) : null;
    throw new ClientApiError(
      payload?.error?.message ?? "Request failed. Please try again.",
      response.status,
      payload
    );
  }

  return data as T;
}
