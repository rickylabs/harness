/**
 * Test support for the `provider-uhp` suites: the defects transcribed, the fixtures, and the harness
 * that stands a loopback UHP mock up behind a real provider. Not a test file, so the runner does not
 * collect it, and not exported from `index.ts`, like `uhp-mock.ts`.
 *
 * The suites and what they prove are described in `uhp-provider.test.ts`.
 */

import assert from "node:assert/strict";
import { afterEach } from "node:test";

import { createUhpProvider, type UhpDiagnostic, type UhpProvider } from "../uhp-provider.js";
import { createUhpTransport } from "../uhp-transport.js";
import { parseHarnessManifest, type HarnessManifest } from "../uhp-harnesses.js";
import { compareRouteIdentity, type RouteIdentityEvidence } from "../route.js";
import { observeUhpRoute, uhpRouteNegatives, uhpRouteVerdict } from "../uhp-gate.js";
import type { DispatchVerdict } from "../provider.js";
import type { DispatchRequest } from "../dispatch.js";
import {
  startUhpServer,
  type UhpCreateRequest,
  type UhpJsonReply,
  type UhpMock,
  type UhpReply,
  type UhpResponse,
} from "../uhp-mock.js";

/* -------------------------------------------------------------------------------------------------
 * The defects, transcribed. Each one is run on the same input as the real thing.
 * ---------------------------------------------------------------------------------------------- */

/**
 * DEFECT: the codex refusal ladder (`packages/providers/codex/src/application/start-turn.ts`), transplanted.
 *
 * Correct where all four route fields are observable. Over UHP the first branch always wins, so a
 * substituted model is reported as "we could not tell" instead of "the server contradicted the request".
 */
export function verdictByCodexLadder(evidence: RouteIdentityEvidence): DispatchVerdict {
  if (evidence.status === "unknown") return "unknown";
  if (evidence.status === "mismatch") return "refused";
  return "accepted";
}

/** DEFECT: a substitution gate keyed on the status. Over UHP it never fires. */
export function substitutionDetectedByStatus(evidence: RouteIdentityEvidence): boolean {
  return evidence.status === "mismatch";
}

/**
 * DEFECT: deriving the verdict from the route comparison alone, ignoring what the server said about
 * itself.
 *
 * This one is subtler than the ladder and it is the reason `statedContradictions` exists. A server that
 * reports `model_fallback: true` while `model` happens to equal the requested id produces no difference for
 * `compareRouteIdentity` to see — the comparison is of two equal strings — so a gate reading only
 * `evidence.mismatches` answers `unknown` on a response that says in writing that it substituted.
 */
export function verdictFromRouteEvidenceAlone(evidence: RouteIdentityEvidence): DispatchVerdict {
  return uhpRouteVerdict(uhpRouteNegatives(evidence));
}

/* -------------------------------------------------------------------------------------------------
 * Fixtures
 * ---------------------------------------------------------------------------------------------- */

/** A sentinel that is not a credential and never was. It exists to be searched for in a payload. */
export const TOKEN = "sentinel-value-that-is-not-a-credential";
export const PROFILE = "HARNESSROUTER_API_KEY";

/** An absolute path, because the point of the boundary tests is that one never crosses it. */
export const CWD = "/fixture/projects/harness/.claude/worktrees/agent-test-0001";

export const MODEL_PROVIDER = "anthropic";
export const MODEL = "claude-opus-5";
export const SUBSTITUTE = "claude-sonnet-5";
export const SESSION = "sess_test_0001";

export const PINNED_IDS = {
  claude: "chrn_e37claude",
  codex: "chrn_e37codex",
  "codex-run": "chrn_e37codexrun",
  opencode: "chrn_e37opencode",
  "opencode-run": "chrn_e37opencoderun",
} as const;

