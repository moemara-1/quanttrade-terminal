# Simplified native workflow sizing

User-approved meaning: total workflow margin, not gross notional. 200 USDC at 5x targets approximately 1000 USDC across all opening orders.

The native perpetual workflow ticket has four sizing controls: workflow, total margin, leverage and explicit cross/isolated. Account and buy/sell remain explicit context. Base input and gross execution reserve are derived read-only. Normal orders retain existing controls.

Sizing must reflect inherited graph percentages and venue rounding. Do not reinterpret trigger as an entry, rename or modify saved topology, enable OCO automatically, or replay old runs. Unsupported or ambiguous sizing must block with an actionable message. Root-linked exits and delayed entry timing remain visible in plan review.

The reserve includes all entries and protective exits, exchange price protection and a disclosed 10 percent movement allowance. It is not a withdrawal or margin deposit. Scheduled market execution remains price-dependent and can pause under the approved cap. Fees are excluded from estimated margin.

Verify arithmetic, branching/rounding/malformed graphs, TypeScript/lint/build, and hosted read-only guards. Deploy without submitting orders; preserve human approval and account/mode identity.
