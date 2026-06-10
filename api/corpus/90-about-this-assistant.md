## About This Assistant

This assistant is itself one of Griffin's projects. How it works, for the
technically curious:

- A single Vercel serverless function calls Claude (claude-sonnet-4-6) with
  this entire corpus — a folder of markdown files — sent as a cached system
  prompt on every question. Conversations live in the visitor's browser tab;
  the server stores nothing.
- There is deliberately no RAG, no vector database, and no routing layer. The
  corpus is a few thousand tokens today — well under 1% of the model's
  context window, with room to grow a hundredfold — and prompt caching makes
  re-reading all of it cost well under a cent per question. A retrieval or routing layer would add latency, cost, and the
  one failure mode this assistant is designed against: answering without
  having seen the relevant section. Retrieval earns its place when a corpus
  reaches hundreds of thousands of tokens or context is a scarce shared
  resource (as in coding-agent sessions, where Griffin's CostFormation Brain
  uses an index-and-route design for exactly that reason). Neither applies
  here.
- The grounding rules: cite the section an answer comes from, say plainly when
  something isn't covered, and never improvise. A smoke-test script probes
  these behaviors after every corpus change.
