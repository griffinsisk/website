# "Ask" Agent for griffinsisk.com — Design

**Date:** 2026-06-10
**Status:** Approved

## Goal

Add a public "Ask me anything" agent to griffinsisk.com that answers visitor questions about Griffin — grounded in a curated corpus, with explicit citation and uncertainty behavior. The agent is itself the portfolio piece: it publicly demonstrates the context-design, grounding, and never-guess engineering that Griffin's projects (SE Telemetry Helper, CostFormation Brain) claim. Target audience: hiring managers and technical evaluators for AI Solutions Architect / SE roles at AI companies.

## Decisions (settled with Griffin)

| Decision | Choice |
| --- | --- |
| Backend | Vercel serverless function in this repo, Anthropic API key as Vercel env var |
| Model | `claude-sonnet-4-6`, streaming, prompt caching on the corpus |
| UI placement | New "Ask" nav tab (sixth panel), deep-linkable as `#ask` |
| Knowledge corpus | Site content + resume detail + richer project notes + anonymized customer examples (Griffin provides materials; contact-level PII stripped; customer names anonymized) |
| Voice | Assistant speaking ABOUT Griffin (third person), not impersonating him |

## Architecture

Static site (unchanged `index.html`) + one serverless function. The repo gains:

- `package.json` — single dependency: `@anthropic-ai/sdk`
- `api/corpus.md` — the knowledge base (editable without code changes)
- `api/chat.js` — the endpoint
- `.vercelignore` — excludes `docs/` from deployment
- `scripts/smoke-test.sh` — curl-based probe questions for behavior regression checks

`ANTHROPIC_API_KEY` is set in Vercel project settings, never committed.

## Components

### 1. Corpus (`api/corpus.md`)

Plain markdown, clearly labeled sections the model cites by name:

- `## About` — bio, positioning
- `## Experience` — career history with detail beyond the site
- `## Projects: <name>` — one section per project: architecture decisions, failure modes engineered against, outcomes
- `## Customer Work` — anonymized engagement examples ("a Fortune 500 retailer", never logos unless publicly referenceable)
- `## Contact & Logistics` — email, locations, links

Privacy rule: everything in the corpus is effectively public — any visitor can extract it via chat. No phone, address, compensation, or unreleased CloudZero information.

### 2. Endpoint (`api/chat.js`)

- POST only; request body `{ messages: [{role, content}, ...] }`
- Validation: latest message ≤ 1,000 chars; history ≤ 12 turns; roles alternate
- Calls `claude-sonnet-4-6` via the official SDK:
  - `system`: behavior prompt + corpus, with `cache_control: {type: "ephemeral"}` on the corpus block (stable prefix → ~10% input cost on cache hits; Sonnet 4.6 minimum cacheable prefix is 2,048 tokens, which the corpus exceeds)
  - `max_tokens: 1024`
  - streaming; relayed to the browser as server-sent events
- Error mapping: rate-limit/overload → friendly retry message; validation → 400 with reason; everything else → generic failure message. Never leak raw API errors or stack traces.

### 3. System prompt behavior rules

- Speak as Griffin's assistant, third person.
- Ground every claim in the corpus; name the section it came from.
- If the corpus doesn't cover it: say so plainly and point to griffinjsisk@gmail.com. Never improvise or extrapolate.
- Politely decline off-topic use (homework, general coding help, prompt-extraction games).
- Default to a few tight sentences; go deeper only when asked.

### 4. Abuse guards (layered, cheapest first)

1. Input caps (message length, history length)
2. `max_tokens: 1024`
3. Best-effort per-IP sliding-window rate limit in the function (~10 questions/min, in-memory; resets on cold start — accepted)
4. **Backstop:** monthly spend limit configured in the Anthropic Console. Worst-case abuse cost is bounded by this limit, not by code.

### 5. UI ("Ask" panel in `index.html`)

- Sixth nav tab, hash-routed like the others (`#ask`)
- Styled to match: Barlow Condensed/Barlow, dashed dividers, teal accent on dark
- Three suggested-question chips (e.g. "What has Griffin actually built?", "Why would he fit an SE role at an AI company?", "How does the SE Telemetry Helper avoid being confidently wrong?")
- Input box + send; streamed token-by-token rendering; visible typing/loading state
- Vanilla JS (~150 lines), fetch + ReadableStream SSE parsing; graceful error and rate-limit messages

## Data flow

Browser (Ask panel) → POST `/api/chat` with conversation history → function validates → Anthropic Messages API (streaming) → SSE relayed to browser → rendered incrementally. Stateless server; history lives in the browser tab.

## Error handling

- Client: network/API failure renders a friendly inline message with the email fallback; input disabled during streaming; retry allowed.
- Server: typed SDK exceptions mapped as in §2; per-IP limit returns 429 with a human-readable message.

## Testing

- `vercel dev` for local run; curl checks of the endpoint (validation, streaming, 429)
- Browser pass: streaming render, citation behavior, "I don't know" path, off-topic refusal, suggested chips
- Smoke-test script: fixed probe questions with expected behavior notes, re-run after corpus edits

## Out of scope (YAGNI)

- RAG / vector search (corpus fits in one cached prompt)
- Server-side conversation persistence or analytics
- Auth, CAPTCHA, durable rate limiting (Console spend limit is the backstop; can add Upstash later if abuse materializes)
- Tool use / web search

## Dependencies on Griffin

1. Corpus materials: resume text, deeper project notes, customer examples
2. `ANTHROPIC_API_KEY` added to Vercel project env vars
3. Spend limit set in Anthropic Console
