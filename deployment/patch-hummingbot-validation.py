"""Patch the exact Hummingbot add-credential anchor; refuse source drift."""
import argparse
from pathlib import Path


IMPORT = "from quanttrade_credential_validation import validate as validate_quanttrade_credentials\n"
ROLLBACK_IMPORT = "from quanttrade_credential_validation import rollback_connector as rollback_quanttrade_connector\n"
TIMEOUT_IMPORT = "from quanttrade_credential_validation import credential_operation_timeout as quanttrade_credential_operation_timeout\n"
DELETE_IMPORT = "from quanttrade_credential_validation import delete_new_credentials as delete_new_quanttrade_credentials\n"
DELETE_CALL = "                await delete_new_quanttrade_credentials(self, account_name, connector_name)"
DEFINITION = "    async def add_credentials(self, account_name: str, connector_name: str, credentials: dict):"
DECORATOR = "    @quanttrade_credential_operation_timeout"
ANCHOR = "            connector = await self._connector_service.update_connector_keys(account_name, connector_name, credentials)"
CALL = "            await validate_quanttrade_credentials(connector_name, connector, credentials)"
ROLLBACK_ANCHOR = "                fs_util.ensure_file_and_dump_text(credentials_path, original_content)\n            raise e"
ROLLBACK_CALL = "            await rollback_quanttrade_connector(self._connector_service, account_name, connector_name)"


def patch_source(source):
    markers = [IMPORT, CALL, ROLLBACK_IMPORT, ROLLBACK_CALL, TIMEOUT_IMPORT, DECORATOR, DELETE_IMPORT, DELETE_CALL]
    if all(item in source for item in markers):
        if any(source.count(item) != 1 for item in markers):
            raise ValueError("Credential validation patch is duplicated")
        return source
    if any(item in source for item in markers) or source.count(ANCHOR) != 1 or source.count(ROLLBACK_ANCHOR) != 1 or source.count(DEFINITION) != 1:
        raise ValueError("Hummingbot credential validation source anchor mismatch")
    start = source.index(DEFINITION)
    end = source.index("\n    @staticmethod", start)
    method = source[start:end]
    handler = "        except Exception as e:"
    if method.count(handler) != 1:
        raise ValueError("Hummingbot credential rollback handler anchor mismatch")
    method = method.replace(handler, "        except (Exception, asyncio.CancelledError) as e:", 1)
    deletion = "                await self.delete_credentials(account_name, connector_name)"
    if method.count(deletion) != 1:
        raise ValueError("Hummingbot credential deletion anchor mismatch")
    method = method.replace(deletion, DELETE_CALL, 1)
    source = source[:start] + DECORATOR + "\n" + method + source[end:]
    result = IMPORT + ROLLBACK_IMPORT + TIMEOUT_IMPORT + DELETE_IMPORT + source.replace(ANCHOR, ANCHOR + "\n" + CALL, 1)
    result = result.replace(ROLLBACK_ANCHOR, "                fs_util.ensure_file_and_dump_text(credentials_path, original_content)\n" + ROLLBACK_CALL + "\n            raise e", 1)
    compile(result, "accounts_service.py", "exec")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = patch_source(args.source.read_text(encoding="utf-8"))
    args.output.write_text(result, encoding="utf-8")


if __name__ == "__main__":
    main()
