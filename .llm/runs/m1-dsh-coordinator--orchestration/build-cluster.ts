// Generates the Step 0 + Stage A milestone-cluster artifacts for
// rickylabs/harness M1 from the live GitHub board. Re-runnable.

const REPO = "rickylabs/harness";
const MILESTONE = "M1 — dsh coordinator foundation";
const BASELINE = "b7d5e586e32f31ef44cab7b1327ab890f8e23794";
const RUN = "m1-dsh-coordinator--orchestration";
const OUT = decodeURIComponent(new URL(".", import.meta.url).pathname).replace(/^[\/](?=[A-Za-z]:)/, "").replace(/\/$/, "");

const NOW = new Date();
const iso = (d: Date) => d.toISOString();
const NOW_ISO = iso(NOW);
const NEXT_REPORT = iso(new Date(NOW.getTime() + 55 * 60_000));

const COORD = "claude-opus-5/desktop/5dc200b1";

async function gh(args: string[]): Promise<string> {
  const out = await new Deno.Command("gh", { args, stdout: "piped", stderr: "piped" })
    .output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return new TextDecoder().decode(out.stdout);
}

type Issue = {
  number: number;
  title: string;
  labels: { name: string }[];
};

const issues = JSON.parse(
  await gh([
    "issue", "list", "-R", REPO, "--milestone", MILESTONE, "--state", "all",
    "--limit", "300", "--json", "number,title,labels",
  ]),
) as Issue[];
issues.sort((a, b) => a.number - b.number);

const laneOf = (i: Issue) => {
  const l = i.labels.map((x) => x.name).find((n) => n.startsWith("topic:"));
  if (!l) throw new Error(`#${i.number} has no topic: label`);
  return l.slice("topic:".length);
};

const numbers = issues.map((i) => i.number);
const byLane: Record<string, number[]> = { docs: [], internals: [], fixes: [], features: [] };
for (const i of issues) byLane[laneOf(i)].push(i.number);

// ------------------------------------------------------------------ waves
// Cross-wave edges only. Intra-wave ordering belongs to the topic orchestrator.
const WAVES: Array<{ index: number; title: string; issues: number[] }> = [
  { index: 0, title: "Foundation — the workspace the rest attaches to", issues: [40, 41, 42, 43, 44, 45] },
  { index: 1, title: "Shell, contract and the blocking decision", issues: [46, 47, 48, 49, 50, 51, 62] },
  { index: 2, title: "Both seams — subagent providers and the model gateway", issues: [52, 53, 54, 55, 56, 57, 58, 59, 60, 61] },
  { index: 3, title: "Governance and the coordinator", issues: [63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73] },
  { index: 4, title: "Forge and the published contract", issues: [74, 75, 76, 77, 78, 79, 80, 81, 82] },
  { index: 5, title: "Telemetry — the \"status ?\" killer", issues: [83, 84, 85, 86, 87, 88] },
];

const EDGES: Array<[number, number, string, string]> = [
  [40, 46, "requires", "the dsh profile package needs the pnpm workspace"],
  [40, 51, "requires", "the DispatchRequest contract needs the workspace"],
  [46, 52, "requires", "providers attach to the rickylabs profile"],
  [46, 53, "requires", "providers attach to the rickylabs profile"],
  [46, 54, "requires", "providers attach to the rickylabs profile"],
  [46, 55, "requires", "providers attach to the rickylabs profile"],
  [51, 52, "requires", "every provider implements the shared contract"],
  [51, 53, "requires", "every provider implements the shared contract"],
  [51, 54, "requires", "every provider implements the shared contract"],
  [51, 55, "requires", "every provider implements the shared contract"],
  [51, 56, "requires", "the lease is keyed on the contract's run id"],
  [48, 57, "requires", "the adapters point at endpoints the compose file defines"],
  [62, 63, "cross-epic-order", "the sandboxctl channel decision gates every governance task"],
  [62, 64, "cross-epic-order", "the sandboxctl channel decision gates every governance task"],
  [62, 65, "cross-epic-order", "the sandboxctl channel decision gates every governance task"],
  [62, 66, "requires", "the gate cannot be wired before its execution channel exists"],
  [62, 67, "cross-epic-order", "the sandboxctl channel decision gates every governance task"],
  [51, 69, "requires", "the coordinator workflows emit the shared contract"],
  [51, 70, "requires", "the /swarm payload is the contract's wire form"],
  [58, 72, "requires", "evaluator independence is selected from the routing matrix"],
  [69, 74, "requires", "the forge bridge consumes coordinator workflows"],
  [70, 76, "requires", "the dispatch selector routes the one payload"],
  [68, 79, "requires", "the published contract exposes the board model"],
  [79, 83, "requires", "the telemetry sink emits the published event union"],
  [79, 84, "requires", "remote.mux push uses the published routes"],
  [80, 84, "requires", "replay semantics are defined by the snapshot/delta shapes"],
  [63, 87, "requires", "governance state must exist before it can be surfaced"],
  [65, 87, "requires", "local-capacity headroom must exist before it can be surfaced"],
  [56, 86, "requires", "disk backfill is keyed on our run id, not a vendor session id"],
];

