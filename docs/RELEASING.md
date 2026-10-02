# Releasing TRACKLANDS

A release is one version tag on `main`. GitHub Actions builds, checks and
publishes all distributions from exactly that commit. There are no manual
Rust, Gradle or installer builds.

| File | For |
|---|---|
| `TRACKLANDS-<version>-web.zip` | Web / PWA: unpack and serve over HTTP(S) |
| `TRACKLANDS-<version>-windows-x64-setup.exe` | Windows 10/11 installer (NSIS, per-user) |
| `TRACKLANDS-<version>-android-universal.apk` | Android, direct install |
| `TRACKLANDS-<version>-android.aab` | Google Play upload bundle |
| `SHA256SUMS.txt` | checksums of the four files |
| `release-manifest.json` | version, commit, build time, size, SHA-256 and signing status per file, Android ids and SDK levels, tool versions |

## One-time setup

Do this once before the first public release; see [SIGNING.md](SIGNING.md).

1. Decide the final app identifier and set it.
2. Create the Android upload key, back it up offline, and add the four
   `ANDROID_*` secrets.
3. Optional: add a Windows code-signing certificate.

Until steps 1 and 2 are done, a tag stops at the first job with a clear
message. A **dry run** still works, so you can watch the whole pipeline at
any time:

1. Go to **Actions → release → Run workflow** and pick a branch.
2. The run builds everything, signs Android with a throwaway key and runs all
   checks.
3. Nothing is published; the files appear as a workflow artifact named
   `TRACKLANDS-<version>-dryrun`.

## Every release

1. **Prepare the version** on a branch:

   ```sh
   node tools/version.mjs set 6.2.0        # or 6.2.0-rc.1 for a release candidate
   ```

   This writes the version into `package.json` (and the lockfile), the game's
   `GAME_VERSION`, `src-tauri/Cargo.toml` and `Cargo.lock`, and the Android
   versionCode in `tauri.conf.json`, and rebuilds the service worker.
2. **Write the changelog entry** at the top of `src/changelog.js`: the
   version, the month, and English and German lines. The GitHub Release text
   is made from this entry only, and the release stops if the entry is
   missing. Update `docs/RELEASE_NOTES.md` if you keep it.
3. **Check**:

   ```sh
   node tools/version.mjs check           # every declaration agrees
   node tools/check.mjs                   # static check, service worker current
   node tests/run.mjs --quick             # or let CI run the full suites
   ```

4. **Commit, open a pull request, and merge it to `main`** once CI is green
   (`tests` and `native`).
5. **Tag `main`** and push the tag:

   ```sh
   git checkout main && git pull
   git tag v6.2.0
   git push origin v6.2.0
   ```

6. **Wait for Actions → release.** These jobs run in order:

   | Job | What it does |
   |---|---|
   | `validate` | Checks that the tag matches the version, that the commit is on `main`, that the identifier is final, that the Android signing secrets are present, that release notes exist and that the source tree is clean. |
   | `web` | Runs the release test suites and builds the web zip. It then tests the *unpacked* zip on its own: offline, PWA and first session. |
   | `windows` | Builds the NSIS installer (signed if a certificate is configured), then installs it silently, launches it until WebView2 has run the game, and uninstalls it. |
   | `android` | Builds the universal APK and the AAB, signed with your upload key. It verifies the signature, package id, versionName and versionCode, the four ABIs and the 16 KB page alignment. |
   | `verify` | Recomputes every checksum and confirms the file types, then scans every file for signing material and secret values. It writes `SHA256SUMS.txt` and `release-manifest.json`. |
   | `publish` | Creates the GitHub Release. Tags such as `v6.2.0-rc.1` become pre-releases. |

7. **Distribute:**
   - **Google Play:** upload the `.aab` in the Play Console under Production,
     or a testing track. The first upload of a new app, the store listing and
     the content rating are manual steps in the Play Console. The pipeline
     never uploads to Play.
   - **Windows:** link the `-setup.exe` from the GitHub Release, or upload it
     wherever you distribute.
   - **Web:** deploy the contents of the web zip to your static host.

## If a release fails

Fix the cause on a branch, merge to `main`, and tag a **new** version, for
example `v6.2.1` or `v6.2.0-rc.2`. Do not move or reuse a tag that has been
pushed: every published file must come from exactly the commit its tag names.

A failed tag leaves no GitHub Release behind, because only the final job
publishes. If you want to retry the same version after a fix:

1. Delete the tag on GitHub and locally.
2. Make sure nothing was published.
3. Tag the new `main` commit.

## Versions

- **Format:** `X.Y.Z` or `X.Y.Z-rc.N`, where minor and patch are below 100 and
  N is between 1 and 98.
- **Android versionCode:** derived from the version, so it always increases.
  For example: `6.2.0-rc.1` → 6020001, `6.2.0` → 6020099, `6.2.1` → 6020199.
- **Version numbers:** a patch release (Z) is for fixes, a minor release (Y)
  for new things.
- **What counts as a release:** the game version shows in the title screen,
  in Credits (with the build commit and platform) and in every save. Only
  shipped code changes need a new version; documentation and CI changes do
  not.

## Music

Music is optional. Put the files into `assets/music/` and list them in
`assets/music/music.json`. The next release includes them on every platform
without further configuration; the build checks that every listed file
exists.
