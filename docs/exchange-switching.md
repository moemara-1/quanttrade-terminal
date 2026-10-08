# Exchange switching

The existing venue picker resolves Hyperliquid and Lighter against their public spot/perpetual catalogs. Switching BTC from Binance/Bybit USDT to a listed USDC contract updates both native pair ID and venue. The destination symbol is shown in the picker. Loading, unlisted and uncertain catalog states remain distinct; no unsupported contract is synthesized. Reverse CEX switches initialize public market tables if missing, then choose a real listed instrument, preferring the current quote.

Chart routes, global dashboard selections, pinned panes and bound variables use the same catalog target. Exact base identity is preserved: PEPE does not become1000PEPE. Spot and perpetual controls remain separate. Query formats BTCUSDT, BTC/USDT, BTC-USDT-USDT and common asset names find actual native rows; search aliases never rewrite executable order IDs.

The multi-venue arbitrage price comparison still requires the same quote currency. USDT and USDC prices are not silently treated as equivalent in spread or execution arithmetic.
