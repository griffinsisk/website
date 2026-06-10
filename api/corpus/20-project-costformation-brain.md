## Project: CostFormation Brain

An AI knowledge corpus that turns any coding agent into an expert at writing
CloudZero CostFormation YAML — the allocation logic that decides how cloud
spend gets attributed. Built to work across Claude Code, Cursor, Copilot, and
Codex. Public repository: https://github.com/griffinsisk/costformation-brain

Key engineering decisions:

- Designed a context architecture that makes agents read a strict ruleset and
  route through a 9-file corpus before generating, cutting the
  wrong-but-plausible syntax general models produce by default.
- Built auto-populating org context from a customer's live config plus the
  CloudZero MCP server, with a compact index so context persists efficiently
  across sessions.
- Packaged one corpus to deploy identically across five AI coding tools by
  mapping each to its native instruction format.

Why it matters: as more customers build and maintain allocation logic with AI
coding tools, this drops into a project alongside their agent of choice and
produces correct, performant definitions on the first try.
