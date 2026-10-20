# NanoGPT trade setup recovery — 2026-10-19

Assumptions: keep the user's selected NanoGPT model and API key unchanged; recover inference transport only. Never replay a complete assistant turn, accepted upstream stream, or exchange action. Human trade confirmation remains required.

Evidence: hosted relay active; recent access records include a successful stream read followed by502. Existing transport immediately fails proxy HTTP502/503/504 reads, although thrown network errors resume the same job. Server fetch startup exceptions become terminal502 and bypass normal SDK HTTP retry. Simple Reply OK passed; this does not prove long trade planning reliability. Current visible model is minimax/minimax-m2.7.

Implementation: retry a thrown provider startup connection once within the same job, abortably. Keep provider HTTP retries owned by the SDK. Retry transient proxy creation/reads up to3 with the identical requestId/body or job/byte offset. Add terminal failure marker so failed jobs never spin/restart. Preserve bounded Retry-After and request IDs through HTTP boundaries. Distinguish server interruptions from provider unavailable errors. Never forward provider error bodies or credentials.

Verification: red/green regressions for startup recovery, safe diagnostic headers, terminal stream errors and proxy recovery; full backend/frontend tests, TypeScript/lint/build; hosted read-only health/auth checks and harmless live tool-based conversation. No live trade confirmations or account changes.

Atomic step recovery: server-backed requests now buffer one complete inference step until a valid finish reason and SSE completion marker arrive. An interrupted, unexposed draft is discarded and retried once. Completed tool steps are never replayed. Token-limit/content-filter truncation is terminal and releases no tool calls. Legacy streaming jobs retain their no-replay behavior. This increases time to first visible text while preventing partial tool arguments from escaping the relay.

Limitation: provider outages can still exhaust bounded recovery. Completed SSE does not prove the model chose valid arguments or a sound trade; tool validation and human confirmation remain required.
