# Context pack

I1 checker source, tests, CI wiring and reference are implemented. Read `plan.md` and
`verification.md`: 14 receipt tests and the repository gates passed, with the documented
executable-scratch setting for installed-contracts. A bypass control proved the real CLI tests
turn red if validation stops running. Independent implementation evaluation is pending.

This instrument proves receipt structure and requested/observed agreement only. Unknown fields
remain unproven. Matrix policy, I2/I3 launch admission, I4 and live divybot receipt completeness
are outside this slice. Design history and the measured dual-agent pilot remain in PR 339.
