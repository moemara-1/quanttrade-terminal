# Assistant execution repair — 2026-10-14

One chat confirmation remains the execution boundary. Model output cannot authorize a trade, and an uncertain exchange submission is never automatically replayed.

## Reproduced and repaired

- NanoGPT DeepSeek thinking requests with tools omitted `reasoning_content` on historical assistant messages without reasoning. The provider adapter now preserves supplied reasoning and adds an empty field only when absent. Other models and requests without tools retain their existing request shape. Regression uses `deepseek/deepseek-v4-flash-0731:thinking`. [DeepSeek protocol requirement](https://api-docs.deepseek.com/guides/thinking_mode/).
- Exact native Lighter receipts unnecessarily depended on Hummingbot's generic order history. A history failure prevented the authoritative venue fill read. Native/client receipt IDs now go directly to the scoped native reader. Integration verifies an immediate entry, delayed second slice, whole-run protective size, and repeated ticks without duplicates.
- An accepted Hyperliquid TWAP could be relabelled unknown if local protection binding failed after the durable receipt. The receipt remains accepted, a visible warning distinguishes pending protection, and the monitor can recover the owned binding without resubmitting the entry.
- Hyperliquid native TWAP with reviewed opening leverage now checks fresh collateral before submission and revalidates account/revision after the read. Hummingbot's `USD` balance label represents the venue's USDC collateral; duplicate/unknown collateral rows fail closed.
- Capability reads now fail closed on malformed status, describe the actual native and managed routes, and preserve the exact TWAP identity separately from protection warnings.

## Verified routes and limitations

Lighter exposes native perpetual market/limit, conditional TP/SL, TWAP, OTO, OCO and OTOCO. Native TWAP is single-only in the current integration. Scale, Iceberg, timed plans and Chase are QuantTrade-managed with one confirmation, not exchange-hidden or atomic orders. Protected timed plans can use the managed route with explicit disclosure; a user explicitly requiring native execution is not silently switched.

Hyperliquid native TWAP is exposed with explicit acceptance of its fixed 3% slice slippage. Its managed bundled protection activates after exact full fills; partial native TWAP fills remain unprotected. Workflow protection follows the reviewed graph: exits connected after the final DCA entry do not protect earlier entries. Whole-run coverage must be requested explicitly and supported by validated graph ancestors. Cancelled partial entries pause rather than fabricate fill completion.

Lighter advertises Atomic in its [order documentation](https://docs.lighter.xyz/trading/order-types-and-matching.md), but the reviewed [public signer](https://raw.githubusercontent.com/elliottech/lighter-python/main/lighter/signer_client.py) exposes OTO/OCO/OTOCO grouping without a documented signed all-or-none basket contract. Hyperliquid's [exchange API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint) has individual batch outcomes, not an all-or-none guarantee. Atomic execution remains unavailable until a verifiable venue API contract exists.

Offline tests cover provider protocol and execution integration. No live NanoGPT key was available and no live trades were submitted. These checks do not establish successful live provider access or fill every advanced order type on a funded account. Historical paused or uncertain plans are not resumed by deployment.
