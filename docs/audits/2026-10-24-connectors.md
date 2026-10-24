# Connector and assistant completion audit

Observed 24 October 2026. Public hosted probes were captured at 10:12 UTC.
No order submission, cancellation, bot launch or credential change was performed.

## Verified runtime reads

| Area | Result | Scope and limits |
| --- | --- | --- |
| QuantTrade bridge | HTTP 200 | Health endpoint; does not prove every provider works. |
| Hyperliquid | Catalog 342, 24 hourly candles, 20 levels per book side; public stats returned | Perpetual public reads, including catalog coverage reported complete. Latest BTC candle 10:00 UTC. No authenticated execution test. |
| Lighter | Catalog 198, 24 hourly candles, 20 levels per book side; funding returned | Perpetual public reads. Latest BTC candle 10:00 UTC. No authenticated execution test. |
| Discovery scanners | 540 markets, 93 comparisons; both sources report OK and complete | Snapshot coverage, not guaranteed executable arbitrage. BTC detail returned both venues. |
| Options scanner | BTC and ETH each sampled 1,000 recent trades | Both report more history exists. Not comprehensive options coverage or inferred trader intent. |
| Crypto and equity news | HTTP 200, matching stories returned | Cointelegraph and MarketWatch available. CoinDesk and two CNBC feeds returned HTTP 403 from the server. Recent RSS headlines only; no archive/body search. |
| DASH news | Matching supported; zero retained headlines | Not evidence of no news/catalyst. Official-source follow-up remains necessary when material. |
| Earnings | 851 entries returned | Hosted calendar read worked; assistant standalone guard incorrectly refused it. |
| Macro | 10 entries returned | US BLS/BEA schedules, not a global calendar or consensus/actual economic dataset. |
| IPOs | HTTP 200, zero entries in requested seven-day window | Empty is allowed; not a provider outage verdict. |
| Asset fundamentals | Hosted exact Zcash identity and timestamp verifier passed | CoinGecko crypto profile; not company valuation/insider coverage. |

Separate workstation public-endpoint probes returned data from Binance spot/futures,
Bybit futures (provider code 0), CoinGecko breadth, Alternative.me sentiment and
Polymarket event catalog. Global OKX and DexScreener URLs returned HTTP 403 to this
client. These probes do not establish browser CORS, regional connector routing,
WebSocket continuity, account permissions or private execution health.

## Configuration and platform boundaries

- Alpaca requires provisioned credentials for prices as well as trading. A sealed
  browser vault is different from an account with no saved key; refresh clears the
  in-memory unlock session. No Alpaca key or vault state was changed in this audit.
- CEX public charts use browser/desktop connector paths rather than the bridge's
  Hyperliquid/Lighter market routes. Public reachability is not a full connector test.
- DEX read integrations include GeckoTerminal and DexScreener. Browser restrictions
  and individual upstream refusals must remain explicit, not reported as empty data.
- Polymarket browser reads are implemented. Kalshi is desktop restricted in this
  build; it should not be advertised as a verified hosted browser connection.
- Company valuation/insider services still require their optional App Server
  integration. Removing their configuration guard would produce false availability.

## Reproduced application defects and fixes

1. The assistant bounded rounds and repeated reads, but not a large set of distinct
   calls. A never-settling read could prevent the next step and final answer.
   Added a 48-execution admission cap, research finalization after 120 seconds at
   the next step boundary, and 30-second read-only deadlines. A text-only synthesis
   step is reserved; a bounded fallback identifies returned versus unavailable calls
   if the model fails to synthesize. This is not a hard 120-second end-to-end SLA:
   provider generation time can still extend a response. Mutations and approvals
   are never raced against a timeout or automatically retried.
2. Assistant economic/earnings/IPO tools incorrectly refused hosted standalone
   calendar reads that the application's API already supports. Removed those three
   stale guards; genuinely unavailable company/insider services remain guarded.
3. Aborted public-data requests leaked concurrency slots because release listened
   only to `finish`. Sixteen aborted requests reproduced persistent HTTP 429s.
   Idempotent release now handles both `finish` and `close`; the 16 concurrent and
   240 requests/minute limits remain unchanged.

## Remaining external limitations

Publisher HTTP 403 responses cannot be repaired by changing an assistant prompt.
Available feeds still serve partial news, with source-level coverage exposed.
This audit does not certify every installed plugin, every symbol, every account,
every trading order type or continuous WebSocket reliability. Follow-up checks
should target the specific unavailable provider/platform without repeating broad
tool sweeps or retrying uncertain trades.

## Release verification

Released as `20261024-1`. All 421 backend tests and 93 focused frontend tests
passed, along with frontend/backend TypeScript, focused lint and the 11-task
production build. Real SDK fixtures reproduce distinct-call fanout, hung reads,
web-search deadlines and blocked client-forwarded actions. Hosted session/origin
checks, resumable transport authorization, news coverage and bundle-content
verification passed. The inference worker was not restarted. No live provider
conversation or financial action was submitted during this verification.
