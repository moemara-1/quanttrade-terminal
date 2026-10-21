# Floating scanner dialogs

Replace the scanner opportunity sidebar and inline expanded reports with centered floating cards, following the user's reference screenshots. Keep discovery visible behind a restrained backdrop. Review uses a compact card; full reports use a wider card with their existing tabs, charts and tables. Mobile uses a near-viewport card with a bounded scroll region and reachable actions.

Preserve the current filters, discovery/report scroll, selected market and review input/plan state when closing/reopening the same opportunity. Only one modal surface is active: opening an opportunity from a report suspends the report and closing the opportunity restores it. Use the established dialog primitives for focus trapping, accessible labels, Escape and backdrop behavior. In-flight preparation/confirmation blocks all dismissal and market switching. Do not change execution or data contracts.

Verification covers dialog geometry, visible backdrop, unchanged background width, report-to-review-to-report navigation, filters and review inputs, keyboard focus/Escape, mobile scrolling and lack of page overflow. Existing suites/types/lint/build and hosted checks remain required. No trade requests during browser QA.
