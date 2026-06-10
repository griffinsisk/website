## Project: CostFormation Brain

Public repository: https://github.com/griffinsisk/costformation-brain

**Problem.** AI coding agents (Claude Code, Cursor, Copilot, Codex) confidently
generate syntactically plausible but functionally incorrect CloudZero
CostFormation YAML — the domain-specific language that decides how cloud spend
gets allocated. The failure modes are expensive: definitions that pass YAML
parsing but violate the schema (a missing `User:Defined:` source prefix), data
errors that fail silently (an unquoted 12-digit AWS account ID gets coerced to
an integer, loses its leading zero, and that spend never classifies), and
performance anti-patterns (a shared database with 1,000 line items allocated
across 50 teams produces 50,000 rows; an allocation layered on another
allocation's output multiplies from there).

**Architecture** (~110 files): a 9-file knowledge corpus fronted by a routing
table that maps task type to exactly the files an agent should read; a
~1,000-line Python validator with 16 deterministic lint rules (11 errors, 5
warnings) covering syntax, source prefixes, performance, and integrity; 20
worked example patterns with selection metadata (complexity, what each
teaches, which anti-patterns it avoids) so agents pick a reference without
reading everything; and an eval harness with 18 test cases — including
negative cases verifying the system catches intentionally broken YAML — with
golden outputs compared semantically rather than line-by-line. An org-context
layer auto-populates a normalized snapshot of the customer's environment
(accounts, tags, existing dimensions) from their live config plus the
CloudZero MCP server, with hash-based staleness detection. Example patterns
derive from real customer configurations, fully anonymized.

**Key engineering decisions:**

- *Constrain and verify, don't trust generation.* The design assumes the
  model will sometimes be wrong, so the architecture catches it: a generate →
  validate → repair loop where the agent runs the linter and fixes errors
  before presenting output.
- *Observable compliance.* Agents must state which corpus files they read and
  why before generating — a skipped file is visible to the human reviewer
  instead of silently degrading quality.
- *One corpus, four agent formats.* The same rules ship as CLAUDE.md,
  .cursorrules, Copilot instructions, and a generic AGENTS.md, kept
  isomorphic so behavior is identical across tools.
- *Performance rules carry cost reasoning, not just style.* Each anti-pattern
  documents its infrastructure consequence — e.g., an unconditional
  DefaultValue forces the allocation engine to process every line item.

**Why it matters.** As customers build and maintain allocation logic with AI
coding tools, this drops into a project alongside their agent of choice and
produces correct, performant definitions — and Griffin has demoed it live in
customer conversations.
