# Forge verification correction

Two intended offline checks failed to isolate the GitHub transport: the first content reviewer used a PATH/token override that still left an authenticated gh reachable; the writer used an empty GH_CONFIG_DIR without fully disabling inherited authentication. The reviewer invoked labels apply and the writer invoked init against the placeholder owner/scratch repository. Both attempted label creation, received HTTP 404 and reported zero labels applied. These attempts were outside the no-GitHub-mutations constraint. The coordinator stopped the writer, audited the reviewer trace and reported both attempts to the user. No successful remote mutation was observed.

The reported INIT_EXIT from that invocation followed a pipe to tail, so it was not the producer's exit status and is not accepted as a validation receipt. Do not describe the attempt as offline or infer a successful apply from it.

## Replacement check

The coordinator used the real exported CLI main with its existing test seam, CliOverrides.probeTransport (packages/forge/src/cli.ts:1418-1422). Every call injected `{ kind: "none", reasons: ["synthetic transport disabled"] }`; no real transport was constructed. An explicit synthetic repository slug, a newly created fixture directory under this repository's ignored tool area, and --no-detect prevented host/repository discovery. No HOME or credential environment override was needed.

Four calls were asserted in one Node process, which exited 0:

| Call | Observed return | Additional assertion |
| --- | --- | --- |
| init --dry-run | 0 | labels.yml was not created |
| init | 0 | labels.yml and the generated skill existed only in the fixture |
| labels check | 3 | unavailable transport returned the documented failure |
| doctor | 0 | unavailable transport remained diagnostic output |

The injected probe was called exactly four times. The implementation path is resolveContext at cli.ts:251-273; cmdInit maps unavailable apply to EXIT.ok at cli.ts:583-604. This proves the exception without contacting GitHub. Tutorial live label verification/readback remains a documented prerequisite, not an executed network receipt.

## Final review containment

The final independent model review uses a dedicated process-local OpenCode agent configuration with shell, editing, network tools and subagents denied; only repository source/receipt reading and search are enabled. The coordinator runs required commands separately and provides their observed status. This is an additional containment measure after the failed isolation checks, not a claim that prompt instructions alone prevent effects. Configuration semantics: [OpenCode permissions](https://opencode.ai/docs/permissions/) and [runtime config overrides](https://opencode.ai/docs/config/).
