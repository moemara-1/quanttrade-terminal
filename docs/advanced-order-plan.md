# Advanced order integration plan

User requirement: finish audit repairs first; then prepare Conditional, TWAP, Scale, Atomic, Chase Limit and Iceberg from the assistant on Lighter and Hyperliquid. One fresh human confirmation authorizes the exact complete plan; child orders do not require additional cards. Users need no manual workflow editor.

## Evidence and capability boundary

Official Lighter docs: https://docs.lighter.xyz/trading/order-types-and-matching
Official Hyperliquid wire API: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint
Official Lighter signer source: https://github.com/elliottech/lighter-python/blob/main/lighter/signer_client.py

Lighter SDK exposes native market, limit, SL market/limit, TP market/limit, standard TWAP and OTO/OCO/OTOCO. The latest official signer still exposes these seven order codes and three grouping modes. Documentation describes Chase and Atomic, but an authenticated signing contract for these has not been established. Atomic requires all components together without partial execution; sequential HTTP requests or ordinary batches must never be labeled atomic.

Hyperliquid exposes order batches, normalTpsl/positionTpsl grouping and twapOrder/twapCancel. A TWAP has exact asset, side, size, reduceOnly, minutes and randomize fields, and returns a twapId. Native conditional brackets already have an integration. A batch does not establish an all-or-none fill guarantee.

## Required implementation

1. Public capabilities readable by the assistant, reporting native vs managed vs unavailable with reasons.
2. Native Hyperliquid TWAP with exact live account/revision, expiry, durable request identity and returned twapId. Reconcile/cancel only that owned ID.
3. Assistant compiler for exact Scale price/quantity ladders and fill-gated Iceberg children using the durable existing plan runner. One card includes every child, account, leverage, margin, cap and exit relationship. Precision is floored when allocating a user-approved total, never rounding above it. No inferred existing position.
4. Chase runner: bounded price band, deadline, interval, exact total size, cumulative actual fills and one owned order. Reconcile fills before amending/cancelling. No replacement until cancellation is proved; pause on uncertainty. Never chase an unrelated order.
5. Native Atomic only after a verified official signing/API contract; otherwise clearly unavailable. Do not silently substitute a partially executing basket.
6. Multi-TP protection uses native paired brackets where supported; one group per exact allocation with corresponding SL coverage. Do not pretend an independent full SL plus multiple TPs is OCO. Include entry dependencies and prove fills before managed protection.
7. Never fall back from an uncertain limit to a market entry. Read-only reconciliation first; replay requires a new user decision after an authoritative outcome.

## Acceptance checks

Mock signing/wire tests, precision and full coverage partition tests, pending/partial fills, missing evidence, child failure, duplicate approval, service restart, changing account/mode/revision and kill-switch races. Production checks remain read-only. No test trades or replay of old paused plans.

## Implementation status, 11 October

The assistant compiler now prepares Scale, managed Iceberg and managed TWAP as one complete confirmation card on Lighter and Hyperliquid. Exact approved quantity is partitioned in exchange ticks; an Iceberg display slice waits for every allocation of the preceding slice to fill. Optional multi-TP allocations each have their own matching SL/TP group. Protection applies to the new entries only. Protective fills do not cancel other entry slices. Managed TWAP uses timed QuantTrade submissions, not a native Hyperliquid TWAP ID.

Reviewed plans pin the account and credential revision from preparation through submission and later execution. Native Lighter submissions renew an expired hosted session once using the identical proposal ID; uncertain submission outcomes are not retried. Conditional/native Lighter types remain available through the existing native tool.

Native Hyperliquid TWAP and bounded Chase are implemented in the completion section below. Atomic requires a verified all-or-none signing contract and remains unavailable. An uncertain order must never be replaced or a regular batch described as atomic.

## Native TWAP and managed Chase completion

The native Hyperliquid TWAP path now sends the official twapOrder action and returns the actual twapId. Cancellation is a separately reviewed twapCancel action. The venue requires at least 100 USDC reference notional and supports five minutes through seven days. Its slice slippage is fixed at 3%; preparation and execution reject it when the configured risk band is narrower. Admission reserves size × fresh reference price × 1.03 against the reviewed reference budget and daily limits. This is not an absolute future expenditure cap; that API does not provide one. No SL/TP is implicitly attached. Observed slice fills are read using userTwapSliceFills, with exact identity, quantity and duplicate checks; missing or truncated history never proves completion.

Managed Chase runs persist on the server. Production selects fresh best bid for a buy or best ask for a sell inside the approved band. Every attempt owns an exact order identity. After the interval or expiry it cancels only that order, then waits for authoritative cumulative fill evidence before replacing only the remaining approved quantity. Cancellation acknowledgment alone is insufficient. A mutation interrupted by restart remains paused, and uncertain submissions or cancellations are not retried. Kill blocks placements; an explicit reviewed cancellation can still remove a known owned order. Gross submission limits include canceled/replaced attempts, and daily risk checks remain enforced. Protection must be separately requested; it is not silently attached.

Atomic remains unavailable because the current public contracts do not establish all-or-none basket execution: Lighter official signer main 04bee9ba9811b87ef1cccc568e7f590b5fe649bb exposes seven order types and OTO/OCO/OTOCO only; prover 579f3d15ce54096d2ed0305747312a42d2e68d84 restricts grouped orders to those modes and one market. Hyperliquid ordinary batches return independent leg outcomes. The assistant capability tool reports this explicitly and never substitutes a sequential batch labeled Atomic. A verified native signed basket contract from the venue is required to enable it.