const waveOf = new Map<number, number>();
for (const w of WAVES) for (const n of w.issues) waveOf.set(n, w.index);

// sanity: every milestone issue is in exactly one wave, and vice versa
const inWaves = WAVES.flatMap((w) => w.issues).sort((a, b) => a - b);
if (JSON.stringify(inWaves) !== JSON.stringify([...numbers].sort((a, b) => a - b))) {
  throw new Error(
    `wave membership != milestone membership\n waves: ${inWaves}\n board: ${numbers}`,
  );
}
for (const [from, to] of EDGES) {
  if (waveOf.get(from)! >= waveOf.get(to)!) {
    throw new Error(`edge ${from} -> ${to} does not cross a wave boundary`);
  }
}

// ------------------------------------------------------------------ intake
const epics = [31, 32, 33, 34, 35, 36, 37, 38, 39];
const intake = {
  schemaVersion: 1,
  repo: REPO,
  milestone: MILESTONE,
  capturedAt: NOW_ISO,
  baselineMainSha: BASELINE,
  ownerRatifiedAt: NOW_ISO,
  ownerRatification: {
    ratifiedBy: "owner (chautems-eric)",
    instrument:
      "Owner instruction in session 5dc200b1: \"once the epic and sub issues are created enable orchestrator profile mode using the updated harness and AGENTIC toolchain we just merged\", following owner ratification of the four structural decisions recorded on #30.",
    note:
      "The board this intake freezes was itself filed under that instruction; the epics and their sub-issues are the owner-approved scope, not external candidates pulled in by the coordinator.",
  },
  sources: {
    targetMilestone: true,
    unmilestoned: true,
    backlog: true,
    laterMilestones: true,
  },
  candidates: [
    ...issues.map((i) => ({
      number: i.number,
      title: i.title,
      source: "targetMilestone",
      decision: "include",
      reason:
        "PR-sized leaf filed under its epic from the owner-ratified roadmap in #30; acceptance is stated on the issue.",
      evidence: [
        `https://github.com/${REPO}/issues/${i.number}`,
        `https://github.com/${REPO}/issues/30`,
      ],
      ownerRatified: true,
    })),
    ...epics.map((n) => ({
      number: n,
      title: `E${n - 30} epic container`,
      source: "unmilestoned",
      decision: "exclude",
      reason:
        "Epic container, deliberately unmilestoned. Its scope enters M1 through its sub-issues, which are all included above; milestoning the epic as well would double-count the burn-down.",
      evidence: [
        `https://github.com/${REPO}/issues/${n}`,
        `https://github.com/${REPO}/issues/30`,
      ],
      ownerRatified: true,
    })),
    {
      number: 30,
      title: "E0 — Roadmap",
      source: "unmilestoned",
      decision: "exclude",
      reason:
        "The architecture record and decision log for the whole programme. It outlives M1 and closes when the roadmap does, not when this milestone cuts.",
      evidence: [`https://github.com/${REPO}/issues/30`],
      ownerRatified: true,
    },
  ],
};

