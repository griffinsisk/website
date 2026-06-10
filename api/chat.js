import Anthropic from "@anthropic-ai/sdk";
import { validateMessages } from "./_lib/validate.js";
import { isRateLimited } from "./_lib/ratelimit.js";
import { loadCorpus } from "./_lib/corpus.js";
import { BEHAVIOR_PROMPT } from "./_lib/prompt.js";

export const config = { supportsResponseStreaming: true };

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

const CAPACITY_MSG = "The assistant is over capacity right now — try again in a minute.";
const GENERIC_MSG = "Something went wrong — try again, or email griffinjsisk@gmail.com.";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const ip = String(req.headers["x-forwarded-for"] ?? "unknown").split(",")[0].trim();
  if (isRateLimited(ip)) {
    res.status(429).json({ error: "Too many questions at once — give it a minute and try again." });
    return;
  }

  const check = validateMessages(req.body?.messages);
  if (!check.ok) {
    res.status(400).json({ error: check.error });
    return;
  }

  let corpus;
  try {
    corpus = await loadCorpus();
  } catch (err) {
    console.error("corpus load failed", err);
    res.status(500).json({ error: GENERIC_MSG });
    return;
  }

  // Strip unknown keys so client-supplied fields (e.g. cache_control) never
  // reach the API.
  const messages = req.body.messages.map((m) => ({ role: m.role, content: m.content }));

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");

  try {
    const stream = client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      system: [
        { type: "text", text: BEHAVIOR_PROMPT },
        // cache_control on the LAST system block caches the whole stable
        // prefix (behavior prompt + corpus) across requests.
        { type: "text", text: corpus, cache_control: { type: "ephemeral" } },
      ],
      messages,
    });

    // Stop paying for tokens nobody will read if the visitor disconnects.
    // (res 'close' + writableEnded guard: req 'close' fires on request-body
    // completion in modern Node, not on socket teardown.)
    res.on("close", () => {
      if (!res.writableEnded) stream.controller.abort();
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }
  } catch (err) {
    console.error("anthropic call failed", err?.status, err?.message);
    const overloaded =
      err instanceof Anthropic.APIError && (err.status === 429 || err.status === 529);
    res.write(`data: ${JSON.stringify({ error: overloaded ? CAPACITY_MSG : GENERIC_MSG })}\n\n`);
  }

  res.write("data: [DONE]\n\n");
  res.end();
}
