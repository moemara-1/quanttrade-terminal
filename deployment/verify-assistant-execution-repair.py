"""Verify deployed assistant protocol/routing fixes without any trading mutation."""
from pathlib import Path
import json
from urllib.request import Request, urlopen

root = Path('/opt/quanttrade/current')
token = Path('/opt/quanttrade/shared/data/operator-token').read_text().strip()
with urlopen(Request('http://127.0.0.1:4318/api/status', headers={'Authorization': 'Bearer ' + token}), timeout=15) as response:
    status = json.load(response)
assert status['maxOrderNotional'] is None and status['dailyNotionalLimit'] is None
assert 'Their exact receipt identity is already sufficient for a scoped venue read' in (root / 'src/server/execution.ts').read_text()
native = (root / 'src/server/hyperliquid-native-twap.ts').read_text()
assert 'Entry accepted; protection binding pending' in native
assert 'Native TWAP opening order exceeds fresh available margin' in native
bundle = '\n'.join(path.read_text() for path in (root / 'frontend/assets').glob('*.js'))
for marker in ('reasoning_content', 'nativeTwapBundledProtection', 'protectionWarning', 'Capabilities could not be verified', 'after-full-entry-fill'):
    assert marker in bundle, 'Assistant repair missing from production bundle: ' + marker
print('Assistant reasoning protocol, advanced capability routing, native fill reader and TWAP receipt/margin safeguards verified; no AI or trading requests made.')
