# Governance display — plan-review disposition

## Summary

The independent reviewer returned `PASS AFTER NARROW FIXES`. All eight required findings and both
optional hardening notes are accepted and addressed in `research.md` and `plan.md`. The changes
clarify the existing design; they do not expand it into a live producer or modify product code.

Review source: `.git/seat3-plan205-eval.txt` (independent Opus 5, medium effort, separate session).

## Required findings

| Finding | Disposition | Artifact change |
| --- | --- | --- |
| N1 — future-dated observations appear maximally fresh | **Accepted** | D2 now requires epoch comparison and makes `observedAt > now` unavailable. F15 covers future envelope and admission timestamps; F18 covers offset-equivalent instants. Research records the same rule. |
| N2 — admission freshness undefined | **Accepted** | Each admission now has its own `validUntil`; D2 classifies it independently without inventing a global interval. D5 renders admission freshness separately, and F16 pins a stale refusal inside a fresh envelope. |
| N3 — incomplete `GovernanceState` validation | **Accepted** | D4 now validates `generatedAt`, complete regimes, `pending` and every `PendingApproval` field, and `notes`, with no defaults. F9 and F17 prove missing/invalid approval state cannot become an empty approval list. |
| N4 — leaf timestamp interval/null behavior undefined | **Accepted** | D4 requires leaf timestamps not later than the envelope; D5 derives age from each leaf and renders null as `never read`. F4 adds the canonical null timestamp under `allow` and forbids healthy wording. |
| N5 — freshness might compare ISO strings | **Accepted** | D2 explicitly requires parsed epoch milliseconds. F18 uses equivalent instants with different offsets. |
| N6 — public fields and prose trust unenumerated | **Accepted** | D6 enumerates the public governance wrapper, every nested regime field, pending approvals, notes, admissions, and optional nested approval. It states that contract prose is bounded but published verbatim and places public-safe content responsibility on the producer; adapter paths/errors/env remain excluded. Research records the same trust boundary. |
| N7 — fixture commands can inherit live telemetry environment | **Accepted** | Verification is explicitly ordered after the build-producing telemetry test. Direct commands unset `DSH_TELEMETRY_DIR` and `DSH_TELEMETRY_ARCHIVE`; fixture tests neutralize all `DSH_TELEMETRY_*` variables and use temporary homes. |
| N8 — contracts dependency was conditional | **Accepted** | The mutation surface and S1 now require `@rickylabs/harness-contracts: workspace:*`, a `../contracts` project reference, and lockfile update, with rationale and the existing dsh-app dependency pattern cited. |

## Non-blocking notes

| Note | Disposition | Artifact change |
| --- | --- | --- |
| Loader/governance note ordering was outside F11 | **Accepted** | D4 sorts governance notes and pending approvals; F11 now shuffles data, pending, and notes while requiring byte-identical output. |
| `used > total` could yield negative headroom | **Accepted** | D4 rejects paired capacity readings where used exceeds total; F9 includes used-greater-than-total in its invalid corpus. |

## Concurrent integration note

The parent reported that #204 is adding a strict `PublicTree` consumer in dsh-app. D6 and the mutation
surface now require an exact rebase inspection and focused dsh-app test after that change lands. Any
needed extension belongs in #204's owning strict consumer and must derive from telemetry's exported
public surface; this run does not create a second governance schema.

## Result

The narrow fixes are complete at the artifact level. No product code, governance stub, live adapter,
host, sibling repository, workflow, credential, or GitHub state was changed. Implementation remains
paused until the parent confirms the corrected plan gate.
