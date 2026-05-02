export function jsonRequest(url: string, body?: unknown, init: RequestInit = {}) {
  return new Request(url, {
    method: body === undefined ? init.method ?? "GET" : init.method ?? "POST",
    ...init,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(init.headers ?? {})
    },
    body: body === undefined ? init.body : JSON.stringify(body)
  });
}

export async function parseJsonResponse(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export function routeContext<T extends Record<string, string>>(params: T) {
  return {
    params: Promise.resolve(params)
  };
}
