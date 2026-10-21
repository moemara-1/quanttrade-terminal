"""Private authenticated QuantTrade exchange actions; install(app, auth_user).

POST /quanttrade/trading/{leverage,margin,trigger-orders,cancel-order}
All DTOs require request_id (16..128 chars), account_name='desk', connector_name
in hyperliquid_perpetual/lighter_perpetual, and trading_pair in Hummingbot form.
Leverage: leverage:int, margin_mode:cross|isolated.
Margin: amount:decimal string (USDC, <=6 decimals), direction:add|remove.
Trigger: side:buy|sell, amount, trigger_price, execution_price:decimal strings,
trigger_kind:tp|sl, is_market:bool, reduce_only:bool (default true).
Cancel: exchange_order_id:decimal integer string. Lighter requires its actual
order index, NOT client_order_index or transaction hash.

Response status='accepted' means exchange accepted the transaction, never filled.
Trigger HL supplies exchange_order_id; Lighter supplies client_order_id+tx_hash,
which must be reconciled against exchange active orders before cancellation.
No automatic resubmission, even after transport failure. Caller must persist its
request state across service restarts; the in-process ledger is a second guard.
"""
import asyncio
import hashlib
import json
import time
from decimal import Decimal, InvalidOperation
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt


class ActionRejected(ValueError):
    pass


class ActionUncertain(RuntimeError):
    pass


def positive_decimal(value):
    value = Decimal(value)
    if not value.is_finite() or value <= 0:
        raise ValueError('Amount and price must be finite and positive')
    return value


def units(value, decimals):
    amount = positive_decimal(value) * (Decimal(10) ** decimals)
    if amount != amount.to_integral_value():
        raise ValueError('Value violates exchange precision')
    return int(amount)


