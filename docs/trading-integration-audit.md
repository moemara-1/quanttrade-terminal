# Trading integration Cartesian audit

Date: 2026-10-08. Scope: source inspection and unauthenticated official public market data. No keys, connected-account queries, real trades, browser interaction, or deployment mutations were performed by this reviewer. Source changes by parallel agents can supersede observations; findings below describe the observed code before their final verification.

## Coverage model

The Cartesian dimensions are venue (Hyperliquid, Lighter, Binance, Bybit), instrument (spot, perpetual), actor (manual, AI), connection (connected, missing, rejected credentials), context (global, pinned, variable-selected), and action (market, limit, post-only, reduce-only, leverage, margin, SL/TP, amendment, cancellation). This defines 4 × 2 × 2 × 3 × 3 × 10 = 1,440 conceptual cells. Some combinations are intentionally invalid (spot leverage/reduce-only/margin; unconnected execution), and must reject rather than inherit another venue. This is a coverage model, not a claim that 1,440 live executions were tested.

| Case family | Evidence reviewed | Required invariant | Status at inspection |
|---|---|---|---|
| Public discovery, all four venues and spot/perp | Native discovery mapping; Pairlens pair helpers and futures listings | Listed native identity retained across quote/venue changes | Cross-venue switching addressed in previous work; root/UI agent reviewing active context |
| Global/pinned/variable ticket | trade-entry-pane.tsx, trade-entry-panel.tsx, pane context | Pair + venue + account + prices refer to same context | Desktop ticket remounts on pair/venue/wallet key; margin pane remains all-account |
| Native missing/rejected credentials | quanttrade-connectors.ts credential lookup, quanttrade-session.ts | No fallback to CEX account; recover hosted login cleanly | Explicit missing credential failure; session agent owns recovery |
| Manual vs AI, four native aliases | attended-trading.ts, trade-entry submit, exchange-operation controller | Manual ticket direct; AI requires explicit approval | Confirmation separation exists; no funded execution verified |
| Market/limit precision/minimum | src/server/trading.ts and operations.ts | Exact amount, native decimals/minimum, protected execution | Backend decimal validation present; frontend metadata omitted at inspection |
| Native leverage/margin | manifest, desktop/mobile ticket, exchange-tools | Selected contract cap, not venue-wide constant | P1 findings below; root implementing cap validation |
| Native spot quote sizing | desktop and mobile ticket submit branches | Server rounds base conversion to native precision and respects quote budget | Desktop preserves native quote request; mobile limit path differs |
| Perp units and risk | contract-size.ts, ticket-math.ts, position-size.ts | Base units explicit for native one-to-one contracts | Native listing not in CCXT contract-size cache |
| SL/TP and amendment | exchange-tools.tsx, native backend routes | Current pair/account scope; native precision and immutable IDs | Supported perp triggers, no spot triggers; snapshot state review needed |
| Funding/OI research | manifest capabilities, use-funding-rates.ts | Native venues visible where data is available | Native funding/OI omitted from board capability set |
| History/navigation | native connector history, PublicMarkets.candles | Older-history request advances to requested window | Fixed latest-240 window prevents older scrolling |

## Official PRL fixture

Public Lighter endpoint: https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails?filter=perp . Observed PRL market ID 4097, active perpetual, min_initial_margin_fraction 3333, default_initial_margin_fraction 3333, maintenance_margin_fraction 2000, supported_size_decimals 2, supported_price_decimals 4, min_base_amount 5.00, min_quote_amount 10.000000. Official SDK signer_client.py update_leverage (raw source lines 1233-1235, inspected through web tool) computes imf = int(10_000 / leverage) and passes imf to sign_update_leverage. Fractions are basis points: integer leverage cap floor(10000 / 3333) = 3. Thus valid leverage presets are 1, 2, 3; amount increment .01 PRL; price increment .0001 USDC; minimum also subject to 10 USDC notional. Values can change and must be refreshed. Official SDK reference: https://github.com/elliottech/lighter-python/blob/main/lighter/signer_client.py ; model reference https://github.com/elliottech/lighter-python/blob/main/docs/OrderBookDetails.md . Live feed alone directly establishes published values; latest SDK is a reference, not a claim that pinned deployed SDK matches every API.

