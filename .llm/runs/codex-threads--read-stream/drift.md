# Drift

Plan review required explicit inbound/outbound separation, sensitive-field policy and identity policy. These are now explicit: default redaction, private-consumer opt-in, and reuse of the existing public ID formula. No runtime code has been written. The mailbox has no current answer; no waiting is inferred from old history.

The first live read returned rows but some goal RPCs failed. Tightened complete to cover both listing and goal reads: keep all valid rows, set complete:false and the closed goal-read failure reason. Present-but-unset optional fields do not fail read coverage. The earlier live snapshot with pagination-only complete is superseded by the final probe.

Independent implementation review exposed CLI interruption and output-error defects. Fixed them and expanded controls from 72 to 77; each broken condition fails an assertion and each restored condition passes. The final bounded projection/CLI re-review passed. No live writes were used to produce notification evidence.
