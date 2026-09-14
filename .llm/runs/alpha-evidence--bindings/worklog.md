# Evidence binding implementation

Harness preserves `DispatchResult.route` through instrumentation into the existing `dsh-telemetry runs --json` read. Its additive `dispatches` array is keyed by dispatcher identity and carries the explicit native-session reference, seam and canonical route. The provider implementation name is not substituted for router evidence. Public cwd values are withheld and diagnostics are recomputed from the remaining evidence.

Validation: workspace typecheck and build passed. All package tests passed. The installed-contract gate initially reported inconclusive because its default scratch directory was not executable; rerunning that gate in executable scratch passed. Additional CLI fixture exercises the real read path. Fixtures contain synthetic identities and measurements only.

Runtime limitation: this is a candidate implementation, not evidence of deployment or populated live seats. Existing processes must use this build. A pane must be explicitly bound to its dispatch, and subscription headroom needs an explicit account/window enrollment. No native observer is added; absent observed route fields remain unknown. Independent implementation evaluation and supervisor sign-off remain pending.
