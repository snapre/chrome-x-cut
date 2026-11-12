# Photos Album Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an optional Photos album name setting and import saved X images into that regular album, creating it when necessary.

**Architecture:** The popup stores one optional album name in `chrome.storage.sync`. The service worker forwards it through native messaging, and the Python helper validates the value before passing it to Photos through a separate AppleScript argument.

**Tech Stack:** Chrome MV3 JavaScript, native messaging, Python 3, AppleScript, Node/Python tests.

---

### Task 1: Native helper album behavior

**Files:**
- Modify: `native-host/x_photo_saver_host.py`
- Create: `tests/native_host_test.py`
- Modify: `package.json`

**Steps:**
1. Add failing tests for album-name validation and the `osascript` argument list.
2. Run `python3 -m unittest discover -s tests -p '*_test.py'` and confirm failure.
3. Add album validation plus AppleScript logic that creates/reuses a regular album and imports into it.
4. Run the Python tests and confirm success.

### Task 2: Extension setting and message flow

**Files:**
- Modify: `src/popup.html`
- Modify: `src/popup.js`
- Modify: `src/background.js`
- Modify: `manifest.json`
- Modify: `package.json`

**Steps:**
1. Add an optional Photos album text field to the popup.
2. Persist the field with schema version 4 and disable it outside Photos mode.
3. Forward `albumName` to the native helper and include the resolved album in success responses.
4. Run JavaScript syntax checks.

### Task 3: Documentation, installation, and verification

**Files:**
- Modify: `README.md`

**Steps:**
1. Document the album behavior and automatic album creation.
2. Run `npm test` and confirm all tests pass.
3. Reinstall the native helper using the currently configured extension ID.
4. Reload the unpacked extension in Chrome if the browser security surface permits it; otherwise provide the single required manual reload action.

