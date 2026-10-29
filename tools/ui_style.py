"""Content-addressed Chimeric styles and their self-contained vector images."""
import hashlib

def style_resources(resources):
    assets={}
    for source,placeholder in [('chimeric-atom-3d.svg','__CHIMERIC_ATOM_ANIMATED__'),('chimeric-atom-3d-static.svg','__CHIMERIC_ATOM_STATIC__')]:
        data=(resources/source).read_bytes()
        name=source[:-4]+'-'+hashlib.sha256(data).hexdigest()[:16]+'.svg'
        assets[name]=data
        if placeholder=='__CHIMERIC_ATOM_ANIMATED__':animated=name
        else:static=name
    css=(resources/'chimeric-ui.css').read_bytes().replace(b'__CHIMERIC_ATOM_ANIMATED__',animated.encode()).replace(b'__CHIMERIC_ATOM_STATIC__',static.encode())
    name='chimeric-ui-'+hashlib.sha256(css).hexdigest()[:16]+'.css'
    return name,css,assets
