import asyncio,inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock,Mock
from services.accounts_service import AccountsService
from quanttrade_credential_validation import validate

assert 'await validate_quanttrade_credentials(connector_name, connector, credentials)' in inspect.getsource(AccountsService.add_credentials)
async def verify():
    for key_error in [None,'invalid key']:
        signer=Mock(return_value=key_error)
        connector=SimpleNamespace(_ensure_account_ready=AsyncMock(),_signer_client=SimpleNamespace(check_client=signer))
        try:
            await validate('lighter_perpetual',connector,{})
            assert key_error is None
        except ValueError:
            assert key_error is not None
        signer.assert_called_once_with()
    connector=SimpleNamespace(_api_post=AsyncMock(return_value=[]))
    try:
        await validate('hyperliquid_perpetual',connector,{'hyperliquid_perpetual_address':'0x'+'a'*40,'hyperliquid_perpetual_secret_key':'b'*64,'use_vault':False})
        raise AssertionError('Unapproved API wallet was accepted')
    except ValueError as e:
        assert str(e)=='Hyperliquid credential verification failed'
    connector._api_post.assert_awaited_once()
asyncio.run(verify())
print('Mounted Hummingbot credential guard and installed key-derivation dependency verified; no exchange requests or orders sent.')
