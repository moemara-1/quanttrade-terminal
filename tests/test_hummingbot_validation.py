import importlib.util
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1] / "deployment" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


guard = load("guard", "hummingbot-credential-validation.py")
patcher = load("patcher", "patch-hummingbot-validation.py")


class ValidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_spot_credentials_receive_the_same_authorization_guard(self):
        connector=SimpleNamespace(_api_post=AsyncMock(return_value=[]))
        with patch.object(guard,"_key_address",return_value="0xOwner"):
            await guard.validate("hyperliquid",connector,{"hyperliquid_address":"0xOwner","hyperliquid_secret_key":"test"})
        lighter=SimpleNamespace(_ensure_account_ready=AsyncMock(),_signer_client=SimpleNamespace(check_client=Mock(return_value=None)))
        await guard.validate("lighter",lighter,{})
        lighter._signer_client.check_client.assert_called_once_with()

    async def test_expired_agent_is_rejected(self):
        for expiry in [999_999, "1000000", False, "bad"]:
            connector = SimpleNamespace(_api_post=AsyncMock(return_value=[{"address": "0xAgent", "validUntil": expiry}]))
            with patch.object(guard, "_key_address", return_value="0xAgent"), patch.object(guard.time, "time", return_value=1000):
                with self.assertRaises(ValueError):
                    await guard.validate("hyperliquid_perpetual", connector, {"hyperliquid_perpetual_address": "0xOwner", "hyperliquid_perpetual_secret_key": "test"})

    async def test_unexpired_agent_is_accepted(self):
        connector = SimpleNamespace(_api_post=AsyncMock(return_value=[{"address": "0xAgent", "validUntil": 1_000_001}]))
        with patch.object(guard, "_key_address", return_value="0xAgent"), patch.object(guard.time, "time", return_value=1000):
            await guard.validate("hyperliquid_perpetual", connector, {"hyperliquid_perpetual_address": "0xOwner", "hyperliquid_perpetual_secret_key": "test"})

    async def test_lighter_checks_signer_after_account_initialization(self):
        connector = SimpleNamespace(_ensure_account_ready=AsyncMock(), _signer_client=SimpleNamespace(check_client=Mock(return_value=None)))
        await guard.validate("lighter_perpetual", connector, {})
        connector._ensure_account_ready.assert_awaited_once()
        connector._signer_client.check_client.assert_called_once_with()

    async def test_lighter_invalid_key_and_network_failure_are_sanitized(self):
        for signer in [Mock(return_value="PRIVATE_SECRET mismatch"), Mock(side_effect=RuntimeError("PRIVATE_SECRET"))]:
            connector = SimpleNamespace(_ensure_account_ready=AsyncMock(), _signer_client=SimpleNamespace(check_client=signer))
            with self.assertRaisesRegex(ValueError, "Lighter credential verification failed") as error:
                await guard.validate("lighter_perpetual", connector, {})
            self.assertNotIn("PRIVATE_SECRET", str(error.exception))

    async def test_hyperliquid_owner_and_approved_agent_are_accepted(self):
        for derived, agents in [("0xOwner", []), ("0xAgent", [{"address": "0xAGENT"}])]:
            connector = SimpleNamespace(_api_post=AsyncMock(return_value=agents))
            with patch.object(guard, "_key_address", return_value=derived):
                await guard.validate("hyperliquid_perpetual", connector, {"hyperliquid_perpetual_address": "0xOwner", "hyperliquid_perpetual_secret_key": "PRIVATE_SECRET", "use_vault": False})

    async def test_hyperliquid_wrong_agent_and_failed_lookup_are_rejected(self):
        for lookup in [AsyncMock(return_value=[]), AsyncMock(return_value={}), AsyncMock(side_effect=RuntimeError("PRIVATE_SECRET"))]:
            connector = SimpleNamespace(_api_post=lookup)
            with patch.object(guard, "_key_address", return_value="0xWrong"):
                with self.assertRaisesRegex(ValueError, "Hyperliquid credential verification failed") as error:
                    await guard.validate("hyperliquid_perpetual", connector, {"hyperliquid_perpetual_address": "0xOwner", "hyperliquid_perpetual_secret_key": "PRIVATE_SECRET"})
                self.assertNotIn("PRIVATE_SECRET", str(error.exception))

    async def test_vault_and_bad_key_rejected_without_lookup(self):
        for credentials in [{"use_vault": True}, {"hyperliquid_perpetual_secret_key": "bad"}]:
            connector = SimpleNamespace(_api_post=AsyncMock())
            with patch.object(guard, "_key_address", side_effect=RuntimeError("PRIVATE_SECRET")):
                with self.assertRaises(ValueError):
                    await guard.validate("hyperliquid_perpetual", connector, credentials)
            connector._api_post.assert_not_awaited()

    async def test_other_connectors_unchanged(self):
        await guard.validate("binance", object(), {})


class PatchTests(unittest.TestCase):
    def test_insertion_preserves_rollback_and_is_idempotent(self):
        source = (Path(__file__).parents[1] / "upstream/hummingbot-api/services/accounts_service.py").read_text()
        result = patcher.patch_source(source)
        self.assertIn("await validate_quanttrade_credentials(connector_name, connector, credentials)", result)
        self.assertIn("except Exception as e:", result)
        self.assertEqual(result, patcher.patch_source(result))
        compile(result, "accounts_service.py", "exec")

    def test_unknown_source_rejected(self):
        with self.assertRaises(ValueError):
            patcher.patch_source("unrecognized source")


class RollbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_new_credential_cleanup_is_bounded(self):
        async def delete(*args):
            await guard.asyncio.sleep(30)
        service = SimpleNamespace(delete_credentials=delete)
        with patch.object(guard, "CREDENTIAL_DELETE_TIMEOUT_SECONDS", 0.001):
            await guard.delete_new_credentials(service, "desk", "lighter_perpetual")

    async def test_cancelled_update_rolls_back_and_timeout_is_sanitized(self):
        source = (Path(__file__).parents[1] / "upstream/hummingbot-api/services/accounts_service.py").read_text()
        tree = ast.parse(patcher.patch_source(source))
        accounts = next(item for item in tree.body if isinstance(item, ast.ClassDef) and item.name == "AccountsService")
        method = next(item for item in accounts.body if isinstance(item, ast.AsyncFunctionDef) and item.name == "add_credentials")
        events = []
        fs = SimpleNamespace(path_exists=Mock(return_value=True), read_file=Mock(return_value="old encrypted credentials"), ensure_file_and_dump_text=Mock(side_effect=lambda *args: events.append("restore")))
        async def stalled_update(*args):
            events.append("write")
            await guard.asyncio.sleep(30)
        namespace = {"asyncio": guard.asyncio, "quanttrade_credential_operation_timeout": guard.credential_operation_timeout, "validate_safe_name": Mock(), "fs_util": fs, "logger": Mock(), "validate_quanttrade_credentials": AsyncMock(), "rollback_quanttrade_connector": AsyncMock(side_effect=lambda *args: events.append("invalidate"))}
        exec(compile(ast.Module(body=[method], type_ignores=[]), "test-method", "exec"), namespace)
        service = SimpleNamespace(_connector_service=SimpleNamespace(update_connector_keys=stalled_update), update_account_state=AsyncMock(), delete_credentials=AsyncMock())
        with patch.object(guard, "CREDENTIAL_OPERATION_TIMEOUT_SECONDS", 0.01):
            with self.assertRaisesRegex(ValueError, "Credential connection timed out"):
                await namespace["add_credentials"](service, "desk", "lighter_perpetual", {})
        self.assertEqual(events, ["write", "restore", "invalidate"])

    async def test_other_connector_timeout_wrapper_is_bypassed(self):
        @guard.credential_operation_timeout
        async def operation(self, account_name, connector_name, credentials):
            await guard.asyncio.sleep(0.02)
            return "untouched"
        with patch.object(guard, "CREDENTIAL_OPERATION_TIMEOUT_SECONDS", 0.001):
            self.assertEqual(await operation(None, "desk", "binance", {}), "untouched")

    async def test_runtime_cache_cleared_and_restored_security_reloaded(self):
        for stop in [AsyncMock(), AsyncMock(side_effect=RuntimeError("PRIVATE_SECRET"))]:
            service = SimpleNamespace(stop_trading_connector=stop, clear_trading_connector=Mock())
            with patch.object(guard, "_reload_security") as reload:
                await guard.rollback_connector(service, "desk", "lighter_perpetual")
            stop.assert_awaited_once_with("desk", "lighter_perpetual")
            service.clear_trading_connector.assert_called_once_with("desk", "lighter_perpetual")
            reload.assert_called_once_with("desk")

    async def test_failed_update_restores_file_then_invalidates_runtime_state(self):
        source = (Path(__file__).parents[1] / "upstream/hummingbot-api/services/accounts_service.py").read_text()
        tree = ast.parse(patcher.patch_source(source))
        accounts = next(item for item in tree.body if isinstance(item, ast.ClassDef) and item.name == "AccountsService")
        method = next(item for item in accounts.body if isinstance(item, ast.AsyncFunctionDef) and item.name == "add_credentials")
        events = []
        fs = SimpleNamespace(path_exists=Mock(return_value=True), read_file=Mock(return_value="old encrypted credentials"), ensure_file_and_dump_text=Mock(side_effect=lambda *args: events.append("restore")))
        namespace = {"asyncio": guard.asyncio, "quanttrade_credential_operation_timeout": guard.credential_operation_timeout, "validate_safe_name": Mock(), "fs_util": fs, "logger": Mock(), "validate_quanttrade_credentials": AsyncMock(side_effect=ValueError("verification failed")), "rollback_quanttrade_connector": AsyncMock(side_effect=lambda *args: events.append("invalidate"))}
        exec(compile(ast.Module(body=[method], type_ignores=[]), "test-method", "exec"), namespace)
        service = SimpleNamespace(_connector_service=SimpleNamespace(update_connector_keys=AsyncMock(return_value=object())), update_account_state=AsyncMock(), delete_credentials=AsyncMock())
        with self.assertRaisesRegex(ValueError, "verification failed"):
            await namespace["add_credentials"](service, "desk", "lighter_perpetual", {})
        self.assertEqual(events, ["restore", "invalidate"])
        service.delete_credentials.assert_not_awaited()
        service.update_account_state.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
