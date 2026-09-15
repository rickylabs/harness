"""Print verbatim excerpts; full subprocess output remains beside this file."""
from pathlib import Path

run = Path(__file__).resolve().parent
print('$ python3 .llm/runs/three-gates--316/run-validation.py\nexit 0')
print((run / 'root-validation-transcript.txt').read_text())
print('$ node --test scripts/inconclusive.test.mjs scripts/check-test-scripts.test.mjs scripts/run-stages.test.mjs scripts/gates-regressions.test.mjs\nexit 0')
print((run / 'scoped-tests.txt').read_text())
print('$ pnpm run typecheck  # original noexec checkout\nexit 2\n$ tail -10 .llm/runs/three-gates--316/noexec-typecheck.txt\nexit 0')
print('\n'.join((run / 'noexec-typecheck.txt').read_text().splitlines()[-10:]))
print('\n$ pnpm run check:gate-mutations\nexit 0\n# Verbatim command/assertion excerpts; full stdout/stderr: mutations.txt')
phase = None
for line in (run / 'mutations.txt').read_text().splitlines():
    if line.startswith('baseline:'):
        phase = 'baseline'
        print('\n' + line)
    elif line.startswith('mutant:'):
        phase = 'mutant'
        print(line)
    elif line.startswith(('mutation:', 'replace:', 'with:', 'exit code:', 'ok 1 -', 'not ok ', 'Mutation verification:')):
        print(line)
    elif phase == 'mutant' and line.startswith(('command:', "  code: 'ERR_ASSERTION'", '  expected:', '  actual:')):
        print(line)
