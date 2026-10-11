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

## Position management scrolling repair
- [completed] Traced nonshrinking ticket inside clipping pane/tab shells; added one keyboard-accessible vertical scroll region around the full ticket.
- [completed] Native TypeScript, ESLint and production build passed. Deployed release20261009-6; hosted authentication, markets, controls and frontend asset checks passed. Committed and pushed. No interactive browser verification performed.

## Direct AI trade approval and leverage repair
- [completed] Identified intentionally disabled HL/Lighter Workflow controls and competing workflow authoring tool routing.
- [completed] Removed unsupported native Workflow, restored opening-order controls, routed trade setup to direct proposal cards with exact account/mode binding and preserved size/leverage/margin.
- [completed] Passed 37 targeted tests (195 assertions), native lint/typecheck and production build. Deployed release20261009-7; hosted auth, feeds, markets, exact assets and new approval guards passed. Committed and pushed. No real order or paid model request made.

## Hosted live session and paper misreporting repair
- [completed] Verified Lighter live/authenticated and actual order FAILED with zero fill: older signer rejected PRL market4097; upstream profile failure falsely said signed-out/paper.
- [completed] Corrected hosted account mode/session reporting, exact mode inference, observed submission evidence, truthful paper/live card status and market acknowledgement waiting. Pinned Lighter SDK1.1.4 supports4097.
- [completed] Passed58native tests/267assertions,32Python tests, native lint/typecheck/build and offline signer red/green. Deployed20261009-8, all hosted checks passed; committed/pushed. No user trade replayed.

## Restore approved native workflows
- [completed] Implement bounded, persistent approved workflow runs for HL/Lighter, with direct chat confirmation and truthful run state. Exact steps, reviewed cap, per-leg risk checks, kill/mode/credential/late-step pauses, and interrupted-submission refusal.
- [completed] Restore native ticket workflow preparation, complete-plan review and persisted run/cancellation cards. 105 backend tests,61 focused native tests/278 assertions,51 Python tests and root/native TypeScript plus targeted ESLint passed. No orders or paid model calls.
- [completed] Production build passed; deployed Hetzner release20261009-9. Authenticated runtime schema, persisted run reads, private workflow writes, approval/run assets, login, feeds, account controls, catalogs, sync and branding guards passed. No real orders, workflow registration, paid models or browser automation used. Committing/pushing authorized repair.

## Restore original workflow parity
- [completed] Audit original core workflow engine, venue execution and OCO semantics; define server persistence and approval integration.
- [completed] Implement original graph nodes, branch/join behavior, dynamic terms, fill-aware exits and OCO coordination; remove artificial schedule limits.
- [completed] Verified 123 backend tests, 66 native tests/290 assertions, 60 Python tests, TypeScript, lint and production build. Deployed Hetzner release20261009-10; all hosted guards and offline container SDK OCO signing passed. An outdated verifier label caused a successful automatic rollback before correction and verified redeployment. No trades, workflows, browser automation or paid model calls used. Committing/pushing authorized changes.

## Persistent hosted login
- [completed] Trace browser Basic challenges and session restart/expiry behavior.
- [completed] Replace browser prompt with remembered password login, durable sessions, logout and protected navigation.
- [completed] 125 backend tests, TypeScript and 10 offline login-page flows passed. Deployed Hetzner release20261009-11; normal sign-in, logout revocation, protected shell/assets, origin/agent guards, feeds, catalogs, sync and branding verified. Cleared only failed staging releases after disk-full staging failure and omitted redundant build backups in new release. No trades placed; committing/pushing authorized changes.

## Login document content type
- [completed] Reproduced live /login application/octet-stream response; JS/CSS already have correct types.
- [completed] Explicit HTML MIME type deployed; nginx syntax, live HTML/JS/CSS response types, password login/logout, protected navigation and operator/agent guards verified. No trades placed.

## Match login to QuantTrade brand
- [completed] Adapted login to real QuantTrade logos, Hanken Grotesk, Graphite colors/mint accent and responsive terminal composition.
- [completed] Form hooks, JS syntax and structural checks passed; deployed login HTML/CSS and public brand aliases. Live asset hashes, HTML/JS/CSS/font types, login/logout, protected terminal and operator/agent guards passed. Committing/pushing authorized design.

## NanoGPT assistant error
- [completed] Confirmed UI masks all provider failures. Public NanoGPT catalog/tool support and CORS pass; actual SDK offline thinking/tool-followup test passes. Browser failure cause remains unobserved; no speculative adapter changes.
- [completed] Safe actionable error categories and HTTP diagnostics deployed Hetzner20261010-1; billing notices retained. 14 offline tests/31 assertions, full native TypeScript/lint/build, 125 hosted backend tests and all hosted guards pass. No paid AI calls or trades.
- [pending] User to retry once and provide QT-AI code; original browser provider failure not reproduced or claimed fixed.

## Direct AI trade confirmation and Lighter ticket values
- [completed] Audit chat confirmation, Lighter balance/notional sizing and empty execution plans.
- [completed] Fix single-click AI approval, spendable collateral and fresh pair prices; separate notional from initial margin and reject plans without orders.
- [completed] Verified 126 backend tests, focused native balance/approval tests, full terminal TypeScript/lint and production build. Deployed Hetzner20261010-2; login, catalogs, PRL3x cap, feeds, sync and ticket guards pass. Read-only live balance confirms available differs from total collateral. No trades or old-plan replay.

