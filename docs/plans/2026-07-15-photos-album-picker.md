# Photos Album Picker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace free-text Photos album entry with a native-backed dropdown that selects an existing regular album by unique ID.

**Architecture:** The popup requests albums from the service worker, which forwards a `listAlbums` action to the native helper. The helper returns validated `{id, name}` records; the selected ID and name are stored and passed back for imports.

**Tech Stack:** Chrome MV3 JavaScript, native messaging, Python 3, JXA, AppleScript, Node/Python tests.

---

### Task 1: Native album listing and ID-based import

**Files:**
- Modify: `native-host/x_photo_saver_host.py`
- Modify: `tests/native_host_test.py`

**Steps:**
1. Add failing tests for parsing/sorting JXA album JSON and passing a selected album ID to AppleScript.
2. Run `python3 -m unittest discover -s tests -p '*_test.py'` and confirm failure.
3. Implement the `listAlbums` action and ID-based import lookup.
4. Compile both scripts and run the Python tests successfully.

### Task 2: Background API and popup picker

**Files:**
- Modify: `src/background.js`
- Modify: `src/popup.html`
- Modify: `src/popup.js`
- Modify: `manifest.json`
- Modify: `package.json`

**Steps:**
1. Add a background `X_LIST_PHOTOS_ALBUMS` request handler.
2. Replace the text input with an album select and refresh button.
3. Load albums on popup open, restore the selected ID, and persist ID/name on change.
4. Bump the options schema and extension version, then run JavaScript syntax checks.

### Task 3: Documentation, installation, and live verification

**Files:**
- Modify: `README.md`

**Steps:**
1. Document album loading, selection, refresh, and deleted-album behavior.
2. Run `npm test` with Photos scripting access and confirm all tests pass.
3. Reinstall the native helper for extension `gdpapigdlffmpibhlljhipcggmdeefia`.
4. Verify the installed helper returns a nonzero album count without printing names.
5. Refresh the X page; leave only Chrome's protected extension-page reload as a manual action if it remains blocked.