## Prioritized findings

### P1: Pair-specific constraints stripped at connector boundary

quanttrade-connectors.ts marketSchema retains symbol/base/quote/price/volume but omits sizeDecimals, priceDecimals, minimums and leverage. Manifest supplies maxLeverage 125 to all perps. Desktop trade-entry-panel.tsx and mobile trade-panel.tsx read marketInfo.maxLeverage. ExchangeTools separately hardcodes max=125. Impact: PRL presents unsafe/invalid leverage and users learn lot rules through server rejection. Remedy: pair-scoped metadata shared by all controls, fresh-cap validation on orders and operations, explicit unavailable/loading state; never silently substitute 125. Root and UI agent own fixes.

### P1: Liquidation estimate uses wrong maintenance requirement

ticket-math.ts hardcodes maintenance margin .005 for every venue and pair. PRL publishes .20. At 3x, the simple isolated long estimate factor changes from .671666 to .866666. Labeling this estimate does not make the enormous difference useful. Cross mode compounds the assumption mismatch. Remedy: use published pair-specific maintenance and compatible margin mode, or hide the estimate when inputs are insufficient. Do not claim an exact liquidation price from an opening ticket.

### P1: Two independent leverage controls disagree

Desktop ticket has persisted leverage + dirty flag; ExchangeTools has independent state initialized to 1 and independent marginMode initialized cross. Applying exchange leverage does not update the ticket. Conversely ticket changes do not update the native control. The subsequent order can overwrite an earlier exchange operation if the ticket dirty flag remains true. Remedy: one pair/account control source; explicit applied-vs-selected state or remove redundant setter.

### P2: Mobile native spot quote-limit conversion differs

mobile/panels/trade-panel.tsx computes quote-sized limit baseSizeAt(amount, price).toFixed(8). Desktop excludes native spot venues from this conversion and preserves quote_ccy so backend decimal rounding/budget protection applies. PRL and other native instruments have their own lot precision. Impact: avoidable precision rejection and parity loss on mobile. Remedy: share native amount preparation and retain quote denomination until server conversion.

### P2: Native contract size never marked known

contract-size.ts warms only readCachedFuturesListings from the CCXT connector. QuantTrade native discovery does not populate that cache. Native one-base-unit contracts display fallback size 1 with known=false. Numeric one-to-one exposure happens to be correct but this cannot support a reliable units label or known risk input. Remedy: explicitly publish native contractSize=1 through pair metadata; show PRL/base units rather than ambiguous Contracts.

### P2: All-account margin pane can look like active-venue health

MarginHealthPane obtains useFuturesAccounts() and renders all results independently of usePanePair/wallet. A Binance flat-account caption can appear alongside a Lighter ticket. This is not evidence of wrongly executed orders, but the ambiguity undermines trust. Remedy: scope to pane-selected venue/account, or unmistakably label it as an all-account overview and show native selected account first.

### P2: Native funding/OI board integration absent

Native manifests do not declare funding/open-interest capabilities, and useFuturesFundingVenues/futuresPluginsFor exclude them. Public HL metadata contains funding/OI and Lighter metadata OI. Impact: native plugins feel incomplete beside CEX research boards. Remedy: implement conforming native funding/OI responses with actual interval semantics; do not fabricate absent data.

### P2: Chart backfill cannot request older history

Native history execute filters endTs over a latest-240 response. PublicMarkets.candles always uses Date.now end and 240 bars. When scrolling before that window, history returns empty instead of asking the upstream venue for an earlier range. Remedy: pass validated endTime/count to public candle service and cache on range.

## Positive invariants

