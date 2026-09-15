# Exact root permission repair

CURRENT: baseline 318bd11ceebfbaae71312620153185d0ce246f51 checks only group/world bits. The fixed reader requires exactly0700, including rejection of special permission bits. All other guards are unchanged.

Delivery tracking: https://github.com/rickylabs/harness/issues/365 and downstream https://github.com/rickylabs/atelier-cockpit/issues/205.

MEASURED: results.json records actual commands, exits and literal selected output. The unchanged downstream reader-check.mjs was run from Cockpit baseline21eec74e67940bc286bd8875e3436d748541aee4. Reverting the compiled guard caused its exact-mode check to fail; restoring passed. The valid-mode control also failed when the guard refused every root, and passed after restoration. Temporary compiled mutations were restored and are not source changes.

No live receipt root was configured; no launch or infrastructure restart was performed. This verifies reader behavior on invented fixtures only.
