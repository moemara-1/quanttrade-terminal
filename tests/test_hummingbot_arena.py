import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import unittest
spec=importlib.util.spec_from_file_location('arena_state',Path(__file__).parents[1]/'deployment/quanttrade-hummingbot-trading.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ArenaStateTests(unittest.IsolatedAsyncioTestCase):
 async def test_hl_standard_exact_scope_and_native_identity(self):
  async def info(**kw):
   q=kw['data']
   if q['type']=='userAbstraction':return 'disabled'
   if q['type']=='clearinghouseState':return {'marginSummary':{'accountValue':'100'},'withdrawable':'80','assetPositions':[]}
   return [{'coin':'BTC','oid':1,'cloid':'0x'+'1'*32,'side':'A','reduceOnly':True,'triggerPx':'101','sz':'2'}]
  c=SimpleNamespace(_auth=SimpleNamespace(_api_address='fixture'),_api_post=AsyncMock(side_effect=info),exchange_symbol_associated_to_pair=AsyncMock(return_value='BTC'))
  with patch.object(m,'open_orders',AsyncMock(return_value={'complete':True,'orders':[]})):
   result=await m.arena_account_state(c,m.ArenaAccountRequest(connector_name='hyperliquid_perpetual',trading_pair='BTC-USD'))
   self.assertEqual(result['equity'],'100');self.assertEqual(result['available_margin'],'80');self.assertEqual(result['orders'][0]['client_order_id'],'0x'+'1'*32)
   self.assertEqual(result['orders'][0]['size'],'2');self.assertFalse(result['orders'][0]['full_position'])
 async def test_hl_shared_mode_is_unknown_not_empty(self):
  c=SimpleNamespace(_auth=SimpleNamespace(_api_address='fixture'),_api_post=AsyncMock(return_value='unifiedAccount'),exchange_symbol_associated_to_pair=AsyncMock(return_value='BTC'))
  with self.assertRaisesRegex(m.ActionRejected,'unverified'):await m.arena_account_state(c,m.ArenaAccountRequest(connector_name='hyperliquid_perpetual',trading_pair='BTC-USD'))
 async def test_lighter_missing_equity_cannot_be_zero_and_order_read_must_complete(self):
  c=SimpleNamespace(_ensure_account_ready=AsyncMock(),_account_index=7,_api_get=AsyncMock(return_value={'code':200,'accounts':[{'available_balance':'100','assets':[],'positions':[]}]}))
  with patch.object(m,'open_orders',AsyncMock(return_value={'complete':True,'orders':[]})):
   with self.assertRaises(m.ActionRejected):await m.arena_account_state(c,m.ArenaAccountRequest(connector_name='lighter_perpetual',trading_pair='BTC-USDC'))
 async def test_lighter_zero_quantity_requires_native_conditional_parent_link(self):
  rows=[{'market_index':1,'order_index':9,'client_order_index':2,'is_ask':True,'reduce_only':True,'remaining_base_amount':'0.000','initial_base_amount':'0','type':'stop-loss','trigger_price':'90','parent_order_index':8}]
  async def read(**kw):
   if kw['path_url']=='/api/v1/account':return {'code':200,'accounts':[{'available_balance':'80','assets':[{'symbol':'USDC','margin_balance':'100'}],'positions':[]}]}
   return {'code':200,'orders':rows}
  c=SimpleNamespace(_ensure_account_ready=AsyncMock(),_account_index=7,_api_get=AsyncMock(side_effect=read),market_info_for_market_id=lambda _:SimpleNamespace(trading_pair='BTC-USDC',market_type='perp'))
  with patch.object(m,'open_orders',AsyncMock(return_value={'complete':True,'orders':[]})):
   result=await m.arena_account_state(c,m.ArenaAccountRequest(connector_name='lighter_perpetual',trading_pair='BTC-USDC'))
   self.assertTrue(result['orders'][0]['full_position'])
   rows[0]['parent_order_index']=0
   result=await m.arena_account_state(c,m.ArenaAccountRequest(connector_name='lighter_perpetual',trading_pair='BTC-USDC'))
   self.assertFalse(result['orders'][0]['full_position'])
