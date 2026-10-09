# Approved Hyperliquid and Lighter workflows

The native Workflow ticket prepares a complete scheduled plan in chat. It does not run the upstream unattended executor. Ask the assistant to prepare every exact order using `place_order.workflow`, then confirm the full review card once. That confirmation registers the immutable plan with the Hetzner bridge. Closing the browser does not stop an approved schedule.

Supported plans contain up to 20 exact base-sized market or limit orders, scheduled within 48 hours of confirmation, on one exchange, instrument and account mode. Each step can carry the supported venue controls. The user reviews every amount, delay, limit/trigger price, leverage, margin mode, and a maximum total quote notional. Dynamic conditions, unbounded loops, attached brackets and OCO are not supported; they must never be silently discarded. Saving a workflow definition or approving an ordinary entry card does not start follow-up trades.

Ask **“Check my workflow runs”** for the persisted run view and individual order outcomes. The view includes **Stop future workflow steps**. Stopping the schedule does not cancel already submitted exchange orders or close positions. A schedule marked completed means its orders were submitted or simulated; it does not mean every live order filled.

Runs persist in `data/workflow-runs.sqlite` beneath the bridge service's shared working directory. Kill switch, changed exchange credentials/mode, invalid market rules, exhausted daily limits, price movement beyond the approved total budget, failed/uncertain submission, or a scheduled step missed by more than five minutes pause execution. Restart during an uncertain submission never retries it. Reconcile the exchange before preparing another plan. Existing saved drafts are never automatically activated.

Manual market/limit tickets remain direct. Only AI-prepared orders and full AI-prepared scheduled plans require the explicit chat approval card. The new scheduler does not grant agents operator credentials or enable the upstream unattended-order bypass.
