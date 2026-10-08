# QuantTrade on Hetzner

Updated 7 October 2026 to `azure-prod-02` (`167.233.56.222`). QuantTrade uses the complete Pairlens terminal source and the QuantTrade overlay. Release: `/opt/quanttrade/releases/20261007-4`; active symlink: `/opt/quanttrade/current`.

## Open the terminal

Open https://quanttrade.azurestore.shop/futures . HTTPS and a separate web login protect the terminal. Your login is saved locally in `data/deployment/quanttrade-login.json`. No SSH tunnel is needed for this address. The private tunnel remains available as a fallback.

The hosted wizard and Agent Inbox use your web login automatically. Select Hyperliquid or Lighter in Connect Exchange, choose Paper or Live and supply the actual venue credentials. These signing keys are encrypted in Hummingbot on Hetzner and are not stored in the browser. Manual Live market and limit orders submit directly from the normal order ticket; only AI-prepared trades require the approval inbox. To use the private tunnel fallback after a restart, run `./Connect-QuantTrade.ps1` and keep its window open. Operator tokens remain available for API/development access; give external agents only the distinct agent token.

The public domain now resolves to the server. Its dedicated Nginx virtual host uses a valid Let's Encrypt certificate and automatic renewal. The bridge allows exactly `https://quanttrade.azurestore.shop` alongside its private localhost origins. API approval requires the operator token even after web login; agents retain proposal-only authority.

## Running services

- Nginx static terminal: `127.0.0.1:4317`, SPA fallback `/_shell.html`.
- `quanttrade-bridge.service`: unprivileged Node24 process on `127.0.0.1:4318`, proxied through `/_quanttrade/`.
- `quanttrade-hummingbot-api`: authenticated official Hummingbot API on `127.0.0.1:8000`.
- Dedicated Postgres and authenticated EMQX containers; existing server databases remain separate.

All services restart automatically. Bridge SQLite state and role tokens persist in `/opt/quanttrade/shared/data`. Hummingbot account configuration persists in `/opt/quanttrade/hummingbot/bots`. Service passwords were generated on the server and are not included in source or deployment archives. The official API image is pinned to `hummingbot/hummingbot-api@sha256:b6dce799ff5d46be848c0f6baa36d73c6834460ba9ef9794066e93dca7bb2519`.

## Remaining account setup

The Hummingbot service is running, the `hyperliquid`, `lighter`, `hyperliquid_perpetual` and `lighter_perpetual` connectors are available, and the bridge account `desk` exists. No user exchange signing credentials were supplied during implementation. The default is Paper; the hosted wizard can select Live independently for each exchange after verifying its keys. A configured API connection alone does not prove live order execution.

For private account administration, close the existing tunnel and run `./Connect-QuantTrade.ps1 -Hummingbot`. Hummingbot's API documentation then opens at http://127.0.0.1:8000/docs . Authentication values live in the server-only `/opt/quanttrade/hummingbot/.env`; access them privately through SSH, never paste them into chat or commit them. Configure each venue under account `desk` using its connector credential endpoint. No exchange secrets have been requested or transmitted during deployment.

No ChatGPT account connector has been registered. In Set up your own AI, NanoGPT is available alongside the existing providers. Paste your NanoGPT API key and set a model ID from its catalog; requests go directly from your browser to https://api.nano-gpt.com/api/v1. Model tool support depends on the chosen model. Connecting a model does not enable unattended trading. External agents can prepare structured proposals using the agent token and bridge API; the native terminal supports its existing BYOK assistant. AI trades require explicit approval, while manual orders execute from the standard order ticket. The terminal supports spot and perpetual market/limit orders, post-only limits, perpetual reduce-only closes, leverage/margin controls, isolated collateral changes, native order cancellation/amendment, order history and fills. Native stop-loss/take-profit controls are available for perpetual markets; spot conditional orders remain disabled until their venue behavior is verified. Market orders carry explicit exchange-side protection prices. Quote-sized spot buys convert using exact decimal arithmetic and a protected buy budget; fees are additional. Reconnect an existing perpetual-only connection to add its paired spot connector using the same credentials.

## Verification

The native production build passed locally. All 60 backend tests and 49 mocked extension tests passed on Hetzner with the installed Hummingbot dependencies. Hosted verification passed for the SPA shell and referenced assets, paper mode, unauthenticated denial, hostile-origin denial, both public exchange feeds, and agent proposal creation followed by operator rejection without execution. Agent attempts to approve those proposals returned 403. Hummingbot authenticated readiness confirmed all four connectors. Hosted read-only checks verified 178 Hyperliquid perpetuals, 317 Hyperliquid spot markets, 196 Lighter perpetuals and 10 Lighter spot markets, plus books/candles for each catalog. All eight private extension routes require authentication. Six HTTPS assets, including the largest JavaScript bundle, match the deployed files. Existing domains returned HTTP 200, with the protected Watchtower domain returning HTTP 401.

Windows browser automation was denied for both Chrome and the Codex window, so an interactive browser smoke test remains unverified. No live-money orders were submitted. Repeat read-only hosted checks with `python3 /opt/quanttrade/current/deployment/verify-public.py`, `verify-login.py` and `verify-trading.py`. These scripts do not execute trades. The older verify-host.py script assumes Paper mode and should not be used after enabling Live.

Inspect services with `systemctl status quanttrade-bridge`, `journalctl -u quanttrade-bridge`, and `docker ps`. Deployment scripts are under `deployment/`. Docker was installed from its [official Ubuntu repository](https://docs.docker.com/engine/install/ubuntu/); no general system upgrade was performed.

Public HTTPS verification and the certificate renewal dry-run passed on 6 October 2026. Local web login file permissions are restricted to the current Windows user and SYSTEM.

Release verification: 60 backend tests, 102 native connector/provider tests, 7 NanoGPT/SDK tests and 49 Python extension tests passed locally. Native TypeScript, targeted lint and the production build passed. Exchange execution was tested with mocks, never with funded live orders.

Provider suite release verified on 7 October 2026: official Hyperliquid/Lighter/NanoGPT logos, searchable NanoGPT model catalog, research/account tools, and explicit approval cards for AI-prepared trade operations. HTTPS assets match release files, both public research feeds return current data, and all four market catalogs plus books/candles pass. No real trades placed. See provider-research.md for unsupported advanced execution and wallet features.

News and schedules restored in backend-only release20261007-3. Existing frontend artifact reused without visual changes. HTTPS live checks: news/crypto headlines, 35 earnings this week, 2 IPOs, 16 BLS/BEA macro events in31days. See news-feeds.md and calendar-feeds.md for sources and coverage limitations. All80backendtests pass onhost, login/approval checks pass.

Exchange compatibility release20261007-4: catalog-backed native pair switching across charts/dashboard/pinned panes/variables, cold CEX catalog loading, and familiar ticker-query formats.80focusedterminaltests, TypeScript/lint/build pass;80backendtests pass onhost, shell/referencedasset delivery andallfourmarketfeeds verified. No liveorders submitted. See exchange-switching.md.
