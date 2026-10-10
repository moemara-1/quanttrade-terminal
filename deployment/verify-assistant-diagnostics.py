"""Verify assistant error reporting in deployed assets without model requests."""
from pathlib import Path
scripts=[p.read_text(errors='replace') for p in Path('/opt/quanttrade/current/frontend/assets').glob('*.js')]
for marker in ('[QT_AI:', 'Diagnostic: QT-AI/', 'rejected the API credentials', 'rejected the model request'):
    assert any(marker in script for script in scripts),marker
print('Safe assistant HTTP diagnostics and actionable provider errors are bundled; no AI or trade calls.')
