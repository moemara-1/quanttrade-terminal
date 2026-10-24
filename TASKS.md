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
- [completed] User-authorized browser test on 11 October returned exactly OK in a clean conversation without tools or trades; current assistant failure did not reproduce. Both NanoGPT reasoning stream variants covered offline; original failure root cause remains unobserved.

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
- [completed] Bundled fill-aware native Hyperliquid TWAP and managed Chase protection shipped Hetzner20261011-5. One approval pins exact SL/TP allocations, account/revision and entry/exit caps; partial fills, settlement, late fills, restart binding and final quote races tested. 3,925 terminal/225 backend/91 signer tests, TypeScript/lint/build and hosted guards pass; no live trades or old plans resumed. Browser assistant connectivity test returned OK; original NanoGPT error not reproduced. Atomic remains unavailable without verified native contract.
- [completed] Implement native Hyperliquid TWAP create/cancel/evidence and durable managed Chase with fresh bid/ask, partial-fill reconciliation, owned cancellation, one approval and account/revision guards.
- [completed] 3,911 terminal, 183 backend and 90 signer tests; native/root TypeScript, changed-file ESLint and production build pass. Hetzner 20261011-3 hosted guards, signer runtime SHA and build identity pass. No live test trades/cancellations or old-plan resumes. Commit/push authorized.
- [blocked] Atomic: official Lighter signer/prover expose no verified multi-market all-or-none signing contract; Hyperliquid ordinary batches allow independent leg outcomes. Capability discovery explicitly reports unavailable; no fake batch fallback. Verified primary sources recorded in docs/advanced-order-plan.md.

## Calendar panels standalone transport repair
- [completed] Reproduced the standalone client refusal before any request; routed earnings, IPO and macro calls to existing same-origin feeds and added a narrowly scoped local proxy. Provider failure distinctions and unsupported company/insider behavior preserved.
- [completed] Seven focused regressions, 3,932 terminal tests, native typecheck, changed-file ESLint and production build pass. Deployed Hetzner20261012-1; live earnings/IPO/macro feeds, login, asset hashes, approval guards and build identity verified. No trades or credential changes. Commit/push authorized.

## Assistant native execution repair
- [completed] Confirmed live Lighter had no revision; transcript also used wrong OCO entry grouping, invalid margin sizing and workflow bypass. Reproduced and repaired a stored-versus-running encrypted Lighter tier mismatch using actual adapter tests and private live verification.
- [completed] Fresh operator-only scope recovery, exact grouping/alias/margin instructions and SDK stop-at-confirmation shipped Hetzner20261013-1. Live signing scope and persisted revision verified; keys unchanged, no trades or old-plan resumes. 3,944 terminal /227 backend /96 signer tests, typecheck/build and hosted guards verified; commit/push authorized.

## Reject invalid native confirmation cards
- [completed] Match native preparation validation to signer rules for child sizing, time in force and expiry; shared read-only server preflight verifies risk and margin before card.
- [completed] Read-only preflight, invalid historical cards, exact linked sizing/TIF/expiry and fresh opening margin checks shipped Hetzner20261013-2. 3,951 terminal /232 backend /96 signer tests, TypeScript/lint/build and hosted operator/invalid-plan guards pass. No live orders or old-plan resumes; failed ZEC request was not retried. Commit/push authorized.

## Native pending orders and assistant cancellation routing
- [completed] Replace local-cache discovery assumptions with fresh native order reads, route Lighter/Hyperliquid cancellation by exact native ID, bind account/revision and surface read failures.
- [completed] Fresh native discovery, exact large IDs, scoped cancellation and structured tool errors shipped Hetzner20261013-3. 3,956 terminal /236 backend /102 signer tests, TypeScript/lint/build and actual hosted Lighter discovery/access checks pass. No live orders cancelled/created or paused plans resumed; commit/push authorized.

