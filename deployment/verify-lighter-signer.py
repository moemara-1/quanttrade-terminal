"""Offline signing regression with ephemeral test keys; never sends transactions."""
import importlib.metadata
import json
from lighter.signer_client import SignerClient, create_api_key, get_signer

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
print('Offline Lighter signing passed for perpetual and spot market IDs; SDK', importlib.metadata.version('lighter-sdk'))
