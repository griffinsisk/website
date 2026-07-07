// Shared HTTP + Server-Sent-Events helpers for the API routes. Keeping the
// wire format in one place means the SSE framing (`data: …\n\n`, the `[DONE]`
// sentinel) is defined once and matches what the browser client parses.

// Send a JSON error body with the given status code.
export function sendError(res, status, error) {
  res.status(status).json({ error });
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
};

// Set the headers that turn a response into an SSE stream.
export function startSSE(res) {
  for (const [name, value] of Object.entries(SSE_HEADERS)) res.setHeader(name, value);
}

// Serialize one SSE `data:` frame. Strings are sent verbatim (for sentinels
// like `[DONE]`); everything else is JSON-encoded.
export function sseFrame(payload) {
  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  return `data: ${data}\n\n`;
}

// Write a single SSE event to the stream.
export function sseSend(res, payload) {
  res.write(sseFrame(payload));
}

// Emit the terminal `[DONE]` sentinel and close the stream.
export function sseDone(res) {
  res.write(sseFrame("[DONE]"));
  res.end();
}
