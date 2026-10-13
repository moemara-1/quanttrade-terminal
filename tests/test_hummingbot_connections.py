import asyncio
import ast
import hashlib
import json
import importlib.util
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace, ModuleType
import unittest
from unittest.mock import AsyncMock, patch


def real_adapter_contract(values, manager):
    """Execute the checked-in adapter methods with real SecretStr fields."""
    from pydantic import BaseModel, SecretStr
    class Model(BaseModel):
        model_config={'validate_assignment':True}
        connector:str='lighter_perpetual'
        lighter_perpetual_l1_address:str
        lighter_perpetual_api_key_index:int
        lighter_perpetual_api_private_key:SecretStr
        lighter_perpetual_account_limit:SecretStr
    class Adapter:
        def __init__(self,model):object.__setattr__(self,'_hb_config',model)
        def __getattr__(self,name):return getattr(self._hb_config,name)
        def __setattr__(self,name,value):setattr(self._hb_config,name,value)
        def traverse(self):
            for name in type(self._hb_config).model_fields:
                yield SimpleNamespace(attr=name,config_path=name,value=getattr(self,name),client_field_data=SimpleNamespace(is_secure=name.endswith('api_private_key')))
    source=ast.parse((Path(__file__).parents[1]/'upstream/hummingbot-api/utils/hummingbot_api_config_adapter.py').read_text())
    actual=next(node for node in source.body if isinstance(node,ast.ClassDef))
    actual.body=[node for node in actual.body if isinstance(node,ast.FunctionDef) and node.name in ('_encrypt_secrets','decrypt_all_secure_data')]
    namespace={'ClientConfigAdapter':Adapter,'SecretStr':SecretStr,'Dict':dict,'Any':object}
    exec(compile(ast.Module(body=[actual],type_ignores=[]),'<actual-api-config-adapter>','exec'),namespace)
    adapter_type=namespace['HummingbotAPIConfigAdapter']
    security=ModuleType('utils.security');security.BackendAPISecurity=SimpleNamespace(secrets_manager=manager)
    with patch.dict(sys.modules,{'utils.security':security}):
        data=Model(**values).model_dump()
        adapter_type(Model(**values))._encrypt_secrets(data)
        loaded=adapter_type(Model(**data));loaded.decrypt_all_secure_data()
    return loaded


spec = importlib.util.spec_from_file_location("connections", Path(__file__).parents[1] / "deployment" / "quanttrade-hummingbot-connections.py")
connections = importlib.util.module_from_spec(spec)
spec.loader.exec_module(connections)


