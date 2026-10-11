"""Exercise the importer with synthetic originals only, in temporary folders."""
import contextlib
import importlib.util
import io
import json
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


skin = module('tamagent_skin', ROOT / 'tools' / 'tamagent-skin.py')
sprites = module('tamagent_sprites', ROOT / 'tools' / 'make_sprites.py')


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'ffmpeg and ffprobe required')
class ImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shared = tempfile.TemporaryDirectory(prefix='tamagent-fixtures-')
        cls.pet = Path(cls.shared.name) / 'pet'
        cls.pet.mkdir()
        (cls.pet / 'pet.json').write_text('{"name":"Synthetic original","version":2}')
        canvas = sprites.Canvas(192 * 8, 208 * 11)
        # One occupied cell per used row plus a second idle frame after a blank.
        for row in (0, 5, 6, 7, 8):
            for y in range(60, 110):
                for x in range(50, 100):
                    canvas.pixels[row * 208 + y][x] = 0x627ABC + row
        for y in range(60, 110):
            for x in range(50, 100):
                canvas.pixels[y][192 * 2 + x] = 0xABCDEF
        (cls.pet / 'spritesheet.png').write_bytes(sprites.png(canvas))
        cls.zip = Path(cls.shared.name) / 'pet.zip'
        with zipfile.ZipFile(cls.zip, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name in ('pet.json', 'spritesheet.png'):
                archive.write(cls.pet / name, f'nested/{name}')

    @classmethod
    def tearDownClass(cls):
        cls.shared.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tamagent-skin-test-')
        self.root = Path(self.temp.name)
        self.patcher = patch.object(skin, 'SKINS', self.root / 'skins')
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()
        self.temp.cleanup()

    def invoke(self, *argv):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return skin.main(list(argv))

    def manifest(self):
        return json.loads((skin.SKINS / 'test' / 'manifest.json').read_text())

    def test_frame_import_preserves_bytes_timing_and_other_characters(self):
        source = self.root / 'drawn'
        source.mkdir()
        for number in (10, 2):
            (source / f'idle-{number}.png').write_bytes(sprites.png(sprites.draw('robot', 'idle', number % 4), 4))
        (source / 'timings.json').write_text('{"idle":[120,230]}')
        self.assertEqual(self.invoke('import-frames', str(source), '--skin', 'test', '--as', 'a'), 0)
        first = self.manifest()['characters']['a']['idle']
        self.assertEqual([frame['ms'] for frame in first], [120, 230])
        self.assertEqual(len(first[0]['lo']), 1024)
        self.assertEqual((skin.SKINS / 'test' / first[0]['file']).read_bytes(), (source / 'idle-2.png').read_bytes())
        self.assertEqual(self.invoke('import-frames', str(source), '--skin', 'test', '--as', 'b'), 0)
        self.assertEqual(list(self.manifest()['characters']), ['a', 'b'])
        self.assertEqual(self.manifest()['characters']['a']['idle'], first)
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(skin.main(['list']), 0)
        self.assertIn('test: a, b', out.getvalue())

    def test_codex_folder_crops_pads_and_skips_empty_cells(self):
        self.assertEqual(self.invoke('import-codex-pet', str(self.pet), '--skin', 'test', '--as', 'a', '--ms', '180'), 0)
        manifest = self.manifest()
        poses = manifest['characters']['a']
        self.assertEqual(manifest['lo'], 32)
        self.assertEqual(set(poses), {'idle', 'work', 'sleep', 'wait', 'alert'})
        self.assertEqual(len(poses['idle']), 2)
        self.assertTrue(all(len(poses[pose]) == 1 for pose in ('work', 'sleep', 'wait', 'alert')))
        frame = poses['work'][0]
        self.assertEqual(frame['ms'], 180)
        self.assertEqual(len(frame['lo']), 1024)
        self.assertIn(-1, frame['lo'])
        self.assertTrue(any(value >= 0 for value in frame['lo']))
        self.assertEqual(skin.dimensions(skin.SKINS / 'test' / frame['file']), (208, 208))

    def test_zip_and_url_adapter_import_the_same_pet(self):
        # Only the network transfer is mocked; real ZIP selection and ffmpeg run.
        with patch.object(skin, 'download', side_effect=lambda _url, dest: shutil.copyfile(self.zip, dest)):
            self.assertEqual(self.invoke('import-codex-pet', 'https://example.org/pet.zip', '--skin', 'test', '--as', 'z'), 0)
        self.assertEqual(len(self.manifest()['characters']['z']['idle']), 2)

    def test_failed_import_does_not_overwrite_existing_manifest(self):
        target = skin.SKINS / 'test'
        target.mkdir(parents=True)
        previous = '{"lo":32,"characters":{"kept":{"idle":[]}}}'
        (target / 'manifest.json').write_text(previous)
        self.assertEqual(self.invoke('import-frames', str(self.root), '--skin', 'test', '--as', 'a'), 1)
        self.assertEqual((target / 'manifest.json').read_text(), previous)

    def test_manifest_size_limit_preserves_the_installed_skin(self):
        target = skin.SKINS / 'test'
        target.mkdir(parents=True)
        previous = '{"lo":32,"characters":{"kept":{"idle":[]}}}'
        (target / 'manifest.json').write_text(previous)
        source = self.root / 'drawn'
        source.mkdir()
        (source / 'idle-0.png').write_bytes(sprites.png(sprites.draw('robot', 'idle', 0)))
        with patch.object(skin, 'MAX_MANIFEST', 100):
            self.assertEqual(self.invoke('import-frames', str(source), '--skin', 'test', '--as', 'a'), 1)
        self.assertEqual((target / 'manifest.json').read_text(), previous)
        self.assertFalse((target / 'frames').exists())

    def test_rejects_path_names_bad_sheet_and_archive_traversal(self):
        self.assertEqual(self.invoke('import-frames', str(self.root), '--skin', '../escape', '--as', 'a'), 1)
        self.assertEqual(self.invoke('import-frames', str(self.root), '--skin', 'default', '--as', 'a'), 1)
        malformed = self.root / 'bad-pet'
        malformed.mkdir()
        (malformed / 'pet.json').write_text('{}')
        (malformed / 'spritesheet.png').write_bytes(sprites.png(sprites.draw('slime', 'idle', 0)))
        self.assertEqual(self.invoke('import-codex-pet', str(malformed), '--skin', 'test', '--as', 'a'), 1)
        archive = self.root / 'bad.zip'
        with zipfile.ZipFile(archive, 'w') as out:
            out.writestr('../pet.json', '{}')
            out.writestr('../spritesheet.png', b'invalid')
        self.assertEqual(self.invoke('import-codex-pet', str(archive), '--skin', 'test', '--as', 'a'), 1)
        self.assertFalse((self.root / 'escape').exists())

    def test_gif_timing_reader(self):
        path = self.root / 'idle.gif'
        path.touch()
        data = json.dumps({'frames': [{'duration_time': '0.12'}, {'pkt_duration_time': '0.23'}]}).encode()
        with patch.object(skin, 'run', return_value=data):
            self.assertEqual(skin.gif_durations(path), [120, 230])


class OriginalArtTests(unittest.TestCase):
    def test_all_60_original_frames_have_correct_dimensions_and_animation(self):
        for name in sprites.CHARACTERS:
            for pose, count in sprites.POSES.items():
                images = [sprites.draw(name, pose, frame) for frame in range(count)]
                for image in images:
                    self.assertEqual((image.width, image.height), (32, 32))
                    self.assertTrue(any(pixel is not None for row in image.pixels for pixel in row))
                    self.assertEqual(sprites.png(image, 4)[16:24], b'\0\0\0\x80' * 2)
                self.assertNotEqual(images[0].pixels, images[1].pixels)
            self.assertNotEqual(sprites.draw(name, 'idle', 0).pixels, sprites.draw(name, 'idle', 2).pixels)


if __name__ == '__main__':
    unittest.main()
