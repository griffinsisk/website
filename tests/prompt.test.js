import { test } from "node:test";
import assert from "node:assert/strict";
import { BEHAVIOR_PROMPT } from "../api/_lib/prompt.js";

test("exports a non-empty string", () => {
  assert.equal(typeof BEHAVIOR_PROMPT, "string");
  assert.ok(BEHAVIOR_PROMPT.length > 0);
});

test("stays byte-stable (no interpolated dates/ids/per-request values)", () => {
  // The cache prefix depends on this being constant across requests, so it must
  // not contain template placeholders or interpolated values.
  assert.ok(!BEHAVIOR_PROMPT.includes("${"), "must not interpolate values");
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(BEHAVIOR_PROMPT), "must not embed a date");
});

test("identifies the assistant and speaks about Griffin in the third person", () => {
  assert.match(BEHAVIOR_PROMPT, /griffinsisk\.com/);
  assert.match(BEHAVIOR_PROMPT, /third person/i);
  assert.match(BEHAVIOR_PROMPT, /You are not Griffin/);
});

test("states the corpus-grounding contract", () => {
  assert.match(BEHAVIOR_PROMPT, /ONLY the reference corpus/);
  assert.match(BEHAVIOR_PROMPT, /Every factual claim must come from the corpus/);
  assert.match(BEHAVIOR_PROMPT, /griffinjsisk@gmail\.com/);
});

test("ends by handing off to the corpus so it can be concatenated", () => {
  assert.match(BEHAVIOR_PROMPT, /The reference corpus follows\.$/);
});
