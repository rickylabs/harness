# Q6 native default effort plan

The approved slice distinguishes an explicit empty normalized native map from an unestablished capability. Only the verified serializer establishes default-only support; missing maps, header-only catalogs and nonempty opaque maps retain unknown.

## Behavioral source proof

- OpenCode `v1.18.34`, immutable commit `aec0b9a6d8898f68f923aaf08b7306d931fd9d76`: [models command, lines 43–46](https://github.com/anomalyco/opencode/blob/aec0b9a6d8898f68f923aaf08b7306d931fd9d76/packages/opencode/src/cli/cmd/models.ts#L43) prints the normalized native model object.
- [Provider normalization, lines 1752–1761](https://github.com/anomalyco/opencode/blob/aec0b9a6d8898f68f923aaf08b7306d931fd9d76/packages/opencode/src/provider/provider.ts#L1752) constructs variants and removes disabled choices.
- [Variant transform, lines 790–855](https://github.com/anomalyco/opencode/blob/aec0b9a6d8898f68f923aaf08b7306d931fd9d76/packages/opencode/src/provider/transform.ts#L790) returns empty maps for models with no selectable named variant, including reasoning-capable branches. Empty does not mean reasoning disabled.
- [Run command, lines 865–869](https://github.com/anomalyco/opencode/blob/aec0b9a6d8898f68f923aaf08b7306d931fd9d76/packages/opencode/src/cli/cmd/run.ts#L865) passes an optional variant. Native default means omission, without inventing a named effort.

## Locked decisions

1. Store verified serializer versions and immutable source provenance in `discovery.native.v1.json`; no provider or model whitelist in TypeScript.
2. Publish `efforts: []`, `variants: []`, and `effortSource: opencode.models.variants` for an explicit empty map from that serializer. Keep named-effort assertions exact.
3. Pair the strict validator with the producer: an OpenCode default-only claim requires the verified version, explicit empty variants and exact effort source. Existing provider, authentication, source, shape and size checks remain in force.
4. Exercise native-captured JSON fixtures through a fake executable metadata boundary, including an owned authenticated loopback provider read. No model turns are part of validation.

## Gates and risks

Real empty-map controls must fail before the fix. Missing, unverified, opaque, disabled, malformed and legacy observations cannot assert default-only support. Named variants remain exact; failed provider connection proof remains a refusal. Producer and decoder guard mutants must compile and fail assertions. Required repository typecheck, build and tests run afterward.

The existing consumer understands `efforts: []` as `provider_default`; its served catalog defects and integration pin are a separate owner surface. A default capability observation does not establish paid eligibility, current capacity, authorization or applied effort. None of those admission checks is relaxed here.
