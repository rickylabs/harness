# Adversarial review — receipt-root-diagnostics--368

## Round 1

Routed evaluator: `glm_5_3_flash` / provider default, separate GLM family session. Verdict: `PASS AFTER NARROW FIXES`.

1. The plan did not say whether the CLI JSON envelope must surface the fields. Disposition: fixed by bounding #368 to the exported reader result; no unrelated envelope schema change.
2. Reporting the configured root appeared to conflict with the private-descriptor diagnostic comment. Disposition: fixed by distinguishing the operator argument from reservation descriptors and retaining the existing secret canary.
3. `missing` needed an exact exception boundary. Disposition: fixed; only root `lstat` `ENOENT` maps to missing.
4. Mutation verification needed an executable procedure. Disposition: fixed in the risk register.
