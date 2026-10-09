# QuantTrade single-terminal work plan

- [completed] Inspect upstream repositories, licenses, and exchange APIs; establish agent authority.
- [completed] Define implementation architecture and first release acceptance criteria.
- [completed] Build reusable exchange readers and guarded Hummingbot execution service.
- [completed] Integrate Hyperliquid/Lighter into the existing terminal and rebrand it QuantTrade.
- [completed] Integrate external agent proposals and human approval inside QuantTrade; block unattended routes.
- [completed] Retire the separate Perp Desk interface and provide one launcher.
- [completed] Verify connectors, trading controls, production build and hosted release. Interactive browser verification remains unavailable because UI access was denied; no funded live orders were used.
- [completed] Deliver run instructions and document remaining external setup.

Implementation is saved as an overlay on the complete pinned Pairlens monorepo. Live-money execution remains unverified until the user configures Hummingbot and exchange credentials.

## Hetzner deployment

- [completed] Discover SSH access and inspect existing services on azure-prod-02.
- [completed] Prepare production static build, private bridge runtime, and Hummingbot service configuration.
- [completed] Build and install an isolated QuantTrade release on the existing Hetzner server.
- [completed] Configure private SSH access, persistent services, and Hummingbot API. Public hostname/DNS selection remains pending.
- [completed] Verify hosted SPA/assets, exchange feeds, proposal authorization, and existing sites. Interactive browser smoke test remains unverified because Windows UI access was denied.
- [completed] Deliver private access instructions in docs/HETZNER.md and Connect-QuantTrade.ps1; exchange credentials, model connection and public domain remain to configure.



## Public domain
- [completed] Verify quanttrade.azurestore.shop DNS points to Hetzner.
- [completed] Configure HTTPS, protected terminal access and exact bridge origin.
- [completed] Verify public access, authorization, HTTP redirect, certificate renewal dry-run and existing sites.
- [completed] Save private login in ignored data/deployment/quanttrade-login.json and document public access.



## Native exchange credential integration
- [completed] Define and verify native credential flow, hosted session authentication and Hummingbot validation contract.
- [completed] Implement guarded credential endpoints and secret handling: 36 backend and 15 credential guard tests pass.
- [completed] Update native credential wizard, separate venue modes, hosted approval session and server-side key storage. Manual orders submit directly; AI proposals require approval.
- [completed] Verify 48 focused native tests, native/root TypeScript, lint, production build, 36 backend tests and 15 credential guard tests.
- [completed] Deploy /opt/quanttrade/releases/20261006-2 and verify HTTPS sessions, credential rejection, role/CSRF guards, market feeds and existing sites without real keys or trades.



## Exchange pair discovery
- [completed] Fix global search and browse visibility for complete supported Hyperliquid/Lighter perpetual catalogs; preserve exchange in charts and recents.
- [completed] Verify discovery pagination, search, TypeScript, lint and native production build: 30 focused tests pass.
- [completed] Deploy release 20261006-3 to Hetzner; HTTPS shell and complete JS asset match build, both catalogs verified. Fixed QuantTrade proxy buffering permissions by streaming responses; no trades placed.


## Login persistence and full exchange trading
- [completed] Reproduce repeated login prompts: signed-out Bearer header and missing private cloud API polling caused Basic challenges. Nginx fix deployed and live regression checks pass; SDK transport fix is deployed in release 20261007-1.
- [completed] Audit order types, leverage/margin, triggers, spot credentials and lifecycle. Both spot connectors present; market bounds and truthful leverage acknowledgment require private HBot extensions.
- [completed] Implement native HL/Lighter spot/perpetual trading, bounded market execution, reduce-only, leverage, margin and exchange-native trigger operations while retaining AI approval.
- [completed] Verify tests, TypeScript, build and deploy release 20261007-1. All four catalogs plus books/candles verified on Hetzner; no real-money verification orders. Spot native conditional orders remain explicitly disabled until supported behavior is verified.


## NanoGPT provider
- [completed] Add NanoGPT to the existing BYOK model picker, streaming and agentic model interface.
- [completed] Verify provider contract, final trading checks, build and release to Hetzner. NanoGPT/SDK tests: 7 passing; native connector/provider tests: 102 passing; backend: 60 passing; private Hummingbot extensions: 49 passing; native TypeScript and targeted lint clean.

Hosted release verification passed: all eight private Hummingbot extension routes require authentication; agent manual-operation and snapshot access denied; HTTPS login regression checks passed; six frontend assets including the largest JS bundle match deployed files; existing sites remain available. Catalog counts: Hyperliquid 178 perpetual / 317 spot, Lighter 196 perpetual / 10 spot. No real orders placed.

## Provider suites and official logos
- [completed] Confirm Lighter identity; audit official API suites and logo sources. NanoGPT scope confirmed chat/research/trading tools only.
- [completed] Map chat/research/trading capabilities to existing panels and explicit approval cards; wallet/protocol scope clarification remains pending.
- [completed] Implement provider research/model/account tools, exact assistant trade/operation proposals, searchable NanoGPT model choice and official logos within the existing terminal.
- [completed] Verify tool contracts, authorization, assets, production build and Hetzner deployment. Release 20261007-2 active: 126 terminal tests plus 3 logo tests, 14 provider/SDK tests, 67 backend tests and 49 deployed Hummingbot tests pass; TypeScript, focused lint and production build pass. Hosted logos/three largest JS assets match; research feeds and login/security regressions pass. No real trades placed; advanced execution and wallet limitations documented.

