# Q6 native default effort verification

Focused controls, all compiled guard mutants and required repository gates pass. This validates the producer and paired strict reader; live consumer integration still needs its exact paired pin.

- Baseline producer and reader: 9 passing controls and 3 assertion failures. Native empty maps were `null` rather than `[]`, and the reader accepted a forged unverified default claim. Temporary executable policy failures are excluded.
- Fixed focused suite: 13 tests pass, including exact named ROCm efforts, missing maps, header-only observations, unverified serializers, opaque/disabled maps, malformed maps, duplicate keys, body/header identity conflicts, provider-read refusal and paired decoder negatives.
- Every fixture observation permits only version/models/owned-loopback provider metadata reads; the positive control proves its server is reaped. There are no native turns.

## Compiled mutations

All 14 mutants compiled, then failed assertions. The source was restored and the focused suite passed afterward. Compile-only failures are excluded.

| Surface | Killed mutations |
| --- | --- |
| Producer | Empty-contract check disabled; verified-version check ignored; nonempty map asserted default; missing map asserted default; invented high effort; observed version discarded |
| Paired reader | Contract check removed; launcher scope removed; empty-claim check disabled; version proof ignored; variant proof ignored; source proof ignored |
| Retained identity checks | Native model ID equality ignored; native provider equality ignored |

## Repository gates

- `pnpm install --frozen-lockfile`: exit 0.
- `pnpm run typecheck`: exit 0, all four stages green.
- `pnpm run build`: exit 0, all fourteen stages green.
- `pnpm test`: exit 0, all six stages green, including offline installed-package runtime and declaration checks.
- `git diff --check`: exit 0. Public patch leak scan: no operational paths, private network addresses, credential values or native session identifiers.

Full gates use already-installed Node 24.20.0, npm 11.19.0 and pinned pnpm 11.25.0, with a child-only executable temporary directory for existing fake-CLI fixtures. Node 26.10.0 typecheck also passed. Default npm 12.1.0 emits keyed pack JSON instead of the array expected by existing repository gates; that build was INCONCLUSIVE at publishability and its extracted-package test failed. Those toolchain runs are not reported as passing. The successful Node 24/npm 11 run required no source checker, global toolchain or host policy change.
