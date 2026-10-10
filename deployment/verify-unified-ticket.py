"""Check deployed ticket and approval code without model or exchange calls."""
from pathlib import Path

root = Path('/opt/quanttrade/current')
scripts = [path.read_text(errors='replace') for path in (root / 'frontend/assets').glob('*.js')]
for marker in (
    'Prepare with AI',
    'Manage position and orders',
    'Trade ticket and position management',
    'The reviewed trading mode changed. Prepare a fresh proposal.',
    'When the user asks to set up, prepare or submit a trade',
    'Paper simulation recorded',
    'Observed approval results from this browser session',
    'Choose Cross or Isolated when changing leverage',
    'Multiple live accounts are connected for this exchange',
    'This proposal expired',
    'Est. initial margin',
    'Workflow input notional',
    'Unavailable · refresh account connection',
    'This workflow has no order nodes',
):
    assert any(marker in script for script in scripts), marker
assert "order.marginMode??'cross'" not in (root / 'src/server/execution.ts').read_text()
assert 'Changing leverage requires an explicit margin mode' in (root / 'src/server/execution.ts').read_text()
print('Deployed unified ticket, explicit margin, account ambiguity and AI confirmation guards are bundled; no model or trading calls.')
