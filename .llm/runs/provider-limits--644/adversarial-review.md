**Verdict: FAIL_FIX.** The scope is authorized and bounded, and the plan's credential, wire, and gate posture is mostly sound. Four design gaps must be fixed in plan.md before implementation; none requires rescoping.

**Blocking findings and exact fixes**

1. **Success clearance compares timestamps across clock domains.** Decision 4 clears a same-scope refusal on a "strictly later" success, and decision 5 takes the success time from the OpenCode export's own clocks. Refusals are stamped on local receipt. Skew between the export clock and the governor clock can make a stale success outrank a fresh refusal, which is the exact "refusal clearing" critical risk. Fix: order the ledger by a single local monotonic sequence assigned at ingestion, never by source wall-clock. Keep source timestamps as data only. Add an S2 test where a success carrying a later source time but ingested earlier does not clear.

2. **Tombstones can wedge dispatch permanently.** Decision 4 never evicts tombstones, caps scopes at 1024, and fences dispatch on overflow. Tombstone meaning is not defined, and there is no recovery path. A host that cycles bindings will eventually fill the ledger with tombstones and fence forever. Fix: define a tombstone as "scope retired by explicit configuration removal", exclude tombstones from the 1024 active-scope cap or give them a separate cap, and specify an explicit operator compaction command under the same private boundary that removes tombstones only. Refusals remain non-evictable.

3. **Budget-veto removal is a live behavior change with no gate.** Decision 6 makes paid budget decisions stop vetoing and stop emitting unavailable. That changes current production semantics on the next ordinary divybot deploy, independent of whether provider-limits collection is enabled. The charter forbids live activation from this task, and merging a default-on semantics change is activation by deploy. Fix: put the new admission semantics behind a configuration key that defaults to current behavior, or record in plan.md the charter section or owner decision that authorizes changing the default. S4 mutation tests must cover both settings.

4. **Operator receipt import can clear refusals without a provenance mark.** Decision 5 allows importing trusted operator receipts as outcomes. An imported success is a clearance path for a refusal. Fix: tag every ledger entry with a closed source kind, for example native-bound, openrouter-metadata, or operator-import. Admission must be able to ignore imported successes by configuration. Import must run only through the same UID 0600 private path and reject any entry whose scope is not spelled out in full.

**Non-blocking fixes to fold in**

- Forbid environment-variable names in the public snapshot and in any diagnostic output. Names like a personal key variable identify accounts. Only configured aliases may appear.
- State that the ledger directory is 0700 and the temp file is created with O_EXCL before the synced rename.
- The 90 percent warning constant must be advisory only and must never feed admission. Say so in decision 6.
- Capture the Orchid baseline race result before the first Orchid slice. Research says it is still running. Without it, regressions cannot be attributed.
- Name the snapshot's output path in the plan and confirm it is not a path a live Cockpit reader already consumes, so a source merge cannot become activation.

**What passes as designed**

- Irreversible scope: no publication, no restart, no secret-store mutation, Refs not Closes, isolated branches. Good.
- Credential safety: fixed HTTPS endpoint, no redirects, size and timeout limits, no key hashes or prefixes, error text never public, HTTP errors become unknown and cannot create or clear outcomes. Good.
- Trusted native evidence: success only from a verified completed answer after identity, clock, and occupant fences. CLI exit and PR state explicitly rejected as success. Good.
- Wire compatibility: separate snapshot file, Cockpit 542 schema preserved, real decoder executed in S4. Good.
- Gates: S5 names the full Harness and Orchid gate set and requires truthful baseline recording. Good once the baseline is captured.

Next step is to amend plan.md decisions 4, 5, and 6 with the four fixes above and resubmit for plan gate.