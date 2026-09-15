# Validation — private Orchid root binding

The reader implementation needs no cockpit contract change. Validation receipts are
under `receipts/` beside this file. All source reads and builds used a fresh owned clone
of Harness main, never the shared checkout or its dist.

## Scope of the evidence

- MEASURED: The real parent/child pair was rediscovered after 13 native headers in a
  bounded sample of at most 512. The positive integration control uses those parsed
  native records with an explicitly synthetic issue assignment in a temporary private
  store. It traverses the production receipt reader, existing tree builder, and exported
  decoder: two rows, depth one. It proves integration on that pair, not live assignment.
- MEASURED: Removing or mismatching the control binding leaves one decodable
  dispatch-only row, `complete:false`, reason `ancestry_unavailable`.
- MEASURED: The complete accessible live receipt scan still contains one dispatch,
  for issue 368, with its private native identity absent. Its unknown dispatch-only row
  remains readable. Live issue ancestry is **INCONCLUSIVE**, not an alpha acceptance.
  A subsequent authorized dispatch must supply a real root binding, and the native
  read must be complete before a runtime tree can be accepted.
- CURRENT: A parent link does not supply child location, router, budget, or execution
  observations. Existing unknown fields and three individually unavailable cost rows
  remain honest; this change does not invent a running verdict or collect new measures.
- CURRENT: Private native binding hashes live in a WeakMap, never serialized onto the
  dispatch evidence. Existing public agent/assignment derivations and schema/protocol
  are unchanged. The legacy native-run projection is not redesigned by this slice.

## Guard evidence

The mutation runner requires a successful compilation and an assertion failure for
each broken guard, then restores the source and requires the control to pass again.
Compilation failures observed while developing mutations were **INCONCLUSIVE**; the
final receipts contain only runnable mutations and restored passing controls.
A trim mutation initially survived because ASCII whitespace also hit the character
validator. Independent Unicode-whitespace negatives now exercise that condition,
including the writer's Unicode whitespace class.

The original decoder's complete-runtime-tree fence is explicitly mutation-verified.
Absent or mismatched bindings do not license a displayed prefix of a runtime tree.

No production receipt, process, configuration, or dispatch label was changed. No native
identity, source receipt content, operator location, model/spend pair, or credential
is present in the tracked receipts. The opt-in real-pair control deletes its isolated
0700/0600 temporary store in `finally`.
