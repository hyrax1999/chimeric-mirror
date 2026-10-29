"""Check the public source boundary and documentation; --ship enforces open gates."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
IGNORED = {'.git', '__pycache__', 'node_modules', 'build', 'dist'}
# These sets are the reviewed source boundary. The manifest remains the
# ordered publication declaration, while these invariants prevent an edit to
# that declaration from silently dropping a required source area.
REQUIRED_ROOT_FILES = frozenset({
    'README.md', 'README.ja.md', 'LICENSE', 'NOTICE.md', 'SECURITY.md',
    'CONTRIBUTING.md', 'CHANGELOG.md', '.gitignore', 'package.json',
    'bun.lock', 'providers.example.json', 'release.manifest.json',
    'release-status.json',
})
REQUIRED_DIRECTORIES = frozenset({'src', 'tests', 'docs', 'third-party', '.github'})
REQUIRED_TOOLS = frozenset({
    'build-runtime.ts', 'native-revisions.ts', 'native-process.ts',
    'build-frontend.py', 'brand-frontend.mjs', 'generate-atom.mjs',
    'ui_style.py', 'update-style.py', 'build-macos-app.py',
    'build-portable.py', 'launcher.mjs', 'recover_runtime.py',
    'local_asr.py', 'native_client.py', 'release_check.py',
    'prepare-release.py',
})
PRIVATE_NAMES = {'local-auth', 'provider-config.json', 'model-selection.json',
                 'models.last-good.json', 'ui-preferences.json', 'chimeric.local.json',
                 'id_ed25519', 'id_rsa', 'requests.jsonl'}
SECRET_PATTERNS = [
    re.compile(rb'-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----'),
    re.compile(rb'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b'),
    re.compile(rb'\bgh[pousr]_[A-Za-z0-9]{30,}\b'),
    re.compile(rb'\bgithub_pat_[A-Za-z0-9_]{40,}\b'),
    re.compile(rb'\bnonce=[a-f0-9]{24,}\b'),
]


class ReleaseError(ValueError):
    pass


def selected_paths(root: Path) -> list[Path]:
    """Positive selection prevents sibling profiles and recovered assets leaking."""
    policy = json.loads((root / 'release.manifest.json').read_text())
    actual_files = frozenset(policy.get('files', []))
    actual_directories = frozenset(policy.get('directories', []))
    actual_tools = frozenset(policy.get('tools', []))
    if (actual_files != REQUIRED_ROOT_FILES or actual_directories != REQUIRED_DIRECTORIES
            or actual_tools != REQUIRED_TOOLS):
        raise ReleaseError('release.manifest.json does not contain the complete reviewed source boundary')
    if len(policy.get('files', [])) != len(actual_files) or len(policy.get('directories', [])) != len(actual_directories) or len(policy.get('tools', [])) != len(actual_tools):
        raise ReleaseError('release.manifest.json contains duplicate source entries')
    names = [*policy['files'], *('tools/' + name for name in policy['tools'])]
    paths = []
    for name in names:
        path = root / name
        if path.is_symlink() or root not in path.resolve().parents:
            raise ReleaseError('Unsafe source path: ' + name)
        if not path.is_file():
            raise ReleaseError('Missing required source file: ' + name)
        paths.append(path)
    for name in policy['directories']:
        directory = root / name
        if directory.is_symlink() or root not in directory.resolve().parents:
            raise ReleaseError('Unsafe source directory: ' + name)
        if not directory.is_dir():
            raise ReleaseError('Missing required source directory: ' + name)
        for path in sorted(directory.rglob('*')):
            relative = path.relative_to(root)
            if any(part in IGNORED for part in relative.parts):
                continue
            if path.is_symlink():
                raise ReleaseError('Symlinks are excluded from source exports: ' + relative.as_posix())
            if path.is_file():
                paths.append(path)
    return sorted(set(paths))


def inspect_file(path: Path, relative: Path, markers: list[bytes]) -> list[str]:
    """Report paths and finding types only; never echo matched credentials."""
    label = relative.as_posix()
    parts = set(relative.parts)
    if parts & PRIVATE_NAMES or path.name.startswith('.env') or path.suffix in {'.key', '.pem', '.db', '.sqlite', '.sqlite3', '.gz', '.zip', '.dmg', '.exe'} or path.name.endswith(('.enc.json', '.db-wal', '.db-shm')):
        return [label + ': private data or binary distribution file']
    if path.stat().st_size > 2 * 1024 * 1024:
        return [label + ': exceeds source-file size limit']
    data = path.read_bytes()
    if data.startswith((b'\x7fELF', b'MZ', b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xca\xfe\xba\xbe')):
        return [label + ': native executable in source export']
    findings = []
    if any(pattern.search(data) for pattern in SECRET_PATTERNS):
        findings.append(label + ': credential-shaped material')
    if any(marker in data for marker in markers):
        findings.append(label + ': private deployment identifier')
    return findings


def documentation_findings(root: Path, paths: list[Path]) -> list[str]:
    findings = []
    selected = set(paths)
    for path in paths:
        if path.suffix != '.md':
            continue
        text = re.sub(r'```[\s\S]*?```', '', path.read_text())
        for target in re.findall(r'!?\[[^\]\n]*\]\(([^\n)]+)\)', text):
            target = target.strip().strip('<>')
            target = re.split(r'\s+[\"\']', target, maxsplit=1)[0]
            parsed = urlsplit(target)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            linked = (path.parent / unquote(parsed.path)).resolve()
            label = path.relative_to(root).as_posix()
            if root not in linked.parents and linked != root:
                findings.append(label + ': link escapes the source export')
            elif not linked.exists() or (linked.is_file() and linked not in selected):
                findings.append(label + ': missing exported link target ' + parsed.path)
    return findings


def audit(root: Path, markers: list[bytes] | None = None, strict_tree: bool = False) -> dict:
    root = root.resolve()
    paths = selected_paths(root)
    findings = []
    for path in paths:
        findings.extend(inspect_file(path, path.relative_to(root), markers or []))
    findings.extend(documentation_findings(root, paths))
    if strict_tree:
        for path in root.rglob('*'):
            relative = path.relative_to(root)
            if any(part in IGNORED for part in relative.parts):
                continue
            if path.is_symlink() or path.is_file() and path not in paths and path.name != 'SOURCE-MANIFEST.json':
                findings.append(relative.as_posix() + ': unselected file in publication tree')
    status = json.loads((root / 'release-status.json').read_text())
    pending = [gate['id'] for gate in status['releaseGates'] if gate['status'] != 'passed']
    return {'sourceChecksPassed': not findings, 'filesChecked': len(paths),
            'findings': findings, 'releaseChannel': status['channel'], 'openReleaseGates': pending,
            'scope': 'Source boundary, known credential patterns, local Markdown links and declared release gates. This does not establish runtime correctness or redistribution rights.'}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--private-markers-file', type=Path,
                        help='Private JSON array of deployment identifiers; keep outside the export.')
    parser.add_argument('--strict-tree', action='store_true')
    parser.add_argument('--ship', action='store_true')
    args = parser.parse_args()
    try:
        markers = [value.encode() for value in json.loads(args.private_markers_file.read_text())] if args.private_markers_file else []
        report = audit(args.root, markers, args.strict_tree)
    except (OSError, ValueError, KeyError) as error:
        print(json.dumps({'sourceChecksPassed': False, 'error': str(error)}))
        return 1
    print(json.dumps(report, indent=2))
    return int(bool(not report['sourceChecksPassed'] or args.ship and (report['openReleaseGates'] or report['releaseChannel'] == 'development')))


if __name__ == '__main__':
    raise SystemExit(main())
