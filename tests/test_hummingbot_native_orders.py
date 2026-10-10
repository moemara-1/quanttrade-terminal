import asyncio
from decimal import Decimal
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location('native_trading', Path(__file__).parents[1] / 'deployment/quanttrade-hummingbot-trading.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NativeOrderTests(unittest.IsolatedAsyncioTestCase):
    def connector(self):
        return SimpleNamespace(_ensure_account_ready=AsyncMock(), _account_index=7, _tx_lock=asyncio.Lock(),
            market_info_for_trading_pair=lambda pair: SimpleNamespace(market_id=99, size_decimals=3, price_decimals=2,
                min_base_amount=Decimal('0.001'), min_quote_amount=Decimal('1')),
            _signer_client=SimpleNamespace(create_order=AsyncMock(return_value=(None, SimpleNamespace(code=200, tx_hash='tx'), None)),
                create_grouped_orders=AsyncMock(return_value=(None, SimpleNamespace(code=200, tx_hash='tx'), None))),
            _api_get=AsyncMock(return_value={'code': 200, 'accounts': [{'index': 7, 'positions': [{'market_id': 99, 'position': '10', 'sign': 1}]}]}))

    def dto(self, legs, grouping='single', **extra):
        return module.NativeOrderRequest(request_id='approved-native-plan', trading_pair='GRAM-USDC', grouping=grouping, legs=legs, **extra)

    def entry(self, **extra):
        return {'side': 'buy', 'type': 'market', 'amount': '2', 'price': '1.50', **extra}

    def exit(self, kind='sl-market', **extra):
        return {'side': 'sell', 'type': kind, 'amount': '0', 'price': '1.20' if kind.startswith('sl') else '1.80',
            'trigger_price': '1.25' if kind.startswith('sl') else '1.75', 'reduce_only': True, **extra}

    async def test_single_market_exact_units_and_ack_only(self):
        c = self.connector()
        result = await module.lighter_native_orders(c, self.dto([self.entry()]), SimpleNamespace)
        wire = c._signer_client.create_order.call_args.kwargs
        self.assertEqual((wire['base_amount'], wire['price'], wire['order_type'], wire['time_in_force'], wire['order_expiry']), (2000, 150, 1, 0, 0))
        self.assertEqual(result['status'], 'accepted')
        self.assertNotIn('fill_price', result)
        self.assertEqual(len(result['client_order_ids']), 1)

    async def test_otoco_children_are_native_zero_and_no_existing_position_read(self):
        c = self.connector()
        dto = self.dto([self.entry(), self.exit('tp-market'), self.exit()], 'otoco')
        result = await module.lighter_native_orders(c, dto, SimpleNamespace)
        wire = c._signer_client.create_grouped_orders.call_args.kwargs
        self.assertEqual(wire['grouping_type'], 3)
        self.assertEqual([o.BaseAmount for o in wire['orders']], [2000, 0, 0])
        self.assertEqual([o.TimeInForce for o in wire['orders']], [0, 0, 0])
        self.assertEqual([o.OrderExpiry for o in wire['orders']], [0, -1, -1])
        self.assertEqual(len(set(result['client_order_ids'])), 3)
        c._api_get.assert_not_called()

    async def test_position_tied_oco_requires_position(self):
        c = self.connector()
        await module.lighter_native_orders(c, self.dto([self.exit('tp-market'), self.exit()], 'oco'), SimpleNamespace)
        self.assertEqual([o.BaseAmount for o in c._signer_client.create_grouped_orders.call_args.kwargs['orders']], [0, 0])
        c._api_get.return_value['accounts'][0]['positions'] = []
        with self.assertRaises(module.ActionRejected):
            await module.lighter_native_orders(c, self.dto([self.exit('tp-market'), self.exit()], 'oco'), SimpleNamespace)

    async def test_twap_duration_encoded_as_expiry_and_minimum_slice_checked(self):
        c = self.connector()
        dto = self.dto([self.entry(type='twap', amount='30', time_in_force='gtt', duration_seconds=300)])
        await module.lighter_native_orders(c, dto, SimpleNamespace, now_ms=1000000)
        wire = c._signer_client.create_order.call_args.kwargs
        self.assertEqual((wire['order_type'], wire['order_expiry'], wire['time_in_force']), (6, 1300000, 1))
        with self.assertRaises(module.ActionRejected):
            await module.lighter_native_orders(c, self.dto([self.entry(type='twap', amount='2', time_in_force='gtt', duration_seconds=300)]), SimpleNamespace)

    async def test_invalid_plans_never_sign(self):
        plans = [([self.entry(amount='0')], 'single'), ([self.entry(amount='2.0001')], 'single'),
            ([self.entry(type='twap', time_in_force='gtt', duration_seconds=300), self.exit()], 'oto'),
            ([self.entry(), self.exit(amount='1')], 'oto'), ([self.entry(), self.exit(side='buy')], 'oto'),
            ([self.exit(), self.exit()], 'oco'), ([self.entry(type='limit', time_in_force='gtt', expiry=1100000)], 'single')]
        for legs, grouping in plans:
            c = self.connector()
            with self.subTest(legs=legs), self.assertRaises(ValueError):
                await module.lighter_native_orders(c, self.dto(legs, grouping), SimpleNamespace, now_ms=1000000)
            c._signer_client.create_order.assert_not_called()
            c._signer_client.create_grouped_orders.assert_not_called()

    async def test_reduced_orders_require_correct_account_position_side(self):
        for account_index, sign in [(8, 1), (7, -1)]:
            c = self.connector()
            c._api_get.return_value['accounts'][0]['index'] = account_index
            c._api_get.return_value['accounts'][0]['positions'][0]['sign'] = sign
            with self.assertRaises(module.ActionRejected):
                await module.lighter_native_orders(c, self.dto([self.exit(amount='2')]), SimpleNamespace)
            c._signer_client.create_order.assert_not_called()

    async def test_ledger_replays_ack_without_resigning_and_rejects_changed_plan(self):
        c = self.connector()
        dto = self.dto([self.entry()])
        ledger = module.RequestLedger()
        operation = lambda: module.lighter_native_orders(c, dto, SimpleNamespace)
        first = await ledger.run(dto.request_id, dto.model_dump(), operation)
        self.assertEqual(await ledger.run(dto.request_id, dto.model_dump(), operation), first)
        c._signer_client.create_order.assert_awaited_once()
        with self.assertRaises(module.ActionRejected):
            await ledger.run(dto.request_id, self.dto([self.entry(amount='3')]).model_dump(), operation)

    async def test_unknown_transport_never_retries(self):
        c = self.connector()
        c._signer_client.create_order.side_effect = TimeoutError()
        dto = self.dto([self.entry()])
        ledger = module.RequestLedger()
        for _ in range(2):
            with self.assertRaises(module.ActionUncertain):
                await ledger.run(dto.request_id, dto.model_dump(), lambda: module.lighter_native_orders(c, dto, SimpleNamespace))
        c._signer_client.create_order.assert_awaited_once()

    def test_auth_and_dto_scope_cannot_be_bypassed(self):
        app = FastAPI()
        def auth():
            raise HTTPException(status_code=401, detail='Unauthorized')
        module.install(app, auth)
        client = TestClient(app)
        self.assertEqual(client.post('/quanttrade/trading/lighter-native-orders', json=self.dto([self.entry()]).model_dump()).status_code, 401)
        for extra in [{'connector_name': 'lighter'}, {'account_name': 'other'}, {'leverage': True}]:
            with self.assertRaises(ValueError):
                self.dto([self.entry()], **extra)

    async def test_all_standalone_types_use_exact_tif(self):
        for kind, tif, expected_type in [('limit', 'post-only', 0), ('sl-market', 'ioc', 2), ('sl-limit', 'gtt', 3), ('tp-market', 'ioc', 4), ('tp-limit', 'post-only', 5)]:
            c = self.connector()
            leg = self.entry(type=kind, time_in_force=tif)
            if kind.startswith(('sl-', 'tp-')):
                leg['trigger_price'] = '1.40'
            await module.lighter_native_orders(c, self.dto([leg]), SimpleNamespace)
            wire = c._signer_client.create_order.call_args.kwargs
            self.assertEqual(wire['order_type'], expected_type)
            self.assertEqual(wire['order_expiry'], -1)

    async def test_invalid_expiry_and_duration_and_oversized_units(self):
        for leg in [self.entry(price='42949672.96'), self.entry(amount='281474976710.656'), self.entry(type='sl-market'),
                self.entry(duration_seconds=300), self.entry(type='sl-market', trigger_price='1.2', time_in_force='gtt'),
                self.entry(type='twap', time_in_force='gtt', duration_seconds=300, expiry=1400000)]:
            c = self.connector()
            with self.assertRaises(ValueError):
                await module.lighter_native_orders(c, self.dto([leg]), SimpleNamespace, now_ms=1000000)
            c._signer_client.create_order.assert_not_called()

