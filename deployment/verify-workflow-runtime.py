"""Authenticated readiness/schema checks only; never submits an order."""
from pathlib import Path
import urllib.request, base64, json, time
fields=dict(line.split('=',1) for line in Path('/opt/quanttrade/hummingbot/.env').read_text().splitlines() if '=' in line)
auth=base64.b64encode((fields['USERNAME']+':'+fields['PASSWORD']).encode()).decode()
for attempt in range(60):
    try:
        request=urllib.request.Request('http://127.0.0.1:8000/openapi.json',headers={'Authorization':'Basic '+auth})
        with urllib.request.urlopen(request,timeout=5) as response: document=json.load(response)
        assert '/quanttrade/trading/orders' in document['paths']
        assert '/quanttrade/trading/market-orders' in document['paths']
        for path in ('bracket-orders','entry-bracket-orders','order-evidence','lighter-native-orders'):
            assert '/quanttrade/trading/'+path in document['paths']
        print('Acknowledged market/limit routes loaded; no orders sent.')
        break
    except Exception:
        if attempt==59: raise RuntimeError('Workflow order runtime failed readiness')
        time.sleep(1)
