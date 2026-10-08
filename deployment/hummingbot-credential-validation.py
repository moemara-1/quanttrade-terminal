"""Read-only credential checks invoked inside Hummingbot's rollback boundary."""
import asyncio
import functools
import logging
import time


logger = logging.getLogger(__name__)
CREDENTIAL_OPERATION_TIMEOUT_SECONDS = 75
CREDENTIAL_DELETE_TIMEOUT_SECONDS = 10


def credential_operation_timeout(operation):
    @functools.wraps(operation)
    async def bounded(self, account_name, connector_name, credentials):
        if connector_name not in ("lighter_perpetual", "hyperliquid_perpetual", "lighter", "hyperliquid"):
            return await operation(self, account_name, connector_name, credentials)
        try:
            return await asyncio.wait_for(
                operation(self, account_name, connector_name, credentials),
                timeout=CREDENTIAL_OPERATION_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            raise ValueError("Credential connection timed out; previous credentials were restored") from None
    return bounded


def _key_address(private_key):
    from eth_account import Account
    return Account.from_key(private_key).address


def _agent_active(agent):
    if "validUntil" not in agent:
        return True
    expiry = agent["validUntil"]
    return isinstance(expiry, int) and not isinstance(expiry, bool) and expiry > time.time() * 1000


def _reload_security(account_name):
    from utils.security import BackendAPISecurity
    BackendAPISecurity.decrypt_all(account_name=account_name)


async def delete_new_credentials(account_service, account_name, connector_name):
    if connector_name not in ("lighter_perpetual", "hyperliquid_perpetual", "lighter", "hyperliquid"):
        return await account_service.delete_credentials(account_name, connector_name)
    try:
        # Hummingbot deletes the file synchronously before awaiting network shutdown.
        await asyncio.wait_for(account_service.delete_credentials(account_name, connector_name), timeout=CREDENTIAL_DELETE_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        logger.warning("New credential cleanup exceeded its shutdown deadline")


async def rollback_connector(connector_service, account_name, connector_name):
    """Discard a failed replacement after its original credential file is restored."""
    if connector_name not in ("lighter_perpetual", "hyperliquid_perpetual", "lighter", "hyperliquid"):
        return
    try:
        await asyncio.wait_for(connector_service.stop_trading_connector(account_name, connector_name), timeout=20)
    except Exception:
        logger.warning("Credential rollback could not finish connector shutdown")
    finally:
        connector_service.clear_trading_connector(account_name, connector_name)
    try:
        _reload_security(account_name)
    except Exception:
        raise ValueError("Credential rollback could not reload the restored configuration") from None


async def validate(connector_name, connector, credentials):
    if connector_name in ("lighter_perpetual", "lighter"):
        try:
            await asyncio.wait_for(connector._ensure_account_ready(), timeout=20)
            error = await asyncio.wait_for(
                asyncio.to_thread(connector._signer_client.check_client), timeout=20
            )
            if error is not None:
                raise ValueError("Signer verification rejected")
        except Exception:
            raise ValueError("Lighter credential verification failed") from None
    elif connector_name in ("hyperliquid_perpetual", "hyperliquid"):
        try:
            if credentials.get("use_vault", False) is not False:
                raise ValueError("Vault connection is unsupported")
            address = credentials[f"{connector_name}_address"].lower()
            derived = _key_address(credentials[f"{connector_name}_secret_key"]).lower()
            if derived == address:
                return
            agents = await asyncio.wait_for(connector._api_post(
                path_url="/info", data={"type": "extraAgents", "user": address}
            ), timeout=20)
            if not isinstance(agents, list) or not any(
                isinstance(agent, dict)
                and isinstance(agent.get("address"), str)
                and agent["address"].lower() == derived
                and _agent_active(agent)
                for agent in agents
            ):
                raise ValueError("Agent is not approved")
        except Exception:
            raise ValueError("Hyperliquid credential verification failed") from None
