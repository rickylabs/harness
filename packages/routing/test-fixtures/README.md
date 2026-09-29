# Routing fixtures

`compatibility.json` is a fixed behavioral test document captured before PR #348 made lane identities and tier roles configurable. Model-specific expectations apply only to this fixture. It is test input, never runtime policy; do not synchronize it when editing the shipped config. Notes and unused data were removed. `owner-matrix.json` exercises arbitrary models, families, roles, purposes, routers and triggers.

`matrix-table.0985265.json` and `matrix-catalog.0985265.json` were exported from a clean
NetScript checkout at the full `sourceRevision` recorded in each fixture. They pin every
workload/coordinator cell, ordered fallbacks, source catalog capability and transport priority.
The Harness matrix test compares the complete table exactly and retains every source catalog
capability while preferring the newer Harness native Sol/Luna IDs. CI reads these frozen
fixtures only; it does not import NetScript.
