"""Inspect deployed chart identity safeguards without changing workspace or trading state."""
from pathlib import Path
root = Path('/opt/quanttrade/current')
patch = (root / 'patches/quanttrade.patch').read_text()
assert 'rowsForSelectedVenue' in patch
assert 'components/pair-picker/pair-search-results.tsx' in patch
bundle = '\n'.join(path.read_text() for path in (root / 'frontend/assets').glob('*.js'))
assert 'data-chart-source-venue' in bundle
assert 'data-chart-source-symbol' in bundle
assert (root / 'overlays/pairlens/apps/terminal/src/components/pair-picker/pair-venue-scope.ts').is_file()
print('Chart venue-scoped picker overlay and production bundle verified; no workspace or trading changes made.')
