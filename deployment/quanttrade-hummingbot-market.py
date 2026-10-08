"""Private Hummingbot market orders with an exact exchange-side protection price.

Installed once at startup. Standard Hummingbot requests keep their original behavior.
Only requests carrying the private protection keyword bypass connector default slippage.
"""
from contextvars import ContextVar
from decimal import Decimal
from functools import wraps
import inspect

_protection = ContextVar("quanttrade_market_protection", default=None)


def bounded_place(original):
    signature = inspect.signature(original)

    @wraps(original)
    async def wrapped(self, *args, **kwargs):
        protection = kwargs.pop("quanttrade_protection_price", None)
        if protection is None:
            return await original(self, *args, **kwargs)
        protection = Decimal(protection)
        if not protection.is_finite() or protection <= 0:
            raise ValueError("Invalid market protection price")
        bound = signature.bind(self, *args, **kwargs)
        if getattr(bound.arguments["order_type"], "name", None) != "MARKET":
            raise ValueError("Protection is only valid for market orders")
        bound.arguments["price"] = protection
        token = _protection.set(protection)
        try:
            return await original(*bound.args, **bound.kwargs)
        finally:
            _protection.reset(token)
    return wrapped


def bounded_effective(original):
    @wraps(original)
    def wrapped(self, trading_pair, trade_type, order_type, price):
        protection = _protection.get()
        if protection is not None and getattr(order_type, "name", None) == "MARKET":
            return protection
        return original(self, trading_pair, trade_type, order_type, price)
    return wrapped


def install(app, auth_user):
    from fastapi import APIRouter, Depends, HTTPException
    from pydantic import BaseModel, ConfigDict, Field
    from typing import Literal
    from deps import get_accounts_service
    from hummingbot.core.data_type.common import OrderType, PositionAction
    from hummingbot.connector.derivative.hyperliquid_perpetual.hyperliquid_perpetual_derivative import HyperliquidPerpetualDerivative
    from hummingbot.connector.derivative.lighter_perpetual.lighter_perpetual_derivative import LighterPerpetualDerivative

    from hummingbot.connector.exchange.hyperliquid.hyperliquid_exchange import HyperliquidExchange
    from hummingbot.connector.exchange.lighter.lighter_exchange import LighterExchange
    for cls in (HyperliquidPerpetualDerivative, LighterPerpetualDerivative, HyperliquidExchange, LighterExchange):
        if not getattr(cls, "_quanttrade_bounded_market", False):
            cls._place_order = bounded_place(cls._place_order)
            if cls in (LighterPerpetualDerivative, LighterExchange):
                cls._effective_order_price = bounded_effective(cls._effective_order_price)
            cls._quanttrade_bounded_market = True

    class Request(BaseModel):
        model_config = ConfigDict(extra="forbid")
        account_name: Literal["desk"]
        connector_name: Literal["hyperliquid_perpetual", "lighter_perpetual", "hyperliquid", "lighter"]
        trading_pair: str = Field(min_length=1, max_length=100)
        trade_type: Literal["BUY", "SELL"]
        order_type: Literal["MARKET"]
        amount: Decimal = Field(gt=0, allow_inf_nan=False)
        protection_price: Decimal = Field(gt=0, allow_inf_nan=False)
        position_action: Literal["OPEN", "CLOSE"] = "OPEN"

    router = APIRouter(prefix="/quanttrade/trading", tags=["QuantTrade"])

    @router.post("/market-orders", status_code=201)
    async def place_market(request: Request, accounts=Depends(get_accounts_service)):
        if request.account_name not in accounts.list_accounts():
            raise HTTPException(404, "Exchange account is unavailable")
        connector = await accounts._connector_service.get_trading_connector(request.account_name, request.connector_name)
        rule = connector.trading_rules.get(request.trading_pair)
        if rule is None or OrderType.MARKET not in connector.supported_order_types():
            raise HTTPException(400, "Market order is unavailable for this pair")
        amount = connector.quantize_order_amount(request.trading_pair, request.amount)
        price = connector.quantize_order_price(request.trading_pair, request.protection_price)
        # Reject any quantization that could change the amount or loosen the bound.
        if amount != request.amount or amount < rule.min_order_size:
            raise HTTPException(400, "Market amount violates exchange precision or minimum")
        if price != request.protection_price or price <= 0:
            raise HTTPException(400, "Protection price violates exchange precision")
        if amount * price < rule.min_notional_size:
            raise HTTPException(400, "Market order is below exchange minimum notional")
        if request.connector_name in ("hyperliquid", "lighter") and request.position_action == "CLOSE":
            raise HTTPException(400, "Spot orders cannot be reduce-only")
        submit = connector.buy if request.trade_type == "BUY" else connector.sell
        order_id = submit(trading_pair=request.trading_pair, amount=amount, order_type=OrderType.MARKET,
                          price=price, position_action=PositionAction[request.position_action],
                          quanttrade_protection_price=price)
        if not order_id:
            raise HTTPException(500, "Exchange submission did not return an order ID")
        return {"order_id": order_id, "status": "submitted"}

    app.include_router(router, dependencies=[Depends(auth_user)])
