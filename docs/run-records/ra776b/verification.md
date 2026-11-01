# Source verification

The complete root gate chain ran under the supported Node toolchain with an executable temporary
directory outside Git. All final commands exited 0:

| Command | Actual final output |
| --- | --- |
| `pnpm install --frozen-lockfile` | `Scope: all 15 workspace projects`; lockfile up to date |
| `pnpm run typecheck` | `typecheck ok — 5 stage(s), all green`; compile ran |
| `pnpm run build` | `build ok — 15 stage(s), all green`; compile ran |
| `pnpm test` | `test ok — 8 stage(s), all green`; telemetry: 810 tests, 810 pass, 0 fail |
| `pnpm run check:leaks` | exit 0, no findings |

The initial environment used a tool-manager shim which selected a newer npm with a different pack
JSON shape. Its publish stage was inconclusive. The final build uses the direct supported
executables and the unchanged publish gate passes. No gate was bypassed or weakened.

The two required negative controls compiled (exit 0) after native selection was reverted to the
previous production collector. Both failed at runtime (2 tests, 0 pass, 2 fail, exit 1): resumed
execution was missing and retained history occupied the bounded selection. After exact-byte source
restoration, compile exited 0 and both tests passed (2 pass, 0 fail, exit 0).

The actual `harness-contracts-v0.36.0` tagged decoder was separately compiled and read real producer
frames. Complete native, default overflow and faceted native controls passed (3 pass, 0 fail,
exit 0). The overflow control also proves that opting into a bounded forest preserves its running
root, passes the current decoder, and is rejected by the older decoder. Default rows remain empty
and accepted by the older reader.

The whole-repository prune search (excluding owner-controlled run files) for the removed fixture
basename and function returned exit 1 with zero matches. The changed-file cap and whitespace checks
passed; owner-controlled run files and generated files are unchanged. Private logs and native
fixtures are not committed. Real deployment and privileged upstream kernel checks are not claimed.

The final native recorded-token controls compiled and failed against the prior signed source
(2 tests, 0 pass, 2 fail, exit 1): `codex-run` and `opencode-run` workspaces lost their roots.
With the documented native tokens supported, both controls pass (2 pass, 0 fail, exit 0), covering
restored canonical integration matching and final assignment end with stable opaque identity.
All five root gates above were rerun after that production change; the final telemetry count is 810.
