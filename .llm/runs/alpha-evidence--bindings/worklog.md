# Evidence binding implementation

Harness preserves `DispatchResult.route` through instrumentation into the existing `dsh-telemetry runs --json` read. Its additive `dispatches` array is keyed by dispatcher identity and carries the explicit native-session reference, seam and canonical route. The provider implementation name is not substituted for router evidence. Public cwd values are withheld and diagnostics are recomputed from the remaining evidence.

Validation: workspace typecheck and build passed. All package tests passed. The installed-contract gate initially reported inconclusive because its default scratch directory was not executable; rerunning that gate in executable scratch passed. Additional CLI fixture exercises the real read path. Fixtures contain synthetic identities and measurements only.

Runtime limitation: this is a candidate implementation, not evidence of deployment or populated live seats. Existing processes must use this build. A pane must be explicitly bound to its dispatch, and subscription headroom needs an explicit account/window enrollment. No native observer is added; absent observed route fields remain unknown. Independent implementation evaluation and supervisor sign-off remain pending.

## Per-issue dispatch implementation

Orchid draft source now writes dispatch context in its existing private reservation before the
launch, then persists exact workspace-create handles before pane execution and an acknowledged
or uncertain effect afterward. The issue belongs to the configured inbox; the target repository
is deliberately not paired with that issue number. Harness reads the records through the existing
`dsh-telemetry runs --json` command when `DSH_TELEMETRY_DISPATCH_ROOT` is bound. No wire grammar,
collector or native observer is added.

The Codex parser now keeps thread identities distinct from shared session identities and retains
explicit parent metadata. Existing native trees and usage readers remain the source of truth.
Validation: 457 telemetry tests passed, including CLI receipt reads, parent identity separation,
conflicting parents, private-source permissions, symlink refusal and malformed records. Orchid
Go race tests, vet and build passed; the synthetic production spawn test checks that pane
evidence is durable before the execution effect and that ambiguous launches remain uncertain.

Still unbound: native session association for Orchid, observed
route evidence from native launch, and runtime installation of this draft. Existing three-row cost
projection must retain explicit unavailable reasons for unbound run/account sources. No live
proof or first-alpha acceptance is claimed. Issue 316 with profile leaf remains the owner-selected
proof target. Cockpit owns projector startup and the user will relay its per-issue read shape.

The initial inventory missed an existing NetScript field: ResolvedDelegationRoute extends
RouteIdentity and includes provider. Source: `.llm/tools/agentic/runtime/routing-policy.ts:101`
and `:167` at NetScript f3324909e0896cedc9729005bac5f508e122d6c6. Orchid's bridge omitted it.
The implementation now carries the authority's provider unchanged, validates it against the
authority's PROVIDER_KINDS, and exposes it as requested router evidence. No provider mapping
is copied into Harness or Orchid. Observed provider remains unknown.

Workspace typecheck and the full build gates passed for the linkage changes. The real pinned
NetScript bridge probe is read-only; its public result contains no selected runtime identities.