// --------------------------------------------------------------- inventory
const inventory = {
  schemaVersion: 1,
  repo: REPO,
  milestone: MILESTONE,
  capturedAt: NOW_ISO,
  baselineMainSha: BASELINE,
  ownerRatifiedAt: NOW_ISO,
  targetIssueCount: issues.length,
  issues: issues.map((i) => ({
    number: i.number,
    title: i.title,
    disposition: "active",
    lane: laneOf(i),
    epic: 30 + Number(i.title.match(/^E(\d)\./)?.[1] ?? 0),
  })),
};

// --------------------------------------------------------------------- DAG
const dag = {
  schemaVersion: 1,
  milestone: MILESTONE,
  baselineMainSha: BASELINE,
  nodes: issues.map((i) => ({
    id: `issue:${i.number}`,
    kind: "issue",
    issueNumber: i.number,
    lane: laneOf(i),
    title: i.title,
  })),
  edges: EDGES.map(([from, to, kind, reason]) => ({
    from: `issue:${from}`,
    to: `issue:${to}`,
    kind,
    reason,
  })),
  waves: WAVES.map((w) => ({
    index: w.index,
    title: w.title,
    nodeIds: w.issues.map((n) => `issue:${n}`),
  })),
};

// ------------------------------------------------------------------- state
const laneNext: Record<string, string> = {
  docs:
    "Wave 0: take #42 (doctrine port to doctrine/) and #43 (root agent entry points) as one leaf; #45 is a written decision, not code.",
  internals:
    "Wave 0: dispatch #40 (pnpm workspace) as the first leaf — every other wave-0 and wave-1 node depends on it.",
  fixes:
    "Idle by design in wave 0. #67 lands in wave 3; defects filed from inside the run enter this lane at a re-intake checkpoint.",
  features:
    "Blocked until wave 1 lands #51 (DispatchRequest). No features leaf may be dispatched before then.",
};

