import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { encodeWorkflowRevisionBundle, MAX_ROUTINE_WAKE_COALESCE, readProfileRef, readRoutineRevision,
  readRoutineWake,
  readWorkflowReviewObservation, readWorkflowRevision, readWorkflowRevisionBundle,
  readWorkflowRun } from "./profiles-workflows.js";

const id = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const id3 = "33333333-3333-4333-8333-333333333333";
const id4 = "44444444-4444-4444-8444-444444444444";
const commit = "a".repeat(40), digest = "b".repeat(64), writer = "scope_" + "c".repeat(32);
const at = "2026-09-28T21:25:00.123456789Z";
const profile = { name: "leaf", title: "Implementation teammate", kind: "leaf", role: "implementation", tier: "feature",
  profileRevision: commit, profileDigest: digest, matrixRevision: commit, guardrailDigest: digest,
  budget: { tokenLimit: null, source: "unavailable", reason: "source_not_bound" } } as const;
const phase = { id: "plan", profile, dependsOn: [], parallelCount: 1, writerScopeIds: [writer],
  outputKind: "plan", outputSchemaDigest: digest, verifierRole: "plan_evaluation", maxRounds: 2 } as const;
const workflow = { schema: 1, workflowId: id, revision: digest, createdByRunId: null,
  phases: [phase, { ...phase, id: "review", dependsOn: ["plan"], writerScopeIds: ["scope_" + "d".repeat(32)] }] } as const;
const routine = { schema: 1, routineId: id2, revision: digest, workflowId: id, workflowRevision: digest,
  trigger: { kind: "label", filterDigest: digest }, overlapPolicy: "coalesce", missedRunPolicy: "skip" } as const;
const wake = { schema: 1, routineId: id2, routineRevision: digest, workflowId: id,
  workflowRevision: digest, triggerKind: "label", idempotencyKey: "c".repeat(64),
  coalesceCount: 2, firstObservedAt: at, lastObservedAt: "2026-09-28T21:25:00.123456790Z" } as const;
const unknown = { value: null, source: "unavailable", observedAt: null, reason: "source_not_bound" } as const;
const attempt = { id: id2, phaseId: "plan", state: "blocked", outcome: null, blockKind: "needs_input",
  dispatchId: null, agentId: null, startedAt: null, endedAt: null,
  cost: { runTokens: unknown, meteredUsdMicros: unknown } } as const;
const run = { schema: 1, id: id2, workflowId: id, workflowRevision: digest, scope: { kind: "issue", id },
  state: "blocked", outcome: null, blockKind: "needs_input", attempts: [attempt], finalReportId: null,
  createdAt: at, updatedAt: at } as const;
const fields = (v: { readonly ok: boolean; readonly problems?: readonly { readonly field: string }[] }) =>
  v.ok ? [] : v.problems?.map(p => p.field) ?? [];
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

it("exports canonical revision and decision facts and imports only bound bytes", async () => {
  const next = { ...workflow, revision: "c".repeat(64) };
  const decision = { position: 2, action: "draft_approved", fromRevision: null,
    toRevision: next.revision, decidedAt: at, reasonDigest: digest };
  const prior = { position: 1, action: "draft_approved", fromRevision: null,
    toRevision: workflow.revision, decidedAt: at, reasonDigest: digest };
  const bundle = { schema: 1, kind: "workflow_revision_bundle", workflowId: id,
    revisions: [next, workflow], decisions: [decision, prior] };
  const first = await encodeWorkflowRevisionBundle(bundle, sha256);
  const second = await encodeWorkflowRevisionBundle({ decisions: [prior, decision],
    revisions: [workflow, next], workflowId: id, kind: "workflow_revision_bundle", schema: 1 }, sha256);
  assert.equal(first.ok, true);
  assert.deepEqual(first, second);
  if (!first.ok) return;
  const imported = await readWorkflowRevisionBundle(first.value, sha256);
  assert.equal(imported.ok, true);
  if (imported.ok) {
    assert.deepEqual(imported.value.revisions.map(row => row.revision), [digest, next.revision]);
    assert.deepEqual(imported.value.decisions.map(row => row.position), [1, 2]);
    assert.equal(Object.hasOwn(imported.value, "activeRevision"), false);
  }
  const tampered = first.value.replace(`"reasonDigest":"${digest}"`, `"reasonDigest":"${"d".repeat(64)}"`);
  assert.ok(fields(await readWorkflowRevisionBundle(tampered, sha256)).includes("bundle.bundleDigest"));
  assert.ok(fields(await readWorkflowRevisionBundle(`${first.value}\n`, sha256)).includes("bundle"));
  assert.ok(fields(await readWorkflowRevisionBundle(first.value.replace('{"bundleDigest":',
    '{"bundleDigest":"' + "e".repeat(64) + '","bundleDigest":'), sha256)).includes("bundle"));
});

