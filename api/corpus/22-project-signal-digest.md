## Project: AI Signal Digest

A weekly go-to-market enablement pipeline that synthesizes AI and competitive
market signal into a digest sales reps can act on — helping them proactively
steer conversations toward AI cost allocation.

Key engineering decisions:

- Built multi-source ingestion across multiple external news feeds, customer
  call transcripts, and internal Slack, with a defined spec for signal versus
  noise (competitor changelogs, AI provider releases, customer pain points).
- Version-controlled prompts and saved fixtures for regression testing, so
  output quality doesn't drift as the pipeline grows.
- Ran the full pipeline through the Claude CLI with no API key required.