## Assistant market scan transport and native symbols
- [completed] Reproduced optional App Server failures and generic foreign-venue candle fallback. Assistant context now uses public feed fallback with explicit source/timestamps and unknown metrics; native reads resolve exact catalog symbols and bypass foreign chart/provider fallback.
- [completed] 3,970 terminal and 236 backend tests, native/root TypeScript, lint and production build pass. Deployed Hetzner20261014-1; actual catalog/hourly candles for all eight requested Lighter assets and existing order/signing guards verified. No trades, cancellations or credential changes; commit/push authorized.

## Disable backend notional caps as requested
- [completed] Explicit Off/null backend caps retain daily usage, reservation/idempotency, exchange checks, immutable approved budgets and AI confirmations. Assistant now reads actual hosted caps separately from local controls.
- [completed] 3,972 terminal /240 backend /2 deployment-configuration tests, native/root TypeScript, lint and build pass. Deployed Hetzner20261014-2; actual caps Off and unrelated bridge.env settings unchanged verified. No trades/cancellations or paused-run resumes; commit/push authorized.

## Live workspace activity
- [completed] Existing workflow page now defaults to live Activity: native exchange orders, server workflow/Chase runs and bounded native TWAP acknowledgments; Builder and browser-local history retained.
- [completed] Account scope, partial/error states, polling and catalog-resolved deep links verified: 3,982 terminal /241 backend tests, TypeScript, lint and production build pass. Hetzner20261014-3 actual read-only activity feeds and approval guards verified; no trades, cancellations, credential changes or paused-plan resumes.

## Remaining assistant execution fixes
- [completed] Reproduced missing DeepSeek reasoning history, generic-history dependency blocking native Lighter fills, and accepted native TWAP receipt corruption after protection binding failure. Official venue/API capability review distinguishes native orders, managed plans and unsupported atomic baskets.
- [completed] Fixed reproduced protocol/fill/receipt bugs and capability routing with red/green regressions, one approval, no uncertain retries; fresh Hyperliquid TWAP margin guard and recovery warning preserve exact accepted identities.
- [completed] 3,990 terminal /245 backend tests, TypeScript, lint and production build pass; Hetzner20261014-4 runtime/approval/native-source checks verified. No live provider key or test trades; historical paused plans unchanged. Atomic and native TWAP partial-fill protection limits documented; commit/push authorized.

## Manageable activity workspace
- [completed] Compact market groups, Current/History, search and venue filters; diagnostic and empty-provider noise behind disclosure, zero triggers suppressed.
- [completed] Explicit reviews for native limit amendments/cancellations and workflow pause/stop; saved graph copies open Builder. Lighter total quantity includes fills and unsupported edit types explain limits; uncertain actions never replay.
- [completed] 4,005 terminal /248 backend /106 Hummingbot Python tests, TypeScript, lint and fingerprinted build pass. Hetzner20261014-6 hosted checks and actual browser Current/History/edit-review/compact layout verified without final live confirmations. Recovered disk-full bridge failure by clearing obsolete generated frontend caches; trading data and rollback releases retained; deployment now requires 512 MiB headroom. Commit/push authorized.

## Chart connector mismatch
- [completed] Reproduced global search rows being rebound onto native venues; fixed venue-scoped search and explicit pin venue labels. Legacy two-part native pins resolve perpetual catalog targets for recovery.
- [completed] 4,009 terminal tests, TypeScript, lint and production build pass; Hetzner 20261015-1 deployed and hosted checks pass. Browser verified stale PUFFER pin cleared with Follow the board: binance-futures / PUFFER-USDT-USDT. No trading actions performed.

## LLM failure audit
- [completed] Reproduced invalid prepare_position_plan numeric/array argument encoding and unknown error classification in the open chat; stopped its repeated generation. Network failures remain a separate unproven cause.
- [completed] Test-first bounded plan input repair, typed failure diagnostics, truthful network copy, and stop after repeated invalid preparation. Full schema and human approval remain required.
- [completed] 4,028 terminal tests / 18,222 assertions, TypeScript, lint and source-fingerprinted production build pass. Hetzner 20261016-1 deployed with all hosted checks passing. Live NanoGPT connectivity-only prompt returned OK; the earlier intermittent network failure was not reproduced. No orders, cancellations, credentials or risk settings changed.

