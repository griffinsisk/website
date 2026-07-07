import { test } from "node:test";
import assert from "node:assert/strict";

// The handler constructs an Anthropic client at import time, which requires a
// key to be present in the environment. Set a dummy one before importing.
process.env.ANTHROPIC_API_KEY ??= "test-key-not-used";

const { default: handler } = await import("../api/chat.js");
const { MAX_REQUESTS } = await import("../api/_lib/ratelimit.js");
const { isRateLimited } = await import("../api/_lib/ratelimit.js");

// Minimal req/res doubles. The guard paths below never reach the network, so
// no Anthropic call is made.
function makeReq({ method = "POST", ip = "0.0.0.0", body } = {}) {
  return { method, headers: { "x-forwarded-for": ip }, body };
}

function makeRes() {
  const res = {
    statusCode: undefined,
    jsonBody: undefined,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.jsonBody = obj;
      return this;
    },
  };
  return res;
}

test("rejects non-POST methods with 405", async () => {
  const res = makeRes();
  await handler(makeReq({ method: "GET", ip: "10.0.0.1" }), res);
  assert.equal(res.statusCode, 405);
  assert.match(res.jsonBody.error, /Method not allowed/);
});

test("rejects requests once the IP is rate limited with 429", async () => {
  const ip = "203.0.113.7";
  for (let i = 0; i < MAX_REQUESTS; i++) isRateLimited(ip);
  const res = makeRes();
  await handler(makeReq({ ip, body: { messages: [{ role: "user", content: "hi" }] } }), res);
  assert.equal(res.statusCode, 429);
  assert.match(res.jsonBody.error, /Too many questions/);
});

test("rejects an invalid messages payload with 400", async () => {
  const res = makeRes();
  await handler(makeReq({ ip: "10.0.0.2", body: { messages: [] } }), res);
  assert.equal(res.statusCode, 400);
  assert.ok(typeof res.jsonBody.error === "string" && res.jsonBody.error.length > 0);
});

test("returns 400 with the validator's message when the body is missing", async () => {
  const res = makeRes();
  await handler(makeReq({ ip: "10.0.0.3", body: undefined }), res);
  assert.equal(res.statusCode, 400);
});

test("defaults a missing x-forwarded-for to a single 'unknown' bucket", async () => {
  // No IP header: handler falls back to "unknown". Exhaust that bucket, then a
  // further request must be rate limited, proving the fallback path is used.
  for (let i = 0; i < MAX_REQUESTS; i++) isRateLimited("unknown");
  const res = makeRes();
  const req = { method: "POST", headers: {}, body: { messages: [{ role: "user", content: "hi" }] } };
  await handler(req, res);
  assert.equal(res.statusCode, 429);
});
