# Signing TRACKLANDS releases

Release builds come out of GitHub Actions (`.github/workflows/release.yml`).
Signing keys never live in the repository. They exist only as GitHub
secrets and as an offline backup that you keep yourself.

| Platform | Signing | Required for a release? |
|---|---|---|
| Android (APK and AAB) | Upload key (keystore) | **Yes.** A tag without the key fails at the first step. |
| Windows (setup `.exe`) | Code-signing certificate | No. Without one, the installer is built unsigned and the release says so. |
| Web (zip) | — | — |

## Before the first public release: two decisions

1. **Final app identifier** (`identifier` in `src-tauri/tauri.conf.json`).
   - Integration work uses `dev.tracklands.preview`. This is a development
     placeholder, and the release workflow refuses to publish with it.
   - The identifier becomes the Android application ID. Once an app is on
     Google Play, its ID can never change.
   - Saves are also stored per identifier. If the identifier changes, the app
     starts with an empty save on every platform.
   - Choose it once, for example `com.<your-domain>.tracklands`. Then set it
     in `tauri.conf.json` and regenerate the Android project. See
     [NATIVE-BUILDS.md](NATIVE-BUILDS.md#changing-the-identifier).
2. **Android upload key**: create it once, as described below.

## Android: create the upload key (once)

Run this on your own computer, which needs a JDK (`keytool`):

```sh
keytool -genkeypair -v \
  -keystore tracklands-upload.jks \
  -alias tracklands-upload \
  -keyalg RSA -keysize 4096 -validity 10000
```

`keytool` asks for a keystore password, your name and organisation, and a key
password. You can give the same password twice.

### Back it up OFFLINE, now

**This key cannot be replaced.** Every update of the app must be signed with
the same key, or Android refuses to install it over the old version.

- **With Google Play App Signing** (the default for new apps), Google holds
  the app signing key and this file is your *upload* key. If you lose it, you
  can ask Google to reset it, which takes time and support.
- **Without Play**, for APKs you hand out directly, losing it means players
  must uninstall the app. That deletes their local saves.

Keep at least two copies of `tracklands-upload.jks` and both passwords
outside GitHub, for example a password manager plus an encrypted USB stick.
Do not rely on the GitHub secret alone: secrets cannot be read back.

### Put it into GitHub

1. Base64-encode the keystore:
   - Linux: `base64 -w0 tracklands-upload.jks > keystore.b64`
   - macOS: `base64 -i tracklands-upload.jks -o keystore.b64`
   - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("tracklands-upload.jks")) | Set-Content keystore.b64`
2. In the repository, go to **Settings → Secrets and variables → Actions → New
   repository secret** and create:

   | Secret | Value |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | the contents of `keystore.b64` |
   | `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
   | `ANDROID_KEY_ALIAS` | `tracklands-upload` (or the alias you chose) |
   | `ANDROID_KEY_PASSWORD` | the key password |

3. Delete `keystore.b64` afterwards.
4. Optional, but recommended: pin the certificate. Read its SHA-256
   fingerprint with
   `keytool -list -v -keystore tracklands-upload.jks -alias tracklands-upload`
   and store it, without colons, as the repository **variable** (not a
   secret) `ANDROID_UPLOAD_CERT_SHA256`. Every release then also checks that
   the APK was signed with exactly this certificate.

### What CI does with it

`tools/ci/android-signing.mjs --from-env` decodes the keystore into the
runner's temporary folder. It then writes the git-ignored
`src-tauri/gen/android/keystore.properties`, which
`app/build.gradle.kts` reads. Both files are deleted after the build.

`tools/ci/android-verify.mjs` checks the result with `apksigner` and
`jarsigner`. The `verify` job scans every artifact for the secret values and
for signing files.

- **Pull requests and pushes** (`native.yml`): never use the secrets. They
  sign test builds with a throwaway key made in the job.
- **Dry runs** (release workflow started by hand): do the same, and the files
  are labelled `-dryrun`.

## Windows: code-signing certificate (optional)

An unsigned installer works. Windows SmartScreen may warn ("Windows protected
your PC") until the file has built up reputation. The release states the
signing status of every file in `release-manifest.json`.

To sign, obtain an Authenticode code-signing certificate (`.pfx`) from a
certificate authority, then add these secrets:

| Secret | Value |
|---|---|
| `WINDOWS_CERTIFICATE_BASE64` | the `.pfx` file, base64-encoded (as above) |
| `WINDOWS_CERTIFICATE_PASSWORD` | its password |

Optionally add the repository variable `WINDOWS_TIMESTAMP_URL`. The default is
`http://timestamp.digicert.com`.

- **When the secret is set:** the workflow imports the certificate into the
  runner's certificate store, has Tauri sign the installer, and fails if the
  result is not validly signed.
- **When it is not set:** the build continues and labels the installer
  `UNSIGNED - CERTIFICATE NOT CONFIGURED`.

Certificates kept on hardware tokens or in cloud HSMs (for example Azure
Trusted Signing) need a different signing step. Tauri's
`bundle.windows.signCommand` supports them. Ask before switching.

## Never

- Commit `*.jks`, `*.keystore`, `*.p12`, `*.pfx`, `keystore.properties` or
  any password. These patterns are in `.gitignore`.
- Generate a new Android release key in CI or "just for this release".
- Publish an Android build that is unsigned or signed with a throwaway key.
  The release workflow refuses to.
