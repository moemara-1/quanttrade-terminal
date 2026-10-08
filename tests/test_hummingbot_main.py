import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("quanttrade_main_patch", Path(__file__).parents[1] / "deployment/patch-hummingbot-main.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MainPatchTests(unittest.TestCase):
    def test_extensions_receive_existing_authentication_dependency(self):
        source = module.patch(module.ANCHOR)
        self.assertIn("install_quanttrade_market(app, auth_user)", source)
        self.assertIn("install_quanttrade_trading(app, auth_user)", source)
        self.assertIn("install_quanttrade_connections(app, auth_user)", source)
        self.assertEqual(source.count(module.MARKER), 1)

    def test_reapplication_is_idempotent(self):
        source = module.patch(module.ANCHOR)
        self.assertEqual(module.patch(source), source)

    def test_missing_or_changed_registration_fails(self):
        with self.assertRaises(ValueError):
            module.patch("app = FastAPI()")
        with self.assertRaises(ValueError):
            module.patch(module.MARKER)
