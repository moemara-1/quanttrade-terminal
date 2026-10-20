import asyncio
import importlib.util
from pathlib import Path
from decimal import Decimal
from types import SimpleNamespace
import unittest

spec=importlib.util.spec_from_file_location('market_guard',Path(__file__).parents[1]/'deployment/quanttrade-hummingbot-market.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
MARKET=SimpleNamespace(name='MARKET')
LIMIT=SimpleNamespace(name='LIMIT')

class MarketProtectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_submission_waits_for_connector_ack_and_never_calls_another_order(self):
        order = SimpleNamespace(current_state=SimpleNamespace(name='PENDING_CREATE'), exchange_order_id=None)
        connector = SimpleNamespace(_order_tracker=SimpleNamespace(all_orders={'reviewed': order}))
        task = asyncio.create_task(module.wait_for_submission(connector, 'reviewed', timeout=1))
        await asyncio.sleep(0)
        self.assertFalse(task.done())
        order.current_state = SimpleNamespace(name='OPEN')
        order.exchange_order_id = 'exchange-ack'
        self.assertEqual(await task, 'reviewed')

    async def test_failed_or_uncertain_submission_is_not_success(self):
        failed = SimpleNamespace(current_state=SimpleNamespace(name='FAILED'), exchange_order_id=None)
        connector = SimpleNamespace(_order_tracker=SimpleNamespace(all_orders={'failed': failed}))
        with self.assertRaisesRegex(RuntimeError, 'failed before exchange acknowledgement'):
            await module.wait_for_submission(connector, 'failed', timeout=0)
        with self.assertRaisesRegex(TimeoutError, 'not retried'):
            await module.wait_for_submission(connector, 'missing', timeout=0)

    async def test_protection_survives_default_slippage_and_is_task_scoped(self):
        class Connector:
            def effective(self,trading_pair,trade_type,order_type,price):
                return price * Decimal('1.05')
            async def place(self,order_id,trading_pair,amount,trade_type,order_type,price,**kwargs):
                await asyncio.sleep(0)
                return self.effective(trading_pair,trade_type,order_type,price)
        Connector.effective=module.bounded_effective(Connector.effective)
        Connector.place=module.bounded_place(Connector.place)
        connector=Connector()
        protected,standard=await asyncio.gather(
            connector.place('p','BTC',1,'BUY',MARKET,Decimal('105'),quanttrade_protection_price=Decimal('101')),
            connector.place('s','BTC',1,'BUY',MARKET,Decimal('100')))
        self.assertEqual(protected,Decimal('101'))
        self.assertEqual(standard,Decimal('105'))
        self.assertIsNone(module._protection.get())
    async def test_invalid_bound_and_non_market_are_rejected_before_signing(self):
        calls=[]
        async def place(self,order_id,trading_pair,amount,trade_type,order_type,price,**kwargs):
            calls.append(price)
        wrapped=module.bounded_place(place)
        for price in ('0','NaN','-1','Infinity'):
            with self.assertRaises(ValueError):
                await wrapped(None,'id','BTC',1,'BUY',MARKET,1,quanttrade_protection_price=price)
        with self.assertRaises(ValueError):
            await wrapped(None,'id','BTC',1,'BUY',LIMIT,1,quanttrade_protection_price='101')
        self.assertEqual(calls,[])
    async def test_context_resets_on_submit_failure(self):
        async def place(self,order_id,trading_pair,amount,trade_type,order_type,price,**kwargs):
            raise RuntimeError('uncertain')
        with self.assertRaises(RuntimeError):
            await module.bounded_place(place)(None,'id','BTC',1,'BUY',MARKET,1,quanttrade_protection_price='101')
        self.assertIsNone(module._protection.get())

if __name__=='__main__':
    unittest.main()

class BuilderMarketSubmissionTests(unittest.IsolatedAsyncioTestCase):
    async def test_normal_builder_order_guard_reuses_exact_official_metadata_and_never_writes(self):
        import sys
        from unittest.mock import AsyncMock, patch
        proof=AsyncMock(return_value={'asset_id':180038,'collateral_token':0})
        with patch.dict(sys.modules,{'quanttrade_hummingbot_trading':SimpleNamespace(hl_builder_metadata=proof)}):
            await module.verify_builder_submission(SimpleNamespace(),'hyperliquid_perpetual','PARA:PAPER-USD')
            proof.assert_awaited_once()
    async def test_failed_builder_proof_is_not_swallowed_and_core_orders_are_untouched(self):
        import sys
        from unittest.mock import AsyncMock, patch
        proof=AsyncMock(side_effect=ValueError('wrong asset'))
        with patch.dict(sys.modules,{'quanttrade_hummingbot_trading':SimpleNamespace(hl_builder_metadata=proof)}):
            with self.assertRaises(ValueError):await module.verify_builder_submission(SimpleNamespace(),'hyperliquid_perpetual','PARA:PAPER-USD')
            await module.verify_builder_submission(SimpleNamespace(),'hyperliquid_perpetual','BTC-USD')
            self.assertEqual(proof.await_count,1)
