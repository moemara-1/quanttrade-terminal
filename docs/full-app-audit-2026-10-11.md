# QuantTrade full app audit — 11 October 2026

Scope: navigation and chart ownership, desktop/mobile trading controls, sliders, Hyperliquid/Lighter connectors, assistant approvals, authenticated sessions, localization, public data assets and server execution boundaries. Checks use source inspection, deterministic mock tests and read-only hosted HTTP. Browser automation was unavailable; no live orders were submitted, cancelled or resumed.

## Confirmed defects repaired

- P1: mobile venue changes retained the previous venue instrument instead of using the resolved destination listing.
- P1: a pane with a timeframe override could stream its persisted venue rather than the resolved global pair venue.
- P1: assistant chart services remained bound to the last mounted chart rather than the focused chart.
- P1: desktop/mobile percentage sizing could round above available funds and violate quantity precision; exact BigInt floor sizing replaces float rounding.
- P1: kill switch, live-mode or credential changes during asynchronous approval could escape the initial authorization check. Authorization is rechecked after market reads; account mutations reject while reconnecting.
- P1: temporarily missing Hyperliquid fill history incorrectly became a permanent failure. Missing evidence remains pending; authoritative failures and excess size remain failures. No entry replay.
- P2: Follow board cleared a visible override but retained a hidden variable binding; both owners now clear explicitly. Intentional pins remain supported.
- P2: a bound chart timeframe could not be changed from its toolbar; changes now reach the owning variable or override.
- P2: HTML gateway responses produced opaque JSON errors; actionable errors require exchange inspection before retrying uncertain mutations.
- P2: shared slider labels missed the actual interactive thumbs. Amount, limit price and preset controls now carry accessible names.
- P2: missing provider and liquidation coverage catalog entries broke locale parity. Updated data copy uses English fallback where translations are not yet available; obsolete automatic-approval copy was removed.
- P2: an early spotlight expiry callback could permanently leave a highlight active. The owned request now schedules the remaining delay and cannot clear a newer request.

## Test quality repairs

Windows path separators and CRLF no longer invalidate source guards. Asset guards resolve versioned URLs to file paths. Storage quota tests own an enumerable localStorage fixture and restore the previous surface. Approval guards test the current explicit-confirmation path rather than removed source strings. No failing tests were deleted.

## Verification

3,894 terminal tests, 160 backend tests and 76 signer tests pass. Native/root TypeScript and changed-file lint are checked separately. Production build and all hosted guards pass. Active release: 20261011-1, build 5e93f5ae9110-7523c7c29a29594e. Readiness now precedes private connection verification after signer restart.

## Remaining limits

Actual contrast, touch-target measurements, keyboard traversal, mobile scroll and live venue fills are not certified by source/HTTP checks. Compact desktop preset targets merit a visual pass. Old paused or uncertain trade plans remain paused and must not be replayed. Advanced order expansion is a separate tracked task and is not represented as completed by this audit.
