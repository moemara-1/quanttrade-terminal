# Assistant follow-up rejection repair â€” 2026-10-21

Evidence: live inference logs show MiniMax M2.7 succeeding with 131 messages, then rejecting subsequent 133/134-message requests with HTTP 400. The original provider body was discarded. After deploying safe diagnostics, a no-tool “reply OK” in the same retained conversation (135 messages) reproduced HTTP 400 with the fixed category context-length. This confirms the current failure is oversized model context, not a timeout or exchange credential issue.

An independent SDK regression reproduces an interrupted or abandoned tool call poisoning later conversation history. The model-history boundary now represents calls without execution results as unknown-status text, preserving original UI cards, approval responses, resolved outputs and errors. It does not replay tools, manufacture success or interpret ordinary chat as trade approval.

Provider errors are now classified transiently into fixed categories, bounded to 16 KiB and one second. Raw errors may echo credentials/chat, so neither logs nor responses retain them. Rejections preserve their HTTP status and are reported as failed jobs. Client messages distinguish context, history and parameter rejection from an unavailable provider.

Assistant instructions now require exact current exchange evidence for protection, describe stop-limit nonexecution and cancel/replace gaps, separate historical runs, identify the existing Activity Pause/Stop controls, prohibit unscheduled monitoring promises, and require weighted risk/reward calculations. Prompt tests verify those contracts; they cannot guarantee model compliance.

Verification uses offline regression tests and read-only/no-tool hosted conversation checks. No trade submission, cancellation, run resumption or credential changes are part of this repair.

Bounded model history is applied before the initial request and every agent step. Whole tool exchanges remain paired; oversized tool outputs become explicit unavailable/omitted markers and require focused fresh reads. The latest user and system instructions are retained; mandatory inputs that cannot fit fail clearly. Persisted chat and approval cards remain unchanged.

Hosted verification: 20261021-9 retains the original UI conversation but sends 16 bounded model messages. The same affected chat returned exact OK, HTTP200 in4,234ms with no tool calls, compared with its previous135-message HTTP400 context-length failure.411 backend and 4,143 frontend tests pass, alongside strict types, focused lint and 11-task production build.

A live ask_user card in the same chat completed successfully. Typing One returned exact OK with HTTP200 in2,891ms; question generation took2,418ms. No account/research/trading tools ran.
