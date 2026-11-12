import importlib.util
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).resolve().parents[1] / "native-host" / "x_photo_saver_host.py"
SPEC = importlib.util.spec_from_file_location("x_photo_saver_host", MODULE_PATH)
HOST = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HOST)


class MediaUrlValidationTests(unittest.TestCase):
    def test_accepts_x_media_url(self):
        url = "https://pbs.twimg.com/media/Gabc123?format=jpg&name=orig"
        self.assertEqual(HOST.validate_url(url), url)

    def test_accepts_threads_and_instagram_cdn_urls(self):
        urls = [
            "https://scontent-lax3-2.cdninstagram.com/v/t51.2885-15/photo.jpg?sig=threads",
            "https://instagram.fsin1-1.fna.fbcdn.net/v/t51.2885-15/photo.webp?sig=instagram",
        ]
        for url in urls:
            with self.subTest(url=url):
                self.assertEqual(HOST.validate_url(url), url)

    def test_rejects_non_https_and_lookalike_hosts(self):
        urls = [
            "http://scontent.cdninstagram.com/photo.jpg",
            "https://cdninstagram.com.evil.example/photo.jpg",
            "https://evil-fbcdn.net/photo.jpg",
            "https://pbs.twimg.com/profile_images/avatar.jpg",
        ]
        for url in urls:
            with self.subTest(url=url):
                with self.assertRaises(ValueError):
                    HOST.validate_url(url)


class AlbumSelectionTests(unittest.TestCase):
    def test_normalizes_optional_album_name(self):
        self.assertEqual(HOST.normalize_album_name(None), "")
        self.assertEqual(HOST.normalize_album_name("  X 图片  "), "X 图片")

    def test_rejects_invalid_album_names(self):
        with self.assertRaisesRegex(ValueError, "string"):
            HOST.normalize_album_name(123)
        with self.assertRaisesRegex(ValueError, "100"):
            HOST.normalize_album_name("x" * 101)
        with self.assertRaisesRegex(ValueError, "control"):
            HOST.normalize_album_name("X\nPhotos")

    def test_normalizes_optional_album_id(self):
        self.assertEqual(HOST.normalize_album_id(None), "")
        self.assertEqual(HOST.normalize_album_id("  album-id/L0/040  "), "album-id/L0/040")

    @mock.patch.object(HOST.subprocess, "run")
    def test_lists_valid_albums_sorted_by_name(self, run):
        run.return_value = subprocess.CompletedProcess(
            [],
            0,
            '[{"id":"2/L0/040","name":"Zulu"},{"id":"1/L0/040","name":"Alpha"},{"id":"","name":"Ignored"}]',
            "",
        )

        albums = HOST.list_photos_albums()

        self.assertEqual(albums, [
            {"id": "1/L0/040", "name": "Alpha"},
            {"id": "2/L0/040", "name": "Zulu"},
        ])
        command = run.call_args.args[0]
        self.assertEqual(command[:3], ["osascript", "-l", "JavaScript"])
        self.assertEqual(command[-1], HOST.PHOTOS_ALBUM_LIST_SCRIPT)

    @mock.patch.object(HOST, "list_photos_albums")
    def test_list_albums_action_does_not_require_an_image_url(self, list_albums):
        list_albums.return_value = [{"id": "1/L0/040", "name": "Alpha"}]

        result = HOST.handle_message({"action": "listAlbums"})

        self.assertEqual(result, {
            "ok": True,
            "albums": [{"id": "1/L0/040", "name": "Alpha"}],
        })


class PhotosImportTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("osacompile"), "AppleScript compiler is unavailable")
    def test_photos_import_applescript_compiles(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_path = Path(tmp_dir) / "photos-import.scpt"
            completed = subprocess.run(
                ["osacompile", "-e", HOST.PHOTOS_IMPORT_SCRIPT, "-o", str(output_path)],
                capture_output=True,
                text=True,
            )

        self.assertEqual(completed.returncode, 0, completed.stderr or completed.stdout)

    @unittest.skipUnless(shutil.which("osacompile"), "JavaScript for Automation compiler is unavailable")
    def test_photos_album_list_jxa_compiles(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_path = Path(tmp_dir) / "photos-albums.scpt"
            completed = subprocess.run(
                ["osacompile", "-l", "JavaScript", "-e", HOST.PHOTOS_ALBUM_LIST_SCRIPT, "-o", str(output_path)],
                capture_output=True,
                text=True,
            )

        self.assertEqual(completed.returncode, 0, completed.stderr or completed.stdout)

    @mock.patch.object(HOST.subprocess, "run")
    def test_passes_album_id_as_separate_osascript_argument(self, run):
        run.return_value = subprocess.CompletedProcess([], 0, "", "")

        result = HOST.import_into_photos(Path("/tmp/x-photo.jpg"), "album-id/L0/040")

        self.assertEqual(result, {"ok": True})
        command = run.call_args.args[0]
        self.assertEqual(command[:2], ["osascript", "-e"])
        self.assertEqual(command[-2:], ["/tmp/x-photo.jpg", "album-id/L0/040"])
        self.assertEqual(command[2], HOST.PHOTOS_IMPORT_SCRIPT)
        self.assertIn("every album whose id is targetAlbumId", HOST.PHOTOS_IMPORT_SCRIPT)
        self.assertIn("import {imageFile} into targetAlbum", HOST.PHOTOS_IMPORT_SCRIPT)

    @mock.patch.object(HOST.subprocess, "run")
    def test_keeps_library_only_import_when_album_is_blank(self, run):
        run.return_value = subprocess.CompletedProcess([], 0, "", "")

        HOST.import_into_photos(Path("/tmp/x-photo.jpg"), "")

        command = run.call_args.args[0]
        self.assertEqual(command[-1], "")
        self.assertIn('if targetAlbumId is "" then', command[2])
        self.assertIn("import {imageFile} skip check duplicates yes", command[2])


if __name__ == "__main__":
    unittest.main()
