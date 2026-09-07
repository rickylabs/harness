# Drift — published governance read path (#205)

Deviations from earlier artifacts or doctrine, each with a disposition. Append-only.

| # | What changed | Was | Now | Disposition |
| --- | --- | --- | --- | --- |
| D-1 | Next contracts version | `.llm/runs/contracts-release--v010/context-pack.md:67` recorded #265's "proposed 0.2.0" as draft/deferred | 0.2.0 is assigned to the governance read document (owner-steered priority, `supervisor.md`); #265 gets a version when it has source | Recorded; #265 remains open and its fold/client behaviour is not touched or presented as fixed |
| D-2 | Producer surface | `.llm/runs/live-governance--205/plan.md` D24 kept "existing contracts and public projection schema unchanged" | contracts gains an additive standalone document and decoder; `PublicGovernance` and `RemoteSnapshot` stay unchanged | Additive; within the #205 comment's request for "an upstream typed envelope/coverage/admission contract plus the producer/transport adapter" |
| D-3 | Legacy file envelope | `governance-display--205` D3 made `--observations <path>` the fixture/live handoff | the new `governance` command refuses it; it stays the display fixture only | Prevents the `complete:true` round-trip loss shown in research §4.2 |
| D-4 | Probe files | brief allows only four files in the run directory | characterization probes ran from stdin and a temp directory, deleted afterwards; only the four files exist in the run directory | Compliant; receipts recorded in research §4 |
| D-5 | Board-process skill not invoked | the skill is required before board mutation | no board mutation occurred or is planned by this run | Not applicable |

| D-6 | Evaluated implementation corrections | Original plan inventory and rules | BI-1–BI-10 in `plan-eval.md:209` govern: provenance and clocks, configured-source completeness, pairing, seven outcome fixtures, contained portable decoding, producer caps, installed runtime and compiled root/server consumer declarations | Adopted for implementation, 2026-09-08; no workflow edit and no network install fallback. Root test chain executes installed gate. |
| D-7 | Launch evidence | Initial turn lacked launcher receipt | `implementation-identity.json` records matched native identity validated before the initial turn; resumed matrix retained | Coordinator supplied public-safe evidence, verified 2026-09-08. No model substitution or dispatch. |

Implementation will preserve the collector's empty-log distinction: an observed empty log carries
read/empty coverage but retains the current composer's incomplete result. Availability failure can
withhold the whole envelope while coverage still records which sources were read; coverage-to-leaf
pairing is checked when a state exists. This is the unavailable union's existing null-state meaning,
not a claim that a read source yielded no evidence.

| D-8 | Executable synthetic fixture environment | Default temporary filesystem assumed executable | Initial installed check reached fixture setup but the host rejected probe exec with EACCES; configure TMPDIR to an executable scratch filesystem | Environment constraint, not a skipped gate or install fallback. Offline pack/install and real root/server declaration compilation succeeded before that failure; full installed fixture subsequently passed. Public script documents POSIX/executable-temp limits. |
