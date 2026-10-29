"""Create an atomic, source-only handoff from the reviewed positive manifest."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tempfile

from release_check import ROOT, ReleaseError, audit, selected_paths


def export_source(root: Path, destination: Path, markers=None):
    root = root.resolve()
    destination = destination.absolute()
    if destination.exists() or destination.is_symlink():
        raise ReleaseError('Refusing to overwrite an existing export.')
    report = audit(root, markers)
    if not report['sourceChecksPassed']:
        raise ReleaseError('Source checks failed: ' + '; '.join(report['findings']))
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.chimeric-source-', dir=destination.parent) as temporary:
        staged = Path(temporary) / 'source'
        staged.mkdir()
        files = []
        source_paths = selected_paths(root)
        for path in source_paths:
            relative = path.relative_to(root)
            target = staged / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
            target.chmod(0o755 if path.stat().st_mode & 0o111 else 0o644)
            files.append({'path': relative.as_posix(), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
        if source_paths != selected_paths(root) or any(hashlib.sha256((root / file['path']).read_bytes()).hexdigest() != file['sha256'] for file in files):
            raise ReleaseError('The source changed during export. Freeze the candidate and retry into a new directory.')
        # Audit copied bytes as well as source bytes. The manifest records
        # integrity and review scope; it does not label a development app stable.
        copied = audit(staged, markers, strict_tree=True)
        if not copied['sourceChecksPassed']:
            raise ReleaseError('Copied source failed verification: ' + '; '.join(copied['findings']))
        if any(hashlib.sha256((staged / file['path']).read_bytes()).hexdigest() != file['sha256'] for file in files):
            raise ReleaseError('Staged files changed during verification.')
        (staged / 'SOURCE-MANIFEST.json').write_text(json.dumps({'product': 'Chimeric',
            'kind': 'integration-source', 'channel': report['releaseChannel'],
            'originalRuntimeIncluded': False, 'privateProfileIncluded': False,
            'openReleaseGates': report['openReleaseGates'], 'files': files}, indent=2) + '\n')
        staged.rename(destination)
        if any(hashlib.sha256((destination / file['path']).read_bytes()).hexdigest() != file['sha256'] for file in files):
            # Roll back our newly created output; never touch an older export.
            destination.rename(staged)
            raise ReleaseError('Exported files changed during publication.')
    return {'destination': str(destination), 'files': len(files), 'sourceChecksPassed': True,
            'openReleaseGates': report['openReleaseGates']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--private-markers-file', type=Path)
    args = parser.parse_args()
    try:
        markers = [value.encode() for value in json.loads(args.private_markers_file.read_text())] if args.private_markers_file else []
        print(json.dumps(export_source(args.root, args.out, markers), indent=2))
    except (OSError, ValueError, KeyError) as error:
        print(json.dumps({'sourceChecksPassed': False, 'error': str(error)}))
        raise SystemExit(1)
