/** Minimal route types and closed vocabularies consumed by the fleet bridge. */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = typeof EFFORTS[number];
export const PROVIDER_KINDS = ["anthropic", "openai", "google", "github_copilot", "opencode_go", "ollama", "openrouter", "custom"] as const;
export type ProviderKind = typeof PROVIDER_KINDS[number];
export type AgentKind = "claude" | "codex" | "antigravity" | "opencode";
export interface RouteIdentity {
  readonly agent: AgentKind;
  readonly provider: ProviderKind;
  readonly profileId?: string;
  readonly presetId?: string;
  readonly baseUrl?: string;
  readonly model: string;
  readonly effort: Effort;
  readonly worktree: string;
  readonly sessionId?: string;
  readonly mobileRequired: boolean;
}
export interface SessionIdentity {
  readonly agent: AgentKind;
  readonly sessionId: string;
  readonly worktree: string;
  readonly boundary: "active" | "idle" | "new";
}
