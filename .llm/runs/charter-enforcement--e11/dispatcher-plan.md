# Divybot matrix hook — draft implementation plan

Implement the locked charter's before-spawn order in Orchid. Reuse NetScript's matrix CLI and
first-party resolver in place; do not copy a fleet policy or modify NetScript. No product mutation
until an independent plan gate. No deployment is part of this source PR.

## Scope and evidence

Baseline Orchid d344bd037bcf10150fd12daef8ffa277576cd94a. There is no AGENTS.md or CLAUDE.md in
that checkout. Existing implementation is Go 1.25, standard library, with one Coord.spawn call and
one host.spawnAgent call; see dispatcher-handoff.md for pinned source citations. NetScript source
f3324909e0896cedc9729005bac5f508e122d6c6 has the existing typed resolver and JSON table CLI.
A read-only invocation proved the resolver is importable without extraction or changing its source.
This is feature integration of a locked design, not a new charter or routing policy.

Mutation surface in Orchid: cmd/divybot/main.go, overrides.go, a matrix module, an embedded process
bridge, focused tests and a reference document. Harness retains the plan, review and public summary.
No provider integration, cockpit schema, fleet configuration copy, NetScript mutation or deployment.

## Contract and decisions

1. Every new dispatch goes through one spawn-attempt function. It establishes tier and role from
   the brief, bound private metadata or the profile routing row; absent information is not guessed. It
   resolves the matrix, selects the quota account and host, persists a private receipt, then calls
   the existing launch path. Missing matrix configuration, tier or role fails closed. There is no
   legacy default-agent bypass when resolution cannot run. Existing live jobs may be supervised or
   adopted without claiming they received a new resolution; only a new spawn gets a new receipt.
   Initial issues, mirrored comments and retries all reach this existing common spawn site.

2. Add tier/role to Overrides. Keep profiles/<name>.md as the profile source; constrain its name
   to a filename stem. Read the routing table row from the target repository at a pinned source
   commit, and bind its digest to the launch metadata. The existing workload row forms name roles
   in inline code; parse those against NetScript's exported role vocabulary, default to the first
   declared role when omitted, and refuse an explicit role outside that row. Leaf declares
   implementation plus its evaluation roles; RFC declares deep-research. A coordinator routing row
   names its coordinator scope and uses resolveCoordinatorRoute plus the full JSON CLI's coordinator
   section. A workload tier still comes from the brief/bound metadata; never invent one. Missing,
   ambiguous or unsupported row syntax refuses. Preserve profile transport restrictions through
   the first-party resolver. No compiled model or profile-name routing table. Pin semantics remain
   owner fork 4; no source implementation chooses an answer on the owner's behalf.

3. Matrix configuration holds a private NetScript checkout location and private receipt location,
   with no operational defaults in tracked examples. Config pins the expected source commit. The
   short embedded TypeScript bridge executes under Deno against that private checkout, importing
   .llm/tools/agentic/runtime/routing-policy.ts in place and supplying the target worktree context.
   It invokes the existing JSON CLI with the explicit workload tier/role (or full coordinator view),
   then calls resolveWorkloadRoute/resolveCoordinatorRoute from the same checkout to obtain physical
   model/family/transport and requested/concrete effort.
   Fresh process per attempt, bounded timeout/output, no shell interpolation of request data. Keep
   source revision and digest of CLI output; require HEAD to equal the configured expected commit,
   reject dirty/changed source or inconsistent selected
   logical model/effort versus the returned role cell. The bridge contains structural validation,
   not model/effort/tier tables. Go consumes a validated envelope and fills its existing overrides.

4. Privileged authorization and generator linkage come from operator-controlled private task
   metadata, bound to the global issue node identity, target repository and digest of the complete
   parsed brief (including all accepted overrides and prompt), never from claims inside issue prose.
   Fetch that node identity from GitHub rather than deriving it from a repository-local number.
   A digest mismatch after an edit refuses. Metadata is immutable/write-once, with no transitions
   or answer field; replacement is a distinct authorization for a distinct brief. The metadata names
   the owner/coordinator principal and rationale and identifies the actual generator receipt for
   an evaluation. Runtime validation checks the first-party authorizer union before calling the
   existing resolver. Missing/invalid provenance refuses privileged work; missing actual generator
   evidence refuses evaluation. A public issue can request a role but cannot authorize itself.
   This metadata is launch configuration, not a new decision ledger or a cockpit API.

