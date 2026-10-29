"""Insert the subscription component at a checked native React credentials boundary."""
import hashlib
import gzip
import io
import json
import re
import subprocess
from pathlib import Path
import sys
import tarfile
from ui_style import style_resources

source, destination = map(Path, sys.argv[1:3])
credential = './web-dist/assets/index-DXq2yXE0.js'
vendor = './web-dist/assets/vendor-CED4rDjN.js'
hashes = {
    credential: 'de6dc0818046a7eeff7de3a0ea0626695a9a2a96857d77698167cd051be25c7d',
    vendor: '4e9a7375874787d81fa02df2ed7353271a4a2f21a241ae191fa3236cab83f1f1',
    './web-dist/assets/index-BgpYmw3d.js': '022cf193684419a4cdfd70e6359af7546373692ee6267ef22d3c6a650b569f05',
    './web-dist/assets/ProjectSettings-DSomlcdW.js': '56aa3f7f4b4ee583ed6105a5256d975d516fb49c52e422f61bb9d0d4e285e0c2',
    './skills/THIRD_PARTY_LICENSES.md': 'a3a392f1ff3b55e98b3a86c741c67c4aae2719513edef139f831b204d834b41b',
}
temporary = destination.with_suffix('.tmp.gz')
seen = set()
resources = Path(__file__).resolve().parents[1] / 'src'
version_hash = hashlib.sha256()
for path in [Path(__file__), Path(__file__).with_name('brand-frontend.mjs'), Path(__file__).with_name('ui_style.py'),
             *[resources / name for name in ['atom-component.js.fragment', 'chimeric-dna.json', 'chimeric-favicon.svg',
                 'chimeric-icon-192.png', 'chimeric-icon-512.png', 'provider-settings.js', 'chatgpt-credentials.js', 'ja.json', 'chimeric-ui.css',
                 'chimeric-atom-3d.svg', 'chimeric-atom-3d-static.svg']]]:
    version_hash.update(path.name.encode() + b'\0' + path.read_bytes() + b'\0')
version = '?chimeric=' + version_hash.hexdigest()[:16]
own_style_name, own_style, own_images = style_resources(resources)
with tarfile.open(source, 'r:gz') as original:
    entries = [(member, original.extractfile(member).read() if member.isfile() else None) for member in original]
asset_names = [m.name.removeprefix('./web-dist/assets/') for m, _ in entries if m.name.startswith('./web-dist/assets/') and m.name.endswith('.js')]
references = re.compile(r'(["\'])(?:\./|/?assets/|\./assets/)(' + '|'.join(re.escape(name) for name in asset_names) + r')\1')
changed = set()
for index, (member, data) in enumerate(entries):
    if data is None:
        continue
    if member.name in hashes:
        if hashlib.sha256(data).hexdigest() != hashes[member.name]:
            raise RuntimeError('Unsupported native asset boundary: ' + member.name)
        seen.add(member.name)
    if member.name.startswith('./web-dist/') and member.name.endswith(('.js', '.html')):
        text = data.decode()
        if member.name == './web-dist/assets/ProjectSettings-DSomlcdW.js':
            anchor = 'function Vs({onOpenSettings:e,compact:t=!1,compactSize:s="sm"}={}){'
            if text.count(anchor) != 1:
                raise RuntimeError('Native account settings command boundary changed')
            # Both the desktop menu and browser shortcut use the mounted native
            # Settings state, preserving drafts and the existing panel history.
            listener = 'l.useEffect(()=>{const open=()=>e?.(),key=v=>{if((v.metaKey||v.ctrlKey)&&v.key===","&&!v.altKey){v.preventDefault();open()}};window.addEventListener("chimeric-open-settings",open);window.addEventListener("keydown",key);return()=>{window.removeEventListener("chimeric-open-settings",open);window.removeEventListener("keydown",key)}},[e]);'
            text = text.replace(anchor, anchor + listener)
        if member.name == credential:
            anchor = 'children:[s.jsx(se,{sub:"API keys and tokens for services Claude uses on your behalf'
            if text.count(anchor) != 1:
                raise RuntimeError('Native credentials component anchor changed')
            text = text.replace(anchor, 'children:[s.jsx(LocalModelConnections,{}),s.jsx(LocalChatGPTCredentials,{}),s.jsx(se,{sub:"API keys and tokens for services Claude uses on your behalf')
            text = 'import{ModelConnections as LocalModelConnections}from"/api/local/providers/component.js";import{ChatGPTCredentials as LocalChatGPTCredentials}from"/api/local/chatgpt/component.js";' + text
        # Version the complete module graph so cached immutable chunks share one
        # React runtime and cannot serve the prior Credentials component.
        text = references.sub(lambda match: match.group(0)[:-1] + version + match.group(1), text)
        text = re.sub(r'(["\'])(\./favicon\.svg)\1', lambda match: match.group(1)+match.group(2)+version+match.group(1), text)
        updated = text.encode()
        if updated != data:
            changed.add(member.name)
            member.size = len(updated)
            entries[index] = (member, updated)
# Apply copy and vector-component edits through parsed JavaScript boundaries.
brand_files = [{'name': member.name, 'text': data.decode()} for member, data in entries
               if data is not None and member.name.startswith('./web-dist/assets/') and member.name.endswith('.js')
               and not Path(member.name).name.startswith(('vendor-', 'RDKit_minimal-', 'katex-', 'syntaxHighlighterImpl-', 'LottiePlayer.'))]
