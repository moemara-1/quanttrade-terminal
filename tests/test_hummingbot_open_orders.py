import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location('quanttrade_open_orders', Path(__file__).parents[1] / 'deployment/quanttrade-hummingbot-trading.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OpenOrdersTests(unittest.IsolatedAsyncioTestCase):
    def lighter(self, rows):
        return SimpleNamespace(_ensure_account_ready=AsyncMock(), _account_index=4,
            _api_get=AsyncMock(return_value={'code': 200, 'orders': rows}),
            market_info_for_market_id=Mock(return_value=SimpleNamespace(trading_pair='GRAM-USDC', market_type='perp')))

    async def test_all_market_read_uses_native_ids_and_no_history_fills_or_signer(self):
        c = self.lighter([{'market_index': 9, 'order_index': 14918173922809911, 'order_id': '14918173922809911', 'client_order_index': 33, 'is_ask': True, 'remaining_base_amount': '171', 'price': '1.5', 'reduce_only': True}])
        result = await module.open_orders(c, 'lighter_perpetual')
        self.assertTrue(result['complete'])
        self.assertEqual(result['orders'][0]['exchangeOrderId'], '14918173922809911')
        self.assertEqual(result['orders'][0]['symbol'], 'GRAM-USDC')
        c._api_get.assert_awaited_once_with(path_url='/api/v1/accountActiveOrders', params={'account_index': 4, 'market_type': 'perp'}, is_auth_required=True)

    async def test_unknown_market_or_bad_order_ids_mark_incomplete(self):
        c = self.lighter([{'market_index': 9, 'client_order_index': 3}])
        result = await module.open_orders(c, 'lighter_perpetual')
        self.assertFalse(result['complete']); self.assertEqual(result['orders'], [])
        self.assertIn('error', result)
        c = self.lighter([{'market_index': 9, 'order_index': 3}])
        c.market_info_for_market_id.side_effect = KeyError('unknown')
        result = await module.open_orders(c, 'lighter_perpetual')
        self.assertFalse(result['complete']); self.assertIn('error', result)

    async def test_lighter_total_size_is_verified_and_never_invented_from_remaining(self):
        c = self.lighter([{'market_index': 9, 'order_index': 1, 'remaining_base_amount': '60', 'initial_base_amount': '100'}, {'market_index': 9, 'order_index': 2, 'remaining_base_amount': '60'}])
        result = await module.open_orders(c, 'lighter_perpetual')
        self.assertEqual(result['orders'][0]['size'], '60')
        self.assertEqual(result['orders'][0]['totalSize'], '100')
        self.assertNotIn('totalSize', result['orders'][1])
        c = self.lighter([{'market_index': 9, 'order_index': 1, 'remaining_base_amount': '60', 'initial_base_amount': '20'}])
        result = await module.open_orders(c, 'lighter_perpetual')
        self.assertFalse(result['complete'])
        self.assertEqual(result['orders'], [])

    async def test_provider_error_is_not_empty_book(self):
        c = self.lighter([]); c._api_get.return_value = {'code': 400, 'orders': []}
        with self.assertRaises(ValueError): await module.open_orders(c, 'lighter_perpetual')

    async def test_hyperliquid_standard_scope_excludes_builder_markets_explicitly(self):
        c = SimpleNamespace(_auth=SimpleNamespace(_api_address='owner'), _api_post=AsyncMock(return_value=[{'coin': 'BTC', 'oid': 77, 'side': 'A', 'sz': '1', 'limitPx': '100', 'reduceOnly': True}]))
        result = await module.open_orders(c, 'hyperliquid_perpetual')
        self.assertEqual(result['scope'], 'standard-perpetual-markets')
        self.assertFalse(result['complete']); self.assertIn('builder', result['error'])
        self.assertEqual(result['orders'][0]['symbol'], 'BTC-USDC')
        c._api_post.assert_any_await(path_url='/info', data={'type': 'frontendOpenOrders', 'user': 'owner', 'dex': ''}, is_auth_required=False)
        c._api_post.assert_any_await(path_url='/info', data={'type': 'perpDexs'}, is_auth_required=False)

    async def test_spot_scope_and_malformed_amounts_do_not_claim_empty_account(self):
        c = self.lighter([{'market_index': 4, 'order_index': 33, 'price': 'NaN'}])
        c.market_info_for_market_id.return_value = SimpleNamespace(trading_pair='ETH-USDC', market_type='spot')
        result = await module.open_orders(c, 'lighter')
        self.assertEqual(result['scope'], 'all-spot-markets'); self.assertFalse(result['complete'])
        c._api_get.assert_awaited_once_with(path_url='/api/v1/accountActiveOrders', params={'account_index': 4, 'market_type': 'spot'}, is_auth_required=True)
        hl = SimpleNamespace(_auth=SimpleNamespace(_api_address='owner'), _api_post=AsyncMock(return_value=[{'coin': '@1', 'oid': 3}, {'coin': 'BTC', 'oid': 4}]), trading_pair_associated_to_exchange_symbol=AsyncMock(return_value='PURR-USDC'))
        result = await module.open_orders(hl, 'hyperliquid')
        self.assertTrue(result['complete']); self.assertEqual([o['symbol'] for o in result['orders']], ['PURR-USDC'])

    def test_read_only_route_is_authenticated_and_accepts_no_pair_or_request_id(self):
        app = FastAPI()
        async def forbidden(): raise HTTPException(status_code=401, detail='Unauthorized')
        module.install(app, forbidden)
        client = TestClient(app)
        self.assertEqual(client.post('/quanttrade/trading/open-orders', json={'connector_name': 'lighter_perpetual'}).status_code, 401)
        self.assertEqual(module.OpenOrdersRequest(connector_name='lighter_perpetual').account_name, 'desk')
        with self.assertRaises(ValueError): module.OpenOrdersRequest(connector_name='lighter_perpetual', trading_pair='GRAM-USDC')

class BuilderOpenOrdersTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_builder_books_and_namespaces_are_read_with_partial_failure_explicit(self):
        calls=[]
        async def info(**kw):
            body=kw['data'];calls.append(body)
            if body['type']=='perpDexs':return [None,{'name':'xyz'},{'name':'para'}]
            if body['type']=='meta':return {'collateralToken':0,'universe':[]}
            if body.get('dex')=='xyz':raise TimeoutError('fixture')
            return [{'coin':'BTC','oid':1}] if body.get('dex')=='' else [{'coin':'para:PAPER','oid':2}]
        c=SimpleNamespace(_auth=SimpleNamespace(_api_address='owner'),_api_post=AsyncMock(side_effect=info))
        result=await module.open_orders(c,'hyperliquid_perpetual')
        self.assertEqual(result['scope'],'all-perpetual-markets');self.assertFalse(result['complete'])
        self.assertEqual([r['symbol'] for r in result['orders']],['BTC-USDC','para:PAPER-USDC'])
        self.assertIn('xyz',result['error'])
        self.assertEqual({x.get('dex') for x in calls if x['type']=='frontendOpenOrders'},{'','xyz','para'})
    async def test_successful_all_dex_read_can_prove_no_resting_orders(self):
        async def info(**kw):return [None,{'name':'para'}] if kw['data']['type']=='perpDexs' else {'collateralToken':0} if kw['data']['type']=='meta' else []
        c=SimpleNamespace(_auth=SimpleNamespace(_api_address='owner'),_api_post=AsyncMock(side_effect=info))
        result=await module.open_orders(c,'hyperliquid_perpetual')
        self.assertEqual(result['scope'],'all-perpetual-markets');self.assertTrue(result['complete']);self.assertEqual(result['orders'],[])