class Scope(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: str = Field(min_length=16, max_length=128, pattern=r'^[A-Za-z0-9_-]+$')
    account_name: Literal['desk'] = 'desk'
    connector_name: Literal['hyperliquid_perpetual', 'lighter_perpetual', 'hyperliquid', 'lighter'] = 'hyperliquid_perpetual'
    trading_pair: str = Field(min_length=3, max_length=100, pattern=r'^[A-Za-z0-9_:./]+-[A-Za-z0-9]+$')


class LeverageRequest(Scope):
    connector_name: Literal['hyperliquid_perpetual', 'lighter_perpetual'] = 'hyperliquid_perpetual'
    leverage: StrictInt = Field(ge=1, le=125)
    margin_mode: Literal['cross', 'isolated'] = 'cross'


class MarginRequest(Scope):
    connector_name: Literal['hyperliquid_perpetual', 'lighter_perpetual'] = 'hyperliquid_perpetual'
    amount: str = Field(max_length=80, pattern=r'^[0-9]+(?:\.[0-9]+)?$')
    direction: Literal['add', 'remove']


class TriggerRequest(Scope):
    connector_name: Literal['hyperliquid_perpetual', 'lighter_perpetual'] = 'hyperliquid_perpetual'
    side: Literal['buy', 'sell']
    amount: str = Field(max_length=80, pattern=r'^[0-9]+(?:\.[0-9]+)?$')
    trigger_price: str = Field(max_length=80, pattern=r'^[0-9]+(?:\.[0-9]+)?$')
    execution_price: str = Field(max_length=80, pattern=r'^[0-9]+(?:\.[0-9]+)?$')
    trigger_kind: Literal['tp', 'sl']
    is_market: StrictBool = True
    reduce_only: StrictBool = True


class CancelRequest(Scope):
    exchange_order_id: str = Field(max_length=30, pattern=r'^[0-9]+$')


class OpenOrdersRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    account_name: Literal['desk'] = 'desk'
    connector_name: Literal['hyperliquid_perpetual', 'lighter_perpetual', 'hyperliquid', 'lighter']


class BuilderMarketRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    account_name: Literal['desk'] = 'desk'
    connection_revision: str = Field(pattern=r'^[a-f0-9]{64}$')
    trading_pair: str = Field(min_length=3, max_length=100)
    dex: str = Field(pattern=r'^[a-z0-9_]{1,30}$')
    coin: str = Field(min_length=3, max_length=90)
    asset_id: StrictInt = Field(ge=110000)
    collateral_token: StrictInt = Field(ge=0)
    max_leverage: StrictInt = Field(ge=1, le=125)
    only_isolated: StrictBool


class BuilderCollateralRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    account_name: Literal['desk'] = 'desk'
    trading_pair: str = Field(min_length=3, max_length=100, pattern=r'^[A-Za-z0-9_:./]+-USD$')


class ArenaAccountRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    account_name: Literal['desk'] = 'desk'
    connector_name: Literal['hyperliquid_perpetual', 'lighter_perpetual']
    trading_pair: str = Field(min_length=3, max_length=100, pattern=r'^[A-Za-z0-9_:./]+-[A-Za-z0-9]+$')


class BracketLeg(BaseModel):
    model_config = ConfigDict(extra='forbid')
    trigger_price: str = Field(max_length=80, pattern=r'^[0-9]+(?:\.[0-9]+)?$')
    execution_price: str = Field(max_length=80, pattern=r'^[0-9]+(?:\.[0-9]+)?$')
    is_market: StrictBool = True


class BracketRequest(Scope):
    connector_name: Literal['hyperliquid_perpetual', 'lighter_perpetual']
    side: Literal['buy', 'sell']
    amount: str = Field(max_length=80, pattern=r'^[0-9]+(?:\.[0-9]+)?$')
    take_profit: BracketLeg
    stop_loss: BracketLeg


class EntryBracketRequest(BracketRequest):
    connector_name: Literal['hyperliquid_perpetual'] = 'hyperliquid_perpetual'
    entry_price: str = Field(max_length=80, pattern=r'^[0-9]+(?:\.[0-9]+)?$')
    entry_tif: Literal['Ioc', 'Gtc', 'Alo']
    leverage: StrictInt | None = Field(default=None, ge=1, le=125)
    margin_mode: Literal['cross', 'isolated'] | None = None


class OrderEvidenceRequest(Scope):
    connector_name: Literal['hyperliquid_perpetual'] = 'hyperliquid_perpetual'
    exchange_order_id: str = Field(max_length=40, pattern=r'^(?:[0-9]+|0x[0-9a-f]{32})$')


class SettledOrderEvidenceRequest(OrderEvidenceRequest):
    amount: str = Field(max_length=80, pattern=r'^[0-9]+(?:\.[0-9]+)?$')
    side: Literal['buy', 'sell']


class AmendRequest(CancelRequest):
    amount: str = Field(max_length=80, pattern=r'^[0-9]+(?:\.[0-9]+)?$')
    price: str = Field(max_length=80, pattern=r'^[0-9]+(?:\.[0-9]+)?$')
    time_in_force: Literal['Gtc', 'Alo'] | None = None


class SnapshotRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    account_name: Literal['desk'] = 'desk'
    connector_name: Literal['hyperliquid_perpetual', 'lighter_perpetual', 'hyperliquid', 'lighter']
    trading_pair: str = Field(min_length=3, max_length=100, pattern=r'^[A-Za-z0-9_:./]+-[A-Za-z0-9]+$')
    history_cursor: str | None = Field(default=None, max_length=500)
    fills_cursor: str | None = Field(default=None, max_length=500)
    start_time: StrictInt = Field(default=0, ge=0)


class NativeOrderLeg(BaseModel):
    model_config = ConfigDict(extra='forbid')
    side: Literal['buy', 'sell']
    type: Literal['market', 'limit', 'sl-market', 'sl-limit', 'tp-market', 'tp-limit', 'twap']
    amount: str = Field(max_length=80, pattern=r'^[0-9]+(?:\.[0-9]+)?$')
    price: str = Field(max_length=80, pattern=r'^[0-9]+(?:\.[0-9]+)?$')
    trigger_price: str | None = Field(default=None, max_length=80, pattern=r'^[0-9]+(?:\.[0-9]+)?$')
    reduce_only: StrictBool = False
    time_in_force: Literal['ioc', 'gtt', 'post-only'] = 'ioc'
    expiry: StrictInt | None = Field(default=None, ge=1)
    duration_seconds: StrictInt | None = Field(default=None, ge=300, le=2592000)


class NativeOrderRequest(Scope):
    connector_name: Literal['lighter_perpetual'] = 'lighter_perpetual'
    grouping: Literal['single', 'oto', 'oco', 'otoco'] = 'single'
    legs: list[NativeOrderLeg] = Field(min_length=1, max_length=3)
    leverage: StrictInt | None = Field(default=None, ge=1, le=125)
    margin_mode: Literal['cross', 'isolated'] | None = None


async def lighter_native_orders(connector, dto, order_factory=None, now_ms=None):
    """Submit one reviewed native transaction. Acceptance is never fill proof."""
    counts = {'single': 1, 'oto': 2, 'oco': 2, 'otoco': 3}
    types = {'limit': 0, 'market': 1, 'sl-market': 2, 'sl-limit': 3, 'tp-market': 4, 'tp-limit': 5, 'twap': 6}
    tifs = {'ioc': 0, 'gtt': 1, 'post-only': 2}
    if len(dto.legs) != counts[dto.grouping]:
        raise ValueError('Native grouping has an invalid number of orders')
    if (dto.leverage is None) != (dto.margin_mode is None):
        raise ValueError('Leverage and margin mode must be reviewed together')
    parent = dto.legs[0]
    if any(leg.type.startswith(('sl-', 'tp-')) and leg.trigger_price is None for leg in dto.legs):
        raise ValueError('Conditional native orders require an explicit trigger price')
    children = dto.legs[1:] if dto.grouping in ['oto', 'otoco'] else []
    if children and parent.type not in ['market', 'limit']:
        raise ValueError('Native attached protection requires a market or limit entry')
    if dto.leverage is not None and (dto.grouping == 'oco' or parent.reduce_only):
        raise ValueError('Leverage changes require an opening parent order')
    for child in children:
        if Decimal(child.amount) != 0 or not child.reduce_only or child.side == parent.side or child.type not in ['sl-market', 'sl-limit', 'tp-market', 'tp-limit']:
            raise ValueError('Native attached exits require zero amount, reduce-only and opposite sides')
    siblings = dto.legs if dto.grouping == 'oco' else children if dto.grouping == 'otoco' else []
    if siblings:
        if {leg.type.split('-')[0] for leg in siblings} != {'tp', 'sl'} or len({leg.side for leg in siblings}) != 1 or len({Decimal(leg.amount) for leg in siblings}) != 1 or not all(leg.reduce_only for leg in siblings):
            raise ValueError('Native OCO requires matching reduce-only TP and SL exits')
        tp = next(leg for leg in siblings if leg.type.startswith('tp'))
        sl = next(leg for leg in siblings if leg.type.startswith('sl'))
        if not (positive_decimal(tp.trigger_price) > positive_decimal(sl.trigger_price) if tp.side == 'sell' else positive_decimal(tp.trigger_price) < positive_decimal(sl.trigger_price)):
            raise ValueError('Native OCO thresholds contradict the closing side')
    await connector._ensure_account_ready()
    market = connector.market_info_for_trading_pair(dto.trading_pair)
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    wires, ids = [], []
    for index, leg in enumerate(dto.legs):
        tied = leg in children or dto.grouping == 'oco' and Decimal(leg.amount) == 0
        amount = Decimal(leg.amount)
        size = 0 if tied else units(leg.amount, market.size_decimals)
        price = units(leg.price, market.price_decimals)
        conditional = leg.type.startswith(('sl-', 'tp-'))
        trigger_price = units(leg.trigger_price, market.price_decimals) if conditional else 0
        if not conditional and leg.trigger_price is not None:
            raise ValueError('Only conditional orders accept trigger prices')
        if size > (1 << 48) - 1 or price > (1 << 32) - 1 or trigger_price > (1 << 32) - 1:
            raise ValueError('Native order exceeds integer bounds')
        if not tied and (amount < market.min_base_amount or amount * Decimal(leg.price) < market.min_quote_amount):
            raise ActionRejected('Native order is below the market minimum')
        expiry = -1 if leg.expiry is None else leg.expiry
        if leg.expiry is not None and not 300000 <= leg.expiry - now_ms <= 2592000000:
            raise ValueError('Expiry must be between five minutes and thirty days')
        if leg.type == 'market' or leg.type == 'limit' and leg.time_in_force == 'ioc':
            if leg.expiry is not None:
                raise ValueError('Immediate entry orders cannot have an expiry')
            expiry = 0
        if leg.type in ['market', 'sl-market', 'tp-market'] and leg.time_in_force != 'ioc':
            raise ValueError('Market orders require immediate-or-cancel')
        if leg.type == 'twap':
            if dto.grouping != 'single' or leg.time_in_force != 'gtt' or leg.duration_seconds is None or leg.expiry is not None:
                raise ValueError('TWAP requires standalone GTT and a reviewed duration')
            expiry = now_ms + leg.duration_seconds * 1000
            slices = Decimal(leg.duration_seconds) / 30 + 1
            slice_amount = (Decimal(size) / slices).to_integral_value(rounding='ROUND_FLOOR') / (Decimal(10) ** market.size_decimals)
            if slice_amount < market.min_base_amount or slice_amount * Decimal(leg.price) < market.min_quote_amount:
                raise ActionRejected('TWAP slices are below the market minimum')
        elif leg.duration_seconds is not None:
            raise ValueError('Only TWAP accepts a duration')
        client_id = int(hashlib.sha256((dto.request_id + '-native-' + str(index)).encode()).hexdigest()[:12], 16) or 1
        ids.append(str(client_id))
        wires.append(dict(MarketIndex=market.market_id, ClientOrderIndex=client_id, BaseAmount=size, Price=price,
            IsAsk=int(leg.side == 'sell'), Type=types[leg.type], TimeInForce=tifs[leg.time_in_force],
            ReduceOnly=int(leg.reduce_only), TriggerPrice=trigger_price, OrderExpiry=expiry))
    if len(set(ids)) != len(ids):
        raise ValueError('Native client identities collide')
    if siblings and len({wire['OrderExpiry'] for wire in (wires if dto.grouping == 'oco' else wires[1:])}) != 1:
        raise ValueError('Native sibling exits must share the same expiry')
    if children and wires[0]['OrderExpiry'] != 0 and any(wire['OrderExpiry'] != wires[0]['OrderExpiry'] for wire in wires[1:]):
        raise ValueError('Resting parent and child expiries must match')
    for index, leg in enumerate(dto.legs):
        if leg.reduce_only and leg not in children:
            await verify_exit_position(connector, dto.connector_name, dto.trading_pair, leg.side, leg.amount)
    if dto.leverage is not None:
        await leverage(connector, dto.connector_name, dto.trading_pair, dto.leverage, dto.margin_mode)
    async with connector._tx_lock:
        if dto.grouping == 'single':
            wire = wires[0]
            result = lighter_ack(await connector._signer_client.create_order(market_index=wire['MarketIndex'], client_order_index=wire['ClientOrderIndex'],
                base_amount=wire['BaseAmount'], price=wire['Price'], is_ask=bool(wire['IsAsk']), order_type=wire['Type'], time_in_force=wire['TimeInForce'],
                reduce_only=bool(wire['ReduceOnly']), trigger_price=wire['TriggerPrice'], order_expiry=wire['OrderExpiry']))
        else:
            if order_factory is None:
                from lighter.signer_client import CreateOrderTxReq
                order_factory = CreateOrderTxReq
            result = lighter_ack(await connector._signer_client.create_grouped_orders(
                grouping_type={'oto': 1, 'oco': 2, 'otoco': 3}[dto.grouping], orders=[order_factory(**wire) for wire in wires]))
    return {**result, 'grouping': dto.grouping, 'client_order_ids': ids, 'connector_name': dto.connector_name, 'trading_pair': dto.trading_pair}


async def hl_builder_metadata(connector, pair):
    """Independent public metadata proof before a builder asset can be signed.

    Preserve null entries in perpDexs: their positions are part of asset identity.
    No balance aggregation, account-mode changes, or collateral transfers occur.
    """
    symbol = await connector.exchange_symbol_associated_to_pair(trading_pair=pair)
    if not isinstance(symbol, str) or ':' not in symbol:
        raise ActionRejected('Builder market coin mapping is unavailable')
    dex = symbol.split(':', 1)[0]
    dexs = await connector._api_post(path_url='/info', data={'type': 'perpDexs'}, is_auth_required=False)
    if not isinstance(dexs, list) or len(dexs) > 100:
        raise ActionRejected('Builder DEX catalog is unavailable or exceeds the supported bound')
    indices = [i for i, row in enumerate(dexs) if isinstance(row, dict) and row.get('name') == dex]
    if len(indices) != 1 or indices[0] < 1:
        raise ActionRejected('Builder DEX identity is unavailable or ambiguous')
    meta = await connector._api_post(path_url='/info', data={'type': 'meta', 'dex': dex}, is_auth_required=False)
    if not isinstance(meta, dict) or not isinstance(meta.get('universe'), list) or len(meta['universe']) > 10000:
        raise ActionRejected('Builder market metadata is unavailable')
    matches = [(i, row) for i, row in enumerate(meta['universe']) if isinstance(row, dict) and row.get('name') == symbol]
    if len(matches) != 1 or matches[0][1].get('isDelisted', False):
        raise ActionRejected('Builder market is unavailable or delisted')
    index, market = matches[0]
    asset = 100000 + indices[0] * 10000 + index
    if type(meta.get('collateralToken')) is not int or meta['collateralToken'] != 0:
        raise ActionRejected('Only USDC-collateral builder execution is verified; this market uses another or unknown collateral')
    if type(market.get('maxLeverage')) is not int or not 1 <= market['maxLeverage'] <= 125:
        raise ActionRejected('Builder leverage limits are unavailable')
    if 'onlyIsolated' in market and type(market['onlyIsolated']) is not bool:
        raise ActionRejected('Builder margin mode limits are unavailable')
    if not connector.coin_to_asset or symbol not in connector.coin_to_asset:
        await connector._update_trading_rules()
    if type(connector.coin_to_asset.get(symbol)) is not int or connector.coin_to_asset[symbol] != asset:
        raise ActionRejected('Builder asset mapping does not match official metadata; no order was submitted')
    mapped_pair = await connector.trading_pair_associated_to_exchange_symbol(symbol=symbol)
    if mapped_pair != pair or pair not in connector.trading_rules:
        raise ActionRejected('Builder trading pair or precision rules are unavailable')
    return {'dex': dex, 'coin': symbol, 'asset_id': asset, 'collateral_token': 0,
            'max_leverage': market['maxLeverage'], 'only_isolated': market.get('onlyIsolated', False) is True,
            'trading_pair': mapped_pair}


async def builder_market_readiness(connector, dto):
    metadata = await hl_builder_metadata(connector, dto.trading_pair)
    for field in ['dex', 'coin', 'asset_id', 'collateral_token', 'max_leverage', 'only_isolated']:
        if metadata[field] != getattr(dto, field):
            raise ActionRejected('Builder market metadata changed; refresh and review the trade again')
    return {'ready': True, 'account_name': dto.account_name, 'connection_revision': dto.connection_revision, **metadata}


async def builder_available_collateral(connector, dto):
    """Read only independently scoped standard-mode collateral.

    Unified spot cash minus holds is not proof of spare initial margin across
    all DEXs. Until that proof exists, shared/default/legacy modes are unknown,
    never a fabricated zero or a sum of the same shared collateral.
    """
    metadata = await hl_builder_metadata(connector, dto.trading_pair)
    owner = connector._auth._api_address
    async def info(body):
        return await connector._api_post(path_url='/info', data={**body, 'user': owner}, is_auth_required=False)
    mode = await info({'type': 'userAbstraction'})
    if mode != 'disabled':
        raise ActionRejected('Builder available collateral is unverified for this account abstraction mode; shared collateral is not assumed available or zero')
    state = await info({'type': 'clearinghouseState', 'dex': metadata['dex']})
    try:
        if not isinstance(state, dict) or not isinstance(state.get('withdrawable'), str):
            raise ValueError('Missing withdrawable')
        available = Decimal(state['withdrawable'])
    except (ValueError, InvalidOperation):
        raise ActionRejected('Builder DEX available collateral is unverified') from None
    if not available.is_finite() or available < 0:
        raise ActionRejected('Builder available collateral is unverified')
    if await info({'type': 'userAbstraction'}) != mode:
        raise ActionRejected('Account abstraction mode changed during collateral verification')
    return {'verified': True, 'account_name': dto.account_name, 'trading_pair': dto.trading_pair,
            'coin': metadata['coin'], 'dex': metadata['dex'], 'collateral_token': 0,
            'currency': 'USDC', 'available': format(available, 'f') if available else '0', 'account_mode': mode, 'scope': 'dex'}


async def arena_account_state(connector, dto):
    """Exact native account evidence for explicitly armed agents, never defaults."""
    def number(value, signed=False):
        if not isinstance(value, (str, int, float)) or isinstance(value, bool):
            raise ActionRejected('Live bot account numeric evidence is unverified')
        try:
            n = Decimal(str(value))
            if not n.is_finite() or not signed and n < 0:
                raise ValueError('Invalid number')
            return format(n, 'f') if n else '0'
        except (ValueError, InvalidOperation):
            raise ActionRejected('Live bot account numeric evidence is unverified') from None
    hl = dto.connector_name == 'hyperliquid_perpetual'
    positions = []
    if hl:
        coin = await connector.exchange_symbol_associated_to_pair(trading_pair=dto.trading_pair)
        dex = coin.split(':', 1)[0] if ':' in coin else ''
        if dex:
            await hl_builder_metadata(connector, dto.trading_pair)
        owner = connector._auth._api_address
        async def info(data):
            return await connector._api_post(path_url='/info', data={**data, 'user': owner}, is_auth_required=False)
        mode = await info({'type': 'userAbstraction'})
        if mode != 'disabled':
            raise ActionRejected('Live bot available margin and equity are unverified for this Hyperliquid account mode')
        state, raw_orders = await asyncio.gather(info({'type': 'clearinghouseState', 'dex': dex}), info({'type': 'frontendOpenOrders', 'dex': dex}))
        if not isinstance(state, dict) or not isinstance(state.get('marginSummary'), dict) or not isinstance(state.get('assetPositions'), list):
            raise ActionRejected('Live bot account equity or position coverage is unverified')
        equity, available = number(state['marginSummary'].get('accountValue')), number(state.get('withdrawable'))
        for raw in state['assetPositions']:
            p = raw.get('position') if isinstance(raw, dict) else None
            if not isinstance(p, dict) or not isinstance(p.get('coin'), str):
                raise ActionRejected('Live bot position identity is unverified')
            size = Decimal(number(p.get('szi'), True))
            if size:
                positions.append({'symbol': p['coin'] + '-USDC', 'side': 'long' if size > 0 else 'short', 'size': str(abs(size)), 'entry_price': number(p.get('entryPx'))})
        if await info({'type': 'userAbstraction'}) != mode:
            raise ActionRejected('Live bot account mode changed during its read')
    else:
        await connector._ensure_account_ready()
        result = await connector._api_get(path_url='/api/v1/account', params={'by': 'index', 'value': connector._account_index}, is_auth_required=True)
        if not isinstance(result, dict) or result.get('code') != 200 or not isinstance(result.get('accounts'), list) or len(result['accounts']) != 1:
            raise ActionRejected('Live bot account scope is unverified')
        state = result['accounts'][0]
        if not isinstance(state, dict) or not isinstance(state.get('assets'), list) or not isinstance(state.get('positions'), list):
            raise ActionRejected('Live bot account equity or positions are unverified')
        usdc = [a for a in state['assets'] if isinstance(a, dict) and a.get('symbol') == 'USDC']
        if len(usdc) != 1:
            raise ActionRejected('Live bot USDC collateral is unverified')
        equity, available = number(usdc[0].get('margin_balance')), number(state.get('available_balance'))
        for p in state['positions']:
            size = Decimal(number(p.get('position')))
            if size:
                market = connector.market_info_for_market_id(p.get('market_id'))
                if p.get('sign') not in (-1, 1) or market.market_type != 'perp':
                    raise ActionRejected('Live bot position identity is unverified')
                positions.append({'symbol': market.trading_pair, 'side': 'long' if p['sign'] == 1 else 'short', 'size': str(size), 'entry_price': number(p.get('avg_entry_price'))})
        active = await connector._api_get(path_url='/api/v1/accountActiveOrders', params={'account_index': connector._account_index, 'market_type': 'perp'}, is_auth_required=True)
        if not isinstance(active, dict) or active.get('code') != 200 or active.get('next_cursor'):
            raise ActionRejected('Live bot active order coverage is unverified')
        raw_orders = active.get('orders')
    coverage = await open_orders(connector, dto.connector_name)
    if not coverage.get('complete') or not isinstance(raw_orders, list):
        raise ActionRejected('Live bot exchange order coverage is incomplete')
    orders = []
    for row in raw_orders:
        if not isinstance(row, dict):
            raise ActionRejected('Live bot native order identity is unverified')
        if hl:
            order_coin = row.get('coin')
            if not isinstance(order_coin, str) or row.get('side') not in ('A', 'B') or not isinstance(row.get('reduceOnly'), bool):
                raise ActionRejected('Live bot native order identity is unverified')
            oid, client = row.get('oid'), row.get('cloid')
            symbol, side, reduce_only = order_coin + '-USDC', 'buy' if row['side'] == 'B' else 'sell', row['reduceOnly']
            trigger = row.get('triggerPx')
            size = number(row['sz']) if row.get('sz') is not None else None
            full_position = False
        else:
            market = connector.market_info_for_market_id(row.get('market_index', row.get('market_id')))
            oid, client = lighter_order_id(row), row.get('client_order_index')
            if not isinstance(row.get('is_ask'), bool) or not isinstance(row.get('reduce_only'), bool):
                raise ActionRejected('Live bot native order side is unverified')
            symbol, side, reduce_only = market.trading_pair, 'sell' if row['is_ask'] else 'buy', row['reduce_only']
            trigger = row.get('trigger_price')
            size = number(row['remaining_base_amount']) if row.get('remaining_base_amount') is not None else None
            parent = row.get('parent_order_index', row.get('parent_order_id'))
            full_position = (reduce_only and size is not None and Decimal(size) == 0 and row.get('initial_base_amount') is not None
                and Decimal(number(row['initial_base_amount'])) == 0
                and row.get('type') in ('stop-loss', 'stop-loss-limit', 'take-profit', 'take-profit-limit')
                and not isinstance(parent, bool) and str(parent).isdigit() and int(parent) > 0)
        if isinstance(oid, bool) or not str(oid).isdigit() or int(oid) <= 0:
            raise ActionRejected('Live bot native order ID is unverified')
        orders.append({'symbol': symbol, 'order_id': str(oid), 'client_order_id': str(client) if client is not None else None, 'reduce_only': reduce_only, 'side': side, 'size': size, 'full_position': full_position, 'trigger_price': number(trigger) if trigger is not None and Decimal(number(trigger)) > 0 else None})
    return {'account_name': dto.account_name, 'connector_name': dto.connector_name, 'trading_pair': dto.trading_pair, 'complete': True, 'equity': equity, 'available_margin': available, 'positions': positions, 'orders': orders}


async def hl_asset(connector, pair):
    if not connector.coin_to_asset:
        await connector._update_trading_rules()
    symbol = await connector.exchange_symbol_associated_to_pair(trading_pair=pair)
    if ':' in symbol:
        return (await hl_builder_metadata(connector, pair))['asset_id']
    if symbol not in connector.coin_to_asset:
        raise ActionRejected('Market is unavailable on this account connector')
    return connector.coin_to_asset[symbol]


async def hl_action(connector, action):
    # Core auth only knows order/cancel/leverage. Sign the exact documented wire
    # action using the installed signer, then send without a second auth rewrite.
    lock = getattr(connector, '_quanttrade_action_lock', None)
    if lock is None:
        lock = asyncio.Lock()
        connector._quanttrade_action_lock = lock
    async with lock:
        auth = connector._auth
        nonce = max(int(auth._get_timestamp() * 1000), getattr(connector, '_quanttrade_last_nonce', 0) + 1)
        connector._quanttrade_last_nonce = nonce
        mainnet = not connector.domain.endswith('testnet') if hasattr(connector, 'domain') else True
        signature = auth.sign_l1_action(auth.wallet, action, auth._vault_address, nonce, mainnet)
        response = await connector._api_post(path_url='/exchange', data={
            'action': action, 'nonce': nonce, 'signature': signature, 'vaultAddress': auth._vault_address,
        }, is_auth_required=False)
    if not isinstance(response, dict) or response.get('status') != 'ok':
        raise ActionRejected('Exchange rejected the action')
    return response


def hl_default(response):
    if response.get('response', {}).get('type') != 'default':
        raise ActionUncertain('Exchange action acknowledgment is unrecognized; inspect account state')
    return {'status': 'accepted'}


def lighter_ack(result):
    if not isinstance(result, tuple) or len(result) != 3:
        raise ActionUncertain('Exchange action acknowledgment is unrecognized; inspect account state')
    _, response, error = result
    if error is not None or response is None or getattr(response, 'code', None) != 200:
        raise ActionRejected('Exchange rejected the action')
    tx_hash = getattr(response, 'tx_hash', None)
    if not isinstance(tx_hash, str) or not tx_hash:
        raise ActionUncertain('Exchange did not provide a transaction hash; inspect account state')
    return {'status': 'accepted', 'tx_hash': tx_hash}


def lighter_order_id(order):
    """SDK order_index is native; order_id is its decimal-string alias.

    Never substitute client_order_index/client_order_id, which identify a client
    submission rather than the exchange order. Reject conflicting native aliases.
    """
    index, alias = order.get('order_index'), order.get('order_id')
    def valid(value):
        return not isinstance(value, bool) and isinstance(value, (int, str)) and str(value).isdigit() and int(value) > 0
    if (index is not None and not valid(index)) or (alias is not None and not valid(alias)):
        raise ActionUncertain('Native order identity is invalid; inspect exchange orders')
    if index is None and alias is None:
        raise ActionUncertain('Native order identity is unavailable; inspect exchange orders')
    if index is not None and alias is not None and int(index) != int(alias):
        raise ActionUncertain('Native order identity aliases disagree; inspect exchange orders')
    return str(index if index is not None else alias)


async def leverage(connector, name, pair, value, mode):
    if name == 'hyperliquid_perpetual':
        if ':' in pair:
            metadata = await hl_builder_metadata(connector, pair)
            if value > metadata['max_leverage'] or metadata['only_isolated'] and mode != 'isolated':
                raise ActionRejected('Builder leverage or margin mode violates the market limits')
        result = hl_default(await hl_action(connector, {'type': 'updateLeverage', 'asset': await hl_asset(connector, pair), 'isCross': mode == 'cross', 'leverage': value}))
    else:
        await connector._ensure_account_ready()
        market = connector.market_info_for_trading_pair(pair)
        signer = connector._signer_client
        async with connector._tx_lock:
            result = lighter_ack(await signer.update_leverage(market_index=market.market_id,
                margin_mode=signer.CROSS_MARGIN_MODE if mode == 'cross' else signer.ISOLATED_MARGIN_MODE, leverage=value))
    connector._perpetual_trading.set_leverage(pair, value)
    return result


async def margin(connector, name, pair, amount, direction):
    micro = units(amount, 6)
    if name == 'hyperliquid_perpetual':
        return hl_default(await hl_action(connector, {'type': 'updateIsolatedMargin', 'asset': await hl_asset(connector, pair), 'isBuy': True, 'ntli': micro if direction == 'add' else -micro}))
    await connector._ensure_account_ready()
    market = connector.market_info_for_trading_pair(pair)
    signer = connector._signer_client
    async with connector._tx_lock:
        # Decimal works with installed SDK's int(usdc_amount * 1e6), avoiding
        # float rounding that can silently lose a micro-USDC.
        return lighter_ack(await signer.update_margin(market_index=market.market_id, usdc_amount=Decimal(amount),
            direction=signer.ISOLATED_MARGIN_ADD_COLLATERAL if direction == 'add' else signer.ISOLATED_MARGIN_REMOVE_COLLATERAL))


async def trigger(connector, name, pair, side, amount, trigger_price, execution_price, kind, is_market, reduce_only, request_id):
    for value in [amount, trigger_price, execution_price]:
        positive_decimal(value)
    if reduce_only:
        # An accepted conditional transaction does not prove it protects a
        # position. Reject exits until fresh account-scoped position evidence
        # proves the reviewed side and amount can actually reduce that market.
        await verify_exit_position(connector, name, pair, side, amount)
    if name == 'hyperliquid_perpetual':
        # Use decimal wire strings rather than float conversion. Exchange checks
        # remaining venue-specific significant digits/minimums.
        client_id = '0x' + hashlib.sha256(request_id.encode()).hexdigest()[:32]
        response = await hl_action(connector, {'type': 'order', 'grouping': 'na', 'orders': [{
            'a': await hl_asset(connector, pair), 'b': side == 'buy', 'p': execution_price, 's': amount,
            'r': reduce_only, 't': {'trigger': {'isMarket': is_market, 'triggerPx': trigger_price, 'tpsl': kind}}, 'c': client_id,
        }]})
        statuses = response.get('response', {}).get('data', {}).get('statuses', [])
        if len(statuses) != 1 or not isinstance(statuses[0], dict):
            raise ActionUncertain('Trigger acknowledgment is unrecognized; inspect exchange orders')
        if 'error' in statuses[0]:
            raise ActionRejected('Exchange rejected the trigger order')
        order = statuses[0].get('resting') or statuses[0].get('filled')
        if not isinstance(order, dict) or not isinstance(order.get('oid'), int):
            raise ActionUncertain('Trigger acknowledgment is unrecognized; inspect exchange orders')
        return {'status': 'accepted', 'client_order_id': client_id, 'exchange_order_id': str(order['oid'])}
    await connector._ensure_account_ready()
    market = connector.market_info_for_trading_pair(pair)
    size = units(amount, market.size_decimals)
    price = units(execution_price, market.price_decimals)
    trigger_units = units(trigger_price, market.price_decimals)
    client_id = connector._new_client_order_id()
    async with connector._tx_lock:
        result = lighter_ack(await connector._signer_client.create_order(market_index=market.market_id, client_order_index=int(client_id),
            base_amount=size, price=price, is_ask=side == 'sell', order_type=(2 if is_market else 3) if kind == 'sl' else (4 if is_market else 5),
            time_in_force=0 if is_market else 1, reduce_only=reduce_only, trigger_price=trigger_units, order_expiry=-1))
    return {**result, 'client_order_id': str(client_id)}


async def verify_exit_position(connector, name, pair, side, amount):
    """Fresh native position proof; never rely on cached frontend balances."""
    if name == 'hyperliquid_perpetual':
        symbol = await connector.exchange_symbol_associated_to_pair(trading_pair=pair)
        state = await connector._api_post(path_url='/info', data={'type': 'clearinghouseState',
            'user': connector._auth._api_address, 'dex': symbol.split(':', 1)[0] if ':' in symbol else ''}, is_auth_required=False)
        if not isinstance(state, dict) or not isinstance(state.get('assetPositions'), list):
            raise ActionRejected('Cannot verify existing position for reduce-only exits')
        matches = [row.get('position', {}) for row in state['assetPositions'] if row.get('position', {}).get('coin') == symbol]
        signed = Decimal(matches[0]['szi']) if len(matches) == 1 else Decimal(0)
    else:
        await connector._ensure_account_ready()
        market = connector.market_info_for_trading_pair(pair)
        state = await connector._api_get(path_url='/api/v1/account', params={'by': 'index', 'value': connector._account_index}, is_auth_required=True)
        accounts = state.get('accounts') if isinstance(state, dict) and state.get('code') == 200 else None
        if not isinstance(accounts, list):
            raise ActionRejected('Cannot verify existing position for reduce-only exits')
        account = [row for row in accounts if str(row.get('index')) == str(connector._account_index)]
        if len(account) != 1 or not isinstance(account[0].get('positions'), list):
            raise ActionRejected('Cannot verify account-scoped position for reduce-only exits')
        matches = [row for row in account[0]['positions'] if row.get('market_id') == market.market_id]
        signed = Decimal(matches[0]['position']) * Decimal(matches[0]['sign']) if len(matches) == 1 else Decimal(0)
    if not signed.is_finite() or signed == 0 or (side == 'sell' and signed < 0) or (side == 'buy' and signed > 0) or Decimal(amount) > abs(signed):
        raise ActionRejected('Reduce-only exits require an existing same-market position, an opposite closing side and an amount within its current size')


async def bracket(connector, name, pair, side, amount, take_profit, stop_loss, request_id, order_factory=None):
    """Exchange-native OCO exits, never two independent trigger submissions.

    Protects an existing position. Does not create an entry or emulate OCO in
    the application. Partial/unrecognized acknowledgments remain uncertain.
    """
    if name == 'hyperliquid_perpetual':
        raise ActionRejected('Hyperliquid native OCO requires entry-attached TP/SL in a normalTpsl bracket')
    positive_decimal(amount)
    for leg in [take_profit, stop_loss]:
        positive_decimal(leg['trigger_price'])
        positive_decimal(leg['execution_price'])
    tp, sl = Decimal(take_profit['trigger_price']), Decimal(stop_loss['trigger_price'])
    if (side == 'sell' and tp <= sl) or (side == 'buy' and tp >= sl):
        raise ValueError('Take-profit and stop-loss thresholds contradict position side')
    await verify_exit_position(connector, name, pair, side, amount)
    if name != 'lighter_perpetual':
        raise ValueError('Native OCO is only verified for perpetual connectors')
    await connector._ensure_account_ready()
    market = connector.market_info_for_trading_pair(pair)
    if order_factory is None:
        from lighter.signer_client import CreateOrderTxReq
        order_factory = CreateOrderTxReq
    orders, ids = [], []
    for kind, leg in [('tp', take_profit), ('sl', stop_loss)]:
        # A deterministic 48-bit client ID remains stable under reconciliation.
        client_id = int(hashlib.sha256((request_id + '-' + kind).encode()).hexdigest()[:12], 16)
        ids.append(str(client_id))
        orders.append(order_factory(MarketIndex=market.market_id, ClientOrderIndex=client_id,
            BaseAmount=units(amount, market.size_decimals), Price=units(leg['execution_price'], market.price_decimals),
            IsAsk=int(side == 'sell'), Type=(4 if leg['is_market'] else 5) if kind == 'tp' else (2 if leg['is_market'] else 3),
            TimeInForce=0 if leg['is_market'] else 1, ReduceOnly=1,
            TriggerPrice=units(leg['trigger_price'], market.price_decimals), OrderExpiry=-1))
    async with connector._tx_lock:
        result = lighter_ack(await connector._signer_client.create_grouped_orders(grouping_type=2, orders=orders))
    return {**result, 'grouping': 'oco', 'client_order_ids': ids}


async def entry_bracket(connector, dto):
    """Official normalTpsl: entry plus two fixed-size reduce-only children."""
    amount, reference = positive_decimal(dto.amount), positive_decimal(dto.entry_price)
    tp, sl = dto.take_profit.model_dump(), dto.stop_loss.model_dump()
    for leg in [tp, sl]:
        positive_decimal(leg['trigger_price'])
        positive_decimal(leg['execution_price'])
    tp_price, sl_price = Decimal(tp['trigger_price']), Decimal(sl['trigger_price'])
    if not (sl_price < reference < tp_price if dto.side == 'buy' else tp_price < reference < sl_price):
        raise ValueError('Entry bracket thresholds must protect the reviewed entry side')
    if (dto.leverage is None) != (dto.margin_mode is None):
        raise ValueError('Leverage and margin mode must be reviewed together')
    asset = await hl_asset(connector, dto.trading_pair)
    client_ids = ['0x' + hashlib.sha256((dto.request_id + '-' + kind).encode()).hexdigest()[:32] for kind in ['entry', 'tp', 'sl']]
    orders = [{'a': asset, 'b': dto.side == 'buy', 'p': dto.entry_price, 's': dto.amount,
        'r': False, 't': {'limit': {'tif': dto.entry_tif}}, 'c': client_ids[0]}]
    for index, (kind, leg) in enumerate([('tp', tp), ('sl', sl)], 1):
        orders.append({'a': asset, 'b': dto.side != 'buy', 'p': leg['execution_price'], 's': dto.amount,
            'r': True, 't': {'trigger': {'isMarket': leg['is_market'], 'triggerPx': leg['trigger_price'], 'tpsl': kind}}, 'c': client_ids[index]})
    if dto.leverage is not None:
        await leverage(connector, dto.connector_name, dto.trading_pair, dto.leverage, dto.margin_mode)
    response = await hl_action(connector, {'type': 'order', 'grouping': 'normalTpsl', 'orders': orders})
    statuses = response.get('response', {}).get('data', {}).get('statuses', [])
    if len(statuses) != 3:
        raise ActionUncertain('Entry bracket acknowledgment is incomplete; inspect entry and both exits')
    identities, fill = [], {}
    for index, status in enumerate(statuses):
        if index > 0 and status in ['waitingForFill', 'waitingForTrigger']:
            identities.append(client_ids[index])
            continue
        order = (status.get('resting') or status.get('filled')) if isinstance(status, dict) else None
        if not isinstance(order, dict) or not isinstance(order.get('oid'), int) or isinstance(order.get('oid'), bool) or order['oid'] <= 0:
            raise ActionUncertain('Entry bracket leg was not confirmed; inspect exchange state before any new action')
        identities.append(str(order['oid']))
        if index == 0 and isinstance(status.get('filled'), dict):
            size, price = str(order.get('totalSz', '')), str(order.get('avgPx', ''))
            try:
                if positive_decimal(size) > amount:
                    raise ValueError('Oversized fill')
                positive_decimal(price)
            except (ValueError, ArithmeticError):
                raise ActionUncertain('Entry bracket fill acknowledgment is invalid; inspect exchange fills') from None
            fill = {'fill_size': size, 'fill_price': price}
    if len(set(identities)) != 3:
        raise ActionUncertain('Entry bracket identities are inconsistent; inspect exchange state')
    return {'status': 'accepted', 'grouping': 'normalTpsl', 'order_ids': identities,
        'client_order_ids': client_ids, 'entry_order_id': identities[0], **fill}


async def order_evidence(connector, pair, order_id):
    symbol = await connector.exchange_symbol_associated_to_pair(trading_pair=pair)
    owner = connector._auth._api_address
    identity = order_id if order_id.startswith('0x') else int(order_id)
    result = await connector._api_post(path_url='/info', data={'type': 'orderStatus', 'user': owner, 'oid': identity}, is_auth_required=False)
    if not isinstance(result, dict) or result.get('status') != 'order':
        return {'status': 'pending', 'error': 'Native entry status is not visible yet; only verification reads will retry'}
    record = result.get('order', {})
    order = record.get('order', {})
    if order.get('coin') != symbol or str(order.get('oid', '')).isdigit() is False:
        raise ActionRejected('Native order does not match the reviewed instrument')
    if record.get('status') in ['open', 'triggered']:
        return {'status': 'pending'}
    if record.get('status') != 'filled':
        return {'status': 'failed', 'error': 'Native entry is ' + str(record.get('status', 'unverified'))}
    timestamp, expected = order.get('timestamp'), positive_decimal(order.get('origSz', '0'))
    if not isinstance(timestamp, int) or isinstance(timestamp, bool) or timestamp < 0:
        return {'status': 'pending', 'error': 'Filled entry has no reliable timestamp yet; inspect exchange fills'}
    size, notional, seen = Decimal(0), Decimal(0), set()
    for _ in range(10):
        rows = await connector._api_post(path_url='/info', data={'type': 'userFillsByTime', 'user': owner, 'startTime': timestamp, 'aggregateByTime': False}, is_auth_required=False)
        if not isinstance(rows, list):
            return {'status': 'pending', 'error': 'Native entry fills are temporarily unavailable'}
        for row in rows:
            if str(row.get('oid')) != str(order['oid']) or row.get('coin') != symbol:
                continue
            tid = row.get('tid')
            if not isinstance(tid, (int, str)) or isinstance(tid, bool):
                return {'status': 'pending', 'error': 'Native entry fills lack stable identities; verification remains blocked'}
            if str(tid) in seen:
                continue
            seen.add(str(tid))
            filled_size, price = positive_decimal(row.get('sz', '0')), positive_decimal(row.get('px', '0'))
            size += filled_size
            notional += filled_size * price
        if size == expected:
            return {'status': 'filled', 'fillSize': str(size), 'fillPrice': str(notional / size)}
        if size > expected:
            return {'status': 'failed', 'error': 'Native fills exceed the reviewed entry size; inspect exchange fills'}
        if len(rows) < 2000:
            break
        times = [row.get('time') for row in rows]
        if not all(isinstance(value, int) and not isinstance(value, bool) and value >= timestamp for value in times):
            break
        # Retain boundary timestamp; deduplicate fill IDs rather than skip fills
        # sharing the last millisecond. If a page cannot advance, fail closed.
        next_timestamp = max(times)
        if next_timestamp == timestamp:
            break
        timestamp = next_timestamp
    return {'status': 'pending', 'error': 'Native fill history does not yet prove the complete reviewed entry; only verification reads will retry'}


async def settled_order_evidence(connector, pair, order_id, amount, side):
    """Read-only proof for cancel/reconcile/replace; acknowledgments are not proof."""
    pending = {'status': 'pending'}
    symbol = await connector.exchange_symbol_associated_to_pair(trading_pair=pair)
    owner, reviewed = connector._auth._api_address, positive_decimal(amount)
    if not order_id.isdigit() or int(order_id) <= 0:
        return pending
    async def status_read():
        result = await connector._api_post(path_url='/info', data={'type': 'orderStatus', 'user': owner, 'oid': int(order_id)}, is_auth_required=False)
        if not isinstance(result, dict) or result.get('status') != 'order':
            return None
        record = result.get('order')
        if not isinstance(record, dict) or not isinstance(record.get('order'), dict):
            return None
        order = record['order']
        if order.get('coin') != symbol or str(order.get('oid')) != order_id or order.get('side') != ('B' if side == 'buy' else 'A'):
            return None
        try:
            if positive_decimal(order.get('origSz', '')) != reviewed:
                return None
        except (ValueError, ArithmeticError):
            return None
        return record
    record = await status_read()
    if record is None:
        return pending
    terminal = record.get('status')
    if terminal not in ('open', 'filled') and not (isinstance(terminal, str) and (terminal == 'canceled' or terminal.endswith('Canceled'))):
        return pending
    order = record['order']
    timestamp = order.get('timestamp')
    if not isinstance(timestamp, int) or isinstance(timestamp, bool) or timestamp < 0:
        return pending
    raw_remaining = order.get('sz')
    if not isinstance(raw_remaining, (str, int, float)) or isinstance(raw_remaining, bool):
        return pending
    try:
        remaining = Decimal(str(raw_remaining))
        if not remaining.is_finite() or remaining < 0 or remaining > reviewed:
            return pending
    except ArithmeticError:
        return pending
    if terminal == 'open':
        return {'status': 'open', 'filledSize': str(reviewed - remaining), 'exchangeId': order_id}
    expected = reviewed if terminal == 'filled' else reviewed - remaining
    total, seen, complete = Decimal(0), {}, False
    for _ in range(100):
        rows = await connector._api_post(path_url='/info', data={'type': 'userFillsByTime', 'user': owner, 'startTime': timestamp, 'aggregateByTime': False}, is_auth_required=False)
        if not isinstance(rows, list):
            return pending
        for row in rows:
            if not isinstance(row, dict):
                return pending
            if str(row.get('oid')) != order_id or row.get('coin') != symbol:
                continue
            tid = row.get('tid')
            if not isinstance(tid, (int, str)) or isinstance(tid, bool) or row.get('side') != ('B' if side == 'buy' else 'A'):
                return pending
            try:
                size, price = positive_decimal(row.get('sz', '')), positive_decimal(row.get('px', ''))
            except (ValueError, ArithmeticError):
                return pending
            evidence = (str(size), str(price), row.get('time'))
            if str(tid) in seen:
                if seen[str(tid)] != evidence:
                    return pending
                continue
            seen[str(tid)] = evidence
            total += size
            if total > reviewed:
                return pending
        if len(rows) < 2000:
            complete = True
            break
        times = [row.get('time') for row in rows]
        if not all(isinstance(value, int) and not isinstance(value, bool) and value >= timestamp for value in times):
            return pending
        next_timestamp = max(times)
        if next_timestamp <= timestamp:
            return pending
        timestamp = next_timestamp
    if not complete or total != expected:
        return pending
    final = await status_read()
    if final is None or final != record:
        return pending
    return {'status': 'settled', 'filledSize': str(total), 'exchangeId': order_id}


async def cancel(connector, name, pair, exchange_order_id):
    if not exchange_order_id.isdigit() or int(exchange_order_id) <= 0:
        raise ValueError('An exchange order index is required')
    if name.startswith('hyperliquid'):
        response = await hl_action(connector, {'type': 'cancel', 'cancels': [{'a': await hl_asset(connector, pair), 'o': int(exchange_order_id)}]})
        statuses = response.get('response', {}).get('data', {}).get('statuses')
        if statuses != ['success']:
            raise ActionRejected('Exchange did not confirm cancellation')
        return {'status': 'accepted', 'exchange_order_id': exchange_order_id}
    await connector._ensure_account_ready()
    market = connector.market_info_for_trading_pair(pair)
    async with connector._tx_lock:
        result = lighter_ack(await connector._signer_client.cancel_order(market_index=market.market_id, order_index=int(exchange_order_id)))
    return {**result, 'exchange_order_id': exchange_order_id}


async def open_orders(connector, name):
    """Read resting orders independently of fills/history and never mutate account state.

    Lighter accountActiveOrders permits omitted market_id for all-market reads.
    Hyperliquid books are read independently for the standard and builder DEXs.
    """
    spot = name in ['lighter', 'hyperliquid']
    is_hl = name.startswith('hyperliquid')
    scope = 'all-spot-markets' if spot else 'standard-perpetual-markets' if is_hl else 'all-perpetual-markets'
    complete = not (is_hl and not spot)
    errors = [] if complete else ['Hyperliquid builder markets are excluded; this is the standard perpetual book only.']
    if is_hl:
        raw = await connector._api_post(path_url='/info', data={'type': 'frontendOpenOrders', 'user': connector._auth._api_address, 'dex': ''}, is_auth_required=False)
        if not isinstance(raw, list):
            raise ValueError('Native open-order response is malformed')
        builder_quotes = {}
        if not spot:
            try:
                dexs = await connector._api_post(path_url='/info', data={'type': 'perpDexs'}, is_auth_required=False)
                if not isinstance(dexs, list) or len(dexs) > 100 or any(row is not None and (not isinstance(row, dict) or not isinstance(row.get('name'), str) or not row['name'] or ':' in row['name']) for row in dexs):
                    raise ValueError('Invalid builder catalog')
                names = [row['name'] for row in dexs if row is not None]
                if len(names) != len(set(names)):
                    raise ValueError('Ambiguous builder catalog')
                scope, complete, errors = 'all-perpetual-markets', True, []
                semaphore = asyncio.Semaphore(4)
                async def read_dex(dex):
                    async with semaphore:
                        try:
                            rows, meta = await asyncio.gather(
                                connector._api_post(path_url='/info', data={'type': 'frontendOpenOrders', 'user': connector._auth._api_address, 'dex': dex}, is_auth_required=False),
                                connector._api_post(path_url='/info', data={'type': 'meta', 'dex': dex}, is_auth_required=False))
                            if not isinstance(rows, list) or not isinstance(meta, dict) or type(meta.get('collateralToken')) is not int:
                                raise ValueError('Invalid builder book')
                            if meta['collateralToken'] == 0:
                                quote = 'USDC'
                            else:
                                spot_meta = await connector._api_post(path_url='/info', data={'type': 'spotMeta'}, is_auth_required=False)
                                tokens = spot_meta.get('tokens', []) if isinstance(spot_meta, dict) else []
                                matches = [t for t in tokens if isinstance(t, dict) and t.get('index') == meta['collateralToken']]
                                if len(matches) != 1 or not isinstance(matches[0].get('name'), str):
                                    raise ValueError('Unknown builder collateral')
                                quote = matches[0]['name']
                            if any(not isinstance(row, dict) or not isinstance(row.get('coin'), str) or not row['coin'].startswith(dex + ':') for row in rows):
                                raise ValueError('Wrong builder market scope')
                            return dex, quote, rows, None
                        except Exception:
                            return dex, None, [], 'Builder open-order coverage failed for ' + dex + '.'
                for dex, quote, rows, error in await asyncio.gather(*(read_dex(dex) for dex in names)):
                    if error:
                        complete = False
                        errors.append(error)
                    else:
                        builder_quotes[dex] = quote
                        raw.extend(rows)
            except Exception:
                complete = False
                errors = ['Hyperliquid builder catalog is unavailable; this is the standard perpetual book only.']
    else:
        await connector._ensure_account_ready()
        response = await connector._api_get(path_url='/api/v1/accountActiveOrders', params={'account_index': connector._account_index, 'market_type': 'spot' if spot else 'perp'}, is_auth_required=True)
        if not isinstance(response, dict) or response.get('code') != 200 or not isinstance(response.get('orders'), list):
            raise ValueError('Native open-order response is unavailable')
        raw = response['orders']
        if response.get('next_cursor'):
            complete = False
            errors.append('Native open-order response is truncated.')
    orders, seen = [], set()
    for row in raw:
        try:
            if not isinstance(row, dict):
                raise ValueError('Malformed order')
            if is_hl:
                coin = row.get('coin')
                if not isinstance(coin, str) or not coin:
                    raise ValueError('Missing market identity')
                if spot:
                    # Standard-dex response includes spot and perpetual rows.
                    if not coin.startswith('@') and '/' not in coin:
                        continue
                    symbol = await connector.trading_pair_associated_to_exchange_symbol(symbol=coin)
                else:
                    if coin.startswith('@') or '/' in coin:
                        continue
                    if ':' in coin:
                        dex = coin.split(':', 1)[0]
                        if dex not in builder_quotes:
                            raise ValueError('Unknown builder market scope')
                        symbol = coin + '-' + builder_quotes[dex]
                    else:
                        symbol = coin + '-USDC'
                oid = row.get('oid')
                if isinstance(oid, bool) or not isinstance(oid, (int, str)) or not str(oid).isdigit() or int(oid) <= 0:
                    raise ValueError('Malformed native identity')
                identity = str(oid)
            else:
                market_id = row.get('market_index', row.get('market_id'))
                if isinstance(market_id, bool) or not isinstance(market_id, (int, str)) or not str(market_id).isdigit():
                    raise ValueError('Missing market identity')
                market = connector.market_info_for_market_id(int(market_id))
                if market.market_type != ('spot' if spot else 'perp'):
                    raise ValueError('Wrong market scope')
                symbol = market.trading_pair
                identity = lighter_order_id(row)
            if not isinstance(symbol, str) or '-' not in symbol or identity in seen:
                raise ValueError('Ambiguous order identity')
            seen.add(identity)
            normalized = {'symbol': symbol, 'exchangeOrderId': identity}
            side = row.get('side')
            if is_hl and side in ['A', 'B']:
                normalized['side'] = 'sell' if side == 'A' else 'buy'
            elif not is_hl and isinstance(row.get('is_ask'), bool):
                normalized['side'] = 'sell' if row['is_ask'] else 'buy'
            for output, keys in [('size', ['sz', 'remaining_base_amount', 'initial_base_amount']), ('price', ['limitPx', 'price']), ('triggerPrice', ['triggerPx', 'trigger_price'])]:
                for key in keys:
                    value = row.get(key)
                    if isinstance(value, (str, int, float)) and not isinstance(value, bool):
                        number = Decimal(str(value))
                        if not number.is_finite() or number < 0:
                            raise ValueError('Invalid order value')
                        normalized[output] = str(value)
                        break
            reduce_only = row.get('reduceOnly' if is_hl else 'reduce_only')
            if not is_hl and row.get('initial_base_amount') is not None:
                initial = Decimal(str(row['initial_base_amount']))
                remaining = Decimal(normalized.get('size', '0'))
                if not initial.is_finite() or initial < 0 or remaining > initial:
                    raise ValueError('Remaining order size exceeds total size')
                if initial > 0:
                    normalized['totalSize'] = str(row['initial_base_amount'])
            if isinstance(reduce_only, bool):
                normalized['reduceOnly'] = reduce_only
            order_type = row.get('orderType' if is_hl else 'type')
            if isinstance(order_type, (str, int)) and not isinstance(order_type, bool):
                normalized['type'] = str(order_type)
            orders.append(normalized)
        except (ValueError, TypeError, KeyError, AttributeError, InvalidOperation, ActionUncertain):
            complete = False
            if 'Some native orders could not be identified or mapped; the account book is incomplete.' not in errors:
                errors.append('Some native orders could not be identified or mapped; the account book is incomplete.')
    return {'connector_name': name, 'scope': scope, 'complete': complete, 'orders': orders, **({'error': ' '.join(errors)[:300]} if errors else {})}


async def snapshot(connector, name, pair, history_cursor=None, fills_cursor=None, start_time=0):
    """Raw native account payloads, scoped to the configured account and pair.

    HL pagination is time based: request start_time (milliseconds), then advance
    past the last returned fill timestamp when the 2000-fill cap is reached.
    Lighter exposes independent next_cursor values on history/fills responses.
    """
    if name.startswith('hyperliquid'):
        symbol = await connector.exchange_symbol_associated_to_pair(trading_pair=pair)
        owner = connector._auth._api_address
        dex = symbol.split(':', 1)[0] if ':' in symbol else ''
        info = lambda data: connector._api_post(path_url='/info', data=data, is_auth_required=False)
        orders, history, fills, account = await asyncio.gather(
            info({'type': 'frontendOpenOrders', 'user': owner, 'dex': dex}),
            info({'type': 'historicalOrders', 'user': owner}),
            info({'type': 'userFillsByTime', 'user': owner, 'startTime': start_time, 'aggregateByTime': False}),
            info({'type': 'spotClearinghouseState', 'user': owner}) if name == 'hyperliquid' else info({'type': 'clearinghouseState', 'user': owner, 'dex': dex}),
        )
        if not all(isinstance(rows, list) for rows in [orders, history, fills]) or not isinstance(account, dict):
            raise ValueError('Native account snapshot is malformed')
        # Advance from the complete account-wide page, not pair-filtered rows:
        # a page of 2000 other-market fills can contain no selected-pair fills.
        timestamps = [o.get('time') for o in fills]
        if any(not isinstance(value, int) or isinstance(value, bool) or value < start_time for value in timestamps):
            raise ValueError('Native fill timestamps are malformed')
        next_start_time = max(timestamps) + 1 if len(fills) >= 2000 else None
        return {'connector_name': name, 'trading_pair': pair,
            'open_orders': [o for o in orders if o.get('coin') == symbol],
            'order_history': [o for o in history if o.get('order', {}).get('coin') == symbol],
            'fills': [o for o in fills if o.get('coin') == symbol], 'account': account,
            'history_next_cursor': None, 'fills_next_cursor': None,
            'fills_may_have_more': len(fills) >= 2000, 'fills_next_start_time': next_start_time}
    await connector._ensure_account_ready()
    market = connector.market_info_for_trading_pair(pair)
    params = {'account_index': connector._account_index, 'market_id': market.market_id}
    async def get(path, values):
        response = await connector._api_get(path_url=path, params=values, is_auth_required=True)
        if not isinstance(response, dict) or response.get('code') != 200:
            raise ValueError('Native account snapshot is unavailable')
        return response
    orders, history, fills, account = await asyncio.gather(
        get('/api/v1/accountActiveOrders', params),
        get('/api/v1/accountInactiveOrders', {**params, 'limit': 100, **({'cursor': history_cursor} if history_cursor else {})}),
        get('/api/v1/trades', {**params, 'limit': 100, 'sort_by': 'timestamp', 'sort_dir': 'desc', **({'cursor': fills_cursor} if fills_cursor else {})}),
        get('/api/v1/account', {'by': 'index', 'value': connector._account_index}),
    )
    if not all(isinstance(result.get(key), list) for result, key in [(orders, 'orders'), (history, 'orders'), (fills, 'trades')]):
        raise ValueError('Native account snapshot is malformed')
    for order in orders['orders'] + history['orders']:
        order['exchange_order_id'] = lighter_order_id(order)
    return {'connector_name': name, 'trading_pair': pair, 'open_orders': orders['orders'], 'order_history': history['orders'],
        'fills': fills['trades'], 'account': account, 'history_next_cursor': history.get('next_cursor'),
        'fills_next_cursor': fills.get('next_cursor'), 'fills_may_have_more': bool(fills.get('next_cursor')), 'fills_next_start_time': None}


async def amend(connector, name, pair, exchange_order_id, amount, price, time_in_force=None):
    positive_decimal(amount)
    positive_decimal(price)
    if name.startswith('lighter') and time_in_force is not None:
        raise ActionRejected('Lighter amendments preserve the existing time in force; cancel and replace to change it')
    if not exchange_order_id.isdigit() or int(exchange_order_id) <= 0:
        raise ValueError('An exchange order index is required')
    state = await snapshot(connector, name, pair)
    matches = [order for order in state['open_orders'] if
        (str(order.get('oid')) if name.startswith('hyperliquid') else lighter_order_id(order)) == exchange_order_id]
    if len(matches) != 1:
        raise ActionRejected('Order is not active on this account and market')
    existing = matches[0]
    if name.startswith('hyperliquid'):
        if existing.get('isTrigger'):
            raise ActionRejected('Trigger orders must be cancelled and replaced explicitly')
        side = existing.get('side')
        if side not in ['A', 'B']:
            raise ActionRejected('Order side is unavailable; cannot amend safely')
        if not isinstance(existing.get('reduceOnly'), bool):
            raise ActionRejected('Order reduce-only flag is unavailable; cannot amend safely')
        tif = time_in_force if time_in_force is not None else existing.get('tif')
        if tif not in ['Gtc', 'Alo', 'Ioc']:
            raise ActionRejected('Order time in force is unavailable; cannot amend safely')
        response = await hl_action(connector, {'type': 'modify', 'oid': int(exchange_order_id), 'order': {
            'a': await hl_asset(connector, pair), 'b': side == 'B', 'p': price, 's': amount,
            'r': existing.get('reduceOnly') is True, 't': {'limit': {'tif': tif}},
        }})
        statuses = response.get('response', {}).get('data', {}).get('statuses', [])
        if len(statuses) != 1 or not isinstance(statuses[0], dict):
            raise ActionUncertain('Amend acknowledgment is unrecognized; inspect exchange orders')
        if 'error' in statuses[0]:
            raise ActionRejected('Exchange rejected the amendment')
        updated = statuses[0].get('resting') or statuses[0].get('filled')
        if not isinstance(updated, dict) or not isinstance(updated.get('oid'), int):
            raise ActionUncertain('Amend acknowledgment is unrecognized; inspect exchange orders')
        return {'status': 'accepted', 'exchange_order_id': str(updated['oid'])}
    market = connector.market_info_for_trading_pair(pair)
    if existing.get('type') not in ['limit', 'limit-maker', 'LIMIT', 0]:
        raise ActionRejected('Only native resting limit orders can be amended')
    try:
        initial = positive_decimal(existing['initial_base_amount'])
        remaining = Decimal(existing['remaining_base_amount'])
        if not remaining.is_finite() or remaining < 0 or remaining > initial:
            raise ValueError('Invalid remaining order size')
    except (KeyError, TypeError, ValueError, InvalidOperation):
        raise ActionRejected('Verified original and remaining order quantities are required to amend safely') from None
    # Lighter's modified base_amount includes quantities already matched.
    # Sending remaining size here silently shrinks a partially filled order.
    if positive_decimal(amount) <= initial - remaining:
        raise ActionRejected('Amended total quantity must exceed already filled quantity; cancel explicitly to remove the remainder')
    async with connector._tx_lock:
        result = lighter_ack(await connector._signer_client.modify_order(market_index=market.market_id,
            order_index=int(exchange_order_id), base_amount=units(amount, market.size_decimals), price=units(price, market.price_decimals), trigger_price=0))
    return {**result, 'exchange_order_id': exchange_order_id}


class RequestLedger:
    def __init__(self):
        self.entries = {}

    async def run(self, request_id, payload, operation):
        fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        existing = self.entries.get(request_id)
        if existing:
            if existing[0] != fingerprint:
                raise ActionRejected('Request ID was already used with different parameters')
            if existing[1] == 'accepted':
                return existing[2]
            raise ActionUncertain('Action was already attempted; inspect exchange state before any new action')
        if len(self.entries) >= 4096:
            raise ActionRejected('Action ledger is full; operator reconciliation is required')
        self.entries[request_id] = (fingerprint, 'attempted', None)
        try:
            result = await operation()
        except (ActionRejected, ValueError):
            raise
        except BaseException as exc:
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                raise
            raise ActionUncertain('Exchange outcome is uncertain; inspect exchange state before any new action') from None
        self.entries[request_id] = (fingerprint, 'accepted', result)
        return result


ledger = RequestLedger()
router = APIRouter(prefix='/quanttrade/trading', tags=['QuantTrade private trading'])


async def perform(request, dto, operation):
    try:
        connector = await request.app.state.accounts_service.get_connector_instance(dto.account_name, dto.connector_name)
        return await ledger.run(dto.request_id, dto.model_dump(), lambda: operation(connector))
    except ActionRejected as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except ValueError:
        raise HTTPException(status_code=400, detail='Action violates exchange amount or precision rules') from None
    except ActionUncertain as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


@router.post('/leverage')
async def leverage_route(dto: LeverageRequest, request: Request):
    return await perform(request, dto, lambda c: leverage(c, dto.connector_name, dto.trading_pair, dto.leverage, dto.margin_mode))


@router.post('/lighter-native-orders')
async def lighter_native_orders_route(dto: NativeOrderRequest, request: Request):
    return await perform(request, dto, lambda c: lighter_native_orders(c, dto))


@router.post('/margin')
async def margin_route(dto: MarginRequest, request: Request):
    return await perform(request, dto, lambda c: margin(c, dto.connector_name, dto.trading_pair, dto.amount, dto.direction))


@router.post('/trigger-orders')
async def trigger_route(dto: TriggerRequest, request: Request):
    return await perform(request, dto, lambda c: trigger(c, dto.connector_name, dto.trading_pair, dto.side, dto.amount,
        dto.trigger_price, dto.execution_price, dto.trigger_kind, dto.is_market, dto.reduce_only, dto.request_id))


@router.post('/order-evidence')
async def order_evidence_route(dto: OrderEvidenceRequest, request: Request):
    try:
        connector = await request.app.state.accounts_service.get_connector_instance(dto.account_name, dto.connector_name)
        return await order_evidence(connector, dto.trading_pair, dto.exchange_order_id)
    except Exception:
        raise HTTPException(status_code=503, detail='Native order evidence is unavailable or does not match the reviewed instrument') from None


@router.post('/settled-order-evidence')
async def settled_order_evidence_route(dto: SettledOrderEvidenceRequest, request: Request):
    try:
        connector = await request.app.state.accounts_service.get_connector_instance(dto.account_name, dto.connector_name)
        return await settled_order_evidence(connector, dto.trading_pair, dto.exchange_order_id, dto.amount, dto.side)
    except Exception:
        raise HTTPException(status_code=503, detail='Settled order evidence is unavailable; replacement remains blocked') from None


@router.post('/entry-bracket-orders')
async def entry_bracket_route(dto: EntryBracketRequest, request: Request):
    return await perform(request, dto, lambda c: entry_bracket(c, dto))


@router.post('/bracket-orders')
async def bracket_route(dto: BracketRequest, request: Request):
    return await perform(request, dto, lambda c: bracket(c, dto.connector_name, dto.trading_pair, dto.side,
        dto.amount, dto.take_profit.model_dump(), dto.stop_loss.model_dump(), dto.request_id))


@router.post('/cancel-order')
async def cancel_route(dto: CancelRequest, request: Request):
    return await perform(request, dto, lambda c: cancel(c, dto.connector_name, dto.trading_pair, dto.exchange_order_id))


@router.post('/amend-order')
async def amend_route(dto: AmendRequest, request: Request):
    return await perform(request, dto, lambda c: amend(c, dto.connector_name, dto.trading_pair, dto.exchange_order_id, dto.amount, dto.price, dto.time_in_force))


@router.post('/snapshot')
async def snapshot_route(dto: SnapshotRequest, request: Request):
    try:
        connector = await request.app.state.accounts_service.get_connector_instance(dto.account_name, dto.connector_name)
        return await snapshot(connector, dto.connector_name, dto.trading_pair, dto.history_cursor, dto.fills_cursor, dto.start_time)
    except Exception:
        raise HTTPException(status_code=503, detail='Native exchange account snapshot is unavailable') from None


@router.post('/open-orders')
async def open_orders_route(dto: OpenOrdersRequest, request: Request):
    try:
        connector = await request.app.state.accounts_service.get_connector_instance(dto.account_name, dto.connector_name)
        return await open_orders(connector, dto.connector_name)
    except Exception:
        raise HTTPException(status_code=503, detail='Native open-order read is unavailable; current orders are not known to be empty') from None


@router.post('/builder-market-readiness')
async def builder_market_readiness_route(dto: BuilderMarketRequest, request: Request):
    try:
        connector = await request.app.state.accounts_service.get_connector_instance(dto.account_name, 'hyperliquid_perpetual')
        return await builder_market_readiness(connector, dto)
    except ActionRejected as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except Exception:
        raise HTTPException(status_code=503, detail='Builder execution readiness could not be verified; no order was submitted') from None


@router.post('/builder-available-collateral')
async def builder_available_collateral_route(dto: BuilderCollateralRequest, request: Request):
    try:
        connector = await request.app.state.accounts_service.get_connector_instance(dto.account_name, 'hyperliquid_perpetual')
        return await builder_available_collateral(connector, dto)
    except ActionRejected as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except Exception:
        raise HTTPException(status_code=503, detail='Builder available collateral is unverified; no zero balance is assumed') from None


@router.post('/arena-account-state')
async def arena_account_state_route(dto: ArenaAccountRequest, request: Request):
    try:
        connector = await request.app.state.accounts_service.get_connector_instance(dto.account_name, dto.connector_name)
        return await arena_account_state(connector, dto)
    except ActionRejected as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except Exception:
        raise HTTPException(status_code=503, detail='Live bot account snapshot is unverified') from None


def install(app, auth_user):
    app.include_router(router, dependencies=[Depends(auth_user)])


class HyperliquidTwapRequest(Scope):
    connector_name: Literal['hyperliquid_perpetual'] = 'hyperliquid_perpetual'
    side: Literal['buy', 'sell']
    amount: str = Field(max_length=40, pattern=r'^[0-9]+(?:\.[0-9]+)?$')
    duration_minutes: StrictInt = Field(ge=5, le=10080)
    randomize: StrictBool
    reduce_only: StrictBool
    leverage: StrictInt | None = Field(default=None, ge=1, le=125)
    margin_mode: Literal['cross', 'isolated'] | None = None


class HyperliquidTwapCancelRequest(Scope):
    connector_name: Literal['hyperliquid_perpetual'] = 'hyperliquid_perpetual'
    twap_id: str = Field(max_length=16, pattern=r'^[1-9][0-9]*$')


async def hyperliquid_twap(connector, dto):
    positive_decimal(dto.amount)
    if (dto.leverage is None) != (dto.margin_mode is None) or dto.reduce_only and dto.leverage is not None:
        raise ValueError('Opening leverage and margin must be reviewed together')
    if dto.reduce_only:
        await verify_exit_position(connector, dto.connector_name, dto.trading_pair, dto.side, dto.amount)
    asset = await hl_asset(connector, dto.trading_pair)
    if dto.leverage is not None:
        await leverage(connector, dto.connector_name, dto.trading_pair, dto.leverage, dto.margin_mode)
    response = await hl_action(connector, {'type': 'twapOrder', 'twap': {
        'a': asset, 'b': dto.side == 'buy', 's': dto.amount, 'r': dto.reduce_only,
        'm': dto.duration_minutes, 't': dto.randomize,
    }})
    data = response.get('response', {})
    details = data.get('data') if isinstance(data, dict) else None
    status = details.get('status') if isinstance(details, dict) else None
    if isinstance(status, dict) and 'error' in status:
        raise ActionRejected('Exchange rejected the native TWAP')
    running = status.get('running') if isinstance(status, dict) else None
    twap_id = running.get('twapId') if isinstance(running, dict) else None
    if not isinstance(data, dict) or data.get('type') != 'twapOrder' or isinstance(twap_id, bool) or not isinstance(twap_id, int) or not 0 < twap_id <= 9007199254740991:
        raise ActionUncertain('Native TWAP acknowledgment is unrecognized; inspect exchange state')
    return {'status': 'accepted', 'connector_name': dto.connector_name, 'trading_pair': dto.trading_pair, 'twap_id': str(twap_id)}


async def hyperliquid_twap_cancel(connector, dto):
    twap_id = int(dto.twap_id)
    if not 0 < twap_id <= 9007199254740991:
        raise ValueError('Native TWAP identity is invalid')
    response = await hl_action(connector, {'type': 'twapCancel', 'a': await hl_asset(connector, dto.trading_pair), 't': twap_id})
    data = response.get('response', {})
    details = data.get('data') if isinstance(data, dict) else None
    status = details.get('status') if isinstance(details, dict) else None
    if isinstance(status, dict) and 'error' in status:
        raise ActionRejected('Exchange rejected native TWAP cancellation')
    if not isinstance(data, dict) or data.get('type') != 'twapCancel' or status != 'success':
        raise ActionUncertain('Native TWAP cancellation acknowledgment is unrecognized')
    return {'status': 'accepted', 'connector_name': dto.connector_name, 'trading_pair': dto.trading_pair, 'twap_id': dto.twap_id}


@router.post('/hyperliquid-twap')
async def hyperliquid_twap_route(dto: HyperliquidTwapRequest, request: Request):
    return await perform(request, dto, lambda c: hyperliquid_twap(c, dto))


@router.post('/hyperliquid-twap-cancel')
async def hyperliquid_twap_cancel_route(dto: HyperliquidTwapCancelRequest, request: Request):
    return await perform(request, dto, lambda c: hyperliquid_twap_cancel(c, dto))


class HyperliquidTwapEvidenceRequest(HyperliquidTwapCancelRequest):
    side: Literal['buy', 'sell']
    amount: str = Field(max_length=40, pattern=r'^[0-9]+(?:\.[0-9]+)?$')


async def hyperliquid_twap_evidence(connector, dto):
    """Observed slice fills only: absence and retained history are not lifecycle proof."""
    from decimal import localcontext
    owner = connector._auth._api_address
    if not isinstance(owner, str) or len(owner) != 42 or not owner.startswith('0x') or any(ch not in '0123456789abcdefABCDEF' for ch in owner[2:]):
        raise ValueError('Reviewed master account is unavailable')
    if not 0 < int(dto.twap_id) <= 9007199254740991:
        raise ValueError('Reviewed TWAP identity is invalid')
    symbol = await connector.exchange_symbol_associated_to_pair(trading_pair=dto.trading_pair)
    if not isinstance(symbol, str) or not symbol:
        raise ValueError('Reviewed instrument is unavailable')
    reviewed = positive_decimal(dto.amount)
    rows = await connector._api_post(path_url='/info', data={'type':'userTwapSliceFills','user':owner}, is_auth_required=False)
    if not isinstance(rows, list):
        raise ValueError('TWAP fills are unavailable')
    with localcontext() as context:
        context.prec = 100
        size, notional, seen = Decimal(0), Decimal(0), {}
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError('TWAP fill history is malformed')
            identity = row.get('twapId')
            if isinstance(identity, bool) or not isinstance(identity, (int, str)) or str(identity) != dto.twap_id:
                continue
            fill = row.get('fill')
            if not isinstance(fill, dict) or fill.get('coin') != symbol or fill.get('side') != ('B' if dto.side == 'buy' else 'A'):
                raise ValueError('TWAP fill does not match the reviewed instrument or side')
            tid, oid, timestamp = fill.get('tid'), fill.get('oid'), fill.get('time')
            if isinstance(tid, bool) or not isinstance(tid, (int, str)) or not str(tid).isdigit() or isinstance(oid, bool) or not isinstance(oid, (int, str)) or not str(oid).isdigit() or int(oid) <= 0 or not isinstance(timestamp, int) or isinstance(timestamp, bool) or timestamp < 0:
                raise ValueError('TWAP fill identity is not verified')
            amount, price = positive_decimal(fill.get('sz', '')), positive_decimal(fill.get('px', ''))
            evidence = (str(oid), str(amount), str(price), timestamp)
            if str(tid) in seen:
                if seen[str(tid)] != evidence:
                    raise ValueError('TWAP fill identity has conflicting evidence')
                continue
            seen[str(tid)] = evidence
            size += amount
            notional += amount * price
            if size > reviewed:
                raise ValueError('TWAP fills exceed the reviewed quantity')
        return {'twap_id':dto.twap_id, 'verified_fill_size':str(size),
            **({'verified_fill_price':str(notional / size)} if size > 0 else {}),
            'fills':[{'id':tid,'size':value[1],'price':value[2]} for tid,value in seen.items()],
            'history_may_be_truncated':len(rows) >= 2000,
            'status':'fills-observed' if size > 0 else 'unverified'}


@router.post('/hyperliquid-twap-evidence')
async def hyperliquid_twap_evidence_route(dto: HyperliquidTwapEvidenceRequest, request: Request):
    try:
        connector = await request.app.state.accounts_service.get_connector_instance(dto.account_name, dto.connector_name)
        return await hyperliquid_twap_evidence(connector, dto)
    except Exception:
        raise HTTPException(status_code=503, detail='Native TWAP fill evidence is unavailable or does not match the reviewed trade') from None