it("refuses unknown ledger revisions, mixed workflows, and instruction text", async () => {
  const base = { schema: 1, kind: "workflow_revision_bundle", workflowId: id,
    revisions: [workflow], decisions: [] };
  assert.ok(fields(await encodeWorkflowRevisionBundle({ ...base, decisions: [{
    position: 0, action: "draft_approved", fromRevision: null, toRevision: "f".repeat(64),
    decidedAt: at, reasonDigest: digest }] }, sha256)).includes("bundle.decisions[0].toRevision"));
  assert.ok(fields(await encodeWorkflowRevisionBundle({ ...base,
    revisions: [{ ...workflow, workflowId: id2 }] }, sha256)).includes("bundle.revisions[0].workflowId"));
  assert.ok(fields(await encodeWorkflowRevisionBundle({ ...base,
    revisions: [{ ...workflow, phases: [{ ...phase, profile: { ...profile,
      instructions: "private fixture" } }] }] }, sha256)).includes("bundle.revisions[0].phases[0].profile.instructions"));
  assert.ok(fields(await encodeWorkflowRevisionBundle({ ...base,
    revisions: [workflow, { ...workflow }] }, sha256)).includes("bundle.revisions"));
  assert.ok(fields(await encodeWorkflowRevisionBundle(base, () => { throw new Error("missing hash"); }))
    .includes("bundle.bundleDigest"));
});

it("reads pinned profile refs and refuses executable metadata or unsourced budget", () => {
  assert.equal(readProfileRef(profile).ok, true);
  assert.ok(fields(readProfileRef({ ...profile, model: "fixture-model" })).includes("profile.model"));
  assert.ok(fields(readProfileRef({ ...profile, profileRevision: "relative/path" })).includes("profile.profileRevision"));
  assert.ok(fields(readProfileRef({ ...profile, budget: { tokenLimit: 0, source: "unavailable", reason: "source_not_bound" } }))
    .includes("profile.budget.tokenLimit"));
  assert.equal(readProfileRef({ ...profile, budget: { tokenLimit: 0, source: "issue-override", reason: null } }).ok, true);
  assert.ok(fields(readProfileRef({ ...profile, kind: "milestone-coordinator" })).includes("profile.kind"));
});

it("reads an immutable DAG and rejects cycles, duplicate phases and writer paths", () => {
  assert.equal(readWorkflowRevision(workflow).ok, true);
  assert.ok(fields(readWorkflowRevision({ ...workflow, phases: [
    { ...phase, dependsOn: ["review"] }, workflow.phases[1] ] })).includes("workflow.phases"));
  assert.ok(fields(readWorkflowRevision({ ...workflow, phases: [phase, { ...phase }] })).includes("workflow.phases"));
  assert.ok(fields(readWorkflowRevision({ ...workflow, phases: [
    { ...phase, writerScopeIds: ["src/private/file.ts"] }] })).includes("workflow.phases[0].writerScopeIds[0]"));
  assert.ok(fields(readWorkflowRevision({ ...workflow, instructions: "raw agent prompt" })).includes("workflow.instructions"));
});