## Workflow ticket usability audit
- [completed] Audit found unclear required budget, hidden blockers, late graph validation, misleading root-exit protection copy and approval values surviving context changes.
- [completed] Fix visible required currency input, all-blocker feedback, graph preflight/review and account/pair/workflow approval resets; independent review found no remaining blockers.
- [completed] 21 native tests/59 assertions and redâ†’green malformed-graph transport regression pass; full native TypeScript, changed-file ESLint and final production build pass. Deployed Hetzner20261010-3, 126 backend tests and all hosted guards pass. No trades, workflow registration, browser automation or paid AI calls. Committing/pushing authorized changes.

## GRAM execution evidence and native order audit
- [completed] Read-only evidence confirms buys pending and run paused at credential boundary; no GRAM orders/fills in returned native snapshot. Guide incorrectly treated trigger as entry. Native TWAP/OTOCO integration gap verified.
- [completed] Correct trigger/size/coverage instructions, exact-run chat outcomes, same-key reconnect false pauses and fresh position proof for reduce-only triggers. 127 backend, 22 native and 63 Python tests pass.
- [completed] Native/root TypeScript, lint, production build, 127 backend/22 native/63 Python tests pass. Deployed Hetzner20261010-4; refreshed HBot extension and hosted guards pass. No orders, workflow registration or paid model calls made; old paused run not resumed. Native TWAP/entry-attached Lighter OTOCO remain unimplemented and are not claimed supported.

## Stale terminal and assistant instruction audit
- [completed] Confirmed old tabs cannot detect updates because all overlay releases used the same upstream build ID. Hosted assets are current.
- [completed] Added source-content build identity and explicit assistant rules against trigger-as-entry, manual-ticket bypass and balance-based fill claims.
- [completed] Seven identity/updater tests (25 assertions), native TypeScript, changed-file ESLint and production build pass. Hetzner20261010-5 deployed; backend tests and all hosted guards pass. Manifest matches bundled build identity. No trades or paused workflows resumed. Commit/push authorized.

## Simplified workflow sizing
- [completed] User selected total margin: 200 USDC at 5x targets 1000 USDC of entries. Graph sizing/caps traced.
- [completed] Implemented margin/leverage/workflow/margin-type inputs with derived base size, reserve and schedule review; same-key identity now persisted across bridge restarts.
- [completed] Native/root TypeScript, lint, 19 focused native tests/58 assertions, 127 backend tests and production build pass. Hetzner20261010-6 deployed; hosted guards and source/bundle build identity pass. No trades or old runs resumed. Native order-type expansion completed in the subsequent execution repair below.

## Complete Lighter native order integration
- [completed] Read pinned SDK and official order documentation; traced assistant approval and signer paths.
- [completed] Exposed all seven SDK native types, OTO/OCO/OTOCO, time-in-force/expiry and pinned live account/revision approval.
- [completed] Native payloads, risk guards, account revision, receipt projection and read-only hosted guards verified; no test trades submitted.

## Fill reconciliation and workflow protection repair
- [completed] Traced exact Lighter fill DTOs, client-ID placeholders, missing-evidence pauses and inherited last-slice protective sizing.
- [completed] Reconciliation and explicit full-workflow protection implemented; transient reads never resubmit and old immutable runs remain paused.
- [completed] 156 backend tests, 74 Python tests, 68 focused terminal tests, TypeScript/lint and production build pass. Hetzner20261010-8 hosted guards pass; server/signer hashes and frontend build identity match. Old paused runs remain paused. Commit/push authorized.


## 11 October full app audit and repair
- [completed] Audit navigation/pinned charts, sliders, connectors, approval/session boundaries and app quality; record reproducible findings.
- [completed] Fix confirmed defects with focused regression tests and verify each affected module.
- [completed] 3,894 terminal, 160 backend and 76 signer tests; TypeScript/lint/build pass. Hetzner 20261011-1 read-only hosted guards and build identity pass. No trades submitted or resumed. Commit/push authorized.

## Advanced Lighter and Hyperliquid single-approval plans
- [completed] After audit repairs, inspect user trade transcript and official native capabilities for conditional/TWAP/scale/atomic/chase/iceberg.
- [completed] Implement Scale, managed Iceberg and managed TWAP with one exact human approval, paired multi-TP allocations, fill-gated slices and pinned account/revision. Existing conditional/native Lighter types retained.
- [completed] 3,903 terminal tests, 163 backend tests, focused 37 tests/169 assertions, TypeScript/lint/build pass. Hetzner 20261011-2 read-only hosted guards and source identity pass. No test trades or old-run resumes.
- [completed] Native Hyperliquid TWAP and bounded managed Chase completed in the final integration below. Atomic remains unavailable without a verified all-or-none native signing contract.

## Finish native TWAP, Chase and Atomic
- [completed] Account-pinned evidence, fresh TWAP admission, explicit native risk permission and direct status/reviewed cancellation controls shipped Hetzner20261011-4. 3,920 terminal/190 backend/90 signer tests, TypeScript/lint/build and hosted guards pass; no live trades.
- [in_progress] Add explicitly reviewed fill-aware protection to native Hyperliquid TWAP and managed Chase; current cards disclose entry-only scope. Managed entry-plus-protection plans are supported separately.
- [completed] Implement native Hyperliquid TWAP create/cancel/evidence and durable managed Chase with fresh bid/ask, partial-fill reconciliation, owned cancellation, one approval and account/revision guards.
- [completed] 3,911 terminal, 183 backend and 90 signer tests; native/root TypeScript, changed-file ESLint and production build pass. Hetzner 20261011-3 hosted guards, signer runtime SHA and build identity pass. No live test trades/cancellations or old-plan resumes. Commit/push authorized.
- [blocked] Atomic: official Lighter signer/prover expose no verified multi-market all-or-none signing contract; Hyperliquid ordinary batches allow independent leg outcomes. Capability discovery explicitly reports unavailable; no fake batch fallback. Verified primary sources recorded in docs/advanced-order-plan.md.
