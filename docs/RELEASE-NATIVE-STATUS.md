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
| NSIS installer builds on windows-latest | NOT EXECUTED | `native` workflow |
| Silent install, launch, WebView2 page start, uninstall | NOT EXECUTED | `tools/ci/windows-smoke.ps1` in `native` |
| Signing | UNSIGNED - CERTIFICATE NOT CONFIGURED | supported optionally; see SIGNING.md |
| DPI scaling, multi-monitor, real keyboard | NOT EXECUTED | needs a real Windows desktop |

### Android

| Item | Status | Evidence |
|---|---|---|
| Project generated (minSdk 24, targetSdk 37, NDK r29) | VERIFIED | `src-tauri/gen/android` |
| Release signing from secrets; no secrets committed | VERIFIED (design) | `android-signing.mjs`; `.gitignore` covers `*.jks`, `*.keystore`, `*.p12`, `*.pfx`, `keystore.properties` |
| APK + AAB build, signature, id, version, ABIs, 16 KB alignment | NOT EXECUTED | `native` workflow, `android-verify.mjs` |
| Emulator: boot, Back (hint, then exit), restart | NOT EXECUTED | `native` workflow, `android-emulator-smoke.sh` |
| Real device, physical audio | UNTESTED | no device available |

### Release factory

| Item | Status | Evidence |
|---|---|---|
| `release.yml` syntax | VERIFIED | actionlint 1.7.12 clean |
| Dry run end to end | NOT EXECUTED | |
| Tag without Android secrets fails early | ASSUMED | validate step; to be fault-tested |
| Placeholder identifier refused | ASSUMED | validate step; to be fault-tested |

## Human decisions pending

1. **NEEDS HUMAN DECISION: final bundle identifier.** `dev.tracklands.preview` is a placeholder (see SIGNING.md).
2. **NEEDS HUMAN DECISION: Android upload key.** Create it once, back it up offline, and add the four secrets.
3. **NEEDS HUMAN DECISION: Windows signing policy.** Ship unsigned, or provide a certificate.
4. **Tag push:** this environment cannot push tags (HTTP 403 earlier). The owner pushes `v6.2.0` after the merge.

## Next action

Get `native.yml` green on GitHub Actions (Windows, Android, emulator). Then
run a `release.yml` dry run and the fault-injection runs.
