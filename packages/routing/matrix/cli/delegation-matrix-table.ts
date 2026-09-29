/** Stable JSON table consumed by the pinned Orchid bridge and Cockpit pre-check. */
import {
  COORDINATOR_MATRIX,
  DELEGATION_MATRIX,
  DELEGATION_ROLES,
  MODEL_TRANSPORT_PRIORITY,
  WORKLOAD_TIER_DESCRIPTIONS,
  WORKLOAD_TIERS,
  type DelegationRole,
  type WorkloadTier,
} from "../delegation-matrix.ts";

export interface MatrixTableOptions {
  readonly tier?: WorkloadTier;
  readonly role?: DelegationRole;
}

export function matrixTable(options: MatrixTableOptions = {}): unknown {
  const tiers = options.tier ? [options.tier] : WORKLOAD_TIERS;
  if (options.role) {
    return {
      schemaVersion: 1,
      mode: "role",
      role: options.role,
      tiers: tiers.map(tier => {
        const cell = DELEGATION_MATRIX[tier];
        const role = options.role!;
        const policy = role === "plan_evaluation" ? cell.planPolicy
          : role === "implementation_evaluation" || role === "vision_evaluation" ? cell.implementationPolicy
          : role === "documentation" ? cell.documentationPolicy : undefined;
        return { tier, description: WORKLOAD_TIER_DESCRIPTIONS[tier], routes: cell[role], policy };
      }),
    };
  }
  return {
    schemaVersion: 1,
    mode: options.tier ? "tier" : "full",
    tiers: tiers.map(tier => ({ tier, description: WORKLOAD_TIER_DESCRIPTIONS[tier], ...DELEGATION_MATRIX[tier] })),
    ...(!options.tier ? { coordinators: COORDINATOR_MATRIX, transportPriority: MODEL_TRANSPORT_PRIORITY } : {}),
  };
}

export function parseMatrixArgs(args: readonly string[]): MatrixTableOptions {
  let tier: WorkloadTier | undefined;
  let role: DelegationRole | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") continue;
    if (arg === "--tier") {
      const next = args[++i];
      if (!WORKLOAD_TIERS.includes(next as WorkloadTier)) throw new Error("unknown-tier");
      tier = next as WorkloadTier;
      continue;
    }
    if (arg === "--role") {
      const next = args[++i]?.replaceAll("-", "_");
      if (!DELEGATION_ROLES.includes(next as DelegationRole)) throw new Error("unknown-role");
      role = next as DelegationRole;
      continue;
    }
    throw new Error("unknown-option");
  }
  return { tier, role };
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(matrixTable(parseMatrixArgs(Deno.args)), null, 2));
  } catch {
    console.error("matrix-table-invalid-request");
    Deno.exit(2);
  }
}
