/**
 * Admission — the last place a dispatch can be refused for free.
 *
 * `validateDispatch` in `@rickylabs/subagents` refuses a request that leaves a choice implicit: no
 * model, no effort, an empty prompt, a timeout the executor would silently discard. It cannot
 * refuse a *wrong* model, and it says so in its own header — it "does not choose models", because
 * the matrix is the single source of truth and a second copy of it there would be a second answer
 * to a question that must only have one.
 *
 * So the check has to live on this side, and this is the file the routing README has been pointing
 * at: "#34 owns making a wrong id fail loudly there."
 *
 * ## Why the dependency runs this way
 *
 * `routing` already depends on `subagents` — `policy.ts` reads `Harness` and `Router` from it, and
 * `toDispatch` hands back the routing half of a `DispatchRequest`. Adding a `routing` import to
 * `subagents` to put this check beside `validateDispatch` would close that edge into a cycle, which
 * `check:graph` refuses. That constraint happens to point at the right design anyway: admission is a
 * question about the matrix, and the matrix lives here.
 *
 * ## What "before any spend" means
 *
 * Every refusal below is decidable from two tables and the request itself. Nothing here opens a
 * socket, reads a file, or looks at a quota. A dispatch that fails admission has cost a table walk;
 * the same dispatch launched has cost a subscription window, or real money on the relay, and has
 * left a run in the record that nobody selected.
 *
 * The failure this prevents is not a crash. A provider handed an id it does not recognise does not
 * usually fail — it falls back to whatever its own config says, runs to completion, and reports
 * success. The receipt then names a model that never ran. That is the same shape as the empty
 * completion `@rickylabs/llm-local`'s budget floor exists to prevent: a success-coded failure, and
 * the most expensive kind to find later.
 *
 * ## Three ways a model id can be wrong, and they are not the same problem
 *
 * - `unknown-model` — not pinned at all. A typo, or an id belonging to some other system.
 * - `unrouted-model` — pinned, but no lane in the matrix names it. The two `n5air/` seats are here
 *   today: `@rickylabs/llm-local` knows where they can physically run, and no route sends work to
 *   them yet. Pinning an id is not routing it.
 * - `unroutable-model` — pinned and routed, but never to this harness. `opus-5` is real and the
 *   matrix uses it constantly; `agy` is not somewhere it goes.
 *
 * Each one wants a different fix, so each one gets its own refusal rather than a shared "bad model".
 *
 * ## Credential material is refused first, and alone
 *
 * A dispatch is written into a GitHub issue body, into a receipt and into a run log. A credential in
 * the payload is therefore a credential in all three at once, and the third acceptance criterion of
 * #61 is that this cannot happen. The relay key is bound by *profile name* and read from its
 * mode-600 file at launch; nothing in a `/swarm` block ever carries the value.
 *
 * Two details make the guard hold rather than merely exist:
 *
 * - **A payload carrying credential material is refused on that ground alone.** Every other message
 *   below names the offending field's value, and one of those fields is the one holding the secret.
 *   Reporting both would put the key in the refusal, and the refusal is the thing that gets logged.
 * - **No message ever echoes a value longer than the longest name this package knows.** A value
 *   longer than that is not a mistyped id — there is nothing it could be a typo *of* — and the other
 *   thing it is likely to be is a key. Its length is reported instead, which is enough to diagnose a
 *   typo, and the `expected` list names what would have been admitted regardless.
 */

import { HARNESSES, ROUTERS, validateDispatch } from "@rickylabs/subagents";
import type { DispatchRequest } from "@rickylabs/subagents";

import { EFFORTS, isPinnedModel, pinnedModels } from "./models.js";
import type { Effort, Transport } from "./models.js";
import { LANES, ROUTE_POLICY, lanePolicy } from "./policy.js";
import type { Lane, RouteStep } from "./policy.js";

