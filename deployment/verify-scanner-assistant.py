"""Read-only verification of scanner UI and assistant integration artifacts."""
import runpy
from pathlib import Path

runpy.run_path('deployment/verify-scanners.py', run_name='__main__')
assets = Path('/opt/quanttrade/current/frontend/assets')
scripts = [path.read_text(errors='replace') for path in assets.glob('*.js')]
for marker in ('rankingMetric', 'nameMatchSource', 'curated-name-hint', 'device-cache', 'Methodology & coverage', 'View all'):
    assert any(marker in script for script in scripts), marker
print('Scanner research, native-name discovery, portfolio scope and expanded-report artifacts verified; no trade requests.')
