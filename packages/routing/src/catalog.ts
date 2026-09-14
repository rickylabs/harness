/** Serializable editor choices from one validated document. No provider probing or availability claim. */
import { HARNESSES, ROUTERS } from "@rickylabs/subagents";
import { declaredEfforts } from "./configuration.js";
import { deepFreeze, FALLBACK_TRIGGERS, TRANSPORTS, type RoutingConfiguration, type Route } from "./schema.js";

export interface EditorChoice { readonly value: string; readonly label: string }
export interface ModelChoice extends EditorChoice {
  readonly family: string;
  readonly description?: string;
  readonly searchText: string;
  readonly routes: readonly (Route & { readonly lane: string; readonly purpose: string })[];
  /** A configured model, including an unrouted one, is never proof a provider can serve it. */
  readonly availability: "unproven";
}
export interface RoutingEditorCatalog {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly harnesses: readonly EditorChoice[];
  readonly transports: readonly EditorChoice[];
  readonly routers: readonly EditorChoice[];
  readonly efforts: readonly EditorChoice[];
  readonly triggers: readonly EditorChoice[];
  readonly purposes: readonly EditorChoice[];
  readonly families: readonly EditorChoice[];
  readonly profiles: readonly EditorChoice[];
  readonly presets: readonly EditorChoice[];
  readonly roles: readonly EditorChoice[];
  readonly lanes: readonly (EditorChoice & { readonly purpose: string })[];
  readonly tiers: RoutingConfiguration["tiers"];
  readonly laneAliases: Readonly<Record<string, string>>;
  readonly models: readonly ModelChoice[];
}

/** Readable fallback for owner-defined identifiers; explicit model labels win. */
function label(value: string): string {
  return value.replace(/[_/-]+/g, " ").replace(/\b[a-z]/g, c => c.toUpperCase());
}
function choices(values: readonly string[]): EditorChoice[] {
  return values.map(value => ({ value, label: label(value) }));
}

/**
 * Export or JSON.stringify this catalog in the consuming app. Search model.searchText and group
 * by route.router / family. Per-model routes preserve valid combinations (effort, harness,
 * transport, router, profile); global choice lists alone do not authorize a Cartesian product.
 * Edit the source document then load it again: this export is a projection, never a second matrix.
 */
export function routingEditorCatalog(configuration: RoutingConfiguration): RoutingEditorCatalog {
  return deepFreeze({
    schemaVersion: configuration.schemaVersion,
    name: configuration.name,
    harnesses: HARNESSES.map(value => ({ value, label: value === "agy" ? "Antigravity" : label(value) })),
    transports: TRANSPORTS.map(value => ({ value, label: value === "native" ? "Native" : "OpenRouter" })),
    routers: choices(configuration.routers ?? ROUTERS),
    efforts: choices(declaredEfforts(configuration)),
    triggers: choices(configuration.triggers ?? FALLBACK_TRIGGERS),
    purposes: choices(configuration.purposes),
    families: choices(configuration.families),
    profiles: choices(configuration.profiles),
    presets: choices(configuration.presets),
    roles: choices([...new Set(configuration.tiers.flatMap(t => Object.keys(t).filter(k => k !== "tier")))]),
    lanes: configuration.lanes.map(l => ({ value: l.lane, label: label(l.lane), purpose: l.purpose })),
    tiers: structuredClone(configuration.tiers),
    laneAliases: { ...configuration.laneAliases },
    models: Object.entries(configuration.models).map(([value, model]) => {
      const routes = configuration.lanes.flatMap(l => l.chain.filter(s => s.route.model === value)
        .map(s => ({ ...s.route, lane: l.lane, purpose: l.purpose })));
      const display = model.label ?? label(value);
      return {
        value, label: display, family: model.family,
        ...(model.description === undefined ? {} : { description: model.description }),
        searchText: [value, display, model.family, model.description ?? "", ...routes.flatMap(r => [r.harness, r.router ?? "", r.transport, r.lane, r.purpose])].join(" ").toLowerCase(),
        routes, availability: "unproven" as const,
      };
    }),
  });
}
