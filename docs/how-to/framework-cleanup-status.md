# Framework cleanup and rollout status

Harness is our framework on Orchid and Herdr. The seven cleanup slices establish the
source structure and naming support below. Source support and product/operator activation
have separate evidence; the naming rollout remains pending while supported consumers use
older schemas or settings.

The slices below are the earlier cleanup history under ADR 0005. The policy now in force is
[ADR 0006](../decisions/0006-rearch-2026-10-08.md): no compatibility retention, delete and do not
deprecate. The remaining method and CLI cleanup belongs to
[#658](https://github.com/rickylabs/harness/issues/658).

| Slice | Source result | Remaining rollout |
| --- | --- | --- |
| 1 | Owner decision, charter and current framework documentation | Coordinator-owned issue text updates and board regeneration |
| 2 | Canonical core CLI names and callable compatibility aliases | Superseded by ADR 0006: the aliases are to be deleted, with no census gate; the remaining CLI cleanup belongs to #658 |
| 3 | Optional router isolated under experiments; default checks select fourteen core packages | Router acceptance remains separately authorized after the next APK |
| 4 | Canonical method and run-record homes; the compatibility copies were later deleted by ADR 0006 | Vault refresh uses this truthful structure; storage/checkpoint work is separate |
| 5 | Canonical operator settings, conflict refusal and fenced log-family selection | Paired reader forwarding and operator file/settings migration |
| 6 | Exact canonical/legacy cost reader unions in released contracts 0.36.0 | Cockpit schema/client regeneration and supported mobile captures |
| 7 | Explicit canonical producer selection, current core naming and classified residual references | Canonical default promotion and live wire/log activation await paired readiness |

Contracts 0.36.0 is published under the unchanged `@rickylabs/harness-contracts` name,
with npm `gitHead` `48261440f80a9ac49695283b911a2aa36b76c81d`. Its schema/protocol remain 1.
Current producer defaults stay legacy. The [wire guide](telemetry-wire-migration.md) gives the
exact opt-in and reader-first sequence; the [operator guide](telemetry-operator-migration.md)
covers settings and whole log-family migration separately. Neither source merge nor npm
publication proves that a currently supported client accepts canonical output.

## Retained references

The final census is per occurrence, including current source, generated guidance, package
metadata, retained records, real upstream locks and the isolated router. Substring lookalikes
in unrelated identifiers are recorded separately. Remaining references have explicit reasons:

- Real upstream package, SDK, profile and optional-router identities describe the retained
  experiment. They are not renamed into fictional dependencies.
- Legacy protocol, cookie, service-key, cost-source and log identities are wire and stored-data
  boundaries. Readers keep their exact provenance and guards, because contracts change only
  additively (ADR 0005, kept by ADR 0006).
- Synthetic old/new fixtures and alias controls prove that compatibility still works.
- Completed records and earlier owner decisions retain their original source text. Current
  supersession guidance links the framework decision without rewriting historical evidence.
- Taxonomy and board projections retain authoritative issue text. The coordinator applies
  the reviewed issue-title/body proposals; generated output is never edited to fabricate a
  different source.

The original inventory remains immutable and hash-bound: 7,805 occurrences on 4,747 lines
in 359 files at its recorded baseline. The candidate census classifies every remaining
occurrence, including new compatibility guidance, with no unclassified obsolete current
framework claim. Full private JSON/TSV and line hashes accompany the source review; private
paths and source captures are not published as documentation.

The default core paths, root profiles, package exports, upstream resolutions and native
binding/accounting fences remain stable. Historical Git and npm objects are retained.
Rollout owners must record the actual reader/client revisions, capture provenance and
activation evidence before reporting naming migrations complete.
