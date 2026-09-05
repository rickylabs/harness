/**
 * The debug playbook, encoded rather than rediscovered.
 *
 * The general lesson: **the symptom surfaces one layer above the cause.** A run that looks slow,
 * hung, or like "the model is bad" is usually a load failure, a thrashing box, or a silently
 * dropped boot parameter. So a failed run in the board must link *downward*, and the first click
 * has to land at the right depth.
 *
 * Every pointer here was paid for once already. Keeping them in a data table rather than in a
 * runbook nobody opens is the whole point: the layer below a run should be one field away from the
 * run itself, not one search away from an operator at 02:00.
 */

import type { DiagnosticPointer, RunRecord } from "./model.js";

/**
 * LM Studio's real logs.
 *
 * `nerdctl logs lm-studio` is the webtop GUI stream and says nothing about inference. The app logs
 * are inside the container. A real instance: `n_gpu_layers=999999` produced
 * "failed to fit params to free device memory ... abort" in a retry loop, each JIT attempt eating
 * roughly a minute until the caller timed out. Upstream, that presented as "opencode is slow".
 */
export const LM_STUDIO_LOGS: DiagnosticPointer = {
  what: "LM Studio application logs (model load and inference)",
  where: "/config/.lmstudio/server-logs/YYYY-MM/*.log, inside the lm-studio container",
  grep: "gpu|offload|n_ctx|Failed to load|abort",
  why: "nerdctl logs lm-studio is only the webtop GUI stream; a load failure never appears there, and it surfaces one layer up as a slow or hung caller",
};

/**
 * The relay's own log.
 *
 * Healthy sequence, in order: `stream` -> `project copy refresh started` -> refresh done ->
 * `message=process` -> build stream. A run that stops partway through that sequence names the
 * layer that actually failed.
 */
export const OPENCODE_LOG: DiagnosticPointer = {
  what: "opencode relay log (OpenRouter and local-model calls), UTC",
  where: "~/.local/state/opencode/log/opencode.log on ai-agents",
  grep: "run=<id>",
  why: "an OpenRouter or local-model failure reaches the caller as a stalled or empty stream; the sequence stream -> project copy refresh -> message=process shows where it actually stopped",
};

/** Host pressure, which presents as every model on the box being slow at once. */
export const HOST_PRESSURE: DiagnosticPointer = {
  what: "host scheduler saturation",
  where: "the agent host itself: load average, and the process table",
  grep: "load average|D state",
  why: "a saturated box makes every run on it look like a bad model; the tell is that unrelated runs degrade together",
};

/** Capacity, which is why a dispatched run may never have started at all. */
export const DISPATCHER_CAPACITY: DiagnosticPointer = {
  what: "dispatcher capacity decisions",
  where: "the dispatcher's own log on the orchestrator host",
  grep: "no host with free capacity|operator timeout|deferring",
  why: "a run that never appears is not a failed run; the dispatcher deferred it, and only its log says so",
};

/**
 * Which layer to look at first, given what a run reports.
 *
 * Ordered most-likely-first for the run in hand, rather than as a checklist to work through: the
 * cost of this table is the operator's first click, and putting the wrong pointer first spends it.
 */
export function diagnosticsFor(run: RunRecord): readonly DiagnosticPointer[] {
  const provider = run.identity.provider?.toLowerCase() ?? "";
  const model = run.identity.model?.toLowerCase() ?? "";
  const local = provider === "local" || model.includes("lmstudio") || model.startsWith("local/");

  const pointers: DiagnosticPointer[] = [];
  if (run.source === "opencode" || provider === "openrouter") pointers.push(OPENCODE_LOG);
  if (local || run.source === "opencode") pointers.push(LM_STUDIO_LOGS);
  if (run.outcome === "failed" || run.outcome === "running") pointers.push(HOST_PRESSURE);

  // A run with no usage at all never got a token back. That is a dispatch or a load failure, not a
  // model failure, and the dispatcher's log is the only place the difference is recorded.
  const spent =
    (run.usage.inputTokens ?? 0) + (run.usage.outputTokens ?? 0) + (run.usage.reasoningTokens ?? 0);
  if (spent === 0) pointers.unshift(DISPATCHER_CAPACITY);

  return pointers;
}

/** Every pointer this package knows, for a runbook page that wants the whole table. */
export const ALL_POINTERS: readonly DiagnosticPointer[] = [
  DISPATCHER_CAPACITY,
  OPENCODE_LOG,
  LM_STUDIO_LOGS,
  HOST_PRESSURE,
];