export function manifestDocument(): Record<string, unknown> {
  return {
    version: 1,
    protocol: "2026-08-11",
    reconciledAt: "2026-09-12T09:00:00.000Z",
    reconciledAgainst: "the loopback mock in uhp-mock.ts, which is not a router",
    harnesses: [
      { harness: "claude", id: PINNED_IDS.claude, base: "claude-code", defaultModel: null },
      { harness: "codex", id: PINNED_IDS.codex, base: "codex", defaultModel: null },
      { harness: "codex-run", id: PINNED_IDS["codex-run"], base: "codex", defaultModel: null },
      { harness: "opencode", id: PINNED_IDS.opencode, base: "opencode", defaultModel: null },
      { harness: "opencode-run", id: PINNED_IDS["opencode-run"], base: "opencode", defaultModel: null },
    ],
  };
}

export function manifest(document: Record<string, unknown> = manifestDocument()): HarnessManifest {
  const parsed = parseHarnessManifest(document);
  assert.equal(parsed.ok, true, "the fixture manifest must parse or every test below is about the wrong thing");
  if (!parsed.ok) throw new Error("unreachable");
  return parsed.manifest;
}

/** The console listing that agrees with the pinned manifest on every compared field. */
export function agreeingListing(): UhpJsonReply {
  return {
    httpStatus: 200,
    body: {
      harnesses: manifestDocument().harnesses instanceof Array
        ? (manifestDocument().harnesses as readonly Record<string, unknown>[]).map((entry) => ({
          id: entry["id"],
          object: "harness",
          name: `console object for ${String(entry["harness"])}`,
          base: entry["base"],
          createdAt: 1_786_403_298_205,
        }))
        : [],
    },
  };
}

/** A response with our session id and whatever else a case needs. */
export function response(over: Partial<UhpResponse> = {}): UhpResponse {
  return {
    id: "resp_test_0001",
    object: "response",
    created_at: 1_757_635_200,
    status: "in_progress",
    output: [],
    model: MODEL,
    metadata: { session_id: SESSION },
    ...over,
  };
}

export const request: DispatchRequest = {
  harness: "claude",
  model: MODEL,
  effort: "xhigh",
  prompt: "summarise the run notes",
};

export interface Harnessed {
  readonly provider: UhpProvider;
  readonly mock: UhpMock;
  /** Every task body the server received, in order. Zero is the assertion some tests need. */
  readonly tasks: readonly UhpCreateRequest[];
  readonly diagnostics: readonly UhpDiagnostic[];
}

export interface HarnessOptions {
  readonly task?: (request: UhpCreateRequest, index: number) => UhpReply;
  readonly listing?: () => UhpJsonReply;
  readonly read?: (responseId: string) => UhpJsonReply;
  readonly cancel?: (responseId: string) => UhpJsonReply;
  readonly manifest?: HarnessManifest;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
}

export const servers: UhpMock[] = [];

afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
});

export async function harnessed(options: HarnessOptions = {}): Promise<Harnessed> {
  const tasks: UhpCreateRequest[] = [];
  const diagnostics: UhpDiagnostic[] = [];
  const mock = await startUhpServer(
    (body) => {
      const index = tasks.length;
      tasks.push(body);
      return options.task?.(body, index) ?? { httpStatus: 200, response: response() };
    },
    {
      harnesses: options.listing ?? agreeingListing,
      ...(options.read === undefined ? {} : { read: options.read }),
      ...(options.cancel === undefined ? {} : { cancel: options.cancel }),
    },
  );
  servers.push(mock);
  const provider = createUhpProvider({
    transport: createUhpTransport({
      baseUrl: `${mock.origin}/v1`,
      credentialProfile: PROFILE,
      env: options.env ?? { [PROFILE]: TOKEN },
    }),
    manifest: options.manifest ?? manifest(),
    modelProvider: MODEL_PROVIDER,
    cwd: options.cwd ?? CWD,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  return { provider, mock, tasks, diagnostics };
}

/** The route evidence a given served response produces against this suite's request. */
export function evidenceFor(served: UhpResponse): RouteIdentityEvidence {
  return compareRouteIdentity(
    { provider: MODEL_PROVIDER, model: MODEL, effort: "xhigh", cwd: CWD },
    observeUhpRoute(served),
  );
}

/* -------------------------------------------------------------------------------------------------
 * What the provider says about itself
 * ---------------------------------------------------------------------------------------------- */
