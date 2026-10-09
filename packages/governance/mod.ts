/**
 * `@rickylabs/governance`: the tri-regime governance read. Reads the configured subscription, metered and
 * capacity sources plus the recorded admissions, composes them, and decodes the result through the published
 * `GovernanceReadSnapshot` contract.
 *
 * This file is the package's only entry and re-exports its public API, nothing else. The caller is the
 * composition root: it wires in the producer name and the string order (`GovernanceWiring`) and passes the
 * source services (`SourceServices`). Every endpoint and host comes from the operator's source descriptor.
 */
export { instant, SourceError, type GovernanceSource, type SourceRefusal } from "./src/domain/source.js";
export type { AdmissionLog, GovernanceWiring, SourceServices, StringOrder, UsageCommand } from "./src/ports/source.js";
export { parseSource } from "./src/application/parse-source.js";
export { usageCommand } from "./src/application/usage-command.js";
export { composeGovernance, type CollectedSources } from "./src/application/compose.js";
export { governanceAt, governanceRead, invalidGovernance, unconfiguredGovernance, type GovernanceAt } from "./src/application/read.js";
export { collectGovernance } from "./src/application/collect.js";
export { defaultSourceServices, readSourceText, runUsageProbe } from "./src/adapters/node-sources.js";
export { readProviderLimitsFile } from "./src/adapters/provider-limits.js";
