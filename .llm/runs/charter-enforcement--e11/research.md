# Research

Profiles exist, but enforcement is incomplete. A recorded profile smoke selected a default
transport outside the matrix. The cluster validator does not require a blocked lane to point
to an open decision. These are separate defects; neither is solved by rebuilding routing data.

## Repository evidence

- `profiles/README.md:7–10` describes dispatcher profile injection; the three markdown profiles
  are present. `ARCHITECTURE.md:123–127` declares them shipped.
- `.llm/runs/architecture-v1--smoke/receipt.md:13–35` records the observed model mismatch and
  explicitly unevaluated smoke. Presence of a profile is not proof of I1 or I2.
- `.llm/tools/harness/validate-milestone-cluster.ts:286–300` validates reporting lane shapes;
  `:332–347` validates owner-decision text but not open status, unique identity, or a reference
  from the blocked lane. `:688` only invokes reporting validation for schema version 2.
- `.llm/tools/harness/validate-milestone-cluster.ts:719–724` refuses identical implementer and
  evaluator session references; it does not establish different vendor families.
- `deno.json:6–7` declares the existing renderer and validator. `.github/workflows/ci.yml:55–65`
  invokes pnpm aggregates; `package.json:30` does not run the cluster validator tests.

## Upstream evidence retrieved 2026-09-14

- [Divybot overrides](https://github.com/rickylabs/orchid/blob/d344bd037bcf10150fd12daef8ffa277576cd94a/cmd/divybot/overrides.go):
  `Overrides` carries harness/model/router/effort/profile; `parseOverrides` ignores undeclared
  keys. Tier, role and authority are not currently parsed. `goalPreamble` injects profile reading.
- [Divybot spawn](https://github.com/rickylabs/orchid/blob/d344bd037bcf10150fd12daef8ffa277576cd94a/cmd/divybot/main.go#L2479):
  host selection precedes override parsing; `buildAgentCmd` runs at line 2579 and `spawnAgent`
  at line 2605. A matrix hook must run before host selection, not merely before command rendering.
  Selected transport affects capacity accounting as well as executable choice.
- [Matrix JSON CLI](https://github.com/rickylabs/netscript/blob/f3324909e0896cedc9729005bac5f508e122d6c6/.llm/tools/agentic/runtime/cli/delegation-matrix-table.ts):
  `jsonOutput` exports schema version 1, including role and tier query modes. This is source
  inspection, not a fresh executed resolution or evidence of launcher availability.
- [E11](https://github.com/rickylabs/harness/issues/270),
  [parity dependency](https://github.com/rickylabs/harness/issues/275), and
  [resolved but unlaunchable evaluators](https://github.com/rickylabs/harness/issues/321)
  remain open. The charter explicitly removes extraction from the critical path.

## Netscript first

Called MCP `find_guidance` before designing. Its broad match was unrelated to matrix routing.
`search_docs` for `delegation-matrix` returned zero matches; that is absence from this search,
not proof NetScript lacks the capability. Continued with the charter's cited source and CLI.
`search_docs` for `effect ledger` and `get_doc` for the orchestration plugin authoring guide
returned general primitives, not a cockpit-specific event contract. No API operation was
invented, and no cockpit endpoint was probed.

## Dual-agent observation

The installed question helper derives a lane from the working directory and appends timestamped
question text to a file. The answer helper reads a separate answer file. Source inspection
found no explicit correlation identifier, acknowledgement, lock, notification or delivery
receipt. These statements concern these two helpers, not an uninspected counterpart watcher.
Two real questions were submitted and accepted locally. At the initial observation cutoff,
neither had an answer. See `dual-agent.md` for the draft contract and censored measurement.

## Admission and reachability follow-up

The local catalogue listed exact `opencode-go/glm-5.3` with exit 0. A later-read counterpart
diagnostic separately refused Go admission because usage could not be proven. The local
catalogue observation did not establish the remote dispatcher's admission result. Review
request [340](https://github.com/rickylabs/harness/issues/340) was withdrawn with no review or
launcher receipt observed; no runtime absence or stop is claimed from its closed state.

The counterpart could observe a recent board publication, but correctly refused to infer
that dispatch was accepting or that the withdrawn request had stopped. This preserves the
charter's distinction between a reachable observer and an empty result from another surface.
