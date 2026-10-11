# Bundled advanced protection

One immutable approval can include a native Hyperliquid TWAP or managed Lighter/Hyperliquid Chase entry, exact stop-loss and take-profit allocations totaling 100%, and a separate gross exit submission cap. Entry and exit budgets include risk validation; neither is a margin deposit. Existing positions are excluded.

Native TWAP protection activates only after exact full approved entry fills. Partial fills remain unprotected: the public fill interface does not provide reliable owned terminal cancellation proof. This is managed protection submitted after fills, not a native entry-attached bracket. Native TWAP's fixed 3% slice tolerance does not cap future prices.

Chase protection covers verified settled-attempt fills. Unsettled partial fills remain unprotected. Chase protective levels must straddle the whole approved entry band. Lighter uses native paired OCO for each allocation; Hyperliquid uses managed sibling cancellation. A protective fill stops the owned entry. Both affected exits must settle before exact residual and late fills receive replacement protection; replacement submissions consume additional approved exit budget. Insufficient budget pauses with the residual visibly uncovered.

Stable fill identities prevent double counting. Every mutation persists first; each returned exit identity persists before the next leg is sent. Unknown submissions are never replayed. Current account, mode and credential revision are checked after awaited quote reads and before execution. Temporary read failures wait for evidence. Restart during an uncertain mutation pauses the plan.

The monitor supervises exits after entry completion, drains before shutdown, and polls without overlapping ticks. Status reports separate verified closed quantity, accepted outstanding exit coverage and uncovered verified entry quantity. Accepted submissions do not prove active exchange protection or fills. Old paused plans are not resumed automatically.

Atomic remains unavailable: verified official signing contracts do not expose all-or-none basket execution. Ordinary batches are not a substitute.

On 11 October, a user-authorized clean browser assistant connectivity test returned exactly `OK` without tools or trades. NanoGPT's current browser failure did not reproduce; tests cover modern and legacy reasoning stream formats. This does not establish the cause of the older error.