it("binds allow, block and escalate to an ended, separate evaluator attempt", () => {
  const reviewerProfile = { ...profile, name: "plan-reviewer", title: "Plan reviewer",
    role: "plan_evaluation", tier: "straightforward" } as const;
  const reviewerPhase = { ...phase, id: "review", profile: reviewerProfile, dependsOn: ["plan"],
    writerScopeIds: ["scope_" + "d".repeat(32)], outputKind: "report", verifierRole: null } as const;
  const pinned = { ...workflow, phases: [phase, reviewerPhase] };
  const subject = { ...attempt, id: id3, state: "ended", outcome: "succeeded", blockKind: null,
    startedAt: at, endedAt: at } as const;
  const reviewer = { ...subject, id: id4, phaseId: "review",
    endedAt: "2026-09-28T21:25:00.123456790Z" } as const;
  const sourceRun = { ...run, state: "running", blockKind: null, attempts: [subject, reviewer] };
  const observation = { schema: 1, runId: id2, workflowId: id, workflowRevision: digest,
    subjectAttemptId: id3, reviewerAttemptId: id4, status: "observed", verdict: "allow",
    evidenceId: id, observedAt: "2026-09-28T21:25:00.123456791Z" } as const;
  for (const verdict of ["allow", "block", "escalate"])
    assert.equal(readWorkflowReviewObservation({ ...observation, verdict }, sourceRun, pinned).ok, true);
  assert.equal(readWorkflowReviewObservation({ ...observation, status: "reviewer_error",
    verdict: null, evidenceId: null }, sourceRun, pinned).ok, true);
  assert.ok(fields(readWorkflowReviewObservation({ ...observation, status: "reviewer_error" }, sourceRun, pinned))
    .includes("review.verdict"));
  assert.ok(fields(readWorkflowReviewObservation({ ...observation, verdict: null }, sourceRun, pinned))
    .includes("review.verdict"));
  assert.ok(fields(readWorkflowReviewObservation({ ...observation, evidenceId: null }, sourceRun, pinned))
    .includes("review.evidenceId"));
  assert.ok(fields(readWorkflowReviewObservation({ ...observation, reviewerAttemptId: id3 }, sourceRun, pinned))
    .includes("review.reviewerAttemptId"));
  assert.ok(fields(readWorkflowReviewObservation({ ...observation, reviewerAttemptId: id }, sourceRun, pinned))
    .includes("review.reviewerAttemptId"));
  assert.ok(fields(readWorkflowReviewObservation(observation, sourceRun,
    { ...pinned, phases: [phase, { ...reviewerPhase, dependsOn: [] }] }))
    .includes("review.reviewerAttemptId"));
  assert.ok(fields(readWorkflowReviewObservation(observation, sourceRun,
    { ...pinned, phases: [phase, { ...reviewerPhase, profile }] }))
    .includes("review.reviewerAttemptId"));
  assert.ok(fields(readWorkflowReviewObservation(observation, { ...sourceRun,
    attempts: [subject, { ...reviewer, outcome: "failed" }] }, pinned))
    .includes("review.status"));
  assert.ok(fields(readWorkflowReviewObservation(observation, { ...sourceRun,
    attempts: [subject, { ...reviewer, state: "running", outcome: null, endedAt: null }] }, pinned))
    .includes("review.reviewerAttemptId"));
  assert.ok(fields(readWorkflowReviewObservation({ ...observation,
    observedAt: "2026-09-28T21:25:00.123456789Z" }, sourceRun, pinned))
    .includes("review.observedAt"));
  assert.ok(fields(readWorkflowReviewObservation({ ...observation, reviewText: "private fixture" },
    sourceRun, pinned)).includes("review.reviewText"));
  assert.ok(fields(readWorkflowReviewObservation({ ...observation, evidenceId: "private/path" },
    sourceRun, pinned)).includes("review.evidenceId"));
  assert.ok(fields(readWorkflowReviewObservation(observation, sourceRun,
    { ...pinned, revision: "c".repeat(64) })).includes("source.workflowRevision"));
});

it("reads routine policies but not raw filters, paths or an invalid schedule", () => {
  assert.equal(readRoutineRevision(routine).ok, true);
  assert.ok(fields(readRoutineRevision({ ...routine, trigger: { kind: "label", filterDigest: digest,
    label: "harness" } })).includes("routine.trigger.label"));
  assert.ok(fields(readRoutineRevision({ ...routine, trigger: { kind: "schedule", cron: "* * * * *",
    timeZone: "UTC" } })).length === 0);
  assert.ok(fields(readRoutineRevision({ ...routine, trigger: { kind: "schedule", cron: "rm -rf /",
    timeZone: "/private/host" } })).includes("routine.trigger.cron"));
  assert.ok(fields(readRoutineRevision({ ...routine, overlapPolicy: "run_twice" })).includes("routine.overlapPolicy"));
});

it("binds a bounded wake to its routine revision without claiming an effect", () => {
  const read = readRoutineWake(wake, routine);
  assert.equal(read.ok, true);
  if (read.ok) {
    assert.equal(read.value.coalesceCount, 2);
    assert.equal(Object.hasOwn(read.value, "issueCreated"), false);
    assert.equal(Object.hasOwn(read.value, "dispatchId"), false);
  }
  assert.ok(fields(readRoutineWake({ ...wake, routineRevision: "d".repeat(64) }, routine))
    .includes("wake.routineRevision"));
  assert.ok(fields(readRoutineWake({ ...wake, workflowRevision: "d".repeat(64) }, routine))
    .includes("wake.workflowRevision"));
  assert.ok(fields(readRoutineWake({ ...wake, triggerKind: "schedule" }, routine))
    .includes("wake.triggerKind"));
  assert.ok(fields(readRoutineWake(wake, { ...routine, overlapPolicy: "skip" }))
    .includes("wake.coalesceCount"));
  assert.ok(fields(readRoutineWake(wake, { ...routine, trigger: { kind: "label", filterDigest: digest,
    label: "private fixture" } })).includes("source.routine.trigger.label"));
});

