"""Capture literal commands, status and output for the issue-316 PR."""
import json
from pathlib import Path
import subprocess

run = Path(__file__).resolve().parent
checkout = Path('/tmp/harness-three-gates-316-verify')
commands = [
    ('typecheck', 'TMPDIR=/tmp pnpm run typecheck'),
    ('build', 'TMPDIR=/tmp pnpm run build'),
    ('test', 'TMPDIR=/tmp pnpm test'),
    ('installed-noexec', 'TMPDIR=/ephemeral/tmp pnpm run check:installed'),
]
records = []
for name, command in commands:
    result = subprocess.run(['bash', '-c', command], cwd=checkout, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    (run / (name + '.txt')).write_text(result.stdout)
    record = {'command': command, 'cwd': str(checkout), 'exit': result.returncode, 'output': name + '.txt'}
    records.append(record)
    (run / 'validation.json').write_text(json.dumps(records, indent=2) + '\n')
    print(f'$ cd {checkout}\n$ {command}\nexit {result.returncode}\n' + '\n'.join(result.stdout.splitlines()[-14:]), flush=True)
    expected = 2 if name == 'installed-noexec' else 0
    if result.returncode != expected:
        raise SystemExit(1)
