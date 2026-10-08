import asyncio
import importlib.util
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace, ModuleType
import unittest
from unittest.mock import AsyncMock, patch


spec = importlib.util.spec_from_file_location("connections", Path(__file__).parents[1] / "deployment" / "quanttrade-hummingbot-connections.py")
connections = importlib.util.module_from_spec(spec)
spec.loader.exec_module(connections)


class BundleTests(unittest.IsolatedAsyncioTestCase):
    async def run_case(self, existing, fail=False, cancel=False, delete=False):
        with tempfile.TemporaryDirectory() as directory:
            paths={name:Path(directory)/f"{name}.yml" for name in ("lighter_perpetual","lighter")}
            if existing:
                for path in paths.values():path.write_bytes(b"old encrypted credential")
            async def mutate(_account,name,fields=None):
                if delete: paths[name].unlink(missing_ok=True)
                else: paths[name].write_bytes(b"new encrypted credential")
                if name=="lighter" and (fail or cancel):
                    if cancel:raise asyncio.CancelledError()
                    raise ValueError("SIGNING_SECRET")
            service=SimpleNamespace(add_credentials=AsyncMock(side_effect=mutate),delete_credentials=AsyncMock(side_effect=mutate),_connector_service=object())
            rollback=AsyncMock()
            filesystem=ModuleType("utils.file_system")
            filesystem.fs_util=SimpleNamespace(_get_full_path=lambda value:str(paths[Path(value).stem]))
            guard=ModuleType("quanttrade_credential_validation");guard.rollback_connector=rollback
            with patch.dict(sys.modules,{"utils.file_system":filesystem,"quanttrade_credential_validation":guard}):
                if fail or cancel:
                    with self.assertRaisesRegex(ValueError,"previous encrypted credentials were restored") as error:
                        await connections.mutate_bundle(service,"desk","lighter",{"lighter_perpetual_api_key_index":4},delete=delete)
                    self.assertNotIn("SIGNING_SECRET",str(error.exception))
                    for path in paths.values():
                        if existing:self.assertEqual(path.read_bytes(),b"old encrypted credential")
                        else:self.assertFalse(path.exists())
                    self.assertEqual(rollback.await_count,2)
                else:
                    self.assertEqual(await connections.mutate_bundle(service,"desk","lighter",{"lighter_perpetual_api_key_index":4},delete=delete),{"ok":True})
                    if delete:self.assertTrue(all(not path.exists() for path in paths.values()))
                    else:
                        self.assertEqual(service.add_credentials.await_count,2)
                        self.assertEqual(service.add_credentials.await_args_list[1].args[2],{"lighter_api_key_index":4})

    async def test_success_fans_out_actual_connector_field_names(self):await self.run_case(False)
    async def test_failed_update_restores_both_encrypted_files(self):await self.run_case(True,fail=True)
    async def test_failed_creation_removes_both_partial_files(self):await self.run_case(False,fail=True)
    async def test_cancellation_restores_both_files_and_cache(self):await self.run_case(True,cancel=True)
    async def test_delete_removes_both_connector_files(self):await self.run_case(True,delete=True)
    async def test_partial_delete_failure_restores_original_files(self):await self.run_case(True,fail=True,delete=True)
    async def test_unsafe_account_is_rejected_before_file_access(self):
        with self.assertRaises(ValueError):await connections.mutate_bundle(None,"../escape","lighter",{})
    async def test_other_valid_account_cannot_mutate_credentials(self):
        with self.assertRaises(ValueError):await connections.mutate_bundle(None,"other_account","lighter",{})


if __name__=="__main__":unittest.main()
