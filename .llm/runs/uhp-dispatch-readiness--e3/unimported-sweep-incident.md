# Incident — three sweeps, sixteen candidates, sixteen live

Coordinator receipt. 2026-09-14. Board record is issue 331. The rule is pull request 324, held.

## Summary

Three sessions in three repositories independently swept for files nothing imports, in order to
delete them. Sixteen candidates. Sixteen live. Every one correctly identified as unimported.

    candidates correctly identified as unimported     16 of 16
    candidates that were safe to delete                0 of 16

Both true at once, which is the entire content of the incident. No search was broken.

## Provenance, kept separate

Only the harness row is measured by this session. The other two are as reported by the sessions that
ran them and are recorded as reports. Laundering a reported count into a measured one would be the
same class of error the incident is about.

| Repository | Candidates | Live | Caught before deletion | Provenance |
| --- | --- | --- | --- | --- |
| harness | 4 of 176 | 4 | yes, by opening each file | measured here |
| mobile | 14, then 11 on a full re-run | 11 | yes | as reported |
| cockpit | 1 | 1 | **no, it merged** | as reported |

The cockpit instance is why this is an incident and not three near misses. The deleted module was
the one a generator locates by naming convention to discover a service's query client. Between the
merge and the repair, main could not scaffold a screen. The reporting session states it reviewed and
approved that deletion.

## Mechanisms

    child process started by address    fork(new URL("./worker.js", import.meta.url))
    package entry point                 a manifest script runs node dist/thing.js
    read as data                        a test readFile()s the source and asserts on it
    naming convention                   a generator locates a module by path, never importing it

First three measured here. The fourth is the cockpit instance and is the one that caused the only
unrecovered failure. The mobile instance adds a variant rather than a class: a side-effect import
from a root file the scanner was not walking, plus nine modules enumerated by path inside a test.

## How the catches happened

Not by a better search. All three catches came from reading candidate files one at a time.

The harness probe had passed a control before producing its four: a module known to be imported came
back referenced by sixteen files, so the search demonstrably fired. It fired correctly and returned
four live files. **A control proves a search's mechanism, never its completeness**, and no search in
any of the three repositories would have caught any of the sixteen, because the information needed is
not in an import graph.

## The shape

Sharpened by the mobile session and better than my own phrasing of it: a correct search answers the
question *next to* the one being asked. "Nothing imports it" is a statement about the import graph.
A file reached by convention, by address, by manifest, or by being read as data leaves no edge there,
so the graph cannot be consulted about it. The fix is never a better search.

## Why this is a record and not a rule

Pull request 324 proposes the rule and is held for the owner. Two reasons, neither touched by three
new instances: a change to the file holding the method deserves a reader who did not write it, and no
gate in this repository can evaluate whether a rule is a good rule. A second session supplied half of
that rule and has recorded itself as co-author rather than reviewer. Three fresh instances make the
rule look more necessary and do nothing to make either of us a valid second opinion on it.

## Not a criticism of the sweeps

Two of the three were hygiene passes that correctly found nothing worth deleting and said so, which
is a result. The third deleted one file and cost a scaffolding path.
