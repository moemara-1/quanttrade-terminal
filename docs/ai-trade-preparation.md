# AI trade preparation

Hummingbot is the exchange execution service. QuantTrade's Assistant and your selected AI provider do the research and prepare orders. Hummingbot submits Hyperliquid and Lighter orders after you approve them; other connected exchanges use their standard terminal plugins.

1. Connect the exchange in Accounts, selecting Live if you intend to use real funds.
2. In Plugins, configure and enable NanoGPT (or another AI inference provider) with your own key and a model that supports tool calling. Native Assistant settings do not configure the separate server agent.
3. Select the exact exchange and instrument. Open the Assistant orb, or press Ctrl+J / Ctrl+/ on Windows.
4. Ask for an order draft. Supply side, size or budget, order type and any price, leverage or margin preference. The assistant should read balances, risk limits and current market minimums before preparing an exact order. If your request is incomplete, ask it to clarify. Leverage changes require an explicit Cross or Isolated margin choice; the assistant must not default to Cross.
5. Review the confirmation card's venue, pair, size, price, flags and mode. Choose Live explicitly to trade real funds, then confirm using the displayed gesture. Every AI order requires fresh confirmation, including CEX orders and paper orders. Previous standing consent is ignored. Manual tickets still submit directly.

Example: "Prepare a Lighter STRK perpetual long limit order with a maximum 50 USDC position notional at [my limit price], 2x cross leverage. Read my balance and the market's precision, minimums and leverage limit. Calculate an exact valid base size within that budget, or explain why it cannot meet the minimum. Show the order for my approval; do not submit."

Replace the bracketed price before sending. Position notional is distinct from margin: 50 USDC notional at 2x implies roughly 25 USDC margin before fees and venue requirements. This is an example of instructions, not a recommendation to trade STRK.

SL/TP requests should produce separate reduce-only protective proposals against a verified position. Do not assume entry and exits are an atomic bracket or OCO group. Each proposal needs review; an acknowledged order is not proof of a fill.

The Assistant requires an unambiguous credential matching the exact exchange and mode. If several Live accounts match, it refuses execution; use the manual ticket's account selector or keep one matching connected account. Per-card account selection is not yet available. Hyperliquid/Lighter use the bridge's configured account.

## External agents and Agent Inbox

The Agent Inbox reviews external proposal-only agent drafts for Hyperliquid and Lighter. It is separate from the native Assistant's confirmation cards. External agents use the scoped proposal token, never operator credentials, exchange secrets or direct Hummingbot access. Server-side `/api/agent` uses server `AGENT_BASE_URL`, `AGENT_MODEL` and optional `AGENT_API_KEY`; configuring NanoGPT in the browser does not configure this endpoint. The server model path currently supports Hyperliquid and Lighter only.

No order is sent by merely opening the Assistant or asking it to prepare a trade. Fresh proposals expire after three minutes; prepare a new draft after expiry and inspect exchange status before retrying an uncertain submission.