## Journal and native spot read failures
- [completed] Journal called absent Pairlens cloud service; missing spot connector config produced Lighter503. Safely restored only absent spot config from verified matching account/key, preserving perpetual bytes; fresh spot/perp reads200 complete (0/2 orders), no trading mutations.
- [completed] Device-only journal reads/writes persist with validated records and reject corruption/storage failures; tools disclose manual-only coverage, never empty-on-failure or exchange PnL. 4,034 terminal tests and 2 migration regressions pass.
- [completed] Final TypeScript/lint and fingerprinted build pass. Hetzner 20261016-2 and all hosted checks pass, including both complete native order scopes. Actual assistant get_trade_journal returned available/device-journal/count0/completeExchangeHistory:false. No orders or journal entries added/cancelled.

## Equities news
- [completed] Mixed crypto/default feed, six-stock tags and client ticker gate caused sparse/wrong equities stories; CDATA headline entities were not decoded.
- [completed] Test-first equity topic wire, untagged market-wide stories, expanded conservative ticker tags, CNBC earnings/insider feeds, safe headline entity decoding, conjunctive topics, failure coverage and topic-preserving deduplication.
- [completed] 4,037 terminal/254 backend tests, TypeScript, lint and fingerprinted build pass. Hetzner20261016-3 hosted checks and browser All/Earnings filters verified: 10 market headlines/1 matching headline. CNBC403 is documented; current RSS coverage is bounded, not guaranteed full-market news.

## NanoGPT network recovery
- [completed] Existing error and raw Chrome Failed to fetch confirmed. Current outage did not recur: fresh text and tool/follow-up calls succeeded. Found cause-less Chrome TypeError bypassing SDK retries; intermittent underlying network cause remains unproven.
- [completed] Added one abort-aware startup retry only; HTTP/SDK errors unchanged, response-stream interruptions never replay. 22 plugin tests/57 assertions, native TypeScript/lint and fingerprinted build pass. Deployed20261016-3; actual NanoGPT journal read and final response succeeded after reload. No trading or credential changes.

## Assistant background tab continuity
- [completed] Confirmed browser-owned model/tool loop with no stream recovery and no deliberate hide cancellation. Ordinary tab-switch failure remains unreproduced; component unmount can abort chats. Server response ownership chosen with explicit opt-in, not a claim of a fully autonomous server agent.
- [completed] Opt-in NanoGPT server jobs retain bounded bytes through disconnect, resume exact offsets and never restart accepted work; explicit Stop cancels. Separate inference quota protects trading controls. 4,042 terminal /262 backend /42 provider+SDK tests, terminal/backend TypeScript, focused lint and fingerprinted build pass. Hetzner20261016-4 and hosted authorization/no-proxy-temp-body checks pass; keys never logged or intentionally persisted.
- [completed] User explicitly approved and server-backed mode enabled through saved-provider wizard; preserved xiaomi/mimo-v2.6-flash and saved key. Reopened form confirms mode true and unchanged model; live OK and read-only journal/follow-up calls verified via hosted job201/200 and browser output after cursor correction.

## Duplicate live inference bytes
- [completed] Reproduced exact Broad market market is red duplication with a pending live stream reader: enqueue could re-enter pull before cursor advancement.
- [completed] Advance cursor before enqueue; regression and all 263 backend tests/typecheck pass. Server-only release20261017-1 deployed and auth/journal/runtime checks pass, without restarting Hummingbot or changing orders.
- [completed] Fresh actual NanoGPT journal read and follow-up paragraph/five list items complete without duplicates or errors; screenshot saved. No exchange tools/orders changed. Commit/push authorized.

## Hyperliquid connection parity
- [completed] Hosted Hyperliquid desk is live with both connectors present; perpetual/spot balances and native open orders return200. Spot coverage complete, perpetual standard-market coverage explicitly excludes builder markets; verified revision exists. No live trades performed.
- [completed] Fixed false spotConnected response and identical-key missing-spot bundle repair for both venues without changing verified revision/pausing unchanged runs. 265 backend tests,106 Hummingbot tests,29 native UI tests, root TypeScript and diff checks pass.
- [completed] Connectivity recovered on retry; pushed19f0713 and deployed20261017-2. All265 backend tests passed on Hetzner; hosted Hyperliquid perpetual/spot balances and native order reads, Lighter spot/perpetual reads, AI transport authorization, session/public HTTPS and execution/runtime guards passed. Hummingbot was not restarted; no credentials or orders changed. Root cause of earlier transient outbound timeouts remains unconfirmed.

