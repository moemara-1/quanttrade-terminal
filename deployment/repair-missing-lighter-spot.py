"""One-time local migration: verify and add a missing spot config; never rotate keys.

Run inside Hummingbot before restarting the API. No exchange mutation is sent.
Existing spot files are never overwritten; perpetual bytes must remain identical.
"""
import asyncio
import logging
import os
from pathlib import Path


FIELDS = ('lighter_perpetual_l1_address', 'lighter_perpetual_api_key_index',
          'lighter_perpetual_api_private_key', 'lighter_perpetual_account_limit')


def spot_fields(values):
    return {name.replace('lighter_perpetual_', 'lighter_', 1): values[name] for name in FIELDS}


def write_missing(path, content):
    # O_EXCL is the final race guard: an existing credential is never replaced.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        Path(path).unlink(missing_ok=True)
        raise


async def main():
    logging.disable(logging.CRITICAL)
    from config import settings
    from utils.file_system import fs_util
    from utils.security import BackendAPISecurity
    from utils.hummingbot_api_config_adapter import HummingbotAPIConfigAdapter
    from hummingbot.client.config.config_crypt import ETHKeyFileSecretManger
    from hummingbot.client.config.config_helpers import get_connector_hb_config, get_connector_class
    from hummingbot.client.settings import AllConnectorSettings
    from quanttrade_hummingbot_connections import install_lighter_tier_decoder
    from quanttrade_credential_validation import validate

    source = Path(fs_util._get_full_path('credentials/desk/connectors/lighter_perpetual.yml'))
    target = source.with_name('lighter.yml')
    if target.exists():
        print('Existing Lighter spot configuration retained; no credentials changed.')
        return
    original = source.read_bytes()
    install_lighter_tier_decoder()
    manager = ETHKeyFileSecretManger(password=settings.security.config_password)
    if not BackendAPISecurity.login_account(account_name='desk', secrets_manager=manager):
        raise ValueError('Existing credential store could not be unlocked')
    config = BackendAPISecurity.load_connector_config_map_from_file(source)
    values = {name: getattr(config, name) for name in FIELDS}
    values = {name: value.get_secret_value() if hasattr(value, 'get_secret_value') else value
              for name, value in values.items()}
    spot = spot_fields(values)
    perpetual_setting = AllConnectorSettings.get_connector_settings()['lighter_perpetual']
    perpetual = get_connector_class('lighter_perpetual')(**perpetual_setting.conn_init_parameters(
        trading_pairs=[], trading_required=True, api_keys=values))
    await validate('lighter_perpetual', perpetual, values)
    model = get_connector_hb_config('lighter').model_validate({'connector': 'lighter', **spot})
    adapter = HummingbotAPIConfigAdapter(model)
    setting = AllConnectorSettings.get_connector_settings()['lighter']
    connector = get_connector_class('lighter')(**setting.conn_init_parameters(
        trading_pairs=[], trading_required=True, api_keys=spot))
    await validate('lighter', connector, spot)
    if connector._account_index != perpetual._account_index:
        raise ValueError('Spot account differs from the verified perpetual account')
    if source.read_bytes() != original:
        raise ValueError('Perpetual connection changed during verification; migration aborted')
    # The adapter encrypts secrets using the existing store manager.
    content = adapter.generate_yml_output_str_with_comments()
    write_missing(target, content)
    print('Missing Lighter spot configuration restored from verified existing identity; perpetual credentials unchanged. No orders sent.')


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as failure:
        # Exception text can contain credential or provider payloads.
        print('Spot configuration repair failed safely:', type(failure).__name__)
        raise SystemExit(1)
