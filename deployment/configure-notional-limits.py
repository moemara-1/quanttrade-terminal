"""Disable only the two operator-authorized backend notional settings."""
from pathlib import Path
import re

KEYS = {'MAX_ORDER_NOTIONAL', 'DAILY_NOTIONAL_LIMIT'}

def disable_notional_limits(text):
    output, found = [], set()
    for line in text.splitlines(keepends=True):
        match = re.match(r'^\s*(?:export\s+)?(MAX_ORDER_NOTIONAL|DAILY_NOTIONAL_LIMIT)\s*=', line)
        if match:
            key = match.group(1)
            found.add(key)
            ending = '\r\n' if line.endswith('\r\n') else '\n' if line.endswith('\n') else ''
            output.append(key + '=off' + ending)
        else:
            output.append(line)
    result = ''.join(output)
    for key in sorted(KEYS - found):
        if result and not result.endswith('\n'):
            result += '\n'
        result += key + '=off\n'
    return result

if __name__ == '__main__':
    path = Path('/opt/quanttrade/shared/bridge.env')
    if path.resolve() != path:
        raise RuntimeError('Unexpected shared environment target')
    original = path.read_bytes().decode('utf-8')
    path.write_bytes(disable_notional_limits(original).encode('utf-8'))
    print('Backend notional caps disabled; other settings preserved.')
