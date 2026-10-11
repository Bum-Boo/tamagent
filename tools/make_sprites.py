#!/usr/bin/env python3
"""Draw Tamagent's five original 32×32 pixel characters (stdlib only).

The same hand-authored grid supplies LO (32×32) and nearest-neighbor HD
(128×128). No downloaded art, tracing, fonts, or third-party image libraries.
Run: python3 tools/make_sprites.py
"""
import argparse
import base64
import json
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'hooks' / 'characters.ts'
SIZE = 32
CHARACTERS = ('slime', 'robot', 'mushroom', 'cloud', 'meteor')
POSES = {'work': 2, 'idle': 4, 'sleep': 2, 'wait': 2, 'alert': 2}
COLORS = {
    'k': 0x263849, 'e': 0x162B3A, 'w': 0xF4F5D9, 'h': 0xFFFFFF,
    'g': 0x62CBB0, 'G': 0x38A98F, 'l': 0xB9F2D7, 'n': 0xDEED8B,
    'b': 0x77ADE8, 'B': 0x4574AE, 'v': 0x284C70, 's': 0xBDDFEB,
    'p': 0x9A81C7, 'P': 0x725BA3, 'q': 0xD8C5EE,
    'c': 0xF5C49D, 'C': 0xD79478, 't': 0xA9684F,
    'z': 0x7FA4CD, 'y': 0xFFD064, 'a': 0xF17575,
}
INDEX = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'


def grid(text):
    rows = tuple(row.strip() for row in text.strip().splitlines())
    if any(set(row) - (set(COLORS) | {'.'}) for row in rows):
        raise ValueError('Unknown color in pixel grid')
    return rows


# Each silhouette has its own geometry and material. Faces are drawn below.
SHAPES = {
    'slime': (3, 9, grid('''
        ........kkkkkk.........
        ......kkllllllkk.......
        ....kkllggggggllkk.....
        ...klgggggggggggglk....
        ..klgggggggggggggglk...
        .klgggggggggggggggglk..
        klgggggggggggggggggglk.
        klgggggggggggggggggggk.
        kggggggggggggggggggggk.
        kggggggggggggggggggggk.
        kggggggggggggggggggggk.
        kggggggggggggggggggGk..
        .kgggggggggggggggGGGk..
        .kGggggggggggggGGGGk...
        ..kGGGGGGGGGGGGGGGk....
        ..kkGGGGkkGGGGGGkk.....
        .kGGk..kGGk....kGGk....
        ..kk....kk......kk.....
    ''')),
    'robot': (6, 7, grid('''
        ....kkkk..........
        ...ksssskkkkkk....
        ..kssbbbbbbbbsk...
        ..ksbbbbbbbbbsk...
        ..kbbbbbbbbbbBk...
        ..kbbbbbbbbbbBk...
        ..kbbbbbbbbbbBk...
        ..kbbbbbbbbbbBk...
        ...kkkkkkkkkkk....
        ....kbbbbbBk......
        ..kkbbbbbBBkk.....
        .kBbbbbbbBBBsk....
        .kBbbbbbbBBBsk....
        .kBbbbbbbBBBsk....
        ..kBBBBBBBBBk.....
        ...kkkkkkkkk......
        ..kvsk...kvsk.....
        ..kvvk...kvvk.....
        ...kk.....kk......
    ''')),
    'mushroom': (3, 7, grid('''
        .......kkkkkk.........
        .....kkqqppqqkk.......
        ....kqppppppppqk......
        ...kqppppppppppqk.....
        ..kqppppppppppppqk....
        .kqppppppppppppppqk...
        kqppppppppppppppppqk..
        kpppppppppppppppppppk.
        kPPpppppppppppppppPPk.
        .kPPPPPPPPPPPPPPPPPk..
        ..kkkkkkkkkkkkkkkkk...
        ......kwllllwk........
        ......kwllllwk........
        ......kwllllwk........
        ......kwllllwk........
        ......kwllllwk........
        ......kllllllk........
        ......kllllllk........
        .....kGGGkkGGGk.......
        ......kkk..kkk........
    ''')),
    'cloud': (2, 10, grid('''
        .....kkkk...kkkk........
        ....kcccckkkcccck.......
        ...kccwcccccccccck......
        .kkccwwccccccccccckk....
        kcccccwccccccccccccck...
        kccccccccccccccccccck...
        kccccccccccccccccccck...
        kccccccccccccccccccck...
        kccccccccccccccccccCk...
        .kccccccccccccccccCCk...
        ..kCccccccccccccCCCk....
        ...kCCCCCCCCCCCCCCk.....
        ...kkCCkkCCCkkCCkk......
        .....kk..kkk..kk........
    ''')),
    'meteor': (5, 9, grid('''
        .........kkkk........
        ........kllllk.......
        .......klgggglk......
        ......klgggggglk.....
        .....klgggggggglk....
        ....klgggggggggglk...
        ...klgggggggggggglk..
        ..klggggggggggggGGk..
        ..klgggggggggggGGGk..
        ...kggggggggggGGGk...
        ....kggggggggGGGk....
        .....kggggggGGGk.....
        ......kggggGGGk......
        .......kGGGGGk.......
        ........kGGGk........
        .........kkk.........
    ''')),
}


