# Alpha evidence bindings

Implement the owner-directed route and cost binds on the existing read and durable projection paths. This is source work; runtime installation and independent review are not yet evidenced.

1. Preserve canonical dispatch route evidence through the existing telemetry sink and `dsh-telemetry runs --json`. Recompute public diagnostics after withholding cwd. Never infer observed identity from requested identity.
2. Join per-run usage only through an explicit dispatch result session reference and seam. Reject ambiguous matches. Read subscription headroom from the existing governance observation contract with an explicit account/window binding and freshness checks. Keep its provider/account scope separate from run accounting.
3. Bind an explicitly enrolled terminal/pane to its dispatched run. Apply the same read in the projector session response and durable observer snapshots. Missing, stale or invalid sources remain unavailable with fixed diagnostics.
4. Test synthetic evidence end to end, missing and conflicting bindings, scope separation, and privacy. Do not record live source values in artifacts.

The owner explicitly directed these source changes after measuring empty deployed values. This supersedes waiting for a new design decision; it does not constitute independent evaluation or permission to mark pending supervisor gates passed. Keep the implementation draft for review.

Evidence: Harness `packages/dsh-app/src/instrument.ts` drops `DispatchResult.route`; `packages/telemetry/src/public.ts` already publishes per-session usage; cockpit `services/control-plane-projector/src/projection.ts` hardcodes absent evidence; `src/observer.ts` owns durable snapshots. Projector startup belongs to cockpit and requires socket access, database wiring, service discovery and a matching source identity. Live session steering remains deferred.
