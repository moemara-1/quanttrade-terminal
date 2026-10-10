# Workflow ticket audit — 2026-10-10

Scope: the manual trading ticket, workflow inputs, disabled Run conditions, graph review, and the authenticated workflow submission path. This is a code and offline-test audit. Browser visual measurements and real exchange execution are not included.

## Confirmed findings

| Severity | Finding | Effect | Resolution |
| --- | --- | --- | --- |
| P1 | Required budget looked like a small muted text row, without an associated visible label or field-local explanation. | Amount in GRAM was mistaken for the independent quote-notional budget; Run remained disabled. | Use the existing visible input component, required currency label, and local validation. |
| P1 | Several submission gates had no visible explanation. | Missing account, disconnected connector, unsupported nodes, invalid size or leverage could leave the button disabled without an actionable reason. | Derive the button state and displayed reasons from the same blocker list. |
| P1 | Native graph errors were discovered only after submitting. | Invalid node configuration, unreachable nodes, cycles or invalid OCO grouping failed late. | Review the graph before enabling Run and display the validation reason. |
| P1 | Lighter's OCO explanation assumed protective nodes followed an entry. | Trigger-connected exits could be mistaken for protection of later DCA entries. | Explain the actual graph ancestry and whether OCO is selected; preserve saved connections. |
| P1 | Budget and OCO approval choices survived changes to the pair or account. | A previous cap or grouping could be applied to a different trading context. | Clear budget and OCO choices when the account, pair or workflow selection changes. |
| P2 | Budget explanation omitted protective exit orders. | A budget sufficient for entries could be exhausted when protective orders were submitted. | Explain that the current server accounts for gross order notional, including exits, rather than margin. |

## Required behavior

The workflow budget remains a deliberate user value. Amount, available collateral, leverage and estimated initial margin do not automatically populate it. For example, 99 GRAM is the workflow input amount; a 100% order uses that input. The budget is a separate quote-currency cap for the complete run, including exit orders. Prices and dynamic branches can change actual consumption, so a quoted estimate cannot guarantee all future steps will fit.

An existing-position protective graph remains valid where the venue supports it. A trigger-root exit does not become a child of a future entry automatically. For the pasted GRAM plan, buys wait two hours each, while trigger-connected exits can submit before those buys. The UI must state that distinction without reconstructing or executing guessed trade terms.

Manual submission retains the configured click or hold gesture. AI proposals retain one explicit chat confirmation and do not require a second manual workflow action. Registering a plan is not evidence that scheduled orders have filled.

## UI quality assessment

Accessibility: associated labels, invalid state and visible error explanations are checked in code; browser contrast and screen-reader behavior remain unmeasured. Performance: validation is local and introduces no provider or exchange requests. Theming: existing input, foreground, border, focus and destructive tokens are reused. Responsiveness: the ticket already owns vertical scrolling and inputs use available width; physical device testing remains unperformed. Anti-patterns: remove duplicated hidden gating, retain the existing terminal design, and avoid inventing defaults for financial inputs.

## Verification boundaries

Offline regression tests cover numeric budget validation, graph configuration and topology, protective review text, and the approval transport: 21 tests and 59 assertions pass. An independent review verified submission-gate parity and the context reset. Full TypeScript, lint, production build and hosted regression guards are required before release. No live order, workflow run or paid model request is used to verify this change. Existing saved workflows and user settings are preserved.

Release validation: final terminal TypeScript, changed-file ESLint and production build passed. Hetzner release 20261010-3 is active; 126 backend tests and all hosted login, authorization, feed, catalog, leverage, sync, frontend and workflow guards passed. The malformed-graph transport regression was observed failing without preflight and passing with it. No browser interaction or real execution was used.