/** Every ground on which a dispatch is refused before it can spend anything. */
export const ADMISSION_REFUSALS = [
  /** Credential material in a field that reaches an issue body, a receipt or a log. */
  "credential-in-payload",
  /** `validateDispatch` itself refused it: a missing field, a bad encoding, a dropped timeout. */
  "malformed",
  /** Not an id this package pins. Nothing can say where it goes. */
  "unknown-model",
  /** Pinned, but no lane routes it. There is no step to inherit a transport or a profile from. */
  "unrouted-model",
  /** Routed, but never to this harness. */
  "unroutable-model",
  /** A relay-only model addressed at a router that does not serve it. */
  "wrong-router",
  /** A relay model with nothing naming which credential binds it. */
  "unbound-credential",
  /** Not a rung on the effort ladder. */
  "unknown-effort",
  /** A lane the matrix does not route. */
  "unknown-lane",
  /** The lane routes, but not to this model, or not to it through this harness. */
  "lane-model-mismatch",
  /** The lane routes to this model, but never at this effort. */
  "undeclared-effort",
] as const;
export type AdmissionRefusal = (typeof ADMISSION_REFUSALS)[number];

/** One reason a dispatch was refused. */
export interface AdmissionProblem {
  readonly reason: AdmissionRefusal;
  /**
   * Safe to print, in full, anywhere the dispatch itself would have gone.
   *
   * It names fields, shapes and vocabulary; it never carries the value of a field that could be
   * holding a secret. That is a property of the whole module, not of each call site that logs one.
   */
  readonly message: string;
  /** What would have been admitted here — ids, lanes, efforts or profiles, per the refusal. */
  readonly expected?: readonly string[];
}

/** What the coordinator knows about the dispatch beyond the payload itself. */
export interface AdmissionContext {
  /**
   * The lane this dispatch is the launch of.
   *
   * Optional because not every dispatch is lane-driven — a forge scaffold or an operator's own
   * `/swarm` block is not. Supplying it turns on the stricter half of the gate: the model, the
   * harness and the effort must be ones that lane actually declares.
   */
  readonly lane?: string;
}

/** The verdict. `ok: false` always carries at least one problem. */
export type Admission =
  | { readonly ok: true; readonly dispatch: DispatchRequest }
  | { readonly ok: false; readonly problems: readonly AdmissionProblem[] };

/** Every step in the matrix, flattened, with the lane it came from. */
const ALL_STEPS: readonly { readonly lane: Lane; readonly step: RouteStep }[] = ROUTE_POLICY.flatMap(
  (policy) => policy.chain.map((step) => ({ lane: policy.lane, step })),
);

/**
 * The interactive harness a `-run` form is the non-interactive twin of.
 *
 * The matrix names `codex` and `opencode`; the `-run` variants are the same seam launched without a
 * terminal, supervised by PR path and deadline instead. Treating them as different harnesses would
 * make every non-interactive dispatch unroutable, which is not what the table means — `policy.ts`
 * already pairs `codex` with `codex-run` in `DEEP_RESEARCH_HARNESSES` for exactly this reason.
 */
const INTERACTIVE_TWIN: ReadonlyMap<string, string> = new Map([
  ["codex-run", "codex"],
  ["opencode-run", "opencode"],
]);

function baseHarness(harness: string): string {
  return INTERACTIVE_TWIN.get(harness) ?? harness;
}

/** Every model the matrix routes anywhere, in table order. */
export function routedModels(): readonly string[] {
  const models: string[] = [];
  for (const { step } of ALL_STEPS) {
    if (!models.includes(step.route.model)) models.push(step.route.model);
  }
  return models;
}

/**
 * The models the matrix sends to a harness, optionally narrowed to one router.
 *
 * This is the answer to "the valid ids for that route" that the second acceptance criterion asks a
 * refusal to name. Derived from the table on every call rather than indexed once: the walk is
 * thirty-odd steps, and an index is a second copy of the matrix that can go stale.
 */
export function routableModels(harness: string, router?: string): readonly string[] {
  const base = baseHarness(harness);
  const models: string[] = [];
  for (const { step } of ALL_STEPS) {
    const { route } = step;
    if (baseHarness(route.harness) !== base) continue;
    if (router !== undefined && route.router !== undefined && route.router !== router) continue;
    if (!models.includes(route.model)) models.push(route.model);
  }
  return models;
}

