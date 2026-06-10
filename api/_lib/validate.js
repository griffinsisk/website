export const MAX_MESSAGE_CHARS = 1000;
export const MAX_TURNS = 12;
export const MAX_TOTAL_CHARS = 8000;

// Returns { ok: true } or { ok: false, error: "human-readable reason" }.
export function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: "Send a messages array with at least one message." };
  }
  if (messages.length > MAX_TURNS) {
    return { ok: false, error: `Conversation is too long (max ${MAX_TURNS} messages) — refresh to start over.` };
  }
  let total = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || typeof m.content !== "string" || m.content.trim() === "") {
      return { ok: false, error: `Message ${i} must have non-empty string content.` };
    }
    if (m.role !== (i % 2 === 0 ? "user" : "assistant")) {
      return { ok: false, error: "Roles must alternate user/assistant, starting with user." };
    }
    total += m.content.length;
  }
  if (messages[messages.length - 1].role !== "user") {
    return { ok: false, error: "The last message must be from the user." };
  }
  // Only the LATEST message gets the per-message cap: assistant turns in valid
  // histories run up to ~4K chars (1024 tokens); abuse is bounded by MAX_TOTAL_CHARS.
  if (messages[messages.length - 1].content.length > MAX_MESSAGE_CHARS) {
    return { ok: false, error: `That question is too long (max ${MAX_MESSAGE_CHARS} characters).` };
  }
  if (total > MAX_TOTAL_CHARS) {
    return { ok: false, error: "This conversation has gotten too large — refresh to start over." };
  }
  return { ok: true };
}
