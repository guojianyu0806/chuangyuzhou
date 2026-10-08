import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = name => readFileSync(resolve(root, name), 'utf8');
const run = (name, args = []) => spawnSync(process.execPath, [resolve(root, name), ...args], {
  cwd: root, encoding: 'utf8', timeout: 5000,
  env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH },
});

test('Android CLI refuses before SDK lookup, signing reads or artifact creation', () => {
  const sentinel = resolve(root, '.workbench', 'disabled-mobile-cli-must-not-create');
  assert(sentinel.startsWith(resolve(root) + sep));
  assert.equal(existsSync(sentinel), false);
  const result = run('mobile/build-android.mjs', ['--tools', sentinel, '--signing-dir', sentinel]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /COMPETITION_ANDROID_BUILD_DISABLED/);
  assert.equal(existsSync(sentinel), false);
});

test('historical timetable CLI refuses before opening supplied files or data directories', () => {
  const sentinel = resolve(root, '.workbench', 'disabled-timetable-cli-must-not-create');
  assert.equal(existsSync(sentinel), false);
  const result = run('deployment/import-timetable.mjs', ['--data-dir', sentinel, '--file', resolve(sentinel, 'missing.json')]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /COMPETITION_DEPLOYMENT_DISABLED/);
  assert.equal(existsSync(sentinel), false);
});

test('Python deployment guards precede every import and business statement', () => {
  for (const name of ['prepare-server.py', 'activate-release.py', 'publish-android.py']) {
    const withoutDocumentation = read('deployment/' + name)
      .replace(/^"""[\s\S]*?"""\s*/, '')
      .split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#'));
    assert.match(withoutDocumentation[0], /^raise SystemExit\('COMPETITION_DEPLOYMENT_DISABLED:/, name);
  }
  for (const name of ['shiguang.service', 'workbench-ip.caddy']) {
    assert(read('deployment/' + name).split(/\r?\n/).every(line => !line.trim() || line.startsWith('#')), name);
  }
});

test('mobile entry points use independent app identity and have no original production origin', () => {
  const paths = [
    'mobile/android/app/src/main/AndroidManifest.xml',
    'mobile/android/app/src/main/java/cn/yuzhou/workbench/MainActivity.java',
    'mobile/android/app/src/main/assets/download-bridge.js',
    'mobile/tests/android-smoke/AndroidManifest.xml',
    'mobile/tests/android-smoke/NativeSmoke.java',
    'mobile/build-android.mjs',
    'mobile/download-page/index.template.html',
  ];
  for (const name of paths) {
    assert.doesNotMatch(read(name), /203\.195\.191\.239|cn\.yuzhou\.workbench|E:\/服务器秘钥/, name);
  }
  assert.match(read(paths[0]), /package="cn\.chuanzhibei\.yuzhou"/);
  assert.match(read(paths[1]), /SERVER_CONFIGURED = false/);
  assert.doesNotMatch(read(paths[6]), /href="https?:|href="\{\{APK_FILE\}\}"/);
});
