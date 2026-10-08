## Pair navigation and hosted sync audit

Confirmed defects and corrections:

- Pair results were capped at 10–20 rows before asynchronously arriving native venue results. Venue-qualified results now filter before incremental 50-row display windows with Show more.
- Symbol-only maps collapsed Hyperliquid/Lighter listings. Exact venue and instrument identities now survive lookup, labels, current-selection marks and recent deduplication.
- Pane and workspace-variable selection discarded the result venue and retained the prior market. Selected rows now carry their actual venue.
- Cached CEX search did not normalize familiar ticker formats. Exact BTCUSDT, BTC USDT, BTC-USDT and BTC/USDT variants now find cached listings without altering execution IDs or merging multiplied/namespaced assets.
- Perpetual recent synthesis showed USDC-USDC as a quote. Shared pair splitting now returns the actual quote.
- Standalone deployment had no App Server, so cloud-sync settings were hidden and its coordinator never ran. A separate authenticated hosted transport now persists safe chart, workspace and display keys with per-key clocks, domain opt-outs and session recovery. Credentials, trust anchors and execution settings are excluded.
- Product copy and wordmark now identify CoinTrade. Existing storage keys, API routes, package identities, publisher attribution and upstream ownership remain compatible.

Scope: ordinary pair navigation across supported venues, as clarified by the user. Hyperliquid builder/HIP-3 markets were investigated separately; full builder execution is not claimed. Their collateral and signed asset mapping need further work before enabling them.

Validation evidence and deployed release are recorded below after final checks. No real trades or credentialed browser interaction tests are performed by this audit.

Watchlist sync also preserves existing adapter data and active selection, rebuilding derived lookups after validated hydration. Localhost does not advertise server sync. Devices authorized to this single-operator terminal share one settings profile; no multi-user isolation is claimed.

## Verification and release

335 focused terminal tests pass with 1,041 assertions; 89 backend tests pass, including sync clocks, blocked data, watchlist validation and session authorization. Root/native TypeScript, ESLint across 135 changed terminal files and the final production build pass. Release 20261008-2 is active on Hetzner. Hosted checks validate CoinTrade branding, protected shell/asset hashes, four venue/class catalogs and book/candle reads, PRL 3x controls, news/earnings/IPO/macro feeds, anonymous/agent sync denial, exact-origin checks and authenticated empty sync merge. No user settings were changed by deployment verification and no real trades were placed. Browser interaction and actual fills remain unverified.
