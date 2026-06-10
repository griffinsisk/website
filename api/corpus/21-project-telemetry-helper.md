## Project: SE AI Telemetry Helper

An internal CloudZero knowledge system that keeps a Claude Team Project
accurate enough for Sales Engineers to use on live customer calls, covering
the rapidly evolving AI Telemetry product — knowledge spread across 9+ code
repositories, Confluence, Jira, and a 104K-line Swift/Go codebase that ships
weekly.

**Problem.** Documentation goes stale the moment code ships, and "it's in the
repo somewhere" doesn't help mid-call. A naive chatbot over old docs is worse
than nothing: it confidently repeats stale information. The most dangerous
version of that failure is presenting something that merely *exists in code*
as *customer-ready*.

**Architecture.** Three layers:

1. *Sync pipeline* — Python + the Google Drive API, scheduled unattended via
   macOS launchd: fast-moving docs sync twice daily, seven stable repos sync
   weekly, with per-repo state tracking (commit SHAs, file counts, orphan
   cleanup) and an append-only operations log.
2. *AI summarization* — a scheduled Claude agent re-reads the 104K-line
   Swift/Go codebase weekly and distills it into a focused technical
   reference, with change detection (skip if the code didn't change) and
   search-before-upload idempotency so stale copies never accumulate.
3. *Live tool calls* — facts that change faster than any sync schedule
   (ticket status, sprint progress, daily engineering updates) are never
   baked into static knowledge; the assistant queries Jira and Confluence at
   question time via MCP connectors.

**The tiered authority system** (the core of the design, encoded in a ~370-line
system prompt): sources are ranked, and when they conflict, customer-facing
documentation always beats code. Code existing in a repo does not mean a
feature is customer-ready — if code shows something the docs don't confirm,
the assistant must say "this exists in code but is not confirmed as a
supported capability — verify with engineering." Every answer cites its
source; an uncitable answer becomes "I don't have enough information," with
an escalation path. The insight: the failure mode wasn't bad retrieval — it
was a true document (code exists) producing a wrong conclusion (feature is
supported). Better retrieval can't fix reasoning; an authority policy can.

**Other key decisions:** per-fact freshness — each knowledge type gets the
mechanism matching how fast it goes stale (live lookup vs. 2x-daily sync vs.
weekly sync vs. weekly AI re-summarization) rather than one blanket re-sync;
a staleness flag if the codebase summary is more than 7 days old, so a failed
weekly job announces itself; and a customer-answer-first response format
(answer → technical detail → flags) designed for copy-paste use mid-call.