class BundleTests(unittest.IsolatedAsyncioTestCase):
    async def test_loader_hook_decodes_only_lighter_tier_before_connector_construction(self):
        from pydantic import SecretStr
        decoded=[]
        manager=SimpleNamespace(encrypt_secret_value=lambda attr,value:'cipher:'+value,decrypt_secret_value=lambda attr,value:(decoded.append((attr,value)) or value.removeprefix('cipher:')))
        values={'lighter_perpetual_l1_address':'0x'+'1'*40,'lighter_perpetual_api_key_index':4,'lighter_perpetual_api_private_key':'a'*64,'lighter_perpetual_account_limit':'Premium'}
        class Security:
            secrets_manager=manager
            @classmethod
            def load_connector_config_map_from_file(cls,path):
                if path.stem=='lighter_perpetual':return real_adapter_contract(values,manager)
                return SimpleNamespace(connector=path.stem)
        security=ModuleType('utils.security');security.BackendAPISecurity=Security
        with patch.dict(sys.modules,{'utils.security':security}):
            connections.install_lighter_tier_decoder()
            connections.install_lighter_tier_decoder()
            loaded=Security.load_connector_config_map_from_file(Path('lighter_perpetual.yml'))
            self.assertEqual(loaded.lighter_perpetual_account_limit.get_secret_value(),'Premium')
            self.assertEqual(loaded.lighter_perpetual_api_private_key.get_secret_value(),'a'*64)
            self.assertEqual(decoded,[('lighter_perpetual_api_private_key','cipher:'+'a'*64),('lighter_perpetual_account_limit','cipher:Premium')])
            Security.load_connector_config_map_from_file(Path('hyperliquid_perpetual.yml'))
            self.assertEqual(len(decoded),2)
    async def test_real_adapter_tier_remains_encrypted_and_recovery_decodes_only_tier(self):
        from pydantic import SecretStr
        values={'lighter_perpetual_l1_address':'0x'+'1'*40,'lighter_perpetual_api_key_index':4,'lighter_perpetual_api_private_key':'2'*64,'lighter_perpetual_account_limit':'Premium'}
        manager=SimpleNamespace(encrypt_secret_value=lambda name,value:'cipher:'+value,decrypt_secret_value=lambda attr,value:value.removeprefix('cipher:'))
        config=real_adapter_contract(values,manager)
        self.assertEqual(config.lighter_perpetual_api_private_key.get_secret_value(),values['lighter_perpetual_api_private_key'])
        self.assertEqual(config.lighter_perpetual_account_limit.get_secret_value(),'cipher:Premium')
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'lighter_perpetual.yml';path.write_bytes(b'encrypted')
            connector=SimpleNamespace(_l1_address=values['lighter_perpetual_l1_address'],_api_key_index=4,_api_private_key='2'*64,_api_account_limit='Premium',_account_index=12)
            service=SimpleNamespace(get_connector_instance=AsyncMock(return_value=connector))
            filesystem=ModuleType('utils.file_system');filesystem.fs_util=SimpleNamespace(_get_full_path=lambda _:str(path))
            security=ModuleType('utils.security');security.BackendAPISecurity=SimpleNamespace(load_connector_config_map_from_file=lambda _:config,secrets_manager=manager)
            guard=ModuleType('quanttrade_credential_validation');guard.validate=AsyncMock()
            with patch.dict(sys.modules,{'utils.file_system':filesystem,'utils.security':security,'quanttrade_credential_validation':guard}):
                result=await connections.verified_revision(service,'desk','lighter')
                self.assertEqual(result['connectionRevision'],hashlib.sha256(json.dumps(values,separators=(',',':')).encode()).hexdigest())
    async def test_recovery_diagnostic_never_logs_exception_message_or_source(self):
        try:
            raise ValueError('DO_NOT_PRINT_SECRET')
        except ValueError as failure:
            with self.assertLogs('quanttrade.connections',level='WARNING') as output:
                connections.log_recovery_failure(failure)
        self.assertIn('ValueError',output.output[0])
        self.assertIn('test_hummingbot_connections.py:',output.output[0])
        self.assertNotIn('DO_NOT_PRINT_SECRET',output.output[0])
    async def test_recovery_verifies_loaded_identity_and_returns_only_canonical_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'lighter_perpetual.yml';path.write_bytes(b'encrypted')
            values={'lighter_perpetual_l1_address':'0x'+'1'*40,'lighter_perpetual_api_key_index':4,'lighter_perpetual_api_private_key':'2'*64,'lighter_perpetual_account_limit':'Standard'}
            connector=SimpleNamespace(_l1_address=values['lighter_perpetual_l1_address'],_api_key_index=4,_api_private_key='2'*64,_api_account_limit='Standard',_account_index=12)
            service=SimpleNamespace(get_connector_instance=AsyncMock(return_value=connector))
            filesystem=ModuleType('utils.file_system');filesystem.fs_util=SimpleNamespace(_get_full_path=lambda _:str(path))
            security=ModuleType('utils.security');security.BackendAPISecurity=SimpleNamespace(load_connector_config_map_from_file=lambda _:SimpleNamespace(**values))
            guard=ModuleType('quanttrade_credential_validation');guard.validate=AsyncMock()
            with patch.dict(sys.modules,{'utils.file_system':filesystem,'utils.security':security,'quanttrade_credential_validation':guard}):
                result=await connections.verified_revision(service,'desk','lighter')
                expected=hashlib.sha256(json.dumps(values,separators=(',',':')).encode()).hexdigest()
                self.assertEqual(result,{'accountName':'desk','venue':'lighter','connectionRevision':expected})
                guard.validate.assert_awaited_once()
                connector._api_private_key='3'*64
                with self.assertRaisesRegex(ValueError,'identity'):
                    await connections.verified_revision(service,'desk','lighter')
                connector._api_private_key='2'*64
                async def changed(*_):path.write_bytes(b'replaced')
                guard.validate.side_effect=changed
                with self.assertRaisesRegex(ValueError,'changed'):
                    await connections.verified_revision(service,'desk','lighter')
    async def test_recovery_rejects_other_account_before_access(self):
        with self.assertRaises(ValueError):await connections.verified_revision(None,'other','lighter')
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
