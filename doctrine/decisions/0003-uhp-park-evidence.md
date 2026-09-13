# ADR 0003 — §10's evidence has half changed: a router exists and cannot execute

**Status:** proposed · **Date:** 2026-09-13 · **Supersedes:** nothing · **Amends:** `ARCHITECTURE.md` §10 · **Issues:** [#294](https://github.com/rickylabs/harness/issues/294), `rickylabs/atelier-cockpit` #105, #107

---

## Decision requested

**Re-take the §10 park with corrected evidence. My recommendation is that the park holds.**

This record is filed under §13 because two of my own open pull requests are work against the parked
epic, and continuing to build on a changed fact without saying so is the failure mode §13 exists to
stop. I am not asking for the park to be lifted. I am asking for it to be re-taken knowingly, because
one of the two facts it rests on is now false.

## Context: what §10 says, and what is true

§10 parks UHP-hosted dispatch on two stated reasons:

> no router instance exists to talk to, on any host, and the spike that would prove a live
> round-trip (#294) has never been funded.

**The first is now false. The second is still true.**

### A router exists and answers

Verified directly, and independently re-verified by the session that raised the park:

```
$ curl -o /dev/null -w "%{http_code}" http://netscript-dind:3000/
307

$ DOCKER_HOST=tcp://netscript-dind:2375 docker ps
harness-router-dev | harnessrouter/harnessrouter:latest | Up 9 hours (healthy)

$ curl http://netscript-dind:3000/api/harness/v1/harnesses
{"detail":"sign in to continue"}      HTTP 401
```

Artifact named by digest rather than by a moving tag:

```
harnessrouter/harnessrouter@sha256:ffd23edd5920e13d14cb401008d02728ef9dfa91c750065af0d51050fe15691f
```

### It cannot execute anything

`GET /api/harness/v1/models` reports **eleven backends installed and every model on every backend
`available: false`**, because no provider credential is configured.
`GET /api/harness/v1/harnesses` returns an **empty array**, so there are no `chrn_` identifiers to
pin and the declarative manifest cannot be reconciled.

**The accurate statement is: a router instance exists and answers, and it cannot yet execute
anything.** A summary that says "the router works" would be false in the way that matters.

### Provenance, which is a finding in its own right

It runs in **netscript's** DinD sandbox, started there because neither `harness` nor
`atelier-cockpit` has one provisioned. It is borrowed, not its right home. If the park is ever
lifted, "the router runs inside another project's sandbox" is a real cost with its own consequences —
lifecycle owned by an unrelated project, and a blast radius shared with that project's containers.

It also publishes on `0.0.0.0`, where RFC-UHP-INTEGRATION §3.3 F12 specifies loopback. That
deviation is bounded by the sandbox network but is recorded so nobody reconciles a specification to
an expedient.

## Recommendation

**Hold the park, and correct §10's stated evidence.**

The park's operative purpose is to stop contracts being shaped against an **untested assumption**.
An unauthenticated router with no executable backend does not test that assumption. It proves the
image pulls, the container runs, and the API surface exists and is gated — none of which is the thing
in doubt. The round-trip #294 would prove remains unproven, and #294 remains unfunded.

So the conclusion §10 reached still follows. Only one of its two premises does.

I make this recommendation against my own work: **#105 and #107 are the work that stays parked if it
is accepted.** I would rather they stay parked correctly than proceed on a premise nobody re-examined.

Suggested amendment to §10, replacing the first reason:

> A router instance exists and answers but cannot execute: every backend reports every model
> unavailable for want of a provider credential, and the harness list is empty, so no identifier can
> be pinned. The spike that would prove a live round-trip (#294) has never been funded. Contracts
> shaped against it therefore remain work against an untested assumption.

## Cost of being wrong

**If the park holds and the router later proves out:** the cost is rebuilding whatever #105 and #107
have become. Both are draft, unmerged, and narrow — a Compose profile and a read-only SSE projection.
The projection's decisions are transport-independent, so most of it survives a rebuild. Low.

**If the park is lifted and the round-trip never proves out:** the cost is every contract shaped
against it in the meantime, which is unbounded because it grows with time and with how many
consumers bind to those shapes. `atelier-mobile` already consumes this repository's generated client,
so a contract shaped wrongly here propagates into a third repository. High, and asymmetric.

That asymmetry is the argument. The cheap mistake is holding a park a little too long. The expensive
one is lifting it on evidence that a router answering `401` is the same as a round-trip working.

**What it costs to do nothing:** the park's stated evidence stays half false in a ratified document,
and the next person to check finds a live router and reasonably concludes the park is stale. That is
the outcome this record exists to prevent regardless of which way the decision goes.

## What would change the recommendation

A provider credential placed in that container, making at least one backend available and at least
one `chrn_` identifier pinnable, followed by #294's round-trip. That is an owner decision about which
subscription to expose and is not one any coordinator should take.

---

[observed - live verification from an agent container, 2026-09-13; re-verified independently by the session that authored §10]

---

## Addendum — the second premise has further to run than this record first said

Added after the session that raised the router concurred on this record and quantified what it
understated. Recorded here rather than left in the pull request discussion, because a decision record
that loses half its evidence on merge is not durable.

**Concurrence, stated so it is not mistaken for a split.** That session's note on
[#294](https://github.com/rickylabs/harness/issues/294) said §10's conclusion is accurate. This record
says §10's first premise is false. Both are true, about different sentences: the literal claim *"no
router instance exists"* is false, and the operative claim *"nothing can be connected to"* holds. Same
distinction, same recommendation.

**"For want of a provider credential" understates the distance.** Measured against the live instance
by that session, reading `/harnesses` authenticated, four steps separate *the router answers* from
*a round-trip is provable*:

1. A provider credential is configured. The owner's call, and nothing proceeds without it.
2. A harness **object** is created. A fresh instance has none, and the eleven installed backends are
   not harness objects. Nothing in this repository can create one.
3. `config/harnesses.v1.json` is reconciled against real `chrn_` identifiers, with `reconciledAt`
   stamped. Only then does `provider-uhp` stop refusing every dispatch, which it currently does
   correctly.
4. #294's round-trip runs against a harness that can actually execute.

This strengthens the recommendation rather than weakening it. The park now rests on the half of the
evidence with the most distance left in it.

**Two corrections, both in the direction of holding.** Borrowing netscript's sandbox makes the
instance less available than "a running container" sounds: it competes for that project's capped CPU
and memory. And it is disposable with no owner and no lifecycle — created by hand, in a sandbox whose
`/etc/hosts` pin is lost when the agent container restarts, with nothing to recreate it. An argument
leaning on its continued existence would be leaning on nothing.

**Also parked, in this repository:** #298, #299 and #301, labelled and branches retained per §10.
#301 is a breaking change to a published package and should not sit on `main` for an epic that
produces no records, because the next tag cut from `main` would carry it.

[observed - the four-step breakdown and the empty harness list are that session's authenticated
measurements, not this author's; unauthenticated re-verification from this container returns 401 and
cannot see the list. Router liveness and the 307 re-confirmed here 2026-09-13.]
