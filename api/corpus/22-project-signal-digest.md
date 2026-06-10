## Project: AI Signal Digest

Public repository: https://github.com/griffinsisk/cz-ai-signal-digest

A weekly go-to-market enablement pipeline that synthesizes AI market signal
and customer-call patterns into a digest sales reps can act on — built so
CloudZero's GTM team learns about competitor moves and field trends
proactively on Monday morning, not reactively in a customer call.

**Architecture.** A deliberately two-natured system: the Python pipeline is
deterministic (fetch from ~18 configured sources — AI provider blogs and
release feeds, competitor changelogs, analyst feeds, plus customer call
transcripts — normalize, pre-filter), and the AI layer is probabilistic
(Claude decides relevance, labeling, and synthesis via version-controlled
prompts). The whole pipeline runs through the Claude CLI with no API key —
auth rides on the existing Claude login. Full run: ~25 minutes on a laptop;
extraction cost roughly $1.20/week.

**Key engineering decisions:**

- *A written spec for signal vs. noise.* A frame document defines exactly
  five signal categories; extraction prompts are ground-truthed to it, and
  items outside the frame are cut with no per-item override. An
  "always-include floor" guarantees flagship model launches and pricing
  changes survive even with thin source excerpts — a rep unprepared for a
  major launch is worse than a slightly under-baked summary.
- *Talk-track safety labels.* Every item is labeled 🟢 (safe to reference
  with customers) or 🟡 (internal awareness only) based on source tier:
  vendor primary sources default green; analyst and press default yellow
  unless corroborated by a primary source the same week. The written rule:
  "When in doubt, label 🟡 — a single mis-quoted competitor rumor in a
  customer call does more damage than a hundred conservative labels."
- *Substance gates on call patterns.* Customer-call extraction looks for four
  defined patterns (build-vs-buy pressure, substitution, churn risk from AI,
  meaningful AI adoption) and only counts signal the customer volunteered —
  a rep asking "do you use AI?" and hearing "yes" doesn't qualify. A pattern
  needs 3+ calls across 2+ distinct accounts before the digest calls it a
  trend.
- *Cheap prompt iteration via caching.* Extraction outputs are cached per
  week, so re-running synthesis with an edited prompt takes ~30 seconds
  against identical inputs instead of a 25-minute re-fetch — which is how
  prompt regressions get caught before they ship.
- *Quiet weeks are allowed, and failures are loud.* Sections can be empty
  rather than padded, and an unavailable source is reported in the digest
  footer instead of silently vanishing — so a thin digest is a fact about
  the market, not a hidden pipeline failure.
