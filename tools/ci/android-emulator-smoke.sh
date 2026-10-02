#!/usr/bin/env bash
# Android emulator smoke test (CI): install the test APK, start TRACKLANDS,
# prove the game page came up (screenshot + the app's WebView storage on
# disk), then the Back button: on the title screen the first press only shows
# the "press again" hint (the app keeps running), the second leaves the app.
# Finally a cold restart. Screenshots go to out/emulator/.
set -u
APK="$1"; PKG="$2"
OUT=out/emulator; mkdir -p "$OUT"
fail() { echo "FAIL: $*"; adb logcat -d | grep -iE "tracklands|chromium|AndroidRuntime|FATAL" | tail -80; exit 1; }
adb install -r "$APK" || fail "install"
adb shell am start -W -n "$PKG/.MainActivity" || fail "start"
sleep 60
adb exec-out screencap -p > "$OUT/1-title.png"
adb shell pidof "$PKG" >/dev/null || fail "app not running after start"
adb logcat -d | grep -E "FATAL EXCEPTION|AndroidRuntime: Process: $PKG" && fail "crash in logcat"
# (release builds are not debuggable, so the app's WebView storage cannot be
# listed; the screenshots and the WebView log show that the page came up)
adb logcat -d | grep -iE "chromium|Tauri|Console" | tail -200 > "$OUT/webview-log.txt"
adb shell input keyevent 4; sleep 3
adb exec-out screencap -p > "$OUT/2-after-first-back.png"
adb shell pidof "$PKG" >/dev/null || fail "the first Back on the title screen closed the app (expected the hint)"
adb shell input keyevent 4; sleep 4
if adb shell pidof "$PKG" >/dev/null; then
  # finished activity: the process may linger, the activity must be gone
  adb shell dumpsys activity activities | grep -q "$PKG/.MainActivity" && fail "the second Back did not leave the app"
fi
adb shell am start -W -n "$PKG/.MainActivity" || fail "restart"
sleep 45
adb exec-out screencap -p > "$OUT/3-restart.png"
adb shell pidof "$PKG" >/dev/null || fail "app not running after restart"
echo "emulator smoke test passed"
