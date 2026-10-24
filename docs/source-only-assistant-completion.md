# Research completed without final prose

The reported ZORA turn showed 21 tool calls over six rounds and sources, with no
assessment. That is below the 48-call research boundary. The transcript alone does
not identify the provider's finish reason, but the code had a reproducible gap:
normal completion after read tools/sources bypassed the final-answer fallback
because it ran only when QuantTrade explicitly entered its boundary state.

The UI stream now checks terminal completion after a read-only research turn, including research-limit finalization.
If the last step has no prose, it requests one text-only synthesis from the same
model using the bounded original conversation and collected response history.
No tools are declared, the token cap is 4,096, the deadline is 30 seconds, and
automatic retries are disabled. This is one additional provider request only
for the missing-answer case; it does not replay reads, proposals or orders.

Recovery does not run after mutation/approval tools, explicit provider errors,
cancellation or an existing final written answer. User cancellation also prevents
late recovery text. If synthesis fails or returns no prose, the UI explicitly
reports the missing assessment and returned/unavailable read names. Sources alone
are not presented as a verified investment conclusion.

Tests reproduce a below-budget source-only turn, exercise real AI SDK stream
completion and response-history availability, verify one recovery attempt, and
preserve normal answers, approval handling, errors and cancellation. Existing
research budgets and duplicate-action protection remain unchanged.
