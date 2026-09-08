2026-09-08 Plan migrated from private coordinator staging into durable run; filenames normalized. Review describes previous round filenames historically; no product semantics changed. Initial FAIL_FIX and round2 PASS retained in coordinator private evidence.

2026-09-08 Implementation clarification D1 (bounded; no ownership change): plan F1 refers to
“RepoRef existing rules”, but packages/contracts/src/snapshot.ts:37-40 defines string fields
only, with no runtime validator. The standalone decoder therefore explicitly bounds owner to
1..39 ASCII alphanumerics/hyphens with alphanumeric ends, and name to 1..100 ASCII
alphanumerics/dot/underscore/hyphen excluding `.` and `..`. This is a conservative local
encoding check, not a repository-existence assertion or a change to existing RepoRef consumers.
Provider/model/effort use plan F1's separate 1..200 ASCII letter/digit/underscore/dot/colon/slash/hyphen
rule; the R1 128-character no-slash rule applies only to enrollment/native identifiers.

2026-09-08 Implementation clarification D2: deterministic CLI race tests invoke the actual
exported CLI main in a temporary synthetic harness, with its optional in-process checkpoint
argument. Normal fixtures execute the built CLI binary. No CLI flag or environment variable
activates checkpoints. Both paths feed the exact offline-installed decoder. This makes races
repeatable without sleeps or a production test-control channel.

2026-09-08 Source-read details: turn_context direct `effort` and collaboration_mode.settings
`reasoning_effort` are field evidence; nested settings override same-envelope direct fields.
Accounting snapshots replace the prior snapshot (never sum or retain older counters under a
new timestamp). An absent total block leaves the last observed total alone; a present empty
block means no supported counters in that observation and yields usage:null. Present malformed
supported evidence withholds the run. These spell out F1/F2's per-field and cumulative semantics.

2026-09-08 Coordinator actual private real-read gate refused unknown-envelope for observed world_state/token_usage_record. Initial refusal retained privately; no source filtered or PASS claimed. Native-envelope amendment independently PASS with R2-R4 required; implement as input-only compatibility, retain all scope/identity/timestamp/privacy gates. Existing plan output schema unchanged. Raw sources and operator paths not published.

2026-09-08 Governing native-envelope amendment discovered during final staged-file audit.
Coordinator-added native-envelope-amendment.md and native-envelope-plan-eval.md PASS (R2-R4)
were absent at the initial run-artifact read and are now applied before commit. This explicitly
extends input vocabulary to full world_state scope maps and dual-ID token_usage_record
corroboration. Wire/schema/ownership remain unchanged. All real-source observations mentioned
there belong to coordinator evidence; this implementer performed only synthetic reads. Existing
backfill KNOWN_TYPES still contains the original five envelopes and remains unchanged. Exact
fixture manifest is expanded with the reviewed synthetic forms; previous 73-fixture receipts
are superseded by final receipts, not reinterpreted as covering the amendment.

2026-09-08 Public evidence redaction: native-envelope amendment/evaluation copies omit real event
counts and own-run descriptors. The reviewed input shapes, R2-R4 requirements and PASS verdict
are unchanged. Original private source evidence remains coordinator-owned outside repositories.

2026-09-08 Staged-fixture gate finding: check:snapshots scans git ls-files, so the new synthetic
contract JSON first became visible after staging and correctly failed on observedAt. Added only
its exact path+SHA-256 to the existing synthetic fixture inventory, with missing/modified-file
negative tests. No directory exemption, live snapshot exemption, workflow or lockfile change.
This uses supervisor-authorized existing root scripts.
