"""Read-only check of bounded tool repair and safe deployed diagnostics."""
from pathlib import Path

root = Path('/opt/quanttrade/current')
repair = root / 'overlays/pairlens/apps/terminal/src/lib/assistant-core/tool-input-repair.ts'
assert 'positionPlanInputSchema.safeParse(repaired)' in repair.read_text()
patch = (root / 'patches/quanttrade.patch').read_text()
assert 'experimental_repairToolCall: repairPositionPlanToolCall' in patch
assert 'repeatedPreparationFailure' in patch
scripts = [p.read_text(errors='replace') for p in (root / 'frontend/assets').glob('*.js')]
for marker in ('tool-input', 'check order and run status', 'Send tool arguments as typed JSON'):
    assert any(marker in script for script in scripts), marker
print('Bounded plan argument repair, repeated-failure stop and safe diagnostics verified; no model or trade requests.')
