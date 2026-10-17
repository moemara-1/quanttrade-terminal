# QuantTrade integrated scanners

Audience: the owner trades manually and prepares AI trades on Lighter and Hyperliquid. The interface should feel precise, dense and calm, matching QuantTrade's existing dark green terminal. Reference screenshots establish stacked compact discovery cards, venue emblems, concise rankings and full-report expansion.

Build one integrated scanner surface, available through terminal navigation and as a workspace pane. Compact cards expand to searchable, filterable full results without creating a second terminal or changing saved trading layouts. Reuse current typography, tokens, icons and market navigation. All data is public and read-only; no scanner automatically prepares or executes orders.

Four cards:
- Arbitrage: normalized hourly funding difference and explicitly indicative mark-price gaps, exact same-base matches across the two venues. Long the lower funding rate, short the higher; positive funding means longs pay shorts. No executable-return or fee-adjusted-profit claim.
- Funding and crowding: absolute hourly funding extremes and open-interest/24h-volume ratio, explicitly a proxy rather than true order-book imbalance or options skew.
- Strength: 24h gainers/losers and percentage-point performance relative to BTC on the same venue. No invented 7d data or confidence score; only genuine candles may appear as sparklines.
- Options desk: genuine BTC/ETH Deribit block-trade legs identified by block_trade_id, and separate currency put/call volume/open-interest summaries. Do not infer multi-leg strategy or trader intent. Premium USD is an estimate for inverse BTC/ETH options, not underlying notional. Show sampled-tape coverage.

Backend uses fixed public API destinations, bounded response bodies, deadlines and shared cached/coalesced snapshots. Each source reports status and observation time. Unavailable is not empty, stale is visibly stale, and one outage does not erase healthy venues. Same-symbol ambiguity excludes the comparison. Existing adapter normalizes Lighter 8h-equivalent funding; Hyperliquid is hourly. Perp chart URLs intentionally use the connector's BTC-USDC-USDC native identifier, converted exactly once from bridge BTC-USDC.

Verification: formula/sign tests, exact-symbol joins, zero/missing values, partial failures/caching, options units/real block identification/sample limits, frontend parsing/filtering, correct venue links, keyboard/mobile scrolling, hosted read-only checks and visual QA. Commit/push after checks; deploy under existing authorization without trading mutations.
