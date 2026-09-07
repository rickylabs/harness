# Drift — published governance read path (#205)

Deviations from earlier artifacts or doctrine, each with a disposition. Append-only.

| # | What changed | Was | Now | Disposition |
| --- | --- | --- | --- | --- |
| D-1 | Next contracts version | `.llm/runs/contracts-release--v010/context-pack.md:67` recorded #265's "proposed 0.2.0" as draft/deferred | 0.2.0 is assigned to the governance read document (owner-steered priority, `supervisor.md`); #265 gets a version when it has source | Recorded; #265 remains open and its fold/client behaviour is not touched or presented as fixed |
| D-2 | Producer surface | `.llm/runs/live-governance--205/plan.md` D24 kept "existing contracts and public projection schema unchanged" | contracts gains an additive standalone document and decoder; `PublicGovernance` and `RemoteSnapshot` stay unchanged | Additive; within the #205 comment's request for "an upstream typed envelope/coverage/admission contract plus the producer/transport adapter" |
| D-3 | Legacy file envelope | `governance-display--205` D3 made `--observations <path>` the fixture/live handoff | the new `governance` command refuses it; it stays the display fixture only | Prevents the `complete:true` round-trip loss shown in research §4.2 |
| D-4 | Probe files | brief allows only four files in the run directory | characterization probes ran from stdin and a temp directory, deleted afterwards; only the four files exist in the run directory | Compliant; receipts recorded in research §4 |
| D-5 | Board-process skill not invoked | the skill is required before board mutation | no board mutation occurred or is planned by this run | Not applicable |
