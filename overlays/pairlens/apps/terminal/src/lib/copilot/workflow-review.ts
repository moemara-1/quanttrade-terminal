/** Review the actual native grouping contract without promising unknown fill prices. */
export function workflowOcoReview(market: string): string {
  if (market === 'hyperliquid') return 'Hyperliquid submits the entry and paired TP/SL together as an exchange-native bracket. Required graph: market or limit entry, optional Split, then two matching 100% TP/SL exits. Percentage targets use the entry limit price or a fresh quote before submission; they are not recalculated from the later fill. The server validates the complete grouping before sending the entry.'
  if (market === 'lighter') return 'Lighter submits paired exchange-native TP/SL exits after the entry fill is confirmed. Percentage targets use the actual parent fill. The entry is submitted separately and is not protected until the paired exits are accepted.'
  return 'Native OCO is supported only for Lighter and Hyperliquid perpetual workflows; spot OCO is unavailable.'
}
