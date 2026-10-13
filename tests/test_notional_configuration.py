import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('notional_configuration', Path(__file__).parents[1] / 'deployment/configure-notional-limits.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class NotionalConfigurationTests(unittest.TestCase):
    def test_only_authorized_settings_change_and_duplicates_are_disabled(self):
        original = '# comment\r\nHUMMINGBOT_PASSWORD=unit-test-placeholder\r\nMAX_ORDER_NOTIONAL=1000\r\nexport DAILY_NOTIONAL_LIMIT=5000\r\nMAX_ORDER_NOTIONAL=2000\r\nDESK_MODE=live\r\n'
        updated = module.disable_notional_limits(original)
        self.assertIn('HUMMINGBOT_PASSWORD=unit-test-placeholder\r\n', updated)
        self.assertIn('DESK_MODE=live\r\n', updated)
        self.assertEqual(updated.count('MAX_ORDER_NOTIONAL=off'), 2)
        self.assertIn('DAILY_NOTIONAL_LIMIT=off\r\n', updated)
        self.assertEqual(module.disable_notional_limits(updated), updated)

    def test_missing_settings_are_added_without_changing_existing_values(self):
        updated = module.disable_notional_limits('DESK_MODE=live')
        self.assertEqual(updated, 'DESK_MODE=live\nDAILY_NOTIONAL_LIMIT=off\nMAX_ORDER_NOTIONAL=off\n')

if __name__ == '__main__':
    unittest.main()
