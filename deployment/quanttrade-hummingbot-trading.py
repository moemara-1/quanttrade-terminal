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
from decimal import Decimal
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


async def hl_asset(connector, pair):
    if not connector.coin_to_asset:
        await connector._update_trading_rules()
    symbol = await connector.exchange_symbol_associated_to_pair(trading_pair=pair)
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


@router.post('/margin')
async def margin_route(dto: MarginRequest, request: Request):
    return await perform(request, dto, lambda c: margin(c, dto.connector_name, dto.trading_pair, dto.amount, dto.direction))


@router.post('/trigger-orders')
async def trigger_route(dto: TriggerRequest, request: Request):
    return await perform(request, dto, lambda c: trigger(c, dto.connector_name, dto.trading_pair, dto.side, dto.amount,
        dto.trigger_price, dto.execution_price, dto.trigger_kind, dto.is_market, dto.reduce_only, dto.request_id))


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


def install(app, auth_user):
    app.include_router(router, dependencies=[Depends(auth_user)])