## Lighter duplicate balances
- [completed] Live Lighter spot is empty; perpetual USDC and raw native assets reconcile. Reproduced legacy local plus canonical server references both surviving the credential merge; user browser display not inspectable (debugger unattached).
- [completed] Regression red/green; restore and reconnect now use canonical server references without deleting vault entries or combining distinct spot/perpetual funds. All4,044 frontend tests pass.
- [completed] All4,044 frontend tests, TypeScript, focused lint and production build pass. Fix d309f6d pushed; deployed20261017-3 with hosted public/session/AI authorization, Hyperliquid balance/order and Lighter order checks passing; version matches bd2d035454a99340. No service restarts, trades or credential changes. User confirms portfolio total is affected; actual browser visual confirmation unavailable (debugger unattached). Windows native SSH/SCP succeeded after intermittent Git-bundled failures; exact network cause unconfirmed.

## Assistant question continuation failure
- [completed] Reproduced on harmless question and OK prompts: current deepseek/deepseek-v4.1-flash-1017:thinking returned503 three times. SDK RetryError.lastError was ignored by diagnostics. Both NanoGPT catalogs list model; no claim of missing keys or broken account connection.
- [completed] Real SDK RetryError regression red/green; bounded cycle-safe known-wrapper traversal preserves final status without private payload text. 4,047 frontend tests, TypeScript and focused lint pass. User authorized alternate model; same key/server-backed mode with xiaomi/mimo-v2.6-flash passed OK, question card/custom reply and read-only journal/follow-up live.
- [completed] Production build, TypeScript/lint and4,047 tests pass. Diagnostic fix deployed20261017-4, build5e93f5ae9110-c98b69767d91f405; hosted auth/AI/HL/Lighter checks pass. No bridge/Hummingbot restarts or exchange changes. Actual model switch/OK/question/custom answer/journal-follow-up verified in user Chrome; provider503 cannot be eliminated by app code. Commit/push authorized.

## Integrated discovery scanners
- [completed] Verified official HL/Lighter public data and Deribit BTC/ETH blockleg/overview APIs; documented units, exactsymbolscope, sampledcoverage and design. User explicitly requested options data too.
- [completed] Implemented public cached/coalesced scanner+options services, strict queries and source isolation. Verified fundingdirection/hourlyunits, midpointmarkgaps, BTCrelativepp, nativeOI/vol, realblockIDs/premiumunits, stale/partial/malformed guards. All283backendtests/rootTypeScript pass.
- [completed] Added /scanners navigation, workspacepane, fourcards/fullresults, filters, actual3previewcandles, exactvenue/nativecontract links, coveragewarnings and read-only scan_markets assistant tool. All4,058frontendtests/nativeTypeScript pass; no trading actions.
- [completed] All4,058frontend tests,283backend tests, native/root TypeScript and focused lint pass. Hosted six public feeds, desktop filters/fullreport scrolling/options overview and exactvenue link verified. Fixed preview registration, equalrate labels, bothleg volume filter, staleoptions/partialratios, HTML parsing and two text encoding issues. Mobile Discover entry added after narrowviewport exposed hidden desktop route; source frozen.
- [completed] Final production build11/11 passes; deployed20261017-6 with all six feeds,375markets/93comparisons/19sampledblocklegs and hosted session/AI/HL/Lighter checks passing. Desktop filters/scroll/links/options and390px mobile Discover entry/cards/back-navigation verified; no horizontal overflow. No account/trade/credential changes.
- [completed] Verified scanner implementation finalized for commit/push on codex/cointrade-integration; release and source limitations recorded above.

