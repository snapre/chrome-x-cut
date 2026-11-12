#!/usr/bin/env bash
set -euo pipefail

EXTENSION_ID="${EXTENSION_ID:-${1:-}}"

if [[ -z "$EXTENSION_ID" ]]; then
  echo "Usage: EXTENSION_ID=<chrome-extension-id> scripts/install-native-host.sh"
  echo "Or:    scripts/install-native-host.sh <chrome-extension-id>"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_HOST_PATH="$ROOT_DIR/native-host/x_photo_saver_host.py"
HELPER_DIR="$HOME/Library/Application Support/XPhotoSaver"
INSTALLED_HOST_PATH="$HELPER_DIR/x_photo_saver_host.py"
WRAPPER_PATH="$HELPER_DIR/x_photo_saver_host.sh"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST_PATH="$MANIFEST_DIR/com.codex.x_photo_saver.json"

mkdir -p "$HELPER_DIR"
cp "$SOURCE_HOST_PATH" "$INSTALLED_HOST_PATH"
chmod +x "$INSTALLED_HOST_PATH"

cat > "$WRAPPER_PATH" <<SH
#!/bin/sh
exec /usr/bin/python3 "$INSTALLED_HOST_PATH"
SH
chmod +x "$WRAPPER_PATH"

mkdir -p "$MANIFEST_DIR"

cat > "$MANIFEST_PATH" <<JSON
{
  "name": "com.codex.x_photo_saver",
  "description": "Native host for importing social photos into macOS Photos.",
  "path": "$WRAPPER_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
JSON

echo "Installed native host manifest:"
echo "$MANIFEST_PATH"
echo "Installed native helper:"
echo "$HELPER_DIR"
