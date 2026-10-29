"""Exercise the publication boundary with private-file and failure controls."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from release_check import (REQUIRED_DIRECTORIES, REQUIRED_ROOT_FILES, REQUIRED_TOOLS,
                           ReleaseError, audit, selected_paths)

spec = importlib.util.spec_from_file_location('prepare_release', Path(__file__).resolve().parents[1] / 'tools/prepare-release.py')
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class SourceBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.root = self.base / 'project'
        self.root.mkdir()
        for name in REQUIRED_DIRECTORIES:
            (self.root / name).mkdir(parents=True)
            (self.root / name / 'fixture.txt').write_text('fixture\n')
        (self.root / 'tools').mkdir()
        for name in REQUIRED_TOOLS:
            (self.root / 'tools' / name).write_text('# fixture\n')
        (self.root / 'src/example.ts').write_text('export const answer=42;\n')
        policy = {'files': sorted(REQUIRED_ROOT_FILES),
                  'directories': sorted(REQUIRED_DIRECTORIES),
                  'tools': sorted(REQUIRED_TOOLS)}
        (self.root / 'release.manifest.json').write_text(json.dumps(policy))
        (self.root / 'README.md').write_text('# Example\n\n[Source](src/example.ts)\n')
        (self.root / 'release-status.json').write_text(json.dumps({'channel': 'development', 'releaseGates': [{'id': 'runtime', 'status': 'pending'}]}))
        for name in REQUIRED_ROOT_FILES - {'README.md', 'release.manifest.json', 'release-status.json'}:
            (self.root / name).write_text('# fixture\n')

    def rewrite_policy(self, policy):
        (self.root / 'release.manifest.json').write_text(json.dumps(policy))

    def test_export_excludes_unselected_profile_and_preserves_bytes(self):
        private = self.root / 'local-auth'
        private.mkdir()
        (private / 'providers.key').write_text('private fixture key')
        output = self.base / 'export'
        result = exporter.export_source(self.root, output)
        self.assertTrue(result['sourceChecksPassed'])
        self.assertFalse((output / 'local-auth').exists())
        self.assertEqual((output / 'src/example.ts').read_bytes(), (self.root / 'src/example.ts').read_bytes())
        self.assertEqual(result['openReleaseGates'], ['runtime'])
        self.assertFalse(json.loads((output / 'SOURCE-MANIFEST.json').read_text())['originalRuntimeIncluded'])

    def test_concurrent_staged_change_does_not_publish_an_unchecked_tree(self):
        original_audit = exporter.audit
        def change_after_check(root, markers=None, strict_tree=False):
            result = original_audit(root, markers, strict_tree)
            if root.resolve() != self.root.resolve():
                (root / 'src/example.ts').write_text('changed after the staged audit')
            return result
        with patch.object(exporter, 'audit', side_effect=change_after_check):
            with self.assertRaisesRegex(ReleaseError, 'Staged files changed'):
                exporter.export_source(self.root, self.base / 'export')
        self.assertFalse((self.base / 'export').exists())

    def test_private_file_inside_selected_tree_blocks_export(self):
        (self.root / 'src/providers.key').write_text('private fixture key')
        with self.assertRaises(ReleaseError):
            exporter.export_source(self.root, self.base / 'export')
        self.assertFalse((self.base / 'export').exists())

    def test_symlink_to_private_file_is_rejected(self):
        (self.base / 'private.txt').write_text('fixture secret')
        (self.root / 'src/alias.ts').symlink_to(self.base / 'private.txt')
        with self.assertRaises(ReleaseError):
            selected_paths(self.root)

    def test_manifest_cannot_escape_the_project(self):
        (self.base / 'private.txt').write_text('fixture secret')
        policy = json.loads((self.root / 'release.manifest.json').read_text())
        policy['files'].append('../private.txt')
        self.rewrite_policy(policy)
        with self.assertRaises(ReleaseError):
            selected_paths(self.root)

    def test_manifest_cannot_drop_reviewed_source_area(self):
        policy = json.loads((self.root / 'release.manifest.json').read_text())
        for directory in ('src', 'tests', 'docs', '.github'):
            candidate = json.loads(json.dumps(policy))
            candidate['directories'].remove(directory)
            self.rewrite_policy(candidate)
            with self.subTest(directory=directory), self.assertRaisesRegex(ReleaseError, 'complete reviewed source boundary'):
                selected_paths(self.root)
        candidate = json.loads(json.dumps(policy))
        candidate['tools'].remove('release_check.py')
        self.rewrite_policy(candidate)
        with self.assertRaisesRegex(ReleaseError, 'complete reviewed source boundary'):
            selected_paths(self.root)

    def test_stale_output_is_never_overwritten(self):
        output = self.base / 'export'
        output.mkdir()
        (output / 'keep.txt').write_text('keep')
        with self.assertRaises(ReleaseError):
            exporter.export_source(self.root, output)
        self.assertEqual((output / 'keep.txt').read_text(), 'keep')

    def test_broken_and_outside_links_fail(self):
        (self.root / 'README.md').write_text('[Missing](missing.md)\n[Outside](../private.txt)\n')
        result = audit(self.root)
        self.assertFalse(result['sourceChecksPassed'])
        self.assertEqual(len(result['findings']), 2)

    def test_known_secret_pattern_is_redacted_in_report(self):
        credential = 'sk-' + 'A' * 40
        (self.root / 'src/example.ts').write_text('const key=' + repr(credential))
        result = audit(self.root)
        self.assertFalse(result['sourceChecksPassed'])
        self.assertNotIn(credential, json.dumps(result))

    def test_private_marker_and_unselected_file_controls(self):
        (self.root / 'src/example.ts').write_text('private-deployment-marker')
        result = audit(self.root, [b'private-deployment-marker'])
        self.assertFalse(result['sourceChecksPassed'])
        (self.root / 'unexpected.txt').write_text('not selected')
        self.assertTrue(any('unselected' in finding for finding in audit(self.root, strict_tree=True)['findings']))


if __name__ == '__main__':
    unittest.main()
