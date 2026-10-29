"""Package the checked research runtime in a native Chimeric macOS window."""
from __future__ import annotations
import argparse
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

SOURCE = Path(__file__).resolve().parents[1]
EXPECTED_BINARY_SHA256 = '7a9a230d4b338c1a856d8015b88c6fb8d38512126819d6bbd87c8c584f89eb53'
EXPECTED_SOURCE_SHA256 = 'e3674e221f9079520f014eb2ef93d0ba151934a47fd561594efcb23a86809e0b'
spec = importlib.util.spec_from_file_location('portable_integrity', SOURCE / 'tools/build-portable.py')
integrity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(integrity)


def export_app(runtime: Path, binary: Path, out: Path) -> dict:
    runtime, binary, out = runtime.resolve(), binary.resolve(), out.resolve()
    if out.exists(): raise ValueError(f'destination must not already exist: {out}')
    patches, manifest, archive, assets = integrity.validate_inputs(
        runtime, binary, EXPECTED_BINARY_SHA256, platform='darwin-arm64', source_sha256=EXPECTED_SOURCE_SHA256)
    out.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f'.{out.name}.', dir=out.parent))
    try:
        app = stage / 'Chimeric.app'; contents = app / 'Contents'; resources = contents / 'Resources'
        for path in [contents / 'MacOS', resources / 'bin', resources / 'runtime']: path.mkdir(parents=True, exist_ok=True)

        def copy(src: Path, dst: Path):
            dst.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(['/bin/cp', '-c', str(src), str(dst)], check=True)

        copy(binary, resources / 'bin/chimeric'); (resources / 'bin/chimeric').chmod(0o755)
        for name in integrity.REQUIRED_RUNTIME:
            target = resources / 'runtime' / name
            copy(runtime / name, target)
            if name.endswith('.js') and name not in {'chimeric.js', 'local-runtime.js', 'chatgpt-credentials.js', 'provider-settings.js'}:
                target.with_suffix('.ts').symlink_to(target.name)
        copy(archive, resources / 'runtime' / archive.name)
        subprocess.run(['/bin/cp', '-cR', str(assets), str(resources / 'runtime' / assets.name)], check=True)
        tree_sha, archive_sha = integrity._validate_archive_binding(resources / 'runtime' / archive.name, resources / 'runtime' / assets.name, manifest['sha256'])
        if integrity._sha256(resources / 'runtime/chimeric.js') != patches['outputSha256']: raise ValueError('staged runtime changed during export')
        if integrity._sha256(resources / 'bin/chimeric') != EXPECTED_BINARY_SHA256: raise ValueError('staged binary changed during export')
        manifest = dict(manifest); manifest.pop('root', None)
        (resources / 'runtime/asset-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        copy(SOURCE / 'tools/launcher.mjs', resources / 'launcher.mjs')
        with tempfile.TemporaryDirectory(prefix='chimeric-compile-') as tmp:
            compile_stage = Path(tmp); icons = compile_stage / 'Chimeric.iconset'; icons.mkdir()
            for size in [16, 32, 128, 256, 512]:
                for scale in [1, 2]:
                    target = icons / f'icon_{size}x{size}{"@2x" if scale == 2 else ""}.png'
                    subprocess.run(['sips', '-z', str(size * scale), str(size * scale), str(SOURCE / 'src/chimeric-icon-512.png'), '--out', str(target)], check=True, stdout=subprocess.DEVNULL)
            subprocess.run(['iconutil', '--convert', 'icns', str(icons), '--output', str(resources / 'Chimeric.icns')], check=True)
            subprocess.run(['swiftc', '-target', 'arm64-apple-macos13.0', '-module-cache-path', str(compile_stage / 'module-cache'), str(SOURCE / 'src/macos/Chimeric.swift'), '-o', str(contents / 'MacOS/Chimeric')], check=True)
        info = {'CFBundleName': 'Chimeric', 'CFBundleDisplayName': 'Chimeric', 'CFBundleExecutable': 'Chimeric',
                'CFBundleIdentifier': 'org.chimeric.workbench', 'CFBundleIconFile': 'Chimeric', 'CFBundlePackageType': 'APPL',
                'CFBundleShortVersionString': '0.1.0', 'CFBundleVersion': '2', 'LSMinimumSystemVersion': '13.0',
                'NSHighResolutionCapable': True, 'LSUIElement': False,
                'NSHumanReadableCopyright': 'Chimeric integration contributors. Upstream components retain their notices.',
                'NSMicrophoneUsageDescription': 'Chimeric uses the microphone when you choose voice input.'}
        with (contents / 'Info.plist').open('wb') as handle: plistlib.dump(info, handle)
        subprocess.run(['codesign', '--force', '--sign', '-', str(app)], check=True, capture_output=True)
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True, capture_output=True)
        command = stage / 'chimeric'
        command.write_text('#!/bin/sh\nset -eu\nCHIMERIC_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexport BUN_BE_BUN=1\nexec "$CHIMERIC_ROOT/Chimeric.app/Contents/Resources/bin/chimeric" "$CHIMERIC_ROOT/Chimeric.app/Contents/Resources/launcher.mjs" "$@"\n')
        command.chmod(0o755)
        (stage / 'NOTICE.txt').write_text('Chimeric private research preview. The research runtime is version 0.1.71. Original component copyright and license notices remain in the bundled assets. This ad-hoc signed app has not completed the portable release gates or notarization.\n')
        record = {'app': 'Chimeric.app', 'executable': 'Contents/MacOS/Chimeric', 'interface': 'AppKit/WKWebView',
                  'icon': 'Contents/Resources/Chimeric.icns', 'runtimePlatform': patches['platform'],
                  'runtimeSourceSha256': patches['sourceSha256'], 'runtimeEntrySha256': patches['outputSha256'],
                  'binarySha256': integrity._sha256(resources / 'bin/chimeric'), 'moduleVersion': manifest['moduleVersion'],
                  'backendBundleSha256': integrity._sha256(resources / 'runtime/local-runtime.js'),
                  'nativeShellSha256': integrity._sha256(contents / 'MacOS/Chimeric'),
                  'launcherSha256': integrity._sha256(resources / 'launcher.mjs'),
                  'iconSha256': integrity._sha256(resources / 'Chimeric.icns'),
                  'assetTreeTarSha256': tree_sha, 'assetArchiveRawGzipSha256': archive_sha,
                  'privateProfileIncluded': False, 'developmentBuild': True, 'notarized': False}
        (stage / 'APP-BUILD.json').write_text(json.dumps(record, indent=2) + '\n')
        os.replace(stage, out)
        return record
    except Exception:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    try: print(json.dumps(export_app(args.runtime, args.binary, args.out)))
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as exc: parser.error(str(exc))


if __name__ == '__main__': main()
