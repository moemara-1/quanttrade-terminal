import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

spec=importlib.util.spec_from_file_location('hip3_readiness',Path(__file__).parents[1]/'deployment/quanttrade-hummingbot-trading.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class BuilderReadinessTests(unittest.IsolatedAsyncioTestCase):
    def connector(self, asset=180038, collateral=0):
        dexs=[None]+[{'name':f'd{i}'} for i in range(1,8)]+[{'name':'para'}]
        universe=[{'name':f'para:M{i}','maxLeverage':3,'onlyIsolated':True} for i in range(38)]+[{'name':'para:PAPER','maxLeverage':3,'onlyIsolated':True}]
        async def info(**kw):
            return dexs if kw['data']['type']=='perpDexs' else {'universe':universe,'collateralToken':collateral}
        return SimpleNamespace(_api_post=AsyncMock(side_effect=info),coin_to_asset={'para:PAPER':asset},_update_trading_rules=AsyncMock(),exchange_symbol_associated_to_pair=AsyncMock(return_value='para:PAPER'),trading_pair_associated_to_exchange_symbol=AsyncMock(return_value='PARA:PAPER-USD'),trading_rules={'PARA:PAPER-USD':SimpleNamespace()})
    def dto(self,**changes):
        return m.BuilderMarketRequest(account_name='desk',connection_revision='a'*64,trading_pair='PARA:PAPER-USD',dex='para',coin='para:PAPER',asset_id=180038,collateral_token=0,max_leverage=3,only_isolated=True,**changes)
    async def test_exact_official_index_including_null_holes_and_connector_map(self):
        c=self.connector();result=await m.builder_market_readiness(c,self.dto())
        self.assertEqual(result['asset_id'],180038);self.assertTrue(result['ready'])
        self.assertEqual(result['coin'],'para:PAPER');self.assertEqual(result['trading_pair'],'PARA:PAPER-USD')
        self.assertEqual({x.kwargs['data']['type'] for x in c._api_post.await_args_list},{'perpDexs','meta'})
    async def test_wrong_core_or_shifted_asset_never_ready(self):
        for asset in [38,190038]:
            with self.assertRaises(m.ActionRejected):await m.builder_market_readiness(self.connector(asset=asset),self.dto())
    async def test_non_usdc_or_stale_risk_metadata_rejected(self):
        with self.assertRaises(m.ActionRejected):await m.builder_market_readiness(self.connector(collateral=1),self.dto())
        dto=self.dto();dto.max_leverage=5
        with self.assertRaises(m.ActionRejected):await m.builder_market_readiness(self.connector(),dto)
    async def test_wrong_pair_case_and_wrong_coin_rejected(self):
        c=self.connector();c.exchange_symbol_associated_to_pair.return_value='PAPER'
        with self.assertRaises(m.ActionRejected):await m.builder_market_readiness(c,self.dto())
    async def test_builder_asset_signing_lookup_revalidates_official_mapping(self):
        c=self.connector()
        self.assertEqual(await m.hl_asset(c,'PARA:PAPER-USD'),180038)
        c.coin_to_asset['para:PAPER']=38
        with self.assertRaises(m.ActionRejected):await m.hl_asset(c,'PARA:PAPER-USD')
    async def test_isolated_only_leverage_rejects_cross_and_above_cap_before_signing(self):
        for value,mode in [(3,'cross'),(4,'isolated')]:
            with patch.object(m,'hl_action',AsyncMock()) as send:
                with self.assertRaises(m.ActionRejected):await m.leverage(self.connector(),'hyperliquid_perpetual','PARA:PAPER-USD',value,mode)
                send.assert_not_called()
    async def test_native_twap_fixture_signs_only_the_proven_builder_asset(self):
        c=self.connector()
        dto=m.HyperliquidTwapRequest(request_id='builder-twap-fixture',trading_pair='PARA:PAPER-USD',side='buy',amount='10',duration_minutes=5,randomize=False,reduce_only=False)
        ack={'status':'ok','response':{'type':'twapOrder','data':{'status':{'running':{'twapId':123}}}}}
        with patch.object(m,'hl_action',AsyncMock(return_value=ack)) as send:
            await m.hyperliquid_twap(c,dto)
            self.assertEqual(send.call_args.args[1],{'type':'twapOrder','twap':{'a':180038,'b':True,'s':'10','r':False,'m':5,'t':False}})
        c.coin_to_asset['para:PAPER']=38
        with patch.object(m,'hl_action',AsyncMock()) as send:
            with self.assertRaises(m.ActionRejected):await m.hyperliquid_twap(c,dto)
            send.assert_not_called()
    def test_passive_readiness_route_is_authenticated(self):
        from fastapi import FastAPI, HTTPException
        from fastapi.testclient import TestClient
        app=FastAPI()
        async def forbidden():raise HTTPException(status_code=401,detail='Unauthorized')
        m.install(app,forbidden)
        self.assertEqual(TestClient(app).post('/quanttrade/trading/builder-market-readiness',json=self.dto().model_dump()).status_code,401)

class BuilderCollateralTests(unittest.IsolatedAsyncioTestCase):
    connector=BuilderReadinessTests.connector
    def scoped_connector(self, mode='disabled', available='150', spot=None):
        c=self.connector();c._auth=SimpleNamespace(_api_address='fixture-owner')
        original=c._api_post.side_effect
        async def info(**kw):
            body=kw['data']
            if body['type']=='userAbstraction':return mode
            if body['type']=='clearinghouseState':return {'withdrawable':available if body.get('dex')=='para' else '0'}
            if body['type']=='spotClearinghouseState':return {'balances':spot if spot is not None else [{'coin':'USDC','token':0,'total':'200','hold':'75'}]}
            return await original(**kw)
        c._api_post=AsyncMock(side_effect=info);return c
    async def test_standard_builder_funds_are_read_from_its_dex_not_core(self):
        c=self.scoped_connector();result=await m.builder_available_collateral(c,m.BuilderCollateralRequest(account_name='desk',trading_pair='PARA:PAPER-USD'))
        self.assertEqual(result['available'],'150');self.assertEqual(result['scope'],'dex')
        reads=[x.kwargs['data'] for x in c._api_post.await_args_list if x.kwargs['data']['type']=='clearinghouseState']
        self.assertEqual(reads,[{'type':'clearinghouseState','user':'fixture-owner','dex':'para'}])
    async def test_unified_cash_without_initial_margin_proof_is_unverified_and_never_sums_dexs(self):
        c=self.scoped_connector(mode='unifiedAccount')
        with self.assertRaisesRegex(m.ActionRejected,'unverified'):
            await m.builder_available_collateral(c,m.BuilderCollateralRequest(trading_pair='PARA:PAPER-USD'))
        self.assertFalse(any(x.kwargs['data']['type']=='clearinghouseState' for x in c._api_post.await_args_list))
    async def test_unknown_modes_and_portfolio_valuation_are_unverified_not_zero(self):
        for mode in ['default','dexAbstraction','portfolioMargin',None,{}]:
            with self.assertRaisesRegex(m.ActionRejected,'unverified'):
                await m.builder_available_collateral(self.scoped_connector(mode=mode),m.BuilderCollateralRequest(trading_pair='PARA:PAPER-USD'))
    async def test_negative_nan_or_untyped_standard_balance_is_unverified(self):
        for available in ['-1','NaN','Infinity',None,100]:
            with self.assertRaises(m.ActionRejected):await m.builder_available_collateral(self.scoped_connector(available=available),m.BuilderCollateralRequest(trading_pair='PARA:PAPER-USD'))
    async def test_mode_change_during_balance_read_never_returns_available(self):
        c=self.scoped_connector();original=c._api_post.side_effect;count=0
        async def info(**kw):
            nonlocal count
            if kw['data']['type']=='userAbstraction':
                count+=1;return 'disabled' if count==1 else 'unifiedAccount'
            return await original(**kw)
        c._api_post.side_effect=info
        with self.assertRaisesRegex(m.ActionRejected,'changed'):await m.builder_available_collateral(c,m.BuilderCollateralRequest(trading_pair='PARA:PAPER-USD'))
