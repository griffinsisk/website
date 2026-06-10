import { test } from "node:test";
import assert from "node:assert/strict";
import { isRateLimited, MAX_REQUESTS, WINDOW_MS } from "../api/_lib/ratelimit.js";

test("allows up to MAX_REQUESTS in a window, then limits", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < MAX_REQUESTS; i++) {
    assert.equal(isRateLimited("1.2.3.4", t0 + i), false, `request ${i + 1} should pass`);
  }
  assert.equal(isRateLimited("1.2.3.4", t0 + MAX_REQUESTS), true, "next request should be limited");
});

test("window slides: old hits expire", () => {
  const t0 = 2_000_000;
  for (let i = 0; i < MAX_REQUESTS; i++) isRateLimited("5.6.7.8", t0 + i);
  assert.equal(isRateLimited("5.6.7.8", t0 + WINDOW_MS + 1000), false);
});

test("IPs are tracked independently", () => {
  const t0 = 3_000_000;
  for (let i = 0; i < MAX_REQUESTS; i++) isRateLimited("9.9.9.9", t0 + i);
  assert.equal(isRateLimited("8.8.8.8", t0 + MAX_REQUESTS), false);
});
