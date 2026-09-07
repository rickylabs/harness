# Documentation route fallback evidence

Canonical feature documentation preference: Qwen 3.8 Max provider-default, then GLM 5.3 Flash provider-default. Qwen produced the claim inventory and README draft in explicit session ses_f871c42e2ffet2wu4hlqBqbT6v. A continuation request created at 1788736925740 produced no response parts before coordinator interruption several minutes later. The same-session resumed request created at 1788737336589 also produced no response parts. Exported metadata confirmed the requested model/provider and absent completion/error/parts; process existence alone was not accepted as progress.

A separate bounded availability probe asked Qwen only to reply READY, with no tools or file reads. `timeout --signal=INT 90 opencode run --pure --format json --model opencode-go/qwen3.8-max ...` exited 124. Both event and stderr outputs were zero bytes. This is timeout evidence, not an asserted provider root cause.

After the failed probe, the owned stalled writer was interrupted and the same explicit session/worktree resumed on the ordered fallback, opencode-go/glm-5.3-flash, provider-default effort. No rival writer, recency addressing, quota-balancing substitution or sibling session operation was used. Muse Spark 1.3 xhigh content and Gemini 3.8 Flash high visual review preflights had already succeeded; final approval remains pending.

The GLM 5.3 Flash continuation through OpenCode Go also produced no output. Its separate READY-only no-tools probe timed out after 90 seconds with exit 124 and zero event/error bytes. The owned stalled continuation was stopped before trying the same exact GLM 5.3 Flash model through its installed opencode transport. No provider root cause is claimed.

The same-model opencode transport probe returned READY and exited 0. Documentation continuation therefore resumes the same explicit session on opencode/glm-5.3-flash, provider-default effort.
