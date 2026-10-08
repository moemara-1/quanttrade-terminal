# QuantTrade calendar feeds

The hosted bridge serves the existing Pairlens earnings-calendar, ipo-calendar, and economic-calendar contracts. Browser exchange keys are not involved.

Earnings use Nasdaq's public daily calendar. Explicit before/after-market slots and EPS estimates are preserved. A fiscal quarter month is not converted into an invented fiscal period end. The optional symbols filter takes comma-separated tickers.

IPOs use Nasdaq's public monthly calendar. Only upcoming IPOs with an explicit expected date are included; filed, priced, and withdrawn entries are not repurposed as upcoming listings. A published expected date is not a listing guarantee.

The US macro schedule compiles official BLS and BEA iCalendar feeds. Dates and release instants follow the actual calendar, including US Eastern daylight saving. Only explicitly published clock times are displayed. Importance is a local classification of release series. No consensus, actual, prior, or market-implied values are fabricated. Fed and Census schedules are not yet included.

Queries cover inclusive windows of 1–92 days. Earnings default to seven days, IPOs to 92, and macro to 14. Today means the US Eastern calendar date. Earnings allow an explicit ISO start date.

Fixed upstream URLs, 20-second request timeouts, 2 MB streamed response limits, 15-minute per-source caches, coalesced duplicate requests, bounded cache size, and four concurrent daily earnings fetches protect the service. Failed HTTP requests are not cached as empty calendars. Macro partial availability is disclosed in sources.available and sources.unavailable; total failure is an unavailable error. No paid API key is needed, but public feeds can impose access limits or change their schema.

Sources:

- https://api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD
- https://api.nasdaq.com/api/ipo/calendar?date=YYYY-MM
- https://www.bls.gov/schedule/news_release/bls.ics
- https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics
