#!/usr/bin/python3
import json
import os
import re
import struct
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path


TWITTER_MEDIA_HOST = "pbs.twimg.com"
META_MEDIA_HOST_SUFFIXES = ("cdninstagram.com", "fbcdn.net")
TARGET_DIR = Path.home() / "Pictures" / "X Photo Saver"
LOG_PATH = Path.home() / "Library" / "Logs" / "XPhotoSaver" / "native-host.log"
PHOTOS_IMPORT_SCRIPT = """
on run argv
  set imagePath to item 1 of argv
  set targetAlbumId to item 2 of argv
  set imageFile to POSIX file imagePath
  tell application "Photos"
    if targetAlbumId is "" then
      import {imageFile} skip check duplicates yes
    else
      set matchingAlbums to every album whose id is targetAlbumId
      if (count of matchingAlbums) is 0 then
        error "Selected Photos album no longer exists. Refresh the album list."
      end if
      set targetAlbum to item 1 of matchingAlbums
      import {imageFile} into targetAlbum skip check duplicates yes
    end if
  end tell
end run
"""
PHOTOS_ALBUM_LIST_SCRIPT = """
const photos = Application("Photos");
const albums = photos.albums();
JSON.stringify(albums.map(album => ({ id: album.id(), name: album.name() })));
"""


def main():
    log_event("host started")
    while True:
        try:
            message = read_message()
            if message is None:
                log_event("stdin closed")
                break
            log_event("message received")
            send_message(handle_message(message))
        except Exception as error:
            log_event(f"error: {error!r}")
            send_message({"ok": False, "error": str(error)})


def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None

    message_length = struct.unpack("<I", raw_length)[0]
    if message_length <= 0 or message_length > 1024 * 1024:
        raise ValueError("Invalid native message length.")

    raw_message = sys.stdin.buffer.read(message_length)
    return json.loads(raw_message.decode("utf-8"))


def send_message(payload):
    encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()
    log_event(f"message sent: ok={payload.get('ok')}")


def log_event(message):
    try:
      LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
      with LOG_PATH.open("a", encoding="utf-8") as log_file:
          log_file.write(f"{message}\n")
    except OSError:
      pass


def handle_message(message):
    if message.get("action") == "listAlbums":
        return {"ok": True, "albums": list_photos_albums()}

    image_url = validate_url(message.get("url", ""))
    filename = sanitize_filename(message.get("filename", "social-photo.jpg"))
    album_id = normalize_album_id(message.get("albumId"))
    album_name = normalize_album_name(message.get("albumName"))
    keep_file = bool(message.get("keepFile", False))

    if keep_file:
        TARGET_DIR.mkdir(parents=True, exist_ok=True)
        saved_path = download_image(image_url, TARGET_DIR / filename)
        import_result = import_into_photos(saved_path, album_id)
        saved_path_result = str(saved_path)
    else:
        with tempfile.TemporaryDirectory(prefix="x-photo-saver-") as tmp_dir:
            saved_path = download_image(image_url, Path(tmp_dir) / filename)
            import_result = import_into_photos(saved_path, album_id)
            saved_path_result = ""

    return {
        "ok": import_result["ok"],
        "imported": import_result["ok"],
        "albumId": album_id,
        "albumName": album_name,
        "savedPath": saved_path_result,
        "error": import_result.get("error", "")
    }


def validate_url(url):
    parsed = urllib.parse.urlparse(url)
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme != "https":
        raise ValueError("Only HTTPS image URLs are allowed.")
    if hostname == TWITTER_MEDIA_HOST and not parsed.path.startswith("/media/"):
        raise ValueError("Only X photo media URLs are allowed.")
    if hostname != TWITTER_MEDIA_HOST and not is_meta_media_host(hostname):
        raise ValueError("Only X, Threads, and Instagram image CDN URLs are allowed.")
    return url


def is_meta_media_host(hostname):
    return any(
        hostname == suffix or hostname.endswith(f".{suffix}")
        for suffix in META_MEDIA_HOST_SUFFIXES
    )


def sanitize_filename(filename):
    base = os.path.basename(filename)
    base = re.sub(r"[^a-zA-Z0-9._-]", "-", base).strip(".-")
    if not base:
        base = "social-photo.jpg"
    return base[:180]


def normalize_album_name(value):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ValueError("Photos album name must be a string.")

    album_name = value.strip()
    if len(album_name) > 100:
        raise ValueError("Photos album name must be 100 characters or fewer.")
    if any(ord(character) < 32 or ord(character) == 127 for character in album_name):
        raise ValueError("Photos album name cannot contain control characters.")
    return album_name


def normalize_album_id(value):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ValueError("Photos album ID must be a string.")

    album_id = value.strip()
    if len(album_id) > 512:
        raise ValueError("Photos album ID must be 512 characters or fewer.")
    if any(ord(character) < 32 or ord(character) == 127 for character in album_id):
        raise ValueError("Photos album ID cannot contain control characters.")
    return album_id


def list_photos_albums():
    completed = subprocess.run(
        ["osascript", "-l", "JavaScript", "-e", PHOTOS_ALBUM_LIST_SCRIPT],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or "Photos album listing failed.")

    try:
        raw_albums = json.loads(completed.stdout or "[]")
    except json.JSONDecodeError as error:
        raise RuntimeError("Photos returned an invalid album list.") from error
    if not isinstance(raw_albums, list):
        raise RuntimeError("Photos returned an invalid album list.")

    albums = []
    for item in raw_albums[:5000]:
        if not isinstance(item, dict):
            continue
        album_id = item.get("id")
        album_name = item.get("name")
        if not isinstance(album_id, str) or not isinstance(album_name, str):
            continue
        album_id = album_id.strip()
        album_name = album_name.strip()
        if not album_id or not album_name or len(album_id) > 512 or len(album_name) > 512:
            continue
        if any(ord(character) < 32 or ord(character) == 127 for character in album_id + album_name):
            continue
        albums.append({"id": album_id, "name": album_name})

    albums.sort(key=lambda album: album["name"].casefold())
    return albums


def download_image(url, target_path):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 XPhotoSaver/0.1",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
    )

    with urllib.request.urlopen(request, timeout=45) as response:
        content_type = response.headers.get("Content-Type", "")
        if content_type and not content_type.startswith("image/"):
            raise ValueError(f"URL did not return an image: {content_type}")

        with tempfile.NamedTemporaryFile(delete=False, dir=str(target_path.parent)) as tmp_file:
            tmp_file.write(response.read())
            tmp_path = Path(tmp_file.name)

    tmp_path.replace(target_path)
    return target_path


def import_into_photos(path, album_id=""):
    completed = subprocess.run(
        ["osascript", "-e", PHOTOS_IMPORT_SCRIPT, str(path), album_id],
        capture_output=True,
        text=True,
        timeout=90,
    )

    if completed.returncode != 0:
        return {"ok": False, "error": completed.stderr.strip() or completed.stdout.strip()}

    return {"ok": True}


if __name__ == "__main__":
    main()