const state = {
  schemaVersion: 2,
  milestone: MILESTONE,
  baselineMainSha: BASELINE,
  currentMainSha: BASELINE,
  coordinator: { agentId: COORD },
  limits: {
    activeImplementationSlicesPerLane: 2,
    activeEvaluatorsPerLane: 1,
    globalExpensiveGates: 1,
    releaseWriters: 1,
  },
  lanes: (["docs", "internals", "fixes", "features"] as const).map((id) => ({
    id,
    orchestratorAgentId: `harness-m1/${id}/unbound`,
    issueNumbers: byLane[id],
  })),
  watchers: [],
  committedIssues: issues.map((i) => ({ number: i.number, state: "open" })),
  leaves: [],
  expensiveGates: [],
  canaryCheckpoints: [],
  reporting: {
    cadenceMinutes: 60,
    lastReportAt: NOW_ISO,
    nextReportDueAt: NEXT_REPORT,
    lastReportRef: "worklog.md#stage-a--cluster-bootstrap",
    headline:
      "Step 0 frozen and Stage A bootstrapped: 49 leaves across 6 waves, four topic lanes allocated, zero dispatched. Wave 0 is unblocked; the features lane is correctly idle until #51 lands.",
    currentMainSha: BASELINE,
    canary: {
      target: "harness@0.1.0-next",
      state: "not-planned",
      eta: {
        window: "not scheduled",
        confidence: "high",
        basis:
          "This repository publishes nothing yet. The first meaningful canary is the wave-1 boundary, when a dsh instance boots the rickylabs profile on the N5 (#49) — there is no artifact to canary before that.",
      },
      criticalPath: [],
    },
    progress: {
      mergedPullRequests: [],
      closedIssues: [],
      newIssues: numbers,
      queueDeltaExplanation:
        "Cluster bootstrap. 49 leaf issues filed under epics #31-#39 and frozen into M1; epics and the #30 roadmap deliberately left unmilestoned so the burn-down counts leaves once.",
    },
    scope: {
      openIssueCount: issues.length,
      ownedIssueCount: issues.length,
      scheduledIssueCount: issues.length,
      unscheduledIssueNumbers: [],
      openPullRequestCount: 0,
    },
    mergeQueue: [],
    orchestratorMatrix: (["docs", "internals", "fixes", "features"] as const).map((lane) => ({
      lane,
      state: "queued",
      activeItems: [],
      lastConcreteProgressAt: NOW_ISO,
      blocker: lane === "features"
        ? "Waits on #51 (DispatchRequest) in wave 1 — dispatching earlier would fork the contract."
        : null,
      nextAction: laneNext[lane],
    })),
    blockers: [
      {
        id: "sandboxctl-execution-channel",
        category: "infrastructure",
        summary:
          "sandboxctl runs on the N5 host and the coordinator has no execution channel to it, so the sandbox gate cannot be wired.",
        impact:
          "Wave 3 governance work (#63-#67) cannot start, and the gate that replaces per-tool approval for vendor CLI children has nowhere to live. Everything else proceeds.",
        owner: "owner (chautems-eric)",
        nextAction:
          "Decide #62: an ssh executor held by the coordinator, or a narrow privileged sidecar exposing sandboxctl over HTTP on ai-shared.",
        ownerDecisionRequired: true,
      },
      {
        id: "topic-orchestrators-unbound",
        category: "evaluator-transport",
        summary:
          "The four topic lanes are allocated but no session is bound to any of them; the orchestratorAgentId values carry an explicit /unbound suffix.",
        impact:
          "No implementation or evaluation leaf can be dispatched. This is the correct state for a validated Step 0 that has not yet been told to start work.",
        owner: "coordinator",
        nextAction:
          "On the owner's go, bind the lanes per lane-policy.md and record the real session identity, worktree and PR head on each leaf before dispatch.",
        ownerDecisionRequired: true,
      },
    ],
    environment: {
      checkedAt: NOW_ISO,
      aspireApplications: 0,
      dockerContainers: 0,
      dockerCustomNetworks: 0,
    },
    ownerDecisions: [
      {
        id: "start-wave-0",
        question:
          "Bind the four topic lanes and dispatch wave 0, or hold at a validated Step 0?",
        whyOwnerOnly:
          "Dispatching binds subscription quota across accounts and starts real agents on the N5. The gate is green either way; only the owner decides when the spend starts.",
        blockedItems: [40, 41, 42, 43, 44, 45],
      },
      {
        id: "sandboxctl-execution-channel",
        question:
          "ssh executor or privileged sidecar for sandboxctl? The sidecar is narrower and auditable; the ssh executor is zero new code and broad authority.",
        whyOwnerOnly:
          "It grants the coordinator host-level authority on the N5. That is a security posture decision, not an implementation detail.",
        blockedItems: [62, 63, 64, 65, 66, 67],
      },
      {
        id: "canary-shape-for-a-greenfield-repo",
        question:
          "Does a wave boundary with no published artifact still declare a canary point, or does the first canary wait for a booting dsh instance at the wave-1 boundary?",
        whyOwnerOnly:
          "canary-cadence.md records the every-boundary vs surface-gated question as owner-undecided. The skill forbids resolving it by habit inside a run.",
        blockedItems: [],
      },
    ],
  },
  exactMainEvidence: {
    gitHead: BASELINE,
    surface: "repository",
    expectedGateIds: [],
    receipts: [],
  },
  existingReleaseLease: false,
  releaseWriters: [],
  releaseCaptain: {
    state: "inactive",
    agentId: null,
    leaseId: null,
    contentSha: null,
    evidence: [],
  },
  updatedAt: NOW_ISO,
};

// -------------------------------------------------------- PR reconciliation
const prExport = {
  schemaVersion: 1,
  repo: REPO,
  milestone: MILESTONE,
  capturedAt: NOW_ISO,
  pullRequests: [],
};

await Deno.mkdir(`${OUT}/receipts`, { recursive: true });
const w = (name: string, value: unknown) =>
  Deno.writeTextFile(`${OUT}/${name}`, JSON.stringify(value, null, 2) + "\n");
await w("milestone-intake.json", intake);
await w("milestone-inventory.json", inventory);
await w("milestone-dependency-dag.json", dag);
await w("milestone-cluster-state.json", state);
await w("github-prs.json", prExport);
await Deno.writeTextFile(`${OUT}/receipts/.gitkeep`, "");

console.log(`wrote ${OUT}`);
console.log(`issues: ${issues.length}`);
for (const [k, v] of Object.entries(byLane)) console.log(`  ${k.padEnd(10)} ${v.length}`);
console.log(`waves: ${WAVES.map((x) => x.issues.length).join(" / ")}`);
console.log(`edges: ${EDGES.length}`);
