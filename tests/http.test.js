import { test } from "node:test";
import assert from "node:assert/strict";
import { sendError, startSSE, sseFrame, sseSend, sseDone } from "../api/_lib/http.js";

function mockRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    writes: [],
    ended: false,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    write(chunk) { this.writes.push(chunk); },
    end() { this.ended = true; },
  };
}

test("sendError sets status and JSON error body", () => {
  const res = mockRes();
  sendError(res, 429, "slow down");
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { error: "slow down" });
});

test("startSSE sets streaming headers", () => {
  const res = mockRes();
  startSSE(res);
  assert.equal(res.headers["Content-Type"], "text/event-stream; charset=utf-8");
  assert.equal(res.headers["Cache-Control"], "no-cache, no-transform");
});

test("sseFrame JSON-encodes objects and passes strings through", () => {
  assert.equal(sseFrame({ text: "hi" }), 'data: {"text":"hi"}\n\n');
  assert.equal(sseFrame("[DONE]"), "data: [DONE]\n\n");
});

test("sseSend writes one framed event", () => {
  const res = mockRes();
  sseSend(res, { text: "yo" });
  assert.deepEqual(res.writes, ['data: {"text":"yo"}\n\n']);
});

test("sseDone emits the [DONE] sentinel and closes the stream", () => {
  const res = mockRes();
  sseDone(res);
  assert.deepEqual(res.writes, ["data: [DONE]\n\n"]);
  assert.equal(res.ended, true);
});
