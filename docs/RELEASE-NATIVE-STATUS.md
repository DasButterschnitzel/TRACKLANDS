# Native release: evidence ledger

This ledger tracks the work on releasing the game for Windows and Android
(Phase 15 and 16). Every claim below carries one of these statuses:

| Status | Meaning |
|---|---|
| **VERIFIED** | Shown by a command, a test or a CI run named in this file. |
| **FAILED** | Tried, and it did not work. |
| **BLOCKED** | Cannot go further without something outside the repository. |
| **NOT EXECUTED** | Not run (yet). |
| **ASSUMED** | Expected from design or documentation, but not tested. |
| **NEEDS HUMAN DECISION** | Waiting on the owner. |

An ASSUMED item is never counted as VERIFIED.

## Baseline

| Item | Value |
|---|---|
| WEB_BASELINE_SHA | `f4c1ae186f485f02cb915fb66f0c3f41b900c004` (main, the merge of #2) |
| WEB_BASELINE_VERSION | 6.1.1 |
| Native branch | `claude/tracklands-complete-game-y0l9qn` → PR #3 |
| Release version on the branch | 6.2.0 (Android versionCode 6020099) |

## Phase 15: 6.1.x stabilisation

| Item | Status | Evidence |
|---|---|---|
| CI on PR #2 head `cc8859f` | VERIFIED | `tests` run 36941197914: static, core (incl. recovery, catalogsearch, offline, security, rcflow), economy (incl. prodsave, pwa, persist), transport, fuzz-fast, Chromium, Firefox, WebKit — all success |
| Train recovery fix | VERIFIED | `recovery` suite (player train on own line, rival on own station, never a cut-off platform, route found again), plus `prodsave`, AI suites and save fuzzing in the same CI run |
| Release UX pass | VERIFIED (by test) | `rcflow` and `ui`/`touch` in CI; no new issues, so no changes |
| Trailer "white ring" | VERIFIED: intentional | `P.burst()` on `trainSpawn` (`src/Game.js:426`): the ring when a train leaves a depot. Not a bug; left as it is |
| PR #2 merged | VERIFIED | squash merge `f4c1ae1`; main tree identical to the tested head `cc8859f` |
| main after the merge | VERIFIED | static check; `prodsave persist pwa offline rcflow recovery` all PASS locally on `f4c1ae1` |

## Phase 16: native distribution

### Architecture

| Item | Status | Evidence |
|---|---|---|
| One runtime manifest (`tools/runtime-files.mjs`) for the service worker, web zip and native staging | VERIFIED | `build-sw --check` reports the service worker unchanged after the refactor |
| Deterministic staging, no development files, all references resolve | VERIFIED | `nativebuild` suite |
| Web zip byte-reproducible | VERIFIED | `nativebuild`: two zips, same SHA-256 |
| Music auto-inclusion (`assets/music/**`) | VERIFIED | `nativebuild`: a file dropped into `assets/music/` is in the runtime list; a playlist entry without its file fails staging |
| Music absent | VERIFIED | `music.json` has no tracks; every build and test runs |
| No service worker in native, unchanged on web | VERIFIED | `nativebuild` (0 registrations native, web registers); `pwa` and `offline` suites |
| Platform adapter: save dialog export, Back order, build label | VERIFIED (simulated Tauri API) | `nativebuild` with an injected `__TAURI__`. Real WebView2 / Android: see below |
| Simulation unchanged by the wrapper | VERIFIED | `nativebuild`: production save, seeded randomness, 120 s of play give the same serialised-world SHA-256 in the repository, the staged web build and the staged native build |
| One version everywhere; drift and a wrong tag fail | VERIFIED | `tools/version.mjs check`; `nativebuild` changes a Cargo.toml version and a tag, and both are caught |
| Android versionCode monotonic (rc < final < next) | VERIFIED | `nativebuild`: 6020001 < 6020002 < 6020099 < 6020199 |

### Tauri shell

| Item | Status | Evidence |
|---|---|---|
| Tauri 2.12.1 / CLI 2.12.1 / dialog 2.8.1 / fs 2.6.0, pinned, lockfiles committed | VERIFIED | `Cargo.lock`, `package-lock.json` |
| Least-privilege capabilities (no shell, process, HTTP, fs read) | VERIFIED (config) | `src-tauri/capabilities/default.json`, validated by `tauri-build` at compile time |
| Strict CSP with the game booting under it | VERIFIED on Linux WebKitGTK | `tauri build` + Xvfb: the title screen renders and the game starts |
| Save persists across app restart | VERIFIED on Linux WebKitGTK | new game → kill → relaunch → title shows "Continue · Company level 1 · 2,500" |
| Rust fmt, check, clippy (`-D warnings`) | VERIFIED | locally, and in `native` run 36974785136, job native-static |

### Windows

| Item | Status | Evidence |
|---|---|---|
| NSIS installer builds on windows-latest | VERIFIED | `native` run 36976587203 (job windows) and `release` dry run 36977882844; `TRACKLANDS-6.2.0-windows-x64-setup.exe`, 2.4 MB, NSIS (the installer stub is a 32-bit PE, as every NSIS installer; it installs the x64 app) |
| Silent install, launch, WebView2 page start, uninstall | VERIFIED | `windows-smoke.ps1` in both runs above: silent per-user install, version in the uninstall entry, the app creates its WebView2 IndexedDB, still running after 10 s, silent uninstall |
| Signing | UNSIGNED - CERTIFICATE NOT CONFIGURED | supported optionally; see SIGNING.md |
| DPI scaling, multi-monitor, real keyboard | NOT EXECUTED | needs a real Windows desktop |

### Android

| Item | Status | Evidence |
|---|---|---|
| Project generated (minSdk 24, targetSdk 37, NDK r29) | VERIFIED | `src-tauri/gen/android` |
| Release signing from secrets; no secrets committed | VERIFIED (design) | `android-signing.mjs`; `.gitignore` covers `*.jks`, `*.keystore`, `*.p12`, `*.pfx`, `keystore.properties` |
| APK + AAB build, signature, id, version, ABIs, 16 KB alignment | VERIFIED | `release` dry run 36977882844 (job android) and `native` runs: universal APK and AAB, apksigner v2 and jarsigner pass, `dev.tracklands.preview` 6.2.0 / 6020099, minSdk 24, targetSdk 37, arm64-v8a, armeabi-v7a, x86, x86_64, not debuggable; 64-bit libraries 16 KB aligned. Re-checked locally on the downloaded files |
| 32-bit libraries at 4 KB alignment | VERIFIED: correct | the first CI build showed armeabi-v7a and x86 at 4 KB. 16 KB pages exist only on 64-bit devices; the check now requires 16 KB for 64-bit ABIs and 4 KB for 32-bit, and records every library |
| Emulator: install, start, title screen | VERIFIED | `native` run 36977767642 (API 34 x86_64): cold start in 1.4 s, title screen rendered (screenshot `1-title.png`), no crash |
| Emulator: first Back on the title shows the hint, app keeps running | VERIFIED | same run: screenshot `2-after-first-back.png` shows "Press Back again to leave TRACKLANDS" |
| Emulator: Back twice leaves the app, restart | VERIFIED | `native` run 36979512777 on 9bc56fd: two Back presses leave the app (screenshot `3-after-double-back.png` shows the launcher), cold restart shows the title again (`4-restart.png`). The first run had pressed the second Back after the 2 s window (a test bug, fixed in the script) |
| Real device, physical audio | UNTESTED | no device available |

### Release factory

| Item | Status | Evidence |
|---|---|---|
| `release.yml` syntax | VERIFIED | actionlint 1.7.12 clean |
| Dry run end to end | VERIFIED | `release` run 36977882844 (pull request, 521f0d8): validate, web, windows, android, verify all success; publish skipped. Artifact `TRACKLANDS-6.2.0-dryrun` downloaded and re-checked locally: `sha256sum -c` OK for all four files, APK and AAB signatures, badging, PE/NSIS type, no development folders in the web zip |
| Manifest signing status | VERIFIED (after a fix) | the first dry run listed the signed APK/AAB as "unsigned" (`apkCertSha256` not read in CI). `android-verify` now reads the certificate robustly and fails if it cannot. Dry run 36979516866 on 9bc56fd: "signed (certificate SHA-256 e66fa093…) — DRY RUN: throwaway key"; re-checked locally with apksigner and keytool |
| AAB signed with the same certificate as the APK | VERIFIED | now a check in `android-verify` (and required by `release-finalize` for a tag). Fault injection: an AAB re-signed with another key fails "AAB signed with the same certificate as the APK" |
| Secret scan catches a leaked value | VERIFIED (local) | `release-finalize.mjs` with a `SCAN_SECRET_*` value planted in the web zip: "FAIL secret scan … contains the value of SCAN_SECRET_TEST", exit 1 |
| Commit in a pull-request dry run | NOTE | a pull-request run builds GitHub's merge commit (`66a3da6…` for head 521f0d8); a tag run builds the tag's commit |
| Tag without Android secrets fails early | VERIFIED (local) | `android-signing.mjs --from-env` with no secrets: "ANDROID RELEASE SIGNING NOT CONFIGURED: missing secret(s) …", exit 1; a garbage keystore: exit 1. Not executed as a real tag (this environment cannot push tags) |
| Wrong tag, missing release notes | VERIFIED (local) | `version.mjs check --tag=v6.1.9` exit 1; `release-notes.mjs` for a version without changelog entry exit 1 |
| Placeholder identifier refused | ASSUMED | validate step (tag mode only) prints "NEEDS HUMAN DECISION: CONFIRM FINAL BUNDLE IDENTIFIER"; runs only on a tag, not executed |

## Human decisions pending

1. **NEEDS HUMAN DECISION: final bundle identifier.** `dev.tracklands.preview` is a placeholder (see SIGNING.md).
2. **NEEDS HUMAN DECISION: Android upload key.** Create it once, back it up offline, and add the four secrets.
3. **NEEDS HUMAN DECISION: Windows signing policy.** Ship unsigned, or provide a certificate.
4. **Tag push:** this environment cannot push tags (HTTP 403 earlier). The owner pushes `v6.2.0` after the merge.

## Next action

Merge PR #3 once CI is green on its head. After the human decisions above,
the owner pushes `v6.2.0`.
