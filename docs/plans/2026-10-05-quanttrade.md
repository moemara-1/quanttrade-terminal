# QuantTrade single terminal

QuantTrade adapts the complete pinned Pairlens monorepo in `upstream/pairlens`. Charts, discovery, workspaces, trading tickets, the assistant, strategy/workflow infrastructure, plugins, and desktop source remain available. Hosted upstream services require their own access. Public-facing terminal branding is QuantTrade; package identifiers and license attribution remain compatible with upstream.

The only local user interface is the native terminal on `127.0.0.1:4317`. The Node bridge on `127.0.0.1:4318` provides public exchange readers, immutable order proposals, persistent approval/audit records, notional limits, and a restricted Hummingbot API client. Its root redirects to the native terminal. The former `src/client` prototype is inactive.

Native Hyperliquid and Lighter plugins expose public perpetual discovery, candles, ticker and order books. Native derivative symbols such as `BTC-USDC-USDC` map to the bridge's `BTC-USDC`; the Hyperliquid Hummingbot connector further maps its quote alias to `BTC-USD`. Credential slots contain the local bridge operator token and their selected mode. Live mode must agree with the backend.

Manual tickets and assistant confirmation cards use the attended order route. Each native confirmation has a durable request key bound to exact parameters. Automated bots, workflows, and assistant standing consent cannot place orders on these venues. External agents receive the separate proposal-only token and submit unapproved drafts. The native Agent Inbox reviews, approves, rejects, and requests cancellation. Tokens in the Inbox stay in panel memory.

Hummingbot owns wallet/exchange signing credentials. The bridge owns its fixed account and local service authentication. Live orders currently support non-reduce-only limit orders; these can reduce or reverse existing positions. Unsupported leverage, reduce-only and trigger controls fail explicitly. Paper limit orders remain open without an automatic matching engine. Live submission/cancellation acknowledgements are not proof of fills or cancellation.

Live positions and active orders come from paginated Hummingbot reads. Missing records never imply a fill or cancellation; the upstream service can omit a connector when its read fails. Orders placed outside QuantTrade are visible but cancellation is handled at the exchange/Hummingbot. Historical fill reconciliation and desktop packaging are not verified by this web-terminal delivery.

`Start-QuantTrade.ps1` starts hidden local processes and checks service identity before reusing ports. Both old launchers call it. The saved patch plus added-file overlay reproduce the native changes on a fresh pinned checkout. No commits were made.
