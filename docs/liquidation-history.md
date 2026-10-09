# Recorded liquidation history

CoinTrade's bridge collects public Binance USD-M and Bybit linear USDT perpetual liquidation streams. SQLite history persists in `data/liquidations.sqlite`, in the shared deployment directory. The public `/api/liquidations` route supplies the native panel and research tools without login challenges.

Collection begins when the service connects. There is no historical backfill: selecting 72 hours does not imply 72 hours have already been recorded. The panel reports the actual coverage start, interruptions and bounded-response truncation. Retention is 72 hours, subject to a 500,000-print safety limit per venue. Unsupported contracts receive an explicit `not_tracked` response.

Binance reports sampled events, at most one liquidation per symbol per second. Values use executed quantity and average fill price. Bybit sends all reported events; its price is the bankruptcy price, so its dollar values are estimates using that price. Neither feed establishes venue-wide zero liquidations when no prints were recorded.

Connections reconnect with bounded backoff, subscription acknowledgement checks and heartbeat monitoring. Failed connections cancel their timers. Public endpoints are rate limited; trading execution and account routes retain their existing authorization.

Deployment verification runs `deployment/verify-liquidations.py` against both live streams and each supported time window. It performs no trading requests.
