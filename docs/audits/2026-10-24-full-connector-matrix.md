# Full connector inventory audit

Observed 24 October 2026. This extends the earlier bridge-only audit. Inventory
comes from `apps/terminal/src/lib/plugins/bootstrap-bundle.ts`, not just installed
folder names. Core panels, themes and workspace presets are not external connectors.

## Verification levels

- **Contract passed:** connector tests use stubbed network responses, including
  error handling, parsing, routing, subscriptions and credential boundaries.
- **Public live passed:** a bounded unauthenticated REST read returned data now.
  This does not prove browser CORS, continuous WebSocket health or private trading.
- **Credential/platform gated:** not live-tested with a user's key or wallet.
  This is not a passing live test, nor evidence the provider is broken.

The complete plugin suite passed **2,103 tests**, with **43 skipped**, across 133
files. Skipped live/account tests remain unverified. Another **45 terminal tests**
passed for custom QuantTrade connections, funding, sessions and standalone tools.
Full plugin TypeScript checking passed after the typing repairs described below.

## Market connectors

| Connector | Contract tests | Public live read | Remaining scope |
| --- | --- | --- | --- |
| Binance spot | Passed | Price returned | Browser streaming and private account execution not certified |
| Bybit spot | Passed | Provider code 0 | Same |
| OKX spot | Passed | Provider code 0 | Global public host only; authenticated legal-entity routing must match account |
| Bitvavo | Passed | Price returned | Account execution not tested |
| MEXC | Passed | Price returned | Same |
| KuCoin spot | Passed | Provider code 200000 | Same |
| Gate | Passed | Ticker returned | Same |
| Coinbase | Passed | Ticker returned | Same |
| Bitget | Passed | Provider code 00000 | Same |
| Kraken spot | Passed | Ticker and empty provider error list | Same |
| HTX | Passed | Provider status ok | Same |
| Crypto.com | Passed | Provider code 0 | Same |
| Bitfinex | Passed | Ticker returned | Same |
| Upbit | Passed | Ticker returned | Same |
| Binance futures | Passed | Price returned | Authenticated leverage/orders not live-tested |
| Bybit futures | Passed | Provider code 0 | Same |
| OKX futures | Passed | Provider code 0 | Global public read; region/account routing still matters |
| KuCoin futures | Passed | Provider code 200000 | Account execution not tested |
| Kraken futures | Passed | Tickers returned | Same |
| Hyperliquid perpetual | Passed, including terminal adapter tests | Hosted catalog 342, candles 24, books 20 levels/side, public stats | Wallet/order execution not tested |
| Lighter perpetual | Passed, including terminal adapter tests | Hosted catalog 198, candles 24, books 20 levels/side, funding | Same |
| Hyperliquid spot | Terminal adapter contracts passed | Catalog 322; HYPE-USDC candles 24 and books 20 levels/side | Wrapped-token symbols differ; ETH-USDC is not a listed instrument |
| Lighter spot | Terminal adapter contracts passed | Catalog 11; ETH-USDC candles 24 and books 20 levels/side | Account execution not tested |
| Alpaca | Passed | Not live-tested | Prices and trading require provisioned keys; sealed vault is distinct from missing keys |
| Polymarket | Passed | Public event catalog returned | Browser CORS, wallet and order execution not live-tested |
| Kalshi | Passed | Public REST catalog returned | Hosted connector declares desktop required; REST reachability does not remove that restriction |

OKX and DexScreener public reads returned 403 during the earlier audit but returned
200 in this run. Availability can change; neither observation proves continuous
health. No region or access controls were bypassed.

## On-chain, NFT and data providers

