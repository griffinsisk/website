import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMessages, MAX_MESSAGE_CHARS, MAX_TURNS, MAX_TOTAL_CHARS } from "../api/_lib/validate.js";

test("accepts a single user message", () => {
  assert.equal(validateMessages([{ role: "user", content: "What has Griffin built?" }]).ok, true);
});

test("accepts alternating user/assistant history ending with user", () => {
  const messages = [
    { role: "user", content: "Hi" },
    { role: "assistant", content: "Hello!" },
    { role: "user", content: "Tell me about CostFormation Brain" },
  ];
  assert.equal(validateMessages(messages).ok, true);
});

test("rejects non-array and empty input", () => {
  assert.equal(validateMessages(undefined).ok, false);
  assert.equal(validateMessages("hi").ok, false);
  assert.equal(validateMessages([]).ok, false);
});

test("rejects when roles do not alternate starting with user", () => {
  assert.equal(validateMessages([{ role: "assistant", content: "Hi" }]).ok, false);
  assert.equal(
    validateMessages([
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ]).ok,
    false,
  );
});

test("rejects when last message is not from the user", () => {
  const messages = [
    { role: "user", content: "a" },
    { role: "assistant", content: "b" },
  ];
  assert.equal(validateMessages(messages).ok, false);
});

test("rejects non-string or blank content", () => {
  assert.equal(validateMessages([{ role: "user", content: 42 }]).ok, false);
  assert.equal(validateMessages([{ role: "user", content: "   " }]).ok, false);
});

test("rejects a latest message over MAX_MESSAGE_CHARS", () => {
  const messages = [{ role: "user", content: "x".repeat(MAX_MESSAGE_CHARS + 1) }];
  assert.equal(validateMessages(messages).ok, false);
});

test("rejects a conversation over MAX_TURNS messages", () => {
  const messages = [];
  for (let i = 0; i < MAX_TURNS + 1; i++) {
    messages.push({ role: i % 2 === 0 ? "user" : "assistant", content: "m" });
  }
  assert.equal(validateMessages(messages).ok, false);
});

test("rejects a conversation over MAX_TOTAL_CHARS total characters", () => {
  const big = "x".repeat(MAX_TOTAL_CHARS - 100);
  const messages = [
    { role: "user", content: "start" },
    { role: "assistant", content: big },
    { role: "user", content: "x".repeat(200) },
  ];
  assert.equal(validateMessages(messages).ok, false);
});
