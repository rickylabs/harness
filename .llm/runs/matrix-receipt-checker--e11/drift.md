# Drift

None in implementation scope. The design and pilot remain a separate draft PR. The receipt
checker uses the existing js-yaml dependency after strict JSON syntax parsing to satisfy semantic
duplicate detection without a new parser or dependency.

2026-09-14 — While implementation review was running, an author-side boundary probe found a
symlink entry point exited 0 with no output because the CLI main guard compared an unresolved
entry path. Corrected both paths through realpath, added a real symlink CLI regression test,
and retained the source-review target change explicitly. This repairs the planned no-empty-pass
contract; it does not widen scope. A verdict at the earlier commit cannot certify the repair.
