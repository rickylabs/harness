# ADR 0002 — how the coordinator reaches `sandboxctl`

**Status:** accepted · **Date:** 2026-09-06 · **Ratified:** 2026-09-07 · **Supersedes:** nothing · **Issue:** #62

---

## Decision

**A privileged sidecar exposing four verbs over HTTP. Not an ssh executor holding `root@n5`.**

The owner approved the authenticated sidecar and the authority limits below on 2026-09-07.
[Owner ratification](https://github.com/rickylabs/harness/issues/62#issuecomment-5566218913).
This authorizes implementation of this channel; it does not certify a deployed sidecar or
authorize production activation or a live canary.

[observed - owner decision on issue 62; topic: sidecar authority ratification; retrieved 2026-09-07]

## Context

`sandboxctl` lives on the N5 host, at the path #62 names, and is deliberately never run from inside
an agent container. The coordinator has no way to call it at all today, which is why every other
task in E5 is waiting.

The script is small enough to read in one sitting — 42 lines, one `case`, four verbs — and reading
it is what settles this record. What it does is not a design question; it is a fact:

| verb | what it actually does |
|---|---|
| `create` | starts a **privileged** container with `--restart unless-stopped`, joins the shared agent network, bind-mounts the whole agents home tree, runs dockerd on a plain TCP port with **TLS disabled**, then execs into the **live agents container** to rewrite its `/etc/hosts` |
| `destroy` | removes that container **and its data volume**, then execs into the agents container again to unpin the hosts entry |
| `reset` | `destroy`, then `create` |
| `status` | lists the container and the volume. Reads nothing else, writes nothing |

Three properties of that table decide the record.

**Three of the four verbs are irreversible or privileged, and one is neither.** `status` is the verb
the coordinator will call constantly — it is the input to a board projection. `destroy` deletes a
volume. A channel that cannot tell those two apart is not a channel.

**Every mutating verb reaches into the live agents container.** The hosts-pinning step is an exec
into the container that holds the running tmux agent sessions and the orchestrator. So "narrow" here
does not mean "cannot touch the fleet" — it means the *set* of ways to touch it is enumerable. That
distinction is the whole decision, and pretending the sidecar is hermetic would be the wrong reason
to choose it.

**The script does no argument validation.** The project name is interpolated into a shell string
that runs inside the agents container, and the CPU and memory caps are positional arguments with
defaults. Whichever channel is chosen inherits the duty of validating both, because `sandboxctl`
will not. Under an ssh executor there is nowhere for that validation to live.

## The authority surface

#62's second acceptance criterion, answered explicitly. The coordinator may invoke exactly this and
nothing else:

| | verb | gate |
|---|---|---|
| 1 | `status <project>` | none — read-only, callable on any schedule |
| 2 | `create <project> [cpus] [mem]` | `<project>` must match a registered project; `cpus` ≤ 6 and `mem` ≤ 24g unless the request carries an explicit override recorded on an issue |
| 3 | `reset <project>` | as `create`, plus: refused while any run holds a lease on that project (E3 · #56) |
| 4 | `destroy <project>` | **never autonomously.** Owner-initiated only; the coordinator may propose it and may not perform it |

`<project>` is a closed set, validated against the registry — never a free string, because it lands
inside a shell command in the agents container. Anything not in this table is not reachable: no
shell, no arbitrary container name, no path, no `nerdctl` passthrough.

The 6 CPU / 24 GB default is not arbitrary and is not the sidecar's to relax on its own: it is the
cap that keeps a runaway build from starving the GPU workloads, which is a failure this fleet has
already had once.

## Why not the ssh executor

The honest version of the ssh option is not "broad authority". It is **no authority surface at
all**: the coordinator's permission would be *the host*, and a permission that cannot be enumerated
cannot be gated, reviewed, refused, or logged as a decision. Principle 5 says nothing mutates before
the gate; a gate needs a list of verbs to be a gate. Principle 6 says a gate that cannot run is
unproven — and a gate over `root@n5` cannot be written in the first place.

Three consequences follow, in descending order of how much they would cost:

1. **Every recorded operational rule on this host becomes an accident the coordinator can have.**
   The archiver must not be modified, the orchestrator must never be killed, one GPU backend stays
   stopped, sandboxes stay capped. Root can do all four by mistake. Four verbs cannot do any of
   them.
2. **There is no artifact.** This project exists because `status ?` was the only way to find out
   what was happening (#39). An ssh executor produces a shell transcript; an HTTP surface produces a
   request log with a run id attached, which is something a board can project. Principle 2.
3. **Vendor-neutrality is lost quietly.** An ssh executor is a capability of whichever process holds
   the key. A verb surface is a capability of the coordinator, and any transport can hold it —
   principle 11.

The ssh option's one real advantage is availability, and it is a real one: sshd is up whenever the
host is, and a sidecar is one more thing that can be down. That is answered below rather than
dismissed.

## Cost of being wrong

**If the sidecar is the wrong call**, the cost is a container to keep alive and a few hundred lines
that reimplement, over HTTP, something a single `ssh` line would have done. It is recoverable in an
afternoon: the sidecar's client is one adapter, and swapping it for an ssh executor later changes
one module. The work is not wasted either way, because the argument validation and the verb table
above have to exist under both options.

**If the ssh executor is the wrong call**, the cost is not recoverable by editing code. It is a
coordinator that had root on a host running a live fleet during the period when it was least
understood, and the failure mode is silent: nothing announces that a caller exceeded an authority it
never had a boundary for. That asymmetry — cheap to undo one way, not the other — is the argument.

**The availability objection, answered.** The sidecar being down must be `unknown`, never `failed`,
and must never be reported as "no sandbox". This is the same rule `provider.ts` is built around and
for the same reason: a specific wrong claim has a destructive action attached to it. Concretely,
`status` failing means the board shows the sandbox as *unknown* and the coordinator does not
schedule against it; it does not mean the coordinator falls back to a broader channel. **A fallback
to ssh would delete the entire benefit of choosing the sidecar**, so there is no fallback.

## Consequences

- The sidecar is itself privileged — it must reach the host's container runtime — and it sits on a
  network shared with agent containers. **It must authenticate**, and that is the one thing the ssh
  option gets for free from sshd. Building it without authentication would be strictly worse than
  the option rejected here.
- Argument validation moves into the sidecar, because `sandboxctl` has none. The verb table above is
  the specification.
- `destroy` is deliberately outside the coordinator's reach. If that proves too strict in practice,
  the fix is a superseding record, not a quiet widening.
- E5 · #66 wires the gate at this boundary and cannot start before this record is accepted. #63,
  #64 and #65 define regimes and do not depend on the channel; they can proceed in parallel once the
  owner has ratified the sequencing.
- Nothing here is enforced mechanically yet. Until the sidecar exists, the coordinator's authority
  over `sandboxctl` is *none*, which is the correct default and should stay the default while this
  sidecar is implemented and its gates are verified.