/** The transports the matrix reaches a model over. Empty for a model no lane routes. */
export function transportsFor(model: string): readonly Transport[] {
  const transports: Transport[] = [];
  for (const { step } of ALL_STEPS) {
    if (step.route.model !== model) continue;
    if (!transports.includes(step.route.transport)) transports.push(step.route.transport);
  }
  return transports;
}

/**
 * Every provider profile the matrix names.
 *
 * A profile is an identifier for a credential, never the credential. Listing them in a refusal is
 * how the gate tells an operator what to write without anything having read a key.
 */
export function relayProfiles(): readonly string[] {
  const profiles: string[] = [];
  for (const { step } of ALL_STEPS) {
    const { profile } = step.route;
    if (profile !== undefined && !profiles.includes(profile)) profiles.push(profile);
  }
  return profiles;
}

/** The models one lane routes, optionally narrowed to the steps that use a given harness. */
export function laneModels(lane: string, harness?: string): readonly string[] {
  const policy = lanePolicy(lane);
  if (policy === null) return [];
  const base = harness === undefined ? undefined : baseHarness(harness);
  const models: string[] = [];
  for (const step of policy.chain) {
    if (base !== undefined && baseHarness(step.route.harness) !== base) continue;
    if (!models.includes(step.route.model)) models.push(step.route.model);
  }
  return models;
}

/**
 * The efforts a lane declares for one model on one harness.
 *
 * Includes declared escalations, because a step that says it may go to `high` on a large changeset
 * has declared `high`. It includes nothing else, which is the point: an effort outside this list is
 * an escalation nobody wrote down, and `resolve.ts` refuses those rather than approximating upward.
 */
function declaredEfforts(lane: string, model: string, harness: string): readonly Effort[] {
  const policy = lanePolicy(lane);
  if (policy === null) return [];
  const base = baseHarness(harness);
  const efforts: Effort[] = [];
  for (const step of policy.chain) {
    if (step.route.model !== model) continue;
    if (baseHarness(step.route.harness) !== base) continue;
    if (!efforts.includes(step.route.effort)) efforts.push(step.route.effort);
    for (const escalation of step.effortEscalations ?? []) {
      if (!efforts.includes(escalation.effort)) efforts.push(escalation.effort);
    }
  }
  return efforts;
}

/**
 * The longest name this package could be talking about.
 *
 * Derived rather than picked, so it tracks the vocabulary instead of drifting from it. A rejected
 * value longer than this is not a mistyped id — there is no name it could be a typo of — so echoing
 * it into a log buys nothing and risks echoing a key.
 */
const LONGEST_NAME: number = [
  ...pinnedModels(),
  ...LANES,
  ...EFFORTS,
  ...relayProfiles(),
  ...ROUTERS,
  ...HARNESSES,
].reduce((longest, name) => (name.length > longest ? name.length : longest), 0);

/** Quote a value for a message, or describe it if it is too long to be a name. */
function echo(value: string): string {
  if (value.length <= LONGEST_NAME) return JSON.stringify(value);
  return `a ${String(value.length)}-character value`;
}

/** A credential shape, named so a refusal can say what it saw without repeating it. */
interface CredentialShape {
  readonly shape: string;
  readonly pattern: RegExp;
}

/**
 * Shapes distinctive enough to be worth failing closed on.
 *
 * Structural prefixes only. A generic "long random string" test would refuse legitimate briefs, and
 * a gate that operators learn to work around is worse than no gate. The one that matters in this
 * fleet is the first: an OpenRouter key is `sk-or-v1-` followed by a long hex run.
 */
