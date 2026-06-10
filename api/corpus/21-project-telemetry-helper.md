## Project: SE AI Telemetry Helper

An automated knowledge pipeline that keeps a Claude Team Project accurate
enough to use on live customer calls — spanning 9 code repos, Confluence, and
a 104K-line Swift codebase that ships weekly. Used by CloudZero sales
engineers to answer product questions about the rapidly evolving AI Telemetry
product in real time.

Key engineering decisions:

- Designed a tiered authority system and uncertainty protocol so the assistant
  never presents an unverified feature as customer-ready — engineering
  directly against the confidently-wrong failure mode. It leads with what is
  customer-ready, flags what is in progress, and never guesses.
- Built an unattended sync pipeline with launchd, a Google Drive bridge, and
  Python that keeps knowledge fresh on a schedule instead of relying on manual
  curation.
- Used Claude to distill a 104K-line Swift and Go codebase into a focused
  technical reference, working around context limits with graceful
  degradation.
- Tuned a customer-answer-first response format for real-time use mid-call.