class Canvas:
    def __init__(self, width=SIZE, height=SIZE, background=None):
        self.width, self.height = width, height
        self.pixels = [[background] * width for _ in range(height)]

    def stamp(self, x, y, rows):
        for dy, row in enumerate(rows):
            for dx, token in enumerate(row):
                if token != '.' and 0 <= x + dx < self.width and 0 <= y + dy < self.height:
                    self.pixels[y + dy][x + dx] = COLORS[token]


def draw(name, pose, frame):
    if name not in CHARACTERS or pose not in POSES or not 0 <= frame < POSES[pose]:
        raise ValueError('Unknown sprite')
    canvas = Canvas()
    x, y, rows = SHAPES[name]
    dy = 1 if (pose == 'idle' and frame == 1) or (pose == 'work' and frame == 1) else 0
    if name == 'meteor':
        canvas.stamp(1, 24 + dy, grid('..g..\n.glg.\ngllg.\n.gl..'))
        canvas.stamp(4, 20 + dy, ('g.', 'lg', '.g'))
        canvas.stamp(1, 19 - frame % 2, ('g',))
        rows = tuple(row.translate(str.maketrans({'g': 'y', 'G': 'c', 'l': 'w'})) for row in rows)
    if name == 'robot':
        canvas.stamp(18, 3 + dy, grid('.y.\nkyk\n.k.\n.k.'))
    canvas.stamp(x, y + dy, rows)

    closed = pose == 'sleep' or pose == 'idle' and frame == 2
    if name == 'robot':
        canvas.stamp(10, 11 + dy, grid('kkkkkkkkk\nkvvvvvvvk\nkvvvvvvvk\nkkkkkkkkk'))
        canvas.stamp(12, 12 + dy, ('ss...ss',) if closed else ('ss...ss', 'ss...ss'))
        canvas.stamp(12, 21 + dy, grid('..ys..\n..ys..'))
    elif name == 'mushroom':
        canvas.stamp(9, 10 + dy, ('ll', 'll'))
        canvas.stamp(17, 12 + dy, ('l',))
        canvas.stamp(11, 20 + dy, ('ee..ee',) if closed else ('e...e', 'e...e'))
        canvas.stamp(13, 24 + dy, ('k',))
    elif name == 'cloud':
        canvas.stamp(9, 17 + dy, ('kk....kk',) if closed else ('ek....ke', 'ek....ke'))
        canvas.stamp(12, 21 + dy, ('.k.', 'k.k'))
    elif name == 'meteor':
        canvas.stamp(15, 17 + dy, ('kk..kk',) if closed else ('eh..he', 'ee..ee'))
        canvas.stamp(17, 21 + dy, ('kk',))
    else:
        canvas.stamp(10, 17 + dy, ('kk.....kk',) if closed else ('eh.....he', 'ee.....ee'))
        canvas.stamp(14, 21 + dy, ('k.k', '.k.'))
        canvas.stamp(7, 23 + dy, ('nl', 'ln'))

    if pose == 'work':
        # Tiny mallet with a copper handle, held at two heights.
        tool_y = 16 if frame == 0 else 19
        arm_x = {'slime': 23, 'robot': 19, 'mushroom': 16, 'cloud': 20, 'meteor': 20}[name]
        arm_color = {'robot': 'b', 'cloud': 'c', 'meteor': 'y'}.get(name, 'l')
        canvas.stamp(arm_x, tool_y + 5, ('k' * (27 - arm_x), arm_color * (27 - arm_x), 'k' * (27 - arm_x)))
        canvas.stamp(24, tool_y, grid('kkkkkk\nkssssk\nkBBssk\nkkkkkk\n..tc..\n..tc..\n..tc..\n..tc..\n..kk..'))
    elif pose == 'sleep':
        canvas.stamp(25, 1 + frame, grid('zzzzz\n...z.\n..z..\n.z...\nzzzzz'))
        canvas.stamp(28, 7 + frame, grid('zzz\n.z.\nzzz'))
    elif pose in ('wait', 'alert'):
        color = 'y' if pose == 'wait' else 'a'
        canvas.stamp(27, 1 + frame, (color * 2,) * 5 + ('..', color * 2, color * 2))
    return canvas


