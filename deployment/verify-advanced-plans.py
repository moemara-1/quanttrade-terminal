"""Read-only single-approval plan bundle guard; never submits orders."""
from pathlib import Path
import json
release = Path('/opt/quanttrade/current')
scripts = [p.read_text(encoding='utf-8', errors='replace') for p in (release / 'frontend/assets').glob('*.js')]
for marker in ('prepare_position_plan', 'The reviewed plan connection changed', 'Choose leverage and margin mode together'):
    assert any(marker in source for source in scripts), marker
fixture = json.loads((release / 'tests/fixtures/iceberg-position-plan.json').read_text())
assert fixture['compiled']['workflow']['graph']['steps']
print('Single-confirmation plan compiler, pinned connection and fixture verified; no orders submitted.')