## Scanner assistant and native catalog follow-up
- [completed] Traced native-search generic routing and mismatched numeric limit contract. Read-only connected HL standard-perp value/withdrawable0, positions0; spot0.001512USDC, so scoped roundedzero accurate but global nofunds claim unsupported.
- [completed] Direct native catalog search plus labeled curatedname hints and strict bounded digit limits; scanner explicit raw24h/BTCrelative ranking and research-to-confirmation guidance; portfolio cache preservesaccountscope and unknownvszerostatus. Focused regressions pass; no execution changes.
- [completed] Compactcards andexpanded10/11column strength/arbitrage reports deployed20261018-1. All4,066frontendtests, finalTypeScript/lint and11taskbuild pass. Hosted sixfeeds/account/auth checks pass; desktopfilters/fullreports and390px mobile entry/tablecontainedscroll verified. ActualNanoGPT4readtoolsallpassed: native PRL/Cardano discovery, Lighterrawstrength andHLresearch numericlimit; noaccounttools/trades.
- [completed] Verified release finalized for commit/push; no server service restarts, account/credential/risk changes or trading actions. Source limitations and actual scoped HL zero documented.

## Scanner opportunity detail and arbitrage review
- [completed] Verify funding intervals/history APIs, TrueNorth reference, existing two-leg confirmation infrastructure and scanner detail constraints.
- [completed] Add bounded actual24h funding/history and strength detail data with honest projections/coverage and regressions.
- [completed] Implement distinctemblem, compactopportunityrows and richdetail charts plus one reviewed arbitrage action with exactaccountchecks.
- [completed] Verified 302 backend and 4,079 frontend tests, final TypeScript/lint and 11-task production build. Deployed 20261018-4; hosted sources/auth/account-read checks pass. Desktop units, signed mark-gap carry, funding and strength charts plus 390px mobile review verified. Browser QA found and fixed hourly timestamp alignment and missing assistant tool registration, with red/green regressions. Real NanoGPT get_scanner_detail read returned both venues with 24/24 samples and correct settled/scenario distinction. No live financial actions. Finalized for commit/push.

## Compact scanner experience
- [completed] Implemented bounded 620px detail panel, compact venue rows, Overview/History/Trade tabs, retained results/filter/scroll and reviewed inputs. Close/Escape restores focus; pending submissions block panel changes.
- [completed] 4,079 frontend tests, native TypeScript, lint and production build pass. Hosted 620px desktop panel preserves filters and inputs through keyboard tab/Escape/close/reopen; 390px mobile fits without overflow or nested dialogs, history and return navigation work. No prepare/confirm or financial actions during QA.
- [completed] Saved overlays and deployed UI-only release 20261018-5 with hosted read/auth checks; no service restarts. Finalized for commit/push.

## Home watchlist saved-row visibility
- [completed] Saved refs now own row existence, class/venue matching, reorder/removal and navigation. Missing metadata renders label-only Unavailable row with no quote/sparkline or cached price. XMR/class/native-venue regressions pass.
- [completed] 4,083 frontend tests, TypeScript, lint and 11-task build pass. Hosted Favorites(1) renders XMR-USDT Unavailable, while Top Crypto displays Bitcoin/Ethereum metadata and live quotes. Native-context discovery regression covered with real bundled catalog. No saved ticker content or financial actions changed.
- [completed] Deployed frontend-only 20261019-2 with hosted read/auth checks; services unchanged. Finalized for commit/push.
## NanoGPT trade setup reliability
- [completed] Traced provider startup exceptions and transient relay HTTP failures bypassing recovery; current model minimax/minimax-m2.7 verified without reading keys.
- [completed] Reproduced failing backend/frontend regressions; distinguished terminal relay failure markers, provider status and proxy errors.
- [completed] Implemented bounded startup/proxy recovery with same request/offset, safe diagnostic headers and terminal-stream no-replay guards.
- [completed] Atomic inference now withholds incomplete steps, retries unexposed drafts once and never replays completed tools; token-limited steps remain terminal. 20 relay regressions,4,105 frontend/355 backend/123 Python tests, TypeScript/lint and11-task build pass. Hosted20-3 and actual background-tab BTC/funding/TIA conversation pass with current MiniMax unchanged. Provider outages remain possible.

