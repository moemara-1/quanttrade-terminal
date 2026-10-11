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
