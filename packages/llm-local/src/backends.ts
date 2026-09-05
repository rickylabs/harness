/**
 * The three places a `ctx.llm` request can be sent, as data.
 *
 * A backend is a *destination*, not a model. What can run at each one is `capability.ts`; this file
 * says what each destination is, how it is known to be up, and where its failures are read.
 *
 * ## Readiness is probed, never inferred
 *
 * `ReadinessCheck` has exactly one value, and that is the point rather than an oversight. The
 * llama-rocm container's entrypoint is `sleep infinity`: starting the container does not start a
 * server, so a scheduler that treats "container is running" as "backend is ready" dispatches into
 * a socket that is not listening and reports the resulting failure as a model problem. There is no
 * `"container-state"` member to select, so a caller cannot express the wrong check; adding one
 * would have to be a deliberate widening of this type, reviewed as such.
 *
 * ## Why the diagnostics path is on the record
 *
 * A backend that cannot say where its own failures are read is not fully described. LM Studio is
 * the case that proves it: a model that fails to load leaves nothing useful in the container's
 * stdout, so `nerdctl logs` shows a healthy server while every request fails. The real evidence is
 * in the app's own log directory. E4.1 (#57) consumes this field so a failed load links to the file
 * that explains it instead of to the one that does not.
 *
 * ## Base URLs are defaults, not facts about a deployment
 *
 * These are the N5 compose hostnames, and they are the right default for the box this coordinator
 * was built for. They are still only a default: resolving an override — from the profile, from the
 * environment — belongs to #57 along with the health check that would prove any of them reachable.
 * Nothing in this package has contacted an endpoint.
 */

/** Every destination this package knows how to describe. */
export const BACKENDS = ["lm-studio", "llama-rocm", "openrouter"] as const;
export type Backend = (typeof BACKENDS)[number];

/**
 * Where the compute is, and therefore what running out of it looks like.
 *
 * `on-box` capacity is a queue: it is either free or busy, and waiting is the remedy. `relay`
 * capacity is a balance that only goes down. The two are not interchangeable even when they serve
 * the same weights, which is why this is a field and not a comment.
 */
export const LOCALITIES = ["on-box", "relay"] as const;
export type Locality = (typeof LOCALITIES)[number];

/**
 * The compute path a local backend uses.
 *
 * `none` is for the relay, where the accelerator is somebody else's problem. The distinction
 * between `vulkan` and `rocm` is load-bearing rather than descriptive: a model can be perfectly
 * present on the box and still be unrunnable on one of them.
 */
export const ACCELERATORS = ["vulkan", "rocm", "none"] as const;
export type Accelerator = (typeof ACCELERATORS)[number];

/**
 * How a backend is known to be accepting work.
 *
 * One member, deliberately. See the file header: container state is not readiness, and the type
 * exists so that nothing can say it is.
 */
export type ReadinessCheck = "endpoint";

/** The wire protocol. All three speak the same one, which is the reason one adapter can serve all three. */
export type BackendApi = "openai-completions";

/** One destination. */
export interface BackendRecord {
  readonly backend: Backend;
  /** The N5 compose default. A deployment overrides it; nothing here has contacted it. */
  readonly defaultBaseUrl: string;
  readonly api: BackendApi;
  readonly locality: Locality;
  readonly accelerator: Accelerator;
  readonly readiness: ReadinessCheck;
  /** Where a failed load is actually diagnosed. Not always where a container's logs are. */
  readonly diagnostics: string;
  /** Whether a credential profile must be bound before a request can be sent. */
  readonly credentialed: boolean;
  /** Why this backend exists in the table, in the terms an operator would use. */
  readonly why: string;
}

/** The table. Ordered on-box first, because a request that can stay on the box should. */
export const BACKEND_RECORDS: readonly BackendRecord[] = [
  {
    backend: "lm-studio",
    defaultBaseUrl: "http://lm-studio:1234/v1",
    api: "openai-completions",
    locality: "on-box",
    accelerator: "vulkan",
    readiness: "endpoint",
    diagnostics: "/config/.lmstudio/server-logs/YYYY-MM/*.log",
    credentialed: false,
    why:
      "The Vulkan path, and the one that serves the local smoke and plan-evaluation seat. A model " +
      "that fails to load here leaves the container's stdout looking healthy, so the app's own log " +
      "directory is the only place the failure is legible.",
  },
  {
    backend: "llama-rocm",
    defaultBaseUrl: "http://llama-rocm:8081/v1",
    api: "openai-completions",
    locality: "on-box",
    accelerator: "rocm",
    readiness: "endpoint",
    diagnostics: "the server process's own stdout inside the container",
    credentialed: false,
    why:
      "The ROCm path, which exists because one model segfaults on Vulkan and runs here. Its " +
      "entrypoint is `sleep infinity`: the container being up says nothing about the server, which " +
      "is why readiness is an endpoint probe and cannot be expressed any other way.",
  },
  {
    backend: "openrouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    api: "openai-completions",
    locality: "relay",
    accelerator: "none",
    readiness: "endpoint",
    diagnostics: "the response body — the relay reports a refusal in-band, not in a log",
    credentialed: true,
    why:
      "The relay, and the only place several pinned models exist at all. Metered per token against " +
      "a balance, so it is the backend where a run costs money rather than time. Its credential is " +
      "read from a mode-600 file at dispatch and never enters argv, a prompt, a log or a receipt.",
  },
];

const RECORD_BY_BACKEND: ReadonlyMap<string, BackendRecord> = new Map(
  BACKEND_RECORDS.map((record): readonly [string, BackendRecord] => [record.backend, record]),
);

/**
 * The record for a backend, or `null` for a name this package does not describe.
 *
 * A `Map` rather than an object literal for the reason `routing`'s `familyOf` uses one: the
 * argument can arrive from a profile, a lane request or a telemetry record, and on a plain object
 * `backendRecord("toString")` would find something on the prototype and answer with it.
 */
export function backendRecord(backend: string): BackendRecord | null {
  return RECORD_BY_BACKEND.get(backend) ?? null;
}

/** Whether `backend` is one of the three. Fails closed on anything else. */
export function isBackend(backend: string): backend is Backend {
  return RECORD_BY_BACKEND.has(backend);
}

/** The backends of a given locality, in table order. */
export function backendsWhere(locality: Locality): readonly Backend[] {
  return BACKEND_RECORDS.filter((record) => record.locality === locality).map(
    (record) => record.backend,
  );
}
