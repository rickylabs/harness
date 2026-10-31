# Native revision drift

The owner rejected the earlier scan-based implementation after its READY report. That report and sign-off are superseded. The revised plan uses restored native workspace labels, agent-native identity, keyed Orchid records and the cockpit's existing durable stream/KV chain. The backward reader, metadata-priority heuristics and receipt-pagination workaround are removed.

The missing upstream keyed lookup/change source required Orchid PR #133. The cockpit now requires a separate consumer change and reader pin update. Both are within the operator's pre-approved scope. Branch naming and Refs-only association follow the explicit operator directive. No merge, deployment, redispatch or live resource mutation is part of delivery.
