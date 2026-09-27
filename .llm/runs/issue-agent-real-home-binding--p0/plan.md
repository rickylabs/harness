# Issue agent real-home binding — locked plan

## Summary
Raise the bounded `session_meta` head cap enough for the measured modern Codex record shape, keep the no-follow and aggregate byte bounds, and prove #387 binds on the real home before opening a ready PR.

## Decisions
1. Set the head cap to 64 KiB. The measured maximum is 22.9 KiB; this leaves room for moderate instruction growth while bounding each candidate to 64 KiB and the existing 128-candidate/frame budget. A first line above the cap remains `source_unavailable`; do not silently ignore it because it may contain the matching root.
2. Add a synthetic first-line fixture above 16 KiB with a matching root and child beside a large unrelated rollout. Verify complete root+child selection, the per-issue byte cap, and a separate over-64-KiB head that remains incomplete. No runtime text enters the fixture.
3. Run the coordinator's private real-home script from this clean worktree after build. Acceptance: #387 `complete:true` with one dispatch and parent+child; stale issues may remain `scan_limit`, so top-level completeness may remain false. Record only redacted counts/reasons. Then perform full gates, independent implementation review, leak scan, and open a ready PR.

## Risk and gates
- Risk: 64 KiB is still too short for future heads. Gate: fail closed with a specific bounded test; future growth requires another measured adjustment.
- Risk: larger heads increase scan I/O. Gate: 128 candidates and 32 MiB/frame remain intact; measured live scan takes under a second.
- Owner forks: none. The coordinator explicitly chose the real-home fix and local capture.
- Dependency: Stage F/G independent review must pass before product code mutation; then focused tests, real-home capture, full build, implementation review, public leak scan, CI, ready status.
