# Mixed research and final-assessment transport repair

The pasted conversation exposed three independently reproduced integration defects.

1. Final-text recovery used AI SDK generateText. The server-backed NanoGPT adapter
   accepts only stream:true requests, so recovery was rejected locally before any
   provider job was started. A test with the actual NanoGPT plugin and SDK now
   reproduces that rejection and passes with streamText(...).text. No tools are
   declared, retries remain zero, and the existing 30-second/output limits remain.
2. DeepSeek thinking history repair ran only while tools were declared. Final
   prose still contains previous assistant tool calls, even when new tools are
   disabled. Compatibility repair now also applies when history contains tool
   calls; supplied reasoning stays intact. Unrelated models and text-only history
   without tools keep their existing behavior. The connector-level fixture rejects
   missing reasoning fields and now returns the assessment successfully.
3. Recovery eligibility excluded navigation/highlighting, and context compaction
   could discard the short prior question behind a retry after one bulky tool
   batch. Completed presentation tools now allow final prose recovery; financial
   actions, parked approvals, cancellation and errors retain their protections.
   Up to three short recent user messages are prioritized within the same history
   limit. Oversized optional groups are skipped rather than ending history selection.

No live trade, cancellation, credential change or paid provider request was used
for verification. Tests use the actual SDK/connector with synthetic HTTP responses.
This repairs demonstrated request/context defects; it is not a claim that an
external model can never return an empty answer or that every request succeeds.