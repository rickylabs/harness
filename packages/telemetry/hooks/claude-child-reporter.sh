#!/bin/sh
# The Node reporter can hang on stdin or storage; never block Claude Stop.
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 0
timeout -s KILL 1.5s node "$script_dir/claude-child-reporter.mjs" "$1" >/dev/null 2>&1 || :
exit 0
