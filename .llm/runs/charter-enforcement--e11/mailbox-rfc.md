# Draft RFC: dual-agent consultation after the mailbox pilot

Status: draft for a separate owner brainstorm. Keep the current pilot. This RFC does not ratify a protocol, add a transport, or authorize implementation. The owner explicitly deferred that decision on 2026-09-14.

## Question

What is the smallest dependable contract for consulting a history-holding counterpart, and what evidence would justify making it a supported Harness capability? The decision should establish who a question addresses, how answers remain correlated after restart, and which durable facts belong in cockpit's control-plane log.

## Findings and limits

The detailed trial record is [dual-agent.md](dual-agent.md); source inspection and dispositions are in [research.md](research.md) and [worklog.md](worklog.md). These are sanitized observations, not raw mailbox transcripts.

| Observation | Implication | Evidence limit |
| --- | --- | --- |
| A history answer changed priority toward I1. | Consultation recovered useful context. | No saved-time baseline was measured. |
| The first answer header was 153 seconds after the question header. | One completed exchange occurred. | Author-supplied timestamps are not transport latency or recipient acknowledgement. |
| Helpers infer a lane from the current directory and append plain files. | Addressing is implicit. | A successful helper exit proves only local enqueue. |
| Two outstanding questions received one answer; prose counts drifted. | Counts cannot establish per-question completion. | Correlation was manual. |
| A byte-offset read returned a partial word and missed an admission refusal. | Replay after file replacement needs an explicit contract. | The underlying replacement cause was not established. |
| The missed refusal led to a real review dispatch, later withdrawn. | Reader correctness affects admission decisions. | No useful evaluation was accepted; [stand-down acknowledgement](https://github.com/rickylabs/harness/issues/340#issuecomment-5660769845). |
| Helper inspection found no wake operation. | Appending a question does not establish an active listener. | The counterpart's watcher-termination explanations remain peer reports and hypotheses. |
| Several history claims conflicted with the charter and were corrected. | Replies supply evidence, not overriding authority. | Counterpart consultation does not itself satisfy evaluator independence. |

The latest configurable-pin question was enqueued successfully; no matching new answer was observed at the reading cutoff. It contributes an unanswered sample, not a successful round trip or a delivery timeout.

## Options for the brainstorm

1. Continue the plain-file pilot with manual source checks and sanitized summaries. This is the current owner direction. Cost: weak correlation, replay and wake semantics remain explicit limitations.
2. After measurement, add a thin consultation adapter around the pilot. Candidate responsibilities are stable addressing, identities, acknowledgements and replay. Cost if wrong: formalizing an inefficient workflow before its benefit is established. No implementation is proposed for this run.
3. After cockpit publishes its event contract, make consultation a projection of that existing durable log. Cost if wrong: coupling a small history lookup to control-plane availability or treating it as a second dispatch channel.

Recommendation for the session: preserve option 1 while deciding what success would mean; compare options 2 and 3 only after the owner has supplied the intended interaction. This is a discussion recommendation, not promotion or protocol ratification.

## Open questions, deliberately undecided

1. Addressing: does a question target a lane, a persistent counterpart, or one exact session? Who resolves a replaced counterpart, and what stale-address response is useful?
2. Correlation: one answer per question or explicit multiple-question replies? Are questionId, answerId, inReplyTo and supersedes sufficient, and who assigns them?
3. Durability: immutable append records or replaceable files with a generation identifier? Which component owns cursor checkpoints, replay and deduplication?
4. Acknowledgement: distinguish local enqueue, recipient read, answer append and recipient acceptance? What delivery or wake guarantee is worth providing? A last-seen timestamp cannot prove current availability.
5. Authority: how does needs-owner link to the existing decision record without making a peer recommendation an owner decision? How does the authoritative answer return to the raising session?
6. Cockpit: which consultation facts belong in its event log, and what remains private transient transport? Event names mentioned in earlier pilot notes are draft vocabulary, not claims about bound API operations. Discover the actual contract through NetScript before any adapter work.
7. Measurement: what count of useful answers, corrected claims, avoided repeated experiments, unanswered requests, manual wakes and replay failures should precede promotion? How will a speedup baseline be measured?
8. Retention: which sanitized findings can be public, who may read raw history, and how are expired counterpart references removed without losing decision provenance?

## Boundaries inherited from the charter

[ARCHITECTURE.md sections 4, 5 and 8](../../../ARCHITECTURE.md) retain one dispatcher/executor and one GitHub dispatch path. Cockpit owns the durable event/effect log and fenced decision answers. Consultation must not become another launch API, queue or decision ledger. A real owner decision needs authoritative provenance; an answer from history alone is not one.

## Possible follow-up experiments

For the owner to select, not scheduled work: two simultaneous questions, one delayed reply, replacement/restart with replay, explicit unsupported wake, and a cited answer that prevents a repeated experiment. Record both successful and unanswered samples. Do not measure efficiency solely by answer count or claim exactly-once delivery from file append.
