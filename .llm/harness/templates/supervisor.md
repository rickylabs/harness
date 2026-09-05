# Supervisor Identity — <run-id>

Written at run start per `workflow/lane-policy.md` § Supervisor identity. A run dir without this
file is not activated. Other supervisors cross-peek a run by reading this file — it is how a run's
operating identity is discoverable without chat memory.

| Field | Value |
| --- | --- |
| Model | <model name + id> |
| Session | <session id and/or session URL> |
| Host | <machine / OS / user> |
| Checkout | <main checkout path> |
| Worktree | <run worktree path> |
| Branch | <branch> |
| Baseline | <SHA + branch the run is based on, with date> |
| Run ID | `<run-id>` |

## Routes in force

| Task lane | Provider / model / effort | Role in this run |
| --- | --- | --- |
| <canonical lane id> | <explicit requested identity> | <role> |

Reference `.llm/harness/workflow/lane-policy.md`; do not copy its complete route table here.

## Recorded lane/eval overrides

<Overrides of `lane-policy.md` defaults, each with its authorization (owner directive, blocked
launch path, …). Delete this section if the run uses the defaults unchanged. Mirror any entry
here as a `drift.md` note.>