Backend orders/amendments use decimal precision and minimum checks; HL noninteger prices enforce five significant digits. Protected market price is calculated with conservative side-aware rounding. Quote-sized buys carry a budget and revalidate it. Native missing credentials are rejected explicitly. The desktop trade-entry pane remounts when pair/venue/wallet changes, reducing stale local draft state. Approval controller uses stable IDs and refuses blind retries after unknown outcomes.

## Verification boundaries

No P0 execution defect established by this read-only review. No visual/a11y/performance score is assigned without a browser-rendered test. Connected credentials, paper/live parity, exchange margin-mode support on PRL, SDK signer behavior, mobile browser interaction, rejected-credential UX, all pinned/variable cases, and actual matching/fills remain unverified here. Root release verification should append final regression evidence and resolved finding states, and must not describe this source audit as exhaustive live-trading validation.

## Follow-up funding parity leaf

Added quanttrade-funding.ts and six focused regression tests. Public market rows must provide hourly fractional fundingRate (root owns Lighter normalization from official 8-hour-equivalent rate divided by 8). Leaf retains null/unknown exclusion, exact three-segment native pair filters, optional base hints, and native one-to-one base-unit OI with derived mark-price value. It does not invent next funding time, OI history, or funding forecasts. Hyperliquid settled history uses a bounded 100-hour read and sorted/deduplicated stamps. Lighter settled history explicitly declines until rate/direction units are verified; its current funding and OI remain available. Test evidence: six pass, zero fail, 16 assertions. Root owns capability registration and end-to-end release checks.

## Implemented audit corrections

- Exact venue/account balance isolation and available-balance selection; no unselected account fallback.
- Selected pane/account margin identity, explicit ticket instrument and venue context, draft reset on instrument/account changes.
- Public per-contract cap and precision/minimum controls refreshed every 30 seconds; unknown limits disable leverage edits. PRL metadata reports 3x, size precision 2, price precision 4, minimum 5 PRL and 10 USDC.
- Server validates explicit leverage against fresh selected market metadata before manual execution and again at agent approval; independent leverage widgets synchronize after accepted operations.
- Hosted tokenless private requests recover a 401 session once; uncertain execution outcomes and bearer requests never replay.
- Native one-base-unit contracts and mobile native quote-limit preparation corrected. Unverified native liquidation estimates removed.
- Chart historical boundary/count forwarded and cached by range. Native funding/OI capability integrated with selector regression. Lighter current rates normalize the official eight-hour fraction to hourly; settled Lighter history remains unavailable pending verified unit semantics.

Root verification: 86 backend tests pass, including a manual PRL 4x rejection with no exchange submission and a 3x AI proposal revalidated after its cap falls to 2x. Integrated session/connector/funding suite: 140 combined terminal tests pass; identity suite: 111 tests pass, plus expanded 144 account/venue combinations in 156 assertions. Production build and hosted rollout evidence will be recorded separately. These are deterministic tests and public read-only checks; no real orders or connected credential browser interactions were performed. The 1,440-cell matrix is audit coverage planning, not 1,440 live execution tests.

Final leaf verification: native TypeScript check exited 0 with no diagnostics; ESLint on both new funding files exited 0. The actual futuresPluginsFor board selector regression passes with native perpetual instances and excludes native spot instances. No hook rewrite was needed: the selector correctly uses declared asset class and capability.


## Hosted release verification

Release 20261008-1 deployed on Hetzner. Production unprivileged backend tests: 86 pass, zero failures. Final focused terminal suite: 140 pass, zero failures, 536 assertions. Root/native TypeScript, targeted ESLint and production build exit zero. Live PRL metadata validates 3x, size precision 2, price precision 4, 5 PRL / 10 USDC minimum. All four venue/class catalogs, order books and candles respond; all 196 Lighter perpetuals publish current hourly funding. News, earnings, IPO and macro feeds respond with real entries. Hosted login, operator/session boundaries, explicit AI approval restrictions, official logos, protected shell and referenced asset hashes verified. No real orders or credentialed browser UI smoke tests were performed. Lighter settled funding history and advanced execution limits listed above remain explicit.
