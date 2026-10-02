#!/usr/bin/env node
// Writes src-tauri/gen/android/keystore.properties for the Gradle release
// signing config (app/build.gradle.kts). Used by CI only; the file is
// git-ignored and deleted after the build.
//
//   node tools/ci/android-signing.mjs --keystore <path.jks> --alias <alias> \
//        --store-password <pw> --key-password <pw>
//   node tools/ci/android-signing.mjs --from-env      (release: reads the secrets
//        ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS,
//        ANDROID_KEY_PASSWORD; decodes the keystore into RUNNER_TEMP)
//
// Fails loudly when anything is missing: a release must never fall back to
// an unsigned or differently signed build.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
const fail = (m) => { console.error('ANDROID RELEASE SIGNING NOT CONFIGURED: ' + m); process.exit(1); };

let keystore, alias, storePassword, keyPassword;
if (argv.includes('--from-env')) {
  const e = process.env;
  const missing = ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'].filter((k) => !e[k]);
  if (missing.length) fail(`missing secret(s) ${missing.join(', ')} (see docs/SIGNING.md)`);
  const tmp = e.RUNNER_TEMP || fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'trk-'));
  keystore = path.join(tmp, 'tracklands-upload.jks');
  const bytes = Buffer.from(e.ANDROID_KEYSTORE_BASE64.replace(/\s+/g, ''), 'base64');
  if (bytes.length < 500) fail('ANDROID_KEYSTORE_BASE64 does not decode to a keystore');
  fs.writeFileSync(keystore, bytes, { mode: 0o600 });
  alias = e.ANDROID_KEY_ALIAS; storePassword = e.ANDROID_KEYSTORE_PASSWORD; keyPassword = e.ANDROID_KEY_PASSWORD;
} else {
  keystore = opt('keystore'); alias = opt('alias'); storePassword = opt('store-password'); keyPassword = opt('key-password');
  if (!keystore || !alias || !storePassword || !keyPassword) fail('usage: --keystore --alias --store-password --key-password, or --from-env');
  if (!fs.existsSync(keystore)) fail('keystore file not found');
}
// java .properties: backslashes and the separators must be escaped
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/([:=#!])/g, '\\$1').replace(/\n/g, '\\n');
const props = path.join(ROOT, 'src-tauri/gen/android/keystore.properties');
fs.writeFileSync(props, [`storeFile=${esc(path.resolve(keystore))}`, `storePassword=${esc(storePassword)}`, `keyAlias=${esc(alias)}`, `keyPassword=${esc(keyPassword)}`, ''].join('\n'), { mode: 0o600 });
console.log(`signing configured: alias "${alias}", keystore outside the repository (${path.basename(keystore)})`);
