# Worklog (ra776c)

## Slice a: restart-test root by ancestry

`a paired historical stop cannot end a resumed native working assignment` read `agents[0]` from
both the previous and the native producer; agents sort by opaque id, so the running child came
first in a share of runs. Both reads now select `parentAgentId === null`.

Control, serial, same machine, `--test-name-pattern` on the single test:
- before (head `b82bbb835`): 20 of 30 runs failed;
- after: 0 of 30 runs failed.
