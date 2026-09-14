# Dual-agent consultation — draft pilot contract

Retain this as a pilot. Real answers recovered history and changed slice priority toward I1,
but repeated correlation/replay errors and absent wake semantics prevent claiming a dependable
request channel. No efficiency gain has been measured. This draft defines the minimum contract
to test, not a new runtime or ratified API. Evidence and later corrections follow below.

## Addressing and correlation

A question needs an opaque `questionId`, repository identity, lane, sender and intended
counterpart references, question text and `askedAt`. An answer needs an opaque `answerId`,
`inReplyTo` equal to that question's identity, responder reference, `answeredAt`, outcome,
answer text and cited evidence. Explicit destination beats inferring a lane from a directory
substring. Session references belong only in private operational storage.

Outcomes distinguish `answered`, `needs-owner` and `cannot-answer`. Asking again must reuse
an idempotency key or name `supersedes`; a delayed answer must never attach to the next question.
Concurrent questions must remain separately answerable. Reading an answer is not consuming it.
Only the actual recipient can acknowledge receipt; a local append proves only local enqueue.

## Durable record and cockpit boundary

During the pilot, keep the existing file mailbox as transport. Manually retain a sanitized
question/answer digest and evidence disposition in this directory. Keep raw mailbox contents,
exact session references and operational addresses private. Do not commit a raw transcript.

A future adapter may emit proposed `consultation.asked`, `consultation.answered` and
`consultation.acknowledged` events to cockpit's existing durable event log, correlated by
question identity, event identity and causation. These names are draft vocabulary, not claims
about bound API operations. Cockpit owns the event schema, sequencing and append receipt;
Harness must consume that contract through NetScript discovery before implementing an adapter.
Retries use stable event identities and acknowledgements; replay must not send an answer twice.
Do not claim exactly-once delivery from a file append.

A history answer provides evidence. An owner answer provides authority only through a decision
record with provenance. A `needs-owner` result links to the charter's decision identity; cockpit's
existing effect ledger owns the single accepted answer, writer fence and receipt. The reply
routes to the raising session. The mailbox never becomes a second decision ledger or a way to
start agents (`ARCHITECTURE.md:86–105`, `:169–190`).

## Trial measurements

| Sample | Question purpose | Local enqueue | Answer observed at first cutoff | Benefit |
| --- | --- | --- | --- | --- |
| A | Recover overnight state and agreed boundaries | accepted | no | unmeasured |
| B | Adversarial check of I4 plan and dispatcher ownership | accepted | no | unmeasured |

Cutoff: 2026-09-14, before either reply. Neither observation is a delivery timeout; latency is
right-censored until an answer arrives. Count unanswered questions separately from successful
round trips. Measure elapsed answer time, whether citations resolve, whether the answer changed
a decision or prevented repeated work, and how many corrections it needed. Do not invent saved
minutes without a measured baseline.

Before promotion, exercise a real answer, two outstanding correlated questions, a delayed reply,
and safe replay after reader restart. These are proposed evidence criteria for owner fork 1,
not work already completed. Counterpart consultation alone does not satisfy charter I2.

## First answer observed

The counterpart echoed the first question timestamp, identified I1 receipt validation as the
first useful slice, and described the mailbox limitations consistently with local inspection.
Its answer header was 153 seconds after the question header; this measures author-supplied
answer time, not transport latency or confirmed read time. The reader observed the answer later.
The caller revised the draft's slice priority as a result. That is one observed benefit, with
no claimed speedup. The original question still carries the literal unanswered marker, and
re-reading returns the same answer again. No machine-readable acknowledgement or cursor exists.

## Further trial observations

The counterpart acknowledged that its I4 scope objection was wrong after checking the cited
charter lines. Treat history advice as evidence to verify, not authority that supersedes the
charter. A later relay claimed that different OpenAI models satisfy I2; the author challenged
it against the explicit different-vendor-family requirement. No same-family evaluation was
accepted. The attribution and any proposed amendment remain unconfirmed.

The counterpart reported a second watcher failure: one answer covering two questions broke
its count-based outstanding-work calculation. Required correlation must identify each addressed
question; an answer covering several needs explicit per-question links and completion state.
A total answer count cannot compute pending questions. The current draft's single `inReplyTo`
form would use one reply record per question, with shared answer text by reference if needed.

The caller's temporary local read position also returned a partial word at the next read.
That observation does not prove why the file changed, but it proves a byte offset alone was
not a reliable cursor in this trial. A supported cursor needs immutable ordered records or a
file-generation check with replay/deduplication after replacement. Merely adding an offset to
the current helpers would preserve an observed failure.

## Operational consequence and authority correction

The offset-based reader missed an expense-guard refusal in an earlier answer. The caller had
already queued a review request based on catalogue presence; after reading the missed answer,
it withdrew that request and asked for cancellation confirmation. No evaluation result was
accepted. This makes reliable replay and explicit acknowledgement an admission requirement,
not merely a convenience. It does not prove that a dispatcher actually started the request.

The counterpart later confirmed that the proposed same-family evaluation had been withdrawn
and that no charter amendment supported it. It also clarified that the four suggested mailbox
properties were peer recommendations, not an owner decision. The draft retains owner fork 1;
no promotion or altered independence rule is ratified here.

## Wake and liveness follow-up

Observed 2026-09-14: source inspection of the installed helpers found no wake or notification
operation (research.md, Dual-agent observation). The counterpart subsequently reported three
terminated background watchers, the last about one minute after starting, and said its answers
were written only when another channel woke it. Those are peer runtime reports, not independently
observed process receipts. Its claim that host policy caused the terminations is an inference;
free-memory observations do not establish that cause. No cause is promoted to a measured fact.

A successful file append therefore proves local enqueue only. The current helper contract supplies
no bounded wake or reply latency. Existing answer timestamps demonstrate completed exchanges,
not continuous reader availability. A proposed adapter must either expose an evidenced wake result
and recipient-observed acknowledgement or explicitly report wake unsupported. A last-seen marker
can show a past read; it cannot prove the counterpart is currently listening.

Current recommendation for owner fork 1: retain the pilot and its sanitized evidence; do not promote
these helpers as a supported request channel yet. Test durable identities, per-question completion,
replay after replacement/restart, and wake/acknowledgement before a thin adapter is ratified. The
future adapter still consumes cockpit's authoritative event contract; no separate queue, dispatch
mechanism or decision ledger is justified by this trial.

The initial withdrawn request did launch: issue 340 later received the evaluator's stand-down
acknowledgement. This corrects the earlier observation cutoff, not the original withdrawal record.
No useful evaluation was accepted from it. The mailbox miss had a real dispatch consequence.

## Owner direction — 2026-09-14

Retain the pilot and defer any protocol/promotion decision to a separate brainstorm. [Issue #349](https://github.com/rickylabs/harness/issues/349) and [mailbox-rfc.md](mailbox-rfc.md) collect the findings and open questions. Earlier proposed contract language remains exploratory, not a ratified default.