5. Resolve evaluation against the generator model recorded by its prior launch receipt, including
   generator fallback. Require a successful prior launch receipt and independent observed model
   selection; no requested-model self-report is sufficient. Apply first-party family checks in the
   resolver, retain generator session reference privately, and compare the newly observed session
   only when an actual model-session source supplies one. PaneID/WorkspaceID are operational handles,
   never SessionIdentity.sessionId; current AgentInfo/list/get exposes no actual model-session field.
   At this boundary today, model-session independence is always unproven. Unknown new session identity leaves independence unproven
   and cannot produce a valid evaluator certification. Reused same-session identity must stop that
   evaluator. Existing pre-hook generators receive no synthesized receipt. Until owner fork 3 names
   an acceptable observation source and its contract is executable, evaluation admission is refused;
   there is no fictional bootstrap collector. This source PR does not turn unavailable observations
   into known values.

6. Preserve the existing launcher implementations. Advertise only mappings that this bridge can
   execute exactly; unsupported physical transports are unavailable to selection, not silently
   mapped to a different quota account. Native Claude, Codex and Agy use their existing exact-model
   flags; supported noninteractive variants may use the same native model only. Existing native
   effort limitations stay explicit unknown/prose-only, except a real applied flag. No new provider
   adapter or entitlement inference is introduced. Account exhaustion excludes that transport before
   fallback; choosing a sibling model on the same exhausted subscription cannot restore budget.
   If a transport has no trustworthy admission evidence, fail/declare unproven rather than treating
   the old governor's no-meter behavior as proof of entitlement.

7. Persist the I1 receipt before the spawn effect, atomically, in an explicitly private directory
   outside any Git checkout. Use the schema reviewed in Harness PR 342; public fixtures are synthetic.
   A durable write failure prevents spawn. Keep private attempt identity separate from the public
   structural receipt and retain failed/unknown observations honestly. After launch, update observed
   fields only from actual launcher/control-plane evidence, with source references. No requested-to-
   observed backfill. Observability unavailable means unproven; it does not erase the launch record.
   If post-launch persistence fails, do not certify or silently retry another spawn; stop the new
   session where its identity is known and surface a sanitized incomplete-observation result.

8. New diagnostics use fixed reason codes and public issue numbers only. Never print subprocess
   stderr, private input metadata, session identities, locations or receipt contents. Configuration
   and receipt examples must carry only invented values and no concrete operational locations.
   The sole spawnAgent effect boundary must require an unexported typed durable-receipt handle
   produced only by the successful write path; absent/invalid handles refuse. The existing bare
   spawnAgent signature cannot remain a callable alternate path. The bypass test targets this boundary.

## Verification

- Go tests drive the real common attempt function with injected resolver/admission/storage/launch
  effects. Assert event order and exact selected overrides, then zero launch calls for missing config,
  resolver timeout/nonzero/empty/malformed output, unsupported route, pin mismatch, missing privilege,
  missing or same-family generator, exhausted account, failed receipt write and absent host capacity.
- Run the bridge against a synthetic first-party source fixture with different model names, proving
  no production matrix literals are compiled into Go. Also perform a read-only resolution against
  the real clean NetScript checkout; never spawn for this probe.
- Test private receipt permissions/atomic persistence and refusal to write under a Git checkout.
  Feed emitted synthetic I1 receipts to the already-reviewed Harness checker: unknown observations
  return unproven, observed matches pass, mismatches fail. This is schema compatibility, not live proof.
- Prove call reachability by bypassing resolution or receipt persistence in the actual attempt path:
  targeted tests must turn red, then restore. Test all source launch entrypoints from the inspected
  inventory and ensure no default-agent fallback survives a failing resolver.
- Run go test ./..., go vet ./... and build the dispatcher. Add an actual CI workflow if Orchid has
  none; an empty checks array is not a pass. No added Go dependency or NetScript build dependency in
  Harness. Independent exact-head implementation evaluation and supervisor sign-off precede merge.
- Live rollout remains a separate controlled acceptance: one real dispatch, independently observed
  requested/observed record, refuse malformed/unauthorized requests, and verify complete coverage of
  the deployed launcher inventory. Source tests cannot claim this gate passed.

## Dependencies, risks and owner forks

DAG: independent plan gate → bridge/common spawn path → tests and actual CI → independent source
review → supervisor sign-off → separately authorized live acceptance. NetScript is read-only and
consumed in place. This is an upstream Orchid PR; the original Harness checkout stays untouched.

Risks: silent alternate launcher (single effect boundary and bypass control); mismatched source
revision (clean/unchanged source check); untrusted authority (private metadata and refusal tests);
false model/session observation (unknown, no certification); private publication (fixed diagnostics
and staged diff audit); rollout disruption from strict metadata (no deployment in this source PR).

Owner forks 3 and 4 are open in plan.md: observation/bootstrap source and explicit-pin semantics.
No Orchid source mutation until those are ratified. The initial upstream ownership question remains
unanswered; the user's section-11 assignment supports this isolated preparation. No deployment or
supervisor sign-off is inferred. The six review corrections above are incorporated in this draft;
its source-mutation gate remains pending the owner forks, not falsely marked PASS.