## Builder markets and LLM arena
- [completed] Verified official builder DEX indexes/collateral and scoped execution readiness/all-DEX order coverage. PAPER asset180038 was subsequently officially delisted; active catalog correctly excludes it. Hosted active USDC builder metadata/book/candles/connector mapping pass.
- [completed] Numeric research arguments accept bounded digit strings and numbers, reject invalid inputs; actual hosted Lighter BTC marketId funding tool passes.
- [completed] Exact builder catalogs/quotes/research, collateral-aware symbols, isolated-only controls and passive native execution readiness implemented. Non-USDC execution and unverified shared-mode builder TWAP collateral remain explicitly blocked.
- [completed] User chose paper first, configurable credit/loss rules, then future autonomous live on separate user-selected wallets. Current runtime is paper-only, scheduled with free risk checks and memory-only24h key lease.
- [completed] Paper runtime, budgets, independent portfolios, management/arena UI and21 lifecycle/accounting regressions implemented; no live execution dependency.
- [completed] Hosted paper hold evaluation passed with one call/about$0.0014 actual AI usage; paused/archived test bot, key cleared. Corrected real candle seconds-vs-milliseconds discrepancy with red/green realistic fixtures. Original paper release verified; subsequently expanded under LM Arena strategy work below.

## Celestia news coverage
- [completed] Fixed bare TIA/full-name/native-pair normalization and Celestia aliases; boundary checks avoid TIAA false matches. Feed source availability and publication window are explicit; zero configured RSS matches never establish no catalyst. Actual assistant returns coverage/unknown catalyst correctly. No invented cause for the historical price spike.

## Trading Agents live modes and critical relay follow-up
- [completed] Isolated inference20-5 and validated complete JSON transport20-6 deployed.32 focused/367 backend tests, staged TypeScript,123 Python tests and real SDK compatibility pass. MiMo SSE breaks72–80s and JSON stalls90s; authorized alternate MiniMax M2.7 activated through Intelligence settings, existing key/server-backed mode retained. Four real scanner/detail tools plus report complete without retry; model steps19.5/16.4/39.6s. Bridge/exchange services unchanged; no financial actions. Provider uptime/latency remain external constraints.
- [pending] Plugins-store configuration uses App Server defaults rather than the local ledger. Intelligence provider wizard reads the real saved configuration correctly. Verify stopped/read-only tool queue behavior before claiming all assistant lifecycle issues resolved.
- [completed] Add genuine Paper/Live agent mode, explicit account/revision binding and deterministic execution limits; passive account proof and mock Live execution QA only.
- [completed] Add conversational paused-agent drafts, compact LM Arena UI and meaningful error states. Actual assistant draft and mobile paused save/edit verified; no Live arming.
- [completed] Verify suites/types/build and hosted/browser behavior; no live financial QA actions. Final mobile Manage fix and authorized Git delivery tracked below.

## LM Arena strategy descriptions and market universes
- [completed] Define backward-compatible strategy/universe schema and regressions: single, watchlist or liquid venue catalog; bounded shortlist; exact selected instrument and one owned position per agent.
- [completed] Implement multi-market candidate reads, timeframe/cadence, deterministic eligibility and selected-position bookkeeping without widening execution authority.
- [completed] Native protected entry, owned close, fresh receipt resume/flat cleanup, account-start serialization, midnight loss baseline and full-size native protection checks implemented; mock execution only.
- [completed] Description-first LM Arena UI, editable conversational drafts, Paper/Live and native universe controls implemented. Actual assistant draft, paused save/edit, Live review without arming, desktop and390px mobile form/management controls verified.
- [completed] 388 backend,127 Python and4,116 frontend tests, strict types/focused lint and11-task production build pass. Hosted releases20261021-1/2 pass public/session/account/background-AI checks. QA agent archived; no Live bot or order started. Verified changes ready for authorized commit/push.