| Connector/provider | Verification | Limits |
| --- | --- | --- |
| GeckoTerminal | Contract passed; public network catalog returned | Pool-specific history/CORS still depend on requested network/pool |
| DexPaprika | Contract passed; public network catalog returned | Browser CORS restrictions remain distinct from server REST availability |
| DexScreener | Contract passed; public SOL search returned | Current read succeeded; not guaranteed continuously available |
| Memecoin feed | Contract passed; Jupiter token discovery and CoinGecko breadth returned | Launchpad gems, every token and every lifecycle stage were not independently live-verified |
| Helius/Solana RPC | Contract passed | Optional keyed Helius endpoint and keyless RPC fallback; neither user's RPC nor signing was tested |
| Jupiter DEX | Contract passed; token discovery returned | Discovery is not a swap test; wallet, quote and transaction execution unverified |
| Ethereum DEX | Contract passed | RPC/wallet/quote/signing unverified |
| Base DEX | Contract passed | Same |
| Arbitrum DEX | Contract passed | Same |
| BNB Smart Chain DEX | Contract passed | Same |
| Polygon DEX | Contract passed | Same |
| LI.FI bridge | Contract passed; public chains returned | No wallet quote, allowance, transaction or cross-chain transfer submitted |
| CoinGecko NFT | Contract passed; NFT catalog returned | Catalog response is not full collection/item coverage |
| OpenSea NFT | Contract passed | Keyed reads, offers/listings and wallet execution not live-tested |
| Coinglass liquidations | Contract passed | API key and desktop required; not certified on hosted browser |

## Inference and search providers

The complete plugin suite includes NanoGPT, Groq, OpenAI, DeepSeek, Anthropic,
OpenRouter, Pairlens Intelligence, Tavily and Exa contracts. These tests cover
configuration, request construction, parsing and failures using synthetic inputs.
No paid generation, provider key retrieval or paid search was performed.

| Provider | Result |
| --- | --- |
| NanoGPT | Contract tests passed, including SSE and recovery; current selected model's live uptime is not certified |
| Groq | Contract tests passed; configured key/model live call not tested |
| OpenAI | Contract tests passed; configured key/model live call not tested |
| DeepSeek | Contract tests passed; configured key/model live call not tested |
| Anthropic | Contract tests passed; configured key/model live call not tested |
| OpenRouter | Contract tests passed; configured key/model live call not tested |
| Pairlens Intelligence | Core integration contracts passed; cloud access/configuration not live-tested |
| Tavily | Contract tests passed; needs configured API key, live search not tested |
| Exa | Contract tests passed; needs configured API key, live search not tested |

## Hosted feeds and scanners

All 17 bounded hosted probes returned HTTP 200. Earnings returned 851 entries;
macro returned 10; IPOs returned no entries in the requested seven-day window.
Scanners returned 540 markets and 93 comparisons with both venue sources marked
complete. BTC detail returned both venues. Empty IPO windows are not failures.

The earlier standalone assistant calendar guard fix remains present and its
terminal regression tests pass. Company valuation and insider data remain optional
App Server services; they must not be advertised as configured just because the
calendar endpoints work.

| News source | Fresh direct read from Hetzner |
| --- | --- |
| Cointelegraph | HTTP 200 XML |
| MarketWatch | HTTP 200 XML |
| CoinDesk | HTTP 403 |
| CNBC Earnings | HTTP 403 |
| CNBC Market Insider | HTTP 403 |

News is therefore **partially available**, not fully healthy. The current service
retains source-level coverage and continues with the responding sources. No
authentication, bot protection or publisher access restriction was bypassed.
Zero DASH matches in retained headlines still does not establish no catalyst.

## Application defect found

Two CEX tests failed because a module-graph checker compared Windows backslash
paths with slash-separated expected module names. This also weakened its banned
module checks on Windows. Normalizing the checker's relative paths fixed both
failures without changing connector runtime behavior. The full suite then passed.

## Evidence and conclusion

Diagnostic logs are under `data/deployment/full-connector-*`: full-suite output,
terminal contracts, plugin types, hosted JSON, public endpoint JSON and server
news status. Public probes used at most two concurrent reads with deadlines.

It would be inaccurate to say every connector is fully working: keyed execution,
browser WebSocket continuity and platform-restricted providers remain unverified;
three publisher feeds are currently unavailable. The named inventory above makes
those gaps explicit rather than treating them as either successes or empty data.
No live orders, cancellations, signatures, bot launches or credential changes were
performed. The Windows test checker and provider typing/fixture issues were repaired. The
NanoGPT wrapper preserves its optional fetch helper without changing request
construction, selected model, retries or credential storage.

## Typecheck repairs

The package-level TypeScript command initially reported seven errors: fetch mocks
missing Bun's preconnect property, NanoGPT execution fixtures missing required
context, the SDK fetch wrapper missing its Bun-augmented helper, and a header
fixture inferring optional undefined values. These were repaired using correctly
typed context, Headers objects and fetch wrappers preserving the optional helper.
No type suppression was added. The subsequent package typecheck exited 0.