def png(canvas, scale=1):
    raw = bytearray()
    for row in canvas.pixels:
        expanded = bytearray()
        for color in row:
            rgba = bytes((color >> 16, color >> 8 & 255, color & 255, 255)) if color is not None else bytes(4)
            expanded.extend(rgba * scale)
        for _ in range(scale):
            raw.extend(b'\0' + expanded)

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', canvas.width * scale, canvas.height * scale, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


FONT = {
    'A': ('010', '101', '111', '101', '101'), 'B': ('110', '101', '110', '101', '110'),
    'C': ('011', '100', '100', '100', '011'), 'D': ('110', '101', '101', '101', '110'),
    'E': ('111', '100', '110', '100', '111'), 'H': ('101', '101', '111', '101', '101'),
    'I': ('111', '010', '010', '010', '111'), 'K': ('101', '101', '110', '101', '101'),
    'L': ('100', '100', '100', '100', '111'), 'M': ('101', '111', '111', '101', '101'),
    'O': ('010', '101', '101', '101', '010'), 'P': ('110', '101', '110', '100', '100'),
    'R': ('110', '101', '110', '101', '101'), 'S': ('011', '100', '010', '001', '110'),
    'T': ('111', '010', '010', '010', '010'), 'U': ('101', '101', '101', '101', '111'),
    'W': ('101', '101', '111', '111', '101'), '0': ('111', '101', '101', '101', '111'),
    '1': ('010', '110', '010', '010', '111'), '2': ('110', '001', '010', '100', '111'),
    '3': ('110', '001', '010', '001', '110'),
}


def text(canvas, x, y, label):
    for index, char in enumerate(label.upper()):
        for dy, row in enumerate(FONT.get(char, ('000',) * 5)):
            for dx, pixel in enumerate(row):
                if pixel == '1':
                    canvas.pixels[y + dy][x + index * 4 + dx] = 0x263849


def sheet(path, scale):
    columns = [(pose, frame) for pose, count in POSES.items() for frame in range(count)]
    cell_w, cell_h = SIZE * scale + 8, SIZE * scale + 18
    label_w = 40
    canvas = Canvas(label_w + len(columns) * cell_w, 12 + len(CHARACTERS) * cell_h, 0xEEF1F4)
    for column, (pose, frame) in enumerate(columns):
        text(canvas, label_w + column * cell_w + 2, 3, f'{pose}{frame}')
    for row, name in enumerate(CHARACTERS):
        text(canvas, 2, 15 + row * cell_h, name)
        for column, (pose, frame) in enumerate(columns):
            sprite = draw(name, pose, frame)
            for y, pixels in enumerate(sprite.pixels):
                for x, color in enumerate(pixels):
                    if color is None:
                        continue
                    for dy in range(scale):
                        for dx in range(scale):
                            canvas.pixels[18 + row * cell_h + y * scale + dy][label_w + column * cell_w + x * scale + dx] = color
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png(canvas))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preview-dir', type=Path, default=ROOT / 'tools' / 'preview')
    args = parser.parse_args()
    hd, lo = {}, {}
    for name in CHARACTERS:
        for pose, count in POSES.items():
            for frame in range(count):
                key = f'{name}-{pose}-{frame}'
                canvas = draw(name, pose, frame)
                hd[key] = base64.b64encode(png(canvas, 4)).decode('ascii')
                palette = list(dict.fromkeys(color for row in canvas.pixels for color in row if color is not None))
                pixels = ''.join('.' if color is None else INDEX[palette.index(color)] for row in canvas.pixels for color in row)
                lo[key] = {'palette': palette, 'px': pixels}
                for directory, scale in [('hd', 4), ('lo', 1)]:
                    dest = args.preview_dir / directory / name / f'{pose}-{frame}.png'
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(png(canvas, scale))
    OUT.write_text('// Generated by tools/make_sprites.py. Five original Tamagent characters.\n'
                   'export const HD_PIXELS = 128\nexport const LO_PIXELS = 32\n\n'
                   'export const HD: Record<string, string> = ' + json.dumps(hd, indent=2) + '\n\n'
                   'export const LO: Record<string, { palette: number[]; px: string }> = '
                   + json.dumps(lo, indent=2) + '\n', encoding='utf-8')
    sheet(args.preview_dir / 'characters-hd.png', 4)
    sheet(args.preview_dir / 'characters-lo.png', 2)
    print(f'Generated {len(hd)} frames, HD 128×128 / LO 32×32: {OUT}')
    print(args.preview_dir / 'characters-hd.png')
    print(args.preview_dir / 'characters-lo.png')


if __name__ == '__main__':
    main()
