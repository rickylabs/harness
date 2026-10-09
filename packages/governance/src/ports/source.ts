/** What governance needs from the world and from its composition root. Implementations are passed in. */

/** One bounded usage-probe invocation; the adapter runs it, the application only builds it. */
export interface UsageCommand {
  readonly bin: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

/** Service injection keeps offline tests independent of Deno, credentials and networking. */
export interface SourceServices {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly clock: () => string;
  readonly usage: (command: UsageCommand) => Promise<unknown>;
  readonly fetch: typeof fetch;
  readonly readText: (path: string, maxBytes: number) => Promise<string>;
  /** The private transport availability snapshot: an owner-only file reader. */
  readonly readPrivateText: (path: string) => Promise<string>;
}

/** The observability log the admissions leg reads: events per file, and whether any file was unreadable. */
export interface AdmissionLog {
  readonly files: readonly { readonly events: readonly unknown[] }[];
  readonly degraded: boolean;
}

/** A total, host-independent string order, injected so this package copies no ordering helper. */
export type StringOrder = (a: string, b: string) => number;

/** The caller's naming and ordering: the producer stamped on every document, and the admission order. */
export interface GovernanceWiring {
  readonly producer: string;
  readonly order: StringOrder;
}
