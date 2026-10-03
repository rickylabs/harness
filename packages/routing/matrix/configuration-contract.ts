/** Portable projection types only. #271's loader validates whole documents; this is not a loader.
 * INTERIM pinned-source consumer boundary: https://github.com/rickylabs/harness/issues/270.
 * Keep the raw Deno import graph independent of the Node package's emitted .js files.
 */
export interface MatrixLaunch {
  readonly provider: string;
  readonly seam: 'subagents' | 'llm';
  readonly id: string;
  readonly transport: 'native' | 'openrouter';
  readonly harness?: string;
  readonly router?: string;
  readonly profile?: string;
  readonly effortSupport: { readonly status: string; readonly supported?: readonly string[]; readonly unsupported?: readonly string[] };
}
export interface MatrixModel {
  readonly family: string;
  readonly aliasOf?: string;
  readonly label?: string;
  readonly launcherAlias?: string;
  readonly capabilities?: readonly string[];
  readonly approvedRelayEvaluator?: true;
  readonly launches: readonly MatrixLaunch[];
}
export interface MatrixRole {
  readonly certifies?: string;
  readonly requires?: readonly string[];
  readonly restrictions?: {
    readonly providers?: readonly string[];
    readonly families?: readonly string[];
    readonly models?: readonly string[];
    readonly seams?: readonly string[];
    readonly transports?: readonly string[];
    readonly harnesses?: readonly string[];
  };
}
export interface MatrixCandidate { readonly model: string; readonly effort: string }
export interface MatrixDocument {
  readonly schemaVersion: 2;
  readonly families: readonly string[];
  readonly models: Readonly<Record<string, MatrixModel>>;
  readonly providerPrecedence: readonly string[];
  readonly roles: Readonly<Record<string, MatrixRole>>;
  readonly tiers: readonly {
    readonly tier: string;
    readonly description?: string;
    readonly cells: Readonly<Record<string, readonly MatrixCandidate[]>>;
    readonly loops?: Readonly<Record<string, unknown>>;
    readonly authorization?: { readonly by: readonly string[] };
  }[];
  readonly coordinators: Readonly<Record<string, readonly MatrixCandidate[]>>;
}
/** Structural input from a successful #271 LoadOutcome. No schema or metadata is manufactured. */
export interface MatrixLoadedConfiguration {
  readonly configuration: unknown;
  readonly source: { readonly id: string; readonly digest: string; readonly bytes: number; readonly schemaVersion: 1 | 2; readonly name: string };
}
