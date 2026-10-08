"""Atomic encrypted spot/perpetual credential bundles for the private API."""
import asyncio
from pathlib import Path

LOCK = asyncio.Lock()
VENUES = ("hyperliquid", "lighter")


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
    from fastapi import APIRouter, Depends, HTTPException
    from deps import get_accounts_service

    router = APIRouter(prefix="/quanttrade/connections", dependencies=[Depends(auth_user)])

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
