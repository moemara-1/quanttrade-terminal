# Calendar panel transport repair

QuantTrade already serves earnings, IPO and macro calendars from its bridge. The terminal's shared fundamentals helper rejected standalone builds before requesting those feeds, so working backend schedules never reached the panels.

The three calendar methods now use same-origin bridge routes when there is no Pairlens App Server. App Server deployments keep their existing URL. Unsupported company and insider providers still report unavailable. Provider errors retain their distinction from genuinely empty calendar windows.

Local development proxies the same three routes to the bridge. Regression tests exercise the public API methods used by the hooks, including window and watchlist parameters, rate limits, upstream failures and absent providers. Hosted verification checks real entries and the published client build identity without placing trades.
