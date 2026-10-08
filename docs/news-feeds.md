# Standalone news feed

QuantTrade serves the existing Pairlens `/api/news` response using public publisher RSS feeds: CoinDesk (https://www.coindesk.com/arc/outboundfeeds/rss), Cointelegraph (https://cointelegraph.com/rss) and MarketWatch (https://feeds.content.dowjones.io/public/rss/mw_topstories). Only headlines, publication times, publisher attribution and original article links are displayed; article bodies are not copied.

Downloads use fixed HTTPS destinations, 12-second timeouts, two-megabyte stream limits and a two-minute shared cache. Unsafe XML entity declarations and unsafe/non-publisher links are rejected. A surviving source can supply the feed; total source failure returns the native news_unavailable error. Available feed history is limited to publishers' current RSS windows, not a historical archive. Tickery metadata and macro/earnings topic tags use conservative headline keyword matching; neutral sentiment fields mean no sentiment analysis is supplied. Crypto BTC+ETH scope selects the crypto wire, including other token headlines.

The four public data routes bypass the generic missing-cloud response but retain bridge host/origin guards, bounded request concurrency/rate limits and no execution access. Other unavailable private cloud services continue to return503 without browser Basic challenges.