## Critical NanoGPT hostname routing
- [completed] Reproduced both MiniMax variants returning 503 after ~38s. Unauthenticated Hetzner POST to api.nano-gpt.com timed out after15s; documented nano-gpt.com endpoint returned401 in119ms. No credentials or paid requests used in the routing probe.
- [completed] Move worker, Arena, browser inference, catalog and research requests to the documented apex host; preserve exact legacy URL compatibility for cached server-backed clients. Host regressions reproduced before changes.
- [completed] 388 backend and 4,116 frontend tests, strict types, focused lint and 11-task production build pass. Deployed 20261021-1 after checking no retained assistant jobs. Actual MiniMax M2.7 scanner call and follow-up analysis succeed: first model step 4.2s, HTTP200; no orders prepared or sent. Original model restored from temporary Turbo test.
- [completed] Final LM Arena mobile QA found clipped inline Manage actions; replaced with existing portal menu and a reachable scrollable detail region. Final4,116 frontend tests/types/lint/build pass. Deployed frontend-only20261021-2 without service restarts; actual390px menu shows all actions, archived QA remains paused. Source finalized for authorized commit/push.

## Scanner comparison and report UX refresh
- [completed] Audit current scanner/review data and screenshot references; document compact comparison/review/report design and explicit quote/funding/coverage semantics.
- [completed] Implement venue-rate differences, compact paired review, tighter expanded reports and bounded real 1d/7d/30d history. Preserve exact native identities, gap coverage, projected vs settled funding and paired approval guards. Independently reviewed and corrected stale history labels and non-USDC price/volume formatting.
- [completed] 395 backend and4,119 frontend tests, strict types/focused lint and11-task production build pass. Deployed20261021-4 after initial startup-readiness502 rolled back21-3; deployment now waits for app health. Hosted1d/7d/30d Lighter histories verified. Desktop venue rates/net/APR/size estimates, compact review/preset/leverage/margin persistence and real30d partial coverage pass. Mobile390px review footer reachable;940px table contained in293px scroller with390px page width. No trade preparation/submission or account changes. Source finalized for authorized commit/push.

## Floating scanner review dialogs
- [completed] Review current panel lifecycle and design floating desktop/mobile dialogs preserving filters and review state.
- [completed] Replace scanner sidebar with accessible floating dialogs; preserve review state, suspend hidden polling, contain focus and guard busy submissions.
- [completed] 4,119 frontend tests, TypeScript, focused ESLint and 11-task production build pass. Deployed frontend-only 20261021-6; hosted checks pass without service restarts. Desktop/mobile floating geometry, retained filters/tabs/review inputs, keyboard focus, scrolling and backdrop checks pass. Reproduced and fixed mobile Escape closing the underlying Discover drawer; hosted retest preserves it. No trades prepared/submitted. Commit/push authorized.

## Assistant rejection and execution-claim audit
- [completed] Deployed safe diagnostics; actual retained135-message MiniMax chat reproduced HTTP400 context-length on no-tool Reply OK. Oversized history is confirmed current cause.
- [completed] Repaired incomplete/abandoned SDK tool history and confirmed context overflow with an 80k-character provider history budget including system instructions at every step. Added focused paginated workflow reads and safe diagnostics.
- [completed] Audited scheduler/UI semantics and corrected protection, stop-limit execution, historical run, monitoring and weighted R:R guidance.
- [completed] Backend 411 and frontend 4,143 tests, strict types, focused ESLint and 11-task production build pass. Deployed 20261021-9 after diagnostic release 21-8. The affected conversation recovers: plain OK, question card, and typed answer all HTTP 200 in 2�4 seconds; model history is bounded to 16�20 messages versus the prior 135-message context rejection. No trade preparation, submission, cancellation or run changes. Authorized commit/push finalized.

## Default trade research policy
- [completed] Audited scanner/news/market/account tools; defined bounded entry research with focused follow-up and direct urgent risk reduction.
- [completed] Added a single-read six-view scanner brief, default research checklist, and correct broad-news scope. Public research is separate from approval/execution; no context limits or trade safeguards changed.
- [completed] Full 4,150-test frontend suite and subsequent context/funding regressions pass. Strict TypeScript, focused ESLint and 11-task build pass; the final type-only annotation preserves identical runtime output. Deployed frontend-only 20261022-2 without service restarts. Hosted default research used the brief, news/web, histories, charts and book/tape; final one-brief check returned correct fundingPayer labels and explicitly unmeasured positioning. No trade preparation or execution in QA. Authorized commit/push finalized.

