"""Verify only the authorized cap settings changed; do not submit any order."""
from pathlib import Path
import json
import re
from urllib.request import Request, urlopen

root = Path('/opt/quanttrade/shared')
token = (root / 'data/operator-token').read_text().strip()
with urlopen(Request('http://127.0.0.1:4318/api/status', headers={'Authorization': 'Bearer ' + token}), timeout=15) as response:
    status = json.load(response)
assert status['maxOrderNotional'] is None
assert status['dailyNotionalLimit'] is None
assert isinstance(status['dailyNotionalUsed'], str)
def other_settings(text):
    return [line for line in text.splitlines() if not re.match(r'^\s*(?:export\s+)?(?:MAX_ORDER_NOTIONAL|DAILY_NOTIONAL_LIMIT)\s*=', line)]
assert other_settings((root / 'bridge.env').read_text()) == other_settings((root / 'env-before-notional-off').read_text()), 'Unrelated deployment settings changed'
print('Actual hosted per-order and daily-notional caps are Off; other environment settings preserved; no orders submitted.')
