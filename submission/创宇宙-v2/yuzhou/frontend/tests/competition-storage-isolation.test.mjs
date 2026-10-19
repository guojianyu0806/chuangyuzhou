import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudClient} from '../src/cloud.js';
import {getLocalFile} from '../src/services.js';
import {createTimetableDisplay} from '../src/timetable-display.js';

function memoryStorage(initial = {}) {
  const storage = {...initial}, accesses = [];
  Object.defineProperties(storage, {
    getItem: {value: key => { accesses.push(['read', key]); return storage[key] ?? null; }},
    setItem: {value: (key, value) => { accesses.push(['write', key]); storage[key] = value; }},
    removeItem: {value: key => { accesses.push(['remove', key]); delete storage[key]; }},
    accesses: {value: accesses}
  });
  return storage;
}

function replaceGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {configurable:true, writable:true, value});
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  });
}

test('competition tab recovery ignores original workbench caches and preserves them unchanged', t => {
  const originalPrefix = 'lumi-cloud-v1-fixture-user-00000000-0000-0000-0000-000000000000';
  const originalSnapshot = JSON.stringify({pending:{state:{privateSource:'old synthetic fixture'}}});
  const local = memoryStorage({[`${originalPrefix}-sync`]:originalSnapshot});
  const session = memoryStorage({'lumi-cloud-tab-fixture-user':'00000000-0000-0000-0000-000000000000'});
  replaceGlobal(t, 'localStorage', local);
  replaceGlobal(t, 'sessionStorage', session);
  replaceGlobal(t, 'window', {addEventListener() {}});

  const client = new CloudClient({username:'fixture-user'});
  assert.match(client.key('personal'), /^czb-yuzhou-/);
  assert.deepEqual(client.recoveryCopies(), []);
  client.persist();
  assert.equal(local[`${originalPrefix}-sync`], originalSnapshot);
  assert.equal(session['lumi-cloud-tab-fixture-user'], '00000000-0000-0000-0000-000000000000');
  for (const [,key] of [...local.accesses,...session.accesses]) assert.match(key, /^czb-yuzhou-/);
});

test('attachment lookup opens only the competition IndexedDB and does not fall back to personal files', async t => {
  const opened = [];
  replaceGlobal(t, 'indexedDB', {
    open(name) {
      opened.push(name);
      const request = {};
      queueMicrotask(() => {
        request.result = {transaction: () => ({objectStore: () => ({get: () => {
          const result = {result:undefined};
          queueMicrotask(() => result.onsuccess());
          return result;
        }})})};
        request.onsuccess();
      });
      return request;
    }
  });
  assert.equal(await getLocalFile('original-attachment-id', ''), undefined);
  assert.equal(await getLocalFile('original-attachment-id', 'cloud-fixture-user'), undefined);
  assert.deepEqual(opened, ['czb-yuzhou-files','czb-yuzhou-files-cloud-fixture-user']);
});

test('competition timetable preference does not migrate or overwrite original device preference', () => {
  const original = '{"version":1,"scale":65}';
  const storage = memoryStorage({'yuzhou-timetable-display-v1':original});
  const preference = createTimetableDisplay(() => storage);
  assert.equal(preference.read(),100);
  assert.deepEqual(preference.write(80),{scale:80,saved:true});
  assert.equal(storage['yuzhou-timetable-display-v1'], original);
  for (const [,key] of storage.accesses) assert.match(key, /^czb-yuzhou-/);
});