## Assistant context recovery
- [x] Inspect history budget and identify mandatory tool-batch overflow.
- [x] Add regression reproducing overflow with real-sized system context.
- [x] Adapt tool-result compaction to the mandatory context budget without mutating UI history.
- [x] Verify tests/types; use automatic compaction without a new global memory store.


## Bounded assistant answers and server capacity
- [x] Reproduce repeated-read loop and audit retained versus active request limits.
- [x] Add answer-finalization guard with tests; preserve trade confirmation stops.
- [x] Fix verified retained-job capacity mismatch with retention-safe tests.
- [x] Run verification and deploy safely; commit/push prepared.

- [x] Repair standalone asset fundamentals overview and verify source/freshness behavior.

Verification: 415 backend tests; 83 focused frontend tests; frontend/backend types, lint and production build pass. Hosted release 20261023-1 passes session, transport and exact Zcash profile checks. Combined frontend runner has pre-existing global browser-stub/module-loading issues; focused suites pass. No orders or bots started.

## Chart target, switching and drawing verification
- [x] Reproduce chart context mismatch and unavailable readback.
- [x] Fix assistant chart targeting and truthful drawing/state reads with regressions.
- [x] Fix chart switching/crash logic with regressions.
- [x] Verify, deploy safely, commit and push.

- [x] Provide a working chart renderer when WebGL2 is unavailable.
- [x] Repair DASH news identity matching and bounded catalyst research; verify coverage semantics.

Verified chart/news release 20261023-2: 418 backend and 54 focused frontend tests pass; frontend/backend TypeScript, focused lint and 11-task production build pass. Hosted ETH/LIT pair switching and DASH identity/coverage checks pass. Inference worker retained; no orders or bots executed. Compatibility mode preserves advanced drawings but renders candles and basic geometry only.

## Connector audit and assistant audit finalization
- [x] Reproduce broad audit with no final answer and identify execution boundary.
- [x] Audit connectors/feed reads with explicit coverage and bounded probes.
- [x] Fix verified causes with regression tests, then verify and ship.

Verification: release 20261024-1; 421 backend and 93 focused frontend tests pass, frontend/backend types, lint and 11-task build pass. Hosted sessions, transport authorization, news coverage and final bundle verified. Public read audit documented in docs/audits/2026-10-24-connectors.md; external HTTP403/config/platform limitations remain explicit. No financial actions or live provider requests. Inference worker unchanged.

## Full connector inventory and verification
- [x] Inventory every connector/provider and classify platform, credentials and enabled scope.
- [x] Verify CEX market-data routes, catalogs and streaming contracts.
- [x] Verify DEX, prediction, NFT, search and inference connector contracts.
- [x] Recheck news, calendars, fundamentals, Lighter/Hyperliquid and scanner runtime reads.
- [x] Repair reproduced application defects with regressions; record external/configuration blockers.
- [x] Run integration verification and deliver the complete connector matrix.

Full connector audit: 2,103 plugin tests pass/43 skip; 45 terminal tests pass; plugin types, focused lint and 11-task production build pass. Thirty public endpoint probes returned data plus hosted spot/perpetual/calendar/scanner checks. Three news sources remain HTTP403 and authenticated execution/paid providers are unverified. Deployed20261024-2 without service restarts. Detailed named matrix docs/audits/2026-10-24-full-connector-matrix.md. No trading or credential changes.

## Source-only assistant completion
- [x] Reproduce normal source-only completion below research limits.
- [x] Recover final analysis once without tools or repeated actions; preserve approvals/errors.
- [x] Verify and deploy, then commit/push.

Verified source-only recovery: 44 assistant/model-history/loop regressions plus 4 NanoGPT provider fixtures pass. Frontend and plugin types, focused lint and 11-task build pass. Deployed20261024-3 frontend-only; hosted session/transport/news/bundlechecks pass. One bounded text-only synthesis handles normal and budget-limited research without repeating actions. No live provider/test trade requests.
