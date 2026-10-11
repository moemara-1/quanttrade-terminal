import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
import unittest

spec = importlib.util.spec_from_file_location('chase_trading', Path(__file__).parents[1] / 'deployment/quanttrade-hummingbot-trading.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ChaseEvidenceTests(unittest.IsolatedAsyncioTestCase):
    def connector(self, status, fills):
        record = {'status': 'order', 'order': {'status': status, 'order': {'coin': 'BTC', 'oid': 11, 'timestamp': 1000, 'origSz': '10', 'sz': '8', 'side': 'B'}}}
        async def read(**kwargs):
            return record if kwargs['data']['type'] == 'orderStatus' else fills
        return SimpleNamespace(exchange_symbol_associated_to_pair=AsyncMock(return_value='BTC'), _auth=SimpleNamespace(_api_address='owner'), _api_post=AsyncMock(side_effect=read)), record

    async def test_cancelled_partial_reconciles_exact_fills_before_settlement(self):
        c, _ = self.connector('canceled', [{'coin': 'BTC', 'oid': 11, 'tid': 1, 'time': 1001, 'sz': '2', 'px': '100', 'side': 'B'}])
        self.assertEqual(await module.settled_order_evidence(c, 'BTC-USD', '11', '10', 'buy'), {'status': 'settled', 'filledSize': '2', 'exchangeId': '11'})
        c._api_post.assert_awaited()

    async def test_missing_fills_never_assumed_zero_and_zero_needs_original_remaining_proof(self):
        c, record = self.connector('canceled', [])
        self.assertEqual((await module.settled_order_evidence(c, 'BTC-USD', '11', '10', 'buy'))['status'], 'pending')
        record['order']['order']['sz'] = '10'
        self.assertEqual(await module.settled_order_evidence(c, 'BTC-USD', '11', '10', 'buy'), {'status': 'settled', 'filledSize': '0', 'exchangeId': '11'})
        del record['order']['order']['sz']
        self.assertEqual((await module.settled_order_evidence(c, 'BTC-USD', '11', '10', 'buy'))['status'], 'pending')

    async def test_open_identity_requires_exact_size_side_and_owned_oid(self):
        c, record = self.connector('open', [])
        self.assertEqual(await module.settled_order_evidence(c, 'BTC-USD', '11', '10', 'buy'), {'status': 'open', 'exchangeId': '11'})
        for field, value in [('origSz', '11'), ('side', 'A'), ('oid', 12), ('coin', 'ETH')]:
            old = record['order']['order'][field]
            record['order']['order'][field] = value
            self.assertEqual((await module.settled_order_evidence(c, 'BTC-USD', '11', '10', 'buy'))['status'], 'pending')
            record['order']['order'][field] = old

    async def test_oversize_conflicting_duplicate_and_wrong_side_fills_block_replacement(self):
        for fills in [
            [{'coin': 'BTC', 'oid': 11, 'tid': 1, 'time': 1001, 'sz': '11', 'px': '100', 'side': 'B'}],
            [{'coin': 'BTC', 'oid': 11, 'tid': 1, 'time': 1001, 'sz': '2', 'px': '100', 'side': 'A'}],
            [{'coin': 'BTC', 'oid': 11, 'tid': 1, 'time': 1001, 'sz': size, 'px': '100', 'side': 'B'} for size in ['1', '2']],
        ]:
            c, _ = self.connector('canceled', fills)
            self.assertEqual((await module.settled_order_evidence(c, 'BTC-USD', '11', '10', 'buy'))['status'], 'pending')

    async def test_pagination_preserves_boundary_ids_and_stalled_pages_fail_closed(self):
        c, record = self.connector('canceled', [])
        unrelated = [{'coin': 'ETH', 'oid': 99, 'tid': index, 'time': 1001, 'sz': '1', 'px': '100', 'side': 'B'} for index in range(1999)]
        own = {'coin': 'BTC', 'oid': 11, 'tid': 5000, 'time': 1001, 'sz': '1', 'px': '100', 'side': 'B'}
        second = {**own, 'tid': 5001, 'time': 1002}
        c._api_post.side_effect = [record, unrelated + [own], [own, second], record]
        self.assertEqual(await module.settled_order_evidence(c, 'BTC-USD', '11', '10', 'buy'), {'status': 'settled', 'filledSize': '2', 'exchangeId': '11'})
        c._api_post.side_effect = [record, unrelated + [own], unrelated + [own]]
        self.assertEqual((await module.settled_order_evidence(c, 'BTC-USD', '11', '10', 'buy'))['status'], 'pending')

    async def test_terminal_status_change_during_reconciliation_blocks_replacement(self):
        c, record = self.connector('canceled', [])
        fill = {'coin': 'BTC', 'oid': 11, 'tid': 1, 'time': 1001, 'sz': '2', 'px': '100', 'side': 'B'}
        changed = {'status': 'order', 'order': {**record['order'], 'status': 'open'}}
        c._api_post.side_effect = [record, [fill], changed]
        self.assertEqual((await module.settled_order_evidence(c, 'BTC-USD', '11', '10', 'buy'))['status'], 'pending')
