# TOOLCHAIN

**The toolchain is pinned, and the pin is not in this repository.** It lives one directory above
the checkout, so every worktree inherits it and `git status` never sees it.

---

## Why the pin is outside the checkout

A tracked version file forces a choice between two bad options: pin it and every host is stuck on
whatever the file says, or leave it unpinned and no two hosts agree. Worktrees make it worse — a
tracked pin is *per branch*, so a worktree mid-migration carries the wrong version by construction.

Putting the file in the parent directory removes the choice. The layout is:

```
projects/<name>/
├── .mise.toml          ← the pin. Not a git repository. Never committed.
└── repo/               ← the checkout
    └── worktrees/…     ← every worktree, inheriting the same pin
```

mise walks upward from the working directory, so `repo/` and every worktree resolve the same
toolchain without a single tracked byte. A worktree that genuinely needs a different version gets
its *own* `.mise.toml` inside itself, and the directory hierarchy does the switching — this is how
`netscript` runs one Aspire version project-wide and an older one under a migration worktree.

This is the pattern already in use for the sibling projects: `autocorner` pins bun, `netscript`
pins deno, aspire, dotnet and node, each at `projects/<name>/.mise.toml`.

## What this project pins

Two tools, and one standing rule for each:

| Tool | Rule |
|---|---|
| `node` | **Always latest.** Resolve it with `mise latest node`; do not carry a remembered number. |
| `pnpm` | **Must equal `packageManager` in the root `package.json`.** |

Deliberately, **the versions are not written down here.** They have one home — the host's
`.mise.toml` — and a second copy in doctrine would be a future contradiction (PRINCIPLE 9), stale
the first time "always latest" resolves to something new.

The pnpm rule is the one that can silently rot. `packageManager` is what the repository declares
and what CI honours; the mise pin is what an interactive shell on the host actually gets. When they
diverge, local builds and CI builds run different package managers while every file on disk still
looks correct. Change them in the same commit or not at all.

Node is pinned rather than ranged even though the rule is "always latest", because a range makes a
build unreproducible for the sake of saving one edit. Bump it deliberately, the way anything else
that can break a build is bumped.

## Reproducing on a fresh host

From the project's parent directory, as the **agent user** — never as root:

```sh
mkdir -p projects/harness
cat > projects/harness/.mise.toml <<'TOML'
[tools]
node = "<mise latest node>"
pnpm = "<packageManager in package.json>"
TOML

cd projects/harness
mise trust
mise install
```

Then verify — and verify by **executing** the tools, not by asking mise what it thinks:

```sh
cd repo && mise exec -- node --version && mise exec -- pnpm --version
```

## Two traps, both hit while setting this up

**1. Never run `mise` as root.** A single root invocation — even a read-only one like
`mise latest node` — creates root-owned directories under `~/.cache/mise`. The agent user then
cannot write there, and the *next* install fails with a bare `Permission denied` that names a cache
path and says nothing about ownership. Repair is narrow:

```sh
find ~/.cache/mise ~/.local/share/mise ~/.local/state/mise ! -user <agent> -exec chown <agent>:<agent> {} +
```

**2. `mise current` is not evidence that a tool works.** mise treats an install directory's
existence as proof of installation. A failed install leaves the directory behind empty, and from
then on `mise install` reports *"all tools are installed"* while `mise current` lists the version —
and the binary is not there. The failure surfaces much later as
`"<tool>" couldn't exec process: No such file or directory`.

The phantom is cleared by forcing a real reinstall:

```sh
mise uninstall <tool>@<version> && mise install <tool>@<version>
```

This is why the verification step above runs `mise exec -- <tool> --version` rather than
`mise current`. A version string printed by the tool itself is evidence; a version string printed
by the version manager is a claim about a directory name.

## What this does not cover

The pin governs the toolchain a shell gets on the host. It says nothing about what CI runs — CI
declares its own versions in the workflow — and nothing about the container images used for
sandboxed builds. Three places, deliberately: keeping them in sync is a review responsibility, and
a change to one that should have touched the others is a finding, not a formality.
