# Scanner assistant and discovery follow-up — 2026-10-18

The owner wants compact, polished discovery cards with richer full reports and to research and prepare trades from the assistant. Reuse QuantTrade's existing dark green, dense trading interface and the original reference screenshots. Keep methodology and source coverage accessible in disclosures, make actual market metrics prominent, and preserve narrow-screen scrolling. No additional screenshots were attached to this follow-up, so use the established references rather than inventing a new design.

The assistant already registers scan_markets. Explicitly document it in capabilities and the research-to-confirmation process. Distinguish raw 24-hour gainers/losers from BTC-relative percentage-point strength. A scanner result supplies the exact venue/native pair for fresh market, account, precision and risk checks; it never authorizes execution or proves an opportunity. Existing human-confirmed native order preparation remains the only trading path.

Native instrument discovery must query the requested venue catalog and retain identity, coverage and ambiguity. Match verified full names when available; never infer that similarly spelled tickers identify the same asset. Correct the numeric limit contract at the actual tool boundary rather than asking the model to repeat failing arguments.

Read-only hosted inspection returned zero Hyperliquid standard-perp account value and no positions. Fix overbroad conclusions and cached portfolio scope, not real exchange funds. Cached empty data is unknown. Preserve account/market/source identity and require fresh exact-account reads before sizing. Do not transfer funds, reconnect keys or substitute another venue.

Verification: regressions for ranking/search/limits/portfolio scope, full frontend suite, backend checks if changed, TypeScript/lint, production build, hosted read-only source/account checks and desktop/mobile visual review. No live orders, cancellations, credential changes or risk changes during verification.
