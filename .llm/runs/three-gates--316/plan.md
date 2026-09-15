# Three gates — plan

Draft pending independent plan evaluation. No product mutation before PASS.

1. Preserve 0/pass, 1/fail, 2/inconclusive. Carry the owned scratch location and observed execution error code/signal/status without arbitrary child output; do not infer noexec from every failure. Probe the same Node shebang as the fixture; classify unsupported platform before probe execution. Negative controls cover refusal, Windows, and successful executable probe.
2. Preserve the owner's explicit missing-script failure policy. Add INCONCLUSIVE for missing/empty/unreadable workspace enumeration, with a structured reason and remedy. Malformed package JSON remains a configuration failure. Importing the audit must not execute it. Negative controls exercise the actual CLI in isolated workspaces and retain missing-script/stale-exemption failure tests.
3. Make runner execution separate from attempted execution. Incomplete result sets cannot be all-green. Compile not reached/not spawned is explicitly inconclusive; actual compiler exit 2 is FAIL, not the gate protocol. Preserve known signal behavior and stage names. Negative controls exercise real runner execution and reporting.
4. Mutation-verify every new guard in isolated copies, assert each targeted test goes red, restore automatically, and save command, exit and output. Run root typecheck/build/test and installed check with both executable and noexec TMPDIR. One PR to main, Closes 316, Part of 270, with literal validation output.

Owner forks: none; owner clarification settles missing-script policy, user explicitly requests location and full implementation.
Dependency DAG: review -> implementation -> controls -> mutations -> root gates -> independent implementation review -> PR.
Risk: falsely accepting incomplete work (high impact; negative/mutation controls); leaking arbitrary output (bounded diagnostics only); compiler status collision (real compiler regression); host capability variance (actual TMPDIR probes).
