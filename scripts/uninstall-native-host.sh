#!/usr/bin/env bash
set -euo pipefail

MANIFEST_PATH="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.codex.x_photo_saver.json"
HELPER_DIR="$HOME/Library/Application Support/XPhotoSaver"

if [[ -f "$MANIFEST_PATH" ]]; then
  rm "$MANIFEST_PATH"
  echo "Removed native host manifest:"
  echo "$MANIFEST_PATH"
else
  echo "Native host manifest was not installed."
fi

if [[ -d "$HELPER_DIR" ]]; then
  rm -f "$HELPER_DIR/x_photo_saver_host.py" "$HELPER_DIR/x_photo_saver_host.sh"
  rmdir "$HELPER_DIR" 2>/dev/null || true
  echo "Removed native helper files:"
  echo "$HELPER_DIR"
fi
