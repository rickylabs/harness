# Context pack

Summary: #390's bounded head selection works on synthetic short records but the live Codex `session_meta` first lines exceed its 16 KiB cap. Orchid's four receipts are healthy, and #387's root and child full rollouts parse cleanly. The fix raises the bounded head cap to 64 KiB, tests a >24 KiB synthetic head plus an over-cap failure, and verifies the private real-home frame by an explicit parent/child assertion before PR. Raw native identities and paths stay in the private capture only. See research.md for citations.
