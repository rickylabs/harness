---
name: rfc
title: Researcher (RFC compatibility alias)
role: deep_research
defaultTier: feature
description: Compatibility alias for researcher; preserves existing RFC profile references.
skills:
  - use harness
permissions:
  - Read repository and research sources.
  - File a reviewed RFC.
guardrails:
  - Do not edit source code.
  - Use only permitted deep research transports.
---

# Profile: rfc

Compatibility alias for [researcher](researcher.md). Read that profile before
starting: it owns the research, evaluation and ratified RFC filing process.
The `rfc` name remains valid for existing briefs and persisted references.

| Field | Value |
| --- | --- |
| `run-mode` | `seed` — research and plan, no implementation |
| `skill` | the harness skill (`use harness`) |
| `state` | `research.md`, `synthesis.md`, `plan.md`, `evaluate.md` |
| `gate` | independent evaluation, owner ratification, then a single filing |
| `routing` | the matrix `deep_research` role at the brief's tier; declared research transports only |

The worker default is `feature`. This alias grants no source-edit permission,
transport exception or exemption from separate-session, different-family review.
