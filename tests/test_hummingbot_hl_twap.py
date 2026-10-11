import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

spec = importlib.util.spec_from_file_location('hl_twap_trading', Path(__file__).parents[1] / 'deployment/quanttrade-hummingbot-trading.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class HyperliquidTwapTests(unittest.IsolatedAsyncioTestCase):
    async def test_exact_wire_and_ack_is_running_not_filled(self):
        dto = module.HyperliquidTwapRequest(request_id='native-twap-request', trading_pair='GRAM-USD', side='buy', amount='60.125', duration_minutes=5, randomize=True, reduce_only=False)
        with patch.object(module, 'hl_asset', AsyncMock(return_value=12)), patch.object(module, 'hl_action', AsyncMock(return_value={'status':'ok','response':{'type':'twapOrder','data':{'status':{'running':{'twapId':123}}}}})) as send:
            result = await module.hyperliquid_twap(SimpleNamespace(), dto)
            self.assertEqual(send.call_args.args[1], {'type':'twapOrder','twap':{'a':12,'b':True,'s':'60.125','r':False,'m':5,'t':True}})
            self.assertEqual(result['twap_id'], '123')
            self.assertNotIn('fill_size', result)

    async def test_error_and_ambiguous_ack_never_claim_acceptance(self):
        dto = module.HyperliquidTwapRequest(request_id='native-twap-request', trading_pair='GRAM-USD', side='buy', amount='60', duration_minutes=5, randomize=False, reduce_only=False)
        with patch.object(module,'hl_asset',AsyncMock(return_value=12)):
            for status in [{'error':'rejected'},{'running':{'twapId':True}},{'running':{'twapId':0}},{}]:
                with patch.object(module,'hl_action',AsyncMock(return_value={'status':'ok','response':{'type':'twapOrder','data':{'status':status}}})):
                    with self.assertRaises((module.ActionRejected,module.ActionUncertain)):
                        await module.hyperliquid_twap(SimpleNamespace(), dto)

    async def test_cancel_uses_twap_id_not_normal_oid(self):
        dto=module.HyperliquidTwapCancelRequest(request_id='native-twap-cancel',trading_pair='GRAM-USD',twap_id='123')
        with patch.object(module,'hl_asset',AsyncMock(return_value=12)), patch.object(module,'hl_action',AsyncMock(return_value={'status':'ok','response':{'type':'twapCancel','data':{'status':'success'}}})) as send:
            result=await module.hyperliquid_twap_cancel(SimpleNamespace(),dto)
            self.assertEqual(send.call_args.args[1],{'type':'twapCancel','a':12,'t':123})
            self.assertEqual(result['twap_id'],'123')

    async def test_reduce_only_requires_fresh_position_and_leverage_is_paired(self):
        dto=module.HyperliquidTwapRequest(request_id='native-twap-request',trading_pair='GRAM-USD',side='sell',amount='60',duration_minutes=5,randomize=False,reduce_only=True)
        with patch.object(module,'verify_exit_position',AsyncMock(side_effect=ValueError('no position'))) as proof, patch.object(module,'hl_action',AsyncMock()) as send:
            with self.assertRaises(ValueError):await module.hyperliquid_twap(SimpleNamespace(),dto)
            proof.assert_awaited_once();send.assert_not_called()

if __name__ == '__main__':
    unittest.main()
