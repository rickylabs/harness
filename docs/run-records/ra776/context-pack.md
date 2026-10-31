# Native revision context

Refs rickylabs/harness#776. The previous READY report and scan-based sign-off are superseded by the owner update.

Orchid PR #133 supplies the missing keyed run lookup and changes API; its full race, vet and build checks passed. Harness now joins restored workspace labels and agent-native session identities to exact receipt keys. Current Herdr state drives execution. Native Orchid completion is final-run evidence; idle/done alone is not. Current source gaps and ambiguity remain explicit.

Harness native regression controls pass; configured root gates and independent review are pending. The remaining required slice is cockpit integration: reuse the native Herdr reader, remove transcript-tree intake and the receipt-enumerating helper, consume native run invalidations, and use the existing durable stream/KV writer chain. Home must continue reading prepared KV without request-path external calls. No merge or deployment is authorized by readiness.
