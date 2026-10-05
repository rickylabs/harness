# Release adoption and acceptance — 2026-10-05

The full issue remains open until the source fix is included in an exact stable coordinated NetScript release and the consumer check passes against that published release. `0.0.7` lacks the public `models` option. Registry metadata currently has no stable `0.0.8`; the milestone target is a candidate, not an adoption claim ([registry receipt](published-release-audit.json), [negative public checks](public-consumer-0.0.7.json), [unpublished target check](public-consumer-0.0.8.json)).

## Required release sequence

1. Merge source PR [2078](https://github.com/rickylabs/netscript/pull/2078) into the coordinated release candidate. Run the configured readiness/preflight and CLI E2E on an Aspire/Docker capable host.
2. Dispatch the checked-in coordinated canary workflow for that candidate. Both the exact canary publish and canary-pinned production CLI E2E must pass for the same content before stable publication. The existing September canary predates this source fix and cannot establish its same-content requirement.
3. Use the repository stable release command and OIDC workflow. Record the exact stable package version, immutable release content SHA, GitHub Release URL, publish evidence and artifact-pinned production E2E evidence. Do not publish an isolated AI package or a local substitute.
4. Run the consumer check below against the actual stable version and attach its JSON receipt. Add the literal proven version to the downstream recipe. The local rehearsal passes but is never published-package proof.

Authority: [netscript-release skill](https://github.com/rickylabs/netscript/blob/9e375a1765234d179c4945480d68e69ac2f6c906/.agents/skills/netscript-release/SKILL.md#L29) says “Do not publish from a local machine or hand-run the underlying publish scripts.” At line33: “No `release:publish` without a green canary pair for the same content”. The canary cadence is coordinated release candidates rather than per-slice checks (line113). These prerequisites are not present for this unmerged source change; this run does not claim the publication requirement complete.

The executable [consumer checker](https://github.com/rickylabs/netscript/blob/fix/anthropic-forward-compatible-2063/.llm/runs/anthropic-forward-compatible--2063/qualify-published-consumer.ts) lives in the upstream NetScript PR. Commands below run from that repository.

## Exact published consumer gate

From the NetScript repository with CI Deno2.9.5, pass the actual stable version as one argument:

    deno run --allow-read --allow-write --allow-env --allow-run .llm/runs/anthropic-forward-compatible--2063/qualify-published-consumer.ts 0.0.8

`0.0.8` in this example is the planned release target and is presently unavailable. Substitute the exact stable version that contains the merged fix. The command rejects ranges and canaries, copies the 11 regressions into a temporary consumer, rewrites imports to public package exports, resolves registry modules, pins TanStack core0.52.3/adapter0.18.3, checks public types, and runs the offline/native mocked transport tests. Child processes receive no provider/GitHub credential environment and provider runtime network permission is absent. A successful published run has `publishedConsumerProof: true`; `--source-rehearsal` always records false.

## Minimal downstream configuration

After the exact release passes, map `@netscript/ai` and its public subpaths to that same stable release in the consumer import map, retaining the qualified TanStack pair. Both direct and registered factories support this configuration:

    import { AnthropicModelProvider } from '@netscript/ai/anthropic';

    const provider = new AnthropicModelProvider({
      apiKey: Deno.env.get('ANTHROPIC_API_KEY'),
      models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1'],
    });
    const client = provider.createChatClient('claude-opus-5-5');

Use `client.stream` with native supported options. For Opus/Fable neutral `reasoningEffort: 'off'` omits a disabling field; Sonnet maps it to `between_tools`. Native effort overrides use `output_config.effort`. Deprecated manual budgets, disabled thinking, unsupported forced tools and non-default sampling reject before IO for these exact IDs. Do not infer metadata for arbitrary future IDs. See [public provider documentation](https://github.com/rickylabs/netscript/blob/9e375a1765234d179c4945480d68e69ac2f6c906/packages/ai/README.md#L121) and [current option validation](https://github.com/rickylabs/netscript/blob/9e375a1765234d179c4945480d68e69ac2f6c906/packages/ai/src/adapters/anthropic.adapter.ts#L65).

No paid live Anthropic inference has been run. This gate proves construction/discovery, exported types, the qualified dependency graph, and mocked actual SDK Messages transport. Any live inference must be recorded separately with its exact model/options and privacy-preserving result.
