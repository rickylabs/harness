# Three gates — verification

Success and inability are independently observed. Literal logs are committed beside this file;
`summarize-validation.py` prints verbatim excerpts for the PR body, including each mutated
command, status and failing assertion. It does not invent expected output.

## Environment and provenance

Node 26.8.2; pnpm 11.25.0. Original checkout is on `/ephemeral`, a noexec mount. The owned
executable verification clone is `/tmp/harness-three-gates-316-verify`; its origin was corrected
to the actual GitHub repository after `check:skill` correctly could not establish a repository
identity from the local clone's filesystem origin. Initial failure output is retained in
`build-initial.txt`; final root commands and status are in `validation.json`.

`validated-source-sha256.json` records all copied scripts plus package.json/BOARD.md and was
compared against the executable clone before the final root run. This makes the successful
checks evidence about the same source as the noexec control. Only BOARD.md changed when the
shallow baseline was deepened and fast-forwarded from ade559b to 318bd11; no product overlap.

## Evidence

- `scoped-tests.txt`: full focused test output.
- `mutations.txt`: green baseline then named ERR_ASSERTION/exit 1 for every isolated mutant.
  Source mutation is refused unless the exact guard occurs once; infrastructure errors are
  rejected as mutation evidence. Temporary mutation trees are removed in finally.
- `root-validation-transcript.txt`, `typecheck.txt`, `build.txt`, `test.txt`: root gates and
  installed success fixtures, with exit statuses in `validation.json`.
- `installed-noexec.txt`: real noexec scratch execution refusal with owned location and EACCES.
- `noexec-typecheck.txt`: unavailable tsc shims return INCONCLUSIVE and compilation DID NOT RUN.
- Independent evaluation: separate Meta-family session; initial and final delta verdicts are
  recorded in implementation-eval.md. Requested xhigh effort is not independently observable.

## Limits

Shell exit conventions cannot distinguish a deliberately chosen 126 from a real shell refusal.
Compile reporting is stage-level, not a census of packages inside recursive pnpm. Full gate
stdout is captured with a 32 MiB bound and printed at stage completion; an incomplete capture
is inconclusive. Exempt packages are explicitly uncovered; a passing declaration audit makes
no test-coverage claim about them. Host/fixture controls are synthetic except for actual
filesystem execution and root commands. No live provider acceptance or release is claimed.