it("rejects raw trigger identity, zero or unbounded fan-in, and nanosecond time reversal", () => {
  assert.ok(fields(readRoutineWake({ ...wake, idempotencyKey: "private-event-key" }, routine))
    .includes("wake.idempotencyKey"));
  assert.ok(fields(readRoutineWake({ ...wake, triggerPayload: "private fixture" }, routine))
    .includes("wake.triggerPayload"));
  for (const count of [0, -1, 1.5, MAX_ROUTINE_WAKE_COALESCE + 1])
    assert.ok(fields(readRoutineWake({ ...wake, coalesceCount: count }, routine))
      .includes("wake.coalesceCount"));
  assert.ok(fields(readRoutineWake({ ...wake,
    lastObservedAt: "2026-09-28T21:25:00.123456788Z" }, routine))
    .includes("wake.lastObservedAt"));
});

it("retains blocked claims and separates measured zero from unknown cost", () => {
  assert.equal(readWorkflowRun(run).ok, true);
  assert.ok(fields(readWorkflowRun({ ...run, blockKind: null })).includes("run.blockKind"));
  assert.ok(fields(readWorkflowRun({ ...run, attempts: [{ ...attempt, cost: { ...attempt.cost,
    runTokens: { value: 0, source: "unavailable", observedAt: null, reason: "source_not_bound" } } }] }))
    .includes("run.attempts[0].cost.runTokens.value"));
  const measured = { value: 0, source: "native-usage", observedAt: at, reason: null };
  assert.equal(readWorkflowRun({ ...run, attempts: [{ ...attempt, cost: { ...attempt.cost,
    runTokens: measured } }] }).ok, true);
  assert.ok(fields(readWorkflowRun({ ...run, attempts: [{ ...attempt, cost: { ...attempt.cost,
    meteredUsdMicros: { ...measured, source: "native-usage" } } }] })).includes("run.attempts[0].cost.meteredUsdMicros.source"));
});

it("requires terminal evidence for ended and refuses public raw fields", () => {
  const ended = { ...attempt, state: "ended", outcome: "succeeded", blockKind: null,
    startedAt: at, endedAt: at, dispatchId: "assignment_" + "e".repeat(64), agentId: "agent_" + "f".repeat(64) };
  assert.equal(readWorkflowRun({ ...run, state: "ended", outcome: "succeeded", blockKind: null,
    attempts: [ended], finalReportId: id }).ok, true);
  assert.ok(fields(readWorkflowRun({ ...run, attempts: [{ ...ended, endedAt: null }] }))
    .includes("run.attempts[0].endedAt"));
  assert.ok(fields(readWorkflowRun({ ...run, attempts: [{ ...attempt, state: "pending", blockKind: null,
    startedAt: at }] })).includes("run.attempts[0].startedAt"));
  assert.ok(fields(readWorkflowRun({ ...run, attempts: [{ ...attempt, agentId: "agent_" + "f".repeat(64) }] }))
    .includes("run.attempts[0].agentId"));
  assert.ok(fields(readWorkflowRun({ ...run, finalReportId: id })).includes("run.finalReportId"));
  assert.ok(fields(readWorkflowRun({ ...run, conversation: "private chat" })).includes("run.conversation"));
  assert.ok(fields(readWorkflowRun({ ...run, updatedAt: "2026-09-27T21:25:00.000Z" })).includes("run.updatedAt"));
});

it("returns detached JSON data without touching accessors or retaining callers", () => {
  let accessed = 0;
  const hostile = { ...profile } as Record<string, unknown>;
  Object.defineProperty(hostile, "instructions", { enumerable: true, get() { accessed++; return "private"; } });
  assert.ok(fields(readProfileRef(hostile)).includes("profile"));
  assert.equal(accessed, 0);
  const original = structuredClone(profile) as Record<string, unknown>;
  const accepted = readProfileRef(original);
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    original["title"] = "Changed later";
    assert.equal(accepted.value.title, "Implementation teammate");
  }
});
