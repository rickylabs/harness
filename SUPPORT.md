# Support

This is a private repository with one owner. There are no Discussions, no wiki, and no public
support channel — so the honest routing is short.

| I want to… | Go to |
| --- | --- |
| Do this for the first time | [From a clone to a moving board](docs/tutorials/01-from-clone-to-board.md) — fifteen minutes, no server |
| Know what a flag or an exit code means | [CLI reference](docs/reference/cli/README.md), or `--help` on the binary — both are generated from the same source |
| Know why it is built this way | [`docs/concepts/`](docs/concepts/), then [`doctrine/`](doctrine/) |
| Know what is built and what is not | The [E0 roadmap](https://github.com/rickylabs/harness/issues/30) and the board — not a status section in a README |
| Report something broken | [Open an issue](https://github.com/rickylabs/harness/issues/new/choose) with the matching form |
| Report a vulnerability | [`SECURITY.md`](SECURITY.md). Never a public issue — in this repository that is worse than usual |

## One warning that belongs here

**Do not label an issue `harness` to get attention.** That label dispatches a real agent on a real
host against the issue body, within about thirty seconds, with no confirmation step. It is not an
escalation flag and it is not a ping; it spends compute and can cause writes.
[`AGENTS.md`](AGENTS.md#operational-hazard-this-repository-is-a-live-inbox) has the full hazard.

## Status

Everything here is pre-1.0. `@rickylabs/harness-contracts` is the only published package and its
compatibility policy is in [`packages/contracts/README.md`](packages/contracts/README.md). Every
other package is `private: true` and consumed from a checkout, which means the supported version is
`main` and interfaces can change without a deprecation cycle.
