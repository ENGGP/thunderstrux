// Isolated Docker E2E transport. No public ports, disk storage or provider calls.
import { createServer } from "node:http";
const messages = new Map();
createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  if (request.method === "GET" && request.url === "/messages") {
    response.end(JSON.stringify([...messages.values()])); return;
  }
  if (request.method !== "POST" || request.url !== "/emails") { response.writeHead(404).end("{}"); return; }
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32000) { response.writeHead(413).end("{}"); return; }
  }
  try {
    const data = JSON.parse(body);
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || typeof data.to !== "string") throw new Error();
    const previous = messages.get(key);
    if (previous && JSON.stringify(previous.data) !== JSON.stringify(data)) { response.writeHead(409).end("{}"); return; }
    const message = previous ?? { id: `capture-${messages.size + 1}`, key, data };
    messages.set(key, message);
    response.end(JSON.stringify({ id: message.id }));
  } catch { response.writeHead(400).end("{}"); }
}).listen(8025, "0.0.0.0");
