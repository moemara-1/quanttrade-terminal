# Advanced entry protection follow-up

Release 20261011-4 is deployed. Native Hyperliquid TWAP and managed Chase have account-pinned status reads and separately confirmed cancellation. They remain entry-only. Existing managed Scale/Iceberg/TWAP plans can include reviewed fill-gated protection in one card.

## Required implementation

Add an optional immutable protection specification to the advanced proposal, displayed and confirmed alongside the entry. Define exact stop-loss and take-profit allocations, full quote budget, price bounds, activation policy and the fact that protection is managed rather than exchange-attached. Do not submit previously approved plans under a new interpretation.

Persist a protection run before the entry mutation. The run must retain account, credential revision, request ID, owned entry identity and every owned protective identity. Restart during an uncertain mutation must pause without resubmitting. Protection preparation must never submit an order.

Reconcile stable native TWAP slice-fill identities or authoritative settled Chase attempt fills. Missing/truncated history cannot stand in for exact cumulative evidence. Protect only the verified newly filled quantity; no inferred existing-position coverage. Reconcile every owned exit before resizing coverage. Do not infer zero fills from missing evidence.

If an exit fills while entry slices remain, cancel only the owned remaining entries and prove cancellation before allowing another entry. Partial cancellation cannot be treated as settlement. A failed protection submission must remain visibly unprotected or partially protected, never completed.

For Lighter, use verified fixed-size OCO groups per allocation. For Hyperliquid, existing-position paired exits cannot be assumed to have normalTpsl parent semantics. Implement and label managed cancellation of the sibling only after authoritative exit-fill evidence, or verify a suitable native contract first. Do not broaden to unrelated position-wide exits.

Required regressions: first/partial/full fills, duplicate and conflicting fills, missing/truncated history, exit before later entry, partially filled canceled parent, credential/halt races, restart during every mutation, protective failure, delayed cancellation proof, precision partitions, risk budget and duplicate human confirmation.

## Verified contract boundary

Hyperliquid's official TP/SL documentation says ordinary cancellation of a partially filled parent also cancels its attached children. Entry children activate after full fill, with a special insufficient-margin cancellation case. A Chase replacement therefore cannot assume those children continue protecting earlier partial fills.

Primary source: https://hyperliquid.gitbook.io/hyperliquid-docs/trading/take-profit-and-stop-loss-orders-tp-sl

Atomic remains separately blocked on a verified all-or-none native signing contract. The NanoGPT browser error still needs a reproduced QT-AI diagnostic. Neither is claimed fixed by release 20261011-4.
