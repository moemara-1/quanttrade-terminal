import asyncio
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location('quanttrade_trading', Path(__file__).parents[1] / 'deployment/quanttrade-hummingbot-trading.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TradingTests(unittest.IsolatedAsyncioTestCase):
    def hl(self, response=None):
        return SimpleNamespace(
            coin_to_asset={'BTC': 0}, exchange_symbol_associated_to_pair=AsyncMock(return_value='BTC'),
            _auth=SimpleNamespace(wallet=object(), _vault_address=None, _get_timestamp=Mock(return_value=1000), sign_l1_action=Mock(return_value={'v': 27})),
            _api_post=AsyncMock(return_value=response or {'status': 'ok', 'response': {'type': 'default'}}),
            _perpetual_trading=SimpleNamespace(set_leverage=Mock()),
        )

    def lighter(self):
        signer = SimpleNamespace(CROSS_MARGIN_MODE=0, ISOLATED_MARGIN_MODE=1, ISOLATED_MARGIN_ADD_COLLATERAL=1, ISOLATED_MARGIN_REMOVE_COLLATERAL=0,
            update_leverage=AsyncMock(return_value=(None, SimpleNamespace(code=200, tx_hash='hash'), None)),
            update_margin=AsyncMock(return_value=(None, SimpleNamespace(code=200, tx_hash='hash'), None)),
            create_order=AsyncMock(return_value=(None, SimpleNamespace(code=200, tx_hash='hash'), None)),
            cancel_order=AsyncMock(return_value=(None, SimpleNamespace(code=200, tx_hash='hash'), None)))
        return SimpleNamespace(_ensure_account_ready=AsyncMock(), _signer_client=signer, _tx_lock=asyncio.Lock(),
            market_info_for_trading_pair=Mock(return_value=SimpleNamespace(market_id=0, size_decimals=3, price_decimals=2)),
            _new_client_order_id=Mock(return_value='123'), _perpetual_trading=SimpleNamespace(set_leverage=Mock()))

    async def test_hl_isolated_leverage_uses_signed_native_action(self):
        c = self.hl()
        result = await module.leverage(c, 'hyperliquid_perpetual', 'BTC-USD', 5, 'isolated')
        self.assertEqual(result['status'], 'accepted')
        payload = c._api_post.call_args.kwargs['data']
        self.assertEqual(payload['action'], {'type': 'updateLeverage', 'asset': 0, 'isCross': False, 'leverage': 5})
        self.assertFalse(c._api_post.call_args.kwargs['is_auth_required'])
        c._perpetual_trading.set_leverage.assert_called_once_with('BTC-USD', 5)

    async def test_hl_exchange_rejection_never_updates_leverage(self):
        c = self.hl({'status': 'err', 'response': 'secret'})
        with self.assertRaisesRegex(module.ActionRejected, 'Exchange rejected'):
            await module.leverage(c, 'hyperliquid_perpetual', 'BTC-USD', 5, 'cross')
        c._perpetual_trading.set_leverage.assert_not_called()

    async def test_lighter_isolated_leverage_checks_ack_and_lock(self):
        c = self.lighter()
        await module.leverage(c, 'lighter_perpetual', 'BTC-USDC', 5, 'isolated')
        c._signer_client.update_leverage.assert_awaited_once_with(market_index=0, margin_mode=1, leverage=5)
        c._signer_client.update_leverage.return_value = (None, SimpleNamespace(code=400), None)
        with self.assertRaises(module.ActionRejected):
            await module.leverage(c, 'lighter_perpetual', 'BTC-USDC', 5, 'cross')

    async def test_hl_margin_uses_exact_micro_units(self):
        c = self.hl()
        await module.margin(c, 'hyperliquid_perpetual', 'BTC-USD', '1.000001', 'remove')
        self.assertEqual(c._api_post.call_args.kwargs['data']['action']['ntli'], -1000001)
        with self.assertRaises(ValueError):
            await module.margin(c, 'hyperliquid_perpetual', 'BTC-USD', '1.0000001', 'add')

    async def test_lighter_margin_uses_decimal_not_float(self):
        c = self.lighter()
        await module.margin(c, 'lighter_perpetual', 'BTC-USDC', '1.000001', 'add')
        amount = c._signer_client.update_margin.call_args.kwargs['usdc_amount']
        self.assertEqual(str(amount), '1.000001')

    async def test_hl_trigger_preserves_price_size_and_reduce_only(self):
        c = self.hl({'status': 'ok', 'response': {'type': 'order', 'data': {'statuses': [{'resting': {'oid': 456}}]}}})
        result = await module.trigger(c, 'hyperliquid_perpetual', 'BTC-USD', 'sell', '0.1', '90000', '89900', 'sl', True, True, 'a' * 32)
        order = c._api_post.call_args.kwargs['data']['action']['orders'][0]
        self.assertEqual(order['p'], '89900')
        self.assertTrue(order['r'])
        self.assertEqual(order['t'], {'trigger': {'isMarket': True, 'triggerPx': '90000', 'tpsl': 'sl'}})
        self.assertEqual(result['exchange_order_id'], '456')

    async def test_lighter_trigger_precision_and_enum(self):
        c = self.lighter()
        result = await module.trigger(c, 'lighter_perpetual', 'BTC-USDC', 'sell', '0.123', '90000.01', '89900', 'tp', False, True, 'a' * 32)
        args = c._signer_client.create_order.call_args.kwargs
        self.assertEqual(args['base_amount'], 123)
        self.assertEqual(args['trigger_price'], 9000001)
        self.assertEqual(args['order_type'], 5)
        self.assertEqual(args['order_expiry'], -1)
        self.assertEqual(result['client_order_id'], '123')
        with self.assertRaises(ValueError):
            await module.trigger(c, 'lighter_perpetual', 'BTC-USDC', 'sell', '0.1234', '90000', '89900', 'sl', True, True, 'a' * 32)

    async def test_cancel_requires_exchange_id_and_ack(self):
        c = self.hl({'status': 'ok', 'response': {'type': 'cancel', 'data': {'statuses': ['success']}}})
        await module.cancel(c, 'hyperliquid_perpetual', 'BTC-USD', '456')
        self.assertEqual(c._api_post.call_args.kwargs['data']['action']['cancels'], [{'a': 0, 'o': 456}])
        with self.assertRaises(ValueError):
            await module.cancel(c, 'hyperliquid_perpetual', 'BTC-USD', 'bad')

    async def test_uncertain_requests_are_never_repeated(self):
        cache = module.RequestLedger()
        call = AsyncMock(side_effect=TimeoutError('secret'))
        for _ in range(2):
            with self.assertRaises(module.ActionUncertain):
                await cache.run('request-1234567890', {'a': 1}, call)
        call.assert_awaited_once()
        with self.assertRaises(module.ActionRejected):
            await cache.run('request-1234567890', {'a': 2}, call)

    async def test_hl_snapshot_filters_configured_account_and_market(self):
        c = self.hl()
        c._auth._api_address = 'configured-owner'
        c._api_post.side_effect = [
            [{'coin': 'BTC', 'oid': 1}, {'coin': 'ETH', 'oid': 2}],
            [{'order': {'coin': 'BTC', 'oid': 3}}],
            [{'coin': 'BTC', 'oid': 1, 'time': 1}, {'coin': 'ETH', 'oid': 2, 'time': 2}],
            {'marginSummary': {'accountValue': '100'}},
        ]
        result = await module.snapshot(c, 'hyperliquid_perpetual', 'BTC-USD')
        self.assertEqual(len(result['open_orders']), 1)
        self.assertEqual(len(result['fills']), 1)
        for call in c._api_post.call_args_list:
            self.assertEqual(call.kwargs['data']['user'], 'configured-owner')
            self.assertFalse(call.kwargs['is_auth_required'])

    async def test_lighter_snapshot_uses_owned_index_and_pagination(self):
        c = self.lighter()
        c._account_index = 123
        c._api_get = AsyncMock(side_effect=[{'code': 200, 'orders': [{'order_index': 456}]},
            {'code': 200, 'orders': [], 'next_cursor': 'next-history'},
            {'code': 200, 'trades': [], 'next_cursor': 'next-fills'}, {'code': 200, 'accounts': []}])
        result = await module.snapshot(c, 'lighter', 'ETH-USDC', 'previous-history', 'previous-fills')
        self.assertEqual(result['history_next_cursor'], 'next-history')
        self.assertEqual(result['fills_next_cursor'], 'next-fills')
        for call in c._api_get.call_args_list[:3]:
            self.assertEqual(call.kwargs['params']['account_index'], 123)
            self.assertEqual(call.kwargs['params']['market_id'], 0)
            self.assertTrue(call.kwargs['is_auth_required'])

    async def test_hl_fill_cursor_uses_full_page_before_pair_filtering(self):
        c = self.hl()
        c._auth._api_address = 'configured-owner'
        c._api_post.side_effect = [[], [], [{'coin': 'ETH', 'time': i} for i in range(2000)], {}]
        result = await module.snapshot(c, 'hyperliquid_perpetual', 'BTC-USD')
        self.assertEqual(result['fills'], [])
        self.assertTrue(result['fills_may_have_more'])
        self.assertEqual(result['fills_next_start_time'], 2000)

    async def test_amend_checks_owned_active_order_and_preserves_flags(self):
        c = self.hl({'status': 'ok', 'response': {'type': 'order', 'data': {'statuses': [{'resting': {'oid': 457}}]}}})
        with patch.object(module, 'snapshot', AsyncMock(return_value={'open_orders': [{'oid': 456, 'side': 'A', 'tif': 'Alo', 'reduceOnly': True}]})):
            result = await module.amend(c, 'hyperliquid', 'BTC-USDC', '456', '0.5', '99999')
        action = c._api_post.call_args.kwargs['data']['action']
        self.assertEqual(action['type'], 'modify')
        self.assertFalse(action['order']['b'])
        self.assertTrue(action['order']['r'])
        self.assertEqual(action['order']['t'], {'limit': {'tif': 'Alo'}})
        self.assertEqual(result['exchange_order_id'], '457')
        with patch.object(module, 'snapshot', AsyncMock(return_value={'open_orders': []})):
            with self.assertRaises(module.ActionRejected):
                await module.amend(c, 'hyperliquid', 'BTC-USDC', '456', '0.5', '99999')

    async def test_lighter_signer_errors_never_expose_secrets(self):
        c = self.lighter()
        c._signer_client.update_margin.return_value = (None, None, 'PRIVATE_SECRET')
        with self.assertRaises(module.ActionRejected) as caught:
            await module.margin(c, 'lighter_perpetual', 'BTC-USDC', '1', 'add')
        self.assertNotIn('PRIVATE_SECRET', str(caught.exception))

    async def test_hl_amend_accepts_explicit_user_tif_when_exchange_omits_it(self):
        c = self.hl({'status': 'ok', 'response': {'type': 'order', 'data': {'statuses': [{'resting': {'oid': 457}}]}}})
        with patch.object(module, 'snapshot', AsyncMock(return_value={'open_orders': [{'oid': 456, 'side': 'B', 'reduceOnly': False}]})):
            with self.assertRaises(module.ActionRejected):
                await module.amend(c, 'hyperliquid', 'BTC-USDC', '456', '0.5', '99999')
            await module.amend(c, 'hyperliquid', 'BTC-USDC', '456', '0.5', '99999', 'Alo')
        self.assertEqual(c._api_post.call_args.kwargs['data']['action']['order']['t'], {'limit': {'tif': 'Alo'}})

    async def test_lighter_amend_never_silently_ignores_a_tif_change(self):
        with patch.object(module, 'snapshot', AsyncMock()) as read:
            with self.assertRaises(module.ActionRejected):
                await module.amend(self.lighter(), 'lighter', 'ETH-USDC', '456', '0.5', '3000', 'Alo')
            read.assert_not_awaited()

    def test_installed_routes_require_auth_and_fixed_scope(self):
        app = FastAPI()
        async def forbidden():
            raise HTTPException(status_code=401, detail='Unauthorized')
        module.install(app, forbidden)
        client = TestClient(app)
        for route in ['leverage', 'margin', 'trigger-orders', 'cancel-order', 'amend-order', 'snapshot']:
            self.assertEqual(client.post('/quanttrade/trading/' + route, json={}).status_code, 401)

    def test_scope_and_nonfinite_validation(self):
        for payload in [{'account_name': 'other'}, {'connector_name': 'binance'}, {'leverage': True}, {'leverage': 0}]:
            with self.assertRaises(ValueError):
                module.LeverageRequest(**{'request_id': 'request-1234567890', 'trading_pair': 'BTC-USD', 'leverage': 5, **payload})
        for amount in ['NaN', 'Infinity', '-1', '0']:
            with self.assertRaises(ValueError):
                module.positive_decimal(amount)

    def test_lighter_native_identity_aliases_must_agree(self):
        self.assertEqual(module.lighter_order_id({'order_index': 456, 'order_id': '456', 'client_order_index': 123}), '456')
        self.assertEqual(module.lighter_order_id({'order_id': '456'}), '456')
        for order in [{'order_index': 456, 'order_id': '457'}, {'client_order_index': 123}, {'order_index': True}]:
            with self.assertRaises(module.ActionUncertain):
                module.lighter_order_id(order)