runtime = sys.argv[3] if len(sys.argv) > 3 else 'node'
brand = subprocess.run([runtime, str(Path(__file__).with_name('brand-frontend.mjs'))],
                       input=json.dumps(brand_files), capture_output=True, text=True, check=True)
brand_result = json.loads(brand.stdout)
brand_updates = {file['name']: file['text'].encode() for file in brand_result['files'] if file['edits']}
for index, (member, data) in enumerate(entries):
    if data is None:
        continue
    updated = brand_updates.get(member.name, data)
    if member.name == './web-dist/favicon.svg':
        updated = (resources / 'chimeric-favicon.svg').read_bytes()
    elif member.name in ['./web-dist/icon-192.png', './web-dist/icon-512.png', './web-dist/icon-maskable-512.png']:
        size = 192 if member.name.endswith('icon-192.png') else 512
        updated = (resources / f'chimeric-icon-{size}.png').read_bytes()
    elif member.name == './web-dist/manifest.webmanifest':
        manifest = json.loads(data)
        manifest.update(name='Chimeric', short_name='Chimeric')
        for icon in manifest.get('icons', []):
            icon['src'] = icon['src'].split('?')[0] + version
        updated = json.dumps(manifest, indent=2).encode()
    elif member.name == './web-dist/index.html':
        updated = updated.replace(b'<title>Claude Science</title>', b'<title>Chimeric</title>')
        updated = updated.replace(b'</head>', b'<script src="/api/local/i18n/bootstrap.js"></script></head>')
        updated = updated.replace(b'</head>', ('<link data-chimeric-ui="true" rel="stylesheet" href="./assets/'+own_style_name+'"></head>').encode())
        for asset in ['favicon.svg', 'manifest.webmanifest', 'icon-192.png']:
            updated = updated.replace(('href="./'+asset+'"').encode(), ('href="./'+asset+version+'"').encode())
    elif member.name == './agents/operon/metadata.yaml':
        updated = data.replace(b'Claude Science', b'Chimeric')
    elif member.name == './skills/THIRD_PARTY_LICENSES.md':
        # Rebrand the distribution wrapper while preserving the component
        # attributions and complete license texts below it.
        updated = data.replace(b'This distribution of Claude Science includes',
                               b'This distribution of Chimeric includes')
        old_shell = (b'### Electron / Chromium (macOS window shell)\n\n'
                     b'The macOS desktop app hosts the app window in a rebranded, unmodified\n'
                     b'prebuilt Electron. Where the release builds the app flat, Electron is the app\n'
                     b'itself; otherwise it is a shell nested in the app\n'
                     b'(`Contents/Helpers/Claude Science Shell.app`). "The Electron bundle" below is\n'
                     b'whichever of the two holds Electron.')
        new_shell = (b'### Electron / Chromium (upstream macOS window shell)\n\n'
                     b'This notice covers Electron/Chromium components from the upstream distribution,\n'
                     b'including any shell preserved under `Contents/Helpers`. Chimeric\'s native macOS\n'
                     b'window uses system AppKit and WKWebView. "The Electron bundle" below is any\n'
                     b'retained upstream Electron bundle.')
        if updated.count(old_shell) != 1:
            raise RuntimeError('Native license wrapper boundary changed')
        updated = updated.replace(old_shell, new_shell)
        if b'Claude Science' in updated:
            raise RuntimeError('Unreviewed product branding remains in license notice')
    if updated != data:
        changed.add(member.name)
        member.size = len(updated)
        entries[index] = (member, updated)
(destination.parent / 'branding-inventory.json').write_text(json.dumps(brand_result['inventory'], indent=2))
for name, data in {own_style_name: own_style, **own_images}.items():
    member = tarfile.TarInfo('./web-dist/assets/' + name)
    member.size = len(data)
    member.mode = 0o644
    entries.append((member, data))
with tarfile.open(temporary, 'w:gz') as output:
    for member, data in entries:
        if member.name.endswith(('.gz', '.br')) and member.name.rsplit('.', 1)[0] in changed:
            continue
        output.addfile(member, io.BytesIO(data) if data is not None else None)
if seen != set(hashes):
    raise RuntimeError('Missing native frontend assets')
temporary.replace(destination)
digest = hashlib.sha256(gzip.decompress(destination.read_bytes())).hexdigest()
assets = destination.parent / ('assets-science-' + digest[:16])
if not (assets / '.science-assets-sha256').exists():
    with tarfile.open(destination, 'r:gz') as bundle:
        bundle.extractall(assets, filter='data')
    (assets / '.science-assets-sha256').write_text(digest)
if (assets / '.science-assets-sha256').read_text() != digest or not (assets / 'drizzle/sqlite/meta/_journal.json').is_file():
    raise RuntimeError('Incomplete local assets tree')
(destination.parent / 'asset-manifest.json').write_text(json.dumps({'root': str(assets.resolve()), 'rootRelative': assets.name, 'archive': destination.name, 'moduleVersion': version, 'sha256': digest}))
print(json.dumps({'frontend_boundaries': sorted(seen), 'assets': str(assets.resolve())}))
