# Independent plan evaluation routing

Evaluation completed with FAIL_FIX (F1–F4); see plan-eval.md. Reviewed input commit: 324a3de.

The fresh architecture plan-evaluation CLI query, retained in
`matrix-plan-eval-fallback.json`, selects Muse Spark 1.3/max then Grok 4.6/xhigh.
NetScript source: 8eaa8c54d875962bf1dfeb54b139c98d4f3a2626.
The original plan author is Anthropic and coordinator questions are OpenAI;
the selected fallback evaluator family is xAI, independent of both.

Launch observations, in order:

- Initial launcher omitted required privileged-tier authorization; it failed before dispatch.
  Corrected with explicit milestone-coordinator authority for E11 schema architecture review.
- Primary native OpenCode Go preflight returned `provider_rate_limited`, with no session.
- Declared fallback Copilot preflight returned `usage_unproven`, with no session.
- The same fallback was dispatched through OpenRouter after an authenticated live allowance
  check and native expense guard. The submitted estimate was one dollar; it is an estimate, not measured cost or
  permission to bypass the guard.
- Native session export confirms provider `openrouter`, model `x-ai/grok-4.6`, variant `xhigh`.
  Session: `ses_f7d424645ffeq9bROwhiZS6RMy`. Preserve it for any permitted repair.

The primary's separate OpenRouter/max rejection remains unresolved. This architecture
fallback does not establish a remedy for the complex row, which selects Muse/max twice.
No effort conversion, quota reset, same-subscription sibling substitution or review waiver occurred.

Loop policy: maxRounds 1; escalateToOwnerAt 2; reSteerSameSession true.
The evaluation is plan-only and cannot certify implementation or downstream compatibility.
Raw provider output and allowance values remain private operational evidence.

[observed — matrix-plan-eval-fallback.json, fresh architecture routing and loop policy;
executed 2026-09-08]
[observed — native launcher preflights and session export, actual transport/effort and
active evaluator; verified 2026-09-08]
