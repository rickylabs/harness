# Native revision review

Earlier scan-based PASS and READY conclusions are superseded. The revised native plan passed independent review. Orchid PR #133 has a separate supervisor sign-off and full Go validation. Harness implementation review and cockpit parity remain pending; this file will record the final reviewed heads and actual gates.

## Harness native leaf supervisor sign-off

Reviewed code head: 53f4abe50f8fcabc117f961d83a08bc4195aa134. Verdict: PASS for
the Harness native leaf. Restored label/job key to Orchid keyed lookup to
point receipt reads to exact vendor/session proof verified; no
terminal/history/process scanning in the live path (removed readers reachable
only through the test-only historical fixture, which production never calls);
no cap increase; working/idle/final-fence liveness kept distinct; missing and
duplicate evidence stays unresolved; native session values absent from public
output. Root revision binds the native running evidence; the privacy regression
checks the actual native value. Final gates: frozen install, typecheck, root
build and full test all exit 0; leak scan exit 0. Cockpit integration leaf
remains pending. Complete end-to-end task is NOT certified until the cockpit
and downstream proof land.

## Certified-receipt port supervisor sign-off

Reviewed author head: 649c15dd72a58c31587788e817ab4fa05b3bfb02 against prior
sign-off 7a17e944eead8a289773bc114416b7094515a374. Verdict: PASS for this
source slice. Delta is only the optional `onBinding` port (certified receipt
plus binding, invoked after proof, failures swallowed so metadata can never
erase native execution), the seventh regression (unchanged receipt versus
restored handle, running survives metadata failure with no leak, no callback
on mismatched session), and worklog. Focused build and seven native tests
exit 0. Broad root gates pending until verified; no failure assumed.
