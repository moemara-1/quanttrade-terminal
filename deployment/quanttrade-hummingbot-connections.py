"""Atomic encrypted spot/perpetual credential bundles for the private API."""
import asyncio
import hashlib
import json
import logging
import re
from pathlib import Path

LOCK = asyncio.Lock()
VENUES = ("hyperliquid", "lighter")


def log_recovery_failure(failure):
    """Log only exception class and frame location, never messages, source or locals."""
    frames=[]
    trace=failure.__traceback__
    while trace is not None:
        frames.append(f'{Path(trace.tb_frame.f_code.co_filename).name}:{trace.tb_lineno}')
        trace=trace.tb_next
    logging.getLogger('quanttrade.connections').warning('Recovery verification failed: %s [%s]',type(failure).__name__,','.join(frames))


def install_lighter_tier_decoder():
    """Decode the non-secure SecretStr tier before the connector is constructed."""
    from utils.security import BackendAPISecurity
    original=BackendAPISecurity.load_connector_config_map_from_file
    if getattr(original,'_quanttrade_lighter_tier',False):
        return
    def load(cls,path):
        config=original(path)
        name=getattr(config,'connector',None)
        if name in ('lighter','lighter_perpetual'):
            field=name+'_account_limit'
            tier=getattr(config,field)
            tier=tier.get_secret_value() if hasattr(tier,'get_secret_value') else tier
            if tier not in ('Standard','Premium','Plus','Builder'):
                tier=cls.secrets_manager.decrypt_secret_value(attr=field,value=tier)
            if tier not in ('Standard','Premium','Plus','Builder'):
                raise ValueError('Invalid configured Lighter account tier')
            setattr(config,field,tier)
        return config
    load._quanttrade_lighter_tier=True
    BackendAPISecurity.load_connector_config_map_from_file=classmethod(load)


async def verified_revision(account_service, account_name, venue):
    """Verify existing signing identity without replacing credentials or exposing keys."""
    if account_name != 'desk' or venue != 'lighter':
        raise ValueError('Invalid recovery account')
    from utils.file_system import fs_util
    from utils.security import BackendAPISecurity
    from quanttrade_credential_validation import validate
    async with LOCK:
        path=Path(fs_util._get_full_path(f'credentials/{account_name}/connectors/lighter_perpetual.yml'))
        encrypted=path.read_bytes()
        config=BackendAPISecurity.load_connector_config_map_from_file(path)
        def plain(value):
            return value.get_secret_value() if hasattr(value,'get_secret_value') else value
        # Match parseCredentials's insertion order and JS compact JSON exactly.
        values={name:plain(getattr(config,name)) for name in (
            'lighter_perpetual_l1_address','lighter_perpetual_api_key_index',
            'lighter_perpetual_api_private_key','lighter_perpetual_account_limit')}
        # The API adapter encrypts every SecretStr on save, while its generic
        # loader decrypts only is_secure fields. Lighter's tier is SecretStr
        # with is_secure=False, so explicitly decode that field when necessary.
        tier_field='lighter_perpetual_account_limit'
        if values[tier_field] not in ('Standard','Premium','Plus','Builder'):
            values[tier_field]=BackendAPISecurity.secrets_manager.decrypt_secret_value(
                attr=tier_field,value=values[tier_field])
        address,index,key,limit=values.values()
        if not isinstance(address,str) or not re.fullmatch(r'0x[0-9a-fA-F]{40}',address) or type(index) is not int or not 4<=index<=254 or not isinstance(key,str) or not re.fullmatch(r'(?:0x)?[0-9a-fA-F]{64,128}',key) or len(key.removeprefix('0x'))%2 or limit not in ('Standard','Premium','Plus','Builder'):
            raise ValueError('Invalid recovery identity')
        connector=await account_service.get_connector_instance(account_name,'lighter_perpetual')
        current=(connector._l1_address,connector._api_key_index,connector._api_private_key,connector._api_account_limit)
        if current != (address,index,key,limit):
            logging.getLogger('quanttrade.connections').warning(
                'Recovery identity comparison: address=%s index=%s key=%s tier=%s',
                current[0]==address,current[1]==index,current[2]==key,current[3]==limit)
            raise ValueError('Configured signing identity differs from persisted credentials')
        await validate('lighter_perpetual',connector,values)
        if path.read_bytes()!=encrypted or current!=(connector._l1_address,connector._api_key_index,connector._api_private_key,connector._api_account_limit):
            raise ValueError('Connection changed during verification')
        if type(connector._account_index) is not int or connector._account_index<0:
            raise ValueError('Verified exchange account is unavailable')
        fingerprint=hashlib.sha256(json.dumps(values,separators=(',',':')).encode()).hexdigest()
        return {'accountName':account_name,'venue':venue,'connectionRevision':fingerprint}


