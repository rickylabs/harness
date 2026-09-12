# Handover corrections — the E3/UHP child issues are not what the seat brief describes

The seat-3 takeover brief lists five newly filed issues under "Epic E11 child issues filed in
Harness". Read back from GitHub on 2026-09-12, four of the five descriptions are wrong and the
epic attribution is wrong. Correcting them matters because a coordinator routes on epic, area and
work type, and the brief's version would route all five as E11 routing features.

| # | Brief says | Actually filed as | Labels on record |
|---|---|---|---|
| 286 | D11.1 — `@rickylabs/routing` UHP adapter | E3.7 — `provider-uhp`: SubagentProvider over UHP `/v1/responses`, in **`@rickylabs/subagents`** | `type:feat`, `area:subagents`, `epic:e3` |
| 287 | D11.2 — UHP integration test matrix | E3.8 — Contract alignment for UHP-hosted runs in `packages/contracts` | `type:feat`, `area:contracts`, `epic:e3` |
| 288 | S10 — Subagent provider seam router contract | Spike S10 — Route identity over UHP: effort, `cwd`, provider observation | `type:chore`, `area:subagents`, `epic:e3` |
| 289 | S11 — UHP stream adapter implementation | Spike S11 — Workspace and PR round-trip on HarnessRouter CE | `type:chore`, `area:subagents`, `epic:e3` |
| 290 | S12 — Subagent contract test suite | Spike S12 — Evidence path: transcript and quota meters for UHP runs | `type:chore`, `area:telemetry`, `epic:e3` |

Three corrections follow from the table.

**All five are `epic:e3`, not E11.** They are sub-issues of #33 (E3 — Subagent providers over
structured protocols). E11 is #270, "Configuration-driven routing: consume the fleet matrix as
data", and it owns #271–#275 instead. The `D11.*` and `S1*` identifiers are cockpit product-pack
IDs carried in the issue bodies; they are not this repository's epic. Conflating them would route
UHP work into the routing epic and misreport both.

**S10, S11 and S12 are `type:chore` spikes, not feature implementations.** They are experiments
that produce evidence and a gate verdict. Routing them to the default feature-implementation cell
treats an experiment as a build, which is the wrong tier and the wrong acceptance test.

**The dependency direction is the reverse of a flat fan-out.** #286 declares "Depends on Spike S10,
Spike S11" in its public body, and #288 and #289 are filed as its children. The private cockpit RFC
agrees, and #287 follows #286's design rather than preceding it. So the order is S10 and S11 first,
then #286, then #287 — not three parallel implementation dispatches.

## One further correction: #53 is not labelled superseded

The brief states #53 (E3.3, provider-codex against the running app-server daemon) is "marked
`superseded-pending` (closes on S11 PASS)". On GitHub, #53 still carries `status:triage` and no
supersession label. The supersession is recorded only as a comment dated `2026-09-11T22:57:53Z`:
"Spike S11 is filed at #289. #53 closes when #289 PASSes." The private cockpit RFC agrees, closing
#53 as superseded **only after** S11 proves multi-turn continuation on a HarnessRouter Codex
harness.

The condition is real and the label is not. Since S11 has not run, no label change is proposed
here — the point is that the board does not currently say what the brief claims it says.
