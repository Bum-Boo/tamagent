#!/usr/bin/env python3
"""Import local Tamagent skins using only Python stdlib and ffmpeg/ffprobe."""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
import uuid
import zipfile
from pathlib import Path, PurePosixPath

SKINS = Path.home() / '.local' / 'share' / 'tamagent' / 'skins'
LO = 32
CELL_W, CELL_H = 192, 208
ROWS = {'idle': (0, 6), 'failed': (5, 8), 'waiting': (6, 6), 'running': (7, 6), 'review': (8, 6)}
POSES = {'idle': 'idle', 'failed': 'alert', 'waiting': 'sleep', 'running': 'work', 'review': 'wait'}
MAX_DOWNLOAD = 64 * 1024 * 1024
MAX_MANIFEST = 4 * 1024 * 1024  # Engine $.fs.read text limit.
NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z')


def run(*argv):
    return subprocess.run(argv, check=True, capture_output=True, timeout=30).stdout


def dimensions(path):
    info = json.loads(run('ffprobe', '-v', 'error', '-select_streams', 'v:0',
                          '-show_entries', 'stream=width,height', '-of', 'json', str(path)))
    stream = info['streams'][0]
    width, height = stream['width'], stream['height']
    if width <= 0 or height <= 0 or width * height > 32 * 1024 * 1024:
        raise ValueError('Image dimensions are invalid or exceed 32 megapixels')
    return width, height


