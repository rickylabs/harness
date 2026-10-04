# ARCHITECTURE

**Version 2 — owner amendment 2026-10-03, [ADR 0005](doctrine/decisions/0005-harness-framework-identity.md).**

This is the charter of the repository. It supersedes the dsh-only premise of [#30](https://github.com/rickylabs/harness/issues/30); the original roadmap and earlier decisions remain historical evidence. Eric ratified Decision Q and the coordinator approved the ordered cleanup through ADR 0005.

Further amendments require an owner decision with rationale recorded in [`doctrine/decisions/`](doctrine/decisions/). An agent must work within the charter or present a new decision; it cannot silently redefine the product.

## 1. What this repository is

**Our portable agent framework, built on Orchid and Herdr.** Harness supplies routing configuration and discovery, native-provider boundaries, execution observations, board and coordination mechanics, published contracts, profiles, and the method and run record.

[Orchid](https://github.com/rickylabs/orchid) owns dispatch and physical launch admission. [Herdr](https://github.com/herdrdev/herdr) owns terminal control. The core packages are independent of DeepSeek Harness. The retained [dsh composition](experiments/routers/dsh/README.md) is an optional additional-router experiment, not the host required to run the framework.

## 2. The thesis

Make agent work observable and governed without asking an agent to reconstruct its own status. Keep intent, route authority, execution, evidence freshness and independent certification separate, and retain the source of each conclusion.

An implemented port is not proof of a deployed integration. A configured route is not proof of a usable provider. A completed native run is not proof that its artifact passed independent evaluation.

## 3. What works today

The table describes repository capabilities and their source boundaries, not a claim that every host is configured or every integration has been activated.

| Component | Implemented boundary | Source |
| --- | --- | --- |
| Routing | Whole-document loading, immutable lane/fleet queries, refusal-preserving resolution and native discovery. Concrete choices are data. | [routing](packages/routing/README.md) and its [fleet document](packages/routing/config/routing.fleet.v2.json) |
| Profiles | Eight worker roles, dedicated milestone coordinator and researcher compatibility alias. | [profiles](profiles/README.md) |
| Board and coordinator | GitHub projections, workflow decisions, independent evaluator selection, replay and durable-effect state boundaries. | [board](packages/board/README.md), [coordinator](packages/coordinator/README.md) |
| Native observations | Claude, Codex, AGY and OpenCode source readers, public activity screening and truthful dispatch binding. Reader support does not prove a live source is present. | [telemetry](packages/telemetry/README.md) |
| Process setup | Explicit taxonomy/process installation and GitHub bridge rules. | [forge](packages/forge/README.md) |
| Published mechanism vocabulary | Dependency-free contracts, strict decoders and compatibility surfaces; the npm name stays stable. | [contracts](packages/contracts/README.md) |
| Dispatcher | Issue polling, workspaces, native launch/goal delivery, owner authority, governor accounting and retirement fences. | [Orchid divybot](https://github.com/rickylabs/orchid/tree/main/cmd/divybot) |
| Terminal control | Native agent status, panes and steering; availability and visible blocked states require observation. | [Herdr](https://github.com/herdrdev/herdr) |
| Method | Staged planning, review, evidence, gates and milestone/run templates. | [doctrine](doctrine/WORKFLOW.md), [templates](.llm/harness/templates/) |

The [package guide](packages/README.md) identifies stubs and partial providers. NetScript remains an external runtime/service dependency behind a boundary; its proven slice and wake primitives are prior art, not a second copied routing authority.

## 4. The layer map

```text
owner / product client
        │ authorized intent and observation
        ▼
cockpit backend — product authorization, persistence and projections
        │ published contracts and explicitly pinned source readers
        ▼
Orchid dispatcher — route authority, physical admission and accounting
        │ native launch and control
        ▼
Herdr + native CLI — terminal state and autonomous work
        │ native stores, receipts and run artifacts
        ▼
Harness readers — screened execution evidence and board projections
```

GitHub owns the work graph; native stores and dispatch receipts own observed execution. Orchid polls for dispatch work. Readers use their implemented bounded reads or subscriptions. The framework does not promise an entirely polling-free chain.

## 5. The dispatch contract

For this fleet, an authorized issue brief is the dispatch record and the `harness` label is the live trigger. The label starts real work; it is never applied as incidental board metadata. Product commands must cross the verified owner-authority boundary before installation or dispatch.

The matrix is the **default** for agentic launches. A verified owner-native override records authorizer `eric`, rationale and an exact tool/provider/model/effort route, retains physical checks and budget accounting, and carries owner provenance instead of a fabricated matrix receipt. An ordinary free-text model override is not authority. See Orchid [#59](https://github.com/rickylabs/orchid/pull/59) and [#64](https://github.com/rickylabs/orchid/pull/64).

| Mode | Process/route source |
| --- | --- |
| Profile | `profiles/<name>.md` supplies the working process; configured routing selects the default route. |
| Matrix task | The pinned routing document selects tier/role candidates and effort requests. |
| Owner-native override | Verified owner authority supplies an exact native route; physical checks still apply. |

A dispatched body must contain no fenced code blocks: parser behavior can otherwise truncate the brief. Keep `#` out of parsed override values. Privileged tiers still require named authority and nonempty rationale, and evaluator independence is never waived.

Record requested and observed effort separately. Native transports have different capability and effort surfaces; an argument or brief request is not proof that the selected native model supports or applied it. Discovery publishes only established facts, with unknown retained on failed or unproved reads.

## 6. Profiles

The dispatcher reads `profiles/<name>.md` from the repository root. Eight canonical profiles cover the matrix worker roles; `rfc` remains an alias of `researcher`. `milestone-coordinator` uses `coordinators.milestone`, separate from worker tiers. The [profile guide](profiles/README.md) owns the exact files, frontmatter and routing rows.

Permissions in a profile describe requested policy. They do not grant credentials, authority or an available seat. Root profile paths remain stable through cleanup.

## 7. Invariants

A check that could not execute is **unproven**. An empty CI check set, empty source or missing receipt cannot certify success. The independent evaluator must assess the changed exact head rather than rely solely on the author's gate account.

**I1 — Every spawn records its route authority and observations.** Default launches retain matrix source/resolution; verified owner-native launches retain owner provenance and exact route. Requested and observed model, effort, transport, role/tier where applicable and session identity remain distinct. Neither route authority invents execution.

**I2 — A generator never certifies itself.** Generator and evaluator use separate sessions from different vendor families. An absent evaluator is a blocker, not permission to weaken the rule.

**I3 — Privileged tiers carry authority.** `complex` and `architecture` require a named authorized owner/coordinator and nonempty rationale. An override is not an independence or budget waiver.

**I4 — A blocked lane carries an open decision.** A method lane blocked on an owner decision records the question, options, recommendation and cost of being wrong. A native startup/access block remains a truthful technical observation; it must not be converted into a successful launch.

Existing receipt and blocked-decision checks are documented in [profiles](profiles/README.md) and the [gate contract](.llm/tools/gates/contract.ts). Passing synthetic fixtures does not prove that every live record is authentic or complete.

## 8. Escalation is a record, not a conversation

An escalation needs a durable identity, source session, question, options and an answer receipt. Writer fences and exact session binding prevent duplicate answers or delivery to the wrong agent. The [coordinator state boundary](packages/coordinator/README.md#durable-effect-state) provides mechanism and drivers; product persistence, authorization and the verified effect delivery are owned by the backend and dispatcher.

Do not call an interface or reference driver a deployed decision inbox. Report the actual adapter, storage identity, integration evidence and unresolved gaps.

## 9. Cost

Keep subscription headroom, metered spend and native run usage separate. No blended price is invented for subscription turns. Observed provider/account windows, paid-provider budgets and static capacity have different sources and units.

A transport with no quota source is explicitly unmetered and uses configured physical capacity. It must not consume another vendor's meter. Missing quota, access or budget observations remain unknown; provider connectivity is not proof of paid eligibility. [Telemetry](packages/telemetry/README.md) owns observations; Orchid owns live admission and accounting.

## 10. What is parked

UHP-hosted dispatch remains parked under [ADR 0004](doctrine/decisions/0004-uhp-park-evidence.md). That decision records the 2026-09-13 measurement and ruling, including the removed borrowed router. It is historical evidence, not a fresh claim about today's host. [#294](https://github.com/rickylabs/harness/issues/294) is the required round-trip proof before reconsideration.

The dsh router is retained as an additional experiment under [ADR 0005](doctrine/decisions/0005-harness-framework-identity.md). It lives in `experiments/routers/dsh`; default lifecycle and root TypeScript graphs select fourteen core packages. Explicit experiment checks verify the retained composition. Its real SDK/profile/lock identities and historical evidence stay intact. Testing it after the next APK requires its own authorization and proof.

E11 routing/discovery is core work. An optional router never replaces Orchid/Herdr or becomes a prerequisite for native dispatch by implication.

## 11. Build order

The owner-approved cleanup is sequential: documentation, core CLI compatibility, experiment isolation, then canonical method/run-record homes. The vault refresh starts after these four PRs merge. Operator naming, additive reader-first wire vocabulary and producer switches are pending migrations 5–7 with paired consumer rollout gates.

Cleanup PRs 1–3 establish the framework identity, canonical core CLIs with compatibility aliases, and opt-in experiment isolation. No contracts publication or activation is required for these steps. Public core paths, root profiles and the npm name remain stable. Any later source/wire change must identify exact consumer pins and compatibility before a producer switch.

## 12. What the client is

Cockpit and mobile are separate products. The backend owns product authorization, persistence, commands and projections; the mobile runtime uses the captured backend-generated API/client. A type-only contract vocabulary dependency is not a private backend runtime or an authorization path.

The backend consumes the published contracts and explicitly pinned source readers. Native assistant text is screened; private paths, credentials and native store identifiers are not public fields. Execution, evidence freshness, certification and connection synchronization remain separate. Unknown state never triggers automatic redispatch.

Legacy protocol-1/mux interfaces remain documented compatibility surfaces, not a claim that today's app uses a dsh deployment. [The three layers](docs/concepts/06-the-three-layers.md) records the boundary and historical protocol context.

## 13. How to disagree with this document

Record a numbered decision with evidence, recommendation and cost of being wrong in [`doctrine/decisions/`](doctrine/decisions/). Preserve previous decisions as historical evidence and make any supersession explicit. Do not silently build against another architecture.
