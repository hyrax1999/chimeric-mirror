import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import tarfile
import io
import gzip
import unittest

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location("build_portable", ROOT / "tools/build-portable.py")
build_portable = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_portable)

class PortableExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name); self.runtime = root / "runtime"; self.runtime.mkdir()
        self.binary = root / "native"; self.binary.write_bytes(b"small-test-native"); self.binary.chmod(0o755)
        self.assets = self.runtime / "assets-science-test"; self.assets.mkdir()
        (self.assets / ".science-assets-sha256").write_text("asset-test-sha\n"); (self.assets / "payload.txt").write_text("safe\n")
        tar_bytes = io.BytesIO()
        with tarfile.open(fileobj=tar_bytes, mode="w") as tar:
            info = tarfile.TarInfo("."); info.type = tarfile.DIRTYPE; tar.addfile(info)
            tar.add(self.assets / "payload.txt", arcname="./payload.txt")
        raw_tar = tar_bytes.getvalue(); asset_sha = hashlib.sha256(raw_tar).hexdigest()
        (self.assets / ".science-assets-sha256").write_text(asset_sha + "\n")
        (self.runtime / "assets.tar-test.gz").write_bytes(gzip.compress(raw_tar))
        for name in build_portable.REQUIRED_RUNTIME:
            path = self.runtime / name; path.parent.mkdir(parents=True, exist_ok=True)
            if name == "asset-manifest.json": path.write_text(json.dumps({"archive": "assets.tar-test.gz", "rootRelative": self.assets.name, "sha256": asset_sha, "moduleVersion": "?test"}))
            elif name == "patch-manifest.json": path.write_text(json.dumps({"platform": "linux-x64", "sourceSha256": "source-test"}))
            else: path.write_text("runtime\n")
        patches = {"platform": "linux-x64", "sourceSha256": build_portable.EXPECTED_SOURCE_SHA256, "outputSha256": hashlib.sha256((self.runtime / "chimeric.js").read_bytes()).hexdigest()}
        (self.runtime / "patch-manifest.json").write_text(json.dumps(patches))
        self.expected = hashlib.sha256(self.binary.read_bytes()).hexdigest()

    def tearDown(self): self.tmp.cleanup()

    def test_export_is_integrity_recorded_and_fresh(self):
        out = Path(self.tmp.name) / "export"
        record = build_portable.export_bundle(self.runtime, self.binary, out, expected_binary_sha256=self.expected)
        self.assertFalse(record["executionVerified"]); self.assertEqual(record["assetTreeTarSha256"], json.loads((self.runtime / "asset-manifest.json").read_text())["sha256"])
        self.assertEqual((out / "runtime/assets-science-test/payload.txt").read_text(), "safe\n")
        with self.assertRaisesRegex(ValueError, "must not already exist"): build_portable.export_bundle(self.runtime, self.binary, out, expected_binary_sha256=self.expected)

    def test_rejects_bad_archive_hash(self):
        manifest = json.loads((self.runtime / "asset-manifest.json").read_text()); manifest["archiveSha256"] = "0" * 64
        (self.runtime / "asset-manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "archiveSha256"): build_portable.export_bundle(self.runtime, self.binary, Path(self.tmp.name) / "bad", expected_binary_sha256=self.expected)

    def test_rejects_asset_path_escape(self):
        manifest = json.loads((self.runtime / "asset-manifest.json").read_text()); manifest["rootRelative"] = "../outside"
        (self.runtime / "asset-manifest.json").write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "escapes runtime"): build_portable.export_bundle(self.runtime, self.binary, Path(self.tmp.name) / "escape", expected_binary_sha256=self.expected)

    def test_rejects_changed_archive_and_malformed_gzip(self):
        path = self.runtime / "assets.tar-test.gz"; path.write_bytes(b"not-gzip")
        with self.assertRaises(Exception): build_portable.export_bundle(self.runtime, self.binary, Path(self.tmp.name) / "bad-gzip", expected_binary_sha256=self.expected)

    def test_rejects_changed_tree_against_archive(self):
        (self.assets / "payload.txt").write_text("changed\n")
        with self.assertRaisesRegex(ValueError, "does not exactly match"):
            build_portable.export_bundle(self.runtime, self.binary, Path(self.tmp.name) / "bad-tree", expected_binary_sha256=self.expected)
