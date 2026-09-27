# issue-agent-ancestry--alpha — synthesis

Summary: reuse the existing dispatch and native tree boundaries. The only source-derived observed reason available today is the fixed Orchid receipt sentence.

Orchid's receipt is private and carries requested route fields plus five observed reason rows (`cmd/divybot/matrix.go:357-388`). The public route already separates requested from observed values (`packages/contracts/src/agent-observations.ts:168-189`). Carrying the receipt's reason rows as a separate additive field preserves that distinction. A missing or invalid receipt must yield an explicit unavailable reason, without copying arbitrary receipt text or claiming a route measurement.

The Codex goal writer and native identity join are implemented but have no new live proof. The source route has no budget field, so `tokenBudget: null` is the only truthful value when the issue has no explicit max-token override (`cmd/divybot/native_goal.go:55-74`; `cmd/divybot/matrix.go:75-86`).
