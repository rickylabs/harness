# Required structured-query documentation

Carry these accepted distinctions into the boardStatus doc block, without weakening them:

It says only that this connection's board is the one the currently bound stream last sent.
It is not completeness — that is RemoteSnapshot.complete and the anomalies beside it.
It is not evidence recency — generatedAt is when the board was produced, not when it was received.
It is not run execution: admitted is not running, and pending or unknown effects stay their own dimension.
It is not certification or capability — nothing about authority, approval or what a caller may do is expressed here.

A retained or synchronized board grants no display, persistence or command right. Backend authorization
and revocation remain separate; late HTTP answers do not restore revoked permission.

[source: prior snapshot-recovery--e9e/plan-freshness-amendment.md section3 and current plan-eval.md binding criteria; topic: accepted public non-inference statements; consulted2026-09-08]
