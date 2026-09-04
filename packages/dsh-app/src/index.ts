/**
 * @rickylabs/dsh-app — our dsh profile and bundle (cordis.patch.yml) composing every plugin
 * package.
 *
 * Owned by E2 · #32. This file is a deliberately empty, buildable stub. The imports below are
 * the only reason it exists today: they make dsh-app the root of the workspace dependency
 * graph, so `pnpm -r build` and the TypeScript project references are exercised end to end.
 * Do not add behaviour here before E2 defines the profile.
 */
import { PACKAGE_NAME as board } from "@rickylabs/board";
import { PACKAGE_NAME as contracts } from "@rickylabs/contracts";
import { PACKAGE_NAME as coordinator } from "@rickylabs/coordinator";
import { PACKAGE_NAME as forge } from "@rickylabs/forge";
import { PACKAGE_NAME as governance } from "@rickylabs/governance";
import { PACKAGE_NAME as llmLocal } from "@rickylabs/llm-local";
import { PACKAGE_NAME as netscriptBridge } from "@rickylabs/netscript-bridge";
import { PACKAGE_NAME as providerAcp } from "@rickylabs/provider-acp";
import { PACKAGE_NAME as providerClaude } from "@rickylabs/provider-claude";
import { PACKAGE_NAME as providerCodex } from "@rickylabs/provider-codex";
import { PACKAGE_NAME as providerOpencode } from "@rickylabs/provider-opencode";
import { PACKAGE_NAME as routing } from "@rickylabs/routing";
import { PACKAGE_NAME as telemetry } from "@rickylabs/telemetry";

/** Workspace package identifier; the only export until the owning epic lands. */
export const PACKAGE_NAME = "@rickylabs/dsh-app" as const;

export type PackageName = typeof PACKAGE_NAME;

/** Every plugin package this app composes, in the order of the #31 target layout. */
export const PLUGIN_PACKAGES = [
  providerClaude,
  providerCodex,
  providerAcp,
  providerOpencode,
  llmLocal,
  routing,
  governance,
  board,
  coordinator,
  forge,
  netscriptBridge,
  telemetry,
  contracts,
] as const;
