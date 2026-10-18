# Compact scanner navigation

User feedback: opportunity details take the entire page and feel too large and difficult to navigate.

Keep the results mounted and preserve filters and scroll. Use a bounded side detail panel on desktop and a contained detail view inside the existing mobile Discover surface. Group concise summary, venue metrics, history, and paired trade controls into Overview / History / Trade tabs. Keep disclosure of settled versus projected funding and non-atomic execution; never hide exact order/account/confirmation details. Use the existing dense dark-green terminal theme and accessible focus/close behavior.

Alternative full-page max-width layout still loses the result context; an expanded table row becomes too tall for charts and paired confirmation. A compact side panel gives the user the fastest back-and-forth scanning.

Verify result preservation, close/Escape/focus, keyboard tab navigation, mobile width and scrolling, history coverage and paired review safeguards. No exchange executions during QA. This is a frontend-only change; no backend or exchange service restart required.

Keep trade review state mounted when switching tabs or closing/reopening the same opportunity. Block closing or selecting a different opportunity while a prepare/confirm request is in flight. The desktop panel is non-modal so the results remain usable; Escape/Close returns focus to its opener.