def bundle_credentials(venue, credentials):
    if venue not in VENUES or not isinstance(credentials, dict):
        raise ValueError("Unsupported exchange credentials")
    prefix = f"{venue}_perpetual_"
    spot = {key.replace(prefix, f"{venue}_", 1) if key.startswith(prefix) else key: value
            for key, value in credentials.items()}
    return {f"{venue}_perpetual": credentials, venue: spot}


async def mutate_bundle(account_service, account_name, venue, credentials=None, delete=False):
    if account_name != "desk" or venue not in VENUES:
        raise ValueError("Invalid exchange account")
    from utils.file_system import fs_util
    from quanttrade_credential_validation import rollback_connector

    bundle = bundle_credentials(venue, credentials or {})
    async with LOCK:
        paths = {name: Path(fs_util._get_full_path(
            f"credentials/{account_name}/connectors/{name}.yml")) for name in bundle}
        # Snapshot encrypted bytes only. Previous signing keys never leave this process.
        snapshots = {name: path.read_bytes() if path.exists() else None for name, path in paths.items()}
        modes = {name: path.stat().st_mode & 0o777 for name, path in paths.items() if path.exists()}
        try:
            async def apply():
                for name, fields in bundle.items():
                    if delete:
                        if paths[name].exists():
                            await account_service.delete_credentials(account_name, name)
                    else:
                        await account_service.add_credentials(account_name, name, fields)
            await asyncio.wait_for(apply(), timeout=170)
        except (Exception, asyncio.CancelledError):
            # Restore both disk files before any asynchronous cleanup can be cancelled.
            for name, path in paths.items():
                original = snapshots[name]
                if original is None:
                    path.unlink(missing_ok=True)
                else:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(original)
                    path.chmod(modes[name])
            async def restore_cache():
                for name in bundle:
                    await rollback_connector(account_service._connector_service, account_name, name)
            await asyncio.shield(restore_cache())
            raise ValueError("Exchange connection failed; previous encrypted credentials were restored") from None
    return {"ok": True}


def install(app, auth_user):
    install_lighter_tier_decoder()
    from fastapi import APIRouter, Depends, HTTPException
    from deps import get_accounts_service

    router = APIRouter(prefix="/quanttrade/connections", dependencies=[Depends(auth_user)])

    @router.post('/{account_name}/{venue}/verified-revision')
    async def revision(account_name: str, venue: str, account_service=Depends(get_accounts_service)):
        try:
            return await asyncio.wait_for(verified_revision(account_service,account_name,venue),timeout=50)
        except Exception as failure:
            log_recovery_failure(failure)
            raise HTTPException(status_code=400,detail='Existing exchange connection could not be verified') from None

    @router.post("/{account_name}/{venue}")
    async def connect(account_name: str, venue: str, credentials: dict,
                      account_service=Depends(get_accounts_service)):
        try:
            return await mutate_bundle(account_service, account_name, venue, credentials)
        except ValueError:
            raise HTTPException(status_code=400, detail="Exchange credential verification failed") from None

    @router.delete("/{account_name}/{venue}")
    async def disconnect(account_name: str, venue: str,
                         account_service=Depends(get_accounts_service)):
        try:
            return await mutate_bundle(account_service, account_name, venue, delete=True)
        except ValueError:
            raise HTTPException(status_code=400, detail="Exchange credential removal failed") from None

    app.include_router(router)
