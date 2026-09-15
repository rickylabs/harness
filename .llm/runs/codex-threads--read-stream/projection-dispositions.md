# Projection review dispositions

The DeepSeek review returned FAIL_FIX, exit 0. It is not counted as PASS.

1. Do not change undefined goals to goal_absent. The installed generated ThreadGoalGetResponse requires a goal property whose value is ThreadGoal or null. Explicit null is absence. A missing property/undefined is malformed and remains invalid_response. This is covered by the negative response-shape controls.
2. Native identity is already validated in the only production caller before projectThread. The reader requires a nonarray record with text(t.id), rejects duplicate IDs and only then calls the internal projector. The helper is not re-exported from the package public index. The mutation that bypasses caller identity validation is killed by exact identity_mismatch controls. No arbitrary source ID is hashed without caller validation.

These dispositions require independent re-review with the actual caller, not author self-certification.
