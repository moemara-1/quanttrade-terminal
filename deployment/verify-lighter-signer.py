"""Offline signing regression with ephemeral test keys; never sends transactions."""
import importlib.metadata
import json
from lighter.signer_client import SignerClient, CreateOrderTxReq, create_api_key, get_signer

private, _, error = create_api_key()
assert error is None, error
client = SignerClient.__new__(SignerClient)
client.url = 'https://mainnet.zklighter.elliot.ai'
client.chain_id = 304
client.account_index = 1
client.api_key_dict = {3: private}
client.signer = get_signer()
client.create_client(3)
for market_index in (0, 200, 2048, 4097):
    _, payload, _, error = client.sign_create_order(
        market_index=market_index, client_order_index=1, base_amount=100,
        price=100, is_ask=False, order_type=client.ORDER_TYPE_LIMIT,
        time_in_force=client.ORDER_TIME_IN_FORCE_GOOD_TILL_TIME,
        nonce=1, api_key_index=3,
    )
    assert error is None, f'Market {market_index}: {error}'
    assert json.loads(payload)['MarketIndex'] == market_index
assert client.GROUPING_TYPE_ONE_CANCELS_THE_OTHER == 2
orders = [CreateOrderTxReq(MarketIndex=4097, ClientOrderIndex=101 + index,
    BaseAmount=4800, Price=179 if index == 0 else 119, IsAsk=1,
    Type=client.ORDER_TYPE_TAKE_PROFIT if index == 0 else client.ORDER_TYPE_STOP_LOSS,
    TimeInForce=client.ORDER_TIME_IN_FORCE_IMMEDIATE_OR_CANCEL, ReduceOnly=1,
    TriggerPrice=180 if index == 0 else 120, OrderExpiry=-1) for index in range(2)]
_, payload, _, error = client.sign_create_grouped_orders(
    grouping_type=client.GROUPING_TYPE_ONE_CANCELS_THE_OTHER,
    orders=orders, nonce=2, api_key_index=3)
assert error is None, f'Grouped PRL OCO: {error}'
grouped = json.loads(payload)
assert grouped['GroupingType'] == 2
assert len(grouped['Orders']) == 2
assert all(order['MarketIndex'] == 4097 and order['ReduceOnly'] == 1 for order in grouped['Orders'])
assert [order['ClientOrderIndex'] for order in grouped['Orders']] == [101, 102]
print('Offline Lighter signing passed for perpetual/spot IDs and native PRL OCO; SDK', importlib.metadata.version('lighter-sdk'))
