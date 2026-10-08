# CoinTrade

One terminal, built from the complete [Pairlens trading-terminal monorepo](https://github.com/Pairlens/trading-terminal), with a local [Hummingbot](https://github.com/hummingbot/hummingbot) / [Hummingbot API](https://github.com/hummingbot/hummingbot-api) bridge for Hyperliquid and Lighter. The original charting, workspaces, assistant, plugin system, strategy/workflow infrastructure, desktop project, and other upstream packages remain in `upstream/pairlens`. CoinTrade is a local adaptation, not an official Pairlens release. Hosted Pairlens services still require their own access and are not supplied by this local installation.

## Start the single terminal

Requires Windows, Node.js 24+, Git, and internet access for the first installation and market data.

```powershell
.\Start-CoinTrade.ps1
```

Open **http://127.0.0.1:4317**. The launcher starts the bridge on loopback port 4318 and the native terminal on port 4317 in hidden processes. It reuses healthy existing services and stores new process output in `data/logs`. Both legacy launchers now start this same terminal. The old `src/client` prototype is retained as inactive source; it is not the CoinTrade application.

The hosted terminal is [quanttrade.azurestore.shop](https://quanttrade.azurestore.shop/futures). Use **Connect Exchange**, select Hyperliquid or Lighter, choose Paper or Live, and enter the actual venue credentials. Hosted web login establishes the operator session automatically; no operator token belongs in these exchange fields. Each venue's mode persists independently on the server. Local operator tokens remain available for development/API access.

## Hummingbot connection

1. Start Docker Desktop and deploy the pinned Hummingbot API from `upstream/hummingbot-api`, following that project's setup instructions. The CoinTrade launcher does not start Docker or Hummingbot for you.
2. In the hosted Connect Exchange wizard, enter the approved Hyperliquid API wallet address/key or Lighter account address, key index, API private key and tier. The bridge verifies authorization and stores signing keys encrypted in Hummingbot account `desk`; browser connection metadata contains no signing keys.
3. Copy `.env.example` to `.env`. Set the local `HUMMINGBOT_URL`, API Basic-auth username/password, and `HUMMINGBOT_ACCOUNT`. These API service credentials stay in the backend.
4. Paper is the default. Select Live in the hosted connection wizard for real manual limit orders. Manual order submission executes directly through the normal order ticket; AI-prepared orders remain pending until the user approves. Existing risk limits and ambiguous-submission protections remain active. No second bridge process or manual service restart is required to select a venue mode.

Live execution currently accepts **limit orders only**. Approval does not guarantee a fill. Unknown submission results require exchange/account reconciliation and must not be blindly retried. Paper limit orders remain open until cancelled; this implementation has no simulated matching engine. Paper market fills use the reference quote without simulated fees or slippage.

Native live positions and active orders use Hummingbot account reads. Historical fill reconciliation is not implemented; missing orders never imply that they filled or cancelled. Orders placed outside CoinTrade require cancellation through the exchange or Hummingbot. See `docs/verification.md` for checks and runtime limitations.

Hummingbot live execution still requires a running service and configured accounts. No live-money execution is claimed as tested by this project setup.

## Agents prepare; you approve

The native assistant remains part of CoinTrade. Configure its model provider in the terminal. AI-prepared Hyperliquid/Lighter trades require human approval; manual trades execute from the order ticket without an additional inbox approval. Unattended strategy execution and standing agent approval are not enabled for these connectors.

External agents can call the local bridge using the separate token in `data/agent-token`. Give agents **only that token**, never `data/operator-token`. Their proposals appear for human review in CoinTrade. The agent token cannot approve, cancel, reject, or change the trading halt.

Open a perpetual market in CoinTrade and use the **Agent Inbox** tab beneath the chart. Hosted access uses the web session automatically; a manual operator token remains a local development fallback. Existing saved workspaces can add **Agent Inbox** using the terminal's pane picker. Approve, reject, and request cancellation there. The native assistant's trade cards also require confirmation on these two venues.

Example request (replace the example token locally; prices and amounts are illustrative):

```http
POST http://127.0.0.1:4318/api/proposals
Authorization: Bearer <agent-token>
Content-Type: application/json

{"venue":"hyperliquid","symbol":"BTC-USDC","side":"buy","type":"limit","size":"0.001","price":"60000","rationale":"Example proposal for human review"}
```

Use fresh market data from `GET /api/public/markets?venue=hyperliquid` or `venue=lighter` to construct valid proposals. The bridge validates size, precision, market limits, proposal expiry, price deviation, and daily notional reservations again at approval. The native terminal uses derivative symbols such as `BTC-USDC-USDC`; the bridge API uses `BTC-USDC`.

Optional `AGENT_BASE_URL`, `AGENT_API_KEY`, and `AGENT_MODEL` configure the bridge's separate proposal-generation endpoint. They do not give a model execution authority. Local access tokens, `.env`, and the SQLite audit/proposal store in `data` must remain private.

## Development and upstream infrastructure

```powershell
npm test
npm run typecheck
npm run build
```

The root TypeScript check covers the bridge and tests. `npm run build` also builds the actual native terminal with Bun using the upstream `build:terminal` pipeline. The entire upstream repository remains available for its own workspace commands; its package names and internal import identifiers remain `@pairlens/*` for compatibility. The root lock file pins the fetched Git revisions. Do not discard local upstream changes when updating.

CoinTrade modifications are saved in `patches/quanttrade.patch` and `overlays/pairlens`. `scripts/fetch-upstreams.ps1` reapplies them to a fresh pinned checkout and preserves existing local work. After developing changes in the upstream checkout, run `node scripts/save-quanttrade-overlay.mjs` to refresh this reproducible overlay.

Pairlens license and attribution notices remain in the upstream repository (FSL-1.1-Apache-2.0). Hummingbot core is Apache-2.0 and Hummingbot API is MIT; consult each checkout's license before redistribution or hosted use.


## Hosted device sync

The protected CoinTrade terminal synchronizes display preferences, chart setup, layouts, workspace variables and watchlists between authorized devices. Devices share the same operator settings profile. Domain switches in Settings control what this device sends and receives. Exchange credentials, wallet keys, publisher trust settings, automation and assistant conversations are excluded. Existing local storage remains compatible. Hosted sync requires HTTPS; localhost keeps local persistence.

Pair pickers support venue and spot/perpetual filters, exact venue labels and familiar ticker formats. Show more keeps remaining results reachable while limiting initial rendering. Pair selections retain the result venue in charts, panes and workspace variables.
