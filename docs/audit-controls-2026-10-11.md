# QuantTrade trading controls audit — 11 October 2026

Scope: native desktop/mobile trading controls, balance sizing, leverage/margin drafts, keyboard names, reset behavior and actionable rejection messages. Static source inspection and deterministic regression tests; no live order or visual browser audit.

## Findings

- **P1 fixed — percentage sizing could round above the account balance.** Desktop `computeSellSize` and mobile `scaleAmount` used `parseFloat` and `toFixed(8)`. Example: a 100% selection of 0.000000009 became 0.00000001, exceeding available funds. Native spot quantity precision was also ignored. Both now use a shared BigInt percentage calculation, floor to the contract's quantity precision and preserve exact decimals. No user-entered amount is silently adjusted.
- **P2 fixed — trading inputs and percentage slider lacked accessible names.** The desktop ordinary amount and limit-price inputs now have explicit labels; preset settings icons are named. The shared Slider forwards label attributes to each interactive thumb, where Base UI actually consumes them, rather than naming only the root container. Keyboard behavior remains delegated to Base UI (arrows, Home/End and Page Up/Down).
- **P2 remaining — desktop percentage/leverage preset buttons are compact.** Existing tiny desktop targets merit a visual touch-target pass. This audit does not certify 44px hit boxes, measured contrast, narrow viewport scroll behavior, screen-reader announcements or actual browser focus traversal.

## Controls retained and verified by inspection

- Native leverage ceilings come from the exact contract rather than a generic 125x ceiling; unknown metadata disables explicit leverage application.
- Draft leverage/margin are attached only after deliberate choice. Reduce-only orders preserve exchange leverage and do not open opposite exposure.
- Draft pair/account resets clear old amount, price, leverage intent and post-only state. Each ticket is keyed by venue, pair and selected account.
- Native decimal precision, size minima, notional minima and selected available funds participate in submission validation. Disabled submission hints expose validation errors rather than only showing a generic confirmation prompt.
- Balances are isolated by venue/account; missing account selection does not merge funds from other exchanges.
- Native liquidation price is not fabricated from a generic maintenance rate.

## Technical score (source-only; visual categories provisional)

| Dimension | Score | Evidence / limitation |
| --- | --- | --- |
| Accessibility | 3/4 | Named primary fields and slider thumbs; browser traversal unverified |
| Performance | 3/4 | Pure bounded decimal sizing, memoized ticket and rate-limited quote sampler |
| Responsive | 2/4 | Separate mobile controls; desktop targets and narrow scroll unmeasured |
| Theming | 3/4 | Existing token-based dark interface retained; contrast unmeasured |
| Anti-patterns | 3/4 | No redesign or decorative elements added |
| Total | 14/20 | Good by source review; not a visual certification |

Regression: `apps/terminal/src/lib/__tests__/trading-scope.test.ts` covers available-funds isolation, all account/venue combinations, per-contract leverage, minimum/precision rules and new percentage rounding cases. Exact cases include 9.999 at two decimals, sub-tick balances and amounts beyond JavaScript's safe integer range. Follow-up: visual /adapt then /polish for desktop hit targets and scroll verification.
