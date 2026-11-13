"""Unpacks the zipped animation and sound packs in Assets/ into Assets/_unpacked/.

    npm run assets:unpack     (then npm run assets:sync)

Only what the game uses comes out: the 30 FPS animation sprite sheets, and the
sound effects for combat and menus. Music, ambience loops, demo projects and
macOS metadata stay in the zips. Re-running skips files already unpacked.
Standard library only, so it runs anywhere Python 3 does.
"""

import os
import sys
import zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'Assets')
OUT = os.path.join(ROOT, '_unpacked')

# (zip, keep this member?) for each pack.
ANIMATIONS = [
    'animationscollection3_thaumaturgy.zip',
    'animationsselect_dark.zip',
    'animationsselect_earth.zip',
    'animationsselect_ice.zip',
    'animationsselect_light.zip',
    'animationsselect_thunder.zip',
    'animationsselect_water.zip',
    'animationsselect_wind.zip',
]
EVFX = ['evfxblast.zip', 'evfxslash.zip']
SOUNDS = {
    'Simple Magic Sound FX Pack Vol. 1.zip': None,  # everything
    'Medieval Fantasy Sound FX Pack Vol. 2.zip': ('/Weapons/', '/Whooshes/', '/Armor/', '/Items & Misc/'),
    'Foley Impacts Vol. 1.zip': ('/Kicks/', '/Punches/', '/Falls/', '/Beefy Impacts/', '/Flesh Hits/', '/Exaggerated Impacts/', '/Elbow Hits/', '/Knee Hits/'),
    'Foley Footsteps Vol. 1.zip': ('/Stone/', '/Gravel/', '/Metal/'),
    'Foley Movement Vol. 1.zip': ('/Whoosh/', '/Body/'),
    'Fire Sound FX Pack Vol. 1.zip': ('/Fire Magic/', '/Big Fire/', '/Fire Movement/'),
    'UI & Menus Sound FX Pack Vol. 2.zip': ('/Signals/', '/Mouse/Select/', '/Misc/Interaction/'),
}


def wanted(name: str, keep) -> bool:
    if name.endswith('/') or '__MACOSX' in name or os.path.basename(name).startswith('._'):
        return False
    return keep(name)


def unpack(zip_path: str, target: str, keep) -> int:
    if not os.path.exists(zip_path):
        print(f'  missing: {os.path.relpath(zip_path, ROOT)}')
        return 0
    count = 0
    with zipfile.ZipFile(zip_path) as zf:
        for info in zf.infolist():
            if not wanted(info.filename, keep):
                continue
            # zipfile.extract strips absolute paths and '..', so members stay inside target.
            dest = os.path.join(target, info.filename)
            if os.path.exists(dest) and os.path.getsize(dest) == info.file_size:
                continue
            zf.extract(info, target)
            count += 1
    return count


def main() -> int:
    if not os.path.isdir(ROOT):
        print(f'No Assets folder at {ROOT}')
        return 1
    total = 0
    for name in ANIMATIONS:
        stem = name[:-4]
        total += unpack(os.path.join(ROOT, 'Animations', name), os.path.join(OUT, 'animations', stem),
                        lambda n: '/30FPS/' in f'/{n}' and n.lower().endswith('.png'))
    for name in EVFX:
        stem = name[:-4]
        total += unpack(os.path.join(ROOT, 'Animations', name), os.path.join(OUT, 'sounds', stem),
                        lambda n: n.startswith('SFX/') and n.lower().endswith(('.ogg', '.wav')))
    for name, folders in SOUNDS.items():
        stem = name[:-4]
        total += unpack(os.path.join(ROOT, 'SFX', name), os.path.join(OUT, 'sounds', stem),
                        lambda n, f=folders: n.lower().endswith(('.wav', '.ogg')) and (f is None or any(x in n for x in f)))
    print(f'Unpacked {total} new files into {os.path.relpath(OUT, os.path.join(ROOT, ".."))}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
