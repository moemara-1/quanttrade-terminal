import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('repair_spot', Path(__file__).parents[1] / 'deployment/repair-missing-lighter-spot.py')
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


class SpotRepairTests(unittest.TestCase):
    def test_renames_only_expected_fields_without_changing_identity(self):
        values = {'lighter_perpetual_l1_address': 'wallet', 'lighter_perpetual_api_key_index': 4,
                  'lighter_perpetual_api_private_key': 'private', 'lighter_perpetual_account_limit': 'Standard'}
        self.assertEqual(repair.spot_fields(values), {'lighter_l1_address': 'wallet', 'lighter_api_key_index': 4,
                         'lighter_api_private_key': 'private', 'lighter_account_limit': 'Standard'})

    def test_exclusive_write_preserves_existing_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'lighter.yml'
            repair.write_missing(target, 'encrypted')
            with self.assertRaises(FileExistsError):
                repair.write_missing(target, 'replacement')
            self.assertEqual(target.read_text(), 'encrypted')


if __name__ == '__main__':
    unittest.main()
