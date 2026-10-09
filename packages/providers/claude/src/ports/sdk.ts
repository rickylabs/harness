/**
 * The slice of `@anthropic-ai/claude-agent-sdk` this package uses, declared rather than imported.
 *
 * ## Why the SDK is not a dependency
 *
 * Measured against `@anthropic-ai/claude-agent-sdk@0.3.263`: the main package unpacks to 5,028,300
 * bytes, its `linux-x64` platform binary to **215,662,653**, and it declares three peers — `zod`,
 * `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk` — that pnpm installs on its behalf. CI runs
 * `pnpm install --frozen-lockfile` on every job inside a fifteen-minute budget, on a private
 * repository whose minutes are billed. Paying ~216 MB of platform binary and three transitive peers
 * per job to obtain *types* for a module whose tests never call the real thing is the wrong trade.
 *
 * So the boundary is structural, and the honesty that buys is stated once here: **nothing in this
 * port has been checked against the vendor's own declarations.** A structural type that is subtly
 * wrong compiles perfectly and fails on the box. Two habits follow from that:
 *
 * 1. **Nothing is read off a message by property access.** Every field the provider needs comes out
 *    of a reader in `src/domain/sdk-messages.ts` that checks the shape at runtime and returns `null`
 *    when the message is not what it was assumed to be. A renamed field becomes a run that reports
 *    `unknown`, which is a state the contract has a meaning for, rather than a `TypeError` in a
 *    background loop.
 * 2. **The stream is typed `unknown`.** Anything the vendor yields is assignable to it, so no
 *    release of theirs can fail to satisfy `QueryFn` for a reason that is really about our guess.
 *
 * The guess that remains is `SdkUserMessage`, because that one travels the other way — we construct
 * it. It is one interface with one constructor and one test pinning its bytes, so correcting it is a
 * one-line diff rather than an excavation.
 *
 * ## Streaming input, and what it decides
 *
 * `query()` accepts either a string prompt or an `AsyncIterable` of user messages. The difference is
 * not stylistic: `Query.interrupt()` exists only in the streaming form. Every capability this
 * provider declares beyond `observe` is downstream of taking the iterable — a provider that can only
 * fire and forget is the coordinator this repository exists to replace.
 */

import type { SdkUserMessage } from "../domain/sdk-messages.js";

/** Options passed to `query()`. Only the fields this package sets are declared. */
export interface QueryOptions {
  /** Model id, verbatim as the matrix pinned it. See `translateModel` for what that means here. */
  readonly model?: string;
  /** Working directory for the run. */
  readonly cwd?: string;
  /** Full environment for the child process. Built by `isolatedEnv`. */
  readonly env?: Record<string, string>;
  /** Aborting this ends the run and reaps the child. One per run, never shared. */
  readonly abortController?: AbortController;
  /** Upper bound on agent turns, when the caller sets one. */
  readonly maxTurns?: number;
}

/**
 * What `query()` returns.
 *
 * `interrupt` is optional here and not in the vendor's declaration, because it is absent in
 * string-prompt mode and this interface has to describe both. The provider asks whether it is a
 * function before calling it, which is also what makes the fallback path — abort the controller —
 * reachable when a release removes it.
 */
export interface AgentQuery extends AsyncIterable<unknown> {
  interrupt?: () => Promise<void>;
}

/** The vendor entry point, injected by a composition root; the suite binds a fake. */
export type QueryFn = (input: {
  readonly prompt: AsyncIterable<SdkUserMessage>;
  readonly options: QueryOptions;
}) => AgentQuery;
