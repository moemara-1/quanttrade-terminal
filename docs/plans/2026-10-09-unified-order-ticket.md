# Unified order ticket and AI preparation

The user trades manually on a compact exchange terminal and asks AI to prepare exact orders for approval. The ticket should make the selected pair, venue and account obvious, with one draft for leverage and margin rather than two competing forms.

Keep Buy/Sell, order type, size and price together. Show post-only only for limit orders. Keep one contract-capped leverage selector and an explicit margin-mode draft. Venue state changes ride on the order only when deliberately selected; closing a position never rewrites leverage or margin mode. Reset drafts when the contract, venue or account changes.

Move existing-position protection and native order management below the primary order action. Stop-loss and take-profit remain separately submitted reduce-only orders, with no claim of atomic brackets or OCO. Isolated margin adjustment requires a deliberate isolated selection and a positive amount; backend validation remains authoritative.

Provide Prepare with AI beside the ticket. It opens an editable Assistant prompt containing the exact venue, pair and deliberate draft terms, without making a provider request. The connected inference plugin supplies the model. The model's tools prepare confirmation cards; every AI order requires fresh approval on every venue, including when legacy standing consent was saved. Manual trading keeps its normal direct flow.

Hummingbot executes approved Hyperliquid/Lighter orders. Other exchanges retain their native plugin adapters. The server-side agent API and inbox are separate from browser inference settings. Refuse ambiguous live account selection instead of silently picking the first account.

Verify scope resets, contract caps, explicit leverage/margin propagation, preparation without execution, legacy consent, replay/expiry guards and account ambiguity. Run native TypeScript, changed-file lint, production build and deployed authorization/data checks. No real orders or paid inference calls are part of validation.