def convert(src, filters, dest=None):
    # Explicit argv, a single output frame, bounded decoder/filter threads.
    args = ['ffmpeg', '-v', 'error', '-y', '-threads', '1', '-i', str(src),
            '-filter_threads', '1', '-vf', filters, '-frames:v', '1', '-threads', '1']
    if dest is not None:
        run(*args, '-pix_fmt', 'rgba', str(dest))
        return None
    data = run(*args, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-')
    if len(data) != LO * LO * 4:
        raise ValueError('ffmpeg did not produce a 32×32 RGBA frame')
    return data


def colors(rgba):
    return [(rgba[i] << 16 | rgba[i + 1] << 8 | rgba[i + 2]) if rgba[i + 3] >= 128 else -1
            for i in range(0, len(rgba), 4)]


def frame_ms(value):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not 1 <= value <= 60000:
        raise ValueError('Frame duration must be between 1 and 60000 ms')
    return round(value)


def gif_durations(path):
    if not path.is_file():
        return []
    info = json.loads(run('ffprobe', '-v', 'error', '-select_streams', 'v:0',
                         '-show_frames', '-show_entries', 'frame=duration_time,pkt_duration_time',
                         '-of', 'json', str(path)))
    result = []
    for frame in info.get('frames', []):
        duration = frame.get('duration_time', frame.get('pkt_duration_time'))
        if duration is None:
            return []
        result.append(frame_ms(float(duration) * 1000))
    return result


def download(url, dest):
    if urllib.parse.urlparse(url).scheme not in ('https', 'http'):
        raise ValueError('URL must use http or https')
    request = urllib.request.Request(url, headers={'User-Agent': 'Tamagent-skin/0.1'})
    with urllib.request.urlopen(request, timeout=30) as response, dest.open('wb') as out:
        total = 0
        while block := response.read(1024 * 1024):
            total += len(block)
            if total > MAX_DOWNLOAD:
                raise ValueError('Download exceeds 64 MiB')
            out.write(block)


def unpack_pet(source, temporary):
    if urllib.parse.urlparse(source).scheme in ('https', 'http'):
        archive = temporary / 'download.zip'
        download(source, archive)
        path = archive
    else:
        path = Path(source).expanduser().resolve()
    if path.is_dir():
        pet, sheet = path / 'pet.json', path / 'spritesheet.png'
        if not pet.is_file() or not sheet.is_file():
            raise ValueError('Folder must contain pet.json and spritesheet.png')
    else:
        # Read just these two adjacent members; never extract archive paths.
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            candidates = [name for name in names if PurePosixPath(name).name == 'pet.json'
                          and str(PurePosixPath(name).parent / 'spritesheet.png') in names]
            if len(candidates) != 1:
                raise ValueError('ZIP must contain exactly one pet.json beside spritesheet.png')
            selected = candidates[0]
            if '..' in PurePosixPath(selected).parts or PurePosixPath(selected).is_absolute():
                raise ValueError('Invalid archive member path')
            sheet_name = str(PurePosixPath(selected).parent / 'spritesheet.png')
            pet, sheet = temporary / 'pet.json', temporary / 'spritesheet.png'
            for name, target, limit in [(selected, pet, 1024 * 1024), (sheet_name, sheet, MAX_DOWNLOAD)]:
                if names.count(name) != 1 or archive.getinfo(name).file_size > limit:
                    raise ValueError('Duplicate or oversized archive member')
                with archive.open(name) as member, target.open('wb') as out:
                    shutil.copyfileobj(member, out)
    if pet.stat().st_size > 1024 * 1024 or not isinstance(json.loads(pet.read_text(encoding='utf-8')), dict):
        raise ValueError('pet.json must be a JSON object smaller than 1 MiB')
    if dimensions(sheet) != (CELL_W * 8, CELL_H * 11):
        raise ValueError('Codex pet v2 requires a 1536×2288 sheet (8×11 cells of 192×208)')
    return sheet


def import_codex(args, temporary, frames_dir):
    sheet = unpack_pet(args.source, temporary)
    poses = {}
    for state, (row, count) in ROWS.items():
        pose = POSES[state]
        timing = []
        if args.gif_dir:
            folder = Path(args.gif_dir).expanduser()
            candidate = folder / f'{state}.gif'
            if not candidate.is_file():
                candidate = folder / f'{pose}.gif'
            try:
                timing = gif_durations(candidate)
            except (ValueError, subprocess.SubprocessError, KeyError):
                print(f'{state}: could not read GIF durations; using --ms', file=sys.stderr)
        frames = []
        for column in range(count):
            crop = f'crop={CELL_W}:{CELL_H}:{column * CELL_W}:{row * CELL_H}'
            filters = f'{crop},pad={CELL_H}:{CELL_H}:(ow-iw)/2:(oh-ih)/2:color=0x00000000'
            small = convert(sheet, f'{filters},scale={LO}:{LO}:flags=area')
            if not any(small[3::4]):
                # Full-size alpha avoids losing a tiny nontransparent frame when scaling.
                full = run('ffmpeg', '-v', 'error', '-threads', '1', '-i', str(sheet),
                           '-filter_threads', '1', '-vf', crop, '-frames:v', '1',
                           '-threads', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-')
                if not any(full[3::4]):
                    continue
            filename = f'{pose}-{len(frames)}.png'
            convert(sheet, filters, frames_dir / filename)
            duration = timing[column] if len(timing) == count else args.ms
            frames.append({'file': filename, 'lo': colors(small), 'ms': duration})
        poses[pose] = frames
        print(f'{pose}: {len(frames)} frames')
    return poses


def import_frames(args, temporary, frames_dir):
    source = Path(args.source).expanduser().resolve()
    if not source.is_dir():
        raise ValueError('Frame source must be a folder')
    timings_file = source / 'timings.json'
    timings = json.loads(timings_file.read_text()) if timings_file.is_file() else {}
    if not isinstance(timings, dict):
        raise ValueError('timings.json must be an object of pose arrays')
    poses = {}
    for pose in ('work', 'idle', 'sleep', 'wait', 'alert'):
        pattern = re.compile(rf'{pose}-(\d+)\.png\Z')
        files = sorted((path for path in source.iterdir() if path.is_file() and pattern.fullmatch(path.name)),
                       key=lambda path: int(pattern.fullmatch(path.name).group(1)))
        timing = timings.get(pose, [])
        if not isinstance(timing, list) or timing and len(timing) != len(files):
            raise ValueError(f'timings.json {pose} must match the number of frame files')
        frames = []
        for index, path in enumerate(files):
            width, height = dimensions(path)
            side = max(width, height)
            filters = f'pad={side}:{side}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,scale={LO}:{LO}:flags=area'
            small = convert(path, filters)
            filename = f'{pose}-{index}.png'
            # Keep the hand-drawn PNG bytes intact; only the LO raster is resampled.
            shutil.copyfile(path, frames_dir / filename)
            frames.append({'file': filename, 'lo': colors(small), 'ms': frame_ms(timing[index]) if timing else args.ms})
        poses[pose] = frames
        print(f'{pose}: {len(frames)} frames')
    return poses


def install(args):
    for name in (args.skin, args.character):
        if not NAME.fullmatch(name):
            raise ValueError('Names need 1–64 letters, digits, hyphens or underscores and must start with a letter or digit')
    if args.skin == 'default':
        raise ValueError('default is reserved for bundled art; choose another skin name')
    args.ms = frame_ms(args.ms)
    for binary in ('ffmpeg', 'ffprobe'):
        if shutil.which(binary) is None:
            raise ValueError(f'{binary} is required')
    root = SKINS / args.skin
    manifest_path = root / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {'lo': LO, 'characters': {}}
    if not isinstance(manifest, dict) or manifest.get('lo') != LO or not isinstance(manifest.get('characters'), dict):
        raise ValueError('Existing manifest is invalid; it has not been changed')
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.import-', dir=root) as temp:
        temporary = Path(temp)
        frames_dir = temporary / 'frames'
        frames_dir.mkdir()
        poses = import_codex(args, temporary, frames_dir) if args.command == 'import-codex-pet' else import_frames(args, temporary, frames_dir)
        if not any(poses.values()):
            raise ValueError('No nonempty frames found; existing manifest has not been changed')
        relative = Path('frames') / f'{args.character}-{uuid.uuid4().hex[:12]}'
        for frames in poses.values():
            for frame in frames:
                frame['file'] = (relative / frame['file']).as_posix()
        manifest['characters'][args.character] = poses
        staged_manifest = temporary / 'manifest.json'
        encoded = (json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
        if len(encoded) > MAX_MANIFEST:
            raise ValueError('Manifest exceeds the engine 4 MiB text limit; use another skin. Existing manifest has not been changed')
        staged_manifest.write_bytes(encoded)
        (root / 'frames').mkdir(exist_ok=True)
        os.replace(frames_dir, root / relative)
        os.replace(staged_manifest, manifest_path)
    print(manifest_path)


def list_skins():
    print('default (bundled): slime, robot, mushroom, cloud, meteor')
    if SKINS.is_dir():
        for path in sorted(SKINS.glob('*/manifest.json')):
            try:
                manifest = json.loads(path.read_text())
                print(f'{path.parent.name}: {", ".join(manifest["characters"])}')
            except (ValueError, KeyError, TypeError, OSError) as error:
                print(f'{path.parent.name}: invalid manifest ({error})', file=sys.stderr)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('import-codex-pet', 'import-frames'):
        sub = commands.add_parser(name)
        sub.add_argument('source', help='folder, ZIP, or ZIP URL' if name == 'import-codex-pet' else 'frame folder')
        sub.add_argument('--skin', required=True)
        sub.add_argument('--as', dest='character', required=True)
        sub.add_argument('--ms', type=int, default=150, help='default frame duration in ms (150)')
        if name == 'import-codex-pet':
            sub.add_argument('--gif-dir', help='optional local GIF folder for per-frame durations')
    commands.add_parser('list')
    args = parser.parse_args(argv)
    try:
        if args.command == 'list':
            list_skins()
        else:
            install(args)
    except (ValueError, OSError, KeyError, IndexError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
        print(f'tamagent-skin: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