const KEY_SHAPES: readonly CredentialShape[] = [
  { shape: "an sk- API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { shape: "a GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { shape: "a GitHub fine-grained token", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { shape: "a Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{16,}/ },
  { shape: "an AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { shape: "a Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { shape: "a bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i },
  { shape: "a private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

/**
 * A `name = value` credential assignment, checked on the key block only.
 *
 * The key-block fields are matrix-derived and short; nothing legitimate in one looks like this. The
 * prompt is operator prose, where the same pattern would eventually refuse a brief that is only
 * *discussing* a credential — so the prompt gets the structural shapes above and not this one.
 */
const ASSIGNMENT_SHAPE: CredentialShape = {
  shape: "a credential assignment",
  pattern: /\b(?:api[_-]?keys?|secrets?|tokens?|passwords?|authorization)\b\s*[:=]\s*\S{12,}/i,
};

/** The fields that become the `/swarm` key block, in wire order. */
const KEY_BLOCK_FIELDS = [
  ["harness", (d: DispatchRequest) => d.harness],
  ["model", (d: DispatchRequest) => d.model],
  ["effort", (d: DispatchRequest) => d.effort],
  ["max-tokens", (d: DispatchRequest) => d.maxTokens],
  ["profile", (d: DispatchRequest) => d.profile],
  ["timeout", (d: DispatchRequest) => d.timeout],
  ["router", (d: DispatchRequest) => d.router],
] as const;

function matchShape(value: string, shapes: readonly CredentialShape[]): string | null {
  for (const candidate of shapes) {
    if (candidate.pattern.test(value)) return candidate.shape;
  }
  return null;
}

function credentialProblem(field: string, shape: string): AdmissionProblem {
  return {
    reason: "credential-in-payload",
    message:
      `${field} contains ${shape}. A dispatch is written into an issue body, a receipt and a run ` +
      "log, so a credential in one is a credential in all three. The relay key is bound by profile " +
      "name and read from its mode-600 file at launch; nothing in the payload ever carries a value.",
  };
}

/** Every field carrying something shaped like a credential. Checked before anything else. */
function credentialProblems(dispatch: DispatchRequest): readonly AdmissionProblem[] {
  const problems: AdmissionProblem[] = [];
  const keyBlockShapes = [...KEY_SHAPES, ASSIGNMENT_SHAPE];

  for (const [field, read] of KEY_BLOCK_FIELDS) {
    const value = read(dispatch);
    if (value === undefined || value === "") continue;
    const shape = matchShape(value, keyBlockShapes);
    if (shape !== null) problems.push(credentialProblem(field, shape));
  }

  const inPrompt = matchShape(dispatch.prompt, KEY_SHAPES);
  if (inPrompt !== null) problems.push(credentialProblem("prompt", inPrompt));

  return problems;
}

function isEffort(value: string): value is Effort {
  return EFFORTS.some((effort) => effort === value);
}

/** Everything the matrix can say about a model id, independent of any lane. */
function modelProblems(dispatch: DispatchRequest, model: string): readonly AdmissionProblem[] {
  const forRoute = routableModels(dispatch.harness, dispatch.router);
  const forHarness = routableModels(dispatch.harness);
  const expected = forRoute.length > 0 ? forRoute : forHarness.length > 0 ? forHarness : routedModels();

  if (!isPinnedModel(model)) {
    return [
      {
        reason: "unknown-model",
        message:
          `model ${echo(model)} is not one routing pins, so nothing can say where it goes. A ` +
          "provider handed an id it does not recognise falls back to its own config, runs to " +
          "completion and reports success, and the receipt then names a model that never ran.",
        expected,
      },
    ];
  }

  const transports = transportsFor(model);
  if (transports.length === 0) {
    return [
      {
        reason: "unrouted-model",
        message:
          `model ${echo(model)} is pinned but no lane in the matrix routes it, so there is no step ` +
          "to take a transport, a profile or an effort from. Pinning an id is not routing it.",
        expected,
      },
    ];
  }

  const problems: AdmissionProblem[] = [];

  if (!forRoute.includes(model)) {
    const where =
      dispatch.router === undefined
        ? `to ${echo(dispatch.harness)}`
        : `to ${echo(dispatch.harness)} over ${echo(dispatch.router)}`;
    problems.push({
      reason: "unroutable-model",
      message: `the matrix never sends ${echo(model)} ${where}`,
      expected,
    });
  }

  const relayOnly = transports.every((transport) => transport === "openrouter");
  if (relayOnly) {
    if (dispatch.router !== undefined && dispatch.router !== "openrouter") {
      problems.push({
        reason: "wrong-router",
        message:
          `${echo(model)} is reached over the relay only, and router ${echo(dispatch.router)} ` +
          "would look for it on a box that does not serve it.",
        expected: ["openrouter"],
      });
    }
    // An opencode run addresses the relay through its own router key rather than through a profile;
    // `validateDispatch` is the one that insists it names that router.
    const isOpencode = baseHarness(dispatch.harness) === "opencode";
    if (!isOpencode && (dispatch.profile === undefined || dispatch.profile === "")) {
      problems.push({
        reason: "unbound-credential",
        message:
          `${echo(model)} is a relay model and the request names no profile. The profile is what ` +
          "binds the credential, and a relay call with nothing bound either fails at the gateway " +
          "or picks up whichever ambient key is lying around, which nobody chose.",
        expected: relayProfiles(),
      });
    }
  }

  return problems;
}

/** Everything that only makes sense once the coordinator says which lane this is. */
function laneProblems(
  dispatch: DispatchRequest,
  lane: string,
  model: string | undefined,
  effort: string | undefined,
): readonly AdmissionProblem[] {
  if (lanePolicy(lane) === null) {
    return [
      {
        reason: "unknown-lane",
        message: `lane ${echo(lane)} is not one the matrix routes`,
        expected: [...LANES],
      },
    ];
  }
  if (model === undefined || model === "") return [];

  const anyStep = laneModels(lane);
  if (!anyStep.includes(model)) {
    return [
      {
        reason: "lane-model-mismatch",
        message: `lane ${echo(lane)} has no step that routes ${echo(model)}`,
        expected: anyStep,
      },
    ];
  }

  const onHarness = laneModels(lane, dispatch.harness);
  if (!onHarness.includes(model)) {
    return [
      {
        reason: "lane-model-mismatch",
        message:
          `lane ${echo(lane)} routes ${echo(model)}, but never through ${echo(dispatch.harness)}`,
        expected: onHarness.length > 0 ? onHarness : anyStep,
      },
    ];
  }

  if (effort === undefined || effort === "") return [];
  const declared = declaredEfforts(lane, model, dispatch.harness);
  if (!declared.some((candidate) => candidate === effort)) {
    return [
      {
        reason: "undeclared-effort",
        message:
          `lane ${echo(lane)} runs ${echo(model)} at ${declared.join(" or ")}. ${echo(effort)} is ` +
          "an escalation no step declares, and an undeclared escalation is refused rather than " +
          "inferred.",
        expected: [...declared],
      },
    ];
  }

  return [];
}

/**
 * Admit a dispatch, or say why not.
 *
 * Composes `validateDispatch` — which owns the wire format and the fields that must be present —
 * with everything only the matrix can answer. A verdict rather than a throw, for the same reason
 * `checkPolicy` and `resolveRoute` return one: at the coordinator a refused dispatch is a routing
 * fact to record and fall back from, not an exception to unwind a run around.
 */
export function admitDispatch(dispatch: DispatchRequest, context: AdmissionContext = {}): Admission {
  const carried = credentialProblems(dispatch);
  if (carried.length > 0) return { ok: false, problems: carried };

  const problems: AdmissionProblem[] = validateDispatch(dispatch).map((message) => ({
    reason: "malformed",
    message,
  }));

  const { model, effort } = dispatch;

  if (model !== undefined && model !== "") {
    problems.push(...modelProblems(dispatch, model));
  }
  if (effort !== undefined && effort !== "" && !isEffort(effort)) {
    problems.push({
      reason: "unknown-effort",
      message: `effort ${echo(effort)} is not a rung on the ladder`,
      expected: [...EFFORTS],
    });
  }
  if (context.lane !== undefined) {
    problems.push(...laneProblems(dispatch, context.lane, model, effort));
  }

  if (problems.length === 0) return { ok: true, dispatch };
  return { ok: false, problems };
}

/**
 * A refusal as one block of text, safe to write into a receipt or a comment.
 *
 * Safe because every message it concatenates is: credential material short-circuits admission, and
 * no other message echoes a value longer than a name.
 */
export function describeAdmission(admission: Admission): string {
  if (admission.ok) return "admitted";
  return admission.problems
    .map((problem) => {
      const { expected } = problem;
      const valid =
        expected === undefined || expected.length === 0 ? "" : `\n    valid here: ${expected.join(", ")}`;
      return `${problem.reason}: ${problem.message}${valid}`;
    })
    .join("\n");
}
