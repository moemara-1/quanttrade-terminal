# Public venue research

`VenueResearch.execute(raw)` powers `GET /api/public/research`. The caller passes
query parameters as an object. Every action has a strict schema; unknown fields,
URLs, paths, authorization strings and unsupported actions are rejected.

All actions accept `venue`, `action`, and optional `limit` (1–100, default 100).
The result is `{ venue, action, observedAt, data, truncated }`; timestamps are
milliseconds. `truncated` means a nested collection was capped and the result
must not be treated as a complete account or exchange history. There is no
automatic historical pagination. Responses are bounded to 2 MB, 20,000 nodes,
depth 15, and a 10-second upstream timeout. Identical requests share a three-second
cache. Cached results are cloned before returning.

## Hyperliquid

Fixed upstream: `POST https://api.hyperliquid.xyz/info`. Wallet inputs must be an
actual owner/subaccount public address (`0x` plus 40 hexadecimal digits), not an
API-agent address. These reads do not require a private key.

| Action | Additional inputs | Native info type |
| --- | --- | --- |
| `market-stats` | optional native perpetual `coin`, e.g. `BTC` | `metaAndAssetCtxs` |
| `funding-history` | `coin`, `startTime`, `endTime` | `fundingHistory` |
| `predicted-funding` | — | `predictedFundings` |
| `account-state` | `wallet` | `clearinghouseState` |
| `spot-balances` | `wallet` | `spotClearinghouseState` |
| `open-orders` | `wallet` | `frontendOpenOrders` |
| `order-history` | `wallet` | `historicalOrders` |
| `fills` | `wallet` | `userFills` |
| `user-fees` | `wallet` | `userFees` |
| `rate-limits` | `wallet` | `userRateLimit` |
| `order-status` | `wallet`, numeric safe-integer `orderId` | `orderStatus` |

Funding dates must be ordered, cover at most 31 days, and not be in the future.
`market-stats` is specifically perpetual metadata; it does not pretend to return
spot margin settings. Spot prices/books/catalog remain in the existing market
service. `account-state` is the perpetual summary; unified/portfolio-margin users
must also inspect `spot-balances` rather than assume the perp summary is their
entire account value.

Primary documentation:
- [Info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [Perpetual info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals)
- [Spot info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot)

## Lighter

Fixed upstream: `https://mainnet.zklighter.elliot.ai/api/v1`. Each response must
carry exchange `code: 200`, as well as the action-specific collection/fields.

| Action | Additional inputs | Native GET path |
| --- | --- | --- |
| `funding-rates` | optional `marketId` filters the returned list | `funding-rates` |
| `funding-history` | `marketId`, `startTime`, `endTime`, optional `resolution` (`1h`/`1d`) | `fundings` |
| `market-stats` | `marketId` | `orderBookDetails` |
| `exchange-stats` | — | `exchangeStats` |
| `recent-trades` | `marketId` | `recentTrades` |

`marketId` is a native integer 0–32767, preserving separate spot/perpetual IDs.
Funding milliseconds are converted to native seconds; `limit` becomes
`count_back`. These five endpoints were checked against the official OpenAPI
and successful unauthenticated responses on October 7, 2026.

**Excluded public actions:** `accountLimits`, `liquidations`, account orders,
account PnL, and position funding require authorization in the official contract.
They belong in the authenticated connector, not this public proxy. No credentials
are accepted by this service. Likewise, this service exposes no writes, transfers,
withdrawals, arbitrary signed requests, or order submission.

Primary documentation:
- [Official Lighter OpenAPI](https://github.com/elliottech/lighter-python/blob/main/openapi.json)
- [Official SDK](https://github.com/elliottech/lighter-python)

Research results are data for the terminal and AI. They never grant execution
authority or bypass the existing approval requirement for AI-prepared trades.

## Current execution boundaries

The terminal supports the existing manual market/limit, leverage, margin, closing, cancellation, amendment and perpetual trigger operations. AI trade proposals and leverage/margin/cancel/amend proposals require explicit approval, including spot aliases. Research tools cannot submit orders. NanoGPT uses one stored key for chat, research, model discovery, balance and usage.

Native TWAP, trailing stops, grouped OCO/brackets, batch cancellation and scheduled cancellation are not implemented. Some native methods lack the price bounds required by the current execution guard; others need atomic group reservations and reconciliation. Spot conditional orders remain disabled. Transfers, withdrawals, vaults/pools and staking are outside the confirmed scope. No funded-account trades were used for verification.
