import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
import unittest

spec = importlib.util.spec_from_file_location('twap_evidence', Path(__file__).parents[1] / 'deployment/quanttrade-hummingbot-trading.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class TwapEvidenceTests(unittest.IsolatedAsyncioTestCase):
    def setup_read(self, rows):
        dto = module.HyperliquidTwapEvidenceRequest(request_id='twap-evidence-read', trading_pair='BTC-USD', twap_id='123', side='buy', amount='10')
        connector = SimpleNamespace(exchange_symbol_associated_to_pair=AsyncMock(return_value='BTC'), _auth=SimpleNamespace(_api_address='0x'+'a'*40), _api_post=AsyncMock(return_value=rows))
        return connector, dto

    def row(self, **fields):
        return {'twapId':123,'fill':{'coin':'BTC','oid':11,'tid':21,'sz':'2','px':'100','side':'B','time':1000,**fields}}

    async def test_exact_quantity_vwap_and_duplicates_never_claim_completion(self):
        first = self.row()
        c,dto = self.setup_read([first,first,self.row(tid=22,oid=12,sz='3',px='110')])
        self.assertEqual(await module.hyperliquid_twap_evidence(c,dto), {'twap_id':'123','verified_fill_size':'5','verified_fill_price':'106','history_may_be_truncated':False,'status':'fills-observed'})
        c._api_post.assert_awaited_once_with(path_url='/info',data={'type':'userTwapSliceFills','user':'0x'+'a'*40},is_auth_required=False)

    async def test_empty_history_is_unverified_not_proof_of_no_fills(self):
        c,dto = self.setup_read([])
        self.assertEqual(await module.hyperliquid_twap_evidence(c,dto), {'twap_id':'123','verified_fill_size':'0','history_may_be_truncated':False,'status':'unverified'})

    async def test_wrong_instrument_side_oversize_or_conflicting_duplicates_rejected(self):
        for rows in [[self.row(coin='ETH')],[self.row(side='A')],[self.row(sz='11')],[self.row(),self.row(sz='3')],[self.row(tid=None)]]:
            c,dto = self.setup_read(rows)
            with self.assertRaises(ValueError):
                await module.hyperliquid_twap_evidence(c,dto)

    async def test_other_twap_ignored_and_limited_history_disclosed(self):
        c,dto = self.setup_read([{'twapId':124,'fill':{}}]*1999+[self.row()])
        result = await module.hyperliquid_twap_evidence(c,dto)
        self.assertEqual(result['verified_fill_size'],'2')
        self.assertTrue(result['history_may_be_truncated'])
        self.assertEqual(result['status'],'fills-observed')
