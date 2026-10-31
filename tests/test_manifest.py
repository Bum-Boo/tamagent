"""설치 경로 점검: 마켓플레이스·플러그인·훅 매니페스트와 README 설치 안내가 서로 맞는지."""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
READMES = ['README.md', 'README.en.md', 'README.ja.md', 'README.zh.md']


def load(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8'))


class ManifestTest(unittest.TestCase):
    def setUp(self):
        self.plugin = load('.claude-plugin/plugin.json')
        self.market = load('.claude-plugin/marketplace.json')

    def test_marketplace_points_at_this_plugin(self):
        entries = self.market['plugins']
        self.assertEqual([entry['name'] for entry in entries], [self.plugin['name']])
        self.assertEqual(entries[0]['source'], './')
        self.assertEqual(self.market['name'], self.plugin['name'])

    def test_hooks_and_types_exist(self):
        hooks = load('hooks/hooks.json')
        self.assertTrue(hooks['modules'])
        for module in hooks['modules']:
            self.assertTrue((ROOT / 'hooks' / module).is_file(), module)
        self.assertTrue((ROOT / self.plugin['types']).is_file())

    def test_user_config_defaults_match_their_types(self):
        kinds = {'string': str, 'number': (int, float)}
        for key, field in self.plugin['userConfig'].items():
            with self.subTest(key=key):
                self.assertIsInstance(field['default'], kinds[field['type']])
                if 'options' in field:
                    self.assertIn(field['default'], field['options'])
        self.assertEqual(json.loads(self.plugin['userConfig']['sources']['default']), [])

    def test_readme_install_command_names_this_repository(self):
        repo = re.match(r'https://github\.com/([^/]+/[^/]+?)(?:\.git)?$', self.plugin['repository']).group(1)
        command = f"/plugin install {self.plugin['name']} --marketplace {repo}"
        for name in READMES:
            with self.subTest(readme=name):
                self.assertIn(command, (ROOT / name).read_text(encoding='utf-8'))

    def test_readme_host_range_matches_the_runtime_check(self):
        source = (ROOT / 'hooks/host.ts').read_text(encoding='utf-8')
        low = re.search(r"MIN_HOST = '([\d.]+)'", source).group(1)
        high = re.search(r"TESTED_HOST = '([\d.]+)'", source).group(1)
        for name in READMES:
            with self.subTest(readme=name):
                text = (ROOT / name).read_text(encoding='utf-8')
                install = text[:text.index('/plugin install')]
                self.assertEqual(sorted(set(re.findall(r'(?<![\d.])\d+\.\d+\.\d+(?![\d.])', install))), sorted({low, high}))


if __name__ == '__main__':
    unittest.main()
