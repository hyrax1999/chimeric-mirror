"""Apply Chimeric's standalone stylesheet while a runtime keeps serving."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
from ui_style import style_resources

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('runtime',type=Path)
args=parser.parse_args()
runtime=args.runtime.resolve();manifest_path=runtime/'asset-manifest.json'
manifest=json.loads(manifest_path.read_text());active=runtime/manifest['rootRelative'];archive=runtime/manifest['archive']
style_name,style,images=style_resources(Path(__file__).resolve().parents[1]/'src')
prior_path=runtime/'style-update.json'
prior=json.loads(prior_path.read_text()) if prior_path.is_file() else {}
with tarfile.open(archive,'r:gz') as bundle:
    entries=[(m,bundle.extractfile(m).read() if m.isfile() else None) for m in bundle]
html=next(data for member,data in entries if member.name=='./web-dist/index.html')
if (active/'web-dist/index.html').read_bytes()!=html:raise SystemExit('The active HTML differs from its archive; inspect it before updating styles.')
strip_style=lambda text:re.sub(rb'<link data-chimeric-ui="true"[^>]*>',b'',text)
# A running daemon retains its original asset directory. On repeated style
# updates the manifest may already name a newer directory for the next start.
# Touch an older serving directory only if its JavaScript graph is identical.
serving=[]
for name in dict.fromkeys([prior.get('activeRoot'),*prior.get('servingRoots',[]),active.name]):
    if not name:continue
    root=runtime/name
    if root.parent!=runtime or not name.startswith('assets-science-'):raise SystemExit('Invalid prior serving root.')
    if not root.is_dir():continue
    candidate=(root/'web-dist/index.html').read_bytes()
    if strip_style(candidate)!=strip_style(html):raise SystemExit('A prior serving directory has a different module graph; inspect before hot updating.')
    serving.append(root)
tag=('<link data-chimeric-ui="true" rel="stylesheet" href="./assets/'+style_name+'">').encode()
html=strip_style(html)
if html.count(b'</head>')!=1:raise SystemExit('Unexpected frontend HTML boundary.')
updated=html.replace(b'</head>',tag+b'</head>')
temporary=archive.with_suffix('.style.tmp.gz')
with tarfile.open(temporary,'w:gz') as bundle:
    for member,data in entries:
        if member.name.startswith('./web-dist/assets/chimeric-ui-') and member.name.endswith('.css'):continue
        if member.name.startswith('./web-dist/assets/chimeric-atom-3d') and member.name.endswith('.svg'):continue
        if member.name in ['./web-dist/index.html.gz','./web-dist/index.html.br']:continue
        if member.name=='./web-dist/index.html':data=updated;member.size=len(data)
        bundle.addfile(member,io.BytesIO(data) if data is not None else None)
    for name,data in {style_name:style,**images}.items():
        member=tarfile.TarInfo('./web-dist/assets/'+name);member.mode=0o644;member.size=len(data);bundle.addfile(member,io.BytesIO(data))
digest=hashlib.sha256(gzip.decompress(temporary.read_bytes())).hexdigest()
canonical=runtime/('assets-science-'+digest[:16])
if not canonical.exists():
    if shutil.which('sw_vers'):subprocess.run(['/bin/cp','-cR',str(active),str(canonical)],check=True)
    else:shutil.copytree(active,canonical,symlinks=True)
def atomic_write(path,data):
    temporary_path=path.with_name(path.name+'.style.tmp')
    temporary_path.write_bytes(data);temporary_path.replace(path)
for root in dict.fromkeys([canonical,*serving]):
    # The new path avoids immutable browser caches. Native JavaScript imports
    # keep their existing version, so active tabs share one React runtime.
    for name,data in {style_name:style,**images}.items():atomic_write(root/'web-dist/assets'/name,data)
    atomic_write(root/'web-dist/index.html',updated)
    for suffix in ['.gz','.br']:(root/('web-dist/index.html'+suffix)).unlink(missing_ok=True)
    (root/'.science-assets-sha256').write_text(digest)
temporary.replace(archive)
manifest.pop('root',None);manifest.update(rootRelative=canonical.name,sha256=digest)
temp_manifest=manifest_path.with_suffix('.tmp');temp_manifest.write_text(json.dumps(manifest,indent=2));temp_manifest.replace(manifest_path)
record={'style':style_name,'images':list(images),'visualScale':1.5,'activeRoot':serving[0].name,'servingRoots':[root.name for root in dict.fromkeys([*serving,canonical])],'nextStartupRoot':canonical.name,'moduleVersionPreserved':manifest['moduleVersion'],'archiveSha256':digest,'requiresServerRestart':False}
(runtime/'style-update.json').write_text(json.dumps(record,indent=2))
print(json.dumps(record))