## Plugin failure investigation
- [completed] Identify affected default news and schedule feeds: standalone Nginx /api prefix deliberately returned503; App Server data services missing.
- [completed] Supply native news/earnings/IPO/macro contracts from fixed published sources with bounded cached downloads and meaningful filters; 80 backend tests and root TypeScript pass.
- [completed] Deploy backend-only release20261007-3 reusing verified production frontend. Actual host80tests pass; publicnews/crypto/earnings/IPO/macro contracts200 and liveentries verified; login,auth,AIapproval andassetintegrity checks pass. Macro coversBLS+BEA; no real trades.

## Exchange switching and ticker compatibility
- [completed] Reproduce quote-specific venue switching and search failures: same-class switches reused USDT IDs and connector search only matched literal dash symbols.
- [completed] Resolve same assets to actual target-listed IDs in chart routes, global dashboard, pinned panes and variables; warm cold CEX catalogs; improve ticker/name query formats; 80 focused terminal tests pass.
- [completed] Verify80focusedterminaltests, nativeTypeScript, changed-filelint andproductionbuild. Deployed20261007-4;80backendtests pass onhost, allfourcatalogs/book/candles, news/calendars, login/approval guards verified; actualHTML and5referencedJS/CSS assets match release andcatalog-switch codebundled. No real trades.

## Cartesian trading integration audit
- [completed] Audit venue, pair, market class, account, session and control combinations; reproduce mixed account and expired session failures.
- [completed] Scope balances and labels; recover hosted sessions; enforce market leverage, precision and minimums including Lighter PRL.
- [completed] 140 terminal tests and 86 backend tests pass; native/root TypeScript, targeted lint and production build pass. Deployed release 20261008-1; live PRL controls, all four catalogs/books/candles, login and approval guards, news/calendars and shell/assets verified. All 196 Lighter contracts have current funding rows. No real trades placed.

## Trading navigation, sync and brand audit
- [completed] Reproduce truncated native results, symbol-only venue collapse, lost selection venue, compact ticker failure and missing standalone sync.
- [completed] Implement venue/class filters, reachable result paging and cached ticker aliases; preserve selected venues; add protected preferences/layout/watchlist sync; apply CoinTrade name as requested.
- [completed] 335 terminal tests / 89 backend tests, TypeScript, changed-file lint and production build pass. Deployed 20261008-2; branding, sync authorization, all market feeds, news/calendars and actual protected frontend assets verified.
- [completed] Reviewed tracked files and ignored credentials/generated outputs. Source commit d27feec pushed to https://github.com/moemara-1/quanttrade-terminal on codex/cointrade-integration.

## Liquidation feed repair
- [completed] Trace native provider and reproduce hosted liquidation route failure; verify official feed protocols and data coverage.
- [completed] Implement persistent Binance/Bybit collection, native public route and truthful collection/coverage states.
- [completed] 97 backend tests and 102 focused frontend/provider tests pass; root/native TypeScript, 140-file lint and production build pass. Deployed 20261009-1; both live streams connected across all four history windows, existing feed/login/trading/sync guards and protected assets verified. Commit and publication recorded below. No orders placed.

## Unified order controls and AI trade preparation
- [completed] Trace duplicated controls and AI order preparation; define shared venue/account/contract draft.
- [completed] Integrate one leverage/margin ticket, limit-only post-only, position management, and contextual AI entry point.
- [completed] 98 backend and 60 focused terminal tests pass; root/native TypeScript, 143-file lint and production build pass. Deployed 20261009-2; active assets, ticket/approval guards, live streams, news/calendars, login, market controls and sync checked. No real orders or paid model calls; browser interaction not automated. Publication follows the authorized GitHub workflow.

## QuantTrade branding correction
- [completed] Audit visible product names and logos across terminal, onboarding, browser and installed-app assets.
- [completed] Apply QuantTrade name and consistent logos while preserving upstream licenses and internal compatibility keys.
- [completed] 98 backend, 21 terminal and 12 plugin tests pass; native/root TypeScript, 145-file terminal lint plus package lint and production build pass. Visually checked Q icon and wordmark. Deployed 20261009-4 with clean frontend directory after a stale-bundle check correctly rolled back the first attempt. Protected HTTPS branding assets, installed-app manifest, title, compiled names and existing feed/auth/trading guards verified. No orders placed; browser interaction not automated.

## Connected-account loading race
- [completed] Verified Lighter remains connected live on the server; reproduced exact-slot miss when positions load before parent connector provisioning.
- [completed] Restore only the exact saved venue/account slot for early private reads; preserve wrong/missing-account refusals and disabled connector guard.
- [completed] Verified 25 regression/auth/session tests, native TypeScript, targeted ESLint and production build. Deployed 20261009-5 to Hetzner; hosted auth, sync, feeds, markets, controls and asset checks passed. Published repair to GitHub.
